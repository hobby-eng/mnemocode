// --backup-check answers the question that the private screen asks after Encode's result and after
// a split into shares. That screen shows at a terminal with --ask-secrets and with a phrase read
// from a file alike, so the option is taken there, and refused only where no such screen shows
// (CORE-41). The terminal is replaced at the program's edge, node:tty.

import { afterEach, describe, expect, it, vi } from "vitest";

const screen = vi.hoisted(() => ({ terminal: false }));
vi.mock("node:tty", async (original) => ({
  ...(await original<typeof import("node:tty")>()),
  // Standard input and standard error at a terminal, standard output wherever.
  isatty: (descriptor: number) => screen.terminal && descriptor !== 1,
}));

import { backupCheckAnswer } from "../src/cli/backup-check.js";

const REFUSAL =
  "--backup-check answers a question of the private screen after the result, which needs a terminal.";

afterEach(() => {
  screen.terminal = false;
  vi.unstubAllEnvs();
});

describe("--backup-check", () => {
  it("answers the check of a phrase read from a file at a terminal, without --ask-secrets", () => {
    screen.terminal = true;
    vi.stubEnv("TERM", "xterm");
    expect(backupCheckAnswer({ "backup-check": "no", "mnemonic-file": "public.txt" })).toBe("no");
    expect(backupCheckAnswer({ "backup-check": "yes", "ask-secrets": true })).toBe("yes");
    expect(backupCheckAnswer({})).toBeUndefined();
  });

  it("is refused where no private screen shows: in a script, or on a terminal that is dumb", () => {
    vi.stubEnv("TERM", "xterm");
    expect(() => backupCheckAnswer({ "backup-check": "no" })).toThrow(REFUSAL);
    screen.terminal = true;
    vi.stubEnv("TERM", "dumb");
    expect(() => backupCheckAnswer({ "backup-check": "yes", "ask-secrets": true })).toThrow(
      REFUSAL,
    );
  });
});
