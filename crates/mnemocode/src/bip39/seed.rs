//! The seed of a phrase (CAP-WALLET-BIP39-SEED): the bip39 crate's PBKDF2-HMAC-SHA512 of the
//! phrase's words and "mnemonic" with the passphrase, both NFKD, 2,048 rounds, 64 bytes. It takes a
//! checked [`Phrase`], so that unchecked text cannot reach it, and gives the seed in a locked buffer
//! that is wiped when it is dropped.

use zeroize::Zeroize;

use super::phrase::{Phrase, PhraseError};
use crate::secret::{Nfkd, SecretBytes};

/// The bytes of a seed.
pub const SEED_BYTES: usize = 64;

/// The seed of `phrase` with `passphrase`, which is normalized to NFKD here.
pub fn seed(phrase: &Phrase, passphrase: &str) -> Result<SecretBytes, PhraseError> {
    let mnemonic = phrase.mnemonic()?;
    let normalized = Nfkd::of(passphrase).text("a passphrase");
    let mut bytes = mnemonic.to_seed_normalized(&normalized);
    let seed = SecretBytes::copy_of("a seed", &bytes);
    bytes.zeroize();
    Ok(seed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_normalization::UnicodeNormalization;

    #[test]
    fn the_seed_is_bip39s_published_one() {
        let phrase = Phrase::parse("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about").unwrap();
        let bytes = seed(&phrase, "TREZOR").unwrap();
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(&hex[..32], "c55257c360c07c72029aebc1b53c05ed");
    }

    #[test]
    fn a_passphrase_that_nfkd_makes_longer_is_taken_whole() {
        let phrase = Phrase::parse("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about").unwrap();
        for long in ["\u{3300}\u{3300}", "\u{fdfa}"] {
            let decomposed: String = long.nfkd().collect();
            assert_eq!(
                *seed(&phrase, long).unwrap(),
                *seed(&phrase, &decomposed).unwrap()
            );
            assert_ne!(*seed(&phrase, long).unwrap(), *seed(&phrase, "").unwrap());
        }
    }
}
