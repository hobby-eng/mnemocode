// The terminal of the tests of questions on the private screen, replaced: each question that reads
// a line takes the next of `terminal.answers`, as a terminal in raw mode delivers it (a lone Escape
// goes back), and each list question (choose) the next of `terminal.choices`, or Escape when none
// is left; byLabel answers with the entry of that label. Standard output is a terminal only with
// `terminal.stdoutTerminal`, and the private screen is on unless `terminal.privateScreen` is
// false. Nothing reads the real terminal. A test file loads this module in vi.hoisted, and its
// vi.mock factories replace each module with what is here; so this module imports no module that a
// test replaces.

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
  /** Saves that fail, as on a full disk, before one succeeds (failingSave). */
  saveFailures: 0,
  /** The errno code of those failures: ENOSPC, a full disk, unless a test names another. */
  saveFailureCode: "ENOSPC",
  stdoutTerminal: false,
  privateScreen: true,
};

const LABEL = Symbol("label");

/** A list answer given by the label of its entry, as a person picks it. */
interface ByLabel {
  readonly [LABEL]: string;
}

/** The answer of a list question that picks the entry labelled `label`; it fails without one. */
export function byLabel(label: string): ByLabel {
  return { [LABEL]: label };
}

function isByLabel(answer: unknown): answer is ByLabel {
  return typeof answer === "object" && answer !== null && LABEL in answer;
}

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

/** The private screen, which is on unless `terminal.privateScreen` is false. */
export function replacedPrivateScreen(actual: PrivateScreen): PrivateScreen {
  return { ...actual, onPrivateScreen: () => terminal.privateScreen };
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
      choices: readonly {
        readonly label: string;
        readonly note?: string;
        readonly value: unknown;
      }[],
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
      const answer = terminal.choices.shift();
      if (!isByLabel(answer)) return answer;
      const entry = choices.find((choice) => choice.label === answer[LABEL]);
      if (entry === undefined) throw new Error(`No entry ${answer[LABEL]} at ${question}`);
      return entry.value;
    }) as TerminalChoice["choose"],
  };
}

/**
 * `save`, unless `terminal.saveFailures` says that it fails first, with the errno code
 * `terminal.saveFailureCode`, as the file system reports it.
 */
export async function failingSave<T>(save: () => Promise<T>): Promise<T> {
  if (terminal.saveFailures > 0) {
    terminal.saveFailures -= 1;
    const code = terminal.saveFailureCode;
    throw Object.assign(new Error(`${code}: the save failed, write`), { code });
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
      saveFailureCode: "ENOSPC",
      stdoutTerminal: false,
      privateScreen: true,
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
