# VSCode Extension for LilyPond

This is an extension to help you when editing LilyPond files in VS Code. It provides:-
* Syntax highlighting
    * Integrates with Scheme extensions to highlight embedded Scheme
* Red squiggles for (some) syntax errors as you type, before even running LilyPond
* **Tab-completion** of built-in commands, and variables in your file
* **Go to definition** and **find references** for variables (only basic `foo = { music }` for now, not Scheme commands)
* **Build tasks** for engraving in preview/publish modes
    * Optional **engrave on save**
    * Problem parser gives you **red squiggles for LilyPond warnings and errors**
* Side-by-side **PDF preview**, which auto-updates when the PDF changes
* Supports LilyPond's **point-and-click** PDFs:
    * Hovering/clicking an item in the PDF highlights/selects the relevant text in the .ly file.
    * Your cursor or selection in the .ly file highlight the relevant notation in the PDF.
* Code actions and refactorings to:
    * Add the right `\version` to a new file, or run `convert-ly` to update an old file
    * Extract the selected music to a variable
    * Inline a variable where it's used
    * Unfold repeats (e.g. `\repeat volta 2 { a b c | }` → `a b c | a b c`)
    * Add explicit notes and/or durations to music that omits it (e.g. `g4 g g g` to `g4 g4 g4 g4`).

![A screenshot showing the functionality](docs/screenshot%201.png?raw=true)

I made this because I've been using Frescobaldi for years, but I want the full power of VS Code's text editor. None of the existing LilyPond extensions had working point-and-click sync between the PDF and .ly file. I hope to grow this extension to eventually match all the capabilities of a LilyPond-specific editor like Frescobaldi with refactoring actions and better diagnostics for common errors.

## Requirements

- For most functionality you will need LilyPond installed. You can get it from https://lilypond.org/
- **Optional** If you make much use of embedded scheme (using `#` or `#(`…`#)`) , you might want an extension for scheme, for example https://marketplace.visualstudio.com/items?itemName=sjhuangx.vscode-scheme

## How to use

- In the settings, set `lilypondStudio.executablePath` to the path to your LilyPond executable.
- Open a .ly file.
- Hit ctrl-shift-b to "run build task" and then choose "Engrave (Preview)" from the list. You can also set it as the default build task if you like.
    - Preview mode embeds point-and-click information in the generated PDF, so you can click on notes to go to the right place in the source file, and vice-versa. This makes the file much larger, and it gives away the path to the source file on your computer. When making a PDF to distribute or keep, use "Engrave (Publish)".
- The PDF will automatically open next to the input file and update live whenever it is updated on disk.
- Edit the file and hit ctrl-shift-b again.

If you want to edit the file and rebuild the PDF automatically every time you save, you can turn this on in the *language menu* (the `{ }` icon in the bottom-right). You always need to build with ctrl-shift-b first to activate it: a precaution to avoid overwriting PDFs when you didn't mean to.

![A screenshot of the language menu with engrave-on-save turned on](docs/language%20menu.png)

## Building from source

The extension's TypeScript is built with `npm run compile` (or `npm run watch` while developing). The bundled language server is a separate Rust crate, [ly-lsp](https://github.com/orac/ly-lsp), included here as a git submodule in `ly-lsp/` so that each extension commit pins the exact server revision it ships with. Clone with `--recurse-submodules`, or run `git submodule update --init` in an existing checkout. It's built manually:

1. Build it in release mode: `cargo build --release --manifest-path ly-lsp/Cargo.toml`. Building the tree-sitter grammar needs a C compiler — MSVC on Windows.
2. Copy the resulting binary into this extension's `server/` directory, e.g. `ly-lsp/target/release/ly-lsp.exe` → `server/ly-lsp.exe`.

The extension looks for the binary at `server/ly-lsp.exe` on Windows and `server/ly-lsp` elsewhere, and packages it into the `.vsix`. If it's missing, the language-server features are simply disabled — everything else still works. Because the binary is native, releases are published as platform-specific packages (`win32-x64`, `linux-x64`, `darwin-x64`, `darwin-arm64`); VS Code installs whichever matches, so most users never see the distinction.

While iterating on the server you can skip the copy step: set `lilypondStudio.languageServerPath` to your build output (e.g. `ly-lsp/target/release/ly-lsp.exe`) and the extension will use that in preference to the bundled binary, restarting the server whenever the setting changes.

## Known issues and limitations

- Embedding LilyPond inside scheme (using `#{`…`#}`) doesn't quite work yet.
- Creating the build tasks gets a bit confused with multi-root workspaces but it seems to work fine regardless.
- The build task always puts the output file next to the input. I want to add more customization for people with more complex file layouts, but I need to hear from you to know what kind of settings would be useful.
- You can use snippets if you like, but the extension doesn't ship with any. If you find some useful, please let me know and I'll include them!
- Only tested on Windows. MacOS and Linux users, please send me your feedback. I'm also interested in whether anyone would want this in web (vscode.dev) instead of desktop.