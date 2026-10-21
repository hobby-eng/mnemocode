// Every command that reads the wallet's options owns its BIP39 passphrase and a WIF's text for its
// own run (GivenWallet, CORE-24) and erases them when it ends: decode and re-encode on the private
// screen, with the terminal replaced (test/helpers/question-terminal.ts), and sskr-export from the
// options. Public test data only: the "abandon … about" phrase masked with a public date, and the
// shares of vectors/sskr-v1.json ("bip39-128-2-of-3").

import { describe, expect, it, vi } from "vitest";
import { GivenWallet } from "../src/cli/bitcoin-options.js";
import { runDecode } from "../src/cli/decode-command.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { runReEncode } from "../src/cli/re-encode-command.js";
import { runSskrExport } from "../src/cli/sskr-export-command.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import {
  DATE,
  LEGACY_VALID_MASKED,
  MASKED,
  TEST_FINGERPRINT,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

const WIPED = "This secret value has been wiped.";

questionsOnPrivateScreen();

/**
 * The owners of the wallet's secrets that erased them while `run` ran, each once, in the order of
 * their first wipe; the spy only watches GivenWallet.wipe, which runs as it is.
 */
async function wipedDuring(run: () => Promise<unknown>): Promise<GivenWallet[]> {
  const wipe = vi.spyOn(GivenWallet.prototype, "wipe");
  try {
    await run();
    // The spy's contexts are typed unknown: each is the GivenWallet that wipe ran on.
    return [...new Set(wipe.mock.contexts)].filter((owner) => owner instanceof GivenWallet);
  } finally {
    wipe.mockRestore();
  }
}

describe("a command with the wallet's options", () => {
  it("erases the passphrase once decode on the private screen has searched the dates", async () => {
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r"];
    const owners = await wipedDuring(() =>
      runDecode({ "ask-secrets": true, mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT }),
    );
    expect(seen.out).toEqual([`${DATE}\t${TEST_PHRASE}\tmatched at m`]);
    expect(owners).toHaveLength(1);
    for (const owner of owners) expect(() => owner.passphrase).toThrow(WIPED);
  });

  it("erases the passphrase of re-encode and of the decode questions it asks", async () => {
    terminal.answers = [`${LEGACY_VALID_MASKED}\r`, `${DATE}\r`, "about\r"];
    terminal.choices = ["Yes, I recognise it"];
    const owners = await wipedDuring(() =>
      runReEncode({
        "ask-secrets": true,
        "old-mode": "seedshift-legacy-valid",
        mode: "direct",
        format: "3",
      }),
    );
    expect(terminal.questions[0]).toBe("Is this the seed phrase to re-encode?");
    expect(owners).toHaveLength(2);
    for (const owner of owners) expect(() => owner.passphrase).toThrow(WIPED);
  });

  it("erases the passphrase once sskr-export has written the shares again", async () => {
    PrivateSteps.close();
    const owners = await wipedDuring(() => runSskrExport({ share: [...SSKR_SET_VECTOR.shares] }));
    expect(seen.out.join("\n")).toContain(SSKR_SET_VECTOR.shares[0]);
    expect(owners).toHaveLength(1);
    for (const owner of owners) expect(() => owner.passphrase).toThrow(WIPED);
  });
});
