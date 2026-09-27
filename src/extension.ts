import * as vscode from 'vscode';
import { PdfCustomEditorProvider, showPdfPreviewFor } from './pdfCustomEditor';
import { LilyPondInstallation } from './LilyPondInstallation';
import { ConvertLyCodeActionProvider, registerConvertLyCommand } from './convertLyCodeAction';
import { registerVersionDiagnostics } from './versionDiagnostics';
import { registerCompletionProvider } from './completionProvider';
import { registerFormatter } from './formatter';
import { registerRenameCommand } from './renameCommand';
import { LilyPondLanguageClient } from './languageClient';
import { registerTaskProvider, registerEngraveOnSave } from './tasks';
import { registerDiagnosticsCommand } from './diagnosticsCommand';
import { registerTerminalEnvironment } from './terminalEnvironment';
import { log } from './log';

let languageClient: LilyPondLanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): { LilyPondInstallation: typeof LilyPondInstallation; languageClient: LilyPondLanguageClient } {
	context.subscriptions.push(log);
	log.info(`LilyPond Studio ${context.extension.packageJSON.version} activating on ${process.platform} ${process.arch}, VS Code ${vscode.version}`);
	registerDiagnosticsCommand(context, () => languageClient);
	registerTerminalEnvironment(context);

	// Register providers (they work without LilyPondInstallation, just with limited functionality)
	const diagnosticsProvider = registerVersionDiagnostics(context);
	languageClient = new LilyPondLanguageClient(context);
	const completionProvider = registerCompletionProvider(context, languageClient);
	registerFormatter(context);

	// Brings the language server up when a .ly file is open. On a successful
	// detection, onDidBecomeReady starts it with the words path in hand, so we
	// only start it here when detection failed — navigation and syntax
	// diagnostics don't need a LilyPond installation.
	const startLanguageServer = async () => {
		const installation = await LilyPondInstallation.ensureInitialized();
		if (!installation) {
			await languageClient!.start();
		}
	};

	// Subscribe to LilyPondInstallation events
	context.subscriptions.push(
		LilyPondInstallation.onDidBecomeReady(async () => {
			// Update components when installation becomes ready
			diagnosticsProvider.updateAllDiagnostics();
			// The keyword list, if it's ever needed, must come from the version
			// just detected rather than the one before it.
			completionProvider.clearCompletions();
			// Start (first detection) or restart (re-detection) the server so it
			// picks up the freshly-detected words path.
			await languageClient!.refresh();
		})
	);

	context.subscriptions.push(
		LilyPondInstallation.onDidInvalidate(() => {
			// Clear completions when installation is invalidated
			completionProvider.clearCompletions();
		})
	);

	// Lazy initialization: trigger when first .ly file is opened
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(document => {
			if (document.languageId === 'lilypond') {
				startLanguageServer();
			}
		})
	);

	// Check if a .ly file is already open (e.g., on extension reload)
	if (vscode.workspace.textDocuments.some(doc => doc.languageId === 'lilypond')) {
		startLanguageServer();
	}

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('lilypondStudio.executablePath')) {
				// Re-detection fires onDidBecomeReady, which restarts the server.
				LilyPondInstallation.invalidate();
			}
			if (e.affectsConfiguration('lilypondStudio.includeDirs') ||
				e.affectsConfiguration('lilypondStudio.languageServerPath')) {
				// Server picks up the new -I paths (or new binary) on restart.
				languageClient!.restart();
			}
		})
	);

	// Dispose LilyPondInstallation events when extension deactivates
	context.subscriptions.push({
		dispose: () => LilyPondInstallation.disposeEvents()
	});

	// Follow-up rename the language server asks for after extract-to-variable.
	registerRenameCommand(context);

	// Register convert-ly command and code action provider
	registerConvertLyCommand(context);
	const convertLyProvider = vscode.languages.registerCodeActionsProvider(
		{ language: 'lilypond', scheme: 'file' },
		new ConvertLyCodeActionProvider(),
		{
			providedCodeActionKinds: ConvertLyCodeActionProvider.providedCodeActionKinds
		}
	);
	context.subscriptions.push(convertLyProvider);

	// Register custom PDF editor
	context.subscriptions.push(PdfCustomEditorProvider.register(context));

	registerTaskProvider(context);
	registerEngraveOnSave(context);

	context.subscriptions.push(vscode.tasks.onDidEndTask(async (e) => {
		const editor = vscode.window.activeTextEditor;
		if (e.execution.task.definition.type === 'lilypond' && editor?.document.languageId === 'lilypond') {
			await showPdfPreviewFor(editor);
		}
	}));

	const onActiveEditorChanged = async (editor: vscode.TextEditor | undefined) => {
		const isLilyPond = editor?.document.languageId === 'lilypond';
		vscode.commands.executeCommand('setContext', 'lilypondFileOpen', isLilyPond);
		if (isLilyPond) {
			await showPdfPreviewFor(editor);
		}
	};
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onActiveEditorChanged));
	onActiveEditorChanged(vscode.window.activeTextEditor);

	// Return exports for testing access
	return { LilyPondInstallation, languageClient };
}

export function deactivate(): Thenable<void> | undefined {
	const client = languageClient;
	languageClient = undefined;
	return client?.dispose();
}
