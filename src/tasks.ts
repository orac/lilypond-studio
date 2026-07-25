import * as vscode from 'vscode';
import * as path from 'path';
import { LilyPondInstallation } from './LilyPondInstallation';

function createLilypondTask(mode: 'preview' | 'publish', uri?: vscode.Uri): vscode.Task {
	const installation = LilyPondInstallation.getInstance();
	const lilypondPath = installation?.getExecutablePath() ??
		vscode.workspace.getConfiguration('lilypondStudio').get<string>('executablePath') ??
		'lilypond';

	const config = vscode.workspace.getConfiguration('lilypondStudio');
	const includeDirs = config.get<string[]>('includeDirs') || [];

	const resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;
	const filePath = resolvedUri?.fsPath ?? '*.ly';
	const fileDir = resolvedUri ? path.dirname(resolvedUri.fsPath) : undefined;

	const args: string[] = [];
	includeDirs.forEach(dir => args.push(`--include=${dir}`));
	if (mode === 'publish') {
		args.push('-dno-point-and-click');
	}
	args.push(filePath);

	const execution = new vscode.ProcessExecution(lilypondPath, args, { cwd: fileDir });
	const taskName = mode === 'preview' ? 'Engrave (preview)' : 'Engrave (publish)';

	const task = new vscode.Task(
		{ type: 'lilypond', mode },
		vscode.TaskScope.Workspace,
		taskName,
		'lilypond',
		execution,
		['$lilypond', '$lilypond-no-column']
	);
	task.group = vscode.TaskGroup.Build;
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Silent,
		panel: vscode.TaskPanelKind.Dedicated,
		clear: true,
		showReuseMessage: false,
		echo: true,
		focus: false,
	};
	return task;
}

export function registerTaskProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.tasks.registerTaskProvider('lilypond', {
			provideTasks: () => {
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.languageId === 'lilypond') {
					return [
						createLilypondTask('preview'),
						createLilypondTask('publish'),
					];
				}
				return [];
			},
			resolveTask: () => undefined,
		})
	);
}

export function registerEngraveOnSave(context: vscode.ExtensionContext): void {
	let enabled = false;
	let lastMode: 'preview' | 'publish' | undefined;
	let saveListener: vscode.Disposable | undefined;
	let runningExecution: vscode.TaskExecution | undefined;
	let pendingUri: vscode.Uri | undefined;

	const statusItem = vscode.languages.createLanguageStatusItem(
		'lilypondStudio.engraveOnSave',
		{ language: 'lilypond' }
	);
	statusItem.name = 'Engrave on Save';
	statusItem.command = {
		title: 'Toggle Engrave on Save',
		command: 'lilypondStudio.toggleEngraveOnSave',
	};
	context.subscriptions.push(statusItem);
	context.subscriptions.push({ dispose: () => saveListener?.dispose() });

	function updateStatusItem(): void {
		if (!enabled) {
			statusItem.text = '$(circle-slash) Engrave on save';
			statusItem.detail = 'off';
			statusItem.command!.title = 'Turn on';
			return;
		}
		statusItem.command!.title = 'Turn off';
		if (lastMode) {
			statusItem.text = '$(sync) Engrave on save';
			statusItem.detail = 'on';
		} else {
			// Engrave-on-save re-runs whichever task (preview/publish) was last run
			// manually, so it has nothing to do until that's happened once.
			statusItem.text = '$(sync) Run a build task to start engrave-on-save';
			statusItem.detail = 'on';
		}
	}

	function hasErrors(uri: vscode.Uri): boolean {
		return vscode.languages.getDiagnostics(uri).some(d => d.severity === vscode.DiagnosticSeverity.Error);
	}

	async function runEngrave(uri: vscode.Uri): Promise<void> {
		// lastMode is narrowed by the caller before this is reached.
		runningExecution = await vscode.tasks.executeTask(createLilypondTask(lastMode!, uri));
	}

	function updateSaveListener(): void {
		saveListener?.dispose();
		saveListener = undefined;
		pendingUri = undefined;
		// Do nothing until a build task has been run manually this session: we only
		// re-engrave once `lastMode` tells us which options the user actually wants,
		// so we never overwrite an existing PDF with one built using the wrong mode.
		if (!enabled || !lastMode) {return;}
		saveListener = vscode.workspace.onDidSaveTextDocument(async doc => {
			if (doc.languageId !== 'lilypond') {return;}
			// Building a file with errors just reproduces a diagnostic VS Code already
			// shows inline, so skip it rather than clobbering the last good PDF.
			if (hasErrors(doc.uri)) {return;}
			// A save while our own engrave task is still running would otherwise launch
			// a second task of the same kind, which VS Code resolves by prompting the
			// user to pick which one to terminate. Instead, remember the latest save and
			// let onDidEndTask kick off exactly one re-run once the running job finishes.
			if (runningExecution) {
				pendingUri = doc.uri;
				return;
			}
			await runEngrave(doc.uri);
		});
	}

	context.subscriptions.push(
		vscode.tasks.onDidStartTask(e => {
			const def = e.execution.task.definition;
			if (def.type === 'lilypond' && (def.mode === 'preview' || def.mode === 'publish')) {
				lastMode = def.mode;
				updateStatusItem();
				updateSaveListener();
			}
			if (def.type === 'lilypond') {
				statusItem.busy = true;
			}
		})
	);
	context.subscriptions.push(
		vscode.tasks.onDidEndTask(e => {
			if (e.execution.task.definition.type === 'lilypond') {
				statusItem.busy = false;
			}
			if (e.execution === runningExecution) {
				runningExecution = undefined;
				if (pendingUri) {
					const uri = pendingUri;
					pendingUri = undefined;
					if (!hasErrors(uri)) {
						void runEngrave(uri);
					}
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('lilypondStudio.toggleEngraveOnSave', async () => {
			const cfg = vscode.workspace.getConfiguration('lilypondStudio');
			const next = !(cfg.get<boolean>('engraveOnSave') ?? false);
			const target = vscode.workspace.workspaceFolders
				? vscode.ConfigurationTarget.Workspace
				: vscode.ConfigurationTarget.Global;
			await cfg.update('engraveOnSave', next, target);
			enabled = next;
			updateStatusItem();
			updateSaveListener();
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('lilypondStudio.engraveOnSave')) {
				enabled = vscode.workspace.getConfiguration('lilypondStudio').get<boolean>('engraveOnSave') ?? false;
				updateStatusItem();
				updateSaveListener();
			}
		})
	);

	enabled = vscode.workspace.getConfiguration('lilypondStudio').get<boolean>('engraveOnSave') ?? false;
	updateStatusItem();
	updateSaveListener();
}
