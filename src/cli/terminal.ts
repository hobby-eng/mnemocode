// Colours and layout of everything MnemoCode shows in a terminal. They follow the one style of the
// bip_tools command-line tools (the same as `mhfe`): the sixteen standard colours only, cyan for
// headings and options, grey for labels and secondary text, a green ✓, a yellow ! and a red ✗.
// Output that does not go to a terminal carries no colour codes and keeps its plain form.

import {
  STYLE,
  SGR_RESET,
  failureLine,
  hintLines as styledHintLines,
  markedLines as styledMarkedLines,
  noticeLines as styledNoticeLines,
  type NoticeKind,
  paint,
  printableText,
  resultLines,
  statusLine,
  streamCanRedraw,
  streamGetsColor,
  TEXT_WIDTH,
  wrapText,
} from "./terminal-style.js";
import { rgbBytes } from "../export/color-math.js";
import { MILLISECONDS_PER_SECOND } from "../core/search-turns.js";
import { compactCode } from "../core/code-text.js";
import { EncodedForm } from "../core/encoded-form.js";
import type { EncodedFormat } from "../core/types.js";
import { PrivateSteps } from "./private-steps.js";
import { PrivateSummary } from "./private-summary.js";

// The palette, under the name every module of the command line takes it by.
export { STYLE, printableText };

// The running text and its width are terminal-style's, which a maintainer script takes too.
export { TEXT_WIDTH, wrapText, type NoticeKind };

/**
 * Clears the screen and moves to its top left (VT100 "erase in display" and "home"). Written raw,
 * as every sequence below: NO_COLOR removes colours, not these.
 */
export const CLEAR_SCREEN = "\x1b[2J\x1b[H";
/** Clears from the cursor to the end of the screen (VT100 "erase in display"). */
export const ERASE_BELOW = "\x1b[J";

/** Moves the cursor up `lines` lines (VT100 "cursor up"); nothing for none. */
export function cursorUp(lines: number): string {
  return lines > 0 ? `\x1b[${lines}A` : "";
}

/** Moves the cursor down `lines` lines (VT100 "cursor down"); nothing for none. */
export function cursorDown(lines: number): string {
  return lines > 0 ? `\x1b[${lines}B` : "";
}

/** Moves the cursor right `columns` columns (VT100 "cursor forward"); nothing for none. */
export function cursorRight(columns: number): string {
  return columns > 0 ? `\x1b[${columns}C` : "";
}
/**
 * Switches to the alternate screen, clears it and moves to its top left (xterm control sequences,
 * also understood by tmux and most terminals).
 */
export const ENTER_ALTERNATE_SCREEN = `\x1b[?1049h${CLEAR_SCREEN}`;
/**
 * Clears the alternate screen, then returns to the main screen with its earlier content. The
 * clear comes first, so that the words also vanish where there is no alternate screen.
 */
export const LEAVE_ALTERNATE_SCREEN = `${CLEAR_SCREEN}\x1b[?1049l`;

/**
 * Resolves once everything written to `stream` before has been handed on: a Windows console takes
 * standard output asynchronously.
 */
export function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}

/** A standard stream that a result is written to. */
export type Channel = "stdout" | "stderr";

/** Writes one line to `channel`. */
export function terminalLine(channel: Channel, line: string): void {
  if (channel === "stdout") console.log(line);
  else console.error(line);
}

/** Whether `channel` gets colour (streamGetsColor, the rule of every bip_tools tool). */
function terminalColor(channel: Channel): boolean {
  return streamGetsColor(process[channel]);
}

/**
 * Whether `channel` is shown as a person's terminal: one that can redraw, not TERM=dumb
 * (streamCanRedraw), whatever NO_COLOR, CLICOLOR or CLICOLOR_FORCE say, which decide its colour
 * alone; a file, a pipe and TERM=dumb take the plain form of a script (AUD-037-UI006).
 */
export function terminalLayout(channel: Channel): boolean {
  return streamCanRedraw(process[channel]);
}

export function terminalPaint(channel: Channel, code: string, text: string): string {
  return paint(process[channel], code, text);
}

/**
 * The heading of a result, "MnemoCode · <title>", and its facts as grey labels with their values,
 * like the summary of `mhfe`, on `channel`. Returns false without printing when it is no terminal
 * (terminalLayout); the caller then prints its plain form.
 */
export function terminalResultHeader(
  title: string,
  rows: readonly [string, string][],
  channel: Channel = "stdout",
): boolean {
  PrivateSteps.showResult();
  const lines = resultHeaderLines(title, rows, channel);
  for (const line of lines) terminalLine(channel, line);
  return lines.length > 0;
}

/**
 * The lines that terminalResultHeader prints, a blank line first, or none when `channel` is no
 * terminal: what a check of the room on the screen measures.
 */
export function resultHeaderLines(
  title: string,
  rows: readonly [string, string][],
  channel: Channel = "stdout",
): string[] {
  return terminalLayout(channel) ? resultLines(process[channel], title, rows) : [];
}

/**
 * A checked fact after a green ✓ (or a yellow ! when `good` is false): its label and its value in
 * bold.
 */
export function terminalStatus(label: string, value: string, good: boolean = true): void {
  console.error(statusLine(process.stderr, label, value, good));
}

/** Advice that can be read and passed over: grey, wrapped to the text width. */
export function terminalHint(message: string): void {
  for (const line of hintLines(message)) console.error(line);
}

/** Shows a slow private-screen step; scripts keep their existing machine-readable output. */
export function terminalWork(message: string): void {
  if (!PrivateSteps.active) return;
  PrivateSteps.begin();
  terminalHint(message);
}

/** The lines of terminalHint (hintLines of terminal-style.ts, on standard error). */
function hintLines(message: string): string[] {
  return styledHintLines(process.stderr, message);
}

/** Human-facing status goes to stderr; redirected output contains no ANSI escapes. */
export function terminalNotice(message: string, kind: NoticeKind = "info"): void {
  if (kind === "warning") PrivateSteps.remember(message);
  for (const line of noticeLines(message, kind)) console.error(line);
}

/**
 * A result saved, after a green ✓: where it went and how many files, such as "Saved PDF:
 * cards.pdf", never what it holds. After a private screen the line stays in the summary that is
 * left on the main screen (PrivateSummary).
 */
export function terminalSaved(message: string): void {
  PrivateSummary.add({ kind: "success", text: message });
  terminalNotice(message, "success");
}

/**
 * A warning that still holds once the command has ended, such as a file left behind to delete or
 * a fingerprint that is only a filter. After a private screen it stays in the summary that is left
 * on the main screen (PrivateSummary), so it never holds a secret. A warning about an answer that
 * is then asked again is a terminalNotice.
 */
export function terminalLastingWarning(message: string): void {
  PrivateSummary.add({ kind: "warning", text: message });
  terminalNotice(message, "warning");
}

/** The lines of terminalNotice (noticeLines of terminal-style.ts, on standard error). */
export function noticeLines(message: string, kind: NoticeKind = "info"): string[] {
  return styledNoticeLines(process.stderr, message, kind);
}

/** A success or a warning after its mark, on standard error (markedLines of terminal-style.ts). */
export function markedLines(message: string, kind: "success" | "warning"): string[] {
  return styledMarkedLines(process.stderr, message, kind);
}

/** Words per row when a phrase is shown for writing down, as `mhfe` shows one. */
const WORDS_PER_ROW = 4;
/** The longest word of the English BIP39 list has eight letters. */
const LONGEST_WORD = 8;
/** Spaces between two words of a row. */
const WORD_GAP = 3;

/**
 * The label of one part of a result, after a blank line: bold for the part that matters most, grey
 * for the others. Only where terminalResultHeader printed the heading of that result.
 */
export function terminalPart(
  label: string,
  strong: boolean = false,
  channel: Channel = "stdout",
): void {
  terminalLine(channel, partLine(label, strong, channel));
}

/** The line that terminalPart writes, its blank line first. */
export function partLine(
  label: string,
  strong: boolean = false,
  channel: Channel = "stdout",
): string {
  return `\n${terminalPaint(channel, strong ? STYLE.strong : STYLE.muted, label)}`;
}

/** The number before an item of a numbered row, such as " 12.", with the space after it. */
const NUMBER_CELL = 5;
/** The indent of a numbered row. */
const ROW_INDENT = "  ";

/**
 * `items` numbered from 1, `perRow` to a row, the numbers grey and the items bold, each padded to
 * `width` to line up the next; then `copy` on one plain line, for copying, on `channel`. Returns
 * false without printing when it is no terminal (terminalLayout); the caller then prints its plain
 * form.
 */
function terminalNumbered(
  items: readonly string[],
  width: number,
  perRow: number,
  copy: string,
  channel: Channel,
): boolean {
  if (!terminalLayout(channel)) return false;
  for (let start = 0; start < items.length; start += perRow) {
    const row = items.slice(start, start + perRow);
    const cells = row.map((item, column) => {
      const number = terminalPaint(
        channel,
        STYLE.muted,
        `${String(start + column + 1).padStart(NUMBER_CELL - 2)}.`,
      );
      // The last item of a row needs no padding to line up the next one.
      const padded = column === row.length - 1 ? item : item.padEnd(width);
      return `${number} ${terminalPaint(channel, STYLE.strong, padded)}`;
    });
    terminalLine(channel, `${ROW_INDENT}${cells.join(" ".repeat(WORD_GAP))}`);
  }
  terminalLine(channel, terminalPaint(channel, STYLE.muted, "On one line, for copying:"));
  terminalLine(channel, copy);
  return true;
}

/**
 * A seed phrase for a person to write down, as `mhfe` shows one: numbered, four words to a row;
 * then on one plain line, for copying (terminalNumbered). False when it is no terminal.
 */
export function terminalPhrase(phrase: string, channel: Channel = "stdout"): boolean {
  return terminalNumbered(phrase.split(" "), LONGEST_WORD, WORDS_PER_ROW, phrase, channel);
}

/**
 * Codes written joined, such as Unicode codes, shown apart, separated by spaces and wrapped at
 * them, so that a person sees each code and which one to mark with ?; then `joined`, the text as
 * written, on one plain line, for copying (owner, 2026-10-13: both views, without numbers).
 */
function joinedCodeLines(codes: readonly string[], joined: string): string[] {
  return [
    ...wrapText(codes.join(" ")).map((line) => terminalPaint("stdout", STYLE.strong, line)),
    terminalPaint("stdout", STYLE.muted, "Joined, for copying:"),
    joined,
  ];
}

/**
 * The exact lines printCodes writes: on a terminal the codes of a form that writes them joined
 * apart beside the joined text (joinedCodeLines), and the codes of every other form, which are
 * separated by spaces, wrapped at those spaces (CORE-36), as the terminal would otherwise break a
 * long line inside a code; for a file, a pipe or TERM=dumb the text as written, on one line.
 */
export function codeLines(text: string, format: EncodedFormat): string[] {
  if (!terminalLayout("stdout")) return [text];
  const apart = EncodedForm.of(format).apartCodes(text);
  return apart === undefined ? wrapText(text) : joinedCodeLines(apart, compactCode(text));
}

/**
 * `text`, codes written in `format`, on standard output, as codeLines lays them out: Encode's
 * result, and the codes of a phrase restored from shares.
 */
export function printCodes(text: string, format: EncodedFormat): void {
  for (const line of codeLines(text, format)) console.log(line);
}

/**
 * A fingerprint under the phrase it belongs to, as `mhfe` shows one: the label grey, the value bold
 * and a grey note in brackets. Only where terminalResultHeader printed the heading of the result.
 */
export function terminalFingerprint(
  label: string,
  value: string,
  note: string,
  channel: Channel = "stdout",
): void {
  const paint = (code: string, text: string): string => terminalPaint(channel, code, text);
  terminalLine(
    channel,
    `${paint(STYLE.muted, label)}  ${paint(STYLE.strong, value)}  ${paint(STYLE.muted, `(${note})`)}`,
  );
  terminalLine(channel, paint(STYLE.muted, FINGERPRINT_DISCLOSURE));
}

/** What the fingerprints of the command line are made with, as their note says. */
export const FINGERPRINT_NOTE = "empty BIP39 passphrase";

/** The explanation accompanying openly shown original and encoded fingerprints (DOC-05). */
export const FINGERPRINT_DISCLOSURE = "They do not reveal the phrase.";

/** Returns to the start of the line and erases it (VT100 "erase in line"). */
const REWRITE_LINE = "\r\x1b[2K";

/**
 * Seconds between two progress lines of a long search, the share repair's and the word search's
 * wallet check: a line that changes less often stays readable.
 */
export const SEARCH_PROGRESS_SECONDS = 10;

/**
 * The progress of a long search. On a terminal each update replaces the one before, so that the
 * screen keeps one line however long the search runs; in a file or a pipe, or on a "dumb" terminal
 * without control sequences, each is a line of its own. end() closes the line after the search.
 */
export class ProgressLine {
  #open = false;
  readonly #intervalMs: number;
  readonly #now: () => number;
  #shownAt: number;

  /**
   * A line that `showEvery` rewrites at most once every `intervalSeconds`, counted from when the
   * line is made; `now` is the clock, which a test replaces.
   */
  constructor(intervalSeconds = 0, now: () => number = Date.now) {
    this.#intervalMs = intervalSeconds * MILLISECONDS_PER_SECOND;
    this.#now = now;
    this.#shownAt = now();
  }

  /**
   * Shows the line that `message` makes, unless the last was shown less than the interval ago;
   * the message is made only when it is shown. A search reports its progress through it.
   */
  showEvery(message: () => string): void {
    const now = this.#now();
    if (now - this.#shownAt < this.#intervalMs) return;
    this.#shownAt = now;
    this.show(message());
  }

  show(message: string): void {
    if (!streamCanRedraw(process.stderr)) {
      terminalHint(message);
      return;
    }
    // A line longer than the window would wrap, and only its last row would be rewritten.
    const columns = process.stderr.columns;
    const text = columns > 1 && message.length >= columns ? message.slice(0, columns - 1) : message;
    process.stderr.write(`${REWRITE_LINE}${terminalPaint("stderr", STYLE.muted, text)}`);
    this.#open = true;
  }

  end(): void {
    if (this.#open) process.stderr.write("\n");
    this.#open = false;
  }
}

/** The README on GitHub. A message at run time stays short and links to the section that explains
 * it, as in `mhfe`: the program shows no explanatory paragraphs while it works. */
export const README_URL = "https://github.com/hobby-eng/mnemocode";

/** The address of a README section, by its heading's anchor. */
export function readmeLink(anchor: string): string {
  return `${README_URL}#${anchor}`;
}

/** A grey "More:" line that points to the README section explaining the message above it. */
export function terminalMore(anchor: string): void {
  console.error(moreLine(anchor));
}

/**
 * A warning and the README section that explains it (terminalMore). On the private screen both
 * stay on every later step screen of the command, as a warning given before the first question
 * does (PrivateSteps.remember), and then in the summary left on the main screen (PrivateSummary);
 * so it is given only about what holds for the rest of the command, such as a file that is saved,
 * and never holds a secret.
 */
export function terminalWarningWithMore(message: string, anchor: string): void {
  PrivateSummary.add({ kind: "warning", text: message, more: anchor });
  PrivateSteps.keep(() => {
    terminalNotice(message, "warning");
    terminalMore(anchor);
  }, "command");
}

/** The line of terminalMore, grey; not wrapped: a link must stay whole to be clicked or copied. */
export function moreLine(anchor: string): string {
  return terminalPaint("stderr", STYLE.muted, `More: ${readmeLink(anchor)}`);
}

/**
 * A line after a result: a notice of its kind, a warning that still holds once the command has
 * ended ("lasting", terminalLastingWarning), or a link to a README section (terminalMore).
 */
export type ResultNote =
  { readonly text: string; readonly kind: NoticeKind | "lasting" } | { readonly more: string };

/**
 * Writes `note` as its kind says, so that a warning stays above the step that follows on the
 * private screen (PrivateSteps.remember, CORE-39), and a lasting one in the summary too.
 */
export function terminalResultNote(note: ResultNote): void {
  if ("more" in note) terminalMore(note.more);
  else if (note.kind === "lasting") terminalLastingWarning(note.text);
  else terminalNotice(note.text, note.kind);
}

/** The lines that terminalResultNote writes, for a check of the room on the screen. */
export function resultNoteLines(note: ResultNote): string[] {
  if ("more" in note) return [moreLine(note.more)];
  return noticeLines(note.text, note.kind === "lasting" ? "warning" : note.kind);
}

/** An error message after a red "✗ Error:", as `mhfe` writes it. */
export function terminalFailure(message: string): void {
  console.error(failureLine(process.stderr, "mnemocode", message));
}

/** The weights of ITU-R BT.601 in thousandths: 0.299, 0.587 and 0.114. */
const BT601_PER_MILLE = Object.freeze({ red: 299, green: 587, blue: 114, total: 1000 });

/**
 * The brightness of a colour by BT.601, on the 0-255 scale of its channels: what picks black or
 * white text on a colour in the terminal. Summed in whole thousandths, so that no rounding moves
 * a colour across LIGHT_LUMA. The cards have their own rule for print (business-cards.ts), tuned
 * for another medium.
 */
function lumaOf(red: number, green: number, blue: number): number {
  const { red: r, green: g, blue: b, total } = BT601_PER_MILLE;
  return (red * r + green * g + blue * b) / total;
}
/** The brightness above which a colour takes black text. */
const LIGHT_LUMA = 150;

export function colorCards(colors: readonly string[]): string {
  if (!terminalColor("stderr")) return colors.join(" ");
  return colors
    .map((color) => {
      const [red, green, blue] = rgbBytes(color);
      const light = lumaOf(red, green, blue) > LIGHT_LUMA;
      // The colour itself is the content here, so it is shown in true colour, not the palette.
      return `\x1b[48;2;${red};${green};${blue}m\x1b[${light ? "30" : "97"}m ${color} ${SGR_RESET}`;
    })
    .join(" ");
}
