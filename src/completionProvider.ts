import * as vscode from 'vscode';
import { LilyPondInstallation } from './LilyPondInstallation';

/**
 * Provides autocomplete suggestions for LilyPond commands
 */
export class LilyPondCompletionProvider implements vscode.CompletionItemProvider {
	private completionItems: vscode.CompletionItem[] = [];

	/**
	 * Loads completions from the lilypond-words file.
	 * Called when LilyPondInstallation becomes ready.
	 */
	public async loadCompletions(): Promise<void> {
		const installation = LilyPondInstallation.getInstance();
		if (!installation) {
			// Not ready yet - will be called again when ready
			return;
		}

		try {
			const words = await installation.readWordsFile();
			const version = installation.getVersion();
			this.completionItems = [];

			for await (const word of words) {
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

					this.completionItems.push(item);
					continue;
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

				this.completionItems.push(item);
			}

			console.log(`Loaded ${this.completionItems.length} completions from lilypond-words`);
		} catch (error) {
			// Don't show error to user - LilyPondInstallation handles that
			console.error('Error loading LilyPond completions:', error);
		}
	}

	/**
	 * Clears all completions.
	 * Called when LilyPondInstallation is invalidated.
	 */
	public clearCompletions(): void {
		this.completionItems = [];
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
