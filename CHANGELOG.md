# Changelog

## Unreleased

- Adds a formatter, which reindents a file (or selection) by its nesting of `{ }`, `<< >>`, `#{ #}` and Scheme parentheses. It keeps the file's line breaks, and leaves lines starting inside block comments and multi-line strings alone.
- Pressing Enter before a `}`, `>>` or `#}` moves it back out to the level of its opener, and a line that opens a `{` or `<<` without closing it indents the next line, even when there's music after the opener.
- The PDF preview works with more than one file:
    - It opens as a preview tab, which you can pin to keep that PDF open. You can have any number of PDFs open at once, each in its own tab.
    - Point-and-click works with `\include`d files: clicking in the PDF opens whichever file the notation came from, and selecting text in any file highlights its notation in every open PDF.
    - Switching to an `\include`d file no longer replaces the preview of the score that includes it.
    - A tab group the preview opens is locked, so files you open from the explorer go to the group you were editing in. Turn this off with the `workbench.editor.autoLockGroups` setting.

## [1.0.1] - 2026-09-07

- Updates lyrics highlighting using semantic tokens from the LSP server. This makes commands inside lyrics, and starting lyrics with `\new SomeContext`, which are too complex for the TM grammar to handle, highlight reliably.
- Improves the use of build tasks:
    - They're contributed when you're looking at a PDF preview.
    - The `file` option in a JSON build task overrides the open file, if set. (This doesn't change what happens if you don't have a tasks.json file.)
    - More debug output in the log/diagnostics.

## [1.0.0] - 2026-08-30

- Uses LSP server for a lot more understanding of the file:-
    - Understands commands, contexts, and context instances. These now participate in go-to-definition and find-references within user files, and completions.
    - Commands offer hover help and signature help. Most of the help texts are pulled from the docstrings in the active install, so they're not always very helpful for end-users.
    - Support 2.26
- Add an output directory for engraved files, as the `lilypondStudio.outputDirectory` setting or an `outputDirectory` property on an individual task in `tasks.json`. The directory is created if it doesn't exist, and the preview finds PDFs there without waiting for a build to run.
- Build options can now be set per task in `tasks.json`, falling back to the `lilypondStudio` settings: `includeDirs` as well as the new `commandOptions` for anything else you want to put on the LilyPond command line.
- Custom `lilypond` tasks written in `tasks.json` can now be run at all: the task provider previously declined to resolve them.
- Engrave-on-save now reuses the whole definition of the task you last ran, not just its preview/publish mode, so it engraves to the same place.

## [0.2.1] - 2026-07-26

As 0.2.0 but also fixes an alarming error message from the PDF viewer fix that wasn't visible until the .vsix was tested. This also makes it much quicker to load!

## [0.2.0] - test only, unreleased

Big changes!

- Fix packaging problem that stopped the PDF viewer working in the first version. (It worked when built locally, just the vsix was missing the files.)
- Fix problem parser so errors from lilypond show up in the right place.
- Add language server to enable language server features including a bunch of code actions and error checking.
- Add more detail to the non-LSP syntax parsing.
- Add engrave-on-save option.
- Add "Report issue..." support with debug info

## [0.1.0] - 2026-03-25

First release.