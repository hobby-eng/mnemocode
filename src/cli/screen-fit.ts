// Whether a result fits on the private screen, which keeps no scrollback. A module of its own,
// beside what it asks (private-screen.ts, terminal-geometry.ts), so that a test can answer them.

import { isatty } from "node:tty";
import { onPrivateScreen } from "./private-screen.js";
import { rowsOfOutputLine, terminalColumns, terminalRows } from "./terminal-geometry.js";

/**
 * Whether `lines` of standard output fit on the private screen with `beside` rows of what is shown
 * around them: that screen keeps no scrollback, so a row that scrolled off its top could not be
 * read. Output that goes to a file or a pipe, or to the main screen with its scrollback, always
 * fits.
 */
export function linesFitPrivateScreen(lines: readonly string[], beside: number): boolean {
  if (!onPrivateScreen() || !isatty(1)) return true;
  const columns = terminalColumns();
  const rows = lines.reduce((total, line) => total + rowsOfOutputLine(line, columns), beside);
  return rows <= terminalRows();
}
