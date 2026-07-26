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

	test('diagnostics command is registered and runs', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('lilypondStudio.showDiagnostics'), 'Diagnostics command should be registered');

		// It reports on a possibly-absent LilyPond and a possibly-unstarted language server, so it has to survive both.
		await vscode.commands.executeCommand('lilypondStudio.showDiagnostics');
	});
});
