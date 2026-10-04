// Questions at the terminal: a list chosen with the arrow keys or a number, a typed answer and a
// pause for Enter, drawn on standard error in the style of `mhfe`'s menu (src/bin/mhfe/menu.rs).
// They need a terminal on standard input and standard error (terminalAvailable).

import { readKey, readLine, withRawTerminal } from "./terminal-input.js";
import { STYLE, terminalPaint } from "./terminal.js";

/** The widest line drawn: a list redraws itself by moving the cursor up line by line, which a line
 * wrapped by the terminal would upset. The width of running text in terminal.ts. */
export const LINE_WIDTH = 78;

/** Marker, number and the gaps before a label: "› 1  ". */
const LABEL_INDENT = 5;

export interface Choice<T> {
  readonly label: string;
  /** Grey text after the label. */
  readonly note?: string;
  /** A grey second line under the note, such as an example. */
  readonly example?: string;
  /** The digit that chooses this entry at once; by default its place, 1 to 9. */
  readonly digit?: number;
  readonly value: T;
}

const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);

/** Moves the cursor up `lines` lines to the start of the line, then clears to the end of the
 * screen (VT100 "cursor up" and "erase in display"). Written raw: NO_COLOR does not remove it. */
function redrawFrom(lines: number): void {
  if (lines > 0) process.stderr.write(`\x1b[${lines}A\r\x1b[J`);
}

/** `text` cut to `room` characters with "…" at the end, so that it cannot wrap the line. */
export function shortened(text: string, room: number): string {
  const characters = [...text];
  if (characters.length <= room) return text;
  return `${characters.slice(0, Math.max(0, room - 1)).join("")}…`;
}

function digitOf<T>(choice: Choice<T>, index: number): number | undefined {
  return choice.digit ?? (index < 9 ? index + 1 : undefined);
}

/** The lines of a list, without colours when the terminal has none; the chosen entry has a cyan
 * marker and a bold label, so that it stands out also without colours. */
export function listLines<T>(choices: readonly Choice<T>[], selected: number): string[] {
  const labelWidth = Math.max(...choices.map((choice) => [...choice.label].length));
  const noteRoom = LINE_WIDTH - LABEL_INDENT - labelWidth - 2;
  const lines: string[] = [];
  choices.forEach((choice, index) => {
    const digit = digitOf(choice, index);
    const number = paint(STYLE.muted, digit === undefined ? " " : String(digit));
    const chosen = index === selected;
    const marker = chosen ? paint(STYLE.accent, "›") : " ";
    const label = chosen ? paint(STYLE.strong, choice.label) : choice.label;
    if (choice.note === undefined) {
      lines.push(`${marker} ${number}  ${label}`);
    } else {
      // Padded by hand: the width of a painted label would count its colour codes.
      const padding = " ".repeat(labelWidth - [...choice.label].length);
      lines.push(
        `${marker} ${number}  ${label}${padding}  ${paint(STYLE.muted, shortened(choice.note, noteRoom))}`,
      );
    }
    if (choice.example !== undefined) {
      const indent = " ".repeat(LABEL_INDENT + labelWidth + 2);
      lines.push(`${indent}${paint(STYLE.muted, shortened(choice.example, noteRoom))}`);
    }
  });
  return lines;
}

function keyHint<T>(choices: readonly Choice<T>[], quit: string): string {
  const digits = choices.map(digitOf).filter((digit) => digit !== undefined);
  const range =
    digits.length > 1 ? ` · ${Math.min(...digits)} to ${Math.max(...digits)} at once` : "";
  return `↑ ↓ choose · Enter selects${range} · Esc ${quit}`;
}

/** Width of the grey labels in the record of answers, as in a result (terminal.ts). */
const ANSWER_LABEL_WIDTH = 10;

/** Indents of an explanation and of its links under "More:". */
const TEXT_INDENT = "  ";
const LINK_INDENT = "    ";

/**
 * Text shown between a question and its entries: short `lines` in the normal colour, each at most
 * LINE_WIDTH minus its indent, and links to read `more`, grey under "More:".
 */
export interface Explanation {
  readonly lines: readonly string[];
  readonly more?: readonly string[];
}

export function explanationLines(explanation: Explanation | undefined): string[] {
  if (explanation === undefined) return [];
  const lines = explanation.lines.map((line) => (line === "" ? "" : `${TEXT_INDENT}${line}`));
  if (explanation.more !== undefined)
    lines.push(
      "",
      `${TEXT_INDENT}${paint(STYLE.muted, "More:")}`,
      ...explanation.more.map((link) => `${LINK_INDENT}${paint(STYLE.muted, link)}`),
    );
  return [...lines, ""];
}

/** One line of the record of answers: a grey label and the answer in cyan, indented as the
 * facts of a result (terminalResultHeader) and the summary lines of `mhfe`. */
function answerLine(label: string, answer: string): string {
  return `${TEXT_INDENT}${paint(STYLE.muted, label.padEnd(ANSWER_LABEL_WIDTH))} ${paint(STYLE.accent, answer)}\n`;
}

/** The blank line and the question that start every question; they are erased with its list. */
const QUESTION_LINES = 2;

/**
 * Asks `question` and lets the person choose an entry with the arrow keys and Enter, or at once with
 * its digit. Returns the value of the entry, or undefined for Escape, which `quit` describes ("goes
 * back", "quits"). The question stands apart, after a blank line, with its `explanation`; once it
 * is answered, the question and its list are replaced by one line of the record of answers, its
 * `label` and the chosen entry, so that the questions asked so far read as a short summary.
 */
export async function choose<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: {
    readonly label: string;
    readonly initial?: number;
    readonly quit?: string;
    readonly explanation?: Explanation;
  },
): Promise<T | undefined> {
  let selected = options.initial ?? 0;
  const hint = paint(STYLE.muted, keyHint(choices, options.quit ?? "goes back"));
  const explanation = explanationLines(options.explanation);
  return withRawTerminal(async (next, moreWithin) => {
    process.stderr.write(`\n${paint(STYLE.strong, question)}\n`);
    const draw = (): number => {
      const lines = [...explanation, ...listLines(choices, selected), "", hint];
      process.stderr.write(`${lines.join("\n")}\n`);
      return lines.length;
    };
    const answer = (index: number): T => {
      redrawFrom(drawn + QUESTION_LINES);
      process.stderr.write(answerLine(options.label, choices[index]!.label));
      return choices[index]!.value;
    };
    let drawn = draw();
    for (;;) {
      const key = await readKey(next, moreWithin);
      if (key.kind === "back") {
        redrawFrom(drawn + QUESTION_LINES);
        return undefined;
      }
      if (key.kind === "enter") return answer(selected);
      if (key.kind === "up") selected = (selected + choices.length - 1) % choices.length;
      else if (key.kind === "down") selected = (selected + 1) % choices.length;
      else if (key.kind === "digit") {
        const index = choices.findIndex((choice, place) => digitOf(choice, place) === key.digit);
        if (index >= 0) return answer(index);
        continue;
      } else continue;
      redrawFrom(drawn);
      drawn = draw();
    }
  });
}

/** Writes a question as `mhfe` does: bold up to " (" or " [", the rest grey. */
export function writePrompt(text: string): void {
  const notes = [" (", " ["].map((opening) => text.indexOf(opening)).filter((at) => at >= 0);
  const split = notes.length > 0 ? Math.min(...notes) : text.length;
  process.stderr.write(
    `${paint(STYLE.strong, text.slice(0, split))}${paint(STYLE.muted, text.slice(split))}`,
  );
}

/**
 * Asks for a visible answer, such as a file name; Enter alone takes `fallback`. Returns undefined
 * at Escape or when the input ends (Ctrl+D), which goes back. As with choose, the answer becomes a
 * line of the record of answers under `label`.
 */
export async function askLine(
  question: string,
  label: string,
  fallback?: string,
): Promise<string | undefined> {
  const shown = fallback === undefined ? `${question}: ` : `${question} (Enter: ${fallback}): `;
  return withRawTerminal(async (next, moreWithin) => {
    process.stderr.write("\n");
    writePrompt(shown);
    const typed = await readLine(next, true, undefined, moreWithin);
    process.stderr.write("\n");
    redrawFrom(QUESTION_LINES);
    if (typed === undefined) return undefined;
    const trimmed = typed.trim();
    const answer = trimmed === "" ? fallback : trimmed;
    if (answer !== undefined) process.stderr.write(answerLine(label, answer));
    return answer;
  });
}

/** Waits for Enter after `message`; false when the person presses Escape instead. */
export async function waitForEnter(message: string): Promise<boolean> {
  return withRawTerminal(async (next, moreWithin) => {
    writePrompt(message);
    for (;;) {
      const key = await readKey(next, moreWithin);
      if (key.kind === "enter" || key.kind === "back") {
        // The key itself was not shown.
        process.stderr.write("\n");
        return key.kind === "enter";
      }
    }
  });
}
