# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

LilyPond Studio is a VS Code extension providing IDE support for [LilyPond](https://lilypond.org), a music engraving system. It bundles a separate Rust-based language server (`ly-lsp`) as a binary in `server/`.

## Commands

```bash
npm run compile        # type-check + lint + build (development)
npm run watch          # parallel watch for extension + viewer
npm run package        # production build (minified)
npm run check-types    # type-check only (extension + viewer)
npm run lint           # oxlint on src/
npm run test           # grammar snapshots + VS Code integration tests
npm run test:grammar   # TextMate grammar snapshot tests only
npm run test:grammar:update  # regenerate grammar snapshots
```

To run a single test file, compile tests then point the VS Code test runner at a specific glob. The test config is in `.vscode-test.mjs`.

## Architecture

The extension has three distinct runtime environments:

**Extension host** (`src/extension.ts` → `dist/extension.js`, CJS, Node.js):
- Registers all providers and manages their lifecycle
- Starts the language client lazily when the first `.ly` file opens
- Communicates with the webview via `postMessage`

**Language server** (`server/ly-lsp.exe`, external Rust binary):
- Managed by `src/languageClient.ts` via stdio LSP
- Provides diagnostics, go-to-definition, find-references
- Lives in the `ly-lsp/` git submodule, which pins the server revision each extension commit ships with. Build it with `cargo build --release --manifest-path ly-lsp/Cargo.toml` and copy the binary into `server/` manually; CI does this itself for each platform it packages
- To iterate on the language server locally, point `lilypondStudio.languageServerPath` to a local binary

**PDF viewer webview** (`src/viewer/viewer.ts` → `dist/viewer.js`, ESM, browser):
- Renders PDFs with `pdfjs-dist`
- Handles point-and-click synchronisation between PDF and source
- Has its own `tsconfig.json` at `src/viewer/tsconfig.json` (adds DOM lib)

The build is orchestrated by `esbuild.js`, which bundles both targets; it accepts `--watch` and `--production` flags.

## Key files

| File | Role |
|------|------|
| `src/extension.ts` | Activation, provider registration |
| `src/log.ts` | Shared "LilyPond Studio" log channel; use instead of `console` |
| `src/diagnosticsCommand.ts` | "LilyPond: Show Diagnostics" environment report for bug reports |
| `src/languageClient.ts` | LSP client lifecycle |
| `src/LilyPondInstallation.ts` | Detects LilyPond on the user's system |
| `src/pdfViewer.ts` | Webview panel management |
| `src/pdfCustomEditor.ts` | Custom editor provider for `.pdf` files |
| `src/versionDiagnostics.ts` | Detects outdated `\version` directives |
| `src/convertLyCodeAction.ts` | Code action to invoke `convert-ly` |
| `src/completionProvider.ts` | Completions (loaded from `lilypond-words`) |
| `syntaxes/` | TextMate grammars (LilyPond + embedded Scheme) |

## Testing notes

- Grammar tests use `vscode-tmgrammar-snap` snapshots under `tests/grammar/snapshots/`; update them with `test:grammar:update` after intentional grammar changes
- Integration tests compile to `out/test/` and run under `@vscode/test-electron`
- The pretest hook builds both tests and the extension

## Linting

`oxlint` with config in `.oxlintrc.json`. Active rules include `no-explicit-any`, `no-unused-vars`, `eqeqeq`, `curly`. Run `npm run lint` before committing.
