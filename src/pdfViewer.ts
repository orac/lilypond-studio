import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

	public static createOrShow(extensionUri: vscode.Uri, pdfUri: vscode.Uri, sourceUri?: vscode.Uri) {
		const column = vscode.ViewColumn.Beside;

		// If we already have a panel, show it and update the PDF
		if (PdfViewerPanel.currentPanel) {
			// Clear hover decoration when changing to a different file
			PdfViewerPanel.currentPanel.clearHoverDecoration();

			PdfViewerPanel.currentPanel.pdfUri = pdfUri;
			PdfViewerPanel.currentPanel.sourceUri = sourceUri;

			// Update localResourceRoots to include the new PDF directory
			const pdfDir = vscode.Uri.file(path.dirname(pdfUri.fsPath));
			PdfViewerPanel.currentPanel.panel.webview.options = {
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist'),
					vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit'),
					vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons'),
					vscode.Uri.joinPath(extensionUri, 'dist'),
					pdfDir
				]
			};

			PdfViewerPanel.currentPanel.panel.reveal(column, true);
			PdfViewerPanel.currentPanel.update();
			PdfViewerPanel.currentPanel.setupEditorSync();
			PdfViewerPanel.currentPanel.setupFileWatcher();
			return;
		}

		// Get the directory containing the PDF for localResourceRoots
		const pdfDir = vscode.Uri.file(path.dirname(pdfUri.fsPath));

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			'lilypondPdfPreview',
			'PDF Preview',
			{ viewColumn: column, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist'),
					vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit'),
					vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons'),
					vscode.Uri.joinPath(extensionUri, 'dist'),
					pdfDir
				]
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
						vscode.window.showErrorMessage(`PDF Viewer: ${message.message}`);
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

	private async handlePdfClick(uri: string) {
		// Parse textedit:// URI format: textedit:///path/to/file.ly:line:char:char
		if (!uri.startsWith('textedit://')) {
			return;
		}

		try {
			// Match the textedit:// URI format
			// Captures: file path, line number, start char, end char
			const match = uri.match(/^textedit:\/\/(.+):(\d+):(\d+):(\d+)$/);
			if (!match) {
				throw new Error('Invalid textedit URI format');
			}

			const [, encodedFilePath, lineStr, charStartStr, charEndStr] = match;

			// Decode URL-encoded characters (like %20 for spaces)
			const decodedFilePath = decodeURIComponent(encodedFilePath);
			const [line, charStart, charEnd] = [lineStr, charStartStr, charEndStr].map(str => parseInt(str, 10));

			// Open the source file
			const fileUri = vscode.Uri.file(decodedFilePath);
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
			console.error('Point-and-click error:', error);
		}
	}

	private async handlePdfHover(uri: string) {
		// Parse textedit:// URI format: textedit:///path/to/file.ly:line:char:char
		if (!uri.startsWith('textedit://')) {
			return;
		}

		try {
			// Match the textedit:// URI format
			const match = uri.match(/^textedit:\/\/(.+):(\d+):(\d+):(\d+)$/);
			if (!match) {
				return;
			}

			const [, encodedFilePath, lineStr, charStartStr, charEndStr] = match;

			// Decode URL-encoded characters (like %20 for spaces)
			const decodedFilePath = decodeURIComponent(encodedFilePath);
			const [line, charStart, charEnd] = [lineStr, charStartStr, charEndStr].map(str => parseInt(str, 10));

			// Check if this is the current source file
			const fileUri = vscode.Uri.file(decodedFilePath);
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
			console.error('Hover decoration error:', error);
		}
	}

	private clearHoverDecoration() {
		if (this.hoverDecorationType) {
			this.hoverDecorationType.dispose();
			this.hoverDecorationType = undefined;
		}
	}

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

	private syncCurrentPosition() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !this.sourceUri || editor.document.uri.fsPath !== this.sourceUri.fsPath) {
			return;
		}

		const position = editor.selection.active;
		const line = position.line + 1; // Convert to 1-based
		const char = position.character;

		// Send sync message to webview
		this.panel.webview.postMessage({
			type: 'sync',
			line: line,
			char: char
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

	private update() {
		const webview = this.panel.webview;
		this.panel.webview.html = this.getHtmlForWebview(webview);
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		// Get URIs for PDF.js resources
		const pdfjsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs')
		);
		const pdfjsWorkerUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs')
		);

		// Get URI for the PDF file
		const pdfFileUri = webview.asWebviewUri(this.pdfUri);

		// Get URIs for viewer resources
		const viewerScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'viewer.js')
		);

		// Get URI for the webview UI toolkit
		const toolkitUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js')
		);

		// Get URI for Codicons CSS
		const codiconsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
		);

		// Read the HTML template
		const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'viewer', 'viewer.html');
		const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

		// Prepare configuration as JSON
		const config = {
			pdfUrl: pdfFileUri.toString(),
			pdfjsUri: pdfjsUri.toString(),
			pdfjsWorkerUri: pdfjsWorkerUri.toString(),
		};

		// Replace placeholders in the HTML template
		return htmlContent
			.replace(/{{cspSource}}/g, webview.cspSource)
			.replace('{{codiconsUri}}', codiconsUri.toString())
			.replace('{{toolkitUri}}', toolkitUri.toString())
			.replace('{{viewerScriptUri}}', viewerScriptUri.toString())
			.replace('{{pdfjsWorkerUri}}', pdfjsWorkerUri.toString())
			.replace('{{viewerConfig}}', JSON.stringify(config).replace(/"/g, '&quot;'));
	}
}
