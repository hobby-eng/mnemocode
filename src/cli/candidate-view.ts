// The candidates of a search on a terminal, as Decode's search of marked codes, recover-word and
// recover-date show them: each a part of the result of its own, its facts as grey labels with
// their values, each value wrapped at spaces under its own column (CORE-36), so that a seed phrase
// is never broken inside a word by the terminal. A file, a pipe and TERM=dumb take each command's
// rows for a script instead.

import { linesFitPrivateScreen } from "./screen-fit.js";
import { partLine } from "./terminal.js";
import { factLine, STYLE_CODES } from "./terminal-style.js";

/** The facts of a candidate, each a label and its value, in the order they are shown. */
export type CandidateFacts = readonly (readonly [string, string])[];

/**
 * The lines of one candidate on standard output, as console.log writes them: its `label`, grey,
 * after a blank line (terminalPart), then its `facts`, the labels in one column as wide as the
 * longest. A line may hold line breaks, where a value is wrapped.
 */
export function candidateLines(label: string, facts: CandidateFacts): string[] {
  const width = Math.max(...facts.map(([name]) => name.length));
  return [
    partLine(label),
    ...facts.map(([name, value]) => factLine(process.stdout, name, value, width)),
  ];
}

/** Shows one candidate on standard output (candidateLines). */
export function showCandidate(label: string, facts: CandidateFacts): void {
  for (const line of candidateLines(label, facts)) console.log(line);
}

/**
 * Whether candidates of `lines` (candidateLines) fit on the private screen with `beside` rows
 * around them (linesFitPrivateScreen): each row measured as it is shown, its colour codes taking
 * no room.
 */
export function candidatesFitScreen(lines: readonly string[], beside: number): boolean {
  const rows = lines.flatMap((line) => line.split("\n")).map((row) => row.replace(STYLE_CODES, ""));
  return linesFitPrivateScreen(rows, beside);
}
