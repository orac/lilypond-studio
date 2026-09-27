import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './log';
import { sourceFileKey, type TexteditTarget } from './shared/texteditUri';
import type { HostMessage, ViewerMessage } from './shared/viewerMessages';

/** A self-contained page describing why the viewer could not start.
 *
 * Deliberately uses no scripts, stylesheets or fonts: it has to render in exactly the situation where loading the viewer's own resources is what failed.
 */
function errorPageHtml(error: unknown): string {
	const detail = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
	const escaped = detail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>PDF Preview</title></head>
<body style="font-family: var(--vscode-font-family); padding: 2em;">
	<h2>The PDF preview failed to load</h2>
	<p>Please report this, quoting the details below and the contents of the <strong>LilyPond Studio</strong> output channel (View &rarr; Output).</p>
	<pre style="white-space: pre-wrap; user-select: text;">${escaped}</pre>
</body>
</html>`;
}

/** Builds the webview options for a panel showing `pdfUri`.
 *
 * Everything the webview loads lives under `dist/` — the bundled viewer script, the HTML template, and the third-party assets that `esbuild.js` copies out of `node_modules`, which is not packaged into the VSIX. The PDF's own directory has to be granted separately since it is outside the extension.
 */
function webviewOptions(extensionUri: vscode.Uri, pdfUri: vscode.Uri): vscode.WebviewOptions {
	return {
		enableScripts: true,
		localResourceRoots: [
			vscode.Uri.joinPath(extensionUri, 'dist'),
			vscode.Uri.file(path.dirname(pdfUri.fsPath)),
		],
	};
}

/** The editors, among those on screen, showing the source file `filePath`. */
function visibleEditorsFor(filePath: string): vscode.TextEditor[] {
	const key = sourceFileKey(filePath);
	return vscode.window.visibleTextEditors.filter(editor => sourceFileKey(editor.document.uri.fsPath) === key);
}

/** Drives one PDF viewer webview: point-and-click in both directions, and reloading when the PDF changes.
 *
 * Each open PDF has its own, independent of the others. Point-and-click works with every source file the PDF has links into, not only the one it was engraved from, so selecting text in an `\include`d file highlights its notation too.
 */
export class PdfViewerPanel {
	/** Every viewer currently open. */
	private static readonly all = new Set<PdfViewerPanel>();

	/** The source `.ly` file behind the PDF preview, if that preview is the focused tab.
	 *
	 * Used so that a build task requested with the preview focused (shift+cmd+B on macOS, where a webview holds focus and `activeTextEditor` is undefined) still knows which file to engrave.
	 */
	public static get activeSourceUri(): vscode.Uri | undefined {
		return [...PdfViewerPanel.all].find(viewer => viewer.panel.active)?.sourceUri;
	}

	/** Whether a PDF on screen already has point-and-click links into `sourceUri`. */
	public static isSourceVisible(sourceUri: vscode.Uri): boolean {
		const key = sourceFileKey(sourceUri.fsPath);
		return [...PdfViewerPanel.all].some(viewer => viewer.panel.visible && viewer.sourceKeys.has(key));
	}

	/** The {@link sourceFileKey}s of the files this PDF's links point into, as reported by the webview once it has loaded. */
	private sourceKeys = new Set<string>();
	private readonly disposables: vscode.Disposable[] = [];
	private hoverDecorationType: vscode.TextEditorDecorationType | undefined;

	/** Takes charge of `panel`, which must be showing nothing else, until the panel is disposed.
	 *
	 * @param sourceUri the score the PDF was engraved from, if known, which is what a build task run from the viewer engraves
	 */
	public constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private readonly pdfUri: vscode.Uri,
		private readonly sourceUri: vscode.Uri | undefined,
	) {
		PdfViewerPanel.all.add(this);
		this.panel.webview.options = webviewOptions(extensionUri, pdfUri);
		this.update();

		this.disposables.push(
			this.panel.onDidDispose(() => this.dispose()),
			this.panel.webview.onDidReceiveMessage((message: ViewerMessage) => this.handleMessage(message)),
			vscode.window.onDidChangeTextEditorSelection(e => this.syncSelection(e.textEditor)),
			this.watchPdf(),
		);
	}

	private dispose() {
		PdfViewerPanel.all.delete(this);
		this.clearHoverDecoration();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private postMessage(message: HostMessage) {
		this.panel.webview.postMessage(message);
	}

	private handleMessage(message: ViewerMessage) {
		switch (message.type) {
			case 'click':
				this.handlePdfClick(message.target);
				return;
			case 'hover':
				this.handlePdfHover(message.target);
				return;
			case 'unhover':
				this.clearHoverDecoration();
				return;
			case 'ready':
				this.sourceKeys = new Set(message.sourceFiles.map(sourceFileKey));
				if (vscode.window.activeTextEditor) {
					this.syncSelection(vscode.window.activeTextEditor);
				}
				return;
			case 'error':
				log.error(`PDF viewer webview: ${message.message}`);
				vscode.window.showErrorMessage(`PDF Viewer: ${message.message}`, 'Show Log')
					.then(choice => {
						if (choice === 'Show Log') {
							log.show();
						}
					});
				return;
			case 'log':
				log.debug(`PDF viewer webview: ${message.message}`);
				return;
		}
	}

	/** Opens the source file a link in the PDF points to, with the linked item selected.
	 *
	 * An editor already showing the file is reused; otherwise it opens where the LilyPond source is being edited.
	 */
	private async handlePdfClick(target: TexteditTarget) {
		try {
			const key = sourceFileKey(target.filePath);
			// Reusing an open document matters on case-insensitive file systems, where the link may not spell the path the way VS Code does.
			const uri = vscode.workspace.textDocuments.find(document => sourceFileKey(document.uri.fsPath) === key)?.uri ?? vscode.Uri.file(target.filePath);
			const column = visibleEditorsFor(target.filePath)[0]?.viewColumn
				?? vscode.window.visibleTextEditors.find(editor => editor.document.languageId === 'lilypond')?.viewColumn
				?? vscode.ViewColumn.One;
			const editor = await vscode.window.showTextDocument(uri, { viewColumn: column });

			const range = this.targetRange(target);
			editor.selection = new vscode.Selection(range.start, range.end);
			editor.revealRange(range, vscode.TextEditorRevealType.Default);
		} catch (error) {
			vscode.window.showErrorMessage(`Could not open ${target.filePath} at line ${target.line}`);
			log.error('Point-and-click error', error);
		}
	}

	/** Highlights the item a hovered link points to, in every visible editor showing its file. */
	private handlePdfHover(target: TexteditTarget) {
		this.clearHoverDecoration();
		const editors = visibleEditorsFor(target.filePath);
		if (editors.length === 0) {
			return;
		}
		this.hoverDecorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
			border: '1px solid',
			borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
		});
		for (const editor of editors) {
			editor.setDecorations(this.hoverDecorationType, [this.targetRange(target)]);
		}
	}

	private targetRange(target: TexteditTarget): vscode.Range {
		// LilyPond's lines are 1-based.
		return new vscode.Range(target.line - 1, target.charStart, target.line - 1, target.charEnd);
	}

	private clearHoverDecoration() {
		this.hoverDecorationType?.dispose();
		this.hoverDecorationType = undefined;
	}

	/** Highlights the notation for `editor`'s selection, if this PDF has links into its file. */
	private syncSelection(editor: vscode.TextEditor) {
		const filePath = editor.document.uri.fsPath;
		if (!this.sourceKeys.has(sourceFileKey(filePath))) {
			return;
		}
		const { start, end } = editor.selection;
		this.postMessage({
			type: 'sync',
			range: {
				filePath,
				startLine: start.line + 1,
				startChar: start.character,
				endLine: end.line + 1,
				endChar: end.character,
			},
		});
	}

	private watchPdf(): vscode.Disposable {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(this.pdfUri.fsPath)), path.basename(this.pdfUri.fsPath)));
		watcher.onDidChange(() => this.postMessage({ type: 'reload' }));
		watcher.onDidDelete(() => vscode.window.showWarningMessage(`${path.basename(this.pdfUri.fsPath)} was deleted`));
		return watcher;
	}

	/** Renders the viewer into the panel.
	 *
	 * Failures here are caught and turned into a visible error page: if the HTML is never assigned the panel just sits there empty, which tells neither the user nor us anything at all.
	 */
	private update() {
		try {
			this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
		} catch (error) {
			log.error('Failed to build the PDF viewer HTML', error);
			this.panel.webview.html = errorPageHtml(error);
		}
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');
		const assetUri = (...segments: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(distUri, ...segments)).toString();

		const pdfjsUri = assetUri('vendor', 'pdf.mjs');
		const pdfjsWorkerUri = assetUri('vendor', 'pdf.worker.mjs');
		const toolkitUri = assetUri('vendor', 'elements.js');
		const codiconsUri = assetUri('vendor', 'codicon.css');
		const viewerScriptUri = assetUri('viewer.js');

		// Get URI for the PDF file
		const pdfFileUri = webview.asWebviewUri(this.pdfUri);

		// Read the HTML template
		const htmlPath = vscode.Uri.joinPath(distUri, 'viewer.html');
		const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

		// Prepare configuration as JSON
		const config = {
			pdfUrl: pdfFileUri.toString(),
			pdfjsUri,
			pdfjsWorkerUri,
		};

		// Replace placeholders in the HTML template
		return htmlContent
			.replace(/{{cspSource}}/g, webview.cspSource)
			.replace('{{codiconsUri}}', codiconsUri)
			.replace('{{toolkitUri}}', toolkitUri)
			.replace('{{viewerScriptUri}}', viewerScriptUri)
			.replace('{{viewerConfig}}', JSON.stringify(config).replace(/"/g, '&quot;'));
	}
}
