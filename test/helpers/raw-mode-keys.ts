// The keys of the questions of the tests that answer the start menu and its questions as a person
// does (keyed-terminal.ts, menu-script.ts), replaced at the program's edge, the terminal's input
// (terminal-input.ts): a question that reads the terminal in raw mode (TerminalKeys.withRawMode)
// reads the keys that its test gives for what the question drew on standard error before its first
// key, and the test hears what the question wrote after that, such as its line in the record of
// answers. Nothing typed ahead is dropped: each question gets the keys given for it. A test file
// loads this module in vi.hoisted, through its harness; so it imports no module that a test replaces.

import type { MoreWithin, NextByte } from "../../src/cli/terminal-keys.js";

type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What a test gives each question that reads the terminal, and hears from it. */
export interface KeyedQuestions {
  /**
   * The keys typed at a question that drew `drawn`, everything written on standard error since it
   * started reading the terminal, in colour where it has colour; asked when it reads its first key.
   */
  readonly keysFor: (drawn: string) => string | Buffer | Promise<string | Buffer>;
  /**
   * Hears what a question wrote on standard error after its first key, once it has stopped reading
   * the terminal, also when it failed; "" when it read no key.
   */
  readonly ended?: (written: string) => void;
}

/** Makes standard error give `add` the text of each chunk it writes; returns what undoes it. */
function hearStandardError(add: (text: string) => void): () => void {
  // oxlint-disable-next-line typescript/unbound-method -- kept to be put back; called with its stream
  const write = process.stderr.write;
  const heard = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    // Decoded at once: readLine wipes its buffer when it returns.
    add(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return Reflect.apply(write, process.stderr, [chunk, ...rest]) !== false;
  };
  process.stderr.write = heard;
  return () => {
    // Only while it is the writer: a writer put over it since stays.
    if (process.stderr.write === heard) process.stderr.write = write;
  };
}

/**
 * TerminalKeys of terminal-input.ts as `actual` has it, whose questions read the keys that
 * `questions` gives them. A question that reads more keys than it was given fails.
 */
export function keyedTerminalKeys(
  actual: TerminalInput,
  questions: KeyedQuestions,
): TerminalInput["TerminalKeys"] {
  return class KeyedKeys extends actual.TerminalKeys {
    static override async withRawMode<T>(
      body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
    ): Promise<T> {
      let written = "";
      const stopHearing = hearStandardError((text) => {
        written += text;
      });
      // Asked once the question is drawn, at its first key.
      let keys: Promise<Buffer> | undefined;
      let drawnUpTo = 0;
      const typed = (): Promise<Buffer> => {
        if (keys === undefined) {
          drawnUpTo = written.length;
          keys = Promise.resolve(questions.keysFor(written)).then((given) =>
            typeof given === "string" ? Buffer.from(given, "utf8") : given,
          );
        }
        return keys;
      };
      let read = 0;
      const next: NextByte = async () => {
        const bytes = await typed();
        if (read === bytes.length) throw new Error("the question read more keys than were typed");
        return bytes[read++];
      };
      try {
        // A final Escape is Escape alone: no byte follows it.
        return await body(next, async () => read < (await typed()).length);
      } finally {
        stopHearing();
        questions.ended?.(keys === undefined ? "" : written.slice(drawnUpTo));
      }
    }

    // Nothing is typed ahead here: every question gets the keys given for it.
    static override async dropTypedAhead(): Promise<undefined> {
      return undefined;
    }
  };
}
