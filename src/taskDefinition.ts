import * as path from 'path';
import * as vscode from 'vscode';

/** A `lilypond` task, as we provide it or as the user wrote it in `tasks.json`.
 *
 * Every build option is optional here and falls back to the corresponding `lilypondStudio` setting; {@link resolveTaskOptions} applies those fallbacks. A task therefore says only what it wants to differ from the user's defaults, which is what makes several tasks with different build options practical.
 */
export interface LilyPondTaskDefinition extends vscode.TaskDefinition {
	type: 'lilypond';
	/** `preview` keeps point-and-click links in the PDF; `publish` strips them. Defaults to `preview`. */
	mode?: 'preview' | 'publish';
	/** The `.ly` file to engrave. Defaults to the active editor's file. */
	file?: string;
	/** Directory lilypond writes its output to, passed as `--output`.
	 *
	 * Relative paths are resolved against the directory containing the `.ly` file, which is the task's working directory.
	 */
	outputDirectory?: string;
	/** Directories to search for `\include`, each passed as `--include`. Falls back to `lilypondStudio.includeDirs`. */
	includeDirs?: string[];
	/** Further command-line arguments, passed to lilypond after everything we generate ourselves and before the filename. Falls back to `lilypondStudio.commandOptions`. */
	commandOptions?: string[];
}

/** The variables we expand in the paths and options of a task definition.
 *
 * VS Code substitutes variables itself when it runs a task from `tasks.json`, but we also read those same definitions to work out where a PDF lives, and that path gets no substitution for free.
 */
export interface VariableContext {
	/** Absolute path of the workspace folder owning the source file, if there is one. */
	workspaceFolder: string | undefined;
	/** Absolute path of the directory containing the source file. */
	fileDirname: string;
}

/** Expands the variables of {@link VariableContext} in `template`.
 *
 * Unknown `${...}` variables are left untouched rather than expanded to the empty string, so a typo produces a path that visibly failed to resolve instead of one that silently points at the wrong place.
 */
export function substituteVariables(template: string, context: VariableContext): string {
	return template.replace(/\$\{(\w+)\}/g, (match, name: string) => {
		switch (name) {
			case 'workspaceFolder':
				return context.workspaceFolder ?? match;
			case 'fileDirname':
				return context.fileDirname;
			case 'pathSeparator':
				return path.sep;
			default:
				return match;
		}
	});
}

/** Resolves a configured output directory to an absolute path. */
export function resolveOutputDirectory(configured: string, context: VariableContext): string {
	return path.resolve(context.fileDirname, substituteVariables(configured, context));
}

/** The variable context for a source file. */
export function variableContextFor(sourceUri: vscode.Uri): VariableContext {
	return {
		workspaceFolder: vscode.workspace.getWorkspaceFolder(sourceUri)?.uri.fsPath,
		fileDirname: path.dirname(sourceUri.fsPath),
	};
}

/** A task definition with its settings fallbacks applied and its variables expanded. */
export interface ResolvedTaskOptions {
	mode: 'preview' | 'publish';
	/** Absolute path, or undefined to let lilypond write output beside the source file. */
	outputDirectory: string | undefined;
	includeDirs: string[];
	commandOptions: string[];
}

function settingsFallback<T>(property: T | undefined, setting: string, scope: vscode.Uri | undefined): T | undefined {
	return property ?? vscode.workspace.getConfiguration('lilypondStudio', scope).get<T>(setting);
}

/** Applies the `lilypondStudio` settings fallbacks and variable substitution to a task definition.
 *
 * The single place where a task's build options are worked out, so that the arguments we hand lilypond and the directory we later search for a PDF cannot drift apart.
 *
 * Without a `sourceUri` there is no directory to resolve a relative output path against, so `outputDirectory` is undefined however it was configured; the caller is expected to resolve the task again once it knows the file.
 */
export function resolveTaskOptions(definition: LilyPondTaskDefinition, sourceUri: vscode.Uri | undefined): ResolvedTaskOptions {
	const context = sourceUri ? variableContextFor(sourceUri) : undefined;
	const substitute = (value: string) => context ? substituteVariables(value, context) : value;

	const configuredOutput = settingsFallback(definition.outputDirectory, 'outputDirectory', sourceUri)?.trim();
	const includeDirs = settingsFallback(definition.includeDirs, 'includeDirs', sourceUri) ?? [];
	const commandOptions = settingsFallback(definition.commandOptions, 'commandOptions', sourceUri) ?? [];

	return {
		mode: definition.mode ?? 'preview',
		outputDirectory: configuredOutput && context ? resolveOutputDirectory(configuredOutput, context) : undefined,
		includeDirs: includeDirs.map(substitute),
		commandOptions: commandOptions.map(substitute),
	};
}

/** Reads the `lilypond` task definitions the user has written in `tasks.json`.
 *
 * Deliberately reads the configuration rather than calling `vscode.tasks.fetchTasks`: fetching runs every registered provider (including our own, which creates output directories as a side effect) and we only want the declared values.
 */
export function configuredTaskDefinitions(scope?: vscode.Uri): LilyPondTaskDefinition[] {
	const tasks = vscode.workspace.getConfiguration('tasks', scope).get<vscode.TaskDefinition[]>('tasks') ?? [];
	return tasks.filter((task): task is LilyPondTaskDefinition => task?.type === 'lilypond');
}
