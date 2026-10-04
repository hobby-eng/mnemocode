// Reads single keys and typed answers from the terminal on standard input, the same way on Linux,
// macOS and Windows. Node.js raw mode switches off the terminal's echo and its own line editing,
// and this module edits the line itself, as `mhfe` does (src/bin/mhfe/hidden_input.rs). Every
// byte is kept as data except these keys, which keep their usual meaning:
//
// - Backspace deletes the last character and Ctrl+U the whole line;
// - Enter ends the line, and Ctrl+D on an empty line ends the input;
// - Ctrl+C cancels: raw mode delivers it as a byte instead of a signal.
//
// A terminal's line mode would otherwise act on further keys and, on Linux, cut a line after 4095
// bytes. scripts/verify-terminal-input.py drives this in a Unix pseudo-terminal.

import { isatty } from "node:tty";

/** The longest answer, the 1 MiB limit of a text file (input.ts): no valid answer is that long. */
export const MAX_ANSWER_BYTES = 1024 * 1024;

/** Raw terminal bytes that this module acts on. */
const KEY = {
  CTRL_C: 0x03,
  CTRL_D: 0x04,
  BACKSPACE: 0x08,
  LINE_FEED: 0x0a,
  CARRIAGE_RETURN: 0x0d,
  CTRL_U: 0x15,
  ESCAPE: 0x1b,
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

/**
 * Edits one line from raw bytes as described at the top. Returns undefined when the input ends
 * before anything was typed, or, for a visible answer, at Escape. With `echo`, each character is written to standard error as it is
 * typed, for answers such as a file name; without it nothing is shown.
 */
export async function readLine(
  next: NextByte,
  echo: boolean,
  limit: number = MAX_ANSWER_BYTES,
  moreWithin?: MoreWithin,
): Promise<string | undefined> {
  // Reserved at its largest size and never grown, so that no unwiped copy of a secret is left.
  const line = Buffer.alloc(limit);
  let length = 0;
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
        const kept = withoutLastCharacter(line, length);
        if (echo && kept < length) process.stderr.write("\b \b");
        length = kept;
      } else if (byte === KEY.CTRL_U) {
        if (echo) process.stderr.write("\b \b".repeat(characterCount(line, length)));
        length = 0;
      } else if (byte === KEY.CTRL_D && length === 0) {
        return undefined;
      } else if (echo && byte === KEY.ESCAPE) {
        // Escape alone goes back; an arrow or another special key is no part of a visible answer
        // such as a file name.
        if (moreWithin !== undefined && !(await moreWithin(ESCAPE_DELAY_MS))) return undefined;
        await skipEscapeSequence(next);
      } else if (echo && byte === 0x09) {
        // A pasted Tab between words separates them as a space does, and is shown as one.
        if (length === limit)
          throw new Error(`An answer is longer than ${limit} bytes; no valid answer is that long.`);
        line[length++] = 0x20;
        process.stderr.write(" ");
      } else if (echo && byte < 0x20) {
        // Neither is a control character, which would move the cursor if it were shown.
      } else {
        if (length === limit)
          throw new Error(`An answer is longer than ${limit} bytes; no valid answer is that long.`);
        line[length++] = byte;
        if (echo && isCharacterEnd(line, length)) echoLastCharacter(line, length);
      }
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(line.subarray(0, length));
  } catch (error) {
    if (error instanceof TypeError) throw new Error("The answer is not valid UTF-8 text.");
    throw error;
  } finally {
    line.fill(0);
  }
}

const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION = 0b1000_0000;

/** The length without the last UTF-8 character: its continuation bytes, then its first byte. */
function withoutLastCharacter(line: Buffer, length: number): number {
  let kept = length;
  while (kept > 0 && (line[kept - 1]! & CONTINUATION_MASK) === CONTINUATION) kept -= 1;
  return Math.max(0, kept - 1);
}

function characterCount(line: Buffer, length: number): number {
  let count = 0;
  for (let index = 0; index < length; index += 1)
    if ((line[index]! & CONTINUATION_MASK) !== CONTINUATION) count += 1;
  return count;
}

/** Whether the bytes up to `length` end with a complete UTF-8 character. */
function isCharacterEnd(line: Buffer, length: number): boolean {
  let start = length - 1;
  while (start > 0 && (line[start]! & CONTINUATION_MASK) === CONTINUATION) start -= 1;
  const first = line[start]!;
  const expected = first < 0x80 ? 1 : first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : 2;
  return length - start === expected;
}

function echoLastCharacter(line: Buffer, length: number): void {
  let start = length - 1;
  while (start > 0 && (line[start]! & CONTINUATION_MASK) === CONTINUATION) start -= 1;
  process.stderr.write(line.subarray(start, length));
}

/** Reads the rest of an escape sequence after ESC, as readKey does, and drops it. */
async function skipEscapeSequence(next: NextByte): Promise<void> {
  const introducer = await next();
  if (introducer === 0x4f) {
    await next();
    return;
  }
  if (introducer !== 0x5b) return;
  for (;;) {
    const part = await next();
    if (part === undefined || (part >= 0x40 && part <= 0x7e)) return;
  }
}
