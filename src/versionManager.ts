import * as vscode from 'vscode';
import * as cp from 'child_process';
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

/** Function type for running commands */
type CommandRunner = (command: string, args: string[]) => Promise<string>;

/**
 * Manages LilyPond version detection and tracking
 */
export class VersionManager {
	private static instance: VersionManager;
	private static mockCommandRunner: CommandRunner | null = null;
	private lilypondVersion: string | null = null;
	private pythonPath: string | null = null;
	private convertLyPath: string | null = null;
	private commandRunner: CommandRunner;

	private constructor() {
		// Use mock if set, otherwise use default
		this.commandRunner = VersionManager.mockCommandRunner ?? this.defaultCommandRunner.bind(this);
	}

	public static getInstance(): VersionManager {
		if (!VersionManager.instance) {
			VersionManager.instance = new VersionManager();
		}
		return VersionManager.instance;
	}

	/**
	 * Sets a mock command runner before getInstance is called (for testing)
	 * Must be called before getInstance() to take effect on new instances
	 */
	public static setMockCommandRunner(runner: CommandRunner | null): void {
		VersionManager.mockCommandRunner = runner;
	}

	/**
	 * Detects the LilyPond version and paths to python.exe and convert-ly.py
	 * @param lilypondExePath Path to the LilyPond executable
	 * @returns The detected version string or null if detection failed
	 */
	public async detectVersion(lilypondExePath: string): Promise<string | null> {
		try {
			// Run lilypond --version
			const versionOutput = await this.commandRunner(lilypondExePath, ['--version']);

			// Parse version from first line: "GNU LilyPond 2.24.1 (running Guile 2.2)"
			const versionMatch = versionOutput.match(/GNU LilyPond\s+(\d+\.\d+\.\d+)/);
			if (!versionMatch) {
				console.error('Failed to parse LilyPond version from output:', versionOutput);
				return null;
			}

			this.lilypondVersion = versionMatch[1];

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
		} catch (error) {
			console.error('Error detecting LilyPond version:', error);
			return null;
		}
	}

	/**
	 * Gets the currently detected LilyPond version
	 */
	public getVersion(): string | null {
		return this.lilypondVersion;
	}

	/**
	 * Sets the version directly (for testing purposes)
	 */
	public setVersionForTesting(version: string): void {
		this.lilypondVersion = version;
	}

	/**
	 * Sets a mock command runner (for testing purposes)
	 */
	public setCommandRunnerForTesting(runner: CommandRunner): void {
		this.commandRunner = runner;
	}

	/**
	 * Resets the singleton instance (for testing purposes)
	 */
	public static resetInstance(): void {
		VersionManager.instance = undefined as unknown as VersionManager;
	}

	/**
	 * Gets the path to python.exe
	 */
	public getPythonPath(): string | null {
		return this.pythonPath;
	}

	/**
	 * Gets the path to convert-ly.py
	 */
	public getConvertLyPath(): string | null {
		return this.convertLyPath;
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
