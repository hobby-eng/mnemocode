// Reads single keys and typed answers from the terminal on standard input, the same way on Linux,
// macOS and Windows. Node.js raw mode switches off the terminal's echo and its own line editing,
// and this module edits the line itself, as `mhfe` does (src/bin/mhfe/hidden_input.rs). Every
// byte is kept as data except these keys, which keep their usual meaning:
//
// - Backspace deletes the character before the cursor and Ctrl+U all of them;
// - Enter ends the line, and Ctrl+D on an empty line ends the input;
// - Ctrl+C cancels: raw mode delivers it as a byte instead of a signal.
//
// A visible answer is also edited as in a shell: the arrow keys, Home and End (Ctrl+A, Ctrl+E) and
// Ctrl with an arrow move the cursor, Delete deletes the character under it, Ctrl+K what follows it
// and Ctrl+W the word before it, and what is typed goes in at the cursor.
//
// A terminal's line mode would otherwise act on further keys and, on Linux, cut a line after 4095
// bytes. scripts/verify-terminal-input.py drives this in a Unix pseudo-terminal.

import { isatty } from "node:tty";

/** The longest answer, the 1 MiB limit of a text file (input.ts): no valid answer is that long. */
export const MAX_ANSWER_BYTES = 1024 * 1024;

/** Raw terminal bytes that this module acts on. */
const KEY = {
  CTRL_A: 0x01,
  CTRL_C: 0x03,
  CTRL_D: 0x04,
  CTRL_E: 0x05,
  BACKSPACE: 0x08,
  TAB: 0x09,
  LINE_FEED: 0x0a,
  CTRL_K: 0x0b,
  CARRIAGE_RETURN: 0x0d,
  CTRL_U: 0x15,
  CTRL_W: 0x17,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  DELETE: 0x7f,
} as const;

/** Thrown when Ctrl+C cancels a question; the tool then stops with exit code 130, as for SIGINT. */
export class InputCancelled extends Error {
  constructor() {
    super("Cancelled.");
  }
}

/** The next byte typed, or undefined at the end of the input. */
export type NextByte = () => Promise<number | undefined>;

/** Whether another byte arrives within `milliseconds`, without taking it. */
export type MoreWithin = (milliseconds: number) => Promise<boolean>;

/**
 * How long a lone Escape waits for the rest of an escape sequence. The Escape key sends one byte,
 * an arrow key three that arrive together; a remote connection may split them, so this waits a
 * little longer than a local terminal needs (ncurses waits up to a second, vim 100 ms).
 */
const ESCAPE_DELAY_MS = 100;

export type Key =
  | { readonly kind: "up" | "down" | "enter" | "back" | "other" }
  | { readonly kind: "digit"; readonly digit: number };

/**
 * Whether questions can be asked: keys are read from a terminal on standard input and the
 * questions drawn on one on standard error. A script or a pipe gets neither.
 */
export function terminalAvailable(): boolean {
  // isatty, not process.stdin.isTTY: reading that property opens standard input as a stream,
  // which switches a pipe to non-blocking reads, and a later synchronous read then fails (EAGAIN).
  return isatty(0) && isatty(2) && process.env.TERM !== "dumb";
}

/**
 * Bytes read from the terminal but not yet used: what was typed or pasted ahead of the next
 * question stays for it, as it would stay in the terminal's own buffer. Kept between questions.
 */
const typedAhead: number[] = [];
let inputEnded = false;

/**
 * Switches the terminal on standard input to raw mode, runs `body` with a reader of the bytes typed
 * and restores the terminal, also when `body` fails. The terminal is switched before `body` draws
 * anything, so that a key typed or text pasted as soon as a question shows is already read as data.
 */
export async function withRawTerminal<T>(
  body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
): Promise<T> {
  const input = process.stdin;
  if (input.isTTY !== true) {
    throw new Error(
      "This needs a terminal on standard input. Run the command in a terminal, or read the secret from a protected local file (--mnemonic-file, --input-file or --share-file) or from standard input (-).",
    );
  }
  let wake: (() => void) | undefined;
  const receive = (chunk: Buffer): void => {
    for (const byte of chunk) typedAhead.push(byte);
    // The chunk may hold a secret; it is not needed once its bytes are queued.
    chunk.fill(0);
    wake?.();
  };
  const end = (): void => {
    inputEnded = true;
    wake?.();
  };
  const next: NextByte = async () => {
    while (typedAhead.length === 0 && !inputEnded) {
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
    return typedAhead.shift();
  };
  const moreWithin: MoreWithin = async (milliseconds) => {
    if (typedAhead.length > 0) return true;
    if (inputEnded) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = undefined;
    return typedAhead.length > 0;
  };
  input.setRawMode(true);
  input.on("data", receive);
  input.on("end", end);
  input.resume();
  try {
    return await body(next, moreWithin);
  } finally {
    input.off("data", receive);
    input.off("end", end);
    input.pause();
    input.setRawMode(false);
  }
}

/**
 * Reads one key. The arrow keys send the VT escape sequences ESC [ A and ESC [ B, or ESC O A and
 * ESC O B in a terminal's application mode; Node.js gives Windows consoles the same sequences.
 * Every other escape sequence is read to its end and ignored, so that no byte of it, such as the 5
 * of Ctrl+Up (ESC [ 1 ; 5 A), is taken for a key of its own. Escape alone goes back, as do q, which
 * a keyboard layout without Latin letters may lack, Ctrl+D and the end of the input; Ctrl+C
 * cancels the tool. `moreWithin` tells Escape alone from the start of a sequence.
 */
export async function readKey(next: NextByte, moreWithin?: MoreWithin): Promise<Key> {
  const byte = await next();
  if (byte === undefined) return { kind: "back" };
  if (byte === KEY.CTRL_C) throw new InputCancelled();
  if (byte === KEY.CARRIAGE_RETURN || byte === KEY.LINE_FEED) return { kind: "enter" };
  if (byte >= 0x30 && byte <= 0x39) return { kind: "digit", digit: byte - 0x30 };
  if (byte === 0x71 || byte === 0x51 || byte === KEY.CTRL_D) return { kind: "back" };
  if (byte !== KEY.ESCAPE) return { kind: "other" };
  if (moreWithin !== undefined && !(await moreWithin(ESCAPE_DELAY_MS))) return { kind: "back" };
  const introducer = await next();
  if (introducer === 0x4f) return arrow(await next());
  if (introducer !== 0x5b) return { kind: "other" };
  // ECMA-48: parameter and intermediate bytes, then one final byte from @ to ~. Only an arrow key
  // without parameters counts.
  let hasParameters = false;
  for (;;) {
    const part = await next();
    if (part === undefined) return { kind: "back" };
    if (part >= 0x40 && part <= 0x7e) return hasParameters ? { kind: "other" } : arrow(part);
    hasParameters = true;
  }
}

function arrow(finalByte: number | undefined): Key {
  if (finalByte === 0x41) return { kind: "up" };
  if (finalByte === 0x42) return { kind: "down" };
  return { kind: "other" };
}

/** How readLine reads an answer. */
export interface LineOptions {
  /** Shows the answer as it is typed and lets the keys at the top edit it; otherwise nothing shows. */
  readonly echo: boolean;
  readonly limit?: number;
  /** Tells Escape alone from the start of a key's escape sequence. */
  readonly moreWithin?: MoreWithin;
  /** Escape alone goes back, as in the menu; otherwise it does nothing. */
  readonly escapeGoesBack?: boolean;
  /** The width of the prompt before the answer, which starts at the left edge (displayWidth). */
  readonly promptWidth?: number;
}

/** The keys of a visible answer that move the cursor or delete, read from their escape sequence. */
type EditKey = "left" | "right" | "word-left" | "word-right" | "home" | "end" | "delete" | "other";

/** The xterm modifier numbers of Alt and Ctrl, as in ESC [ 1 ; 5 D for Ctrl+Left. */
const WORD_MODIFIERS = new Set(["3", "5"]);

/** Reads the rest of an escape sequence after ESC and tells which editing key sent it. */
async function readEditKey(next: NextByte): Promise<EditKey> {
  const introducer = await next();
  if (introducer === 0x4f) {
    const final = await next();
    if (final === 0x43) return "right";
    if (final === 0x44) return "left";
    if (final === 0x48) return "home";
    if (final === 0x46) return "end";
    return "other";
  }
  if (introducer !== 0x5b) return "other";
  // ECMA-48: parameter and intermediate bytes, then one final byte from @ to ~.
  let parameters = "";
  for (;;) {
    const part = await next();
    if (part === undefined) return "other";
    if (part < 0x40 || part > 0x7e) {
      parameters += String.fromCharCode(part);
      continue;
    }
    const modifier = parameters.split(";")[1];
    const word = modifier !== undefined && WORD_MODIFIERS.has(modifier);
    if (part === 0x43) return word ? "word-right" : "right";
    if (part === 0x44) return word ? "word-left" : "left";
    if (part === 0x48) return "home";
    if (part === 0x46) return "end";
    if (part === 0x7e) {
      const code = parameters.split(";")[0];
      if (code === "1" || code === "7") return "home";
      if (code === "4" || code === "8") return "end";
      if (code === "3") return "delete";
    }
    return "other";
  }
}

/**
 * Reads one line from raw bytes as described at the top. Returns undefined when the input ends
 * before anything was typed, or at Escape where it goes back.
 */
export async function readLine(next: NextByte, options: LineOptions): Promise<string | undefined> {
  const { echo, limit = MAX_ANSWER_BYTES, moreWithin } = options;
  // Reserved at its largest size and never grown, so that no unwiped copy of a secret is left.
  const line = Buffer.alloc(limit);
  let length = 0;
  // Where the next character goes; always at the start of a character.
  let cursor = 0;
  const shown = echo ? new ShownLine(line, options.promptWidth ?? 0) : undefined;
  const insert = (byte: number): void => {
    if (length === limit)
      throw new Error(`An answer is longer than ${limit} bytes; no valid answer is that long.`);
    line.copyWithin(cursor + 1, cursor, length);
    line[cursor++] = byte;
    length += 1;
    // A character of several bytes is shown once it is complete.
    if (shown !== undefined && isCharacterEnd(line, cursor))
      shown.update(length, cursor, cursor === length);
  };
  const remove = (from: number, to: number): void => {
    line.copyWithin(from, to, length);
    length -= to - from;
    line.fill(0, length, length + (to - from));
    cursor = from;
    shown?.update(length, cursor);
  };
  const moveTo = (position: number): void => {
    cursor = position;
    shown?.update(length, cursor);
  };
  try {
    for (;;) {
      const byte = await next();
      if (byte === undefined) {
        if (length === 0) return undefined;
        break;
      }
      if (byte === KEY.CARRIAGE_RETURN || byte === KEY.LINE_FEED) break;
      if (byte === KEY.CTRL_C) throw new InputCancelled();
      if (byte === KEY.BACKSPACE || byte === KEY.DELETE) {
        if (cursor > 0) remove(previousCharacter(line, cursor), cursor);
      } else if (byte === KEY.CTRL_U) {
        if (cursor > 0) remove(0, cursor);
      } else if (byte === KEY.CTRL_D && length === 0) {
        return undefined;
      } else if (!echo) {
        insert(byte);
      } else if (byte === KEY.ESCAPE) {
        if (moreWithin !== undefined && !(await moreWithin(ESCAPE_DELAY_MS))) {
          if (options.escapeGoesBack === true) return undefined;
          continue;
        }
        const key = await readEditKey(next);
        if (key === "left" && cursor > 0) moveTo(previousCharacter(line, cursor));
        else if (key === "right" && cursor < length) moveTo(nextCharacter(line, cursor, length));
        else if (key === "word-left") moveTo(previousWord(line, cursor));
        else if (key === "word-right") moveTo(nextWord(line, cursor, length));
        else if (key === "home") moveTo(0);
        else if (key === "end") moveTo(length);
        else if (key === "delete" && cursor < length)
          remove(cursor, nextCharacter(line, cursor, length));
      } else if (byte === KEY.CTRL_A) {
        moveTo(0);
      } else if (byte === KEY.CTRL_E) {
        moveTo(length);
      } else if (byte === KEY.CTRL_K) {
        if (cursor < length) remove(cursor, length);
      } else if (byte === KEY.CTRL_W) {
        if (cursor > 0) remove(previousWord(line, cursor), cursor);
      } else if (byte === KEY.TAB) {
        // A pasted Tab between words separates them as a space does, and is shown as one.
        insert(KEY.SPACE);
      } else if (byte >= KEY.SPACE) {
        insert(byte);
      }
      // Any other control character is left out: shown, it would move the cursor.
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(line.subarray(0, length));
  } catch (error) {
    if (error instanceof TypeError) throw new Error("The answer is not valid UTF-8 text.");
    throw error;
  } finally {
    line.fill(0);
  }
}

/**
 * The visible answer on the terminal, which wraps a long answer onto further rows. Every change
 * but typing at the end redraws the answer from its first row, with relative moves only, so that
 * it stays right when the screen scrolls. `cursorRow` is the row of the cursor below that first
 * row; the answer starts on it after the prompt.
 */
class ShownLine {
  private readonly columns: number;
  private readonly start: number;
  private cursorRow = 0;

  constructor(
    private readonly line: Buffer,
    promptWidth: number,
  ) {
    this.columns = Math.max(1, process.stderr.columns || DEFAULT_COLUMNS);
    this.start = promptWidth % this.columns;
    // A prompt that ends at the right edge leaves the cursor waiting there; this settles it.
    if (promptWidth > 0 && this.start === 0) process.stderr.write("\r\n");
  }

  /** Shows the answer of `length` bytes with the cursor at `cursor`; `typedAtEnd` only adds. */
  update(length: number, cursor: number, typedAtEnd = false): void {
    if (typedAtEnd) {
      const end = this.start + displayWidthOf(this.line, 0, length);
      process.stderr.write(this.line.subarray(previousCharacter(this.line, cursor), cursor));
      this.cursorRow = this.settle(end);
      return;
    }
    const out = process.stderr;
    out.write(
      `${this.cursorRow > 0 ? `\x1b[${this.cursorRow}A` : ""}\r${this.right(this.start)}\x1b[J`,
    );
    out.write(this.line.subarray(0, length));
    const endRow = this.settle(this.start + displayWidthOf(this.line, 0, length));
    const target = this.start + displayWidthOf(this.line, 0, cursor);
    const row = Math.floor(target / this.columns);
    out.write(
      `${endRow > row ? `\x1b[${endRow - row}A` : ""}\r${this.right(target % this.columns)}`,
    );
    this.cursorRow = row;
  }

  /**
   * The row the cursor is on after writing up to `offset`. At the right edge a terminal waits
   * before it wraps; a new line moves the cursor to where the next character would go.
   */
  private settle(offset: number): number {
    if (offset > 0 && offset % this.columns === 0) process.stderr.write("\r\n");
    return Math.floor(offset / this.columns);
  }

  private right(columns: number): string {
    return columns > 0 ? `\x1b[${columns}C` : "";
  }
}

/** Terminal width when the terminal does not say. */
const DEFAULT_COLUMNS = 80;

const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION = 0b1000_0000;

/** Where the UTF-8 character before `position` starts: its continuation bytes, then its first. */
function previousCharacter(line: Buffer, position: number): number {
  let start = position;
  while (start > 0 && (line[start - 1]! & CONTINUATION_MASK) === CONTINUATION) start -= 1;
  return Math.max(0, start - 1);
}

/** Where the UTF-8 character at `position` ends. */
function nextCharacter(line: Buffer, position: number, length: number): number {
  let end = position + 1;
  while (end < length && (line[end]! & CONTINUATION_MASK) === CONTINUATION) end += 1;
  return Math.min(end, length);
}

/** The start of the word before `position`: back over spaces, then over the word. */
function previousWord(line: Buffer, position: number): number {
  let start = position;
  while (start > 0 && line[start - 1] === KEY.SPACE) start -= 1;
  while (start > 0 && line[start - 1] !== KEY.SPACE) start -= 1;
  return start;
}

/** The end of the word after `position`: on over spaces, then over the word. */
function nextWord(line: Buffer, position: number, length: number): number {
  let end = position;
  while (end < length && line[end] === KEY.SPACE) end += 1;
  while (end < length && line[end] !== KEY.SPACE) end += 1;
  return end;
}

/**
 * Columns that East Asian wide characters take, such as the Chinese words of BIP39 (Unicode
 * Standard Annex 11: the main wide ranges).
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

function codePointWidth(point: number): number {
  return WIDE_RANGES.some(([first, last]) => point >= first && point <= last) ? 2 : 1;
}

/** The columns that the UTF-8 text between `from` and `to` takes on a terminal. */
function displayWidthOf(line: Buffer, from: number, to: number): number {
  let width = 0;
  for (let index = from; index < to;) {
    const first = line[index]!;
    const size = first < 0x80 ? 1 : first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : 2;
    let point = size === 1 ? first : first & (0xff >> (size + 1));
    for (let part = 1; part < size; part += 1) point = (point << 6) | (line[index + part]! & 0x3f);
    width += codePointWidth(point);
    index += size;
  }
  return width;
}

/** The columns that a prompt takes on a terminal. */
export function displayWidth(text: string): number {
  return displayWidthOf(Buffer.from(text, "utf8"), 0, Buffer.byteLength(text, "utf8"));
}

/** Whether the bytes up to `length` end with a complete UTF-8 character. */
function isCharacterEnd(line: Buffer, length: number): boolean {
  let start = length - 1;
  while (start > 0 && (line[start]! & CONTINUATION_MASK) === CONTINUATION) start -= 1;
  const first = line[start]!;
  const expected = first < 0x80 ? 1 : first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : 2;
  return length - start === expected;
}
