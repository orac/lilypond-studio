import * as assert from 'assert';
import { pickPdf } from '../outputPaths';

suite('pickPdf', () => {
	const sibling = '/scores/motets/song.pdf';

	/** A stat function over a fixed set of paths, where the mtime is the value. */
	const disk = (files: Record<string, number>) => (candidate: string) => files[candidate];

	test('returns undefined when nothing has been built', () => {
		assert.strictEqual(pickPdf(['/out/song.pdf'], sibling, disk({})), undefined);
	});

	test('falls back to the sibling PDF when no configured output exists', () => {
		assert.strictEqual(pickPdf(['/out/song.pdf'], sibling, disk({ [sibling]: 100 })), sibling);
	});

	test('finds a PDF built outside the extension when nothing is configured', () => {
		assert.strictEqual(pickPdf([], sibling, disk({ [sibling]: 100 })), sibling);
	});

	test('prefers a configured output directory over a newer sibling PDF', () => {
		const files = { '/out/song.pdf': 100, [sibling]: 200 };
		assert.strictEqual(pickPdf(['/out/song.pdf'], sibling, disk(files)), '/out/song.pdf');
	});

	test('picks the most recently engraved of several configured directories', () => {
		const files = { '/draft/song.pdf': 100, '/final/song.pdf': 300, '/proof/song.pdf': 200 };
		const candidates = ['/draft/song.pdf', '/final/song.pdf', '/proof/song.pdf'];
		assert.strictEqual(pickPdf(candidates, sibling, disk(files)), '/final/song.pdf');
	});

	test('ignores configured directories that have not been built', () => {
		const files = { '/proof/song.pdf': 200 };
		assert.strictEqual(pickPdf(['/draft/song.pdf', '/proof/song.pdf'], sibling, disk(files)), '/proof/song.pdf');
	});
});
