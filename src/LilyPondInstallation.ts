import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

/**
 * Compares two version strings
 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
	const parts1 = v1.split('.').map(Number);
	const parts2 = v2.split('.').map(Number);

	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const num1 = parts1[i] || 0;
		const num2 = parts2[i] || 0;

		if (num1 < num2) {
			return -1;
		}
		if (num1 > num2) {
			return 1;
		}
	}

	return 0;
}

/**
 * Parses the version string from a LilyPond file
 * @param document The document to parse
 * @returns The version string or null if not found
 */
export function parseFileVersion(document: vscode.TextDocument): string | null {
	const text = document.getText();
	const versionMatch = text.match(/\\version\s+"(\d+\.\d+\.\d+)"/);
	return versionMatch ? versionMatch[1] : null;
}

/** Function type for running commands */
type CommandRunner = (command: string, args: string[]) => Promise<string>;

/**
 * Manages LilyPond installation detection and tracking.
 *
 * Uses lazy initialization - the instance is not created until the first .ly file is opened.
 * Components should subscribe to onDidBecomeReady and onDidInvalidate events to react to
 * installation state changes.
 */
export class LilyPondInstallation {
	// Singleton state
	private static instance: LilyPondInstallation | null = null;
	private static mockInstance: LilyPondInstallation | null = null;
	private static initializationPromise: Promise<LilyPondInstallation | null> | null = null;

	// Event emitters
	private static _onDidInvalidate = new vscode.EventEmitter<void>();
	private static _onDidBecomeReady = new vscode.EventEmitter<LilyPondInstallation>();

	/** Fired when the installation is invalidated (e.g., config changed) */
	public static readonly onDidInvalidate: vscode.Event<void> = LilyPondInstallation._onDidInvalidate.event;

	/** Fired when the installation becomes ready (version detected successfully) */
	public static readonly onDidBecomeReady: vscode.Event<LilyPondInstallation> = LilyPondInstallation._onDidBecomeReady.event;

	// Instance state
	private lilypondPath: string | null = null;
	private lilypondVersion: string | null = null;
	private pythonPath: string | null = null;
	private convertLyPath: string | null = null;
	private commandRunner: CommandRunner;

	private constructor() {
		this.commandRunner = this.defaultCommandRunner.bind(this);
	}

	/**
	 * Returns the current instance if ready, or null if not yet initialized.
	 * Does NOT trigger initialization - use ensureInitialized() for that.
	 */
	public static getInstance(): LilyPondInstallation | null {
		return LilyPondInstallation.mockInstance ?? LilyPondInstallation.instance;
	}

	/**
	 * Ensures an instance is initialized. Returns the instance when ready.
	 * If already initializing, returns the existing promise.
	 * If already initialized, returns immediately.
	 * This is the primary entry point for lazy initialization.
	 */
	public static async ensureInitialized(): Promise<LilyPondInstallation | null> {
		// Return mock if set (for testing)
		if (LilyPondInstallation.mockInstance) {
			return LilyPondInstallation.mockInstance;
		}

		// Return existing instance if ready
		if (LilyPondInstallation.instance) {
			return LilyPondInstallation.instance;
		}

		// Return existing promise if initialization in progress
		if (LilyPondInstallation.initializationPromise) {
			return LilyPondInstallation.initializationPromise;
		}

		// Start new initialization
		LilyPondInstallation.initializationPromise = LilyPondInstallation.doInitialize();
		return LilyPondInstallation.initializationPromise;
	}

	/**
	 * Invalidates the current instance. Called when config changes.
	 * Fires onDidInvalidate event, then creates new instance if .ly file is open.
	 */
	public static invalidate(): void {
		if (LilyPondInstallation.instance) {
			LilyPondInstallation.instance = null;
		}
		LilyPondInstallation.initializationPromise = null;

		// Fire invalidation event
		LilyPondInstallation._onDidInvalidate.fire();

		// Re-initialize if a .ly file is open
		if (LilyPondInstallation.hasOpenLilyPondFile()) {
			LilyPondInstallation.ensureInitialized();
		}
	}

	/**
	 * Checks if any LilyPond file is currently open
	 */
	private static hasOpenLilyPondFile(): boolean {
		return vscode.workspace.textDocuments.some(
			doc => doc.languageId === 'lilypond'
		);
	}

	/**
	 * Performs the actual initialization
	 */
	private static async doInitialize(): Promise<LilyPondInstallation | null> {
		const instance = new LilyPondInstallation();

		try {
			const version = await instance.detectVersion();

			if (version) {
				LilyPondInstallation.instance = instance;
				LilyPondInstallation._onDidBecomeReady.fire(instance);
				return instance;
			} else {
				// Detection returned null - show error
				vscode.window.showErrorMessage(
					'Failed to detect LilyPond version. Please check your lilypondStudio.executablePath setting.'
				);
				return null;
			}
		} catch (error) {
			// Show error to user (centralized error handling)
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(
				`Failed to initialize LilyPond: ${message}`
			);
			return null;
		} finally {
			LilyPondInstallation.initializationPromise = null;
		}
	}

	/**
	 * Sets a mock instance for testing. Must be called BEFORE any code calls
	 * getInstance() or ensureInitialized().
	 * @param fireReadyEvent If true, fires the onDidBecomeReady event (default: false)
	 */
	public static setMockInstance(mock: LilyPondInstallation | null): void {
		LilyPondInstallation.mockInstance = mock;
		if (mock) {
			LilyPondInstallation._onDidBecomeReady.fire(mock);
		}
	}

	/**
	 * Creates a mock instance with pre-configured values for testing.
	 * Does not run any real commands.
	 */
	public static createMockInstance(config: {
		version: string;
		executablePath: string;
	}): LilyPondInstallation {
		const instance = new LilyPondInstallation();
		instance.lilypondVersion = config.version;
		instance.lilypondPath = config.executablePath;
		instance.pythonPath = 'mock-python';
		instance.convertLyPath = 'mock-convert-ly';
		return instance;
	}

	/**
	 * Resets all static state (for test cleanup).
	 */
	public static resetForTesting(): void {
		LilyPondInstallation.mockInstance = null;
		if (LilyPondInstallation.instance) {
			LilyPondInstallation.instance = null;
		}
		LilyPondInstallation.initializationPromise = null;
	}

	/**
	 * Disposes the event emitters. Call when extension deactivates.
	 */
	public static disposeEvents(): void {
		LilyPondInstallation._onDidInvalidate.dispose();
		LilyPondInstallation._onDidBecomeReady.dispose();
	}

	/**
	 * Gets the LilyPond executable path from configuration
	 */
	public getExecutablePath(): string {
		const config = vscode.workspace.getConfiguration('lilypondStudio');
		return config.get<string>('executablePath') || 'lilypond';
	}

	/**
	 * Detects the LilyPond version and paths to python.exe and convert-ly.py
	 * @returns The detected version string or null if detection failed
	 */
	private async detectVersion(): Promise<string | null> {
		const lilypondExePath = this.getExecutablePath();

		// Run lilypond --version
		const versionOutput = await this.commandRunner(lilypondExePath, ['--version']);

		// Parse version from first line: "GNU LilyPond 2.24.1 (running Guile 2.2)"
		const versionMatch = versionOutput.match(/GNU LilyPond\s+(\d+\.\d+\.\d+)/);
		if (!versionMatch) {
			console.error('Failed to parse LilyPond version from output:', versionOutput);
			return null;
		}

		this.lilypondVersion = versionMatch[1];
		this.lilypondPath = lilypondExePath;

		// Determine paths to python.exe and convert-ly.py
		// LilyPond executable is typically at: <install-dir>/bin/lilypond.exe
		// python.exe is at: <install-dir>/bin/python.exe
		// convert-ly.py is at: <install-dir>/bin/convert-ly.py
		const binDir = path.dirname(lilypondExePath);
		this.pythonPath = path.join(binDir, 'python.exe');
		this.convertLyPath = path.join(binDir, 'convert-ly.py');

		console.log(`Detected LilyPond version: ${this.lilypondVersion}`);
		console.log(`Python path: ${this.pythonPath}`);
		console.log(`convert-ly path: ${this.convertLyPath}`);

		return this.lilypondVersion;
	}

	/**
	 * Gets the currently detected LilyPond version
	 */
	public getVersion(): string | null {
		return this.lilypondVersion;
	}

	/**
	 * Default command runner using child_process
	 */
	private defaultCommandRunner(command: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			cp.execFile(command, args, (error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			});
		});
	}

	/**
	 * Determines the path to the lilypond-words file
	 */
	private getWordsFilePath(): string | null {
		if (!this.lilypondVersion || !this.lilypondPath) {
			return null;
		}

		// LilyPond executable is typically at: <install-dir>/bin/lilypond.exe
		// Words file is at: <install-dir>/share/lilypond/<version>/vim/syntax/lilypond-words
		const binDir = path.dirname(this.lilypondPath);
		const installDir = path.dirname(binDir);
		const wordsFilePath = path.join(
			installDir,
			'share',
			'lilypond',
			this.lilypondVersion,
			'vim',
			'syntax',
			'lilypond-words'
		);

		return wordsFilePath;
	}

	/**
	 * Reads the lilypond-words file and yields lines one at a time
	 * @throws Error if the file path cannot be determined or the file is not accessible
	 */
	public async readWordsFile(): Promise<AsyncIterable<string>> {
		const wordsFilePath = this.getWordsFilePath();
		if (!wordsFilePath) {
			throw new Error('Could not determine lilypond-words file path');
		}

		const fileStream = fs.createReadStream(wordsFilePath, { encoding: 'utf-8' });
		const rl = readline.createInterface({
			input: fileStream,
			crlfDelay: Infinity
		});

		async function* generateWords() {
			for await (const line of rl) {
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					yield trimmed;
				}
			}
		}

		return generateWords();
	}

	/**
	 * Runs convert-ly on a file
	 * @param filePath Path to the .ly file to convert
	 * @param outputChannel Optional output channel to write command output to
	 */
	public async runConvertLy(filePath: string, outputChannel?: vscode.OutputChannel): Promise<void> {
		if (!this.pythonPath || !this.convertLyPath) {
			throw new Error('Python or convert-ly paths not available');
		}

		return new Promise((resolve, reject) => {
			const process = cp.spawn(this.pythonPath!, [this.convertLyPath!, '-e', '-c', filePath]);

			if (outputChannel) {
				outputChannel.appendLine(`Running: ${this.pythonPath} ${this.convertLyPath} -e ${filePath}`);
				outputChannel.appendLine('');

				process.stdout.on('data', (data) => {
					outputChannel.append(data.toString());
				});

				process.stderr.on('data', (data) => {
					outputChannel.append(data.toString());
				});
			}

			process.on('close', (code) => {
				if (code === 0) {
					if (outputChannel) {
						outputChannel.appendLine('');
						outputChannel.appendLine('convert-ly completed successfully');
					}
					resolve();
				} else {
					const error = new Error(`convert-ly exited with code ${code}`);
					reject(error);
				}
			});

			process.on('error', (error) => {
				reject(error);
			});
		});
	}
}
