import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PdfViewerPanel } from './pdfViewer';
import { PdfCustomEditorProvider } from './pdfCustomEditor';
import { VersionManager } from './versionManager';
import { ConvertLyCodeActionProvider, registerConvertLyCommand } from './convertLyCodeAction';
import { registerVersionDiagnostics } from './versionDiagnostics';
import { registerCompletionProvider } from './completionProvider';

/** Promise that resolves when extension initialization is complete */
export let extensionReady: Promise<void>;

/** Re-export VersionManager for testing access to the bundled singleton */
export { VersionManager };

export function activate(context: vscode.ExtensionContext): { extensionReady: Promise<void>; VersionManager: typeof VersionManager } {
	// Initialize version manager and detect LilyPond version
	const versionManager = VersionManager.getInstance();
	const diagnosticsProvider = registerVersionDiagnostics(context);
	const completionProvider = registerCompletionProvider(context);

	extensionReady = initializeVersion(versionManager, diagnosticsProvider, completionProvider);

	// Listen for configuration changes
	const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('lilypondStudio.executablePath')) {
			extensionReady = initializeVersion(versionManager, diagnosticsProvider, completionProvider);
		}
	});
	context.subscriptions.push(configChangeListener);

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
	return { extensionReady, VersionManager };
}

function createLilypondTask(mode: 'preview' | 'publish'): vscode.Task {
	const config = vscode.workspace.getConfiguration('lilypondStudio');
	const lilypondPath = config.get<string>('executablePath') || 'lilypond';
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

async function initializeVersion(versionManager: VersionManager, diagnosticsProvider?: any, completionProvider?: any): Promise<void> {
	const config = vscode.workspace.getConfiguration('lilypondStudio');
	const lilypondPath = config.get<string>('executablePath') || 'lilypond';

	try {
		await versionManager.detectVersion(lilypondPath);
		// Update diagnostics after version is detected
		if (diagnosticsProvider) {
			diagnosticsProvider.updateAllDiagnostics();
		}
		// Load completions after version is detected
		if (completionProvider) {
			await completionProvider.loadCompletions();
		}
	} catch (error) {
		console.error('Failed to detect LilyPond version:', error);
	}
}

export function deactivate() { }
