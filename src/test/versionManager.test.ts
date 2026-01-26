import * as assert from 'assert';
import { compareVersions } from '../versionManager';

suite('Version Manager', () => {
	suite('compareVersions', () => {
		test('returns 0 for equal versions', () => {
			assert.strictEqual(compareVersions('2.24.1', '2.24.1'), 0);
			assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
		});

		test('returns -1 when first version is less', () => {
			assert.strictEqual(compareVersions('2.24.0', '2.24.1'), -1);
			assert.strictEqual(compareVersions('2.23.1', '2.24.1'), -1);
			assert.strictEqual(compareVersions('1.24.1', '2.24.1'), -1);
		});

		test('returns 1 when first version is greater', () => {
			assert.strictEqual(compareVersions('2.24.2', '2.24.1'), 1);
			assert.strictEqual(compareVersions('2.25.1', '2.24.1'), 1);
			assert.strictEqual(compareVersions('3.24.1', '2.24.1'), 1);
		});

		test('handles versions with different segment counts', () => {
			assert.strictEqual(compareVersions('2.24', '2.24.0'), 0);
			assert.strictEqual(compareVersions('2.24', '2.24.1'), -1);
			assert.strictEqual(compareVersions('2.24.1', '2.24'), 1);
		});

		test('handles single segment versions', () => {
			assert.strictEqual(compareVersions('2', '2'), 0);
			assert.strictEqual(compareVersions('2', '3'), -1);
			assert.strictEqual(compareVersions('3', '2'), 1);
		});
	});
});
