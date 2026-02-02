import * as vscode from 'vscode';
import { LilyPondInstallation, parseFileVersion, compareVersions } from './LilyPondInstallation';

/**
 * Provides code actions for upgrading LilyPond files using convert-ly
 */
export class ConvertLyCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public async provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Promise<vscode.CodeAction[] | undefined> {
		// Only provide actions for LilyPond files
		if (document.languageId !== 'lilypond') {
			return undefined;
		}

		// Get installation on demand - may be null if not ready
		const installation = await LilyPondInstallation.ensureInitialized();
		if (!installation) {
			return undefined;
		}

		const fileVersion = parseFileVersion(document);
		const lilypondVersion = installation.getVersion();

		// Only offer the action if:
		// 1. We successfully detected the LilyPond version
		// 2. The file has a \version directive
		// 3. The file version is less than the LilyPond version
		if (!lilypondVersion || !fileVersion) {
			return undefined;
		}

		if (compareVersions(fileVersion, lilypondVersion) < 0) {
			const action = this.createUpgradeAction(document, fileVersion, lilypondVersion);
			return [action];
		}

		return undefined;
	}

	private createUpgradeAction(
		document: vscode.TextDocument,
		fileVersion: string,
		lilypondVersion: string
	): vscode.CodeAction {
		const action = new vscode.CodeAction(
			`Upgrade from version ${fileVersion} to ${lilypondVersion} using convert-ly`,
			vscode.CodeActionKind.QuickFix
		);

		action.command = {
			command: 'lilypondStudio.runConvertLy',
			title: 'Run convert-ly',
			arguments: [document.uri]
		};

		action.isPreferred = false;

		return action;
	}
}

/**
 * Registers the convert-ly command
 */
export function registerConvertLyCommand(context: vscode.ExtensionContext): void {
	// Create output channel for convert-ly
	const outputChannel = vscode.window.createOutputChannel('LilyPond convert-ly');
	context.subscriptions.push(outputChannel);

	const command = vscode.commands.registerCommand(
		'lilypondStudio.runConvertLy',
		async (uri: vscode.Uri) => {
			const installation = await LilyPondInstallation.ensureInitialized();

			if (!installation) {
				vscode.window.showErrorMessage(
					'Can\'t run convert-ly without a configured LilyPond path.'
				);
				return;
			}

			// Clear and show the output channel
			outputChannel.clear();
			outputChannel.show(true); // true = preserveFocus

			try {
				// Show progress notification
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: 'Running convert-ly...',
						cancellable: false
					},
					async (progress) => {
						await installation.runConvertLy(uri.fsPath, outputChannel);
					}
				);

				// Show success message
				vscode.window.showInformationMessage(
					`Successfully upgraded ${uri.fsPath} using convert-ly`
				);

				// Reload the document to show the changes
				const document = await vscode.workspace.openTextDocument(uri);
				const editor = vscode.window.visibleTextEditors.find(
					e => e.document.uri.toString() === uri.toString()
				);
				if (editor) {
					// Trigger a reload by closing and reopening
					await vscode.commands.executeCommand('workbench.action.files.revert');
				}
			} catch (error) {
				outputChannel.appendLine('');
				outputChannel.appendLine(`Error: ${error}`);
				vscode.window.showErrorMessage(
					`Failed to run convert-ly: ${error}`
				);
			}
		}
	);

	context.subscriptions.push(command);
}
