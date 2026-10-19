// Questions at the terminal: a list chosen with the arrow keys or a number, a typed answer and a
// pause for Enter, drawn on standard error in the style of `mhfe`'s menu (src/bin/mhfe/menu.rs).
// They need a terminal on standard input and standard error (terminalAvailable). An answered
// question leaves one line in a record of answers, which eraseAnswersSince takes away again when
// the person goes back, or draws the screen anew when the terminal has scrolled part of it out of
// reach. A typed answer that cannot be used is explained in one warning line and asked for again
// (askLine); only Escape goes back.

import {
  refusedLine,
  dropTypedAhead,
  readKey,
  readLine,
  withRawTerminal,
  refusal,
  ESCAPE_ALIASES,
  NOT_UTF8,
} from "./terminal-input.js";
import { CANCELLED, type Cancelled, type NextByte } from "./terminal-keys.js";
import {
  answerEndRow,
  displayWidth,
  rowsOfText,
  terminalColumns,
  terminalRows,
} from "./terminal-geometry.js";
import {
  STYLE,
  terminalPaint,
  CLEAR_SCREEN,
  markedLines,
  TEXT_WIDTH,
  cursorUp,
  ERASE_BELOW,
} from "./terminal.js";
import { factLine, STYLE_CODES } from "./terminal-style.js";
import { isContinuation, validCharacters } from "./utf8.js";
import type { WordHints } from "../core/word-hints.js";
import { listInWords } from "../core/places.js";
import { defined } from "../core/defined.js";
import { PrivateSteps } from "./private-steps.js";

/** Marker, number and the gaps before a label: "› 1  ". */
const LABEL_INDENT = 5;

export interface Choice<T> {
  readonly label: string;
  /** Grey text after the label. */
  readonly note?: string;
  /** A grey second line under the note, such as an example. */
  readonly example?: string;
  /** The digit that chooses this entry at once; by default its place, 1 to 9; null for none. */
  readonly digit?: number | null;
  readonly value: T;
}

const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);

/** Moves the cursor up `lines` lines to the start of the line, then clears to the end of the
 * screen (VT100 "cursor up" and "erase in display"). Written raw: NO_COLOR does not remove it. */
function redrawFrom(lines: number): void {
  if (lines > 0) process.stderr.write(`${cursorUp(lines)}\r${ERASE_BELOW}`);
}

/**
 * The terminal rows that `lines` take. A terminal narrower than TEXT_WIDTH wraps a long line onto
 * further rows, a wide character that does not fit at the right edge whole onto the next one
 * (rowsOfText), and a redraw that moved up by lines would leave the extra rows behind
 * (AUD-008-UI001). The width is read at each redraw, so that a resized terminal is counted anew.
 */
export function rowsOf(lines: readonly string[]): number {
  // A line may start with a line break of its own, as the heading of a result does.
  return lines
    .flatMap((line) => line.split("\n"))
    .reduce((rows, line) => rows + rowsOfText(line.replace(STYLE_CODES, "")), 0);
}

/**
 * The rows that `question` with `choices` takes while it waits, as choose draws it: a blank line,
 * the question, the list, a blank line, the key hint (what Escape does: `quit`) and the row of
 * the cursor under it. A check of the room on the screen counts a question to come so.
 */
export function listQuestionRows<T>(
  question: string,
  choices: readonly Choice<T>[],
  quit = "goes back",
): number {
  return rowsOf(["", question, ...listLines(choices, 0), "", keyHint(choices, quit), ""]);
}

/**
 * The characters that a note or an example of `choices` has beside the longest label within
 * TEXT_WIDTH; a longer one is cut (shortened), which a list of the program must never need.
 */
export function notesRoom<T>(choices: readonly Choice<T>[]): number {
  const labelWidth = Math.max(...choices.map((choice) => Array.from(choice.label).length));
  return TEXT_WIDTH - LABEL_INDENT - labelWidth - 2;
}

/** `text` cut to `room` characters with "…" at the end, so that it cannot wrap the line. */
export function shortened(text: string, room: number): string {
  const characters = Array.from(text);
  if (characters.length <= room) return text;
  return `${characters.slice(0, Math.max(0, room - 1)).join("")}…`;
}

function digitOf<T>(choice: Choice<T>, index: number): number | undefined {
  if (choice.digit === null) return undefined;
  return choice.digit ?? (index < 9 ? index + 1 : undefined);
}

/** The lines of a list, without colours when the terminal has none; the chosen entry has a cyan
 * marker and a bold label, so that it stands out also without colours. */
export function listLines<T>(choices: readonly Choice<T>[], selected: number): string[] {
  const labelWidth = Math.max(...choices.map((choice) => Array.from(choice.label).length));
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
      const padding = " ".repeat(labelWidth - Array.from(choice.label).length);
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

/**
 * The digits that choose an entry at once, as the hint names them: a range where they are every
 * digit from the lowest to the highest, such as "0 to 9"; otherwise each, in the order of the list,
 * such as "7, 8, 9 or 0" where the entries that ask for a secret are left out.
 */
function digitsInWords(digits: readonly number[]): string {
  const lowest = Math.min(...digits);
  const highest = Math.max(...digits);
  return new Set(digits).size === highest - lowest + 1
    ? `${lowest} to ${highest}`
    : listInWords(digits, "or");
}

function keyHint<T>(choices: readonly Choice<T>[], quit: string): string {
  const digits = choices.map(digitOf).filter((digit) => digit !== undefined);
  const range = digits.length > 1 ? ` · ${digitsInWords(digits)} at once` : "";
  return `↑ ↓ choose · Enter selects${range} · Esc ${quit}`;
}

/**
 * Width of the grey labels in the record of answers and of the facts of the private screen: the
 * longest label that a question of the menu uses, "Fingerprint", so that every answer starts in
 * the same column, as a result's facts do (factLine). A result widens its column to its longest
 * label instead (resultLines), since its labels are known when it is printed; the record's are
 * not. A longer label would push its answer out of line; test/menu.test.ts checks them all.
 */
export const ANSWER_LABEL_WIDTH = 11;

/** Indents of an explanation and of its links under "More:". */
const TEXT_INDENT = "  ";
const LINK_INDENT = "    ";

/**
 * Text shown between a question and its entries: short `lines` in the normal colour, each at most
 * TEXT_WIDTH minus its indent, and links to read `more`, grey under "More:".
 */
export interface Explanation {
  readonly lines: readonly string[];
  readonly more?: readonly string[] | undefined;
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
  return factLine(process.stderr, line.label, paint(STYLE.accent, line.answer), ANSWER_LABEL_WIDTH);
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

/** A warning in the lines of a question, as terminalNotice shows one in colour (markedLines). */
function warningLines(message: string | undefined): string[] {
  return message === undefined ? [] : markedLines(message, "warning");
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
  readonly warning?: string | undefined;
}

/**
 * Asks `question` and lets the person choose an entry with the arrow keys and Enter, or at once
 * with its digit. Returns the value of the entry, undefined for Escape, which `quit` describes
 * ("goes back", "quits"), or CANCELLED for Ctrl+C, also when it was typed ahead. The question stands apart, after a blank line, with a `warning` above it,
 * such as why it is asked again, and its `explanation` below; once it is answered, the question and
 * its list are replaced by one line of the record of answers, its `label` and the chosen entry, so
 * that the questions asked so far read as a short summary.
 */
export async function choose<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: ChooseOptions,
): Promise<T | undefined | Cancelled> {
  // Keys pressed before the question showed, such as the rest of a paste, are dropped and wiped:
  // only keys pressed for it answer it.
  if ((await dropTypedAhead()) === CANCELLED) return CANCELLED;
  PrivateSteps.begin();
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
      writeAnswer(options.label, defined(choices[index]).label);
      // The lines kept for this question on the private screen go with its answer.
      PrivateSteps.answered();
      return defined(choices[index]).value;
    };
    let drawn = draw();
    for (;;) {
      const key = await readKey(next, moreWithin);
      if (key.kind === "cancel") return CANCELLED;
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
  /** The hints below a word being typed, and Tab's completion (core/word-hints.ts). */
  readonly hints?: WordHints;
}

/** What a question asks for where it does not say: any answer. */
const ANY_ANSWER = "an answer";

/**
 * The line after an empty answer: what to type, and how the question is left instead, with Escape
 * (`back`) or, for a secret, with Ctrl+C (`stop`).
 */
export function typeHint(what: string | undefined, leave: "back" | "stop"): string {
  const how = leave === "back" ? "press Esc to go back" : "press Ctrl+C to stop";
  return `Type ${what ?? ANY_ANSWER}, or ${how}.`;
}

/** What a typed answer, trimmed, gives before it is checked (enteredAnswer). */
export type Entered =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "left-out" }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * What a typed answer, trimmed, gives, by the one rule of every question for a typed answer: the
 * text typed; Enter alone the `fallback`, or leaves out an `optional` answer, or asks again with
 * the hint (typeHint). The answer is checked afterwards, as each question checks it.
 */
export function enteredAnswer(
  typed: string,
  rules: Pick<LineQuestion, "fallback" | "optional" | "what"> & { readonly leave: "back" | "stop" },
): Entered {
  if (typed !== "") return { kind: "text", text: typed };
  if (rules.optional !== undefined) return { kind: "left-out" };
  if (rules.fallback !== undefined) return { kind: "text", text: rules.fallback };
  return { kind: "refused", reason: typeHint(rules.what, rules.leave) };
}

/** What one asking of a typed question gave. */
type LineOutcome =
  | { readonly kind: "answer"; readonly answer: string }
  | { readonly kind: "back" }
  /** Ctrl+C: the command is cancelled. */
  | { readonly kind: "cancelled" }
  /** The answer could not be used: why, shown above the question when it is asked again. */
  | { readonly kind: "refused"; readonly reason: string };

/** The bytes that start a character on the screen: not a control byte, not a UTF-8 continuation. */
function startsCharacter(byte: number): boolean {
  return byte >= 0x20 && byte !== 0x7f && !isContinuation(byte);
}

/**
 * Asks for a visible answer, such as a file name, until it can be used (the menu's questions; a
 * command's ask through ask.ts, whose question stays on the screen): Enter alone takes the
 * `fallback`, or leaves out an `optional` answer (""), and asks again with a hint where there is
 * neither; an answer that is not UTF-8 (validCharacters) or that readLine refuses as too long, or
 * that `check` refuses, is explained in one warning line above the same question. Returns
 * undefined at Escape or when the input ends (Ctrl+D), which goes back, and CANCELLED at Ctrl+C. Only keys pressed after the
 * question shows answer it (dropTypedAhead). As with choose, the question goes once it is answered
 * or left, and the answer becomes a line of the record of answers under `label`.
 */
export async function askLine(
  question: string,
  label: string,
  options: LineQuestion = {},
): Promise<string | undefined | Cancelled> {
  // The end of the input goes back here, as Escape does: the menu then leaves at its own question,
  // whose last answer the end of the input picks. A command's question cancels instead
  // (askValueUntil), since nothing can answer it any more.
  const enter = options.fallback ?? options.optional;
  const shown = enter === undefined ? `${question}: ` : `${question} (Enter: ${enter}): `;
  let warning = options.warning;
  for (;;) {
    const outcome = await askLineOnce(shown, label, options, warning);
    if (outcome.kind === "back") return undefined;
    if (outcome.kind === "cancelled") return CANCELLED;
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
  PrivateSteps.begin();
  const promptWidth = displayWidth(shown);
  const warned = warningLines(warning);
  return withRawTerminal(async (next, moreWithin) => {
    if ((await dropTypedAhead()) === CANCELLED) return { kind: "cancelled" };
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
    let typed: string | undefined | Cancelled;
    try {
      typed = await readLine(counted, {
        echo: true,
        moreWithin,
        escapeGoesBack: true,
        promptWidth,
        onBack: (_columns, row) => {
          endRow = row;
        },
        ...(options.hints === undefined ? {} : { hints: options.hints }),
      });
    } catch (error) {
      const reason = await refusedLine(error, next, moreWithin);
      if (reason === CANCELLED) return { kind: "cancelled" };
      endRow = Math.floor((promptWidth + characters) / terminalColumns());
      reachDown();
      erase();
      return { kind: "refused", reason };
    }
    if (typed === CANCELLED) return { kind: "cancelled" };
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
  const entered = enteredAnswer(typed, { ...options, leave: "back" });
  if (entered.kind === "left-out") {
    writeAnswer(label, defined(options.optional));
    return { kind: "answer", answer: "" };
  }
  if (entered.kind === "refused") return entered;
  try {
    const accepted = options.check === undefined ? entered.text : await options.check(entered.text);
    writeAnswer(label, accepted);
    return { kind: "answer", answer: accepted };
  } catch (error) {
    return { kind: "refused", reason: refusal(error) };
  }
}

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
 * Waits for Enter after `message`: "enter", "escape" when the person presses Escape instead, or
 * CANCELLED at Ctrl+C. Only keys pressed after the message shows count (dropTypedAhead): a second
 * Enter, pressed while a result was being worked out, would otherwise clear the screen with the
 * result before it was read.
 */
export async function waitForEnter(
  message: string,
  options: EnterOptions = {},
): Promise<"enter" | "escape" | Cancelled> {
  return withRawTerminal(async (next, moreWithin) => {
    if ((await dropTypedAhead()) === CANCELLED) return CANCELLED;
    writePrompt(message);
    for (;;) {
      const keyBytes = options.onlyEscapeLeaves === true ? withoutEscapeAliases(next) : next;
      const key = await readKey(keyBytes, moreWithin);
      if (key.kind === "cancel") {
        process.stderr.write("\n");
        return CANCELLED;
      }
      if (key.kind === "enter" || key.kind === "back") {
        // The key itself was not shown.
        process.stderr.write("\n");
        return key.kind === "enter" ? "enter" : "escape";
      }
    }
  });
}
