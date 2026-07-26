const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Third-party files the webview loads at runtime, copied out of node_modules because that directory is not packaged into the VSIX.
 *
 * Keys are paths under `dist/`, values are paths under `node_modules/`. Anything added here must also be reachable from the webview's `localResourceRoots` in `src/pdfViewer.ts`.
 */
const vendoredAssets = {
	'vendor/pdf.mjs': 'pdfjs-dist/build/pdf.mjs',
	'vendor/pdf.worker.mjs': 'pdfjs-dist/build/pdf.worker.mjs',
	'vendor/elements.js': '@vscode-elements/elements/dist/bundled.js',
	'vendor/codicon.css': '@vscode/codicons/dist/codicon.css',
	// Referenced by a relative @font-face url in codicon.css, so it has to sit alongside it.
	'vendor/codicon.ttf': '@vscode/codicons/dist/codicon.ttf',
};

function copyVendoredAssets() {
	for (const [target, source] of Object.entries(vendoredAssets)) {
		const targetPath = path.join('dist', target);
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.copyFileSync(path.join('node_modules', source), targetPath);
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// Build extension
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	copyVendoredAssets();

	// Build webview viewer. viewer.html is an entry point rather than a one-off copy so that watch mode picks up edits to it.
	const viewerCtx = await esbuild.context({
		entryPoints: [
			'src/viewer/viewer.ts',
			'src/viewer/viewer.html'
		],
		bundle: true,
		format: 'esm',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outdir: 'dist',
		loader: { '.html': 'copy' },
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await extensionCtx.watch();
		await viewerCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await viewerCtx.rebuild();
		await extensionCtx.dispose();
		await viewerCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
