// The questions run as they do at a terminal, with their keys typed by the tests: `keysFor` gives
// the keys of each question in turn, and every question of choose or askLine is recorded in `asked`
// first, as it showed on standard error (drawn-question.ts). A typed question that is asked again,
// after an answer it refused, is drawn again and asks `keysFor` again. Only the program's edges are
// replaced here: its terminal's input (raw-mode-keys.ts), stty (node:child_process), the protection
// of its process, pdftocairo, and the English word list of @scure/bip39 as installed; the menu runs
// no command: each one ends as `terminal.exit` says, cancelled by default. A test file loads this
// module in vi.hoisted, and its vi.mock factories replace each module with what is here; so this
// module imports no module that a test replaces.

import type * as ChildProcess from "node:child_process";
import { drawnQuestion, type DrawnQuestion } from "./drawn-question.js";
import { keyedTerminalKeys } from "./raw-mode-keys.js";

type EnglishWords = typeof import("@scure/bip39/wordlists/english.js");
type ImageExport = typeof import("../../src/export/image-export.js");
type Protection = typeof import("../../src/cli/protection.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the tests type, what the questions asked, and what the menu's commands give. */
interface KeyedTerminal {
  /** The keys typed at the question asked now. */
  keysFor: () => string | Buffer;
  /** Called once a question is drawn, when it reads its first key, after `keysFor`. */
  onFirstKey: () => void;
  /** The questions of choose and askLine, each asking as it showed. */
  asked: DrawnQuestion[];
  /** What each command run by the menu gives: its exit code, or an error that stops its start. */
  exit: () => Promise<number>;
  /**
   * Whether the English word list is damaged, as in a damaged copy of its package: one word is
   * changed, so that the core self-test refuses it at the start of the menu.
   */
  wordListDamaged: boolean;
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
  wordListDamaged: false,
  protectionFails: false,
  atTerminal: false,
  events: [],
};

/**
 * The terminal's input: each question records what it asked in `terminal.asked`, then reads the
 * keys of `terminal.keysFor`.
 */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  const TerminalKeys = keyedTerminalKeys(actual, {
    keysFor: (drawn) => {
      const question = drawnQuestion(drawn);
      if (question !== undefined) terminal.asked.push(question);
      const keys = terminal.keysFor();
      terminal.onFirstKey();
      return keys;
    },
  });
  return {
    ...actual,
    TerminalKeys,
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

/** The images of cards, whose renderer is there. */
export function replacedImageExport(actual: ImageExport): ImageExport {
  return { ...actual, assertImageRenderer: async () => undefined };
}

/**
 * The English word list of @scure/bip39, as installed: damaged while `terminal.wordListDamaged`
 * says so. Read at each use, so that the program's modules, which run as they are, see it change.
 */
export function replacedEnglishWords(actual: EnglishWords): EnglishWords {
  // Its first word changed, as a damaged copy of the package could give it.
  const damaged = ["abandons", ...actual.wordlist.slice(1)];
  return {
    get wordlist() {
      return terminal.wordListDamaged ? damaged : actual.wordlist;
    },
  };
}
