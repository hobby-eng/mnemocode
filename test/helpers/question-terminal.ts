// The terminal of the tests of questions on the private screen, replaced at the program's edge
// only: node:tty, the terminal's input (terminal-input.ts) and the files (node:fs/promises). The
// program's own questions (terminal-choice.ts) and its private screen run as they are, and the keys
// that they read are typed here. The keys of a question are chosen when it reads the first of them,
// by what it drew on standard error, as a person answers what the screen shows: a list question
// (choose) takes the next answer of `terminal.choices`, the label of the entry to pick, typed as
// its digit or as arrows and Enter, Escape where none is left; any other question takes the next
// line of `terminal.answers`, as a terminal in raw mode delivers it (a lone Escape goes back). What
// each list question asked is read back from the screen (drawn-list.ts). Every test runs on the
// real private screen, which PrivateSteps opens, unless it closes it (PrivateSteps.close). Standard
// output is a terminal only with `terminal.stdoutTerminal`. Nothing reads the real terminal. A test
// file loads this module in vi.hoisted, and its vi.mock factories replace each module with what is
// here; so this module imports no module that a test replaces, and loads the program's modules that
// read the terminal only once the replaced ones are in place.

import type * as FileSystem from "node:fs/promises";
import type * as Tty from "node:tty";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { PrivateSteps } from "../../src/cli/private-steps.js";
import type { MoreWithin, NextByte } from "../../src/cli/terminal-keys.js";
import { headingLine } from "../../src/cli/terminal-style.js";
import { drawnList, keysOfAnswer, type DrawnList, type ListAnswer } from "./drawn-list.js";

type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the replaced terminal answers, and what it was asked. */
interface QuestionTerminal {
  /** The lines typed at the questions that read a line, and at Enter prompts, in turn. */
  answers: string[];
  /**
   * The answers of the list questions in turn: each an answer, a promise of one, which comes later,
   * or a function that gives one once the question is asked, as a person answers what they see.
   */
  choices: (ListAnswer | Promise<ListAnswer> | (() => Promise<ListAnswer>))[];
  /** The list questions asked, as they show. */
  questions: string[];
  /** The labels of each list question, in order. */
  labels: string[][];
  /** The notes of each list question's entries as they show, in order. */
  notes: (string | undefined)[][];
  /** What Escape does at each list question, as its key hint says. */
  escapes: string[];
  /**
   * In order: each list question, "drop" for each drop of the keys typed ahead, and "answered"
   * once each question, a list question too, has read its answer.
   */
  events: string[];
  /** Writes of a file that fail, as on a full disk, before one succeeds (replacedFiles). */
  saveFailures: number;
  /** The errno code of those failures: ENOSPC, a full disk, unless a test names another. */
  saveFailureCode: string;
  stdoutTerminal: boolean;
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
};

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

/** Each text on the private screen that `pattern`, a global pattern of prompts, finds, in order. */
export function promptsMatching(pattern: RegExp): string[] {
  return [...seen.screen.matchAll(pattern)].map((match) => match[0]);
}

/**
 * Everything written to standard error in the current test, which the questions read their keys
 * by; apart from `seen.screen`, which a test may empty.
 */
let written = "";

/** The title of the step screens of the tests, as the private screen of a command shows one. */
const STEP_TITLE = "Private operation";

/** node:tty, where only standard output may be a terminal (`terminal.stdoutTerminal`). */
export function replacedTty(actual: typeof Tty): typeof Tty {
  return { ...actual, isatty: (descriptor: number) => descriptor === 1 && terminal.stdoutTerminal };
}

/** Records what `list` asked in `terminal`, and notes that it cut to fit (cut-notes.ts). */
async function recordAsked(list: DrawnList): Promise<void> {
  // Loaded here, once the replaced modules are in place: it measures with terminal-choice.
  const { recordDrawnCuts } = await import("./cut-notes.js");
  recordDrawnCuts(list);
  terminal.questions.push(list.question);
  terminal.events.push(list.question);
  terminal.labels.push(list.entries.map((entry) => entry.label));
  terminal.notes.push(list.entries.map((entry) => entry.note));
  terminal.escapes.push(list.escape);
}

/**
 * The keys typed at a question that drew `drawn`: at a list question those of the next of
 * `terminal.choices`, which it records first; at any other the next of `terminal.answers`.
 */
async function keysFor(drawn: string): Promise<number[]> {
  const list = drawnList(drawn);
  if (list === undefined) return Array.from(Buffer.from(terminal.answers.shift() ?? "", "utf8"));
  await recordAsked(list);
  // A test may give an answer that comes later, as a promise, or once the question is asked.
  const choice = terminal.choices.shift();
  const keys = keysOfAnswer(list, await (typeof choice === "function" ? choice() : choice));
  return Array.from(Buffer.from(keys, "utf8"));
}

/** The terminal's input, which reads the keys typed here and watches no Ctrl-C. */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  class AnsweredKeys extends actual.TerminalKeys {
    static override async dropTypedAhead(): Promise<undefined> {
      terminal.events.push("drop");
      return undefined;
    }

    // An answer arrives at once, as a paste does: a line break with more after it is inside it.
    static override async withRawMode<T>(
      body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
    ): Promise<T> {
      const from = written.length;
      // Chosen at the first key read, once the question is drawn.
      let typed: Promise<number[]> | undefined;
      const keys = (): Promise<number[]> => (typed ??= keysFor(written.slice(from)));
      const result = await body(
        async () => (await keys()).shift(),
        async () => (await keys()).length > 0,
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

/**
 * The lines of `notices` as the private screen shows them: said once, then drawn again above each
 * of the `questions` that follow, each on a step screen of its own (PrivateSteps); so many lines of
 * `seen.notices`.
 */
export function keptAbove<T>(notices: readonly T[], questions: number): T[] {
  return Array.from({ length: 1 + questions }, () => notices).flat();
}

/** Gives standard error the size of a terminal window, as a test of what fits on it needs. */
export function windowOf(rows: number, columns: number): void {
  Object.assign(process.stderr, { rows, columns });
}

/**
 * Opens the private screen's step screens as a command's private screen does (withPrivateScreen):
 * each step clears the screen and draws its title, on standard error, and the warnings kept for
 * it are notices.
 */
async function openStepScreens(): Promise<void> {
  // Loaded here, once the replaced modules are in place.
  const { CLEAR_SCREEN, noticeLines } = await import("../../src/cli/terminal.js");
  PrivateSteps.open(
    () => {
      process.stderr.write(`${CLEAR_SCREEN}${headingLine(process.stderr, STEP_TITLE)}\n\n`);
    },
    (warning) => {
      for (const line of noticeLines(warning, "warning")) console.error(line);
    },
  );
}

/**
 * Before each test, a terminal with nothing to answer and nothing shown, without colour, and the
 * private screen open; after it, the private screen closed, the writers and the window as they
 * were, and no note of a list cut to fit.
 */
export function questionsOnPrivateScreen(): void {
  beforeEach(async () => {
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
    });
    Object.assign(seen, { screen: "", out: [], notices: [], refusals: [] });
    written = "";
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      seen.screen += text;
      written += text;
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      seen.out.push(line.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      seen.notices.push(line.join(" "));
    });
    await openStepScreens();
  });
  afterEach(async () => {
    PrivateSteps.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // The window size that a test gave standard error.
    Reflect.deleteProperty(process.stderr, "rows");
    Reflect.deleteProperty(process.stderr, "columns");
    const { takeCutNotes } = await import("./cut-notes.js");
    expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
  });
}
