// The public test data of the tests, each value written once: the BIP39 test phrase and its other
// forms, its fingerprint, first address and first key, the date that it is masked with and what
// that gives, other public phrases (the zero-entropy phrases of every length and the Original
// Seedshift's example) and the passphrase of a candidate list; helpers/coin-addresses.ts holds the
// phrase's other addresses. The values that the self-tests check the rules with too come from
// src/core/self-test-vectors.ts, which imports nothing; the published vectors in vectors/ stay the
// independent check of both (helpers/vectors.ts). Public test data only.

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

/** TEST_ADDRESS with a changed checksum character, its last: an address that no coin reads. */
export const DAMAGED_ADDRESS = `${TEST_ADDRESS.slice(0, -1)}v`;

/** The private key of TEST_ADDRESS, m/84'/0'/0'/0/0, as a WIF (BIP84's test vectors). */
export const TEST_WIF = "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d";

/** The compressed public key of TEST_ADDRESS, m/84'/0'/0'/0/0, in hex (BIP84's test vectors). */
export const TEST_PUBLIC_KEY = "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c";

/** The record of TEST_PHRASE without masking, as word numbers (format indexes). */
export const TEST_RECORD = `MNC1:direct:indexes:${TEST_NUMBERS}`;

/** The date, day-month-year, that the test phrase is masked with. */
export const DATE = MASKED_DATE;

/** DATE with its last digit forgotten, marked "?" as a person types it. */
export const DATE_LAST_DIGIT_FORGOTTEN = `${DATE.slice(0, -1)}?`;

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

/**
 * The BIP39 phrases of zero entropy of each length, by their word count: "abandon" and a last word
 * that carries the checksum. Those of 12, 18 and 24 words are vectors of BIP39's reference
 * implementation (trezor/python-mnemonic); those of 15 and 21 follow the same rule.
 */
export const ZERO_ENTROPY_PHRASES = Object.freeze({
  12: TEST_PHRASE,
  15: `${"abandon ".repeat(14)}address`,
  18: `${"abandon ".repeat(17)}agent`,
  21: `${"abandon ".repeat(20)}admit`,
  24: `${"abandon ".repeat(23)}art`,
});

/** The phrase of 24 words of zero entropy with its last word forgotten, marked "?". */
export const LAST_OF_24_FORGOTTEN = replacedAt(ZERO_ENTROPY_PHRASES[24], { 24: "?" });

/** The public phrase of the Original Seedshift's documented example. */
export const LEGACY_EXAMPLE =
  "oppose duck hello neglect reveal key humor mosquito road evoke flock hedgehog";

/** The dates, day-month-year, that the example masks LEGACY_EXAMPLE with. */
export const LEGACY_EXAMPLE_DATES: readonly string[] = ["10-07-1963", "27-04-1956", "31-01-1994"];

/**
 * LEGACY_EXAMPLE masked by the Original Seedshift with LEGACY_EXAMPLE_DATES: twelve words whose last
 * keeps no BIP39 checksum.
 */
export const LEGACY_EXAMPLE_MASKED =
  "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";

/** The public passphrase that the tests encrypt a list of candidate phrases with. */
export const LIST_PASSPHRASE = "public candidate test passphrase";
