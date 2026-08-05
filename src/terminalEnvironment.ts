import * as path from 'path';
import * as vscode from 'vscode';
import { getConfiguredExecutablePath } from './LilyPondInstallation';
import { log } from './log';

/** The directory to prepend to PATH for a given `lilypondStudio.executablePath` setting.
 *
 * Returns undefined when the setting names no directory — a bare command name means LilyPond is already on PATH (or isn't installed), and either way there's nothing useful to add.
 */
export function binDirectoryFor(executablePath: string): string | undefined {
	const trimmed = executablePath.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	const dir = path.dirname(trimmed);
	return dir === '.' ? undefined : dir;
}

/** Puts the LilyPond bin directory on the PATH of integrated terminals.
 *
 * This lets `lilypond`, `convert-ly` and friends be run straight from a terminal even when the user configured an executable path VS Code's shell knows nothing about. VS Code persists the collection between sessions and applies it when each terminal's process is created, so terminals opened before this extension activates still get it; existing terminals show a "stale environment" indicator until they're relaunched.
 */
export function registerTerminalEnvironment(context: vscode.ExtensionContext): void {
	const collection = context.environmentVariableCollection;
	collection.description = 'Adds the LilyPond bin directory to PATH.';

	const apply = () => {
		collection.clear();
		const binDir = binDirectoryFor(getConfiguredExecutablePath());
		if (!binDir) {
			log.debug('No LilyPond bin directory to add to the terminal PATH');
			return;
		}

		collection.prepend('PATH', binDir + path.delimiter);
		log.info(`Prepending ${binDir} to PATH in new terminals`);
	};

	apply();

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('lilypondStudio.executablePath')) {
				apply();
			}
		})
	);
}
