import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('extension activates and exports LilyPondInstallation', async () => {
		const ext = vscode.extensions.all.find(e => e.id.includes('lilypond-studio'));
		assert.ok(ext, 'Extension should be found');

		const exports = await ext!.activate();
		assert.ok(ext!.isActive, 'Extension should be active');
		assert.ok(exports?.LilyPondInstallation, 'Extension should export LilyPondInstallation');
	});
});
