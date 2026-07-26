# Changelog

## [0.1.0] - 2026-03-25

First release.

## [0.2.0] - 2026-07-26

Big changes!

- Fix packaging problem that stopped the PDF viewer working in the first version. (It worked when built locally, just the vsix was missing the files.)
- Fix problem parser so errors from lilypond show up in the right place.
- Add language server to enable language server features including a bunch of code actions and error checking.
- Add more detail to the non-LSP syntax parsing.
- Add engrave-on-save option.