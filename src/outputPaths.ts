import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { configuredTaskDefinitions, resolveTaskOptions } from './taskDefinition';
import { log } from './log';

/** Creates `directory` and any missing parents.
 *
 * lilypond treats `--output` as a filename prefix unless it already names an existing directory, so `-o scores` on a fresh checkout writes a file called `scores.pdf` next to the source instead of `scores/song.pdf`. Creating the directory first is what makes the setting mean what it says.
 *
 * Failures are logged rather than thrown: a build that then fails noisily in the terminal is more useful than one we refuse to start.
 */
export function ensureOutputDirectory(directory: string): void {
	try {
		fs.mkdirSync(directory, { recursive: true });
	} catch (error) {
		log.error(`Could not create the output directory ${directory}`, error);
	}
}

/** The directories a PDF for `sourceUri` could plausibly have been written to.
 *
 * Every `lilypond` task the user has configured contributes one, as does the bare `lilypondStudio.outputDirectory` setting for the tasks we provide ourselves. Does not include the source file's own directory: that is the fallback in {@link findPdfForSource} and stays at the bottom of the list.
 */
export function candidateOutputDirectories(sourceUri: vscode.Uri): string[] {
	const definitions = [...configuredTaskDefinitions(sourceUri), { type: 'lilypond' } as const];
	const directories = definitions
		.map(definition => resolveTaskOptions(definition, sourceUri).outputDirectory)
		.filter((directory): directory is string => directory !== undefined);
	return [...new Set(directories)];
}

/** The PDF filename lilypond produces for a source file, without any directory. */
export function pdfBasename(sourceUri: vscode.Uri): string {
	return path.basename(sourceUri.fsPath).replace(/\.ly$/, '') + '.pdf';
}

/** Chooses which of several candidate PDFs to show.
 *
 * The most recently written of the `configured` candidates wins, because with several build configurations the one the user engraved last is the one they were looking at. `fallback` — the PDF beside the source — is only used when none of the configured candidates exists, so that a PDF built outside the extension is still found without ever shadowing a configured output directory.
 *
 * @param modifiedTime returns the mtime of a path in milliseconds, or undefined if it does not exist
 */
export function pickPdf(
	configured: string[],
	fallback: string,
	modifiedTime: (candidate: string) => number | undefined
): string | undefined {
	let best: { path: string; mtime: number } | undefined;
	for (const candidate of configured) {
		const mtime = modifiedTime(candidate);
		if (mtime !== undefined && (best === undefined || mtime > best.mtime)) {
			best = { path: candidate, mtime };
		}
	}
	if (best) {
		return best.path;
	}
	return modifiedTime(fallback) === undefined ? undefined : fallback;
}

function modifiedTimeOnDisk(candidate: string): number | undefined {
	try {
		return fs.statSync(candidate).mtimeMs;
	} catch {
		return undefined;
	}
}

/** Finds the PDF to preview for a LilyPond source file, or undefined if none has been built yet. */
export function findPdfForSource(sourceUri: vscode.Uri): string | undefined {
	const basename = pdfBasename(sourceUri);
	const configured = candidateOutputDirectories(sourceUri).map(directory => path.join(directory, basename));
	const fallback = path.join(path.dirname(sourceUri.fsPath), basename);
	return pickPdf(configured, fallback, modifiedTimeOnDisk);
}
