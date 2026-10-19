// The self-test of the search of codes marked with ? (core/missing-codes-search.ts), which decode
// and the menu run on codes that cannot be read: the public phrase masked with a public date, a
// digit of two of its codes unread, found by its encoded fingerprint, by the wallet with a digit
// of the date forgotten as well, and listed where few candidates are left; and a list refused
// where the phrases of one set of codes are more than it holds (AUD-037-FUN005). It answers later,
// so core/self-test.ts runs it only in the full self-test.
//
// From the host it needs the master fingerprint of a phrase. It holds public test data, no secret.
//
// Host-neutral: it imports only core modules.

import { DatesAnswer } from "./date-search.js";
import { parseDate } from "./dates.js";
import { MissingCodes } from "./missing-codes.js";
import { MissingCodesSearch } from "./missing-codes-search.js";
import { expectRefused, expectSame } from "./self-test-check.js";
import { fingerprintWalletCheck, type PhraseFingerprint } from "./wallet-check.js";

const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** Its master fingerprint (vectors/mnemocode-v1.json, direct-12, sourceFingerprint). */
const PUBLIC_FINGERPRINT = "73c5da0a";
/**
 * The public phrase masked with MnemoCode Seedshift and 23-09-2026 as word numbers
 * (vectors/mnemocode-v1.json, checksum-valid-seedshift-12), and its encoded fingerprint, the
 * master fingerprint of the masked phrase (core/backup-reading-self-test.ts).
 */
const MASKED_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 377";
const ENCODED_FINGERPRINT = "0d05289e";
const MASKED_DATE = "23-09-2026";
/** The last digit of codes 2 and 3 unread: a hundred combinations, few of them candidates. */
const MARKED = "2027 1? 2? 2027 10 24 2027 10 24 2027 10 377";
/** The last digit of code 3 unread, and a digit of the date forgotten. */
const ONE_MARKED = "2027 10 2? 2027 10 24 2027 10 24 2027 10 377";
const FORGOTTEN_DATE = "2?-09-2026";
/**
 * Twelve words in the Original Seedshift with a valid last word, the last digit of code 4 unread:
 * each set of codes gives 128 phrases, more than a list holds.
 */
const LEGACY_VALID_MARKED = "1 1 1 1? 1 1 1 1 1 1 1 1";

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
      listed.rows.some((row) => row.codes === MASKED_NUMBERS && row.phrase === PUBLIC_MNEMONIC),
      true,
      "Marked codes listed with their phrase",
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
    /A list holds at most 16 candidates/u,
    "A list of more phrases than it holds",
  );
}
