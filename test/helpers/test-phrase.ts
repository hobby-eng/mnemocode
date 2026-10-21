// The public test data of the tests, each value written once: the BIP39 test phrase and its other
// forms, its fingerprint and first address, the date that it is masked with and what that gives, a
// second public phrase and the passphrase of a candidate list. The values that the self-tests check
// the rules with too come from src/core/self-test-vectors.ts, which imports nothing; the published
// vectors in vectors/ stay the independent check of both (helpers/vectors.ts). Public test data
// only.

import {
  ENCODED_FINGERPRINT,
  MASKED_DATE,
  MASKED_ENGLISH,
  MASKED_NUMBERS,
  PUBLIC_FINGERPRINT,
  PUBLIC_MNEMONIC,
  PUBLIC_UNICODE,
} from "../../src/core/self-test-vectors.js";

/** The BIP39 test phrase "abandon … about": twelve words of zero entropy. */
export const TEST_PHRASE = PUBLIC_MNEMONIC;

/** The twelve words of TEST_PHRASE. */
export const TEST_WORDS: readonly string[] = TEST_PHRASE.split(" ");

/**
 * `phrase` with the item at each place, counted from 1, replaced by the text given for it: a "?"
 * that marks a forgotten word, "abandon|ability" that lists the candidates, a wrong word or number.
 */
export function replacedAt(phrase: string, changes: Readonly<Record<number, string>>): string {
  return phrase
    .split(" ")
    .map((item, index) => changes[index + 1] ?? item)
    .join(" ");
}

/** TEST_PHRASE with its last word forgotten: the "?" that a search for it reads. */
export const LAST_WORD_FORGOTTEN = replacedAt(TEST_PHRASE, { 12: "?" });

/** TEST_PHRASE with one "abandon" left out: the eleven words that a search for a missing word reads. */
export const ONE_WORD_MISSING = TEST_WORDS.slice(1).join(" ");

/** TEST_PHRASE as word numbers, counted from 1: abandon is 1 and about 4. */
export const TEST_NUMBERS = `${"1 ".repeat(11)}4`;

/** TEST_PHRASE as word indexes, counted from 0. */
export const TEST_INDEXES: readonly number[] = TEST_NUMBERS.split(" ").map(
  (number) => Number(number) - 1,
);

/** TEST_PHRASE as Unicode codes, from the BIP39 Chinese list. */
export const TEST_UNICODE = PUBLIC_UNICODE;

/** The BIP32 master fingerprint of TEST_PHRASE with an empty passphrase. */
export const TEST_FINGERPRINT = PUBLIC_FINGERPRINT;

/** The first native SegWit address of TEST_PHRASE, m/84'/0'/0'/0/0 (BIP84's test vectors). */
export const TEST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

/** The date, day-month-year, that the test phrase is masked with. */
export const DATE = MASKED_DATE;

/** A date other than DATE, the day after it: a wrong date for the masked phrase. */
export const WRONG_DATE = "24-09-2026";

/** TEST_PHRASE masked with MnemoCode Seedshift and DATE, as word numbers counted from 1. */
export const MASKED = MASKED_NUMBERS;

/** TEST_PHRASE masked with MnemoCode Seedshift and DATE, in English words. */
export const MASKED_WORDS = MASKED_ENGLISH;

/** TEST_PHRASE masked with MnemoCode Seedshift and DATE, as word indexes counted from 0. */
export const MASKED_INDEXES: readonly number[] = MASKED.split(" ").map(
  (number) => Number(number) - 1,
);

/**
 * MASKED with the last digit of its third code forgotten: of the ten codes that it may be, one
 * keeps the checksum.
 */
export const MASKED_ONE_DIGIT_FORGOTTEN = replacedAt(MASKED, { 3: "2?" });

/**
 * MASKED with the last digit of its second and third codes forgotten: 10 and 24 become 1? and 2?,
 * a hundred combinations of which a few keep the checksum, few enough to list.
 */
export const MASKED_TWO_DIGITS_FORGOTTEN = replacedAt(MASKED, { 2: "1?", 3: "2?" });

/**
 * TEST_PHRASE masked with the Original Seedshift and DATE in its checksum-valid form
 * (seedshift-legacy-valid), as word numbers: the public fixture of scripts/terminal_answers.py.
 */
export const LEGACY_VALID_MASKED = "2027 10 24 2027 10 24 2027 10 24 2027 10 23";

/** The master fingerprint of MASKED_WORDS: the encoded fingerprint that Encode shows. */
export { ENCODED_FINGERPRINT };

/** A second public BIP39 phrase, the second vector of BIP39 (entropy 7f7f…7f). */
export const OTHER_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

/** The public passphrase that the tests encrypt a list of candidate phrases with. */
export const LIST_PASSPHRASE = "public candidate test passphrase";
