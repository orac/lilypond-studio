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

			this.completionItems = lines
				.map(line => line.trim())
				.filter(line => line.length > 0)
				.map(word => {
					// Un-escape doubled backslashes: \\ -> \
					const unescaped = word.replace(/\\\\/g, '\\');

					const item = new vscode.CompletionItem(
						unescaped,
						vscode.CompletionItemKind.Keyword
					);

					// Set the text to insert (without the leading backslash if user already typed it)
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
		return this.completionItems;
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
