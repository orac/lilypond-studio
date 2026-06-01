import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';
import { LilyPondInstallation } from './LilyPondInstallation';

/** Location of the bundled ly-lsp binary, relative to the extension root. */
const SERVER_RELATIVE_PATH = path.join('server', 'ly-lsp.exe');

/**
 * Manages the lifecycle of the ly-lsp language server.
 *
 * The server is a bundled native binary that speaks LSP over stdio. It reads
 * its `initializationOptions` once, at start-up — there's no dynamic config
 * update — so whenever the LilyPond installation or the include directories
 * change we restart the client to feed it fresh options. We pass the options
 * as a thunk so `restart()` re-evaluates them against the current state.
 *
 * Navigation and syntax diagnostics don't need a LilyPond installation, so the
 * client starts regardless; the words-file path (which enables
 * undefined-reference diagnostics) is supplied only once it's known.
 */
export class LilyPondLanguageClient {
	private client: LanguageClient | undefined;
	private readonly bundledServerPath: string;

	// Serialises start/stop/restart so they can't interleave. Without this, a
	// restart triggered while the initial start is still in-flight tries to
	// stop a client that's only `starting`, which throws and corrupts the
	// connection.
	private operation: Promise<void> = Promise.resolve();

	constructor(context: vscode.ExtensionContext) {
		this.bundledServerPath = context.asAbsolutePath(SERVER_RELATIVE_PATH);
	}

	/**
	 * Starts the client, unless it's already running or the binary is missing.
	 * Idempotent, so it's safe to call on every .ly file that's opened.
	 */
	public start(): Promise<void> {
		return this.enqueue(() => this.doStart());
	}

	/**
	 * Restarts a running client so it re-reads both its server path and its
	 * initialization options. Recreates from scratch rather than calling
	 * client.restart(), since the server path is baked into the client at
	 * construction. A no-op if the client hasn't been started yet — starting is
	 * the job of start().
	 */
	public restart(): Promise<void> {
		return this.enqueue(async () => {
			if (this.client) {
				await this.doStop();
				await this.doStart();
			}
		});
	}

	/**
	 * Starts the client if it's stopped, or restarts it if it's running, so it
	 * ends up running with the current options either way. Used when the
	 * LilyPond installation becomes ready: on first launch this is the initial
	 * start (now that the words path is known); on re-detection it's a restart.
	 */
	public refresh(): Promise<void> {
		return this.enqueue(async () => {
			if (this.client) {
				await this.doStop();
			}
			await this.doStart();
		});
	}

	/** Stops the client. Call when the extension deactivates. */
	public dispose(): Promise<void> {
		return this.enqueue(() => this.doStop());
	}

	/**
	 * Runs `task` after any in-flight lifecycle operation completes. Errors are
	 * logged rather than propagated, so a single failure neither rejects an
	 * unawaited caller nor poisons the queue for later operations.
	 */
	private enqueue(task: () => Promise<void>): Promise<void> {
		const run = this.operation.then(task, task).catch((error) => {
			console.error('LilyPond language server lifecycle error:', error);
		});
		this.operation = run;
		return run;
	}

	private async doStart(): Promise<void> {
		if (this.client) {
			return;
		}

		const serverPath = this.resolveServerPath();
		if (!fs.existsSync(serverPath)) {
			console.warn(
				`ly-lsp binary not found at ${serverPath}; language server features are disabled. ` +
				'Build the server crate and copy the binary into the extension\'s server/ directory, ' +
				'or set lilypondStudio.languageServerPath to a locally-built server.'
			);
			return;
		}

		const serverOptions: ServerOptions = {
			command: serverPath,
			transport: TransportKind.stdio,
		};

		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ language: 'lilypond' }],
			// A thunk, so restart() re-reads the words path and include dirs.
			initializationOptions: () => this.computeInitializationOptions(),
		};

		const client = new LanguageClient(
			'lilypondStudio.languageServer',
			'LilyPond Language Server',
			serverOptions,
			clientOptions,
		);

		// Only record the client once it's running, so a failed start doesn't
		// leave a half-dead client that blocks future starts.
		await client.start();
		this.client = client;
	}

	private async doStop(): Promise<void> {
		const client = this.client;
		this.client = undefined;
		if (client) {
			await client.dispose();
		}
	}

	/**
	 * The path to the server binary: a configured override if set, otherwise
	 * the binary bundled with the extension. The override lets you point at a
	 * locally-built server during development without copying it into server/.
	 */
	private resolveServerPath(): string {
		const override = vscode.workspace
			.getConfiguration('lilypondStudio')
			.get<string>('languageServerPath')
			?.trim();
		return override ? override : this.bundledServerPath;
	}

	private computeInitializationOptions(): Record<string, unknown> {
		const options: Record<string, unknown> = {};

		const wordsPath = LilyPondInstallation.getInstance()?.getWordsFilePath();
		if (wordsPath) {
			options.lilypondWordsPath = wordsPath;
		}

		options.includePaths =
			vscode.workspace.getConfiguration('lilypondStudio').get<string[]>('includeDirs') ?? [];

		return options;
	}
}
