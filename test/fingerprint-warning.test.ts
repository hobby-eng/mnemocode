// A master fingerprint is only a filter: every search that a fingerprint confirms says so with its
// match, as the word search does (AUD-037-SEC004). Public test phrase and dates only.

import { afterEach, describe, expect, it, vi } from "vitest";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { dateMatchNotes } from "../src/cli/date-search.js";
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

  it("is said after the matches that the command line shows", () => {
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => said.push(line));
    dateMatchNotes(
      { kind: "master-fingerprint", value: TEST_FINGERPRINT, network: "mainnet" },
      FINGERPRINT_WARNING,
    );
    expect(said).toContain(FINGERPRINT_WARNING);
  });

  it("comes with the codes that the wallet found, with or without forgotten digits of dates", async () => {
    using direct = MissingCodes.read(`${"abandon ".repeat(11)}about|actual`, "english", "direct");
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
