// A master fingerprint is only a filter: every search that a fingerprint confirms says so with its
// match, as the word search does (AUD-037-SEC004). Public test phrase and dates only.

import { afterEach, describe, expect, it, vi } from "vitest";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { encodeMnemonic, formatEncoded, parseDate } from "../src/core.js";
import { DatesAnswer, DateSearch } from "../src/core/date-search.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { FINGERPRINT_WARNING, fingerprintWalletCheck } from "../src/core/wallet-check.js";
import type { RepairedSet } from "../src/sskr/joint-results.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

const DATE = "23-09-2026";
const PATTERN = "2?-09-2026";
const wallet = fingerprintWalletCheck(masterFingerprint, TEST_FINGERPRINT);
const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the warning of a fingerprint's match", () => {
  it("comes with the matches of a date search", async () => {
    using search = new DateSearch({
      indexes: masked.shiftedIndexes,
      dates: DatesAnswer.parse(PATTERN, { wordCount: 12, patterns: true }),
      mode: "seedshift",
      walletCheck: wallet,
    });
    const result = await search.run();
    expect(result.matchCount).toBe(1);
    expect(result.warning).toBe(FINGERPRINT_WARNING);
    expect(result.shown[0]?.warning).toBe(FINGERPRINT_WARNING);
  });

  it("is said after the matches that the command line shows", async () => {
    // Standard output and the notices, in the order printed.
    const said: string[] = [];
    vi.stubEnv("NO_COLOR", "1");
    for (const stream of ["log", "error"] as const)
      vi.spyOn(console, stream).mockImplementation((...line: unknown[]) => {
        said.push(line.join(" "));
      });
    await runRecoverDate({
      input: formatEncoded(masked, "indexes"),
      format: "indexes",
      mode: "seedshift",
      date: PATTERN,
      "master-fingerprint": TEST_FINGERPRINT,
    });
    const match = said.indexOf(`${DATE}\t${TEST_PHRASE}\tmatched at m`);
    expect(match).toBeGreaterThanOrEqual(0);
    expect(said.filter((line) => line === FINGERPRINT_WARNING)).toHaveLength(1);
    expect(said.indexOf(FINGERPRINT_WARNING)).toBeGreaterThan(match);
  });

  it("comes with the codes that the wallet found, with or without forgotten digits of dates", async () => {
    using direct = MissingCodes.read(`${TEST_PHRASE}|actual`, "english", "direct");
    const plain = await new MissingCodesSearch(direct, masterFingerprint).byWallet(wallet).run();
    expect(plain).toMatchObject({ kind: "found", warning: FINGERPRINT_WARNING });
    if (plain.kind === "found") plain.backup.wipe();
    const codes = formatEncoded(masked, "indexes").split(" ");
    codes[11] = "?";
    using marked = MissingCodes.read(codes.join(" "), "indexes", "seedshift");
    const dates = DatesAnswer.parse(PATTERN, { wordCount: 12, patterns: true });
    const withDates = await new MissingCodesSearch(marked, masterFingerprint)
      .byWallet(wallet, dates)
      .run();
    expect(withDates).toMatchObject({ kind: "found", warning: FINGERPRINT_WARNING });
    if (withDates.kind === "found") withDates.backup.wipe();
  });

  it("comes with the codes that the encoded fingerprint found", async () => {
    const codes = formatEncoded(masked, "indexes").split(" ");
    codes[11] = `${codes[11]!.slice(0, -1)}?`;
    using marked = MissingCodes.read(codes.join(" "), "indexes", "seedshift");
    // The fingerprint of the masked phrase, as Encode shows it ("Encoded fingerprint").
    const found = await new MissingCodesSearch(marked, masterFingerprint)
      .byEncodedFingerprint("0d05289e")
      .run();
    expect(found).toMatchObject({ kind: "found", warning: FINGERPRINT_WARNING });
    if (found.kind === "found") found.backup.wipe();
  });

  it("comes with the phrases that shares restore", async () => {
    const set: RepairedSet = { mnemonic: TEST_PHRASE, shares: [], unsettled: [] };
    const unmasked = await new ShareUnmasking({ mode: "direct", walletCheck: wallet }).unmask([
      set,
    ]);
    expect(unmasked).toMatchObject({
      kind: "phrases",
      phrases: [{ mnemonic: TEST_PHRASE, warning: FINGERPRINT_WARNING }],
    });
  });
});
