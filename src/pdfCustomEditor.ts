import * as vscode from 'vscode';
import * as fs from 'fs';
import { PdfViewerPanel } from './pdfViewer';
import { findPdfForSource } from './outputPaths';
import { sourceFileKey } from './shared/texteditUri';

const viewType = 'lilypondStudio.pdfPreview';

/** The score each PDF was last previewed for, keyed by the PDF's {@link sourceFileKey}.
 *
 * {@link showPdfPreviewFor} opens PDFs through `vscode.openWith`, which has no way to pass anything to the custom editor, so it leaves a note here instead.
 */
const sourceForPdf = new Map<string, vscode.Uri>();

/** Opens the PDF engraved from the score in `editor` in the preview tab beside it, if it has been engraved.
 *
 * The tab opens in preview mode, so looking at another score replaces it, as with any other preview tab; pinning it keeps it open. Nothing happens if a PDF on screen already has point-and-click links into the score: looking at an `\include`d file keeps the score that includes it in view. `editor`'s tab group stays active, so the explorer and anything else that follows the active editor stay on the score.
 */
export async function showPdfPreviewFor(editor: vscode.TextEditor): Promise<void> {
	const sourceUri = editor.document.uri;
	if (PdfViewerPanel.isSourceVisible(sourceUri)) {
		return;
	}
	const pdfPath = findPdfForSource(sourceUri);
	if (!pdfPath) {
		return;
	}
	const pdfUri = vscode.Uri.file(pdfPath);
	const pdfKey = sourceFileKey(pdfPath);
	sourceForPdf.set(pdfKey, sourceUri);

	// An existing tab is revealed where it is; a new one replaces whichever of our previews is already open, wherever the user has put it.
	const groups = vscode.window.tabGroups.all;
	const isThisPdf = (tab: vscode.Tab) => isOurTab(tab) && sourceFileKey(tab.input.uri.fsPath) === pdfKey;
	if (groups.some(group => group.activeTab && isThisPdf(group.activeTab))) {
		// Already on screen, although its viewer may not have said yet which files it links into.
		return;
	}
	const existing = groups.find(group => group.tabs.some(isThisPdf));
	const preview = groups.find(group => group.tabs.some(tab => isOurTab(tab) && tab.isPreview));
	await vscode.commands.executeCommand('vscode.openWith', pdfUri, viewType, {
		viewColumn: (existing ?? preview)?.viewColumn ?? vscode.ViewColumn.Beside,
		preserveFocus: true,
		preview: true,
	} satisfies vscode.TextDocumentShowOptions);

	// Opening an editor in a named group activates that group even with preserveFocus, and the API has no way to ask otherwise.
	if (editor.viewColumn !== undefined && vscode.window.tabGroups.activeTabGroup.viewColumn !== editor.viewColumn) {
		await vscode.window.showTextDocument(editor.document, {
			viewColumn: editor.viewColumn,
			preserveFocus: true,
		});
	}
}

function isOurTab(tab: vscode.Tab): tab is vscode.Tab & { input: vscode.TabInputCustom } {
	return tab.input instanceof vscode.TabInputCustom && tab.input.viewType === viewType;
}

/** Shows PDFs in {@link PdfViewerPanel}s, whether the user opens one with "Open With…" or {@link showPdfPreviewFor} opens it. */
export class PdfCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			viewType,
			new PdfCustomEditorProvider(context),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			}
		);
	}

	private constructor(private readonly context: vscode.ExtensionContext) { }

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => { } };
	}

	/** Shows the PDF, and if the user opened it themselves, the `.ly` file beside it too. */
	async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
		const previewedFor = sourceForPdf.get(sourceFileKey(document.uri.fsPath));
		const siblingPath = document.uri.fsPath.replace(/\.pdf$/i, '.ly');
		const sibling = fs.existsSync(siblingPath) ? vscode.Uri.file(siblingPath) : undefined;

		new PdfViewerPanel(webviewPanel, this.context.extensionUri, document.uri, previewedFor ?? sibling);

		const siblingKey = sibling && sourceFileKey(sibling.fsPath);
		if (!previewedFor && sibling && !vscode.window.visibleTextEditors.some(editor => sourceFileKey(editor.document.uri.fsPath) === siblingKey)) {
			await vscode.window.showTextDocument(sibling, { viewColumn: vscode.ViewColumn.One });
		}
	}
}
