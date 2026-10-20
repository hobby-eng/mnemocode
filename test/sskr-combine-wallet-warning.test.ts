// sskr-combine and sskr-export with a wallet: what the wallet check said of the phrases it matched,
// such as that a master fingerprint is only a filter, is said once, after the phrases, the shares
// saved or the sets shown (AUD-037-SEC004), from the options with plain output and on the private
// screen, with the terminal replaced (test/helpers/question-terminal.ts). Public test data only:
// the shares of vectors/sskr-v1.json ("bip39-128-2-of-3") and the "abandon … about" phrase, also
// masked with a public date.

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArguments } from "../src/cli/arguments.js";
import { runSskrCombine } from "../src/cli/sskr-command.js";
import { runSskrExport } from "../src/cli/sskr-export-command.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { FINGERPRINT_WARNING } from "../src/core/wallet-check.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { unrepairedShare } from "../src/sskr/repair.js";
import { ShareRestore, variantsMessage } from "../src/sskr/share-restore.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { markUnits } from "./helpers/shares.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);
const collision = vi.hoisted(() => ({ on: false }));
vi.mock("../src/bitcoin-evidence.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bitcoin-evidence.js")>();
  return {
    ...actual,
    // With `collision.on`, a wallet that every phrase matches, as a fingerprint of 32 bits lets
    // several phrases do; each match keeps what the real check says of it.
    walletCheckOf: (...given: Parameters<typeof actual.walletCheckOf>) => {
      const check = actual.walletCheckOf(...given);
      if (!collision.on || check === undefined) return check;
      return Object.assign((mnemonic: string) => ({ ...check(mnemonic), matched: true }), {
        wipe: check.wipe,
        [Symbol.dispose]: check.wipe,
      });
    },
  };
});

/**
 * The master fingerprint and the first receiving BIP84 address (m/84'/0'/0'/0/0) of the phrase of
 * sskrSetVector, computed with an independent Python implementation of BIP39, BIP32 and BIP84
 * that first reproduces the published BIP84 vector of "abandon … about".
 */
const SET_FINGERPRINT = "05d027a5";
const SET_ADDRESS = "bc1qdsdxmlnu5phmwaw9fy88vm57n552l9ztcg4rev";

/** Each line of standard output and of the notices, in the order printed. */
let printed: { readonly out: boolean; readonly line: string }[];
let directory: string;

questionsOnPrivateScreen();

beforeEach(async () => {
  printed = [];
  directory = await mkdtemp(join(tmpdir(), "mnemocode-wallet-warning-"));
  // Kept as the harness keeps them (seen), and in one order too.
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    seen.out.push(parts.join(" "));
    printed.push({ out: true, line: parts.join(" ") });
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    seen.notices.push(parts.join(" "));
    printed.push({ out: false, line: parts.join(" ") });
  });
});

afterEach(async () => {
  collision.on = false;
  await rm(directory, { recursive: true, force: true });
});

/** Runs sskr-combine from the options, with `shares` in a share file. */
async function combine(shares: readonly string[], options: ParsedArguments): Promise<void> {
  terminal.privateScreen = false;
  const path = join(directory, "shares.txt");
  await writeFile(path, `${shares.join("\n")}\n`);
  await runSskrCombine({ "share-file": path, ...options });
}

/** Where each notice of the warning of a fingerprint's match was printed, among all lines. */
function warningPlaces(): number[] {
  return printed.flatMap(({ out, line }, place) =>
    !out && line.includes(FINGERPRINT_WARNING) ? [place] : [],
  );
}

/** Where each seed phrase of twelve words was printed on standard output, among all lines. */
function phrasePlaces(): number[] {
  return printed.flatMap(({ out, line }, place) =>
    out && /^(?:[a-z]+ ){11}[a-z]+$/u.test(line) ? [place] : [],
  );
}

describe("sskr-combine with a wallet", () => {
  it("says once, after the phrase, that the fingerprint that matched it is only a filter", async () => {
    await combine(sskrSetVector.shares, { "master-fingerprint": SET_FINGERPRINT });
    expect(seen.out).toContain(sskrSetVector.phrase);
    expect(warningPlaces()).toHaveLength(1);
    expect(warningPlaces()[0]).toBeGreaterThan(Math.max(...phrasePlaces()));
  });

  it("says nothing of a filter where an address matched", async () => {
    await combine(sskrSetVector.shares, { "bitcoin-address": SET_ADDRESS });
    expect(seen.out).toContain(sskrSetVector.phrase);
    expect(warningPlaces()).toEqual([]);
  });

  it("says it once, after all the phrases that a fingerprint matched", async () => {
    const masked = encodeMnemonic(TEST_PHRASE, [parseDate("23-09-2026")]).shiftedEnglish.join(" ");
    const shares = await splitSskrMnemonic(masked, 2, 3);
    collision.on = true;
    // Every date of the search gives a phrase that the fingerprint matches, each on a screen of
    // its own, the next on Enter.
    terminal.answers = [
      `${shares[0]};${shares[1]}\r`,
      "2?-09-2026\r",
      `${TEST_FINGERPRINT}\r`,
      ...Array.from({ length: 10 }, () => "\r"),
    ];
    terminal.choices = ["fingerprint"];
    await runSskrCombine({ "ask-secrets": true, mode: "seedshift" });
    expect(phrasePlaces().length).toBeGreaterThan(1);
    expect(warningPlaces()).toHaveLength(1);
    expect(warningPlaces()[0]).toBeGreaterThan(Math.max(...phrasePlaces()));
  });
});

describe("sskr-export with a wallet", () => {
  /** Exports `shares` from a share file to a file of their own, with `options`. */
  async function exportShares(
    options: ParsedArguments,
    shares: readonly string[] = sskrSetVector.shares,
  ): Promise<string> {
    terminal.privateScreen = false;
    const path = join(directory, "shares.txt");
    const output = join(directory, "exported.txt");
    await writeFile(path, `${shares.join("\n")}\n`);
    await runSskrExport({ "share-file": path, output, ...options });
    return output;
  }

  it("says once, after the shares are saved, that the fingerprint that chose them is a filter", async () => {
    const output = await exportShares({ "master-fingerprint": SET_FINGERPRINT });
    expect((await readFile(output, "utf8")).trim().split("\n")).toHaveLength(
      sskrSetVector.shares.length,
    );
    expect(warningPlaces()).toHaveLength(1);
    expect(warningPlaces()[0]).toBe(printed.length - 1);
  });

  it("says nothing of a filter where an address chose them", async () => {
    await exportShares({ "bitcoin-address": SET_ADDRESS });
    expect(warningPlaces()).toEqual([]);
  });

  it("says once, after the sets that a fingerprint matched alike, that it is a filter", async () => {
    // A second set beside the one that the repair of the marked share finds: public shares of the
    // test phrase. No two sets of real shares pass both the CRC-32 and the digest, so the step is
    // given a second, which the fingerprint matches too, as 32 bits let a wrong set do.
    const others = (await splitSskrMnemonic(TEST_PHRASE, 2, 3)).slice(0, 2);
    const other = { mnemonic: TEST_PHRASE, shares: others.map(unrepairedShare), unsettled: [] };
    const phrases = ShareRestore.phrases.bind(ShareRestore);
    vi.spyOn(ShareRestore, "phrases").mockImplementation(async (unmasking, sets, places, run) =>
      phrases(unmasking, [...sets, other], places, run),
    );
    collision.on = true;
    const [first, second] = sskrSetVector.shares;
    const output = await exportShares({ "master-fingerprint": SET_FINGERPRINT }, [
      String(first),
      markUnits(String(second), "colors", [5]),
    ]);
    expect(existsSync(output)).toBe(false);
    // The fingerprint was given: the sets are told apart by an address, not by it again.
    expect(seen.notices).toContain(variantsMessage(2, true));
    expect(seen.notices).not.toContain(variantsMessage(2, false));
    expect(seen.out.filter((line) => line.startsWith("Variant "))).toHaveLength(2);
    expect(warningPlaces()).toHaveLength(1);
    expect(warningPlaces()[0]).toBe(printed.length - 1);
  });
});
