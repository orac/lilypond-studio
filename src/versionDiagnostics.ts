import * as vscode from 'vscode';
import { LilyPondInstallation, parseFileVersion, compareVersions } from './LilyPondInstallation';

export class VersionDiagnosticsProvider {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private lastDiagnosticCodes = new Map<string, vscode.Diagnostic['code'][]>();

	constructor() {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection('lilypond-version');
	}

	public updateDiagnostics(document: vscode.TextDocument): void {
		if (document.languageId !== 'lilypond') {
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const fileVersion = parseFileVersion(document);
		const lilypondVersion = LilyPondInstallation.getInstance()?.getVersion() ?? null;

		if (!fileVersion) {
			// Suppress our diagnostic if the task runner has already reported this
			const existing = vscode.languages.getDiagnostics(document.uri);
			const taskReported = existing.some(d => d.message.includes('no \\version statement found'));
			if (!taskReported) {
				const firstLine = document.lineAt(0);
				const range = new vscode.Range(0, 0, 0, firstLine.text.length);
				const diagnostic = new vscode.Diagnostic(
					range,
					'No \\version statement found',
					vscode.DiagnosticSeverity.Warning
				);
				diagnostic.code = 'missing-version';
				diagnostic.source = 'lilypond';
				diagnostics.push(diagnostic);
			}
		} else if (lilypondVersion && compareVersions(fileVersion, lilypondVersion) < 0) {
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

		this.setIfChanged(document.uri, diagnostics);
	}

	// Only calls diagnosticCollection.set() when the codes actually change, preventing
	// the onDidChangeDiagnostics handler from re-triggering itself indefinitely.
	private setIfChanged(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
		const key = uri.toString();
		const newCodes = diagnostics.map(d => d.code);
		const lastCodes = this.lastDiagnosticCodes.get(key);
		const codeKey = (c: vscode.Diagnostic['code']) =>
			c !== null && typeof c === 'object' ? c.value : c;
		if (lastCodes !== undefined &&
			newCodes.length === lastCodes.length &&
			newCodes.every((c, i) => codeKey(c) === codeKey(lastCodes[i]))) {
			return;
		}
		this.lastDiagnosticCodes.set(key, newCodes);
		this.diagnosticCollection.set(uri, diagnostics);
	}

	public clearDiagnostics(document: vscode.TextDocument): void {
		this.lastDiagnosticCodes.delete(document.uri.toString());
		this.diagnosticCollection.delete(document.uri);
	}

	public getDiagnosticCollection(): vscode.DiagnosticCollection {
		return this.diagnosticCollection;
	}

	public updateAllDiagnostics(): void {
		vscode.workspace.textDocuments.forEach(document => {
			if (document.languageId === 'lilypond') {
				this.updateDiagnostics(document);
			}
		});
	}
}

export function registerVersionDiagnostics(context: vscode.ExtensionContext): VersionDiagnosticsProvider {
	const diagnosticsProvider = new VersionDiagnosticsProvider();

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

	// Re-evaluate when the task runner adds or removes diagnostics for a document,
	// so we can suppress our own diagnostic if the build has already reported it.
	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(event => {
			event.uris.forEach(uri => {
				const document = vscode.workspace.textDocuments.find(
					doc => doc.uri.toString() === uri.toString()
				);
				if (document) {
					diagnosticsProvider.updateDiagnostics(document);
				}
			});
		})
	);

	vscode.workspace.textDocuments.forEach(document => {
		diagnosticsProvider.updateDiagnostics(document);
	});

	context.subscriptions.push(diagnosticsProvider.getDiagnosticCollection());

	return diagnosticsProvider;
}
