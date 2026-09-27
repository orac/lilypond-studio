import * as assert from 'assert';
import { normaliseSourcePath, parseTexteditUri, sourceFileKey } from '../shared/texteditUri';

suite('parseTexteditUri', () => {
	test('parses a POSIX link', () => {
		assert.deepStrictEqual(parseTexteditUri('textedit:///home/me/score.ly:12:4:9'), {
			filePath: '/home/me/score.ly',
			line: 12,
			charStart: 4,
			charEnd: 9,
		});
	});

	test('decodes escaped characters in the path', () => {
		assert.strictEqual(parseTexteditUri('textedit:///home/me/my%20scores/score.ly:1:0:1')?.filePath, '/home/me/my scores/score.ly');
	});

	test('ignores links of other kinds', () => {
		assert.strictEqual(parseTexteditUri('https://lilypond.org/'), undefined);
	});
});

suite('normaliseSourcePath', () => {
	test('resolves the dot segments left by a relative \\include', () => {
		assert.strictEqual(normaliseSourcePath('/home/me/scores/./parts/../common.ily'), '/home/me/scores/common.ily');
	});

	test('spells Windows paths the way vscode.Uri does', () => {
		const expected = 'c:/Users/me/score.ly';
		assert.strictEqual(normaliseSourcePath('C:\\Users\\me\\score.ly'), expected);
		assert.strictEqual(normaliseSourcePath('/C:/Users/me/score.ly'), expected);
		assert.strictEqual(normaliseSourcePath('C:/Users/me/score.ly'), expected);
	});
});

suite('sourceFileKey', () => {
	test('matches a link path to the editor path of the same file', () => {
		const link = parseTexteditUri('textedit:///C:/Users/Me/Scores/parts/../Common.ily:3:0:2')!;
		assert.strictEqual(sourceFileKey(link.filePath), sourceFileKey('c:\\Users\\Me\\Scores\\common.ily'));
	});
});
