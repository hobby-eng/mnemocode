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
// onto the next row, as terminals do (ShownLine). The keys and the refusals of a question are
// terminal-keys.ts, the escape sequences of keys key-sequences.ts, and the answer being edited,
// with what shows of it, typed-answer.ts.
// scripts/verify-terminal-input.py drives all of this in a pseudo-terminal.

import { isatty } from "node:tty";
import { MAX_TEXT_INPUT_BYTES } from "./bounded-read.js";
import { notUtf8Text } from "./utf8.js";
import type { WordHints } from "../core/word-hints.js";
import { dumbTerminal } from "./terminal-style.js";
import { refusalMessage } from "../core/refusal.js";
import { defined } from "../core/defined.js";
import {
  ESCAPE_DELAY_MS,
  InputCancelledError,
  KEY,
  type MoreWithin,
  type NextByte,
  PASTE_GAP_MS,
  UnusableAnswerError,
} from "./terminal-keys.js";
import {
  editKeyOf,
  mayBeLateSequence,
  readEscapeSequence,
  readLateSequence,
} from "./key-sequences.js";
import { TypedAnswer } from "./typed-answer.js";

/**
 * The longest answer: the limit of every text input (bounded-read.ts); no valid one is that long.
 */
export const MAX_ANSWER_BYTES = MAX_TEXT_INPUT_BYTES;

/**
 * The bytes that readKey takes for Escape besides it: q and Q, for a keyboard layout without an
 * Escape that is easy to reach, and Ctrl+D, the end of the input. A question that must not go back
 * on them leaves them out (terminal-choice.ts).
 */
export const ESCAPE_ALIASES: ReadonlySet<number> = new Set([KEY.LOWER_Q, KEY.UPPER_Q, KEY.CTRL_D]);

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
    const byte = defined(this.#bytes[this.#head]);
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

export function settle(): Promise<void> {
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
 * Reads one line from raw bytes as described at the top. Returns undefined when the input ends
 * before anything was typed, or at Escape where it goes back. A visible answer leaves the cursor
 * just after its end, wherever it was moved before, so that a caller can count the rows of the
 * question and the answer up from there.
 */
export async function readLine(next: NextByte, options: LineOptions): Promise<string | undefined> {
  const { echo, moreWithin } = options;
  const answer = new TypedAnswer(
    options.limit ?? MAX_ANSWER_BYTES,
    echo,
    options.promptWidth ?? 0,
    options.hints,
  );
  const lineBreak = options.pastedLineBreak?.charCodeAt(0);
  // When Escape alone was last ignored, for the rest of its sequence that a slow link split off.
  let escapeIgnoredAt: number | undefined;
  // Bytes read after an ESC, or after a [ or O typed late, that turned out to be no key's
  // sequence: read again, in order, before any byte typed after them.
  const readAgain: number[] = [];
  const take: NextByte = async () => (readAgain.length > 0 ? readAgain.shift() : next());
  const more: MoreWithin | undefined =
    moreWithin && (async (milliseconds) => readAgain.length > 0 || moreWithin(milliseconds));
  /** Whether no key follows within PASTE_GAP_MS: the end of a paste, or a key typed alone. */
  const quiet = async (): Promise<boolean> => more === undefined || !(await more(PASTE_GAP_MS));
  /** Bytes that turned out to be no key's sequence, read again before the next. */
  const giveBack = (bytes: number[]): void => {
    readAgain.unshift(...bytes);
    bytes.fill(0);
  };
  try {
    for (;;) {
      // Drawn once no key follows at once, so that a paste is hinted once, at its end.
      await answer.hintWhen(quiet);
      const byte = await take();
      // Only the byte right after an ignored Escape can continue its sequence.
      const late =
        byte !== undefined && more !== undefined && mayBeLateSequence(byte, escapeIgnoredAt);
      escapeIgnoredAt = undefined;
      if (byte === undefined) {
        if (answer.length === 0) return undefined;
        break;
      }
      if (byte === KEY.CARRIAGE_RETURN || byte === KEY.LINE_FEED) {
        if (lineBreak === undefined || (await quiet())) break;
        // One separator for a run of line breaks, such as CR LF or a blank line, and none at the
        // start or after a separator typed before it.
        if (answer.cursor > 0 && answer.before !== lineBreak) answer.insert(lineBreak);
        continue;
      }
      if (byte === KEY.CTRL_C) throw new InputCancelledError();
      if (byte === KEY.CTRL_D && answer.length === 0) return undefined;
      if (byte === KEY.BACKSPACE || byte === KEY.DELETE || byte === KEY.CTRL_U)
        answer.control(byte);
      else if (!echo) answer.insert(byte);
      else if (late) {
        const sequence = await readLateSequence(byte, take, defined(more));
        if ("key" in sequence) answer.edit(sequence.key);
        else {
          answer.insert(byte);
          giveBack(sequence.readAgain);
        }
      } else if (byte === KEY.ESCAPE) {
        if (more !== undefined && !(await more(ESCAPE_DELAY_MS))) {
          if (options.escapeGoesBack === true) {
            answer.moveToEnd();
            options.onBack?.(answer.columns, answer.rowFromPrompt);
            return undefined;
          }
          escapeIgnoredAt = Date.now();
          continue;
        }
        const sequence = await readEscapeSequence(take, more);
        if (sequence.kind === "sequence")
          answer.edit(editKeyOf(sequence.introducer, sequence.parameters, sequence.final));
        else if (sequence.kind === "none") giveBack(sequence.readAgain);
      } else if (answer.control(byte)) {
        // Edited.
      } else if (byte === KEY.TAB) {
        // Tab completes a word where words are hinted; a pasted Tab between words or codes
        // separates them as a space does, and is shown as one.
        const { hints } = answer;
        if (hints !== undefined && (await quiet())) answer.complete(hints);
        else answer.insert(KEY.SPACE);
      } else if (byte >= KEY.SPACE) answer.insert(byte);
      // Any other control character is left out: shown, it would move the cursor.
    }
    answer.moveToEnd();
    return answer.text();
  } catch (error) {
    if (error instanceof TypeError) throw new UnusableAnswerError(NOT_UTF8);
    throw error;
  } finally {
    answer.wipe();
    readAgain.fill(0);
  }
}
