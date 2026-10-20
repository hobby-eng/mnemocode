// The questions run as they do at a terminal, with their keys typed by the tests: `keysFor` gives
// the keys of each question in turn, and every question asked is recorded in `asked` first. A
// typed question that is asked again, after an answer it refused, asks `keysFor` again. The menu
// runs no command: each one ends as `terminal.exit` says, cancelled by default. A test file loads
// this module in vi.hoisted, and its vi.mock factories replace each module with what is here; so
// this module imports no module that a test replaces.

import type * as ChildProcess from "node:child_process";
import type { Choice, ChooseOptions, LineQuestion } from "../../src/cli/terminal-choice.js";
import type { MoreWithin, NextByte } from "../../src/cli/terminal-keys.js";

type ImageExport = typeof import("../../src/export/image-export.js");
type Protection = typeof import("../../src/cli/protection.js");
type SelfTest = typeof import("../../src/cli/self-test.js");
type TerminalChoice = typeof import("../../src/cli/terminal-choice.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the tests type, what the questions asked, and what the menu's commands give. */
interface KeyedTerminal {
  /** The keys typed at the question asked now. */
  keysFor: () => string | Buffer;
  /** Called once a question is drawn, when it reads its first key. */
  onFirstKey: () => void;
  asked: Question[];
  /** What each command run by the menu gives: its exit code, or an error that stops its start. */
  exit: () => Promise<number>;
  /** Whether the core self-test fails at the start of the menu. */
  selfTestFails: boolean;
  /** Whether this process cannot be protected (assertProtected) at the start of the menu. */
  protectionFails: boolean;
  /** Whether standard input and standard error are taken for a terminal (terminalAvailable). */
  atTerminal: boolean;
  /** The programs that the menu ran with spawnSync, and when, among the commands it ran. */
  events: string[];
}

/** What the tests type, what the questions asked, and what the menu's commands give. */
export const terminal: KeyedTerminal = {
  keysFor: () => {
    throw new Error("no keys were given for this question");
  },
  onFirstKey: () => undefined,
  asked: [],
  exit: async () => 130,
  selfTestFails: false,
  protectionFails: false,
  atTerminal: false,
  events: [],
};

/** A question as it was asked. */
export interface Question {
  readonly kind: "choose" | "line";
  readonly question: string;
  /** The labels of the entries of a list. */
  readonly labels?: readonly string[];
  readonly fallback?: string | undefined;
  readonly optional?: string | undefined;
  readonly warning?: string | undefined;
}

/** The terminal's input, which reads the keys of `terminal.keysFor`. */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  class KeyedKeys extends actual.TerminalKeys {
    static override async withRawMode<T>(
      body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
    ): Promise<T> {
      const keys = terminal.keysFor();
      const bytes = typeof keys === "string" ? Buffer.from(keys, "utf8") : keys;
      let read = 0;
      const next: NextByte = async () => {
        if (read === 0) terminal.onFirstKey();
        if (read === bytes.length) throw new Error("the question read more keys than were typed");
        return bytes[read++];
      };
      // A final Escape is Escape alone: no byte follows it.
      return body(next, async () => read < bytes.length);
    }

    // Nothing is typed ahead here: every question gets the keys given for it.
    static override async dropTypedAhead(): Promise<undefined> {
      return undefined;
    }
  }
  return {
    ...actual,
    TerminalKeys: KeyedKeys,
    // Not the test runner's own standard input, which may or may not be a terminal.
    terminalAvailable: () => terminal.atTerminal,
  };
}

/**
 * stty, which the menu runs around each command at a terminal, only records what it was asked. Its
 * spawnSync gives the status and the output that the menu reads, and runs no program.
 */
export function replacedChildProcess(actual: typeof ChildProcess) {
  return {
    ...actual,
    spawnSync: (program: string, args: readonly string[]) => {
      terminal.events.push(`${program} ${args.join(" ")}`);
      return { status: 0, stdout: args[0] === "-g" ? "saved-modes\n" : "" };
    },
  };
}

/** The questions as they are, each recorded in `terminal.asked` first. */
export function replacedTerminalChoice(actual: TerminalChoice): TerminalChoice {
  return {
    ...actual,
    choose: <T>(question: string, choices: readonly Choice<T>[], options: ChooseOptions) => {
      const labels = choices.map((choice) => choice.label);
      terminal.asked.push({ kind: "choose", question, labels, warning: options.warning });
      return actual.choose(question, choices, options);
    },
    askLine: (question: string, label: string, options?: LineQuestion) => {
      terminal.asked.push({
        kind: "line",
        question,
        fallback: options?.fallback,
        optional: options?.optional,
        warning: options?.warning,
      });
      return actual.askLine(question, label, options);
    },
  };
}

/**
 * The protection of a command, which runs none: each ends as `terminal.exit` says. The process
 * is protected unless `terminal.protectionFails` says so.
 */
export function replacedProtection(actual: Protection): Protection {
  return {
    ...actual,
    dropForMenu: () => undefined,
    assertProtected: () => {
      if (terminal.protectionFails) throw new Error("Core dumps could not be switched off.");
    },
    runInOwnProcess: () => terminal.exit(),
  };
}

/** The core self-test, which fails when `terminal.selfTestFails` says so. */
export function replacedSelfTest(actual: SelfTest): SelfTest {
  return {
    ...actual,
    assertCoreSelfTest: () => {
      if (terminal.selfTestFails) throw new Error("CRITICAL: MnemoCode core self-test failed.");
    },
  };
}

/** The images of cards, whose renderer is there. */
export function replacedImageExport(actual: ImageExport): ImageExport {
  return { ...actual, assertImageRenderer: async () => undefined };
}
