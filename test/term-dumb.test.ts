// AUD-010-UI003: a terminal that says TERM=dumb cannot draw the private screen, and the refusal
// says so rather than that a terminal is missing. Standard input and standard error are taken as
// terminals here, so no key is read: the refusal comes before any question.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:tty", async (original) => ({
  ...(await original<typeof import("node:tty")>()),
  isatty: () => true,
}));

const { askSecretUntil } = await import("../src/cli/ask.js");
const { dumbTerminal } = await import("../src/cli/terminal-style.js");
const { terminalAvailable, terminalsAttached } = await import("../src/cli/terminal-input.js");

describe("a terminal that says TERM=dumb (AUD-010-UI003)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is attached but cannot show the private screen, and the refusal names TERM", async () => {
    vi.stubEnv("TERM", "dumb");
    expect(terminalsAttached()).toBe(true);
    expect(dumbTerminal()).toBe(true);
    expect(terminalAvailable()).toBe(false);
    await expect(askSecretUntil("Seed phrase:", (answer) => answer)).rejects.toThrow(
      "this one says TERM=dumb",
    );
  });
});
