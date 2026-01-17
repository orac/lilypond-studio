import * as vscode from 'vscode';
import { VersionManager, parseFileVersion, compareVersions } from './versionManager';

/**
 * Provides diagnostics for outdated LilyPond version directives
 */
export class VersionDiagnosticsProvider {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private versionManager: VersionManager;

	constructor() {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection('lilypond-version');
		this.versionManager = VersionManager.getInstance();
	}

	/**
	 * Analyzes a document and updates diagnostics
	 */
	public updateDiagnostics(document: vscode.TextDocument): void {
		if (document.languageId !== 'lilypond') {
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const fileVersion = parseFileVersion(document);
		const lilypondVersion = this.versionManager.getVersion();

		// Only create diagnostic if both versions are available and file version is outdated
		if (fileVersion && lilypondVersion && compareVersions(fileVersion, lilypondVersion) < 0) {
			const versionMatch = document.getText().match(/\\version\s+"(\d+\.\d+\.\d+)"/);
			if (versionMatch && versionMatch.index !== undefined) {
				const startPos = document.positionAt(versionMatch.index);
				const endPos = document.positionAt(versionMatch.index + versionMatch[0].length);
				const range = new vscode.Range(startPos, endPos);

				const diagnostic = new vscode.Diagnostic(
					range,
					`LilyPond version ${fileVersion} is older than installed version ${lilypondVersion} and can automatically be updated`,
					vscode.DiagnosticSeverity.Information
				);

				diagnostic.code = 'outdated-version';
				diagnostic.source = 'lilypond';

				diagnostics.push(diagnostic);
			}
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	/**
	 * Clears diagnostics for a document
	 */
	public clearDiagnostics(document: vscode.TextDocument): void {
		this.diagnosticCollection.delete(document.uri);
	}

	/**
	 * Gets the diagnostic collection
	 */
	public getDiagnosticCollection(): vscode.DiagnosticCollection {
		return this.diagnosticCollection;
	}

	/**
	 * Updates diagnostics for all open LilyPond documents
	 */
	public updateAllDiagnostics(): void {
		vscode.workspace.textDocuments.forEach(document => {
			if (document.languageId === 'lilypond') {
				this.updateDiagnostics(document);
			}
		});
	}
}

/**
 * Registers the version diagnostics provider
 */
export function registerVersionDiagnostics(context: vscode.ExtensionContext): VersionDiagnosticsProvider {
	const diagnosticsProvider = new VersionDiagnosticsProvider();

	// Update diagnostics when a document is opened or changed
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(document => {
			diagnosticsProvider.updateDiagnostics(document);
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			diagnosticsProvider.updateDiagnostics(event.document);
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(document => {
			diagnosticsProvider.clearDiagnostics(document);
		})
	);

	// Update diagnostics for already open documents
	vscode.workspace.textDocuments.forEach(document => {
		diagnosticsProvider.updateDiagnostics(document);
	});

	// Clean up diagnostic collection on deactivate
	context.subscriptions.push(diagnosticsProvider.getDiagnosticCollection());

	return diagnosticsProvider;
}
