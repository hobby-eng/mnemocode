// A list question as choose (src/cli/terminal-choice.ts) draws it on standard error, read back from
// the screen as a person reads it: the question, its entries with their labels, notes, examples
// and digits, the entry marked at first, and what Escape does, as the key hint says. A test that
// answers the real questions at the terminal's edge reads them so, and types the keys of the entry
// that it picks. This module imports nothing that a test replaces.

import { CANCELLED, type Cancelled } from "../../src/cli/terminal-keys.js";
import { STYLE_CODES } from "../../src/cli/terminal-style.js";
import { CTRL_C, DOWN, ENTER, ESCAPE } from "./keys.js";

/** An entry of a list as it shows. */
export interface DrawnEntry {
  readonly label: string;
  /** The grey text after the label, as shown: cut to fit where it is too long. */
  readonly note: string | undefined;
  /** The grey line under the note, such as an example, as shown. */
  readonly example: string | undefined;
  /** The digit that picks the entry at once; none where the list shows none. */
  readonly digit: number | undefined;
}

/** A list question as it shows. */
export interface DrawnList {
  /** The question, its wrapped lines joined by spaces. */
  readonly question: string;
  readonly entries: readonly DrawnEntry[];
  /** The place of the entry that the marker shows chosen. */
  readonly selected: number;
  /** What Escape does, as the key hint says: "goes back", "quits". */
  readonly escape: string;
}

/** The key hint under a list, which tells a list question from any other. */
const KEY_HINT = /^↑ ↓ choose · Enter selects.* · Esc (?<escape>.+)$/u;
/**
 * An entry: the marker (› where chosen), its digit or a space, two spaces, the label, and its note
 * after two or more spaces, the label being padded to the longest one (listLines).
 */
const ENTRY_LINE = /^(?<marker>[› ]) (?<digit>[\d ]) {2}(?<label>\S.*?)(?: {2,}(?<note>\S.*))?$/u;
/** The grey line under an entry, indented past the labels: deeper than an entry starts. */
const EXAMPLE_LINE = /^ {6,}(?<example>\S.*)$/u;
/** The mark of the warning drawn above a question (markedLines), and the indent of its lines. */
export const WARNING_MARK = "! ";
export const WARNING_INDENT = "  ";

/** An answer to a list question: the label of the entry to pick, undefined (Escape) or Ctrl+C. */
export type ListAnswer = string | undefined | Cancelled;

/** The list question that `drawn`, the text written since a question started, shows; or none. */
export function drawnList(drawn: string): DrawnList | undefined {
  const lines = drawn.replace(STYLE_CODES, "").split("\n");
  // The last key hint: an earlier one would be of a question left before.
  let hintAt = lines.length - 1;
  while (hintAt >= 0 && !KEY_HINT.test(lines[hintAt]!)) hintAt -= 1;
  const escape = KEY_HINT.exec(lines[hintAt] ?? "")?.groups?.["escape"];
  if (escape === undefined) return undefined;
  // The list ends above the blank line over the hint; an entry without an example may reserve
  // an empty row so that its label stands as far from the next as one with an example does.
  const end = hintAt - 1;
  let start = end;
  while (start > 0 && (lines[start - 1] === "" || isListLine(lines[start - 1]!))) start -= 1;
  const entries: DrawnEntry[] = [];
  let selected = 0;
  for (const line of lines.slice(start, end)) {
    if (line === "") continue;
    const entry = ENTRY_LINE.exec(line)?.groups;
    if (entry === undefined) {
      const last = entries.pop();
      if (last === undefined) throw new Error(`A list line under no entry: ${line}`);
      entries.push({ ...last, example: EXAMPLE_LINE.exec(line)?.groups?.["example"] });
      continue;
    }
    if (entry["marker"] === "›") selected = entries.length;
    const digit = entry["digit"]?.trim();
    entries.push({
      label: entry["label"] ?? "",
      note: entry["note"],
      example: undefined,
      digit: digit === undefined || digit === "" ? undefined : Number(digit),
    });
  }
  return { question: questionAbove(lines.slice(0, start)), entries, selected, escape };
}

function isListLine(line: string): boolean {
  return ENTRY_LINE.test(line) || EXAMPLE_LINE.test(line);
}

/**
 * The question in `lines`, the text above a list: after the blank line that starts it and the
 * warning above it, if any, the lines up to its explanation, which is indented, or its list.
 */
function questionAbove(lines: readonly string[]): string {
  let at = 0;
  while (lines[at] === "") at += 1;
  if (lines[at]?.startsWith(WARNING_MARK) === true) {
    at += 1;
    while (lines[at]?.startsWith(WARNING_INDENT) === true) at += 1;
  }
  const question: string[] = [];
  for (; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (line === "" || line.startsWith(" ")) break;
    question.push(line);
  }
  return question.join(" ");
}

/**
 * The keys of `answer` to `list`, as a person types them: Escape, Ctrl+C, or for a label the digit
 * of its entry, or the down arrow to it and Enter where it has none. Fails when the list has no
 * entry of that label.
 */
export function keysOfAnswer(list: DrawnList, answer: ListAnswer): string {
  if (answer === undefined) return ESCAPE;
  if (answer === CANCELLED) return CTRL_C;
  const place = list.entries.findIndex((entry) => entry.label === answer);
  if (place < 0) {
    const labels = list.entries.map((entry) => entry.label).join(", ");
    throw new Error(`No entry ${answer} at ${list.question} (${labels})`);
  }
  const { digit } = list.entries[place]!;
  if (digit !== undefined) return String(digit);
  const downs = (place - list.selected + list.entries.length) % list.entries.length;
  return `${DOWN.repeat(downs)}${ENTER}`;
}
