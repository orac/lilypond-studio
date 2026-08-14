#!/usr/bin/env node
// Cuts a release: bumps the extension version, commits, and tags the tag CI watches for.
// Usage: npm run release -- <major|minor|patch|x.y.z> [--push] [--dry-run]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const push = args.includes("--push");
const [bump] = args.filter((arg) => !arg.startsWith("--"));

function die(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function git(cwd, ...gitArgs) {
	return execFileSync("git", gitArgs, { cwd, encoding: "utf8" }).trim();
}

// Mutating commands are the only ones a dry run should skip; queries still need to run so the checks are real.
function run(cwd, command, ...commandArgs) {
	if (dryRun) {
		console.log(`  [dry run] ${command} ${commandArgs.join(" ")}`);
		return;
	}
	execFileSync(command, commandArgs, { cwd, stdio: "inherit" });
}

// Rewrites the manifest's own version, leaving every dependency alone. npm writes these files as two-space JSON, so a round trip is lossless — but check that before clobbering, rather than spraying a reformat across package-lock.json.
function setJsonVersion(file, newVersion) {
	const raw = readFileSync(file, "utf8");
	const parsed = JSON.parse(raw);
	if (JSON.stringify(parsed, null, 2) + "\n" !== raw) {
		die(`${path.basename(file)} isn't in npm's canonical formatting; bump its version by hand`);
	}
	parsed.version = newVersion;
	// The lockfile repeats the root package's version in its own entry for it.
	if (parsed.packages?.[""]) {
		parsed.packages[""].version = newVersion;
	}
	if (!dryRun) {
		writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
	}
}

function nextVersion(current, kind) {
	if (/^\d+\.\d+\.\d+$/.test(kind)) {
		return kind;
	}
	const [major, minor, patch] = current.split(".").map(Number);
	switch (kind) {
		case "major": return `${major + 1}.0.0`;
		case "minor": return `${major}.${minor + 1}.0`;
		case "patch": return `${major}.${minor}.${patch + 1}`;
		default: return die(`unknown bump "${kind}": expected major, minor, patch, or an explicit x.y.z`);
	}
}

if (!bump) {
	die("usage: npm run release -- <major|minor|patch|x.y.z> [--push] [--dry-run]");
}

// A release built from a dirty or diverged tree isn't reproducible from the tag, so refuse before touching anything.
if (git(repoRoot, "status", "--porcelain")) {
	die("lilypond-studio has uncommitted changes; commit or stash them first");
}
const branch = git(repoRoot, "rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") {
	die(`lilypond-studio is on ${branch === "HEAD" ? "a detached HEAD" : branch}, not main`);
}
git(repoRoot, "fetch", "origin", "main");
if (git(repoRoot, "rev-list", "--count", "HEAD..origin/main") !== "0") {
	die("lilypond-studio is behind origin/main; pull first");
}

const manifestPath = path.join(repoRoot, "package.json");
const current = JSON.parse(readFileSync(manifestPath, "utf8")).version;
const version = nextVersion(current, bump);
const tag = `v${version}`;

if (git(repoRoot, "tag", "--list", tag)) {
	die(`tag ${tag} already exists`);
}

console.log(`Releasing ${current} -> ${version}`);

console.log("Bumping package.json");
setJsonVersion(manifestPath, version);
setJsonVersion(path.join(repoRoot, "package-lock.json"), version);
run(repoRoot, "git", "commit", "-m", `Release ${version}`, "--", "package.json", "package-lock.json");
run(repoRoot, "git", "tag", "-a", tag, "-m", `Release ${version}`);

if (push) {
	run(repoRoot, "git", "push", "origin", "main", tag);
} else {
	console.log(`\nCommitted and tagged ${tag}. To release:`);
	console.log(`  git push origin main ${tag}`);
}
