import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { VersionManager } from './versionManager';

/**
 * Provides autocomplete suggestions for LilyPond commands
 */
export class LilyPondCompletionProvider implements vscode.CompletionItemProvider {
	private completionItems: vscode.CompletionItem[] = [];
	private versionManager: VersionManager;

	constructor() {
		this.versionManager = VersionManager.getInstance();
	}

	/**
	 * Loads completions from the lilypond-words file
	 */
	public async loadCompletions(): Promise<void> {
		try {
			const wordsFilePath = this.getWordsFilePath();
			if (!wordsFilePath) {
				console.log('Could not determine lilypond-words file path');
				return;
			}

			if (!fs.existsSync(wordsFilePath)) {
				console.log(`lilypond-words file not found at: ${wordsFilePath}`);
				return;
			}

			const content = fs.readFileSync(wordsFilePath, 'utf-8');
			const lines = content.split(/\r?\n/);

			const version = this.versionManager.getVersion();

			this.completionItems = lines
				.map(line => line.trim())
				.filter(line => line.length > 0)
				.map(word => {
					// Un-escape doubled backslashes: \\ -> \
					const unescaped = word.replace(/\\\\/g, '\\');

					// Special case for \version - insert snippet with detected version
					if (unescaped === '\\version' && version) {
						const item = new vscode.CompletionItem(
							'\\version',
							vscode.CompletionItemKind.Snippet
						);

						// Use a snippet to insert \version "x.y.z"
						item.insertText = new vscode.SnippetString(`\\version "\${1:${version}}"`);
						item.detail = 'LilyPond version directive';
						item.documentation = new vscode.MarkdownString(
							`Insert version directive with current LilyPond version (${version})`
						);

						return item;
					}

					const item = new vscode.CompletionItem(
						unescaped,
						vscode.CompletionItemKind.Keyword
					);

					item.insertText = unescaped;

					// Add detail to show this is a LilyPond command
					if (unescaped.startsWith('\\')) {
						item.detail = 'LilyPond command';
					}

					return item;
				});

			console.log(`Loaded ${this.completionItems.length} completions from lilypond-words`);
		} catch (error) {
			console.error('Error loading LilyPond completions:', error);
		}
	}

	/**
	 * Determines the path to the lilypond-words file
	 */
	private getWordsFilePath(): string | null {
		const version = this.versionManager.getVersion();
		if (!version) {
			return null;
		}

		// Get the LilyPond executable path to determine the installation directory
		const config = vscode.workspace.getConfiguration('lilypondStudio');
		const lilypondPath = config.get<string>('executablePath') || 'lilypond';

		// LilyPond executable is typically at: <install-dir>/bin/lilypond.exe
		// Words file is at: <install-dir>/share/lilypond/<version>/vim/syntax/lilypond-words
		const binDir = path.dirname(lilypondPath);
		const installDir = path.dirname(binDir);
		const wordsFilePath = path.join(
			installDir,
			'share',
			'lilypond',
			version,
			'vim',
			'syntax',
			'lilypond-words'
		);

		return wordsFilePath;
	}

	/**
	 * Provides completion items
	 */
	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): vscode.CompletionItem[] {
		// Determine the range to replace
		const lineText = document.lineAt(position.line).text;

		// Find the start of the word (including backslash if present)
		let wordStart = position.character;
		for (let i = position.character - 1; i >= 0; i--) {
			const char = lineText[i];
			if (char === '\\' || /[a-zA-Z]/.test(char)) {
				wordStart = i;
			} else {
				break;
			}
		}

		const range = new vscode.Range(
			position.line,
			wordStart,
			position.line,
			position.character
		);

		// Clone completion items with the appropriate range
		return this.completionItems.map(item => {
			const newItem = new vscode.CompletionItem(item.label, item.kind);
			newItem.insertText = item.insertText;
			newItem.detail = item.detail;
			newItem.documentation = item.documentation;
			newItem.range = range;
			return newItem;
		});
	}
}

/**
 * Registers the LilyPond completion provider
 */
export function registerCompletionProvider(context: vscode.ExtensionContext): LilyPondCompletionProvider {
	const provider = new LilyPondCompletionProvider();

	const completionProvider = vscode.languages.registerCompletionItemProvider(
		{ language: 'lilypond' },
		provider,
		'\\' // Trigger completion when backslash is typed
	);

	context.subscriptions.push(completionProvider);

	return provider;
}
