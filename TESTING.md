# Testing

```bash
npm test                     # grammar snapshots, then the VS Code integration tests
npm run test:grammar         # grammar snapshots only
npm run test:grammar:update  # regenerate the grammar snapshots after an intentional change
```

`npm test` runs the grammar snapshots first because they're fast and need nothing installed; the integration tests then launch a real VS Code (`@vscode/test-electron`, configured in `.vscode-test.mjs`) with the extension loaded, and run the compiled suites from `out/test/`. `pretest` compiles both the tests and the extension, so there's no separate build step.

## Tests need a real LilyPond installation

Much of what the extension knows comes out of the LilyPond installation it finds. Those files change from version to version, so the tests read them from a real installation rather than from copies checked into this repository. **A test run with no LilyPond installed fails**. Test results when you run locally depend on what version(s)so you have installed.

`src/test/lilypondInstalls.ts` does the finding. `requireInstalls()` returns every installation it can see, oldest first, at most one per version, and a suite that depends on a version wraps itself in a loop over them:

```ts
for (const install of requireInstalls()) {
    suite(`Completion Provider (LilyPond ${install.version})`, () => { /* … */ });
}
```

So on a development machine the suite runs once per installed version — install 2.24.1 alongside 2.24.3 and both get tested, with the version in each suite's name — and in CI it runs against exactly the version that job installed.

An installation is recognised by its layout: a `bin/lilypond` (or `bin/lilypond.exe`) next to a `share/lilypond/<version>` directory. The version comes from that directory's name rather than from running the executable, so an installation unpacked for another architecture is still usable for the many tests that only read files from it.

### Where installations are looked for

With `LILYPOND_TEST_INSTALL_DIR` set, only that directory is searched. A relative value is resolved against the checkout, not the working directory, because VS Code promises nothing about the working directory of the extension host.

Otherwise the search covers your home directory, the parent of any `lilypond` on `PATH`, and the usual places for the platform: `C:\Program Files` and `C:\Program Files (x86)` on Windows, `/Applications`, `/opt` and `/usr/local` on macOS, `/opt`, `/usr/local` and `/usr` elsewhere. It descends two levels, but only into directories with "lilypond" in the name, so the Windows installer's habit of grouping versions (`C:\Program Files (x86)\LilyPond\lilypond-2.24.3`) is covered without walking the whole of Program Files.

### Getting another version to test against

`scripts/install-lilypond.sh <version>` downloads an official binary release and unpacks it, printing the installation root:

```bash
scripts/install-lilypond.sh 2.24.3               # unpacks into ~/lilypond-installs
scripts/install-lilypond.sh 2.24.3 /opt/lilypond # or wherever you like
```

The default destination, `~/lilypond-installs`, is inside the search path, so a version installed this way is picked up on the next run with nothing else to configure. Unpacking several versions into one directory is the intended way to test against all of them at once. Re-running for a version that's already there does nothing, so it's cheap to call from a script.

The script knows the layout of the 2.24 and later binary releases, which are published as generic packages on the LilyPond GitLab release. Earlier series were distributed differently and will need a new branch in the script when we come to support them.

## CI

The `test` job's matrix is the supported operating systems crossed with the supported LilyPond versions, so each combination gets its own run and a failure names the version it happened on. Each job installs its version with the same script into `.lilypond-installs` in the workspace and points `LILYPOND_TEST_INSTALL_DIR` at it, which pins the run to that one version.

To start testing against another version, add it to the `lilypond` list in `.github/workflows/ci.yml`. Nothing else needs to change.

The language server is deliberately absent from this job: the extension tolerates a missing binary, so the tests can run without checking out the `ly-lsp` submodule or installing a Rust toolchain. The server's own tests use the same installation-discovery approach; see `ly-lsp/TESTING.md`. The two implementations are independent on purpose, so that repository stands alone, but they share the environment variable name and the installer script, and a change to one is usually worth making in the other.

## Writing tests

- Test designed, expected behaviour, not temporary behaviour or accepted limitations. A test that will start failing once a bug is fixed is worse than no test.
- Grammar tests are `vscode-tmgrammar-snap` snapshots under `tests/grammar/snapshots/`. Update them with `npm run test:grammar:update` after an intentional grammar change, and read the diff before committing it.
- Reach for a real installation over a fixture whenever the behaviour under test depends on what LilyPond ships.
