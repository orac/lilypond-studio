import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	console.log('LilyPond Studio extension is now active!');

	const taskProvider = vscode.tasks.registerTaskProvider('lilypond', {
		provideTasks: () => {
			return [
				createLilypondTask('preview'),
				createLilypondTask('publish')
			];
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

				await openPdfPreview(pdfPath);
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

function createLilypondTask(taskType: 'preview' | 'publish'): vscode.Task {
	const config = vscode.workspace.getConfiguration('lilypondStudio');
	const lilypondPath = config.get<string>('executablePath') || 'lilypond';

	const editor = vscode.window.activeTextEditor;
	const filePath = editor?.document.uri.fsPath || '${file}';

	const args = taskType === 'publish'
		? ['-dno-point-and-click', filePath]
		: [filePath];

	const execution = new vscode.ShellExecution(lilypondPath, args);

	const taskName = taskType === 'preview'
		? 'Engrave (preview)'
		: 'Engrave (publish)';

	const task = new vscode.Task(
		{ type: 'lilypond', taskType },
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
		clear: true
	};

	return task;
}

async function openPdfPreview(pdfPath: string) {
	const uri = vscode.Uri.file(pdfPath);
	await vscode.commands.executeCommand('vscode.open', uri, {
		viewColumn: vscode.ViewColumn.Beside,
		preserveFocus: false
	});
}

export function deactivate() {}
