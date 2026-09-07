import * as vscode from 'vscode';
import * as fs from 'fs';
import { log } from './log';
import { LilyPondInstallation } from './LilyPondInstallation';
import { LilyPondLanguageClient } from './languageClient';
import { configuredTaskDefinitions, resolveTaskOptions } from './taskDefinition';
import { getLastEnsureOutputDirectoryFailure } from './outputPaths';

/** Files the PDF viewer webview loads at runtime, relative to the extension root.
 *
 * Reported individually because a missing one produces an empty panel rather than any kind of error, so "which of these is absent" is the first question worth answering.
 */
const webviewAssets = [
	'dist/viewer.html',
	'dist/viewer.js',
	'dist/vendor/pdf.mjs',
	'dist/vendor/pdf.worker.mjs',
	'dist/vendor/elements.js',
	'dist/vendor/codicon.css',
];

/** Settings worth knowing about in a bug report. Values are reported verbatim, so nothing secret belongs here. */
const reportedSettings = [
	'executablePath',
	'includeDirs',
	'languageServerPath',
	'engraveOnSave',
	'outputDirectory',
	'commandOptions',
];

function describeFile(label: string, filePath: string | null | undefined): string {
	if (!filePath) {
		return `${label}: not set`;
	}
	return `${label}: ${filePath} (${fs.existsSync(filePath) ? 'present' : 'MISSING'})`;
}

/** The lilypond executable a provided task would run, mirroring the fallback chain in `tasks.ts:createLilypondTask`. */
function resolveLilypondExecutablePath(): string {
	return LilyPondInstallation.getInstance()?.getExecutablePath() ??
		vscode.workspace.getConfiguration('lilypondStudio').get<string>('executablePath') ??
		'lilypond';
}

/** Everything relevant to "why did VS Code not offer a build task", worked out from the report alone.
 *
 * Prompted by a bug report where shift+cmd+B produced "No build task to run found" with no further clue: the workspace folder, active editor and configured task definitions between them cover every reason VS Code's task provider comes up empty.
 */
function collectTaskDiagnostics(): string[] {
	const lines: string[] = [];

	const folders = vscode.workspace.workspaceFolders;
	if (folders && folders.length > 0) {
		lines.push(`Workspace folders: ${folders.length}`);
		for (const folder of folders) {
			lines.push(`  ${folder.uri.fsPath}`);
		}
	} else {
		lines.push('Workspace folders: none — a folderless window; VS Code will not offer build tasks');
	}

	const editor = vscode.window.activeTextEditor;
	if (editor) {
		lines.push(`Active editor: ${editor.document.uri.toString()} (languageId: ${editor.document.languageId}, scheme: ${editor.document.uri.scheme})`);
	} else {
		lines.push('Active editor: none — likely a webview or custom editor tab has focus, which is the usual reason a build shortcut finds no task');
	}

	const definitions = configuredTaskDefinitions(editor?.document.uri);
	if (definitions.length > 0) {
		lines.push(`Configured lilypond tasks in tasks.json: ${definitions.length}`);
		for (const definition of definitions) {
			lines.push(`  ${JSON.stringify(definition)}`);
		}
	} else {
		lines.push('Configured lilypond tasks in tasks.json: none');
	}

	if (editor && editor.document.languageId === 'lilypond') {
		const options = resolveTaskOptions({ type: 'lilypond' }, editor.document.uri);
		lines.push('Resolved build options for the active file:');
		lines.push(`  mode: ${options.mode}`);
		lines.push(`  outputDirectory: ${options.outputDirectory ?? '(beside the source file)'}`);
		lines.push(`  includeDirs: ${JSON.stringify(options.includeDirs)}`);
		lines.push(`  commandOptions: ${JSON.stringify(options.commandOptions)}`);
		lines.push(`  lilypond executable: ${resolveLilypondExecutablePath()}`);
	}

	const outputDirectoryFailure = getLastEnsureOutputDirectoryFailure();
	if (outputDirectoryFailure) {
		lines.push(`Output directory creation failed: ${outputDirectoryFailure.directory} (${outputDirectoryFailure.error})`);
	}

	return lines;
}

/** Collects everything a maintainer needs to reproduce an environment-specific problem. */
function collectDiagnostics(context: vscode.ExtensionContext, languageClient: LilyPondLanguageClient | undefined): string {
	const lines: string[] = [];

	lines.push('LilyPond Studio diagnostics');
	lines.push(`Extension version: ${context.extension.packageJSON.version}`);
	lines.push(`VS Code: ${vscode.version}`);
	lines.push(`Platform: ${process.platform} ${process.arch}, Node ${process.version}`);
	lines.push(`Extension path: ${context.extensionPath}`);

	lines.push('');
	lines.push('LilyPond installation');
	const installation = LilyPondInstallation.getInstance();
	if (installation) {
		lines.push(`Version: ${installation.getVersion() ?? 'unknown'}`);
		lines.push(describeFile('Executable', installation.getExecutablePath()));
		lines.push(describeFile('Words file', installation.getWordsFilePath()));
	} else {
		lines.push('Not detected. Completions and convert-ly are unavailable; navigation and syntax diagnostics still work.');
	}

	lines.push('');
	lines.push('Language server');
	lines.push(describeFile('Binary', languageClient?.resolveServerPath()));

	lines.push('');
	lines.push('PDF viewer assets');
	for (const asset of webviewAssets) {
		lines.push(describeFile(asset, context.asAbsolutePath(asset)));
	}

	lines.push('');
	lines.push('Tasks');
	lines.push(...collectTaskDiagnostics());

	lines.push('');
	lines.push('Settings');
	const config = vscode.workspace.getConfiguration('lilypondStudio');
	for (const setting of reportedSettings) {
		lines.push(`${setting}: ${JSON.stringify(config.get(setting))}`);
	}

	return lines.join('\n');
}

/** Registers the command that writes a diagnostics report to the log channel and reveals it, so a user can copy the lot into an issue. */
export function registerDiagnosticsCommand(context: vscode.ExtensionContext, languageClient: () => LilyPondLanguageClient | undefined) {
	context.subscriptions.push(
		vscode.commands.registerCommand('lilypondStudio.showDiagnostics', () => {
			log.info(collectDiagnostics(context, languageClient()));
			log.show();
		})
	);
}
