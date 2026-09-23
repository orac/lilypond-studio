import * as vscode from 'vscode';

/**
 * How deeply to indent a line: a number of indentation units, or `'verbatim'` for a line that starts inside a string or block comment, whose leading whitespace is content.
 */
export type LineIndentation = number | 'verbatim';

/** A region opened by a delimiter, which the text inside is indented relative to. */
interface Frame {
	/** Music is LilyPond syntax; Scheme is Guile, entered by `#(` and left by its matching `)`. */
	mode: 'music' | 'scheme';
	closer: string;
}

/**
 * Tracks the nesting of `{ }`, `<< >>`, `#{ #}` and Scheme parentheses through a document, a line at a time.
 *
 * It lexes just enough to recognise delimiters: it skips strings, comments, backslash escapes such as `\%` and `\\`, and Scheme character literals such as `#\(`, but otherwise sees no grammar, so it copes with incomplete or malformed input. A closer that doesn't match the innermost open delimiter is ignored.
 */
export class NestingScanner {
	private readonly frames: Frame[] = [];
	private inside: 'code' | 'string' | 'blockComment' = 'code';

	/** Scans the next line of the document, and returns how deeply it should be indented. */
	scanLine(line: string): LineIndentation {
		const indentation = this.inside === 'code' ? undefined : 'verbatim';
		// Closers at the start of the line indent it to the level of their openers, so the line's depth is taken at its first other token.
		let depth: number | undefined;
		let i = 0;
		while (i < line.length) {
			if (this.inside === 'string') {
				i = this.scanString(line, i);
				continue;
			}
			if (this.inside === 'blockComment') {
				const end = line.indexOf('%}', i);
				if (end < 0) {
					break;
				}
				this.inside = 'code';
				i = end + 2;
				continue;
			}
			if (/\s/.test(line[i])) {
				i++;
				continue;
			}
			const closer = this.closerAt(line, i);
			if (closer !== undefined) {
				if (this.frames.at(-1)?.closer === closer) {
					this.frames.pop();
				}
				i += closer.length;
				continue;
			}
			depth ??= this.frames.length;
			const next = this.mode === 'music' ? this.scanMusic(line, i) : this.scanScheme(line, i);
			if (next === undefined) {
				break;
			}
			i = next;
		}
		return indentation ?? depth ?? this.frames.length;
	}

	private get mode(): Frame['mode'] {
		return this.frames.at(-1)?.mode ?? 'music';
	}

	/** Returns the closing delimiter at `i`, if there is one in the current mode. */
	private closerAt(line: string, i: number): string | undefined {
		const closers = this.mode === 'music' ? ['}', '>>', '#}'] : [')'];
		return closers.find(closer => line.startsWith(closer, i));
	}

	/** Consumes one token of LilyPond syntax, returning where the next begins, or `undefined` when the rest of the line is a comment. */
	private scanMusic(line: string, i: number): number | undefined {
		if (line.startsWith('%{', i)) {
			this.inside = 'blockComment';
			return i + 2;
		}
		switch (line[i]) {
			case '%':
				return undefined;
			case '"':
				this.inside = 'string';
				return i + 1;
			case '\\':
				// The escaped character is part of a command, as in \% and \{, or a divider, as in \\.
				return i + 2;
			case '{':
				this.frames.push({ mode: 'music', closer: '}' });
				return i + 1;
			case '#':
			case '$':
				return this.scanSchemeIntroducer(line, i + 1);
		}
		if (line.startsWith('<<', i)) {
			this.frames.push({ mode: 'music', closer: '>>' });
			return i + 2;
		}
		return i + 1;
	}

	/** Consumes the start of a Scheme expression embedded in music after its `#` or `$`, which is at `i - 1`. */
	private scanSchemeIntroducer(line: string, i: number): number {
		if (line[i] === '{') {
			this.frames.push({ mode: 'music', closer: '#}' });
			return i + 1;
		}
		// A quoted list, as in #'(1 . 2), is as much a Scheme expression as a call.
		const quotes = /^[',`]*/.exec(line.slice(i))![0].length;
		if (line[i + quotes] === '(') {
			this.frames.push({ mode: 'scheme', closer: ')' });
			return i + quotes + 1;
		}
		// Any other expression is an atom, or a string that scanMusic picks up next.
		return i;
	}

	/** Consumes one token of Scheme syntax, returning where the next begins, or `undefined` when the rest of the line is a comment. */
	private scanScheme(line: string, i: number): number | undefined {
		if (line.startsWith('#{', i)) {
			this.frames.push({ mode: 'music', closer: '#}' });
			return i + 2;
		}
		if (line.startsWith('#\\', i)) {
			// A character literal, which might be a delimiter such as #\( or #\".
			return i + 3;
		}
		switch (line[i]) {
			case ';':
				return undefined;
			case '"':
				this.inside = 'string';
				return i + 1;
			case '(':
				this.frames.push({ mode: 'scheme', closer: ')' });
				return i + 1;
		}
		return i + 1;
	}

	/** Consumes string content from `i`, returning where the string ends, or the end of the line if it continues onto the next. */
	private scanString(line: string, i: number): number {
		for (; i < line.length; i++) {
			if (line[i] === '\\') {
				i++;
			} else if (line[i] === '"') {
				this.inside = 'code';
				return i + 1;
			}
		}
		return i;
	}
}

/**
 * Reindents LilyPond files according to their nesting of braces, `<< >>` and Scheme parentheses, keeping their line breaks as they are.
 *
 * Whitespace-only lines are emptied. Lines that start inside a string or block comment are left alone.
 */
export class LilyPondFormatter implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
	provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions): vscode.TextEdit[] {
		return this.reindent(document, options, document.lineCount - 1);
	}

	provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions): vscode.TextEdit[] {
		return this.reindent(document, options, range.end.line).filter(edit => edit.range.start.line >= range.start.line);
	}

	/** Returns edits reindenting every line up to and including `lastLine`. */
	private reindent(document: vscode.TextDocument, options: vscode.FormattingOptions, lastLine: number): vscode.TextEdit[] {
		const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
		const scanner = new NestingScanner();
		const edits: vscode.TextEdit[] = [];
		for (let i = 0; i <= lastLine; i++) {
			const line = document.lineAt(i);
			const depth = scanner.scanLine(line.text);
			if (depth === 'verbatim') {
				continue;
			}
			const oldIndentation = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
			const newIndentation = line.isEmptyOrWhitespace ? '' : unit.repeat(depth);
			if (oldIndentation !== newIndentation) {
				edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, oldIndentation.length), newIndentation));
			}
		}
		return edits;
	}
}

/** Registers the formatter for LilyPond documents. */
export function registerFormatter(context: vscode.ExtensionContext): void {
	const formatter = new LilyPondFormatter();
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider({ language: 'lilypond' }, formatter),
		vscode.languages.registerDocumentRangeFormattingEditProvider({ language: 'lilypond' }, formatter),
	);
}
