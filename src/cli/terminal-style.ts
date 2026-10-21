// The palette of every bip_tools command-line tool (the same as `mhfe`), the rule that decides
// whether a stream gets colour, and the painted lines that a result, a checked fact and an error
// share. A leaf without imports, written in TypeScript that Node runs by
// stripping its types, so that a maintainer script takes it as the command line does
// (scripts/sign-release.mjs).

/**
 * SGR codes of the shared palette. Bright black is the grey of most schemes; "dim" is too faint in
 * some.
 */
export const STYLE = {
  heading: "1;36",
  accent: "36",
  strong: "1",
  muted: "90",
  good: "1;32",
  warning: "1;33",
  bad: "1;31",
} as const;

/**
 * Whether `stream` gets colour, decided as the Rust tools decide it: NO_COLOR turns it off,
 * CLICOLOR_FORCE turns it on, and otherwise only a terminal that is not "dumb" and has not set
 * CLICOLOR=0 gets it.
 */
export function streamGetsColor(stream: { readonly isTTY?: boolean }): boolean {
  const environment = process.env;
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== "") return false;
  const force = environment.CLICOLOR_FORCE;
  if (force !== undefined && force !== "" && force !== "0") return true;
  if (!streamCanRedraw(stream)) return false;
  return environment.CLICOLOR !== "0";
}

/** Whether the terminal says it cannot move the cursor or clear the screen: TERM=dumb. */
export function dumbTerminal(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.TERM === "dumb";
}

/**
 * Whether `stream` is a terminal that can move its cursor and rewrite a line: a terminal that is
 * not "dumb". Colour and a progress line that rewrites itself both ask it.
 */
export function streamCanRedraw(stream: { readonly isTTY?: boolean }): boolean {
  return stream.isTTY === true && !dumbTerminal();
}

/** A stream as far as colour is concerned: whether it is a terminal. */
export interface ColorStream {
  readonly isTTY?: boolean;
}

/** The SGR sequence that ends a painted run. */
export const SGR_RESET = "\x1b[0m";
/** Every colour code that paint writes (an SGR sequence), which takes no room on the screen. */
// oxlint-disable-next-line no-control-regex -- an SGR sequence begins with ESC, which it must match
export const STYLE_CODES = /\x1b\[[0-9;]*m/gu;

/**
 * C0, DEL/C1, line separators and direction controls are unsafe before owned terminal styling.
 */
// oxlint-disable-next-line no-control-regex -- it identifies unsafe display controls
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/gu;

/** Outside text for display only: control characters become U+FFFD; original data is unchanged. */
export function printableText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, "\ufffd");
}

/** `text` in the style `code` when `stream` gets colour, otherwise unchanged. */
export function paint(stream: ColorStream, code: string, text: string): string {
  return streamGetsColor(stream) ? `\x1b[${code}m${text}${SGR_RESET}` : text;
}

/** Longest line of running text, so that messages read well in an 80-column terminal. */
export const TEXT_WIDTH = 78;
/** A notice's mark ("✓" or "!") and the space after it, before each of its lines. */
const NOTICE_MARK_WIDTH = 2;
/** The mark of an error on a terminal, as in `mhfe`. */
const ERROR_MARK = "✗ Error:";
/** An error's mark and the space after it: the indent of the error's other lines. */
const ERROR_MARK_WIDTH = ERROR_MARK.length + 1;
/** The indent of a fact's label. */
const FACT_INDENT = 2;
/** The space between the column of a fact's label and its value. */
const FACT_GAP = 1;

/** The characters of `text` that a terminal shows: its colour codes (STYLE_CODES) take no room. */
function shownLength(text: string): number {
  return text.replace(STYLE_CODES, "").length;
}

/**
 * Breaks `text` into lines of at most `width` characters at spaces; colour codes take no room,
 * and a word longer than `width` keeps a line of its own.
 */
export function wrapText(text: string, width: number = TEXT_WIDTH): string[] {
  const lines: string[] = [];
  let line = "";
  let length = 0;
  for (const word of text.split(" ").filter((part) => part !== "")) {
    const size = shownLength(word);
    if (line !== "" && length + 1 + size > width) {
      lines.push(line);
      line = "";
    }
    length = line === "" ? size : length + 1 + size;
    line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * `text` wrapped to TEXT_WIDTH beside `mark`, which is `indent` characters wide with its space:
 * the mark before the first line, as many spaces before the others, each line in `style`. A text
 * that fits stays as it is, its spaces included, and a text without words still gets its mark.
 */
export function besideMark(
  mark: string,
  indent: number,
  text: string,
  style: (line: string) => string = (line) => line,
): string[] {
  const width = TEXT_WIDTH - indent;
  const lines = shownLength(text) <= width ? [text] : wrapText(text, width);
  return (lines.length > 0 ? lines : [""]).map(
    (line, index) => `${index === 0 ? mark : " ".repeat(indent)}${style(line)}`,
  );
}

/** The narrowest label column of a result, so that short labels line up as in `mhfe`. */
const MIN_LABEL_WIDTH = 10;

/** "MnemoCode · <title>": the heading of a result, a self-test, the menu or a maintainer script. */
export function headingLine(stream: ColorStream, title: string): string {
  const dot = paint(stream, STYLE.muted, "·");
  return `${paint(stream, STYLE.heading, "MnemoCode")} ${dot} ${paint(stream, STYLE.strong, title)}`;
}

/**
 * A fact under a heading: its grey label in a column `width` wide, then its value, wrapped to
 * TEXT_WIDTH under its own column as in `mhfe`; several lines are joined by line breaks.
 */
export function factLine(stream: ColorStream, label: string, value: string, width: number): string {
  const grey = paint(stream, STYLE.muted, label.padEnd(width));
  const mark = `${" ".repeat(FACT_INDENT)}${grey}${" ".repeat(FACT_GAP)}`;
  // A label longer than its column pushes the value on.
  const indent = FACT_INDENT + Math.max(width, label.length) + FACT_GAP;
  return besideMark(mark, indent, value).join("\n");
}

/**
 * The lines of a result: its heading (headingLine) after a blank line, then its facts as grey
 * labels with their values, like the summary of `mhfe`.
 */
export function resultLines(
  stream: ColorStream,
  title: string,
  rows: readonly (readonly [string, string])[],
): string[] {
  const width = Math.max(MIN_LABEL_WIDTH, ...rows.map(([label]) => label.length));
  return [
    `\n${headingLine(stream, title)}`,
    ...rows.map(([label, value]) => factLine(stream, label, value, width)),
  ];
}

/** What a notice says: news, a success after a green ✓, or a warning after a yellow !. */
export type NoticeKind = "info" | "success" | "warning";

/** The mark and the style of a notice that has one. */
const NOTICE_MARKS = {
  success: { mark: "✓", code: STYLE.good },
  warning: { mark: "!", code: STYLE.warning },
} as const;

/**
 * Running text as `stream` shows it: on a terminal wrapped to TEXT_WIDTH, without colour; for a
 * file, a pipe or TERM=dumb as it is, on one line, as a script reads it.
 */
export function runningLines(stream: ColorStream, text: string): string[] {
  return streamCanRedraw(stream) ? wrapText(text) : [text];
}

/**
 * Advice that can be read and passed over: on a terminal wrapped, for a file, a pipe or TERM=dumb
 * as it is (runningLines); grey wherever the stream gets colour, CLICOLOR_FORCE included.
 */
export function hintLines(stream: ColorStream, message: string): string[] {
  return runningLines(stream, message).map((line) => paint(stream, STYLE.muted, line));
}

/**
 * A success or a warning after its mark, a warning in yellow, wrapped beside the mark: as a notice
 * shows one in colour, and as a question shows its warning and a maintainer script warns, which
 * keep the mark also without colour.
 */
export function markedLines(
  stream: ColorStream,
  message: string,
  kind: Exclude<NoticeKind, "info">,
): string[] {
  const { mark, code } = NOTICE_MARKS[kind];
  const style = (line: string): string => (kind === "warning" ? paint(stream, code, line) : line);
  return besideMark(`${paint(stream, code, mark)} `, NOTICE_MARK_WIDTH, message, style);
}

/**
 * The lines of a notice: for a file, a pipe or TERM=dumb the message as it is, one line, news grey
 * and a warning yellow where CLICOLOR_FORCE gives the stream colour; on a terminal news as a hint,
 * a success or a warning after its mark (markedLines), with colour where it gets colour. NO_COLOR
 * and CLICOLOR take only the colour away, CLICOLOR_FORCE only adds it (AUD-037-UI006).
 */
export function noticeLines(stream: ColorStream, message: string, kind: NoticeKind): string[] {
  if (kind === "info") return hintLines(stream, message);
  if (streamCanRedraw(stream)) return markedLines(stream, message, kind);
  return [kind === "warning" ? paint(stream, NOTICE_MARKS.warning.code, message) : message];
}

/**
 * A checked fact after a green ✓ (or a yellow ! when `good` is false), its value in bold, wrapped
 * beside the mark to TEXT_WIDTH; several lines are joined by line breaks.
 */
export function statusLine(stream: ColorStream, label: string, value: string, good = true): string {
  const { mark, code } = NOTICE_MARKS[good ? "success" : "warning"];
  // Each word of the value in bold, so that no line carries the bold over to the next.
  const bold = value
    .split(" ")
    .map((word) => (word === "" ? "" : paint(stream, STYLE.strong, word)));
  const text = `${label} ${bold.join(" ")}`;
  return besideMark(`${paint(stream, code, mark)} `, NOTICE_MARK_WIDTH, text).join("\n");
}

/**
 * An error after "✗ Error:" on a terminal, wrapped beside the mark to TEXT_WIDTH as in `mhfe`, its
 * lines joined by line breaks; or after "`program`:", on one line, for a file, a pipe or
 * TERM=dumb. The mark is red wherever the stream gets colour, CLICOLOR_FORCE included.
 */
export function failureLine(stream: ColorStream, program: string, message: string): string {
  const text = printableText(message);
  if (!streamCanRedraw(stream)) return `${paint(stream, STYLE.bad, `${program}:`)} ${text}`;
  return besideMark(`${paint(stream, STYLE.bad, ERROR_MARK)} `, ERROR_MARK_WIDTH, text).join("\n");
}
