import * as vscode from 'vscode';
import * as fs from 'fs';
import { PdfViewerPanel } from './pdfViewer';

export class PdfCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new PdfCustomEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(
			'lilypondStudio.pdfPreview',
			provider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			}
		);
		return providerRegistration;
	}

	constructor(private readonly context: vscode.ExtensionContext) { }

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: vscode.CustomDocumentOpenContext,
		token: vscode.CancellationToken
	): Promise<vscode.CustomDocument> {
		return { uri, dispose: () => { } };
	}

	async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
		token: vscode.CancellationToken
	): Promise<void> {
		// Check if there's a corresponding .ly file
		const pdfPath = document.uri.fsPath;
		const lyPath = pdfPath.replace(/\.pdf$/, '.ly');

		// If the .ly file exists, open it in the editor
		if (fs.existsSync(lyPath)) {
			const lyUri = vscode.Uri.file(lyPath);

			// Open the .ly file first
			await vscode.window.showTextDocument(lyUri, {
				viewColumn: vscode.ViewColumn.One,
				preserveFocus: false
			});

			// Use the provided webview panel for our PDF viewer
			PdfViewerPanel.createOrShowWithPanel(
				this.context.extensionUri,
				document.uri,
				webviewPanel,
				lyUri
			);
		} else {
			// No corresponding .ly file, just show the PDF in our viewer
			// Use the provided webview panel
			PdfViewerPanel.createOrShowWithPanel(
				this.context.extensionUri,
				document.uri,
				webviewPanel,
				undefined
			);
		}
	}
}
