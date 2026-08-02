# Changelog

## [0.1.0] - 2026-03-25

First release.

## [0.2.0] - test only, unreleased

Big changes!

- Fix packaging problem that stopped the PDF viewer working in the first version. (It worked when built locally, just the vsix was missing the files.)
- Fix problem parser so errors from lilypond show up in the right place.
- Add language server to enable language server features including a bunch of code actions and error checking.
- Add more detail to the non-LSP syntax parsing.
- Add engrave-on-save option.
- Add "Report issue..." support with debug info

## [0.2.1] - 2026-07-26

As 0.2.0 but also fixes an alarming error message from the PDF viewer fix that wasn't visible until the .vsix was tested. This also makes it much quicker to load!

## Unreleased

- Add an output directory for engraved files, as the `lilypondStudio.outputDirectory` setting or an `outputDirectory` property on an individual task in `tasks.json`. The directory is created if it doesn't exist, and the preview finds PDFs there without waiting for a build to run.
- Build options can now be set per task in `tasks.json`, falling back to the `lilypondStudio` settings: `includeDirs` as well as the new `commandOptions` for anything else you want to put on the LilyPond command line.
- Custom `lilypond` tasks written in `tasks.json` can now be run at all: the task provider previously declined to resolve them.
- Engrave-on-save now reuses the whole definition of the task you last ran, not just its preview/publish mode, so it engraves to the same place.