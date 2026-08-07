# Contributing to LilyPond Studio

## Code Style

- Always use semicolons
- Use trailing commas in multi-line arrays and objects
- Do not prefix or suffix private members with `_`
- There is no line length limit. Wrap statements only when it makes semantic sense e.g. long argument lists, object and array literals.
- Always use braces with `if`, `for`, `while`.

## Testing

Run the tests with:

        npm run test

You need at least one discoverable LilyPond install on the machine. See [TESTING.md](TESTING.md) for how an installation is found and how to install another version to test against.