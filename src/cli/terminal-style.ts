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
/** The width of a notice's text beside its mark: running text less the mark. */
export const NOTICE_TEXT_WIDTH = TEXT_WIDTH - NOTICE_MARK_WIDTH;

/** Breaks `text` into lines of at most `width` characters at spaces. */
export function wrapText(text: string, width: number = TEXT_WIDTH): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter((part) => part !== "")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = "";
    }
    line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** The narrowest label column of a result, so that short labels line up as in `mhfe`. */
const MIN_LABEL_WIDTH = 10;

/** "MnemoCode · <title>": the heading of a result, a self-test, the menu or a maintainer script. */
export function headingLine(stream: ColorStream, title: string): string {
  const dot = paint(stream, STYLE.muted, "·");
  return `${paint(stream, STYLE.heading, "MnemoCode")} ${dot} ${paint(stream, STYLE.strong, title)}`;
}

/** A fact under a heading: its grey label in a column `width` wide, then its value. */
export function factLine(stream: ColorStream, label: string, value: string, width: number): string {
  return `  ${paint(stream, STYLE.muted, label.padEnd(width))} ${value}`;
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

/** Advice that can be read and passed over: grey and wrapped with colour, otherwise as it is. */
export function hintLines(stream: ColorStream, message: string): string[] {
  if (!streamGetsColor(stream)) return [message];
  return wrapText(message).map((line) => paint(stream, STYLE.muted, line));
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
  return wrapText(message, NOTICE_TEXT_WIDTH).map((line, index) => {
    const text = kind === "warning" ? paint(stream, code, line) : line;
    return `${index === 0 ? paint(stream, code, mark) : " "} ${text}`;
  });
}

/**
 * The lines of a notice: without colour the message as it is, one line for a file or a pipe; in
 * colour news as a hint, a success or a warning after its mark (markedLines).
 */
export function noticeLines(stream: ColorStream, message: string, kind: NoticeKind): string[] {
  if (!streamGetsColor(stream)) return [message];
  return kind === "info" ? hintLines(stream, message) : markedLines(stream, message, kind);
}

/** A checked fact after a green ✓ (or a yellow ! when `good` is false), its value in bold. */
export function statusLine(stream: ColorStream, label: string, value: string, good = true): string {
  const mark = good ? paint(stream, STYLE.good, "✓") : paint(stream, STYLE.warning, "!");
  return `${mark} ${label} ${paint(stream, STYLE.strong, value)}`;
}

/** An error after a red "✗ Error:", or after "`program`:" on a stream without colour. */
export function failureLine(stream: ColorStream, program: string, message: string): string {
  const text = printableText(message);
  if (!streamGetsColor(stream)) return `${program}: ${text}`;
  return `${paint(stream, STYLE.bad, "✗ Error:")} ${text}`;
}
