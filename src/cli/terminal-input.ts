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
// and Ctrl+W the word before it, and what is typed goes in at the cursor. Where a question takes
// words of a list, the words that begin like the one being typed show below it, as in mhfe, and
// Tab completes it (LineOptions.hints).
//
// A terminal's line mode would otherwise act on further keys and, on Linux, cut a line after 4095
// bytes. While a long search runs, no question reads the terminal: watchForCtrlC reads it then,
// so that Ctrl+C stops the search also where a Windows pseudo-console sends no signal, and Ctrl+Z
// still suspends it on Linux and macOS.
//
// A question is answered only by keys pressed after it shows: dropTypedAhead wipes what was typed
// or pasted before, such as the rest of a paste or a second Enter. A paste of several lines may
// be one answer (LineOptions.pastedLineBreak), and a visible answer wraps a wide character whole
// onto the next row, as terminals do (ShownLine).
// scripts/verify-terminal-input.py drives all of this in a pseudo-terminal.

import { isatty } from "node:tty";
import { MAX_TEXT_INPUT_BYTES } from "./bounded-read.js";
import {
  characterSize,
  displayWidthOf,
  placedAfter,
  terminalColumns,
} from "./terminal-geometry.js";
import { CANCELLED_MESSAGE } from "./exit-codes.js";
import { isContinuation, STRICT_UTF8, notUtf8Text } from "./utf8.js";
import { cursorDown, cursorUp, cursorRight, ERASE_BELOW } from "./terminal.js";
import type { WordHint, WordHints } from "../core/word-hints.js";
import { hintRows } from "./typed-hints.js";
import { dumbTerminal } from "./terminal-style.js";
import { refusalMessage } from "../core/refusal.js";

/**
 * The longest answer: the limit of every text input (bounded-read.ts); no valid one is that long.
 */
export const MAX_ANSWER_BYTES = MAX_TEXT_INPUT_BYTES;

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
  CTRL_Z: 0x1a,
  ESCAPE: 0x1b,
  CTRL_BACKSLASH: 0x1c,
  SPACE: 0x20,
  DIGIT_0: 0x30,
  DIGIT_9: 0x39,
  /** The final bytes of the escape sequences of the up and down arrows (ESC [ A, ESC [ B). */
  ARROW_UP: 0x41,
  ARROW_DOWN: 0x42,
  LOWER_Q: 0x71,
  UPPER_Q: 0x51,
  DELETE: 0x7f,
} as const;

/**
 * The bytes that readKey takes for Escape besides it: q and Q, for a keyboard layout without an
 * Escape that is easy to reach, and Ctrl+D, the end of the input. A question that must not go back
 * on them leaves them out (terminal-choice.ts).
 */
export const ESCAPE_ALIASES: ReadonlySet<number> = new Set([KEY.LOWER_Q, KEY.UPPER_Q, KEY.CTRL_D]);

/** The codes of the errors of terminal input: a question cancelled, an answer it cannot use. */
export type TerminalInputErrorCode = "cancelled" | "unusable-answer";

/**
 * Thrown when Ctrl+C cancels a question; the tool then stops with CANCELLED_EXIT_CODE, as for
 * SIGINT.
 */
export class InputCancelledError extends Error {
  readonly code: TerminalInputErrorCode = "cancelled";

  constructor() {
    super(CANCELLED_MESSAGE);
    this.name = "InputCancelledError";
  }
}

/**
 * The warning for an answer, a file or codes that were refused, to be asked again with it: the
 * message of the Error. InputCancelledError, which is the person leaving, and anything thrown that is
 * no Error pass through. Every question that asks again classifies a refusal with it.
 */
export function refusal(error: unknown): string {
  if (error instanceof InputCancelledError) throw error;
  return refusalMessage(error);
}

/** Why an answer is refused that holds bytes of no UTF-8 character. */
export const NOT_UTF8 = notUtf8Text("The answer");

/**
 * Thrown by readLine for an answer that no question can use: longer than its limit, or not UTF-8
 * text. The message says why without repeating the answer.
 */
export class UnusableAnswerError extends Error {
  readonly code: TerminalInputErrorCode = "unusable-answer";

  constructor(message: string) {
    super(message);
    this.name = "UnusableAnswerError";
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
  return terminalsAttached() && !dumbTerminal();
}

/** Whether standard input and standard error are terminals, whatever their type. */
export function terminalsAttached(): boolean {
  // isatty, not process.stdin.isTTY: reading that property opens standard input as a stream,
  // which switches a pipe to non-blocking reads, and a later synchronous read then fails (EAGAIN).
  return isatty(0) && isatty(2);
}

// The rule is terminal-style's, which colour asks too; here for the modules that take it here.
export { dumbTerminal };

/** Whether terminals are attached that say they cannot clear the screen (TERM=dumb). */
export function terminalTooDumb(): boolean {
  return terminalsAttached() && dumbTerminal();
}

/** Where a secret can come from without a terminal, as the refusals of a question say it. */
export const SECRET_SOURCE_ADVICE =
  "read the secret from a protected local file (--mnemonic-file, --input-file or --share-file) or from standard input (-)";

/** Why `subject`, such as "The menu", cannot be used on a terminal that says TERM=dumb. */
export function dumbTerminalReason(subject: string): string {
  return `${subject} needs a terminal that can clear its screen; this one says TERM=dumb.`;
}

/**
 * Bytes read from the terminal but not yet used, in the order typed. Taking one is quick however
 * many wait, as for the rest of a long paste: Array.prototype.shift copies a large array each time.
 */
class ByteQueue {
  #bytes: number[] = [];
  #head = 0;

  get length(): number {
    return this.#bytes.length - this.#head;
  }

  push(byte: number): void {
    this.#bytes.push(byte);
  }

  shift(): number | undefined {
    if (this.#head === this.#bytes.length) return undefined;
    const byte = this.#bytes[this.#head]!;
    // The byte may be part of a secret; its place is not needed any more.
    this.#bytes[this.#head++] = 0;
    // Once most of the array is taken, the rest moves to its start, once for many bytes.
    if (this.#head >= COMPACT_AFTER && this.#head * 2 >= this.#bytes.length) {
      this.#bytes.splice(0, this.#head);
      this.#head = 0;
    }
    return byte;
  }

  includes(byte: number): boolean {
    return this.#bytes.indexOf(byte, this.#head) >= 0;
  }

  /** Wipes and forgets every byte. */
  clear(): void {
    this.#bytes.fill(0);
    this.#bytes.length = 0;
    this.#head = 0;
  }
}

/** Bytes taken from a ByteQueue before what is left moves to the start of its array. */
const COMPACT_AFTER = 4096;

/**
 * Bytes read from the terminal but not yet used: what was typed or pasted ahead of the next
 * question stays for it, as it would stay in the terminal's own buffer, until dropTypedAhead
 * drops it. Kept between questions.
 */
const typedAhead = new ByteQueue();
let inputEnded = false;
/** How many withRawTerminal calls are running: dropTypedAhead reads the terminal only in one. */
let rawSessions = 0;

/**
 * How long dropTypedAhead waits, once the terminal is read, for the bytes still in the terminal's
 * own buffer: they arrive at the next poll of the event loop, well within this time. Nothing is
 * drawn before, so no key pressed for the question can be among them.
 */
const TYPED_AHEAD_SETTLE_MS = 15;

/**
 * How long the rest of a paste may take after one of its bytes: a paste arrives in one burst, in
 * chunks microseconds apart, while no person types two keys this fast. A line break followed this
 * soon is inside a paste; an answer refused halfway is dropped until a gap this long.
 */
const PASTE_GAP_MS = 20;

/**
 * Bytes that readKey read after an ESC that started no key's sequence, in the order typed: they
 * are read again as keys of their own, before any byte typed after them (readEscapeSequence).
 * They count as typed ahead, so that dropTypedAhead wipes them too.
 */
const keyBytesAgain: number[] = [];

/** Wipes and forgets the bytes typed ahead; true when Ctrl+C was among them. */
function wipeTypedAhead(): boolean {
  const cancelled = typedAhead.includes(KEY.CTRL_C) || keyBytesAgain.includes(KEY.CTRL_C);
  typedAhead.clear();
  keyBytesAgain.fill(0);
  keyBytesAgain.length = 0;
  return cancelled;
}

/**
 * Drops and wipes what was typed or pasted before the next question is drawn: the rest of a
 * paste, a second Enter, keys pressed while a step ran that read no keys. Ctrl+C among them still
 * cancels the tool (InputCancelledError). A question calls it inside withRawTerminal, before it draws
 * anything, as askLine and waitForEnter do; called outside, before choose, it reads the terminal
 * briefly itself.
 */
export async function dropTypedAhead(): Promise<void> {
  if (rawSessions > 0) await settle();
  else if (terminalAvailable() && process.stdin.isTTY === true) await withRawTerminal(settle);
  if (wipeTypedAhead()) throw new InputCancelledError();
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, TYPED_AHEAD_SETTLE_MS));
}

/**
 * Drops the rest of an answer that was refused while it still arrived, such as a paste longer
 * than any answer: everything until no byte has come for PASTE_GAP_MS, wiped. Ctrl+C among it
 * cancels the tool. Without `moreWithin` only what has arrived is dropped. Bytes that `next`
 * holds elsewhere, as a test's keyboard does, are read through it.
 */
export async function dropRestOfPaste(
  next: NextByte,
  moreWithin: MoreWithin | undefined,
): Promise<void> {
  let cancelled = wipeTypedAhead();
  while (moreWithin !== undefined && (await moreWithin(PASTE_GAP_MS))) {
    if (typedAhead.length > 0) cancelled = wipeTypedAhead() || cancelled;
    else if ((await next()) === KEY.CTRL_C) cancelled = true;
  }
  if (cancelled) throw new InputCancelledError();
}

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
      `This needs a terminal on standard input. Run the command in a terminal, or ${SECRET_SOURCE_ADVICE}.`,
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
  rawSessions += 1;
  try {
    return await body(next, moreWithin);
  } finally {
    rawSessions -= 1;
    input.off("data", receive);
    input.off("end", end);
    input.pause();
    input.setRawMode(false);
  }
}

/** A stop for a long search, which Ctrl+C sets off. */
export interface CtrlCWatch {
  /**
   * Aborted with InputCancelledError as its reason at Ctrl+C or Ctrl+\, and with the error when the
   * terminal fails after Ctrl+Z: `signal.throwIfAborted()` throws it.
   */
  readonly signal: AbortSignal;
  /** Gives the terminal back as it was; a second call does nothing. */
  stop(): void;
}

/**
 * Reads the terminal on standard input in raw mode while a long search runs and no question reads
 * it, so that Ctrl+C arrives as a byte, as it does at a question: a Windows pseudo-console need not
 * send SIGINT for it. Raw mode also keeps the terminal from sending the signals of the quit and
 * suspend keys, which are therefore read here as well: Ctrl+\ stops the search as Ctrl+C does,
 * since SIGQUIT would end the tool on the private screen, and Ctrl+Z suspends it (suspendJob).
 * Every other key is dropped unseen, so that nothing typed during the search shows on the private
 * screen. Without a terminal the signal never aborts and the keys stay signals. The search checks
 * the signal at each turn of the event loop; stop() must run on every path, in a `finally`, and
 * before any question the search asks: withCtrlCWatch does both.
 */
export function watchForCtrlC(): CtrlCWatch {
  const controller = new AbortController();
  if (!terminalAvailable()) return { signal: controller.signal, stop: () => undefined };
  const input = process.stdin;
  const receive = (chunk: Buffer): void => {
    for (const byte of chunk) {
      if (controller.signal.aborted) break;
      if (byte === KEY.CTRL_C || byte === KEY.CTRL_BACKSLASH)
        controller.abort(new InputCancelledError());
      else if (byte === KEY.CTRL_Z) suspendJob(controller);
    }
    // The chunk may hold a secret typed by mistake; it is not used.
    chunk.fill(0);
  };
  input.setRawMode(true);
  input.on("data", receive);
  input.resume();
  let watching = true;
  return {
    signal: controller.signal,
    stop: () => {
      if (!watching) return;
      watching = false;
      // As withRawTerminal leaves the terminal.
      input.off("data", receive);
      input.pause();
      input.setRawMode(false);
    },
  };
}

/**
 * Does what Ctrl+Z does where the terminal sends its signals: stops the job until the shell
 * continues it. Raw mode is left first, so that the shell gets the terminal as it expects it, and
 * SIGTSTP goes to the whole process group, as the terminal sends it, so that the parent of a
 * protected relaunch (protection.ts) stops too. kill returns once the job continues, and raw mode
 * is taken again; a job continued in the background (bg) cannot take it and stops again (SIGTTOU)
 * until fg. Windows has no job control: the key is dropped there. A terminal that cannot be
 * switched stops the search with the error.
 */
function suspendJob(controller: AbortController): void {
  if (process.platform === "win32") return;
  const input = process.stdin;
  try {
    input.setRawMode(false);
    // Process group 0 is the caller's own (kill(2)).
    process.kill(0, "SIGTSTP");
    input.setRawMode(true);
  } catch (error) {
    controller.abort(error);
  }
}

/**
 * The next turn of Node's event loop, after the input that waits, such as Ctrl+C read as a key:
 * the turn that every search of the command line takes (SearchTurns). setImmediate runs once the
 * waiting input has been handled, which the core's default, a timer, does not promise.
 */
export function nodeTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Runs `search` with the signal of watchForCtrlC and stops watching when it ends or fails. */
export async function withCtrlCWatch<T>(search: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const watch = watchForCtrlC();
  try {
    return await search(watch.signal);
  } finally {
    watch.stop();
  }
}

/** The bytes after ESC that start a control sequence (CSI, "[") or a single shift (SS3, "O"). */
const CSI_INTRODUCER = 0x5b;
const SS3_INTRODUCER = 0x4f;
/** ECMA-48's parameter bytes (0 to 9, ; and the like) between the introducer and the final byte. */
const PARAMETER_FIRST = 0x30;
const PARAMETER_LAST = 0x3f;
/** ECMA-48's final bytes, @ to ~, one of which ends a sequence. */
const FINAL_FIRST = 0x40;
const FINAL_LAST = 0x7e;
/** The printable ASCII characters, space to ~; ESC before one of them is Alt with that key. */
const PRINTABLE_FIRST = 0x20;
const PRINTABLE_LAST = 0x7e;
/** Longer than any key's sequence, such as ESC [ 2 4 ; 5 ~ (Ctrl+F12). */
const MAX_KEY_SEQUENCE_BYTES = 8;

/** What followed an ESC that more bytes followed at once. */
type EscapeSequence =
  /** A whole sequence: its introducer, its parameter bytes as text and its final byte. */
  | {
      readonly kind: "sequence";
      readonly introducer: number;
      readonly parameters: string;
      readonly final: number;
    }
  /** A printable character, as Alt with that key sends it: no key of MnemoCode's. */
  | { readonly kind: "alt" }
  /** No key's sequence: the bytes to read again as typed, in order. */
  | { readonly kind: "none"; readonly readAgain: number[] };

/**
 * Reads what follows an ESC that more bytes followed at once: a key's sequence as ECMA-48 shapes
 * it, [ or O, parameter bytes and one final byte. A terminal sends a key's whole sequence at once,
 * so one that stops short is no key: at a byte that cannot stand in it, such as a space, Enter,
 * Backspace or Ctrl+C, after MAX_KEY_SEQUENCE_BYTES, at the end of the input or, with
 * `moreWithin`, after a pause of ESCAPE_DELAY_MS. The bytes read after the [ or O are then given
 * back (readAgain), the one that ended it included, so that each keeps its meaning: Alt+[, or
 * Escape and [ pressed quickly, loses no digit typed after it, and Enter still ends the answer and
 * Ctrl+C still cancels. A control key or a non-ASCII character right after ESC, such as Alt+Enter
 * or a second Escape, is given back the same way.
 */
async function readEscapeSequence(
  next: NextByte,
  moreWithin: MoreWithin | undefined,
): Promise<EscapeSequence> {
  const introducer = await next();
  if (introducer === undefined) return { kind: "none", readAgain: [] };
  if (introducer !== CSI_INTRODUCER && introducer !== SS3_INTRODUCER) {
    const printable = introducer >= PRINTABLE_FIRST && introducer <= PRINTABLE_LAST;
    return printable ? { kind: "alt" } : { kind: "none", readAgain: [introducer] };
  }
  const read: number[] = [];
  while (read.length < MAX_KEY_SEQUENCE_BYTES) {
    if (moreWithin !== undefined && !(await moreWithin(ESCAPE_DELAY_MS))) break;
    const byte = await next();
    if (byte === undefined) break;
    read.push(byte);
    if (byte >= FINAL_FIRST && byte <= FINAL_LAST) {
      const parameters = String.fromCharCode(...read.slice(0, -1));
      read.fill(0);
      return { kind: "sequence", introducer, parameters, final: byte };
    }
    if (byte < PARAMETER_FIRST || byte > PARAMETER_LAST) break;
  }
  return { kind: "none", readAgain: read };
}

/**
 * Reads one key. The arrow keys send the VT escape sequences ESC [ A and ESC [ B, or ESC O A and
 * ESC O B in a terminal's application mode; Node.js gives Windows consoles the same sequences.
 * Every other key's escape sequence is read to its end and ignored, so that no byte of it, such as
 * the 5 of Ctrl+Up (ESC [ 1 ; 5 A), is taken for a key of its own; bytes after an ESC that are no
 * key's sequence are read again as keys (readEscapeSequence). Escape alone goes back, as do q,
 * which a keyboard layout without Latin letters may lack, Ctrl+D and the end of the input; Ctrl+C
 * cancels the tool. `moreWithin` tells Escape alone from the start of a sequence.
 */
export async function readKey(next: NextByte, moreWithin?: MoreWithin): Promise<Key> {
  // Bytes given back by an earlier key come first: they were typed first.
  const take: NextByte = async () => (keyBytesAgain.length > 0 ? keyBytesAgain.shift() : next());
  const more: MoreWithin | undefined =
    moreWithin && (async (milliseconds) => keyBytesAgain.length > 0 || moreWithin(milliseconds));
  const byte = await take();
  if (byte === undefined) return { kind: "back" };
  if (byte === KEY.CTRL_C) throw new InputCancelledError();
  if (byte === KEY.CARRIAGE_RETURN || byte === KEY.LINE_FEED) return { kind: "enter" };
  if (byte >= KEY.DIGIT_0 && byte <= KEY.DIGIT_9)
    return { kind: "digit", digit: byte - KEY.DIGIT_0 };
  if (ESCAPE_ALIASES.has(byte)) return { kind: "back" };
  if (byte !== KEY.ESCAPE) return { kind: "other" };
  if (more !== undefined && !(await more(ESCAPE_DELAY_MS))) return { kind: "back" };
  const sequence = await readEscapeSequence(take, more);
  if (sequence.kind === "none") {
    keyBytesAgain.unshift(...sequence.readAgain);
    sequence.readAgain.fill(0);
    return { kind: "other" };
  }
  // Only an arrow key without parameters counts.
  if (sequence.kind === "alt" || sequence.parameters !== "") return { kind: "other" };
  if (sequence.final === KEY.ARROW_UP) return { kind: "up" };
  if (sequence.final === KEY.ARROW_DOWN) return { kind: "down" };
  return { kind: "other" };
}

/** How readLine reads an answer. */
export interface LineOptions {
  /**
   * Shows the answer as it is typed and lets the keys at the top edit it; otherwise nothing shows.
   */
  readonly echo: boolean;
  readonly limit?: number;
  /** Tells Escape alone from the start of a key's escape sequence. */
  readonly moreWithin?: MoreWithin;
  /** Escape alone goes back, as in the menu; otherwise it does nothing. */
  readonly escapeGoesBack?: boolean;
  /** The width of the prompt before the answer, which starts at the left edge (displayWidth). */
  readonly promptWidth?: number;
  /**
   * Called when Escape goes back, with the columns that the abandoned answer took and the row of
   * the cursor after it, counted from the first row of the prompt (answerEndRow), so that the
   * caller can erase every row it wrapped onto.
   */
  readonly onBack?: (answerColumns: number, endRow: number) => void;
  /**
   * What a line break inside a paste becomes: one character, such as a space between words or ;
   * between shares, so that a paste of several lines is one answer. A line break that more bytes
   * follow at once (PASTE_GAP_MS) is inside a paste; it needs `moreWithin`. Without this option,
   * or for a line break typed at the end, the line ends there.
   */
  readonly pastedLineBreak?: PastedLineBreak;
  /**
   * Hints for the word being typed, shown below a visible answer (typed-hints.ts), where Tab then
   * completes the word. A Tab inside a paste still separates as a space does.
   */
  readonly hints?: WordHints;
}

/**
 * What a line break inside a paste becomes: a space, or ";", the separator between shares
 * (SHARE_SEPARATOR, which this module does not import, to stay free of the share modules; a
 * changed separator no longer fits this type where it is passed).
 */
export type PastedLineBreak = " " | ";";

/**
 * How long after an Escape alone, which a question for a secret ignores, the rest of a key's
 * sequence is still read as that key: a slow remote link may deliver ESC and "[B" of an arrow key
 * apart, and "[B" must not become part of the answer.
 */
const LATE_SEQUENCE_MS = 1000;

/** Whether `byte` may start the rest of the sequence of an Escape ignored at `ignoredAt`. */
function mayBeLateSequence(byte: number, ignoredAt: number | undefined): boolean {
  return (
    (byte === CSI_INTRODUCER || byte === SS3_INTRODUCER) &&
    ignoredAt !== undefined &&
    Date.now() - ignoredAt <= LATE_SEQUENCE_MS
  );
}

/**
 * The final bytes of the sequences that keys send (xterm's ctlseqs, "PC-Style Function Keys"):
 * the arrows A to D, E (keypad 5), F and H (End, Home), G (keypad 5 on some terminals), P to S
 * (F1 to F4), Z (Shift+Tab) and ~ (Insert, Delete, Page Up and Down, F5 and up). After SS3 only
 * those without parameters; MnemoCode never switches the keypad to its application mode, whose
 * SS3 sequences end in letters that text also has.
 */
const CSI_KEY_FINALS = new Set([..."ABCDEFGHPQRSZ~"].map((final) => final.charCodeAt(0)));
const SS3_KEY_FINALS = new Set([..."ABCDFHPQRS"].map((final) => final.charCodeAt(0)));

/**
 * Reads the bytes after `introducer`, a [ or O typed soon after an ignored Escape, and tells
 * whether they are the rest of that Escape's key: a terminal sends a key's whole sequence at once,
 * and nothing follows it at once unless it is a paste. Typed text comes key by key, and pasted
 * text goes on after the final byte. A key's sequence gives the key; anything else gives back the
 * bytes read after the introducer, which are then read as typed (the introducer is text).
 */
async function readLateSequence(
  introducer: number,
  next: NextByte,
  moreWithin: MoreWithin,
): Promise<{ readonly key: EditKey } | { readonly readAgain: number[] }> {
  const rest: number[] = [];
  const finals = introducer === CSI_INTRODUCER ? CSI_KEY_FINALS : SS3_KEY_FINALS;
  while (rest.length < MAX_KEY_SEQUENCE_BYTES && (await moreWithin(PASTE_GAP_MS))) {
    const byte = await next();
    if (byte === undefined) break;
    rest.push(byte);
    if (finals.has(byte)) {
      if (await moreWithin(PASTE_GAP_MS)) break;
      const parameters = String.fromCharCode(...rest.slice(0, -1));
      rest.fill(0);
      return { key: editKeyOf(introducer, parameters, byte) };
    }
    const parameter = byte >= PARAMETER_FIRST && byte <= PARAMETER_LAST;
    if (introducer !== CSI_INTRODUCER || !parameter) break;
  }
  return { readAgain: rest };
}

/**
 * The words that a hint is given: the word being typed and three before it, enough to tell the
 * form of the line, Bytewords after the codes of another share or English words among codes.
 */
const HINT_CONTEXT_WORDS = 4;

/** The keys of a visible answer that move the cursor or delete, read from their escape sequence. */
type EditKey = "left" | "right" | "word-left" | "word-right" | "home" | "end" | "delete" | "other";

/** The xterm modifier numbers of Alt and Ctrl, as in ESC [ 1 ; 5 D for Ctrl+Left. */
const WORD_MODIFIERS = new Set(["3", "5"]);

/**
 * Which editing key sent the whole sequence of `introducer`, `parameters` and `final`, as
 * readEscapeSequence and readLateSequence read it.
 */
function editKeyOf(introducer: number, parameters: string, final: number): EditKey {
  if (introducer === SS3_INTRODUCER) {
    if (final === 0x43) return "right";
    if (final === 0x44) return "left";
    if (final === 0x48) return "home";
    if (final === 0x46) return "end";
    return "other";
  }
  const [code, modifier] = parameters.split(";");
  const word = modifier !== undefined && WORD_MODIFIERS.has(modifier);
  if (final === 0x43) return word ? "word-right" : "right";
  if (final === 0x44) return word ? "word-left" : "left";
  if (final === 0x48) return "home";
  if (final === 0x46) return "end";
  if (final === 0x7e) {
    if (code === "1" || code === "7") return "home";
    if (code === "4" || code === "8") return "end";
    if (code === "3") return "delete";
  }
  return "other";
}

/**
 * Reads one line from raw bytes as described at the top. Returns undefined when the input ends
 * before anything was typed, or at Escape where it goes back. A visible answer leaves the cursor
 * just after its end, wherever it was moved before, so that a caller can count the rows of the
 * question and the answer up from there.
 */
export async function readLine(next: NextByte, options: LineOptions): Promise<string | undefined> {
  const { echo, limit = MAX_ANSWER_BYTES, moreWithin } = options;
  // Reserved at its largest size and never grown, so that no unwiped copy of a secret is left.
  const line = Buffer.alloc(limit);
  let length = 0;
  // Where the next character goes; always at the start of a character.
  let cursor = 0;
  const shown = echo ? new ShownLine(line, options.promptWidth ?? 0) : undefined;
  // Only where the answer shows, as in mhfe: a hint tells what is typed.
  const hints = echo ? options.hints : undefined;
  // Whether the hint below the answer is behind what the answer shows.
  let hintDue = false;
  const insert = (byte: number): void => {
    if (length === limit)
      throw new UnusableAnswerError(
        `An answer is longer than ${limit} bytes; no valid answer is that long.`,
      );
    line.copyWithin(cursor + 1, cursor, length);
    line[cursor++] = byte;
    length += 1;
    hintDue = hints !== undefined;
    // A character of several bytes is shown once it is complete.
    if (shown !== undefined && isCharacterEnd(line, cursor))
      shown.update(length, cursor, cursor === length);
  };
  const remove = (from: number, to: number): void => {
    line.copyWithin(from, to, length);
    length -= to - from;
    line.fill(0, length, length + (to - from));
    cursor = from;
    hintDue = hints !== undefined;
    shown?.update(length, cursor);
  };
  const moveTo = (position: number): void => {
    cursor = position;
    hintDue = hints !== undefined;
    shown?.update(length, cursor);
  };
  // The words before the cursor that the hint and Tab are about, while the cursor ends a word;
  // otherwise none: the word being typed and a few before it (HINT_CONTEXT_WORDS), which tell
  // the form of the line. No more of the answer, which may be a secret, becomes a string, which
  // nothing could wipe (AUD-019-SEC001).
  const typedBefore = (): string => {
    if (cursor < length && line[cursor] !== KEY.SPACE) return "";
    let start = cursor;
    for (let words = 0; words < HINT_CONTEXT_WORDS && start > 0; words += 1)
      start = previousWord(line, start);
    try {
      return STRICT_UTF8.decode(line.subarray(start, cursor));
    } catch {
      return "";
    }
  };
  // Tab: the letters that every word beginning like the typed one has next, and a space once one
  // word is left.
  const complete = (completing: WordHints): void => {
    const { letters, wordEnds } = completing.completion(typedBefore());
    for (let at = 0; at < letters.length; at += 1) insert(letters.charCodeAt(at));
    if (!wordEnds) return;
    if (cursor < length && line[cursor] === KEY.SPACE) moveTo(cursor + 1);
    else insert(KEY.SPACE);
  };
  // As End would; nothing is drawn when the cursor is there already.
  const moveToEnd = (): void => {
    if (cursor !== length) moveTo(length);
  };
  const edit = (key: EditKey): void => {
    if (key === "left" && cursor > 0) moveTo(previousCharacter(line, cursor));
    else if (key === "right" && cursor < length) moveTo(nextCharacter(line, cursor, length));
    else if (key === "word-left") moveTo(previousWord(line, cursor));
    else if (key === "word-right") moveTo(nextWord(line, cursor, length));
    else if (key === "home") moveTo(0);
    else if (key === "end") moveTo(length);
    else if (key === "delete" && cursor < length)
      remove(cursor, nextCharacter(line, cursor, length));
  };
  const lineBreak = options.pastedLineBreak?.charCodeAt(0);
  // When Escape alone was last ignored, for the rest of its sequence that a slow link split off.
  let escapeIgnoredAt: number | undefined;
  // Bytes read after an ESC, or after a [ or O typed late, that turned out to be no key's
  // sequence: read again, in order, before any byte typed after them.
  const readAgain: number[] = [];
  const take: NextByte = async () => (readAgain.length > 0 ? readAgain.shift() : next());
  const more: MoreWithin | undefined =
    moreWithin && (async (milliseconds) => readAgain.length > 0 || moreWithin(milliseconds));
  try {
    for (;;) {
      // Drawn once no key follows at once, so that a paste is hinted once, at its end.
      if (hintDue && (more === undefined || !(await more(PASTE_GAP_MS)))) {
        shown!.showHint(hints!.hint(typedBefore()), length, cursor);
        hintDue = false;
      }
      const byte = await take();
      // Only the byte right after an ignored Escape can continue its sequence.
      const late =
        byte !== undefined && more !== undefined && mayBeLateSequence(byte, escapeIgnoredAt);
      escapeIgnoredAt = undefined;
      if (byte === undefined) {
        if (length === 0) return undefined;
        break;
      }
      if (byte === KEY.CARRIAGE_RETURN || byte === KEY.LINE_FEED) {
        if (lineBreak === undefined || more === undefined || !(await more(PASTE_GAP_MS))) break;
        // One separator for a run of line breaks, such as CR LF or a blank line, and none at the
        // start or after a separator typed before it.
        if (cursor > 0 && line[cursor - 1] !== lineBreak) insert(lineBreak);
        continue;
      }
      if (byte === KEY.CTRL_C) throw new InputCancelledError();
      if (byte === KEY.BACKSPACE || byte === KEY.DELETE) {
        if (cursor > 0) remove(previousCharacter(line, cursor), cursor);
      } else if (byte === KEY.CTRL_U) {
        if (cursor > 0) remove(0, cursor);
      } else if (byte === KEY.CTRL_D && length === 0) {
        return undefined;
      } else if (!echo) {
        insert(byte);
      } else if (late) {
        const sequence = await readLateSequence(byte, take, more!);
        if ("key" in sequence) edit(sequence.key);
        else {
          insert(byte);
          readAgain.unshift(...sequence.readAgain);
          sequence.readAgain.fill(0);
        }
      } else if (byte === KEY.ESCAPE) {
        if (more !== undefined && !(await more(ESCAPE_DELAY_MS))) {
          if (options.escapeGoesBack === true) {
            moveToEnd();
            options.onBack?.(displayWidthOf(line, 0, length), shown?.rowFromPrompt ?? 0);
            return undefined;
          }
          escapeIgnoredAt = Date.now();
          continue;
        }
        const sequence = await readEscapeSequence(take, more);
        if (sequence.kind === "sequence")
          edit(editKeyOf(sequence.introducer, sequence.parameters, sequence.final));
        else if (sequence.kind === "none") {
          readAgain.unshift(...sequence.readAgain);
          sequence.readAgain.fill(0);
        }
      } else if (byte === KEY.CTRL_A) {
        moveTo(0);
      } else if (byte === KEY.CTRL_E) {
        moveTo(length);
      } else if (byte === KEY.CTRL_K) {
        if (cursor < length) remove(cursor, length);
      } else if (byte === KEY.CTRL_W) {
        if (cursor > 0) remove(previousWord(line, cursor), cursor);
      } else if (byte === KEY.TAB) {
        // Tab completes a word where words are hinted; a pasted Tab between words or codes
        // separates them as a space does, and is shown as one.
        if (hints !== undefined && !(more !== undefined && (await more(PASTE_GAP_MS))))
          complete(hints);
        else insert(KEY.SPACE);
      } else if (byte >= KEY.SPACE) {
        insert(byte);
      }
      // Any other control character is left out: shown, it would move the cursor.
    }
    moveToEnd();
    return STRICT_UTF8.decode(line.subarray(0, length));
  } catch (error) {
    if (error instanceof TypeError) throw new UnusableAnswerError(NOT_UTF8);
    throw error;
  } finally {
    // Before the answer is wiped: its width says where the hint is.
    shown?.clearHint(length);
    line.fill(0);
    readAgain.fill(0);
  }
}

/**
 * The visible answer on the terminal, which wraps a long answer onto further rows. Every change
 * but typing at the end redraws the answer from its first row, with relative moves only, so that
 * it stays right when the screen scrolls. `cursorRow` is the row of the cursor below that first
 * row; the answer starts on it after the prompt. Positions are counted as a terminal places the
 * characters (placedAfter): a wide character that does not fit at the right edge goes whole to the
 * next row.
 */
class ShownLine {
  readonly #columns: number;
  readonly #start: number;
  /** The rows of the prompt above the row on which the answer starts. */
  readonly #promptRows: number;
  #cursorRow = 0;
  /**
   * The first `countedBytes` bytes of the answer are whole characters, after which the terminal
   * has the cursor at `countedEnd`, counted in cells from the start of the answer's first row.
   * Typing at the end counts on from them: counting the whole answer again for every key would
   * make a long paste fall behind, and a macOS pseudo-terminal, which buffers about 1 KiB each
   * way, then blocks both the terminal and this program. A redraw counts from the start.
   */
  #countedBytes = 0;
  #countedEnd: number;
  /** Whether a hint shows below the answer. */
  #hintShown = false;
  readonly #line: Buffer;

  constructor(line: Buffer, promptWidth: number) {
    this.#line = line;
    this.#columns = terminalColumns();
    this.#start = promptWidth % this.#columns;
    this.#promptRows = Math.floor(promptWidth / this.#columns);
    this.#countedEnd = this.#start;
    // A prompt that ends at the right edge leaves the cursor waiting there; this settles it.
    if (promptWidth > 0 && this.#start === 0) process.stderr.write("\r\n");
  }

  /** The row of the cursor counted from the first row of the prompt, as answerEndRow gives it. */
  get rowFromPrompt(): number {
    return this.#promptRows + this.#cursorRow;
  }

  /** Shows the answer of `length` bytes with the cursor at `cursor`; `typedAtEnd` only adds. */
  update(length: number, cursor: number, typedAtEnd = false): void {
    if (typedAtEnd) {
      const end = this.#endOf(length);
      process.stderr.write(this.#line.subarray(previousCharacter(this.#line, cursor), cursor));
      this.#cursorRow = this.#settle(end);
      return;
    }
    const out = process.stderr;
    out.write(`${cursorUp(this.#cursorRow)}\r${cursorRight(this.#start)}${ERASE_BELOW}`);
    // Erased with the answer: the next hint is drawn anew.
    this.#hintShown = false;
    out.write(this.#line.subarray(0, length));
    this.#countedBytes = 0;
    this.#countedEnd = this.#start;
    const endRow = this.#settle(this.#endOf(length));
    const target = this.#cellOf(cursor, length);
    const row = Math.floor(target / this.#columns);
    out.write(`${cursorUp(endRow - row)}\r${cursorRight(target % this.#columns)}`);
    this.#cursorRow = row;
  }

  /**
   * Shows `hint` below the answer of `length` bytes, in place of the one before, and puts the
   * cursor back at `cursor`. The rows are written from the end of the answer with line breaks, so
   * that the screen scrolls for them, and the cursor goes back up with relative moves.
   */
  showHint(hint: WordHint, length: number, cursor: number): void {
    const rows = hintRows(hint, this.#columns);
    if (rows.length === 0 && !this.#hintShown) return;
    const end = this.#endOf(length);
    const endRow = Math.floor(end / this.#columns);
    // Typing at the end needs no count from the start (endOf).
    const target = cursor === length ? end : this.#cellOf(cursor, length);
    const below = rows.map((row) => `\r\n${row}`).join("");
    process.stderr.write(
      `${this.#toEnd(end)}${ERASE_BELOW}${below}` +
        `${cursorUp(rows.length + endRow - this.#cursorRow)}\r${cursorRight(target % this.#columns)}`,
    );
    this.#hintShown = rows.length > 0;
  }

  /** Takes the hint off the screen, which leaves the cursor at the end of the answer. */
  clearHint(length: number): void {
    if (!this.#hintShown) return;
    const end = this.#endOf(length);
    process.stderr.write(`${this.#toEnd(end)}${ERASE_BELOW}`);
    this.#cursorRow = Math.floor(end / this.#columns);
    this.#hintShown = false;
  }

  /** The moves from the cursor to `end`, the cell after the answer. */
  #toEnd(end: number): string {
    return `${cursorDown(Math.floor(end / this.#columns) - this.#cursorRow)}\r${cursorRight(end % this.#columns)}`;
  }

  /**
   * The cell of the character at `cursor`, where the cursor is shown on it: after the characters
   * before it, or at the start of the next row for a wide one that the right edge pushed there.
   * At the end of the answer, where the next character would go.
   */
  #cellOf(cursor: number, length: number): number {
    const before = placedAfter(this.#line, 0, cursor, this.#start, this.#columns);
    if (cursor === length) return before;
    const end = nextCharacter(this.#line, cursor, length);
    const after = placedAfter(this.#line, cursor, end, before, this.#columns);
    return after - displayWidthOf(this.#line, cursor, end);
  }

  /**
   * Where the terminal has the cursor after the first `length` bytes, counted on from the
   * characters already counted. Only typing at the end adds bytes between two redraws, so what is
   * counted stays as it was. A character not complete yet is counted the next time.
   */
  #endOf(length: number): number {
    while (this.#countedBytes < length) {
      const size = characterSize(this.#line[this.#countedBytes]!);
      if (this.#countedBytes + size > length) break;
      this.#countedEnd = placedAfter(
        this.#line,
        this.#countedBytes,
        this.#countedBytes + size,
        this.#countedEnd,
        this.#columns,
      );
      this.#countedBytes += size;
    }
    return this.#countedEnd;
  }

  /**
   * The row the cursor is on after writing up to `offset`. At the right edge a terminal waits
   * before it wraps; a new line moves the cursor to where the next character would go.
   */
  #settle(offset: number): number {
    if (offset > 0 && offset % this.#columns === 0) process.stderr.write("\r\n");
    return Math.floor(offset / this.#columns);
  }
}

/** Where the UTF-8 character before `position` starts: its continuation bytes, then its first. */
function previousCharacter(line: Buffer, position: number): number {
  let start = position;
  while (start > 0 && isContinuation(line[start - 1]!)) start -= 1;
  return Math.max(0, start - 1);
}

/** Where the UTF-8 character at `position` ends. */
function nextCharacter(line: Buffer, position: number, length: number): number {
  let end = position + 1;
  while (end < length && isContinuation(line[end]!)) end += 1;
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

/** Whether the bytes up to `length` end with a complete UTF-8 character. */
function isCharacterEnd(line: Buffer, length: number): boolean {
  let start = length - 1;
  while (start > 0 && isContinuation(line[start]!)) start -= 1;
  return length - start === characterSize(line[start]!);
}
