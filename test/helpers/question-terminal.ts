// The terminal of the tests of questions on the private screen, replaced: each question that reads
// a line takes the next of `terminal.answers`, as a terminal in raw mode delivers it (a lone Escape
// goes back), and each list question (choose) the next of `terminal.choices`, or Escape when none
// is left. Standard output is a terminal only with `terminal.stdoutTerminal`. Nothing reads the
// real terminal. A test file loads this module in vi.hoisted, and its vi.mock factories replace
// each module with what is here; so this module imports no module that a test replaces.

import type * as Tty from "node:tty";
import { afterEach, beforeEach, expect, vi } from "vitest";

type PrivateScreen = typeof import("../../src/cli/private-screen.js");
type TerminalChoice = typeof import("../../src/cli/terminal-choice.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the replaced terminal answers, and what it was asked. */
export const terminal = {
  answers: [] as string[],
  choices: [] as unknown[],
  questions: [] as string[],
  /** The labels of each list question, in order. */
  labels: [] as string[][],
  /** The notes of each list question's entries, in order. */
  notes: [] as (string | undefined)[][],
  /** What Escape does at each list question, as its key hint says. */
  escapes: [] as (string | undefined)[],
  /**
   * In order: each list question, "drop" for each drop of the keys typed ahead, and "answered"
   * after each answer read.
   */
  events: [] as string[],
  /** Saves that fail with ENOSPC, as on a full disk, before one succeeds (failingSave). */
  saveFailures: 0,
  stdoutTerminal: false,
};

/** What the questions wrote: the private screen (standard error), and the lines of each stream. */
export const seen = {
  screen: "",
  /** The lines of standard output. */
  out: [] as string[],
  /** The lines of console.error: the notices. */
  notices: [] as string[],
};

/** node:tty, where only standard output may be a terminal (`terminal.stdoutTerminal`). */
export function replacedTty(actual: typeof Tty): typeof Tty {
  return { ...actual, isatty: (descriptor: number) => descriptor === 1 && terminal.stdoutTerminal };
}

/** The private screen, which is always on. */
export function replacedPrivateScreen(actual: PrivateScreen): PrivateScreen {
  return { ...actual, onPrivateScreen: () => true };
}

/** The terminal's input, which reads `terminal.answers` and watches no Ctrl-C. */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  return {
    ...actual,
    terminalAvailable: () => true,
    dropTypedAhead: async () => {
      terminal.events.push("drop");
    },
    // An answer arrives at once, as a paste does: a line break with more after it is inside it.
    withRawTerminal: async <T>(
      body: (
        next: () => Promise<number | undefined>,
        moreWithin: () => Promise<boolean>,
      ) => Promise<T>,
    ) => {
      const bytes = Array.from(Buffer.from(terminal.answers.shift() ?? "", "utf8"));
      const result = await body(
        async () => bytes.shift(),
        async () => bytes.length > 0,
      );
      terminal.events.push("answered");
      return result;
    },
    // The searches watch no terminal here.
    withCtrlCWatch: <T>(search: (signal: AbortSignal) => Promise<T>) =>
      search(new AbortController().signal),
  };
}

/** The list questions, which record what they ask and answer with `terminal.choices`. */
export function replacedTerminalChoice(actual: TerminalChoice): TerminalChoice {
  return {
    ...actual,
    choose: (async (
      question: string,
      choices: readonly { readonly label: string; readonly note?: string }[],
      options?: { readonly quit?: string },
    ) => {
      // Loaded here, once the replaced modules are in place: it measures with terminal-choice.
      const { recordCutNotes } = await import("./cut-notes.js");
      recordCutNotes(question, choices);
      terminal.questions.push(question);
      terminal.events.push(question);
      terminal.labels.push(choices.map((choice) => choice.label));
      terminal.notes.push(choices.map((choice) => choice.note));
      terminal.escapes.push(options?.quit);
      return terminal.choices.shift();
    }) as TerminalChoice["choose"],
  };
}

/** `save`, unless `terminal.saveFailures` says that it fails first, as on a full disk. */
export async function failingSave<T>(save: () => Promise<T>): Promise<T> {
  if (terminal.saveFailures > 0) {
    terminal.saveFailures -= 1;
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  }
  return save();
}

/** Gives standard error the size of a terminal window, as a test of what fits on it needs. */
export function windowOf(rows: number, columns: number): void {
  Object.assign(process.stderr, { rows, columns });
}

/**
 * Before each test, a terminal with nothing to answer and nothing shown, without colour; after it,
 * the writers and the window as they were, and no note of a list cut to fit.
 */
export function questionsOnPrivateScreen(): void {
  beforeEach(() => {
    Object.assign(terminal, {
      answers: [],
      choices: [],
      questions: [],
      labels: [],
      notes: [],
      escapes: [],
      events: [],
      saveFailures: 0,
      stdoutTerminal: false,
    });
    Object.assign(seen, { screen: "", out: [], notices: [] });
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      seen.screen += Buffer.from(chunk as Uint8Array).toString("utf8");
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      seen.out.push(line.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      seen.notices.push(line.join(" "));
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // The window size that a test gave standard error.
    Reflect.deleteProperty(process.stderr, "rows");
    Reflect.deleteProperty(process.stderr, "columns");
    const { takeCutNotes } = await import("./cut-notes.js");
    expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
  });
}
