// What a command that ran on the private screen leaves on the main screen once it has left it
// (CORE-39): what was saved and where, and the warnings that still hold after the command, in the
// order they were shown. The result itself, a phrase, shares, codes, dates or a fingerprint, stays
// on the private screen and is cleared with it (CORE-24): only a line that a command gives as a
// save (terminalSaved) or as a lasting warning (terminalLastingWarning, terminalWarningWithMore),
// or adds here as one where it prints its own lines measured for the screen (dateMatchNotes,
// recover-word's notes), is kept, and such a line names files, counts and facts, never what a
// result holds. The private screen (withPrivateScreen) opens the summary and prints it once,
// after it has left. A leaf without imports, as private-steps.ts is, so that terminal.ts can fill
// it.

/** One line of the summary, as its notice showed it: a save after a ✓, or a warning after a !. */
export interface SummaryLine {
  readonly kind: "success" | "warning";
  readonly text: string;
  /** The anchor of the README section that a "More:" line under the warning names. */
  readonly more?: string | undefined;
}

/** Collects the summary of the one command that runs on the private screen; nothing elsewhere. */
export class PrivateSummary {
  static #lines: SummaryLine[] | undefined;

  /** Starts the summary of the command whose private screen opens now. */
  static open(): void {
    PrivateSummary.#lines = [];
  }

  /**
   * Adds `line` to the summary of the private screen, once: a warning drawn again on each step
   * screen, or a save reported again, stays one line. Nothing without a private screen, whose
   * notices stay where they were written.
   */
  static add(line: SummaryLine): void {
    const lines = PrivateSummary.#lines;
    if (lines === undefined || lines.some((kept) => kept.text === line.text)) return;
    lines.push(line);
  }

  /** Ends the summary and gives its lines, in the order they were added; none when none was open. */
  static close(): readonly SummaryLine[] {
    const lines = PrivateSummary.#lines ?? [];
    PrivateSummary.#lines = undefined;
    return lines;
  }
}
