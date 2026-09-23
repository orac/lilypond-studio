import * as assert from 'assert';
import * as vscode from 'vscode';

async function activateExtension(): Promise<void> {
	await vscode.extensions.all.find(e => e.id.includes('lilypond-studio'))!.activate();
}

/** Opens a tab-indented scratch LilyPond document with the given lines, and shows it in an editor. */
async function openLines(lines: string[]): Promise<vscode.TextEditor> {
	const document = await vscode.workspace.openTextDocument({ language: 'lilypond', content: lines.join('\n') });
	const editor = await vscode.window.showTextDocument(document);
	editor.options = { insertSpaces: false, tabSize: 4 };
	return editor;
}

/** Returns the text of the active editor's document, then closes it. */
async function closeActiveEditor(): Promise<string[]> {
	const lines = vscode.window.activeTextEditor!.document.getText().split(/\r?\n/);
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	return lines;
}

/** Formats the given lines with the formatter the extension provides, returning the result. */
async function format(lines: string[], options: vscode.FormattingOptions = { insertSpaces: false, tabSize: 4 }): Promise<string[]> {
	const editor = await openLines(lines);
	const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', editor.document.uri, options);
	await editor.edit(builder => edits.forEach(edit => builder.replace(edit.range, edit.newText)));
	return closeActiveEditor();
}

/** Marks the cursor position in the lines passed to and returned from {@link type}. It's never valid LilyPond, unlike `|`. */
const cursor = '‸';

/**
 * Types `text` into a scratch document a character at a time, as the user would, returning the result.
 *
 * The cursor starts where the lines have a {@link cursor} marker, and the result has one where it ends up.
 */
async function type(lines: string[], text: string): Promise<string[]> {
	const line = lines.findIndex(l => l.includes(cursor));
	const start = new vscode.Position(line, lines[line].indexOf(cursor));
	const editor = await openLines(lines.map(l => l.replace(cursor, '')));
	editor.selection = new vscode.Selection(start, start);
	for (const character of text) {
		// VS Code only reindents a line as you type once the background tokenizer has caught up with it, which it has time to do between a human's keystrokes.
		await new Promise(resolve => setTimeout(resolve, 50));
		await vscode.commands.executeCommand('type', { text: character });
	}
	const end = editor.selection.active;
	await editor.edit(builder => builder.insert(end, cursor));
	return closeActiveEditor();
}

suite('Formatter', () => {
	suiteSetup(activateExtension);

	test('indents by braces and double angle brackets', async () => {
		const input = [
			'\\score {',
			'<<',
			'\\new Staff {',
			'c d e',
			'}',
			'>>',
			'}',
		];
		assert.deepStrictEqual(await format(input), [
			'\\score {',
			'\t<<',
			'\t\t\\new Staff {',
			'\t\t\tc d e',
			'\t\t}',
			'\t>>',
			'}',
		]);
	});

	test('keeps line breaks, and counts delimiters opened and closed on one line', async () => {
		const input = [
			'  \\relative { c d',
			'  e f } \\new Voice { g',
			'      a }',
		];
		assert.deepStrictEqual(await format(input), [
			'\\relative { c d',
			'\te f } \\new Voice { g',
			'\ta }',
		]);
	});

	test('dedents a line starting with closers to the level of their openers', async () => {
		const input = [
			'<< {',
			'c',
			'} >> { d',
			'}',
		];
		assert.deepStrictEqual(await format(input), [
			'<< {',
			'\t\tc',
			'} >> { d',
			'}',
		]);
	});

	test('uses spaces when the editor does', async () => {
		assert.deepStrictEqual(await format(['{', 'c', '}'], { insertSpaces: true, tabSize: 2 }), ['{', '  c', '}']);
	});

	test('empties whitespace-only lines', async () => {
		assert.deepStrictEqual(await format(['{', '   ', 'c', '}']), ['{', '', '\tc', '}']);
	});

	test('ignores delimiters in comments and strings', async () => {
		const input = [
			'{ % {',
			'c^"{ <<"',
			'%{ {',
			'%}',
			'}',
		];
		assert.deepStrictEqual(await format(input), [
			'{ % {',
			'\tc^"{ <<"',
			'\t%{ {',
			'%}',
			'}',
		]);
	});

	test('leaves lines inside block comments and multi-line strings alone', async () => {
		const input = [
			'{',
			'%{',
			'      drawn',
			'  %}',
			'\\markup "a',
			'   b"',
			'}',
		];
		assert.deepStrictEqual(await format(input), [
			'{',
			'\t%{',
			'      drawn',
			'  %}',
			'\t\\markup "a',
			'   b"',
			'}',
		]);
	});

	test('ignores delimiters escaped by a backslash', async () => {
		const input = [
			'{',
			'<< { c } \\\\ { d } >> \\% \\{',
			'}',
		];
		assert.deepStrictEqual(await format(input), [
			'{',
			'\t<< { c } \\\\ { d } >> \\% \\{',
			'}',
		]);
	});

	test('indents Scheme by its parentheses, and music embedded in Scheme by its braces', async () => {
		const input = [
			'fn = #(define-music-function (x) (number?)',
			'#{',
			'{ c }',
			'#})',
			'\\override Foo.bar = #\'(1',
			'. 2)',
			'x = #(list #\\( ; )',
			'"("',
			')',
		];
		assert.deepStrictEqual(await format(input), [
			'fn = #(define-music-function (x) (number?)',
			'\t#{',
			'\t\t{ c }',
			'#})',
			'\\override Foo.bar = #\'(1',
			'\t. 2)',
			'x = #(list #\\( ; )',
			'\t"("',
			')',
		]);
	});

	test('formats only the lines in a selected range', async () => {
		const editor = await openLines(['{', 'c', 'd', '}']);
		const options = { insertSpaces: false, tabSize: 4 };
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatRangeProvider', editor.document.uri, new vscode.Range(2, 0, 2, 1), options);
		await editor.edit(builder => edits.forEach(edit => builder.replace(edit.range, edit.newText)));
		assert.deepStrictEqual(await closeActiveEditor(), ['{', 'c', '\td', '}']);
	});
});

suite('Indentation as you type', () => {
	suiteSetup(activateExtension);

	test('typing } on a blank indented line deindents it', async () => {
		assert.deepStrictEqual(await type(['\\relative {', '\tc d e', '\t‸'], '}'), ['\\relative {', '\tc d e', '}‸']);
	});

	test('typing >> on a blank indented line deindents it', async () => {
		assert.deepStrictEqual(await type(['<<', '\t{ c }', '\t‸'], '>>'), ['<<', '\t{ c }', '>>‸']);
	});

	test('typing #} on a blank indented line deindents it', async () => {
		assert.deepStrictEqual(await type(['x = #{', '\tc', '\t‸'], '#}'), ['x = #{', '\tc', '#}‸']);
	});

	test('typing } after other text on the line leaves the indentation alone', async () => {
		assert.deepStrictEqual(await type(['{', '\t{ c d‸'], ' }'), ['{', '\t{ c d }‸']);
	});

	test('Enter before a } deindents it to the level of its opener', async () => {
		assert.deepStrictEqual(await type(['{', '\tc d e ‸}'], '\n'), ['{', '\tc d e ', '‸}']);
	});

	test('Enter before a >> deindents it to the level of its opener', async () => {
		assert.deepStrictEqual(await type(['<<', '\t{ c } ‸>>'], '\n'), ['<<', '\t{ c } ', '‸>>']);
	});

	test('Enter before a } on the line that opened its block leaves it at that level', async () => {
		assert.deepStrictEqual(await type(['\t{ c d ‸}'], '\n'), ['\t{ c d ', '\t‸}']);
	});

	test('Enter between an empty pair of braces puts the cursor on an indented line between them', async () => {
		assert.deepStrictEqual(await type(['{‸}'], '\n'), ['{', '\t‸', '}']);
	});

	test('Enter after an opener indents the next line', async () => {
		assert.deepStrictEqual(await type(['\\new Staff << \\new Voice { c‸'], '\n'), ['\\new Staff << \\new Voice { c', '\t‸']);
	});

	test('Enter after an opener that follows \\% indents the next line', async () => {
		assert.deepStrictEqual(await type(['\\% 4 { c‸'], '\n'), ['\\% 4 { c', '\t‸']);
	});

	test('Enter after an opener with a comment after it indents the next line', async () => {
		assert.deepStrictEqual(await type(['\\% 4 { % }‸'], '\n'), ['\\% 4 { % }', '\t‸']);
	});

	test('Enter after an opener in a comment keeps the indentation', async () => {
		assert.deepStrictEqual(await type(['c % {‸'], '\n'), ['c % {', '‸']);
	});

	test('Enter in the middle of a block keeps its indentation', async () => {
		assert.deepStrictEqual(await type(['{', '\tc d‸', '}'], '\n'), ['{', '\tc d', '\t‸', '}']);
	});
});
