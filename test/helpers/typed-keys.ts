// The terminal's input of a test, replaced: a question reads the keys typed for it in `keyboard`,
// and nothing typed ahead is dropped. A test file loads this module in vi.hoisted, and its vi.mock
// factory replaces terminal-input.ts with replacedTerminalInput; so this module imports no module
// that a test replaces.

import type { MoreWithin, NextByte } from "../../src/cli/terminal-keys.js";

type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What is typed, and whether standard input and standard error count as a terminal. */
interface TypedKeyboard {
  /** The bytes typed, all at once, as a paste arrives; each read takes from them. */
  bytes: number[];
  /** Answers typed one after the other: each read takes the next one, before `bytes`. */
  answers: string[];
  /** Whether terminalAvailable says yes; undefined leaves the answer to the real check. */
  terminal: boolean | undefined;
}

/** What is typed, and whether standard input and standard error count as a terminal. */
export const keyboard: TypedKeyboard = { bytes: [], answers: [], terminal: undefined };

/** Types `keys` for the questions that read next, in place of anything typed before. */
export function type(keys: string): void {
  keyboard.bytes = Array.from(Buffer.from(keys, "utf8"));
}

/** terminal-input.ts, whose questions read what `keyboard` holds. */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  class TypedKeys extends actual.TerminalKeys {
    static override async dropTypedAhead(): Promise<undefined> {
      return undefined;
    }

    static override async withRawMode<T>(
      body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
    ): Promise<T> {
      const answer = keyboard.answers.shift();
      const answered = answer === undefined ? undefined : Array.from(Buffer.from(answer, "utf8"));
      // Read at each key: a test may type more while the question reads.
      const bytes = (): number[] => answered ?? keyboard.bytes;
      return body(
        async () => bytes().shift(),
        async () => bytes().length > 0,
      );
    }
  }
  return {
    ...actual,
    terminalAvailable: () => keyboard.terminal ?? actual.terminalAvailable(),
    TerminalKeys: TypedKeys,
  };
}
