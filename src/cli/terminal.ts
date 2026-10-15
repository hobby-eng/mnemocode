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
  NOTICE_TEXT_WIDTH,
  noticeLines as styledNoticeLines,
  type NoticeKind,
  paint,
  resultLines,
  statusLine,
  streamCanRedraw,
  streamGetsColor,
  TEXT_WIDTH,
  wrapText,
} from "./terminal-style.js";
import { rgbBytes } from "../export/color-math.js";
import { MILLISECONDS_PER_SECOND } from "../core/search-turns.js";
import { capitalized } from "../core/prose.js";
import { compactCode } from "../core/code-text.js";
import { EncodedForm } from "../core/encoded-form.js";
import type { EncodedFormat } from "../core/types.js";
import { PrivateSteps } from "./private-steps.js";

// The palette, under the name every module of the command line takes it by.
export { STYLE };

// The running text and its width are terminal-style's, which a maintainer script takes too.
export { TEXT_WIDTH, NOTICE_TEXT_WIDTH, wrapText, type NoticeKind };

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

/** A standard stream that a result is written to. */
export type Channel = "stdout" | "stderr";

/** Writes one line to `channel`. */
export function terminalLine(channel: Channel, line: string): void {
  if (channel === "stdout") console.log(line);
  else console.error(line);
}

/** Whether `channel` gets colour (streamGetsColor, the rule of every bip_tools tool). */
export function terminalColor(channel: Channel): boolean {
  return streamGetsColor(process[channel]);
}

export function terminalPaint(channel: Channel, code: string, text: string): string {
  return paint(process[channel], code, text);
}

/**
 * The heading of a result, "MnemoCode · <title>", and its facts as grey labels with their values,
 * like the summary of `mhfe`, on `channel`. Returns false without printing when it has no colour;
 * the caller then prints its plain form.
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
 * The lines that terminalResultHeader prints, a blank line first, or none when `channel` has no
 * colour: what a check of the room on the screen measures.
 */
export function resultHeaderLines(
  title: string,
  rows: readonly [string, string][],
  channel: Channel = "stdout",
): string[] {
  return terminalColor(channel) ? resultLines(process[channel], title, rows) : [];
}

/**
 * Control characters: C0, DEL and C1, which move the cursor, erase or ring rather than show, and
 * the marks and controls of text direction, which reorder what is shown.
 */
// oxlint-disable-next-line no-control-regex -- it finds the control characters to replace them
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Text that came from outside the program, such as a QR code image, as it may be shown: each
 * control character becomes U+FFFD, so that the text cannot move the cursor or erase a line.
 */
export function printableText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, "\ufffd");
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
export function hintLines(message: string): string[] {
  return styledHintLines(process.stderr, message);
}

/** Human-facing status goes to stderr; redirected output contains no ANSI escapes. */
export function terminalNotice(message: string, kind: NoticeKind = "info"): void {
  if (kind === "warning") PrivateSteps.remember(message);
  for (const line of noticeLines(message, kind)) console.error(line);
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

// The rule is the library's (core/prose.ts); here too for the front ends that take it with the
// rest.
export { capitalized };

/**
 * The label of one part of a result, after a blank line: bold for the part that matters most, grey
 * for the others. Only where terminalResultHeader printed the heading of that result.
 */
export function terminalPart(
  label: string,
  strong: boolean = false,
  channel: Channel = "stdout",
): void {
  terminalLine(channel, `\n${terminalPaint(channel, strong ? STYLE.strong : STYLE.muted, label)}`);
}

/** The number before an item of a numbered row, such as " 12.", with the space after it. */
const NUMBER_CELL = 5;
/** The indent of a numbered row. */
const ROW_INDENT = "  ";

/**
 * `items` numbered from 1, `perRow` to a row, the numbers grey and the items bold, each padded to
 * `width` to line up the next; then `copy` on one plain line, for copying, on `channel`. Returns
 * false without printing when it has no colour; the caller then prints its plain form.
 */
function terminalNumbered(
  items: readonly string[],
  width: number,
  perRow: number,
  copy: string,
  channel: Channel,
): boolean {
  if (!terminalColor(channel)) return false;
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
 * then on one plain line, for copying (terminalNumbered). False without colour.
 */
export function terminalPhrase(phrase: string, channel: Channel = "stdout"): boolean {
  return terminalNumbered(phrase.split(" "), LONGEST_WORD, WORDS_PER_ROW, phrase, channel);
}

/**
 * Codes written joined, such as Unicode codes, shown apart, separated by spaces and wrapped at
 * them, so that a person sees each code and which one to mark with ?; then `joined`, the text as
 * written, on one plain line, for copying (owner, 2026-10-13: both views, without numbers).
 * False without colour.
 */
export function terminalCodes(codes: readonly string[], joined: string): boolean {
  if (!terminalColor("stdout")) return false;
  for (const line of wrapText(codes.join(" ")))
    console.log(terminalPaint("stdout", STYLE.strong, line));
  console.log(terminalPaint("stdout", STYLE.muted, "Joined, for copying:"));
  console.log(joined);
  return true;
}

/**
 * `text`, codes written in `format`, on standard output: on a terminal, where the form writes its
 * codes joined, apart and numbered beside the joined text (terminalCodes); as written otherwise,
 * and always for a file or a pipe, which keep one plain line.
 */
export function printCodes(text: string, format: EncodedFormat): void {
  const apart = EncodedForm.of(format).apartCodes(text);
  if (apart === undefined || !terminalCodes(apart, compactCode(text))) console.log(text);
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
}

/** What the fingerprints of the command line are made with, as their note says. */
export const FINGERPRINT_NOTE = "empty BIP39 passphrase";

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

/** The line of terminalMore, grey; not wrapped: a link must stay whole to be clicked or copied. */
export function moreLine(anchor: string): string {
  return terminalPaint("stderr", STYLE.muted, `More: ${readmeLink(anchor)}`);
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
