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
// bytes. While a long search runs, no question reads the terminal: CtrlCWatch reads it then,
// so that Ctrl+C stops the search also where a Windows pseudo-console sends no signal, and Ctrl+Z
// still suspends it on Linux and macOS.
//
// A question is answered only by keys pressed after it shows: TerminalKeys.dropTypedAhead wipes
// what was typed or pasted before, such as the rest of a paste or a second Enter. A paste of
// several lines may be one answer (LineOptions.pastedLineBreak), and a visible answer wraps a wide
// character whole onto the next row, as terminals do (ShownLine). The keys and the refusals of a
// question are terminal-keys.ts, the escape sequences of keys key-sequences.ts, and the answer
// being edited, with what shows of it, typed-answer.ts.
// scripts/verify-terminal-input.py drives all of this in a pseudo-terminal.

import { isatty } from "node:tty";
import { MAX_TEXT_INPUT_BYTES } from "./bounded-read.js";
import type { WordHints } from "../core/word-hints.js";
import { dumbTerminal } from "./terminal-style.js";
import { refusalMessage } from "../core/refusal.js";
import { defined } from "../core/defined.js";
import {
  CANCELLED,
  type Cancelled,
  ESCAPE_DELAY_MS,
  KEY,
  type MoreWithin,
  type NextByte,
  PASTE_GAP_MS,
} from "./terminal-keys.js";
import {
  editKeyOf,
  mayBeLateSequence,
  readEscapeSequence,
  readLateSequence,
} from "./key-sequences.js";
import { TypedAnswer, UnusableAnswerError } from "./typed-answer.js";
import { InputBytes } from "./input-bytes.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.terminal-input", {
  "terminal-on-standard-input-run-command-terminal": (value0: string) =>
    `This needs a terminal on standard input. Run the command in a terminal, or ${value0}.`,
});

/**
 * The longest answer: the limit of every text input (bounded-read.ts); no valid one is that long.
 */
export const MAX_ANSWER_BYTES = MAX_TEXT_INPUT_BYTES;

/**
 * The bytes that TerminalKeys.readKey takes for Escape besides it: q and Q, for a keyboard
 * layout without an Escape that is easy to reach, and Ctrl+D, the end of the input. A question
 * that must not go back on them leaves them out (terminal-choice.ts).
 */
export const ESCAPE_ALIASES: ReadonlySet<number> = new Set([KEY.LOWER_Q, KEY.UPPER_Q, KEY.CTRL_D]);

/**
 * The warning for an answer, a file or codes that were refused, to be asked again with it: the
 * message of the Error; anything thrown that is no Error passes through. Every question that asks
 * again classifies a refusal with it.
 */
export function refusal(error: unknown): string {
  return refusalMessage(error);
}

/** A key as the questions read it; "cancel" is Ctrl+C, which cancels the command. */
export type Key =
  | {
      readonly kind:
        | "up"
        | "down"
        | "page-up"
        | "page-down"
        | "home"
        | "end"
        | "enter"
        | "back"
        | "cancel"
        | "other";
    }
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
 * How long TerminalKeys.dropTypedAhead waits, once the terminal is read, for the bytes still in
 * the terminal's own buffer: they arrive at the next poll of the event loop, well within this
 * time. Nothing is drawn before, so no key pressed for the question can be among them.
 */
const TYPED_AHEAD_SETTLE_MS = 15;

/** Waits TYPED_AHEAD_SETTLE_MS for the bytes still in the terminal's own buffer. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, TYPED_AHEAD_SETTLE_MS));
}

/**
 * The raw mode of the terminal on standard input, as every reader of it takes and leaves it: the
 * questions (TerminalKeys.withRawMode) and the watch of a long search (CtrlCWatch). Where raw mode
 * is kept between questions (keeps), the console gets its line mode back once, when the process
 * ends.
 */
class RawMode {
  /** Whether this process gives the console its line mode back when it ends (keeps). */
  static #restoresAtExit = false;

  /**
   * Whether raw mode stays on between questions: on Windows, where a pseudo-console need not turn
   * a Ctrl+C into SIGINT (CtrlCWatch), and a Ctrl+C pressed while the console is in line mode,
   * between two questions, was lost (AUD-024). There raw mode stays on until the process ends, so
   * that every key, Ctrl+C included, waits for the next question or watch. Elsewhere it is left
   * after each question, so that Ctrl+C sends SIGINT while the tool computes.
   */
  static keeps(): boolean {
    return process.platform === "win32";
  }

  /**
   * Puts the terminal on standard input in raw mode. Where raw mode is kept, it is set again:
   * libuv skips a mode it believes set, and a command of the menu, another process at the same
   * console, gives the console its line mode back when it ends. The terminal is not read at this
   * point, so the moment in line mode starts no read of a line.
   */
  static take(input: typeof process.stdin): void {
    if (RawMode.keeps()) input.setRawMode(false);
    input.setRawMode(true);
  }

  /**
   * Stops reading the terminal, then leaves raw mode, except where it is kept (keeps), which gives
   * the console its line mode back when the process ends. Node.js stops reading a paused terminal
   * only at its next tick, and libuv, asked to change the mode of a terminal it still reads, reads
   * it again in the new mode: on Windows a line-mode read (ReadConsoleW), which libuv then cancels
   * with an Enter of its own, dropping the keys that read took, such as the one pressed for the
   * next question. Raw mode is therefore left a turn of the event loop after the pause.
   */
  static async leave(input: typeof process.stdin): Promise<void> {
    input.pause();
    await nodeTurn();
    if (!RawMode.keeps()) {
      input.setRawMode(false);
      return;
    }
    if (RawMode.#restoresAtExit) return;
    RawMode.#restoresAtExit = true;
    process.once("exit", () => {
      // The shell that started the tool reads its next line in line mode.
      if (process.stdin.isTTY === true) process.stdin.setRawMode(false);
    });
  }
}

/**
 * The keys typed at the terminal on standard input, for the questions: read in raw mode while a
 * question runs (withRawMode), what was typed ahead of a question dropped before it shows
 * (dropTypedAhead), and keys read one at a time (readKey). The bytes read but not yet used stay
 * between questions, as they would stay in the terminal's own buffer, until they are used or
 * dropped and wiped. One for the process, which has one terminal.
 */
export class TerminalKeys {
  /**
   * Bytes read from the terminal but not yet used: what was typed or pasted ahead of the next
   * question stays for it until dropTypedAhead drops it. Kept between questions.
   */
  static readonly #typedAhead = new InputBytes();

  /**
   * Bytes that readKey read after an ESC that started no key's sequence, in the order typed: they
   * are read again as keys of their own, before any byte typed after them (readEscapeSequence).
   * They count as typed ahead, so that dropTypedAhead wipes them too.
   */
  static readonly #keyBytesAgain = new InputBytes();

  /** Whether the input ended: no byte comes after the last one read. */
  static #inputEnded = false;

  /** How many withRawMode calls are running: dropTypedAhead reads the terminal only in one. */
  static #rawSessions = 0;

  /**
   * Switches the terminal on standard input to raw mode, runs `body` with a reader of the bytes
   * typed and restores the terminal, also when `body` fails. The terminal is switched before
   * `body` draws anything, so that a key typed or text pasted as soon as a question shows is
   * already read as data. Refuses without a terminal on standard input
   * (cli.terminal-input.terminal-on-standard-input-run-command-terminal).
   */
  static async withRawMode<T>(
    body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
  ): Promise<T> {
    const input = process.stdin;
    if (input.isTTY !== true) {
      throw ERRORS.create("terminal-on-standard-input-run-command-terminal", [
        `${SECRET_SOURCE_ADVICE}`,
      ]);
    }
    const typedAhead = TerminalKeys.#typedAhead;
    let wake: (() => void) | undefined;
    const receive = (chunk: Buffer): void => {
      for (const byte of chunk) typedAhead.push(byte);
      // The chunk may hold a secret; it is not needed once its bytes are queued.
      chunk.fill(0);
      wake?.();
    };
    const end = (): void => {
      TerminalKeys.#inputEnded = true;
      wake?.();
    };
    const next: NextByte = async () => {
      while (typedAhead.length === 0 && !TerminalKeys.#inputEnded) {
        await new Promise<void>((resolve) => (wake = resolve));
        wake = undefined;
      }
      return typedAhead.shift();
    };
    const moreWithin: MoreWithin = async (milliseconds) => {
      if (typedAhead.length > 0) return true;
      if (TerminalKeys.#inputEnded) return false;
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
    RawMode.take(input);
    input.on("data", receive);
    input.on("end", end);
    input.resume();
    TerminalKeys.#rawSessions += 1;
    try {
      return await body(next, moreWithin);
    } finally {
      input.off("data", receive);
      input.off("end", end);
      try {
        await RawMode.leave(input);
      } finally {
        // Only once raw mode is left: a session that dropTypedAhead starts meanwhile would read a
        // terminal whose mode is being changed under it.
        TerminalKeys.#rawSessions -= 1;
      }
    }
  }

  /**
   * Drops and wipes what was typed or pasted before the next question is drawn: the rest of a
   * paste, a second Enter, keys pressed while a step ran that read no keys. Ctrl+C among them
   * still cancels the command: CANCELLED is returned. A question calls it inside withRawMode,
   * before it draws anything, as askLine and waitForEnter do; called outside, before choose, it
   * reads the terminal briefly itself.
   */
  static async dropTypedAhead(): Promise<Cancelled | undefined> {
    if (TerminalKeys.#rawSessions > 0) await settle();
    else if (terminalAvailable() && process.stdin.isTTY === true)
      await TerminalKeys.withRawMode(settle);
    return TerminalKeys.#wipeTypedAhead() ? CANCELLED : undefined;
  }

  /**
   * Drains an answer that readLine refused while it still arrived (UnusableAnswerError), such as
   * a paste longer than any answer, before it is asked again: its warning, or CANCELLED when
   * Ctrl+C was among the rest. Any other failure passes through unchanged.
   */
  static async refusedLine(
    error: unknown,
    next: NextByte,
    moreWithin: MoreWithin,
  ): Promise<string | Cancelled> {
    if (!(error instanceof UnusableAnswerError)) throw error;
    if ((await TerminalKeys.#dropRestOfPaste(next, moreWithin)) === CANCELLED) return CANCELLED;
    return error.message;
  }

  /**
   * Reads one key. The arrow keys send the VT escape sequences ESC [ A and ESC [ B, or ESC O A
   * and ESC O B in a terminal's application mode; Node.js gives Windows consoles the same
   * sequences. Every other key's escape sequence is read to its end and ignored, so that no byte
   * of it, such as the 5 of Ctrl+Up (ESC [ 1 ; 5 A), is taken for a key of its own; bytes after an
   * ESC that are no key's sequence are read again as keys (readEscapeSequence). Escape alone goes
   * back, as do q, which a keyboard layout without Latin letters may lack, Ctrl+D and the end of
   * the input; Ctrl+C cancels the tool. `moreWithin` tells Escape alone from the start of a
   * sequence.
   */
  static async readKey(next: NextByte, moreWithin?: MoreWithin): Promise<Key> {
    const again = TerminalKeys.#keyBytesAgain;
    // Bytes given back by an earlier key come first: they were typed first.
    const take: NextByte = async () => (again.length > 0 ? again.shift() : next());
    const more: MoreWithin | undefined =
      moreWithin && (async (milliseconds) => again.length > 0 || moreWithin(milliseconds));
    const byte = await take();
    if (byte === undefined) return { kind: "back" };
    if (byte === KEY.CTRL_C) return { kind: "cancel" };
    if (byte === KEY.CARRIAGE_RETURN || byte === KEY.LINE_FEED) return { kind: "enter" };
    if (byte >= KEY.DIGIT_0 && byte <= KEY.DIGIT_9)
      return { kind: "digit", digit: byte - KEY.DIGIT_0 };
    if (ESCAPE_ALIASES.has(byte)) return { kind: "back" };
    if (byte !== KEY.ESCAPE) return { kind: "other" };
    if (more !== undefined && !(await more(ESCAPE_DELAY_MS))) return { kind: "back" };
    const sequence = await readEscapeSequence(take, more);
    if (sequence.kind === "none") {
      try {
        again.prepend(sequence.readAgain);
      } finally {
        sequence.readAgain.fill(0);
      }
      return { kind: "other" };
    }
    if (sequence.kind === "alt") return { kind: "other" };
    if (sequence.final === KEY.SEQUENCE_TILDE) {
      if (sequence.parameters === "5") return { kind: "page-up" };
      if (sequence.parameters === "6") return { kind: "page-down" };
    }
    // Home and End however a terminal sends them: ESC [ H, ESC O H, or ESC [ 1 ~ as a VT220 and
    // tmux do (editKeyOf), and End alike.
    const edit = editKeyOf(sequence.introducer, sequence.parameters, sequence.final);
    if (edit === "home" || edit === "end") return { kind: edit };
    // Only an arrow key without parameters counts.
    if (sequence.parameters !== "") return { kind: "other" };
    if (sequence.final === KEY.ARROW_UP) return { kind: "up" };
    if (sequence.final === KEY.ARROW_DOWN) return { kind: "down" };
    return { kind: "other" };
  }

  /** Wipes and forgets the bytes typed ahead; true when Ctrl+C was among them. */
  static #wipeTypedAhead(): boolean {
    const typedAhead = TerminalKeys.#typedAhead;
    const again = TerminalKeys.#keyBytesAgain;
    const cancelled = typedAhead.includes(KEY.CTRL_C) || again.includes(KEY.CTRL_C);
    typedAhead.wipe();
    again.wipe();
    return cancelled;
  }

  /**
   * Drops the rest of an answer that was refused while it still arrived, such as a paste longer
   * than any answer: everything until no byte has come for PASTE_GAP_MS, wiped. Ctrl+C among it
   * cancels the command: CANCELLED is returned. Without `moreWithin` only what has arrived is
   * dropped. Bytes that `next` holds elsewhere, as a test's keyboard does, are read through it.
   */
  static async #dropRestOfPaste(
    next: NextByte,
    moreWithin: MoreWithin | undefined,
  ): Promise<Cancelled | undefined> {
    let cancelled = TerminalKeys.#wipeTypedAhead();
    while (moreWithin !== undefined && (await moreWithin(PASTE_GAP_MS))) {
      if (TerminalKeys.#typedAhead.length > 0)
        cancelled = TerminalKeys.#wipeTypedAhead() || cancelled;
      else if ((await next()) === KEY.CTRL_C) cancelled = true;
    }
    return cancelled ? CANCELLED : undefined;
  }
}

/**
 * A stop for a long search, which Ctrl+C sets off: it reads the terminal on standard input in raw
 * mode while the search runs and no question reads it, so that Ctrl+C arrives as a byte, as it
 * does at a question: a Windows pseudo-console need not send SIGINT for it. Raw mode also keeps
 * the terminal from sending the signals of the quit and suspend keys, which are therefore read
 * here as well: Ctrl+\ stops the search as Ctrl+C does, since SIGQUIT would end the tool on the
 * private screen, and Ctrl+Z suspends it (suspendJob). Every other key is dropped unseen, so that
 * nothing typed during the search shows on the private screen. Without a terminal the signal
 * never aborts and the keys stay signals. The search checks the signal at each turn of the event
 * loop; stop() must run on every path, in a `finally`, and before any question the search asks:
 * during does both.
 */
export class CtrlCWatch {
  readonly #controller = new AbortController();
  /** The reader of the terminal while it is watched; none without a terminal. */
  readonly #receive: ((chunk: Buffer) => void) | undefined;
  #watching: boolean;

  /** Starts watching the terminal, where there is one. */
  constructor() {
    this.#watching = terminalAvailable();
    if (!this.#watching) {
      this.#receive = undefined;
      return;
    }
    const controller = this.#controller;
    this.#receive = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (controller.signal.aborted) break;
        if (byte === KEY.CTRL_C || byte === KEY.CTRL_BACKSLASH) controller.abort(CANCELLED);
        else if (byte === KEY.CTRL_Z) suspendJob(controller);
      }
      // The chunk may hold a secret typed by mistake; it is not used.
      chunk.fill(0);
    };
    const input = process.stdin;
    RawMode.take(input);
    input.on("data", this.#receive);
    input.resume();
  }

  /**
   * Runs `search` with the signal of a new watch and stops watching when it ends or fails. A
   * Ctrl+C stops the search, which then says so in what it returns; a terminal that failed after
   * Ctrl+Z is an error, thrown here once the search has ended. It uses no `this`, so that it can be
   * passed on as a function, as the restore of shares takes it.
   */
  static async during<T>(this: void, search: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const watch = new CtrlCWatch();
    let result: T;
    try {
      result = await search(watch.signal);
    } finally {
      await watch.stop();
    }
    const { signal } = watch;
    if (signal.aborted && signal.reason !== CANCELLED) throw signal.reason;
    return result;
  }

  /**
   * Aborted with CANCELLED as its reason at Ctrl+C or Ctrl+\, and with the error when the
   * terminal fails after Ctrl+Z (during throws that one).
   */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** Gives the terminal back as it was, once it resolves; a second call does nothing. */
  async stop(): Promise<void> {
    if (!this.#watching || this.#receive === undefined) return;
    this.#watching = false;
    // As TerminalKeys.withRawMode leaves the terminal.
    const input = process.stdin;
    input.off("data", this.#receive);
    await RawMode.leave(input);
  }
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
 * before anything was typed, or at Escape where it goes back, and CANCELLED at Ctrl+C. A visible answer leaves the cursor
 * just after its end, wherever it was moved before, so that a caller can count the rows of the
 * question and the answer up from there.
 */
export async function readLine(
  next: NextByte,
  options: LineOptions,
): Promise<string | undefined | Cancelled> {
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
  const readAgain = new InputBytes();
  const take: NextByte = async () => (readAgain.length > 0 ? readAgain.shift() : next());
  const more: MoreWithin | undefined =
    moreWithin && (async (milliseconds) => readAgain.length > 0 || moreWithin(milliseconds));
  /** Whether no key follows within PASTE_GAP_MS: the end of a paste, or a key typed alone. */
  const quiet = async (): Promise<boolean> => more === undefined || !(await more(PASTE_GAP_MS));
  /** Bytes that turned out to be no key's sequence, read again before the next. */
  const giveBack = (bytes: number[]): void => {
    try {
      readAgain.prepend(bytes);
    } finally {
      bytes.fill(0);
    }
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
      if (byte === KEY.CTRL_C) return CANCELLED;
      if (byte === KEY.CTRL_D && answer.length === 0) return undefined;
      if (byte === KEY.BACKSPACE || byte === KEY.DELETE || byte === KEY.CTRL_U)
        answer.control(byte);
      else if (!echo) answer.insert(byte);
      else if (late) {
        const sequence = await readLateSequence(byte, take, defined(more));
        if ("key" in sequence) answer.edit(sequence.key);
        else {
          try {
            answer.insert(byte);
            giveBack(sequence.readAgain);
          } finally {
            // Insertion may refuse before the replay is admitted to its byte owner.
            sequence.readAgain.fill(0);
          }
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
  } finally {
    try {
      answer.wipe();
    } finally {
      readAgain.wipe();
    }
  }
}
