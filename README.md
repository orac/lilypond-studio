# VSCode Extension for LilyPond

This is an extension to help you when editing LilyPond files in VS Code. It provides syntax highlighting, operations to edit the file more easily (by moving music around the file or transforming it in different ways), and auto-updating preview of the output PDF.

## Requirements

For most functionality you will need LilyPond installed. You can get it from https://lilypond.org/

## How to use

- In the settings, set `lilypondStudio.executablePath` to the path to your LilyPond executable.
- Open a .ly file.
- Hit ctrl-shift-b to "run build task" and then choose LilyPond from the list. You can also set it as the default build task.