// The public data that the self-tests check the rules with, each written once: the phrase of
// all-zero entropy, the first BIP39 vector, its master fingerprint, and its Seedshift vector
// (vectors/mnemocode-v1.json: direct-12 and checksum-valid-seedshift-12). Each self-test, beside
// the feature it checks, takes them here; a host builds in only the self-tests it wants.
// Host-neutral: it imports nothing.

/** The public test phrase of all-zero entropy, the first BIP39 vector. */
export const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** Its master fingerprint without a passphrase (direct-12, sourceFingerprint). */
export const PUBLIC_FINGERPRINT = "73c5da0a";
/** The date, day-month-year, that the Seedshift vector masks the public phrase with. */
export const MASKED_DATE = "23-09-2026";
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
