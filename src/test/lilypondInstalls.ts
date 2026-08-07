import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareVersions } from '../LilyPondInstallation';

/** A LilyPond installation found on the machine running the tests. */
export interface LilyPondInstall {
	/** The directory containing `bin/` and `share/`, which is what the extension calls the install directory. */
	readonly root: string;

	/** Three-part version, read from the directory name under `share/lilypond`. */
	readonly version: string;

	/** The `lilypond` executable. Present on disk, but not necessarily runnable: a CI runner may hold an installation built for another architecture. */
	readonly executablePath: string;
}

/** Name of the environment variable that, when set, replaces the search of well-known install locations. */
export const installDirVariable = 'LILYPOND_TEST_INSTALL_DIR';

const executableName = process.platform === 'win32' ? 'lilypond.exe' : 'lilypond';

/** The checkout this test run belongs to. Compiled tests live in `out/test`, two levels down. */
const projectRoot = path.join(__dirname, '..', '..');

/** How deep below a search location an installation may be nested. The extra level covers installers that group their versions in a shared parent, as the Windows installer does with `C:\Program Files (x86)\LilyPond\lilypond-2.24.3`. */
const searchDepth = 2;

/**
 * Finds every LilyPond installation the tests can run against, newest last.
 *
 * With `LILYPOND_TEST_INSTALL_DIR` set, only that directory is searched — this is how CI pins the run to the version it installed. Otherwise the well-known install locations for the platform are searched, along with anything reachable through `PATH`, so a developer's machine tests against everything they have installed.
 *
 * At most one installation is returned per version, since testing the same version twice tells us nothing new.
 */
export function discoverInstalls(): LilyPondInstall[] {
	const byVersion = new Map<string, LilyPondInstall>();
	for (const location of searchLocations()) {
		for (const install of installsUnder(location, searchDepth)) {
			if (!byVersion.has(install.version)) {
				byVersion.set(install.version, install);
			}
		}
	}

	return [...byVersion.values()].sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Finds the installations to test against, and explains how to get one if there are none.
 *
 * @throws if no installation can be found, because a test run that silently skipped every version-dependent test would report success without having checked anything.
 */
export function requireInstalls(): LilyPondInstall[] {
	const installs = discoverInstalls();
	if (installs.length === 0) {
		throw new Error(
			`No LilyPond installation found, so the tests that need one cannot run. Install LilyPond from https://lilypond.org/download.html, or run scripts/install-lilypond.sh <version>, then set ${installDirVariable} to the directory holding the installation. See TESTING.md.`
		);
	}

	return installs;
}

/** The path of an installation's `lilypond-words` file, which lists every command and keyword the version knows. */
export function wordsFilePath(install: LilyPondInstall): string {
	return path.join(install.root, 'share', 'lilypond', install.version, 'vim', 'syntax', 'lilypond-words');
}

function searchLocations(): string[] {
	const configured = process.env[installDirVariable];
	if (configured) {
		// Resolved against the project rather than the working directory, which VS Code does not promise anything about, so CI can pass a path relative to the checkout.
		return [path.resolve(projectRoot, configured)];
	}

	// The home directory covers the installer script's default destination, ~/lilypond-installs, as well as installations unpacked by hand.
	const locations = [os.homedir(), ...executableDirsOnPath().map(dir => path.dirname(dir))];

	switch (process.platform) {
		case 'win32':
			locations.push('C:\\Program Files', 'C:\\Program Files (x86)', process.env.LOCALAPPDATA ?? '');
			break;
		case 'darwin':
			locations.push('/Applications', '/opt', '/usr/local');
			break;
		default:
			locations.push('/opt', '/usr/local', '/usr');
			break;
	}

	return locations.filter(location => location.length > 0);
}

/** The `bin` directories of any `lilypond` executables on `PATH`. */
function executableDirsOnPath(): string[] {
	const entries = (process.env.PATH ?? '').split(path.delimiter);
	return entries.filter(entry => entry.length > 0 && exists(path.join(entry, executableName)));
}

/**
 * Yields the installations at or below a directory.
 *
 * Only subdirectories named after LilyPond are descended into: the search locations include directories with hundreds of unrelated children, and walking those would cost far more than it could ever find.
 */
function* installsUnder(directory: string, depth: number): Iterable<LilyPondInstall> {
	const installs = readInstalls(directory);
	if (installs.length > 0) {
		yield* installs;
		return;
	}

	if (depth === 0) {
		return;
	}

	for (const child of childDirectories(directory)) {
		if (/lilypond/i.test(path.basename(child))) {
			yield* installsUnder(child, depth - 1);
		}
	}
}

/**
 * Recognises installations by the layout the extension relies on, and returns nothing for any other directory.
 *
 * The versions are the names of the directories under `share/lilypond`. Reading them beats running the executable, which may have been unpacked for another architecture, and it is the same lookup the extension itself does to find version-specific files. A distribution package can offer several versions from one root, so this returns a list.
 */
function readInstalls(root: string): LilyPondInstall[] {
	const executablePath = path.join(root, 'bin', executableName);
	if (!exists(executablePath)) {
		return [];
	}

	return childDirectories(path.join(root, 'share', 'lilypond'))
		.map(child => path.basename(child))
		.filter(name => /^\d+\.\d+\.\d+$/.test(name))
		.map(version => ({ root, version, executablePath }));
}

function childDirectories(directory: string): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(directory, { withFileTypes: true });
	} catch {
		// Search locations that don't exist, and ones the test runner may not read, are simply not places an installation was found.
		return [];
	}

	return entries.filter(entry => entry.isDirectory()).map(entry => path.join(directory, entry.name));
}

function exists(file: string): boolean {
	return fs.existsSync(file);
}
