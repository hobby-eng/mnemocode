// Questions at the terminal: a list chosen with the arrow keys or a number, a typed answer and a
// pause for Enter, drawn on standard error in the style of `mhfe`'s menu (src/bin/mhfe/menu.rs).
// They need a terminal on standard input and standard error (terminalAvailable). An answered
// question leaves one line in a record of answers, which eraseAnswersSince takes away again when
// the person goes back, or draws the screen anew when the terminal has scrolled part of it out of
// reach. A typed answer that cannot be used is explained in one warning line and asked for again
// (askLine); only Escape goes back.

import {
  answerEndRow,
  displayWidth,
  dropRestOfPaste,
  dropTypedAhead,
  InputCancelled,
  readKey,
  readLine,
  rowsOfText,
  terminalColumns,
  UnusableAnswer,
  withRawTerminal,
  type NextByte,
} from "./terminal-input.js";
import { STYLE, terminalPaint, wrapText } from "./terminal.js";

/**
 * The widest line of a list or an explanation: the width of running text in terminal.ts, so that
 * a list fits a terminal of 80 columns unwrapped. A narrower terminal wraps a longer line onto
 * further rows, which rowsOf counts.
 */
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

/** Moves the cursor to the top left of the screen and clears all of it (VT100 "cursor position"
 * and "erase in display", 2). Written raw, as redrawFrom. */
const CLEAR_SCREEN = "\x1b[H\x1b[2J";

/** Terminal height when the terminal does not say: a VT100's 24 rows. */
const DEFAULT_ROWS = 24;

/** The rows of the terminal on standard error, read anew each time, as its width. */
function terminalRows(): number {
  const rows = process.stderr.rows;
  return rows !== undefined && rows > 0 ? rows : DEFAULT_ROWS;
}

/** Colour codes (SGR sequences), which take no room on the screen. */
const STYLE_CODES = /\x1b\[[0-9;]*m/gu;

/**
 * The terminal rows that `lines` take. A terminal narrower than LINE_WIDTH wraps a long line onto
 * further rows, a wide character that does not fit at the right edge whole onto the next one
 * (rowsOfText), and a redraw that moved up by lines would leave the extra rows behind
 * (AUD-008-UI001). The width is read at each redraw, so that a resized terminal is counted anew.
 */
export function rowsOf(lines: readonly string[]): number {
  return lines.reduce((rows, line) => rows + rowsOfText(line.replace(STYLE_CODES, "")), 0);
}

/**
 * The characters that a note or an example of `choices` has beside the longest label within
 * LINE_WIDTH; a longer one is cut (shortened), which a list of the program must never need.
 */
export function notesRoom<T>(choices: readonly Choice<T>[]): number {
  const labelWidth = Math.max(...choices.map((choice) => [...choice.label].length));
  return LINE_WIDTH - LABEL_INDENT - labelWidth - 2;
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
  const noteRoom = notesRoom(choices);
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

/**
 * Width of the grey labels in the record of answers, as in a result (terminal.ts): the longest
 * label that a question of the menu uses, "Fingerprint", so that every answer starts in the same
 * column. A longer label would push its answer out of line; test/menu.test.ts checks them all.
 */
export const ANSWER_LABEL_WIDTH = 11;

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

/** One line of the record of answers: the label of a question and the answer given. */
interface AnswerLine {
  readonly label: string;
  readonly answer: string;
}

/**
 * The lines of the record of answers that choose and askLine wrote since startRecord, in order,
 * so that eraseAnswersSince can count their rows at the width the terminal has then, as a list is
 * counted anew at each redraw, and draw them again. A question erases itself once it is answered
 * or left, so only these lines stay on the screen between the questions of the menu.
 */
const answerLines: AnswerLine[] = [];

/** A line of the record as it shows: a grey label and the answer in cyan, indented as the facts of
 * a result (terminalResultHeader) and the summary lines of `mhfe`. */
function shownAnswer(line: AnswerLine): string {
  const name = line.label.padEnd(ANSWER_LABEL_WIDTH);
  return `${TEXT_INDENT}${paint(STYLE.muted, name)} ${paint(STYLE.accent, line.answer)}`;
}

/** The rows that lines of the record take now (rowsOf leaves out their colours). */
function recordRows(lines: readonly AnswerLine[]): number {
  return rowsOf(lines.map(shownAnswer));
}

/**
 * How far down the record of answers and the questions below it have reached since the record
 * started: the most rows from its first row down to the cursor's, which is counted too. Where
 * that is more than the terminal has, the terminal scrolled, and the rows that went over its top
 * edge are in its scrollback, out of reach of any cursor move.
 */
let reached = 1;

/** Notes that the screen shows `below` rows under the record of answers, the cursor's included. */
function reach(below: number): void {
  reached = Math.max(reached, recordRows(answerLines) + below);
}

/** Draws again what stands above the record of answers when the screen is drawn anew. */
let drawHeading: () => void = () => undefined;

/**
 * Starts the record of answers on the row of the cursor, below what the screen shows already, such
 * as the heading of the menu or the output of a command. `heading` writes that heading again, for
 * when the screen must be drawn anew (eraseAnswersSince); it stays for the records after this one.
 */
export function startRecord(heading?: () => void): void {
  answerLines.length = 0;
  reached = 1;
  if (heading !== undefined) drawHeading = heading;
}

/** Writes one line of the record of answers. */
function writeAnswer(label: string, answer: string): void {
  const line = { label, answer };
  process.stderr.write(`${shownAnswer(line)}\n`);
  answerLines.push(line);
  reach(1);
}

/** A place in the record of answers, for eraseAnswersSince: the lines written before it. */
export function answerMark(): number {
  return answerLines.length;
}

/**
 * Erases the lines of the record of answers written since `mark`, so that the screen shows the
 * record as it was there and the next line goes where the first of them was. Nothing but answers
 * and questions may have been written since `mark`: any other line would not be counted.
 *
 * The record may have started on the terminal's last row, so the first line to erase is still on
 * the screen only when no more rows than the terminal has were drawn from it down. Otherwise the
 * screen is cleared and drawn again from its top: the heading and the lines of the record that
 * stay. What scrolled away stays in the scrollback, where no program can take it back.
 */
export function eraseAnswersSince(mark: number): void {
  const kept = answerLines.slice(0, mark);
  const erased = answerLines.splice(mark);
  if (recordRows(kept) >= reached - terminalRows()) {
    redrawFrom(recordRows(erased));
    return;
  }
  process.stderr.write(CLEAR_SCREEN);
  drawHeading();
  for (const line of kept) process.stderr.write(`${shownAnswer(line)}\n`);
  // Counted from the record's own row again, as if it had started on the last row.
  reached = recordRows(kept) + 1;
}

/** The rows of the blank line and the question that start every question, erased with its list. */
function questionRows(question: string): number {
  return 1 + rowsOf([question]);
}

/** The yellow "!" and the space before the text of a warning, as terminalNotice writes them. */
const WARNING_MARK_WIDTH = 2;

/** A warning in the lines of a question, as terminalNotice shows one: a yellow "!", wrapped. */
function warningLines(message: string | undefined): string[] {
  if (message === undefined) return [];
  return wrapText(message, LINE_WIDTH - WARNING_MARK_WIDTH).map(
    (line, index) =>
      `${index === 0 ? paint(STYLE.warning, "!") : " "} ${paint(STYLE.warning, line)}`,
  );
}

/** How choose asks. */
export interface ChooseOptions {
  /** The label of the answer in the record of answers. */
  readonly label: string;
  /** The place of the entry chosen at first. */
  readonly initial?: number;
  /** What Escape does, for the key hint: "goes back" by default, or "quits". */
  readonly quit?: string;
  readonly explanation?: Explanation;
  /** Why the question is asked, such as why it is asked again, shown above it. */
  readonly warning?: string;
}

/**
 * Asks `question` and lets the person choose an entry with the arrow keys and Enter, or at once with
 * its digit. Returns the value of the entry, or undefined for Escape, which `quit` describes ("goes
 * back", "quits"). The question stands apart, after a blank line, with a `warning` above it, such
 * as why it is asked again, and its `explanation` below; once it is answered, the question and its
 * list are replaced by one line of the record of answers, its `label` and the chosen entry, so that
 * the questions asked so far read as a short summary.
 */
export async function choose<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: ChooseOptions,
): Promise<T | undefined> {
  let selected = options.initial ?? 0;
  const hint = paint(STYLE.muted, keyHint(choices, options.quit ?? "goes back"));
  const explanation = explanationLines(options.explanation);
  const warning = warningLines(options.warning);
  return withRawTerminal(async (next, moreWithin) => {
    const above = warning.map((line) => `${line}\n`).join("");
    process.stderr.write(`\n${above}${paint(STYLE.strong, question)}\n`);
    const draw = (): string[] => {
      const lines = [...explanation, ...listLines(choices, selected), "", hint];
      process.stderr.write(`${lines.join("\n")}\n`);
      // Down to the row under the hint, where the cursor waits.
      reach(rowsOf(warning) + questionRows(question) + rowsOf(lines) + 1);
      return lines;
    };
    // Everything from the blank line that starts the question down to the cursor.
    const erase = (): void => redrawFrom(rowsOf(drawn) + rowsOf(warning) + questionRows(question));
    const answer = (index: number): T => {
      erase();
      writeAnswer(options.label, choices[index]!.label);
      return choices[index]!.value;
    };
    let drawn = draw();
    for (;;) {
      const key = await readKey(next, moreWithin);
      if (key.kind === "back") {
        erase();
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
      // Recount the previous logical lines at the current width after terminal reflow.
      redrawFrom(rowsOf(drawn));
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

/** How askLine asks, and what it takes. */
export interface LineQuestion {
  /** The answer that Enter alone gives, shown in the prompt. */
  readonly fallback?: string;
  /**
   * For a question that may be left out: what Enter alone means, shown in the prompt and in the
   * record of answers, such as "random"; askLine then returns "".
   */
  readonly optional?: string;
  /** What to type, for the line after an empty answer: "Type <what>, or press Esc to go back." */
  readonly what?: string;
  /** Why the question is asked, such as why it is asked again, shown above it. */
  readonly warning?: string;
  /**
   * Checks an answer, the fallback too, and returns it as it is used and recorded, such as a file
   * name without the quotes that a dropped file brought. An Error is the warning above the same
   * question asked again; it must not repeat a secret, and no answer here is one.
   */
  readonly check?: (answer: string) => string | Promise<string>;
}

/** What one asking of a typed question gave. */
type LineOutcome =
  | { readonly kind: "answer"; readonly answer: string }
  | { readonly kind: "back" }
  /** The answer could not be used: why, shown above the question when it is asked again. */
  | { readonly kind: "refused"; readonly reason: string };

const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION = 0b1000_0000;

/** The bytes that start a character on the screen: not a control byte, not a UTF-8 continuation. */
function startsCharacter(byte: number): boolean {
  return byte >= 0x20 && byte !== 0x7f && (byte & CONTINUATION_MASK) !== CONTINUATION;
}

/**
 * The bytes of the UTF-8 character that `first` starts, or 0 for a byte that starts none (RFC 3629,
 * section 4): a continuation byte; C0 and C1, which only overlong forms use; F5 to FF, which would
 * lie beyond U+10FFFF.
 */
function characterLength(first: number): number {
  if (first < 0x80) return 1;
  if (first >= 0xc2 && first <= 0xdf) return 2;
  if (first >= 0xe0 && first <= 0xef) return 3;
  if (first >= 0xf0 && first <= 0xf4) return 4;
  return 0;
}

/** Decodes UTF-8 as readLine decodes an answer: anything else, such as a surrogate, throws. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Whether `bytes`, one character's, are valid UTF-8. */
function isValidCharacter(bytes: readonly number[]): boolean {
  try {
    STRICT_UTF8.decode(Uint8Array.from(bytes));
    return true;
  } catch {
    return false;
  }
}

/** Why an answer is refused that held bytes of no UTF-8 character, as readLine says it. */
const NOT_UTF8 = "The answer is not valid UTF-8 text.";

/** A reader for readLine that passes on only valid UTF-8 (validCharacters). */
interface CharacterReader {
  readonly next: NextByte;
  /** Whether a byte was left out. */
  readonly leftOut: () => boolean;
}

/**
 * Reads `next` and passes on the control bytes and whole characters of valid UTF-8 only, each
 * character once all of its bytes have come; any other byte, such as é from a terminal set to
 * Latin-1, is left out and noted. readLine would show such a byte, which each terminal draws in
 * its own way, and refuse the answer only at its end, when the rows that it took could no longer
 * be counted. Left out, the answer read is the answer shown, and askLine refuses it at Enter.
 */
function validCharacters(next: NextByte): CharacterReader {
  let leftOut = false;
  // The rest of a character whose first byte was passed on.
  const rest: number[] = [];
  const read: NextByte = async () => {
    if (rest.length > 0) return rest.shift();
    let byte = await next();
    for (;;) {
      if (byte === undefined) return undefined;
      const length = characterLength(byte);
      if (length === 1) return byte;
      const character = [byte];
      while (character.length < length) {
        byte = await next();
        if (byte === undefined || (byte & CONTINUATION_MASK) !== CONTINUATION) break;
        character.push(byte);
      }
      const whole = length > 0 && character.length === length;
      if (whole && isValidCharacter(character)) {
        rest.push(...character.slice(1));
        return character[0];
      }
      leftOut = true;
      // A byte that cut a character short starts what comes next; after the rest, read on.
      if (length === 0 || whole) byte = await next();
    }
  };
  return { next: read, leftOut: () => leftOut };
}

/**
 * Asks for a visible answer, such as a file name, until it can be used: Enter alone takes the
 * `fallback`, or leaves out an `optional` answer (""), and asks again with a hint where there is
 * neither; an answer that is not UTF-8 (validCharacters) or that readLine refuses as too long, or
 * that `check` refuses, is explained in one warning line above the same question. Returns
 * undefined at Escape or when the input ends (Ctrl+D), which goes back. Only keys pressed after the
 * question shows answer it (dropTypedAhead). As with choose, the question goes once it is answered
 * or left, and the answer becomes a line of the record of answers under `label`.
 */
export async function askLine(
  question: string,
  label: string,
  options: LineQuestion = {},
): Promise<string | undefined> {
  const enter = options.fallback ?? options.optional;
  const shown = enter === undefined ? `${question}: ` : `${question} (Enter: ${enter}): `;
  let warning = options.warning;
  for (;;) {
    const outcome = await askLineOnce(shown, label, options, warning);
    if (outcome.kind === "back") return undefined;
    if (outcome.kind === "answer") return outcome.answer;
    warning = outcome.reason;
  }
}

/** One asking of askLine's question, `shown` as its prompt, with `warning` above it. */
async function askLineOnce(
  shown: string,
  label: string,
  options: LineQuestion,
  warning: string | undefined,
): Promise<LineOutcome> {
  const promptWidth = displayWidth(shown);
  const warned = warningLines(warning);
  return withRawTerminal(async (next, moreWithin) => {
    await dropTypedAhead();
    process.stderr.write(`\n${warned.map((line) => `${line}\n`).join("")}`);
    writePrompt(shown);
    // The row of the cursor below the first row of the prompt: after the prompt, where Ctrl+D
    // leaves it, until the answer says otherwise.
    let endRow = answerEndRow(promptWidth, "");
    // Down to the cursor's row, and up from it to the blank line that starts the question.
    const reachDown = (): void => reach(1 + rowsOf(warned) + endRow + 1);
    const erase = (): void => redrawFrom(1 + rowsOf(warned) + endRow);
    reachDown();
    const reader = validCharacters(next);
    // Counted for an answer longer than readLine takes, refused halfway: its rows can then only be
    // estimated. No person types that much, so it was pasted, without corrections.
    let characters = 0;
    const counted: NextByte = async () => {
      const byte = await reader.next();
      if (byte !== undefined && startsCharacter(byte)) characters += 1;
      return byte;
    };
    let typed: string | undefined;
    try {
      typed = await readLine(counted, {
        echo: true,
        moreWithin,
        escapeGoesBack: true,
        promptWidth,
        onBack: (_columns, row) => {
          endRow = row;
        },
      });
    } catch (error) {
      if (!(error instanceof UnusableAnswer)) throw error;
      // The rest of a paste would otherwise answer the question when it is asked again.
      await dropRestOfPaste(next, moreWithin);
      endRow = Math.floor((promptWidth + characters) / terminalColumns());
      reachDown();
      erase();
      return { kind: "refused", reason: error.message };
    }
    if (typed !== undefined) endRow = answerEndRow(promptWidth, typed);
    reachDown();
    erase();
    if (typed === undefined) return { kind: "back" };
    if (reader.leftOut()) return { kind: "refused", reason: NOT_UTF8 };
    return settledAnswer(typed.trim(), label, options);
  });
}

/** What a typed answer, trimmed, gives: the answer recorded, or why it is asked again. */
async function settledAnswer(
  typed: string,
  label: string,
  options: LineQuestion,
): Promise<LineOutcome> {
  if (typed === "" && options.optional !== undefined) {
    writeAnswer(label, options.optional);
    return { kind: "answer", answer: "" };
  }
  const answer = typed === "" ? options.fallback : typed;
  if (answer === undefined)
    return {
      kind: "refused",
      reason: `Type ${options.what ?? "an answer"}, or press Esc to go back.`,
    };
  try {
    const accepted = options.check === undefined ? answer : await options.check(answer);
    writeAnswer(label, accepted);
    return { kind: "answer", answer: accepted };
  } catch (error) {
    if (error instanceof InputCancelled || !(error instanceof Error)) throw error;
    return { kind: "refused", reason: error.message };
  }
}

/** The bytes that readKey takes for Escape besides it: q, Q and Ctrl+D (terminal-input.ts). */
const ESCAPE_ALIASES: ReadonlySet<number> = new Set([0x71, 0x51, 0x04]);

/** `next` for one key that readKey reads, with ESCAPE_ALIASES left out where the key starts. */
function withoutEscapeAliases(next: NextByte): NextByte {
  let started = false;
  return async () => {
    if (started) return next();
    for (;;) {
      const byte = await next();
      if (byte === undefined || !ESCAPE_ALIASES.has(byte)) {
        started = true;
        return byte;
      }
    }
  };
}

/** How waitForEnter waits. */
export interface EnterOptions {
  /**
   * Only Escape itself leaves, as where it quits a program: q, Q and Ctrl+D are left out with every
   * other key, so that a word or the rest of a paste meant for a command that has ended cannot. The
   * end of the input still leaves, since no key can come after it.
   */
  readonly onlyEscapeLeaves?: boolean;
}

/**
 * Waits for Enter after `message`; false when the person presses Escape instead. Only keys pressed
 * after the message shows count (dropTypedAhead): a second Enter, pressed while a result was being
 * worked out, would otherwise clear the screen with the result before it was read.
 */
export async function waitForEnter(message: string, options: EnterOptions = {}): Promise<boolean> {
  return withRawTerminal(async (next, moreWithin) => {
    await dropTypedAhead();
    writePrompt(message);
    for (;;) {
      const keyBytes = options.onlyEscapeLeaves === true ? withoutEscapeAliases(next) : next;
      const key = await readKey(keyBytes, moreWithin);
      if (key.kind === "enter" || key.kind === "back") {
        // The key itself was not shown.
        process.stderr.write("\n");
        return key.kind === "enter";
      }
    }
  });
}
