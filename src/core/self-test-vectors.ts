// The public data that the self-tests check the rules with, each written once: the phrase of
// all-zero entropy, the first BIP39 vector, its master fingerprint, its Unicode codes, and its
// Seedshift vector (vectors/mnemocode-v1.json: direct-12 and checksum-valid-seedshift-12); the
// phrase of 24 words of all-zero entropy; and the dates of the Seedshift vectors of 15 to 24
// words. Each self-test, beside the feature it checks, takes them here; a host builds in only the
// self-tests it wants.
// Host-neutral: it imports nothing.

/** The public test phrase of all-zero entropy, the first BIP39 vector. */
export const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** The public test phrase of 24 words of all-zero entropy, a published BIP39 vector too. */
export const PUBLIC_MNEMONIC_24 = `${"abandon ".repeat(23)}art`;
/** Its master fingerprint without a passphrase (direct-12, sourceFingerprint). */
export const PUBLIC_FINGERPRINT = "73c5da0a";
/**
 * The Unicode codes of its words, from the published BIP39 Chinese list (bitcoin/bips
 * bip-0039/chinese_simplified.txt): word 1, abandon, is 的 (U+7684), word 4, about, is 在 (U+5728).
 */
export const PUBLIC_UNICODE_CODES: readonly string[] = [...Array<string>(11).fill("7684"), "5728"];
/** The public phrase as Unicode codes, written joined as Encode writes them. */
export const PUBLIC_UNICODE = PUBLIC_UNICODE_CODES.join("");
/** The date, day-month-year, that the Seedshift vector masks the public phrase with. */
export const MASKED_DATE = "23-09-2026";
/**
 * The three dates, day-month-year, that the Seedshift vectors of 15 to 24 words mask their phrases
 * with (checksum-valid-seedshift-15 to -24), in their order there: MASKED_DATE is the last.
 */
export const SEEDSHIFT_DATES: readonly string[] = Object.freeze([
  "07-11-1951",
  "08-08-1988",
  MASKED_DATE,
]);
/** The public phrase masked with MnemoCode Seedshift and MASKED_DATE, in English words. */
export const MASKED_ENGLISH =
  "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
/** The masked phrase in word numbers, counted from 1, as Encode writes them and a search finds. */
export const MASKED_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 377";
/**
 * The master fingerprint of the masked phrase, the encoded fingerprint that Encode shows: computed
 * independently with Python's hashlib and a plain secp256k1, which first reproduce the published
 * keys of BIP84 and BIP86.
 */
export const ENCODED_FINGERPRINT = "0d05289e";
