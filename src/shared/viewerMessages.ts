/** @fileoverview The messages passed between the PDF viewer webview and the extension host. */

import type { TexteditTarget } from './texteditUri';

/** A range of a source file, with 1-based lines and 0-based columns as in LilyPond's links. */
export interface SourceRange {
	/** Absolute path, in any spelling `sourceFileKey` understands. */
	filePath: string;
	startLine: number;
	startChar: number;
	endLine: number;
	endChar: number;
}

/** Sent by the webview in `viewer.ts` to `pdfViewer.ts`. */
export type ViewerMessage =
	| { type: 'click'; target: TexteditTarget }
	| { type: 'hover'; target: TexteditTarget }
	| { type: 'unhover' }
	/** The PDF has loaded; `sourceFiles` lists every file its links point into. */
	| { type: 'ready'; sourceFiles: string[] }
	| { type: 'error'; message: string }
	| { type: 'log'; message: string };

/** Sent by `pdfViewer.ts` to the webview in `viewer.ts`. */
export type HostMessage =
	| { type: 'sync'; range: SourceRange }
	| { type: 'reload' };
