// The raw keys of the terminal that the questions act on, the readers of the bytes typed, how long
// the rest of a key's sequence or of a paste may take, and the refusals of a question: cancelled
// with Ctrl+C, or an answer that it cannot use.

import { CANCELLED_MESSAGE } from "./exit-codes.js";

/** Raw terminal bytes that this module acts on. */
export const KEY = {
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
export const ESCAPE_DELAY_MS = 100;

/**
 * How long the rest of a paste may take after one of its bytes: a paste arrives in one burst, in
 * chunks microseconds apart, while no person types two keys this fast. A line break followed this
 * soon is inside a paste; an answer refused halfway is dropped until a gap this long.
 */
export const PASTE_GAP_MS = 20;
