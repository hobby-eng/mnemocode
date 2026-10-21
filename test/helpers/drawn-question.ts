// A question of the start menu as it shows on standard error, read back as a person reads it: a
// list question that choose draws (drawn-list.ts), or a typed question that askLine draws, its
// prompt after a blank line and the warning above it, if any. And the label of the line that a
// question leaves in the record of answers once it is answered. The tests of the menu that answer
// the real questions at the terminal's edge record what was asked so. This module imports nothing
// that a test replaces.

import { ERASE_BELOW } from "../../src/cli/terminal.js";
import { SGR_RESET, STYLE, STYLE_CODES } from "../../src/cli/terminal-style.js";
import { drawnList, WARNING_INDENT, WARNING_MARK, type DrawnList } from "./drawn-list.js";

/** A question as it shows. */
export interface DrawnQuestion {
  /** A list question (choose), or a typed one (askLine). */
  readonly kind: "choose" | "line";
  /** The question; a list question's wrapped lines joined by spaces. */
  readonly question: string;
  /** The labels of a list question's entries, in order; none for a typed question. */
  readonly labels: readonly string[];
  /** The warning above the question, its wrapped lines joined by spaces. */
  readonly warning: string | undefined;
  /** What Enter alone gives a typed question, as its prompt says: "(Enter: <this>)". */
  readonly enter: string | undefined;
  /** A list question as it shows; undefined for a typed question. */
  readonly list: DrawnList | undefined;
  /** Every line drawn, without colours. */
  readonly lines: readonly string[];
}

/** The prompt of a typed question, which its answer follows: "Word: ", "File (Enter: a.txt): ". */
const PROMPT = /^(?<question>.+?)(?: \(Enter: (?<enter>[^)]*)\))?: $/u;
/**
 * How a line of the record of answers starts in colour: its indent, then the grey label padded to
 * its column (factLine, as paint starts a grey text), which SGR_RESET ends. Only colour tells where
 * a label with spaces ends.
 */
const RECORD_LINE_START = `  \x1b[${STYLE.muted}m`;

/** The warning above a question in `lines`, after the blank line that starts it; or none. */
function warningAbove(lines: readonly string[]): string | undefined {
  let at = lines.findIndex((line) => line !== "");
  if (lines[at]?.startsWith(WARNING_MARK) !== true) return undefined;
  const warning = [lines[at]!.slice(WARNING_MARK.length)];
  for (at += 1; lines[at]?.startsWith(WARNING_INDENT) === true; at += 1)
    warning.push(lines[at]!.slice(WARNING_INDENT.length));
  return warning.join(" ");
}

/**
 * The question that `drawn`, the text written since a question started reading the terminal and
 * before its first key, shows: a list question by its key hint, a typed question by the blank line
 * that starts it and its prompt at the end; none for anything else, such as a prompt for a secret
 * or for Enter.
 */
export function drawnQuestion(drawn: string): DrawnQuestion | undefined {
  const lines = drawn.replace(STYLE_CODES, "").split("\n");
  const warning = warningAbove(lines);
  const list = drawnList(drawn);
  if (list !== undefined) {
    const labels = list.entries.map((entry) => entry.label);
    return {
      kind: "choose",
      question: list.question,
      labels,
      warning,
      enter: undefined,
      list,
      lines,
    };
  }
  const prompt = PROMPT.exec(lines.at(-1) ?? "")?.groups;
  if (lines[0] !== "" || prompt === undefined) return undefined;
  const question = prompt["question"] ?? "";
  return { kind: "line", question, labels: [], warning, enter: prompt["enter"], list, lines };
}

/**
 * The label of the line that a question wrote in the record of answers once it was answered, in
 * `written`, what it wrote after its first key, in colour; undefined where it wrote none, such as
 * when it went back or asked again.
 */
export function recordLabel(written: string): string | undefined {
  // A question erases itself, then writes its line in the record.
  const erased = written.lastIndexOf(ERASE_BELOW);
  if (erased < 0) return undefined;
  const line = written.slice(erased + ERASE_BELOW.length);
  const end = line.indexOf(SGR_RESET);
  if (!line.startsWith(RECORD_LINE_START) || end < 0) return undefined;
  return line.slice(RECORD_LINE_START.length, end).trimEnd();
}
