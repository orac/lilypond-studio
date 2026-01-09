import * as vscode from 'vscode';
import * as path from 'path';
import { PdfViewerPanel } from './pdfViewer';

export function activate(context: vscode.ExtensionContext) {
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
				const filePath = editor.document.uri.fsPath;
				const fileDir = path.dirname(filePath);
				const fileName = path.basename(filePath, '.ly');
				const pdfPath = path.join(fileDir, `${fileName}.pdf`);

				await openPdfPreview(pdfPath, context, editor.document.uri);
			}
		}
	});

	context.subscriptions.push(taskEndListener);

	const textEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor && editor.document.languageId === 'lilypond') {
			vscode.commands.executeCommand('setContext', 'lilypondFileOpen', true);
		} else {
			vscode.commands.executeCommand('setContext', 'lilypondFileOpen', false);
		}
	});

	context.subscriptions.push(textEditorChangeListener);

	if (vscode.window.activeTextEditor?.document.languageId === 'lilypond') {
		vscode.commands.executeCommand('setContext', 'lilypondFileOpen', true);
	}
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

async function openPdfPreview(pdfPath: string, context: vscode.ExtensionContext, sourceUri?: vscode.Uri) {
	const pdfUri = vscode.Uri.file(pdfPath);
	PdfViewerPanel.createOrShow(context.extensionUri, pdfUri, sourceUri);
}

export function deactivate() { }
