// sskr-export when several sets fit the same shares, on the private screen with the terminal
// replaced (test/helpers/question-terminal.ts). Typed shares give a second set only where a wrong
// combination of their marked units passes the 32-bit digest by chance (src/sskr/joint-repair.ts:
// about once in 2^32 combinations), which no test can search for; so the steps of the command that
// take the sets, phrasesOfSets (sskr-restore-command.ts) and exportRestored
// (sskr-export-command.ts), are given real sets as data, built through the library's public API,
// as share-repair-warning.test.ts gives them to the library's steps. Public test data only: the
// shares of vectors/sskr-v1.json ("bip39-128-2-of-3") and shares of the "abandon … about" phrase.

import { describe, expect, it, vi } from "vitest";
import type { ParsedArguments } from "../src/cli/arguments.js";
import { givenWallet } from "../src/cli/bitcoin-options.js";
import { TypedShares } from "../src/cli/share-repair.js";
import { exportRestored } from "../src/cli/sskr-export-command.js";
import { phrasesOfSets, type Recovery } from "../src/cli/sskr-restore-command.js";
import { FINGERPRINT_WARNING } from "../src/core/wallet-check.js";
import type { RepairedSet } from "../src/sskr/joint-results.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { unrepairedShare } from "../src/sskr/repair.js";
import { severalSetsNote, variantsMessage } from "../src/sskr/share-restore.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { testPhraseSet } from "./helpers/shares.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

/**
 * The master fingerprint of the phrase of SSKR_SET_VECTOR, computed with an independent Python
 * implementation of BIP39 and BIP32 that first reproduces the published BIP84 vector of
 * "abandon … about".
 */
const SET_FINGERPRINT = "05d027a5";
const WALLET_QUESTION = "How can MnemoCode recognise the wallet?";
/** The places of the shares of each set among those typed, by their index in the set. */
const PLACES = [1, 2];
/** The export of --format ur, shown on the screen, with nothing to save. */
const OUTPUT = { given: "ur", checked: undefined, args: {} } as const;

questionsOnPrivateScreen();

/** The set of the first two shares of SSKR_SET_VECTOR, read as typed. */
function vectorSet(): RepairedSet {
  return {
    mnemonic: SSKR_SET_VECTOR.phrase,
    shares: SSKR_SET_VECTOR.shares.slice(0, 2).map(unrepairedShare),
    unsettled: [],
  };
}

/**
 * Runs `step` with a restore on the private screen in direct mode, with the wallet of `options`,
 * if any, and the first two shares of SSKR_SET_VECTOR typed; the restore's owners end with it.
 */
async function withRecovery(
  options: ParsedArguments,
  step: (r: Recovery) => Promise<void>,
): Promise<void> {
  using wallet = givenWallet(options);
  using shares = await TypedShares.given({ share: SSKR_SET_VECTOR.shares.slice(0, 2) });
  await step({
    interactive: true,
    mode: "direct",
    limits: {},
    wallet,
    shares,
    evidence: wallet.evidence,
    dates: undefined,
  });
}

describe("sskr-export, given two sets that fit the same shares", () => {
  it("shows each set with the fingerprint of its phrase when the wallet cannot be given", async () => {
    const other = await testPhraseSet();
    await withRecovery({}, async (r) => {
      terminal.choices = ["It cannot"];
      const restored = await phrasesOfSets(r, { sets: [vectorSet(), other], places: PLACES }, true);
      expect(terminal.questions).toEqual([WALLET_QUESTION]);
      expect(terminal.labels[0]).toEqual(["Fingerprint", "Address", "It cannot"]);
      expect(seen.screen).toContain(severalSetsNote(2));
      if (typeof restored !== "object") throw new Error(`The sets gave ${String(restored)}.`);
      expect(await exportRestored(r, restored, OUTPUT)).toBeUndefined();
    });
    expect(seen.notices).toContain(variantsMessage(2, false));
    expect(seen.out).toContain(`Variant 1 of 2, original fingerprint ${SET_FINGERPRINT}:`);
    expect(seen.out).toContain(`Variant 2 of 2, original fingerprint ${TEST_FINGERPRINT}:`);
    const shown = seen.out.join("\n");
    for (const share of [
      ...SSKR_SET_VECTOR.shares.slice(0, 2),
      ...other.shares.map(({ ur }) => ur),
    ])
      expect(shown).toContain(share);
  });

  it("searches the sets again with the wallet given at that question, which keeps its own", async () => {
    const sets = [vectorSet(), await testPhraseSet()];
    await withRecovery({}, async (r) => {
      terminal.choices = ["Fingerprint"];
      terminal.answers = [`${TEST_FINGERPRINT}\r`];
      expect(await phrasesOfSets(r, { sets, places: PLACES }, true)).toBe("search");
      expect(r.evidence).toMatchObject({ kind: "master-fingerprint", value: TEST_FINGERPRINT });
      const again = await phrasesOfSets(r, { sets, places: PLACES }, true);
      expect(again).toMatchObject({ kind: "phrases", sets: [sets[1]] });
      expect(terminal.questions).toEqual([WALLET_QUESTION]);
    });
  });

  it("shows the sets that the fingerprint given matches alike, and says once that it is a filter", async () => {
    // Two splits of one phrase: the fingerprint of its wallet matches both sets.
    const sets = [await testPhraseSet(), await testPhraseSet()];
    await withRecovery({ "master-fingerprint": TEST_FINGERPRINT }, async (r) => {
      const restored = await phrasesOfSets(r, { sets, places: PLACES }, true);
      if (typeof restored !== "object") throw new Error(`The sets gave ${String(restored)}.`);
      expect(restored.phrases.map(({ mnemonic }) => mnemonic)).toEqual([TEST_PHRASE, TEST_PHRASE]);
      expect(await exportRestored(r, restored, OUTPUT)).toBeUndefined();
    });
    // Nothing was asked: the fingerprint was given, and an address, not it again, tells the sets.
    expect(terminal.questions).toEqual([]);
    expect(seen.notices).toContain(variantsMessage(2, true));
    expect(seen.out.filter((line) => line.startsWith("Variant "))).toHaveLength(2);
    const warned = seen.notices.filter((line) => line.includes(FINGERPRINT_WARNING));
    expect(warned).toHaveLength(1);
    expect(seen.notices.at(-1)).toContain(FINGERPRINT_WARNING);
  });
});
