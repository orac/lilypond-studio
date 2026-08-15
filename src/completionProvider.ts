import * as vscode from 'vscode';
import { LilyPondInstallation } from './LilyPondInstallation';
import { LilyPondLanguageClient } from './languageClient';
import { log } from './log';

/**
 * Provides autocomplete suggestions for LilyPond commands, for as long as
 * there's no language server to do it better.
 *
 * The server knows the whole vocabulary too — and, unlike the keyword list
 * read from `lilypond-words`, knows which commands are in scope where, what
 * arguments each takes, and where each was defined. So whenever it's running,
 * its answer is the whole answer, and the keyword list isn't even read. The
 * list survives for the case the server can't cover: no bundled binary for
 * this platform, or a build that failed to start.
 */
export class LilyPondCompletionProvider implements vscode.CompletionItemProvider {
	/** The keyword list, or `undefined` until something asks for it. */
	private completionItems: vscode.CompletionItem[] | undefined;

	constructor(private readonly languageClient: LilyPondLanguageClient) {}

	/**
	 * Loads completions from the lilypond-words file, unless they're already
	 * loaded. Lazy, so that the file is never read at all in the usual case
	 * where the server is running and owns the vocabulary.
	 */
	private async ensureCompletions(): Promise<void> {
		if (this.completionItems) {
			return;
		}

		const installation = LilyPondInstallation.getInstance();
		if (!installation) {
			// Not ready yet - will be called again on the next request
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

			log.info(`Loaded ${this.completionItems.length} completions from lilypond-words`);
		} catch (error) {
			// Don't show error to user - LilyPondInstallation handles that
			log.error('Error loading LilyPond completions', error);
		}
	}

	/**
	 * Forgets the keyword list, so the next request that needs it reads it
	 * afresh. Called whenever the LilyPond installation changes or goes away:
	 * the words of one version aren't the words of another.
	 */
	public clearCompletions(): void {
		this.completionItems = undefined;
	}

	/**
	 * Provides completion items: the server's, whenever the server is up,
	 * otherwise the keyword-list fallback.
	 */
	public async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		_context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[]> {
		const serverItems = await this.languageClient.requestCompletions(document, position, token);
		if (this.languageClient.isRunning()) {
			// Empty included: the server saying "nothing here" is an answer, and
			// answering it with the whole keyword list would undo the point of
			// asking something that knows what's in scope.
			return serverItems;
		}

		await this.ensureCompletions();
		if (!this.completionItems) {
			return [];
		}

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
export function registerCompletionProvider(
	context: vscode.ExtensionContext,
	languageClient: LilyPondLanguageClient
): LilyPondCompletionProvider {
	const provider = new LilyPondCompletionProvider(languageClient);

	const completionProvider = vscode.languages.registerCompletionItemProvider(
		{ language: 'lilypond' },
		provider,
		'\\' // Trigger completion when backslash is typed
	);

	context.subscriptions.push(completionProvider);

	return provider;
}
