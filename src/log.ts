import * as vscode from 'vscode';

/** The extension's shared log channel, shown in the Output panel as "LilyPond Studio".
 *
 * Prefer this over `console`, whose output only reaches the Extension Host log — somewhere users can't reasonably be asked to find. A `LogOutputChannel` timestamps entries, respects the level set by *Developer: Set Log Level…*, and can be copied straight out of the Output panel into a bug report.
 *
 * Verbosity guide: `error` and `warn` for things the user may need to act on, `info` for lifecycle events worth seeing by default, `debug` for the detail that turns a vague report into a diagnosis.
 */
export const log = vscode.window.createOutputChannel('LilyPond Studio', { log: true });
