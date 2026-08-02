import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveOutputDirectory, resolveTaskOptions, substituteVariables, VariableContext } from '../taskDefinition';

const context: VariableContext = {
	workspaceFolder: path.resolve('/scores'),
	fileDirname: path.resolve('/scores/motets'),
};

suite('substituteVariables', () => {
	test('substitutes the supported variables', () => {
		assert.strictEqual(substituteVariables('${workspaceFolder}/out', context), `${context.workspaceFolder}/out`);
		assert.strictEqual(substituteVariables('${fileDirname}/out', context), `${context.fileDirname}/out`);
		assert.strictEqual(substituteVariables('a${pathSeparator}b', context), `a${path.sep}b`);
	});

	test('leaves unknown variables alone', () => {
		assert.strictEqual(substituteVariables('${nonsense}/out', context), '${nonsense}/out');
	});

	test('leaves ${workspaceFolder} alone outside a workspace', () => {
		const noWorkspace: VariableContext = { ...context, workspaceFolder: undefined };
		assert.strictEqual(substituteVariables('${workspaceFolder}/out', noWorkspace), '${workspaceFolder}/out');
	});

	test('passes through a string with no variables', () => {
		assert.strictEqual(substituteVariables('out/pdf', context), 'out/pdf');
	});
});

suite('resolveOutputDirectory', () => {
	test('resolves a relative path against the source directory', () => {
		assert.strictEqual(resolveOutputDirectory('out', context), path.resolve(context.fileDirname, 'out'));
		assert.strictEqual(resolveOutputDirectory('../pdf', context), path.resolve(context.fileDirname, '../pdf'));
	});

	test('keeps an absolute path', () => {
		const absolute = path.resolve('/tmp/engraved');
		assert.strictEqual(resolveOutputDirectory(absolute, context), absolute);
	});

	test('resolves after substitution', () => {
		assert.strictEqual(
			resolveOutputDirectory('${workspaceFolder}/pdf', context),
			path.resolve(context.workspaceFolder!, 'pdf')
		);
	});
});

suite('resolveTaskOptions', () => {
	const sourceUri = vscode.Uri.file(path.resolve('/scores/motets/song.ly'));

	test('falls back to the settings defaults', () => {
		const options = resolveTaskOptions({ type: 'lilypond' }, sourceUri);
		assert.strictEqual(options.mode, 'preview');
		assert.strictEqual(options.outputDirectory, undefined);
		assert.deepStrictEqual(options.includeDirs, []);
		assert.deepStrictEqual(options.commandOptions, []);
	});

	test('takes the values the task defines', () => {
		const options = resolveTaskOptions({
			type: 'lilypond',
			mode: 'publish',
			outputDirectory: 'pdf',
			includeDirs: ['lib'],
			commandOptions: ['-dpaper-size=a3'],
		}, sourceUri);
		assert.strictEqual(options.mode, 'publish');
		// Derived from the Uri rather than written out, because Uri.fsPath lower-cases the drive letter on Windows.
		assert.strictEqual(options.outputDirectory, path.join(path.dirname(sourceUri.fsPath), 'pdf'));
		assert.deepStrictEqual(options.includeDirs, ['lib']);
		assert.deepStrictEqual(options.commandOptions, ['-dpaper-size=a3']);
	});

	test('substitutes variables in include directories and command options', () => {
		const options = resolveTaskOptions({
			type: 'lilypond',
			includeDirs: ['${fileDirname}/lib'],
			commandOptions: ['-dinclude-settings=${fileDirname}/settings.ily'],
		}, sourceUri);
		const fileDirname = path.dirname(sourceUri.fsPath);
		assert.deepStrictEqual(options.includeDirs, [`${fileDirname}/lib`]);
		assert.deepStrictEqual(options.commandOptions, [`-dinclude-settings=${fileDirname}/settings.ily`]);
	});

	test('leaves the output directory unresolved when there is no source file', () => {
		const options = resolveTaskOptions({ type: 'lilypond', outputDirectory: 'pdf' }, undefined);
		assert.strictEqual(options.outputDirectory, undefined);
	});

	test('treats a whitespace-only output directory as unset', () => {
		const options = resolveTaskOptions({ type: 'lilypond', outputDirectory: '  ' }, sourceUri);
		assert.strictEqual(options.outputDirectory, undefined);
	});
});
