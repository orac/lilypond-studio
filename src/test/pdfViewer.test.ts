import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

/** Every file the PDF viewer webview loads at runtime, relative to the extension root.
 *
 * These are deliberately spelled out rather than derived from `esbuild.js`: the point of the test is to catch a mismatch between what the build produces and what `pdfViewer.ts` asks for. `node_modules` and `src` are excluded from the VSIX, so anything the webview needs must be copied into `dist` by the build — when that stopped happening the panel rendered completely blank, with no error anywhere the user could see.
 */
const requiredWebviewAssets = [
	'dist/viewer.html',
	'dist/viewer.js',
	'dist/vendor/pdf.mjs',
	'dist/vendor/pdf.worker.mjs',
	'dist/vendor/elements.js',
	'dist/vendor/codicon.css',
	'dist/vendor/codicon.ttf',
];

suite('PDF viewer assets', () => {
	let extensionPath: string;

	suiteSetup(async () => {
		const ext = vscode.extensions.all.find(e => e.id.includes('lilypond-studio'));
		assert.ok(ext, 'Extension should be found');
		await ext!.activate();
		extensionPath = ext!.extensionPath;
	});

	for (const asset of requiredWebviewAssets) {
		test(`${asset} is present in the built extension`, () => {
			const assetUri = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), ...asset.split('/'));
			assert.ok(fs.existsSync(assetUri.fsPath), `${asset} is missing; the webview will fail to load`);
		});
	}

	test('codicon.css finds its font alongside it', () => {
		const vendorDir = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'dist', 'vendor');
		const css = fs.readFileSync(vscode.Uri.joinPath(vendorDir, 'codicon.css').fsPath, 'utf8');
		const fontUrl = css.match(/url\(["']?([^"')]+)["']?\)/);
		assert.ok(fontUrl, 'codicon.css should reference a font file');

		// The reference carries a cache-busting query string, and is relative to the stylesheet.
		const fontFile = fontUrl![1].split('?')[0];
		const resolved = vscode.Uri.joinPath(vendorDir, fontFile).fsPath;
		assert.ok(fs.existsSync(resolved), `codicon.css references ${fontUrl![1]}, which does not resolve inside the vendor directory`);
	});
});
