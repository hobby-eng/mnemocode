// The terminal of the tests of questions on the private screen, replaced: each question that reads
// a line takes the next of `terminal.answers`, as a terminal in raw mode delivers it (a lone Escape
// goes back), and each list question (choose) the next of `terminal.choices`, or Escape when none
// is left; byLabel answers with the entry of that label. Standard output is a terminal only with
// `terminal.stdoutTerminal`, and the private screen is on unless `terminal.privateScreen` is
// false. Nothing reads the real terminal. A test file loads this module in vi.hoisted, and its
// vi.mock factories replace each module with what is here; so this module imports no module that a
// test replaces.

import type * as FileSystem from "node:fs/promises";
import type * as Tty from "node:tty";
import { inspect } from "node:util";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { Choice, ChooseOptions } from "../../src/cli/terminal-choice.js";
import { CANCELLED, type Cancelled } from "../../src/cli/terminal-keys.js";

type PrivateScreen = typeof import("../../src/cli/private-screen.js");
type TerminalChoice = typeof import("../../src/cli/terminal-choice.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the replaced terminal answers, and what it was asked. */
interface QuestionTerminal {
  /** The lines typed at the questions that read a line, in turn. */
  answers: string[];
  /**
   * The answers of the list questions in turn: the value of an entry, byLabel, undefined for
   * Escape or CANCELLED for Ctrl+C, or a promise of one of them.
   */
  choices: unknown[];
  questions: string[];
  /** The labels of each list question, in order. */
  labels: string[][];
  /** The notes of each list question's entries, in order. */
  notes: (string | undefined)[][];
  /** What Escape does at each list question, as its key hint says. */
  escapes: (string | undefined)[];
  /**
   * In order: each list question, "drop" for each drop of the keys typed ahead, and "answered"
   * after each answer read.
   */
  events: string[];
  /** Writes of a file that fail, as on a full disk, before one succeeds (replacedFiles). */
  saveFailures: number;
  /** The errno code of those failures: ENOSPC, a full disk, unless a test names another. */
  saveFailureCode: string;
  stdoutTerminal: boolean;
  privateScreen: boolean;
}

/** What the replaced terminal answers, and what it was asked. */
export const terminal: QuestionTerminal = {
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
interface Seen {
  screen: string;
  /** The lines of standard output. */
  out: string[];
  /** The lines of console.error: the notices. */
  notices: string[];
  /** What the parser of each answer refused threw, in order, before its warning was shown. */
  refusals: unknown[];
}

/** What the questions wrote: the private screen (standard error), and the lines of each stream. */
export const seen: Seen = { screen: "", out: [], notices: [], refusals: [] };

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
  class AnsweredKeys extends actual.TerminalKeys {
    static override async dropTypedAhead(): Promise<undefined> {
      terminal.events.push("drop");
      return undefined;
    }

    // An answer arrives at once, as a paste does: a line break with more after it is inside it.
    static override async withRawMode<T>(
      body: (
        next: () => Promise<number | undefined>,
        moreWithin: () => Promise<boolean>,
      ) => Promise<T>,
    ): Promise<T> {
      const bytes = Array.from(Buffer.from(terminal.answers.shift() ?? "", "utf8"));
      const result = await body(
        async () => bytes.shift(),
        async () => bytes.length > 0,
      );
      terminal.events.push("answered");
      return result;
    }
  }
  // The searches watch no terminal here.
  class UnwatchedSearch extends actual.CtrlCWatch {
    static override during<T>(search: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return search(new AbortController().signal);
    }
  }
  return {
    ...actual,
    terminalAvailable: () => true,
    TerminalKeys: AnsweredKeys,
    CtrlCWatch: UnwatchedSearch,
    refusal: (error: unknown) => {
      seen.refusals.push(error);
      return actual.refusal(error);
    },
  };
}

/**
 * The list questions, which record what they ask and answer with `terminal.choices`: the entry of
 * that value or label, Escape or Ctrl+C. An answer that is no entry of the question fails.
 */
export function replacedTerminalChoice(actual: TerminalChoice): TerminalChoice {
  return {
    ...actual,
    choose: async <T>(
      question: string,
      choices: readonly Choice<T>[],
      options: ChooseOptions,
    ): Promise<T | undefined | Cancelled> => {
      // Loaded here, once the replaced modules are in place: it measures with terminal-choice.
      const { recordCutNotes } = await import("./cut-notes.js");
      recordCutNotes(question, choices);
      terminal.questions.push(question);
      terminal.events.push(question);
      terminal.labels.push(choices.map((choice) => choice.label));
      terminal.notes.push(choices.map((choice) => choice.note));
      terminal.escapes.push(options.quit);
      // A test may give an answer that comes later, as a promise.
      const answer: unknown = await terminal.choices.shift();
      if (answer === undefined || answer === CANCELLED) return answer;
      const entry = isByLabel(answer)
        ? choices.find((choice) => choice.label === answer[LABEL])
        : choices.find((choice) => Object.is(choice.value, answer));
      if (entry === undefined) {
        const named = isByLabel(answer) ? answer[LABEL] : inspect(answer);
        throw new Error(`No entry ${named} at ${question}`);
      }
      return entry.value;
    },
  };
}

/**
 * node:fs/promises, the program's edge, whose next `terminal.saveFailures` writes of a file fail
 * with the errno code `terminal.saveFailureCode`, as the file system reports it; every save of the
 * program writes its file so. Everything else is the real file system.
 */
export function replacedFiles(actual: typeof FileSystem): typeof FileSystem {
  return {
    ...actual,
    writeFile: async (...write: Parameters<typeof actual.writeFile>) => {
      if (terminal.saveFailures > 0) {
        terminal.saveFailures -= 1;
        const code = terminal.saveFailureCode;
        throw Object.assign(new Error(`${code}: the save failed, write`), { code });
      }
      return actual.writeFile(...write);
    },
  };
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
    Object.assign(seen, { screen: "", out: [], notices: [], refusals: [] });
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      seen.screen += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
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
