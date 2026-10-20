// The self-test of the search of codes marked with ? (core/missing-codes-search.ts), which decode
// and the menu run on codes that cannot be read: the public phrase masked with a public date, a
// digit of two of its codes unread, found by its encoded fingerprint, by the wallet with a digit
// of the date forgotten as well, and listed, every candidate left with its phrase and fingerprint;
// and a list refused where the phrases of one set of codes are more than it holds
// (AUD-037-FUN005). It answers later, so core/self-test.ts runs it only in the full self-test.
//
// From the host it needs the master fingerprint of a phrase. It holds public test data, no secret.
//
// Host-neutral: it imports only core modules.

import { DatesAnswer } from "./date-search.js";
import { parseDate } from "./dates.js";
import { MissingCodes } from "./missing-codes.js";
import { MissingCodesSearch, type MissingCodesRow } from "./missing-codes-search.js";
import { expectRefused, expectSame } from "./self-test-check.js";
import { fingerprintWalletCheck, type PhraseFingerprint } from "./wallet-check.js";
import {
  ENCODED_FINGERPRINT,
  MASKED_DATE,
  MASKED_NUMBERS,
  PUBLIC_FINGERPRINT,
  PUBLIC_MNEMONIC,
} from "./self-test-vectors.js";

/** The last digit of codes 2 and 3 unread: a hundred combinations, few of them candidates. */
const MARKED = "2027 1? 2? 2027 10 24 2027 10 24 2027 10 377";
/**
 * Every candidate of MARKED with MASKED_DATE, in the order of the codes: those that keep the
 * BIP39 checksum, each with the phrase that the date unmasks and its master fingerprint. Computed
 * independently with Python's hashlib, the inverse of docs/SEEDSHIFT_CONSTRUCTION.md and a plain
 * secp256k1, which first reproduce PUBLIC_FINGERPRINT.
 */
const LISTED: readonly MissingCodesRow[] = [
  { codes: MASKED_NUMBERS, phrase: PUBLIC_MNEMONIC, fingerprint: PUBLIC_FINGERPRINT },
  {
    codes: "2027 11 22 2027 10 24 2027 10 24 2027 10 377",
    phrase:
      "abandon ability zone abandon abandon abandon abandon abandon abandon abandon abandon account",
    fingerprint: "1822ff36",
  },
  {
    codes: "2027 11 25 2027 10 24 2027 10 24 2027 10 377",
    phrase:
      "abandon ability ability abandon abandon abandon abandon abandon abandon abandon abandon absorb",
    fingerprint: "388b80e6",
  },
  {
    codes: "2027 14 24 2027 10 24 2027 10 24 2027 10 377",
    phrase:
      "abandon above abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    fingerprint: "04681bb7",
  },
  {
    codes: "2027 17 26 2027 10 24 2027 10 24 2027 10 377",
    phrase:
      "abandon abstract able abandon abandon abandon abandon abandon abandon abandon abandon accident",
    fingerprint: "dc9764be",
  },
];
/** The last digit of code 3 unread, and a digit of the date forgotten. */
const ONE_MARKED = "2027 10 2? 2027 10 24 2027 10 24 2027 10 377";
const FORGOTTEN_DATE = "2?-09-2026";
/**
 * Twelve words in the Original Seedshift with a valid last word, the last digit of code 4 unread:
 * each set of codes gives 128 phrases, more than a list holds.
 */
const LEGACY_VALID_MARKED = "1 1 1 1? 1 1 1 1 1 1 1 1";

/** A row of a list as one line of text, so that two lists compare exactly. */
function rowText(row: MissingCodesRow): string {
  return `${row.codes} | ${row.phrase} | ${row.fingerprint}`;
}

/** The ways of the search of codes marked with ?, each with its known answer, and a refusal. */
export async function checkMissingCodesSearch(fingerprint: PhraseFingerprint): Promise<void> {
  using codes = MissingCodes.read(MARKED, "indexes", "seedshift");
  const search = new MissingCodesSearch(codes, fingerprint);
  const byEncoded = await search.byEncodedFingerprint(ENCODED_FINGERPRINT).run();
  expectSame(byEncoded.kind, "found", "Marked codes by the encoded fingerprint");
  if (byEncoded.kind === "found") {
    using backup = byEncoded.backup;
    expectSame(backup.text(), MASKED_NUMBERS, "Marked codes found by the encoded fingerprint");
  }
  const listed = await search.listed([parseDate(MASKED_DATE)]).run();
  expectSame(listed.kind, "list", "Marked codes listed");
  if (listed.kind === "list")
    expectSame(
      listed.rows.map(rowText).join("\n"),
      LISTED.map(rowText).join("\n"),
      "Marked codes listed: rows",
    );
  using oneCode = MissingCodes.read(ONE_MARKED, "indexes", "seedshift");
  using dates = DatesAnswer.parse(FORGOTTEN_DATE, { wordCount: 12, patterns: true });
  const wallet = fingerprintWalletCheck(fingerprint, PUBLIC_FINGERPRINT);
  const byWallet = await new MissingCodesSearch(oneCode, fingerprint).byWallet(wallet, dates).run();
  expectSame(byWallet.kind, "found", "Marked codes and a date by the wallet");
  if (byWallet.kind === "found") {
    using backup = byWallet.backup;
    expectSame(backup.text(), MASKED_NUMBERS, "Marked codes found by the wallet");
    expectSame(byWallet.foundDates, MASKED_DATE, "Date found with the marked codes");
  }
  using legacyCodes = MissingCodes.read(LEGACY_VALID_MARKED, "indexes", "seedshift-legacy-valid");
  const tooMany = new MissingCodesSearch(legacyCodes, fingerprint);
  expectRefused(
    () => tooMany.listed([parseDate(MASKED_DATE)]),
    /A list holds at most 16 phrases/u,
    "A list of more phrases than it holds",
  );
}
