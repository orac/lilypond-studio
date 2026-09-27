/** @fileoverview Parsing LilyPond's point-and-click links, shared by the extension host and the PDF viewer webview.
 *
 * Must stay free of Node and DOM dependencies: it is bundled into both.
 */

/** Where a point-and-click link in a PDF points to in the source. */
export interface TexteditTarget {
	/** Absolute path of the source file, as normalised by {@link normaliseSourcePath}. */
	filePath: string;
	/** 1-based, as LilyPond writes it. */
	line: number;
	/** 0-based column where the linked item starts. */
	charStart: number;
	/** 0-based column where the linked item ends. */
	charEnd: number;
}

/** Parses a `textedit://path/to/file.ly:line:char:char` link, or returns undefined if `uri` is some other kind of link. */
export function parseTexteditUri(uri: string): TexteditTarget | undefined {
	const match = uri.match(/^textedit:\/\/(.+):(\d+):(\d+):(\d+)$/);
	if (!match) {
		return undefined;
	}
	const [, encodedFilePath, line, charStart, charEnd] = match;
	return {
		filePath: normaliseSourcePath(decodeURIComponent(encodedFilePath)),
		line: parseInt(line, 10),
		charStart: parseInt(charStart, 10),
		charEnd: parseInt(charEnd, 10),
	};
}

/** Puts an absolute path into the one spelling used to compare source files between the PDF and the editor.
 *
 * LilyPond builds link paths by gluing an `\include` argument onto the directory it was found from, so they can contain `.` and `..` segments. On Windows they may use either slash, and may or may not have a slash before the drive letter. The result uses forward slashes, has no dot segments, and on Windows starts with a lower-case drive letter, which is how `vscode.Uri` spells it.
 */
export function normaliseSourcePath(filePath: string): string {
	let rest = filePath.replace(/\\/g, '/');
	let root = '/';
	const drive = rest.match(/^\/?([A-Za-z]):/);
	if (drive) {
		root = `${drive[1].toLowerCase()}:/`;
		rest = rest.slice(drive[0].length);
	}
	const segments: string[] = [];
	for (const segment of rest.split('/')) {
		if (segment === '..') {
			segments.pop();
		} else if (segment !== '' && segment !== '.') {
			segments.push(segment);
		}
	}
	return root + segments.join('/');
}

/** A key under which two spellings of the same source file compare equal.
 *
 * Case-insensitive on every platform, because Windows and macOS file systems usually are, and an `\include` may not match the case of the file on disk. That conflates two files differing only in case on Linux, which a score is vanishingly unlikely to include both of.
 */
export function sourceFileKey(filePath: string): string {
	return normaliseSourcePath(filePath).toLowerCase();
}
