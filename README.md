# VSCode Extension for LilyPond

This is an extension to help you when editing LilyPond files in VS Code. It provides:-
* Syntax highlighting
* Tab-completion of built-in commands
* Build tasks for engraving in preview/publish modes
    * Problem parser highlights warnings and errors in context in the source file
* An auto-updating preview of the output PDF
* Hovering/clicking an item in the PDF highlights/selects the relevant text in the .ly file. Your cursor or selection in the .ly file highlight the relevant notation in the PDF.
* Detects old `\version` and can run convert-ly for you.

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
- Edit the file and hit ctrl-shift-b again. E

## Known issues and limitations

- Embedding LilyPond inside scheme (using `#{`…`#}`) doesn't quite work yet.
- Creating the build tasks gets a bit confused with multi-root workspaces but it seems to work fine regardless.
- It does the "highlight all uses of the symbol under the cursor" for every pitch, which can be a bit distracting.
- The build task always puts the output file next to the input. I want to add more customization for people with more complex file layouts, but I need to hear from you to know what kind of settings would be useful.
- You can use snippets if you like, but the extension doesn't ship with any. If you find some useful, please let me know and I'll include them!
- Commands/variables you define don't get tab-completed.
- Only tested on Windows. MacOS and Linux users, please send me your feedback. I'm also interested in whether anyone would want this in web (vscode.dev) instead of desktop.