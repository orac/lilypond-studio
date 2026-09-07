import * as vscode from 'vscode';
import * as path from 'path';
import { LilyPondInstallation } from './LilyPondInstallation';
import { LilyPondTaskDefinition, resolveInputFile, resolveTaskOptions, variableContextFor, workspaceVariableContext } from './taskDefinition';
import { ensureOutputDirectory } from './outputPaths';
import { PdfViewerPanel } from './pdfViewer';
import { log } from './log';

/** Builds the task that engraves `uri`.
 *
 * `definition` becomes the task's definition verbatim, so that VS Code can match a task in `tasks.json` to the task we resolve for it; anything it leaves out falls back to the `lilypondStudio` settings here.
 *
 * Creates the task's output directory as a side effect, since lilypond only treats `--output` as a directory when it already exists. That happens here, at task creation, rather than when the task runs: VS Code gives us no hook between starting a `ProcessExecution` and spawning it.
 */
function createLilypondTask(definition: LilyPondTaskDefinition, uri?: vscode.Uri): vscode.Task {
	const installation = LilyPondInstallation.getInstance();
	const lilypondPath = installation?.getExecutablePath() ??
		vscode.workspace.getConfiguration('lilypondStudio').get<string>('executablePath') ??
		'lilypond';

	// The file we were handed — the active editor, the document just saved, the score behind a focused PDF — supplies the variable context, but a `file` in the definition then overrides it: a task that names a score means to engrave that score, whatever the user happens to be looking at or editing.
	const contextUri = uri ?? vscode.window.activeTextEditor?.document.uri;
	const definedFile = definition.file
		? vscode.Uri.file(resolveInputFile(definition.file, contextUri ? variableContextFor(contextUri) : workspaceVariableContext()))
		: undefined;
	const resolvedUri = definedFile ?? contextUri;
	const filePath = resolvedUri?.fsPath ?? '*.ly';
	const fileDir = resolvedUri ? path.dirname(resolvedUri.fsPath) : undefined;
	const options = resolveTaskOptions(definition, resolvedUri);

	const args: string[] = [];
	options.includeDirs.forEach(dir => args.push(`--include=${dir}`));
	if (options.mode === 'publish') {
		args.push('-dno-point-and-click');
	}
	if (options.outputDirectory) {
		ensureOutputDirectory(options.outputDirectory);
		args.push(`--output=${options.outputDirectory}`);
	}
	// Last, so that a user's own options win over the ones we generate: lilypond takes the final value of a repeated option.
	args.push(...options.commandOptions);
	args.push(filePath);

	const execution = new vscode.ProcessExecution(lilypondPath, args, { cwd: fileDir });
	const taskName = options.mode === 'preview' ? 'Engrave (preview)' : 'Engrave (publish)';

	const task = new vscode.Task(
		definition,
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
						createLilypondTask({ type: 'lilypond', mode: 'preview' }),
						createLilypondTask({ type: 'lilypond', mode: 'publish' }),
					];
				}
				// No LilyPond editor is focused, but the PDF preview it produced might be:
				// shift+cmd+B should still engrave the score the user is looking at.
				const previewSource = PdfViewerPanel.activeSourceUri;
				if (previewSource) {
					return [
						createLilypondTask({ type: 'lilypond', mode: 'preview' }, previewSource),
						createLilypondTask({ type: 'lilypond', mode: 'publish' }, previewSource),
					];
				}
				// Nothing to build. Logged because "No build task to run found" on its own gives
				// no clue whether the wrong tab had focus or there was genuinely no LilyPond file
				// open — this turns a field report into a diagnosis.
				if (!editor) {
					log.debug('No lilypond build task: no active text editor (a webview or custom editor tab may have focus)');
				} else {
					log.debug(`No lilypond build task: active editor is ${editor.document.uri.toString()} (languageId ${editor.document.languageId})`);
				}
				return [];
			},
			// Tasks the user wrote in tasks.json arrive here with no execution attached; without this they cannot be run at all.
			resolveTask: (task: vscode.Task) => createLilypondTask(task.definition as LilyPondTaskDefinition),
		})
	);
}

export function registerEngraveOnSave(context: vscode.ExtensionContext): void {
	let enabled = false;
	// The whole definition, not just its mode: re-engraving has to reuse the output directory of the task the user actually ran, or on-save builds would write their PDFs somewhere else.
	let lastDefinition: LilyPondTaskDefinition | undefined;
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
		if (lastDefinition) {
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
		// lastDefinition is narrowed by the caller before this is reached.
		runningExecution = await vscode.tasks.executeTask(createLilypondTask(lastDefinition!, uri));
	}

	function updateSaveListener(): void {
		saveListener?.dispose();
		saveListener = undefined;
		pendingUri = undefined;
		// Do nothing until a build task has been run manually this session: we only
		// re-engrave once `lastDefinition` tells us which options the user actually wants,
		// so we never overwrite an existing PDF with one built using the wrong mode.
		if (!enabled || !lastDefinition) {return;}
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
			if (def.type === 'lilypond') {
				lastDefinition = def as LilyPondTaskDefinition;
				updateStatusItem();
				updateSaveListener();
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
