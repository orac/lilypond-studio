import * as vscode from 'vscode';
import * as fs from 'fs';
import { log } from './log';
import { LilyPondInstallation } from './LilyPondInstallation';
import { LilyPondLanguageClient } from './languageClient';

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
];

function describeFile(label: string, filePath: string | null | undefined): string {
	if (!filePath) {
		return `${label}: not set`;
	}
	return `${label}: ${filePath} (${fs.existsSync(filePath) ? 'present' : 'MISSING'})`;
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
