import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PdfViewerPanel {
	public static currentPanel: PdfViewerPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _pdfUri: vscode.Uri;
	private _sourceUri: vscode.Uri | undefined;
	private _disposables: vscode.Disposable[] = [];
	private _editorChangeListener: vscode.Disposable | undefined;

	public static createOrShow(extensionUri: vscode.Uri, pdfUri: vscode.Uri, sourceUri?: vscode.Uri) {
		const column = vscode.ViewColumn.Beside;

		// If we already have a panel, show it and update the PDF
		if (PdfViewerPanel.currentPanel) {
			PdfViewerPanel.currentPanel._pdfUri = pdfUri;
			PdfViewerPanel.currentPanel._sourceUri = sourceUri;

			// Update localResourceRoots to include the new PDF directory
			const pdfDir = vscode.Uri.file(path.dirname(pdfUri.fsPath));
			PdfViewerPanel.currentPanel._panel.webview.options = {
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist'),
					vscode.Uri.joinPath(extensionUri, 'dist'),
					pdfDir
				]
			};

			PdfViewerPanel.currentPanel._panel.reveal(column, true);
			PdfViewerPanel.currentPanel._update();
			PdfViewerPanel.currentPanel._setupEditorSync();
			return;
		}

		// Get the directory containing the PDF for localResourceRoots
		const pdfDir = vscode.Uri.file(path.dirname(pdfUri.fsPath));

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			'lilypondPdfPreview',
			'PDF Preview',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist'),
					vscode.Uri.joinPath(extensionUri, 'dist'),
					pdfDir
				]
			}
		);

		PdfViewerPanel.currentPanel = new PdfViewerPanel(panel, extensionUri, pdfUri, sourceUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, pdfUri: vscode.Uri, sourceUri?: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._pdfUri = pdfUri;
		this._sourceUri = sourceUri;

		// Set the webview's initial html content
		this._update();

		// Set up editor sync for forward navigation
		this._setupEditorSync();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.type) {
					case 'click':
						this._handlePdfClick(message.uri);
						return;
					case 'ready':
						// PDF is loaded and ready for sync
						this._syncCurrentPosition();
						return;
					case 'error':
						vscode.window.showErrorMessage(`PDF Viewer: ${message.message}`);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public dispose() {
		PdfViewerPanel.currentPanel = undefined;

		// Clean up editor sync listener
		if (this._editorChangeListener) {
			this._editorChangeListener.dispose();
			this._editorChangeListener = undefined;
		}

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	private async _handlePdfClick(uri: string) {
		// Parse textedit:// URI format: textedit:///path/to/file.ly:line:char:char
		if (!uri.startsWith('textedit://')) {
			return;
		}

		try {
			// Remove textedit:// prefix
			const uriWithoutProtocol = uri.substring('textedit://'.length);

			// Split into path and position parts
			// Handle both Unix (/path/to/file.ly:line:char:char) and Windows (C:/path/to/file.ly:line:char:char)
			const lastColonIndex = uriWithoutProtocol.lastIndexOf(':');
			const secondLastColonIndex = uriWithoutProtocol.lastIndexOf(':', lastColonIndex - 1);
			const thirdLastColonIndex = uriWithoutProtocol.lastIndexOf(':', secondLastColonIndex - 1);

			const filePath = uriWithoutProtocol.substring(0, thirdLastColonIndex);
			const line = parseInt(uriWithoutProtocol.substring(thirdLastColonIndex + 1, secondLastColonIndex), 10);
			const char = parseInt(uriWithoutProtocol.substring(secondLastColonIndex + 1, lastColonIndex), 10);

			// Decode URL-encoded characters (like %20 for spaces)
			const decodedFilePath = decodeURIComponent(filePath);

			// Open the source file
			const fileUri = vscode.Uri.file(decodedFilePath);
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

			// Move cursor to the position (LilyPond uses 1-based line numbers)
			const position = new vscode.Position(line - 1, char);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(
				new vscode.Range(position, position),
				vscode.TextEditorRevealType.Default
			);

			// Brief highlight animation
			const decorationType = vscode.window.createTextEditorDecorationType({
				backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
				border: '1px solid',
				borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
			});

			editor.setDecorations(decorationType, [new vscode.Range(position, position.translate(0, 1))]);
			setTimeout(() => {
				decorationType.dispose();
			}, 500);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to parse point-and-click URI: ${uri}`);
			console.error('Point-and-click error:', error);
		}
	}

	private _setupEditorSync() {
		// Clean up existing listener
		if (this._editorChangeListener) {
			this._editorChangeListener.dispose();
		}

		// Listen to selection changes in the editor
		this._editorChangeListener = vscode.window.onDidChangeTextEditorSelection(e => {
			// Only sync if the active editor is the source file
			if (this._sourceUri && e.textEditor.document.uri.fsPath === this._sourceUri.fsPath) {
				this._syncCurrentPosition();
			}
		});
	}

	private _syncCurrentPosition() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !this._sourceUri || editor.document.uri.fsPath !== this._sourceUri.fsPath) {
			return;
		}

		const position = editor.selection.active;
		const line = position.line + 1; // Convert to 1-based
		const char = position.character;

		// Send sync message to webview
		this._panel.webview.postMessage({
			type: 'sync',
			line: line,
			char: char
		});
	}

	private _update() {
		const webview = this._panel.webview;
		this._panel.webview.html = this._getHtmlForWebview(webview);
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get URIs for PDF.js resources
		const pdfjsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs')
		);
		const pdfjsWorkerUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs')
		);

		// Get URI for the PDF file
		const pdfFileUri = webview.asWebviewUri(this._pdfUri);

		// Get URIs for viewer resources
		const viewerScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'dist', 'viewer.js')
		);

		// Read the HTML template
		const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer', 'viewer.html');
		const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

		// Prepare configuration as JSON
		const config = {
			pdfUrl: pdfFileUri.toString(),
			pdfjsUri: pdfjsUri.toString(),
			pdfjsWorkerUri: pdfjsWorkerUri.toString()
		};

		// Replace placeholders in the HTML template
		return htmlContent
			.replace(/{{cspSource}}/g, webview.cspSource)
			.replace('{{viewerScriptUri}}', viewerScriptUri.toString())
			.replace('{{viewerConfig}}', JSON.stringify(config).replace(/"/g, '&quot;'));
	}
}
