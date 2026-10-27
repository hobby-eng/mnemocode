//! The public data the self-checks check the rules with, each written once (TS
//! `src/core/self-test-vectors.ts`): the phrase of all-zero entropy, the first BIP39 vector, its
//! master fingerprint, its Unicode codes, its Seedshift vector (vectors/mnemocode-v1.json: direct-12
//! and checksum-valid-seedshift-12), the 24-word phrase of all-zero entropy, the dates of the
//! Seedshift vectors of 15 to 24 words, and the candidate list of three phrases
//! (vectors/candidates-v1.json).

/// The public test phrase of all-zero entropy, the first BIP39 vector.
pub const PUBLIC_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/// The public test phrase of 24 words of all-zero entropy, a published BIP39 vector too.
pub const PUBLIC_MNEMONIC_24: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
/// Its master fingerprint without a passphrase (direct-12, sourceFingerprint).
pub const PUBLIC_FINGERPRINT: &str = "73c5da0a";
/// The Unicode codes of its words, from the published BIP39 Chinese list: word 1, abandon, is
/// U+7684, word 4, about, is U+5728.
pub const PUBLIC_UNICODE_CODES: [&str; 12] = [
    "7684", "7684", "7684", "7684", "7684", "7684", "7684", "7684", "7684", "7684", "7684", "5728",
];
/// The public phrase as Unicode codes, written joined as Encode writes them.
pub const PUBLIC_UNICODE: &str = "768476847684768476847684768476847684768476845728";
/// The date, day-month-year, that the Seedshift vector masks the public phrase with.
pub const MASKED_DATE: &str = "23-09-2026";
/// The three dates, day-month-year, that the Seedshift vectors of 15 to 24 words mask their phrases
/// with, in their order there: [`MASKED_DATE`] is the last.
pub const SEEDSHIFT_DATES: [&str; 3] = ["07-11-1951", "08-08-1988", MASKED_DATE];
/// The public phrase masked with MnemoCode Seedshift and [`MASKED_DATE`], in English words.
pub const MASKED_ENGLISH: &str =
    "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
/// The masked phrase in word numbers, counted from 1, as Encode writes them and a search finds.
pub const MASKED_NUMBERS: &str = "2027 10 24 2027 10 24 2027 10 24 2027 10 377";
/// The master fingerprint of the masked phrase, the encoded fingerprint that Encode shows, computed
/// independently with Python's hashlib and a plain secp256k1 that first reproduce BIP84 and BIP86.
pub const ENCODED_FINGERPRINT: &str = "0d05289e";

/// vectors/candidates-v1.json, "three phrases": the entropy of the public phrases of BIP39's first,
/// second and fourth vectors.
pub const THREE_PHRASES_ENTROPY: [&str; 3] = [
    "00000000000000000000000000000000",
    "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
    "ffffffffffffffffffffffffffffffff",
];
/// Their list without passphrases, in hexadecimal: the known answer of the writer and the reader,
/// and the plaintext of the published age files.
pub const THREE_PHRASES_LIST: &str = "4d4e434c01001000000003000000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7fffffffffffffffffffffffffffffffff98854aa000";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_joined_codes_are_the_codes_of_the_words() {
        assert_eq!(PUBLIC_UNICODE_CODES.concat(), PUBLIC_UNICODE);
        assert_eq!(PUBLIC_MNEMONIC.split(' ').count(), 12);
        assert_eq!(PUBLIC_MNEMONIC_24.split(' ').count(), 24);
        assert_eq!(MASKED_NUMBERS.split(' ').count(), 12);
    }
}
