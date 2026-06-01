---
name: write-ts
description: Use this skill every time you edit or write TypeScript code.
---
Write readable, maintainable TypeScript code making best use of the type system. Run `npm lint:fix` when you're done, but not while debugging or iterating on a change. Follow the "Boy Scout" rule by leaving the code cleaner than you found it. Proactively refactor duplicate/repetitive code. Write unit tests for all non-trivial functions and components.

## Code style
- No line length limit. Wrap only to express structure: long argument lists, object/array literals.
- Spaces for indentation, never for alignment. No ASCII art, tables, or aligned `=` signs.
- No banner comments to separate sections. Use `describe` blocks in tests, separate functions/classes/files instead.
- Use semicolons.
- Trailing commas in multi-line arrays and objects.
- No `_` prefix/suffix on private members.
- Always use braces with `if`, `for`, `while`.
- Prefer throwing exceptions over returning `null` or `undefined`.
- No `_` prefix on temporarily unused parameters.
- Prefer `'single-quoted'` string literals over `"double-quoted"`.

## Types
- Use the type system to express constraints and to document.
- Use the newtype pattern to wrap primitive types for things like IDs.
- Prefer `interface A extends B` over `type B = Omit<A, ...>` unless `A` is an imported type.
- Prefer `const enum` / union types over runtime enums.
- Use intersection and union types to express interfaces with mutually-exclusive options or where the available options depend on a `mode`. Example:
    ```ts
    type State = { mode: 'idle' } | { mode: 'running'; speed: number };
    ```

## Comments / JSDoc
- Brief JSDoc on all public/exported symbols.
- First line of a multi-line JSDoc is a one-line summary, then a blank line.
- Top-level class or function: explain what it is for and how it fits into the system.
- Don't restate what the name and type already say; don't duplicate TypeScript types into comments.
- No line length limit. Use a blank line to wrap long prose into paragraphs. Don't wrap mid-sentence.
- Document preconditions, side-effects, and possible exceptions — what a caller needs to know before calling.
- Don't describe the algorithm step-by-step. If you need to document the internals of a function, use regular comments inside the function.
- Document parameters only when the name/type doesn't fully express meaning (units, null semantics, defaults).
- Describe interface members in comments on the member itself, not on the interface.