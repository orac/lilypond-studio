import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './log';

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

/** Manages a PDF viewer webview panel */
export class PdfViewerPanel {
	public static currentPanel: PdfViewerPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private pdfUri: vscode.Uri;
	private sourceUri: vscode.Uri | undefined;
	private disposables: vscode.Disposable[] = [];
	private editorChangeListener: vscode.Disposable | undefined;
	private hoverDecorationType: vscode.TextEditorDecorationType | undefined;
	private fileWatcher: vscode.FileSystemWatcher | undefined;

	public static createOrShowWithPanel(
		extensionUri: vscode.Uri,
		pdfUri: vscode.Uri,
		existingPanel: vscode.WebviewPanel,
		sourceUri?: vscode.Uri
	) {
		// Close any existing panel first
		if (PdfViewerPanel.currentPanel) {
			PdfViewerPanel.currentPanel.dispose();
		}

		// Set up the existing panel with our configuration
		existingPanel.webview.options = webviewOptions(extensionUri, pdfUri);

		existingPanel.title = path.basename(pdfUri.fsPath);

		PdfViewerPanel.currentPanel = new PdfViewerPanel(existingPanel, extensionUri, pdfUri, sourceUri);
	}

	public static createOrShow(extensionUri: vscode.Uri, pdfUri: vscode.Uri, sourceUri?: vscode.Uri) {
		const column = vscode.ViewColumn.Beside;

		// If we already have a panel, show it and update the PDF
		if (PdfViewerPanel.currentPanel) {
			// Clear hover decoration when changing to a different file
			PdfViewerPanel.currentPanel.clearHoverDecoration();

			PdfViewerPanel.currentPanel.pdfUri = pdfUri;
			PdfViewerPanel.currentPanel.sourceUri = sourceUri;

			// Update localResourceRoots to include the new PDF directory
			PdfViewerPanel.currentPanel.panel.webview.options = webviewOptions(extensionUri, pdfUri);

			// Update panel title to show the new PDF filename
			PdfViewerPanel.currentPanel.panel.title = path.basename(pdfUri.fsPath);

			PdfViewerPanel.currentPanel.panel.reveal(column, true);
			PdfViewerPanel.currentPanel.update();
			PdfViewerPanel.currentPanel.setupEditorSync();
			PdfViewerPanel.currentPanel.setupFileWatcher();
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			'lilypondPdfPreview',
			path.basename(pdfUri.fsPath),
			{ viewColumn: column, preserveFocus: true },
			{
				retainContextWhenHidden: true,
				...webviewOptions(extensionUri, pdfUri),
			}
		);

		PdfViewerPanel.currentPanel = new PdfViewerPanel(panel, extensionUri, pdfUri, sourceUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, pdfUri: vscode.Uri, sourceUri?: vscode.Uri) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.pdfUri = pdfUri;
		this.sourceUri = sourceUri;

		// Set the webview's initial html content
		this.update();

		// Set up editor sync for forward navigation
		this.setupEditorSync();

		// Set up file watcher for PDF changes
		this.setupFileWatcher();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		// Handle messages from the webview
		this.panel.webview.onDidReceiveMessage(
			message => {
				switch (message.type) {
					case 'click':
						this.handlePdfClick(message.uri);
						return;
					case 'hover':
						this.handlePdfHover(message.uri);
						return;
					case 'unhover':
						this.clearHoverDecoration();
						return;
					case 'ready':
						// PDF is loaded and ready for sync
						this.syncCurrentPosition();
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
			},
			null,
			this.disposables
		);
	}

	public dispose() {
		PdfViewerPanel.currentPanel = undefined;

		// Clean up hover decoration
		this.clearHoverDecoration();

		// Clean up editor sync listener
		if (this.editorChangeListener) {
			this.editorChangeListener.dispose();
			this.editorChangeListener = undefined;
		}

		// Clean up file watcher
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
			this.fileWatcher = undefined;
		}

		// Clean up our resources
		this.panel.dispose();

		while (this.disposables.length) {
			const disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	/** Parse a textedit:// URI into its constituent parts
	 * 
	 * @return The parsed components, or null if parsing failed or `uri` is not a textedit:// URI
	 */
	private parseTexteditUri(uri: string): { filePath: string; line: number; charStart: number; charEnd: number } | null {
		// Parse textedit:// URI format: textedit:///path/to/file.ly:line:char:char
		if (!uri.startsWith('textedit://')) {
			return null;
		}

		// Match the textedit:// URI format
		// Captures: file path, line number, start char, end char
		const match = uri.match(/^textedit:\/\/(.+):(\d+):(\d+):(\d+)$/);
		if (!match) {
			return null;
		}

		const [, encodedFilePath, lineStr, charStartStr, charEndStr] = match;

		// Decode URL-encoded characters (like %20 for spaces)
		const filePath = decodeURIComponent(encodedFilePath);
		const [line, charStart, charEnd] = [lineStr, charStartStr, charEndStr].map(str => parseInt(str, 10));

		return { filePath, line, charStart, charEnd };
	}

	/** Click handler for links in the PDF
	 */
	private async handlePdfClick(uri: string) {
		const parsed = this.parseTexteditUri(uri);
		if (!parsed) {
			return;
		}

		try {
			const { filePath, line, charStart, charEnd } = parsed;

			// Open the source file
			const fileUri = vscode.Uri.file(filePath);
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

			// Move cursor to the position (LilyPond uses 1-based line numbers)
			const startPosition = new vscode.Position(line - 1, charStart);
			const endPosition = new vscode.Position(line - 1, charEnd);
			editor.selection = new vscode.Selection(startPosition, endPosition);
			editor.revealRange(
				new vscode.Range(startPosition, endPosition),
				vscode.TextEditorRevealType.Default
			);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to parse point-and-click URI: ${uri}`);
			log.error('Point-and-click error', error);
		}
	}

	/** Hover handler for links in the PDF
	 * 
	 * Adds a box around the link, and sends the link target to the source editor to add a decoration there.
	 */
	private async handlePdfHover(uri: string) {
		const parsed = this.parseTexteditUri(uri);
		if (!parsed) {
			return;
		}

		try {
			const { filePath, line, charStart, charEnd } = parsed;

			// Check if this is the current source file
			const fileUri = vscode.Uri.file(filePath);
			const editor = vscode.window.activeTextEditor;

			if (!editor || editor.document.uri.fsPath !== fileUri.fsPath) {
				return;
			}

			// Clear any existing hover decoration
			this.clearHoverDecoration();

			// Create the hover decoration type
			this.hoverDecorationType = vscode.window.createTextEditorDecorationType({
				backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
				border: '1px solid',
				borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
			});

			// Apply the decoration (LilyPond uses 1-based line numbers)
			const startPosition = new vscode.Position(line - 1, charStart);
			const endPosition = new vscode.Position(line - 1, charEnd);
			editor.setDecorations(this.hoverDecorationType, [new vscode.Range(startPosition, endPosition)]);
		} catch (error) {
			log.error('Hover decoration error', error);
		}
	}

	private clearHoverDecoration() {
		if (this.hoverDecorationType) {
			this.hoverDecorationType.dispose();
			this.hoverDecorationType = undefined;
		}
	}

	/** Sets a listener for selection changes in the editor to sync the highlighting in the PDF */
	private setupEditorSync() {
		// Clean up existing listener
		if (this.editorChangeListener) {
			this.editorChangeListener.dispose();
		}

		// Listen to selection changes in the editor
		this.editorChangeListener = vscode.window.onDidChangeTextEditorSelection(e => {
			// Only sync if the active editor is the source file
			if (this.sourceUri && e.textEditor.document.uri.fsPath === this.sourceUri.fsPath) {
				this.syncCurrentPosition();
			}
		});
	}

	/** Sends a source file selection from the source editor to the webview */
	private syncCurrentPosition() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !this.sourceUri || editor.document.uri.fsPath !== this.sourceUri.fsPath) {
			return;
		}

		const selection = editor.selection;
		const startLine = selection.start.line + 1; // Convert to 1-based
		const startChar = selection.start.character;
		const endLine = selection.end.line + 1; // Convert to 1-based
		const endChar = selection.end.character;

		// Send sync message to webview with full range
		this.panel.webview.postMessage({
			type: 'sync',
			startLine: startLine,
			startChar: startChar,
			endLine: endLine,
			endChar: endChar
		});
	}

	private setupFileWatcher() {
		// Clean up existing watcher
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
		}

		// Create a file watcher for the PDF file
		const pattern = new vscode.RelativePattern(this.pdfUri, '*');
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		// Reload the PDF when it changes
		this.fileWatcher.onDidChange(() => {
			// Send reload message to webview
			this.panel.webview.postMessage({ type: 'reload' });
		});

		// Handle file deletion
		this.fileWatcher.onDidDelete(() => {
			vscode.window.showWarningMessage('PDF file was deleted');
		});
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
			.replace('{{pdfjsWorkerUri}}', pdfjsWorkerUri)
			.replace('{{viewerConfig}}', JSON.stringify(config).replace(/"/g, '&quot;'));
	}
}
