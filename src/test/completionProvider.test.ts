import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { requireInstalls, wordsFilePath } from './lilypondInstalls';

// We need to use the extension's bundled LilyPondInstallation class, not import it directly.
// The extension bundles its own copy, so direct imports would be a different class instance.
type LilyPondInstallationType = {
	getInstance(): any;
	setMockInstance(mock: any): void;
	createMockInstance(config: { version: string; executablePath: string }): any;
	resetForTesting(): void;
	invalidate(): void;
};

type LanguageClientType = {
	isRunning(): boolean;
};

/**
 * Opens a scratch document with the given content and returns the completions offered at its end.
 *
 * The document is untitled, so nothing is written to disk and each case starts from a clean buffer.
 */
async function completionsAtEndOf(content: string): Promise<vscode.CompletionList> {
	const document = await vscode.workspace.openTextDocument({ language: 'lilypond', content });
	await vscode.window.showTextDocument(document);

	const position = new vscode.Position(0, content.length);
	const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
		'vscode.executeCompletionItemProvider',
		document.uri,
		position
	);

	assert.ok(completions, 'Completions should be provided');
	return completions;
}

function labelsOf(completions: vscode.CompletionList): string[] {
	return completions.items.map(item => (typeof item.label === 'string' ? item.label : item.label.label));
}

// The completions come from the installation — its `ly/` files by way of the language server, or its lilypond-words when there's no server to be had — so every installed version is worth a run: a command that moved or was renamed between versions shows up as a failure against that version alone.
for (const install of requireInstalls()) {
	suite(`Completion Provider (LilyPond ${install.version})`, () => {
		let LilyPondInstallation: LilyPondInstallationType;
		let languageClient: LanguageClientType;

		suiteSetup(async () => {
			// Get the extension first (need it to access the bundled LilyPondInstallation)
			const allExtensions = vscode.extensions.all;
			const ext = allExtensions.find(e => e.id.includes('lilypond-studio'));
			if (!ext) {
				const ids = allExtensions.map(e => e.id).join(', ');
				throw new Error(`Extension not found. Available: ${ids}`);
			}

			// Activate extension to get exports
			if (!ext.isActive) {
				await ext.activate();
			}

			// Get the bundled LilyPondInstallation from extension exports
			LilyPondInstallation = ext.exports.LilyPondInstallation;
			languageClient = ext.exports.languageClient;

			// Point the extension at the real installation without running it, so both the server and (should it be needed) the keyword list read that version.
			const mockInstallation = LilyPondInstallation.createMockInstance({
				version: install.version,
				executablePath: install.executablePath,
			});

			// Setting the mock fires the ready event, which triggers completion loading
			LilyPondInstallation.setMockInstance(mockInstallation);

			const document = await vscode.workspace.openTextDocument({
				language: 'lilypond',
				content: `\\version "${install.version}"`,
			});
			await vscode.window.showTextDocument(document);

			// Wait for the async ready event handlers to complete
			await new Promise(resolve => setTimeout(resolve, 500));

			// Verify the mock is properly set
			const instance = LilyPondInstallation.getInstance();
			if (!instance) {
				throw new Error('Mock instance not set properly');
			}
			if (instance.getVersion() !== install.version) {
				throw new Error(`Expected version ${install.version}, got ${instance.getVersion()}`);
			}
		});

		suiteTeardown(async () => {
			// Close any open editors first
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');

			// Reset LilyPondInstallation, so the next version's suite starts from a clean slate
			if (LilyPondInstallation) {
				LilyPondInstallation.resetForTesting();
			}
		});

		test('reads its word list from the installation', () => {
			assert.ok(fs.existsSync(wordsFilePath(install)), `Expected a lilypond-words file at ${wordsFilePath(install)}`);
		});

		test('provides completions for backslash commands', async () => {
			const completions = await completionsAtEndOf('\\');

			assert.ok(completions.items.length > 0, 'Should have at least one completion item');
			assert.ok(
				labelsOf(completions).some(label => label.startsWith('\\')),
				'Should have backslash commands in completions'
			);
		});

		test('provides completions when typing partial command', async () => {
			const completions = await completionsAtEndOf('\\rel');

			assert.ok(completions.items.length > 0, 'Should have completion items');
			assert.ok(
				labelsOf(completions).includes('\\relative'),
				'Should include \\relative in completions'
			);
		});

		// The next two are the same question — what does typing `\version ` get you? — asked of the two arrangements the extension supports, and each skips in the other's. A development checkout has a server binary in server/; the CI test job deliberately doesn't (see .github/workflows/ci.yml), so both paths are exercised across a full run.

		test('the version argument completes to the installed version', async function () {
			if (!languageClient.isRunning()) {
				this.skip();
			}

			// Nothing short of the running server knows this number: it reaches the argument by way of the share directory the client passed at initialize.
			const completions = await completionsAtEndOf('\\version ');

			assert.deepStrictEqual(
				labelsOf(completions),
				[`"${install.version}"`],
				'Should offer the installed version, quoted ready to write'
			);
		});

		test('the keyword list offers a version snippet when there is no server', async function () {
			if (languageClient.isRunning()) {
				this.skip();
			}

			const completions = await completionsAtEndOf('\\ver');

			const versionCompletion = completions.items.find(item => {
				const label = typeof item.label === 'string' ? item.label : item.label.label;
				return label === '\\version';
			});

			assert.ok(versionCompletion, 'Should have \\version completion');

			assert.strictEqual(
				versionCompletion!.kind,
				vscode.CompletionItemKind.Snippet,
				'\\version should be a Snippet kind'
			);

			assert.strictEqual(
				versionCompletion!.detail,
				'LilyPond version directive',
				'\\version should have special detail text'
			);

			// The snippet offers the installed version as its default, so it tracks whichever installation the extension found.
			const insertText = versionCompletion!.insertText as vscode.SnippetString;
			assert.ok(
				insertText.value.includes(install.version),
				`Snippet ${insertText.value} should default to ${install.version}`
			);
		});

		test('a command says where it came from', async function () {
			if (!languageClient.isRunning()) {
				this.skip();
			}

			// The server labels every name with the layer that answered for it, which is what tells your own \foo from LilyPond's in a list of a thousand.
			const completions = await completionsAtEndOf('\\rel');

			const relative = completions.items.find(item => {
				const label = typeof item.label === 'string' ? item.label : item.label.label;
				return label === '\\relative';
			});

			assert.ok(relative, 'Should have \\relative completion');
			assert.strictEqual(relative!.detail, 'built-in', '\\relative is our own curated signature');
		});

		test('completion replaces correct range with backslash', async () => {
			const completions = await completionsAtEndOf('c4 \\rel');

			assert.ok(completions.items.length > 0, 'Should have completion items');

			const relativeCompletion = completions.items.find(item => {
				const label = typeof item.label === 'string' ? item.label : item.label.label;
				return label === '\\relative';
			});

			assert.ok(relativeCompletion, 'Should have \\relative completion');

			// The range should cover '\rel' (positions 3-7)
			// VSCode returns range as a Range object but it may be serialized differently
			if (relativeCompletion!.range) {
				const range = relativeCompletion!.range as vscode.Range;
				// Range should include the backslash at position 3
				assert.strictEqual(range.start.character, 3, `Range should start at backslash, got ${range.start.character}`);
				assert.strictEqual(range.end.character, 7, `Range should end at cursor, got ${range.end.character}`);
			}
		});
	});
}
