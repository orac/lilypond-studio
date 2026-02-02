import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PdfViewerPanel } from './pdfViewer';
import { PdfCustomEditorProvider } from './pdfCustomEditor';
import { LilyPondInstallation } from './LilyPondInstallation';
import { ConvertLyCodeActionProvider, registerConvertLyCommand } from './convertLyCodeAction';
import { registerVersionDiagnostics } from './versionDiagnostics';
import { registerCompletionProvider } from './completionProvider';


export function activate(context: vscode.ExtensionContext): { LilyPondInstallation: typeof LilyPondInstallation } {
	// Register providers (they work without LilyPondInstallation, just with limited functionality)
	const diagnosticsProvider = registerVersionDiagnostics(context);
	const completionProvider = registerCompletionProvider(context);

	// Subscribe to LilyPondInstallation events
	context.subscriptions.push(
		LilyPondInstallation.onDidBecomeReady(async () => {
			// Update components when installation becomes ready
			diagnosticsProvider.updateAllDiagnostics();
			await completionProvider.loadCompletions();
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
				LilyPondInstallation.ensureInitialized();
			}
		})
	);

	// Check if a .ly file is already open (e.g., on extension reload)
	if (vscode.workspace.textDocuments.some(doc => doc.languageId === 'lilypond')) {
		LilyPondInstallation.ensureInitialized();
	}

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('lilypondStudio.executablePath')) {
				LilyPondInstallation.invalidate();
			}
		})
	);

	// Dispose LilyPondInstallation events when extension deactivates
	context.subscriptions.push({
		dispose: () => LilyPondInstallation.disposeEvents()
	});

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

	const taskProvider = vscode.tasks.registerTaskProvider('lilypond', {
		provideTasks: () => {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'lilypond') {
				return [
					createLilypondTask('preview'),
					createLilypondTask('publish')
				];
			}
			return [];
		},
		resolveTask: () => {
			return undefined;
		}
	});

	context.subscriptions.push(taskProvider);

	const taskEndListener = vscode.tasks.onDidEndTask(async (e) => {
		if (e.execution.task.definition.type === 'lilypond') {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'lilypond') {
				await checkAndOpenCorrespondingPdf(editor, context);
			}
		}
	});

	context.subscriptions.push(taskEndListener);

	const textEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
		if (editor && editor.document.languageId === 'lilypond') {
			vscode.commands.executeCommand('setContext', 'lilypondFileOpen', true);
			await checkAndOpenCorrespondingPdf(editor, context);
		} else {
			vscode.commands.executeCommand('setContext', 'lilypondFileOpen', false);
		}
	});

	context.subscriptions.push(textEditorChangeListener);

	if (vscode.window.activeTextEditor?.document.languageId === 'lilypond') {
		vscode.commands.executeCommand('setContext', 'lilypondFileOpen', true);
		checkAndOpenCorrespondingPdf(vscode.window.activeTextEditor, context);
	}

	// Return exports for testing access
	return { LilyPondInstallation };
}

function createLilypondTask(mode: 'preview' | 'publish'): vscode.Task {
	// Get path from installation if available, otherwise fall back to config
	const installation = LilyPondInstallation.getInstance();
	const lilypondPath = installation?.getExecutablePath() ??
		vscode.workspace.getConfiguration('lilypondStudio').get<string>('executablePath') ??
		'lilypond';

	const config = vscode.workspace.getConfiguration('lilypondStudio');
	const includeDirs = config.get<string[]>('includeDirs') || [];

	const editor = vscode.window.activeTextEditor;
	const filePath = editor?.document.uri.fsPath || '*.ly';
	const fileDir = editor ? path.dirname(editor.document.uri.fsPath) : undefined;

	const args: string[] = [];

	includeDirs.forEach(dir => {
		args.push(`--include=${dir}`);
	});

	if (mode === 'publish') {
		args.push('-dno-point-and-click');
	}

	args.push(filePath);

	const execution = new vscode.ProcessExecution(lilypondPath, args, {
		cwd: fileDir
	});

	const taskName = mode === 'preview'
		? 'Engrave (preview)'
		: 'Engrave (publish)';

	const task = new vscode.Task(
		{ type: 'lilypond', mode },
		vscode.TaskScope.Workspace,
		taskName,
		'lilypond',
		execution,
		'$lilypond'
	);

	task.group = vscode.TaskGroup.Build;
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		panel: vscode.TaskPanelKind.Dedicated,
		clear: true,
		showReuseMessage: false,
		echo: true,
		focus: false,
	};

	return task;
}

async function checkAndOpenCorrespondingPdf(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
	const filePath = editor.document.uri.fsPath;
	const pdfPath = filePath.replace(/\.ly$/, '.pdf');

	if (fs.existsSync(pdfPath)) {
		await openPdfPreview(pdfPath, context, editor.document.uri);
	}
}

async function openPdfPreview(pdfPath: string, context: vscode.ExtensionContext, sourceUri?: vscode.Uri) {
	const pdfUri = vscode.Uri.file(pdfPath);
	PdfViewerPanel.createOrShow(context.extensionUri, pdfUri, sourceUri);
}

export function deactivate() { }
