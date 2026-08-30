import * as vscode from 'vscode';

/**
 * Command id the language server points its post-refactor rename follow-up at.
 *
 * Must match `RENAME_COMMAND` in `ly-lsp/src/code_action/mod.rs`.
 */
export const RENAME_COMMAND = 'lilypondStudio.renameSymbol';

interface RenamePosition {
	line: number;
	character: number;
}

/**
 * Registers {@link RENAME_COMMAND}, the follow-up the server attaches to a
 * refactoring that introduces a name it wants the user to fill in — extract to
 * variable inserts a `music` placeholder and then asks for this.
 *
 * The server can't invoke `editor.action.rename` with a target itself: that
 * command wants a live {@link vscode.Uri}, and a code-action command argument
 * arriving over LSP is only ever plain JSON. So the server sends the document
 * URI and the position of the fresh name here, and this rebuilds the objects
 * VS Code's rename action needs.
 */
export function registerRenameCommand(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			RENAME_COMMAND,
			(uri: string, position: RenamePosition) =>
				vscode.commands.executeCommand('editor.action.rename', [
					vscode.Uri.parse(uri),
					new vscode.Position(position.line, position.character),
				]),
		),
	);
}
