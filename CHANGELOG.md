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