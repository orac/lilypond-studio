import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Completion Provider', () => {
	// Path to our test fixtures
	// __dirname is out/test when compiled, so go up to project root
	const projectRoot = path.join(__dirname, '..', '..');
	const fixturesPath = path.join(projectRoot, 'src', 'test', 'fixtures');
	const mockLilypondPath = path.join(fixturesPath, 'bin', 'lilypond.exe');

	/**
	 * Helper to create a scratch document with the given content
	 */
	async function createScratchDocument(content: string): Promise<vscode.TextDocument> {
		const document = await vscode.workspace.openTextDocument({
			language: 'lilypond',
			content: content
		});
		await vscode.window.showTextDocument(document);
		return document;
	}

	suiteSetup(async () => {
		// Open a scratch document to ensure the extension is activated
		const document = await createScratchDocument('\\version "2.24.0"');
		await vscode.window.showTextDocument(document);

		// Get the extension's exports through VSCode's extension API
		// This ensures we get the bundled extension, not the test's compiled version
		// For development extensions without a publisher, the ID is just the name
		const allExtensions = vscode.extensions.all;
		const ext = allExtensions.find(e => e.id.includes('lilypond-studio'));
		if (!ext) {
			const ids = allExtensions.map(e => e.id).join(', ');
			throw new Error(`Extension not found. Available: ${ids}`);
		}
		// Ensure the extension is activated
		if (!ext.isActive) {
			await ext.activate();
		}
		const extensionExports = ext.exports;

		// Set up the VersionManager with a mock command runner
		// This must use the VersionManager from the bundled extension
		const versionManager = extensionExports.VersionManager.getInstance();
		versionManager.setCommandRunnerForTesting(async (_command: string, args: string[]) => {
			// Return mock output for lilypond --version
			if (args.includes('--version')) {
				return 'GNU LilyPond 2.24.0 (running Guile 2.2)\n';
			}
			throw new Error(`Unexpected command: ${args.join(' ')}`);
		});

		// Now configure the extension to use our mock LilyPond path
		// This triggers the onDidChangeConfiguration listener which will:
		// 1. Call detectVersion (now using our mock)
		// 2. Call loadCompletions (loading from our fixture)
		const config = vscode.workspace.getConfiguration('lilypondStudio');
		await config.update('executablePath', mockLilypondPath, vscode.ConfigurationTarget.Global);

		// Wait for the extension to finish initializing
		await extensionExports.extensionReady;
	});

	suiteTeardown(async () => {
		// Close any open editors first
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		// Reset configuration
		const config = vscode.workspace.getConfiguration('lilypondStudio');
		await config.update('executablePath', undefined, vscode.ConfigurationTarget.Global);

		// Reset VersionManager (get from bundled extension via VSCode API)
		const ext = vscode.extensions.getExtension('undefined_publisher.lilypond-studio');
		if (ext?.exports?.VersionManager) {
			ext.exports.VersionManager.resetInstance();
		}
	});

	test('provides completions for backslash commands', async () => {
		const document = await createScratchDocument('\\');

		// Trigger completion at the end of the backslash
		const position = new vscode.Position(0, 1);
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			document.uri,
			position
		);

		assert.ok(completions, 'Completions should be provided');
		assert.ok(completions.items.length > 0, 'Should have at least one completion item');

		// Check that some expected LilyPond commands are present
		const labels = completions.items.map(item =>
			typeof item.label === 'string' ? item.label : item.label.label
		);

		// These should exist from our mock lilypond-words file
		const hasBackslashCommands = labels.some(label => label.startsWith('\\'));
		assert.ok(hasBackslashCommands, 'Should have backslash commands in completions');
	});

	test('provides completions when typing partial command', async () => {
		const document = await createScratchDocument('\\rel');

		// Trigger completion at the end
		const position = new vscode.Position(0, 4);
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			document.uri,
			position
		);

		assert.ok(completions, 'Completions should be provided');
		assert.ok(completions.items.length > 0, 'Should have completion items');

		const labels = completions.items.map(item =>
			typeof item.label === 'string' ? item.label : item.label.label
		);

		// \relative should be in the completions from our mock file
		assert.ok(
			labels.some(label => label === '\\relative'),
			'Should include \\relative in completions'
		);
	});

	test('version completion includes version number snippet', async () => {
		const document = await createScratchDocument('\\ver');

		// Trigger completion
		const position = new vscode.Position(0, 4);
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			document.uri,
			position
		);

		assert.ok(completions, 'Completions should be provided');

		// Find the \version completion
		const versionCompletion = completions.items.find(item => {
			const label = typeof item.label === 'string' ? item.label : item.label.label;
			return label === '\\version';
		});

		assert.ok(versionCompletion, 'Should have \\version completion');

		// Check that it's a snippet type
		assert.strictEqual(
			versionCompletion!.kind,
			vscode.CompletionItemKind.Snippet,
			'\\version should be a Snippet kind'
		);

		// Check that it has the special detail
		assert.strictEqual(
			versionCompletion!.detail,
			'LilyPond version directive',
			'\\version should have special detail text'
		);
	});

	test('completions include non-backslash words', async () => {
		const document = await createScratchDocument('maj');

		// Trigger completion at the end
		const position = new vscode.Position(0, 3);
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			document.uri,
			position
		);

		assert.ok(completions, 'Completions should be provided');

		const labels = completions.items.map(item =>
			typeof item.label === 'string' ? item.label : item.label.label
		);

		// 'major' should be in the completions from our mock file
		assert.ok(
			labels.some(label => label === 'major'),
			'Should include "major" in completions'
		);
	});

	test('completion replaces correct range with backslash', async () => {
		const document = await setDocumentContent('c4 \\rel');

		// Trigger completion at the end
		const position = new vscode.Position(0, 7);
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			document.uri,
			position
		);

		assert.ok(completions, 'Completions should be provided');
		assert.ok(completions.items.length > 0, 'Should have completion items');

		// Find \relative completion and check its range
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
