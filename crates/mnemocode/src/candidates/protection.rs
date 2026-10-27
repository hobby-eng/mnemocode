//! How a candidate list is protected (MnemoCode TS 0.1.0's `ListProtection`, `parseListPassphrase`
//! and `protectionFor` in `core/candidate-encryption.ts`, CAP-RECOVERY-CANDIDATE-PROTECTION-CHOICE):
//! to the Scanner's key, under a passphrase, or, only on the person's explicit request, not at all;
//! chosen once, then every list is saved the same way. The recipient and the passphrase are trimmed
//! by the one rule (`text::space::trim`, owner, 2026-10-27). TS's check of a host's choice object
//! goes: the choice is a closed enum here, and the binding reads a JavaScript one.

use super::admission::check_plaintext_size;
use super::age::{EncryptionError, Recipient, To};
use super::gate::Gate;
use crate::random::Random;
use crate::secret::{SecretBytes, SecretText};
use crate::text::space::{trim, without_byte_order_mark};

/// The fewest characters, counted as Unicode scalar values, that a list's passphrase may have: it
/// is all that protects the seed phrases.
pub const MIN_LIST_PASSPHRASE_LENGTH: usize = 12;

/// The passphrase of a list as docs/CANDIDATES.md defines it: the text as entered, without white
/// space at its ends and, from a file, without a byte order mark, in a locked buffer; refused when
/// shorter than [`MIN_LIST_PASSPHRASE_LENGTH`] characters.
pub fn parse_list_passphrase(text: &str) -> Result<SecretText, EncryptionError> {
    let passphrase = trim(without_byte_order_mark(text));
    if passphrase.chars().count() < MIN_LIST_PASSPHRASE_LENGTH {
        return Err(EncryptionError::PassphraseTooShort(
            MIN_LIST_PASSPHRASE_LENGTH,
        ));
    }
    Ok(SecretText::copy_of("a list's passphrase", passphrase))
}

/// How a list is protected.
#[derive(Debug)]
pub enum Protection {
    /// Encrypted to the Discovery Scanner's one-time key.
    Key(Recipient),
    /// Encrypted under a passphrase through scrypt.
    Passphrase(SecretText),
    /// Not encrypted: the seed phrases in the open, only on the person's explicit request.
    None,
}

impl Protection {
    /// To the Scanner's key, as typed, pasted or read; refused for any text that is no age key.
    pub fn key(text: &str) -> Result<Self, EncryptionError> {
        Recipient::parse(text).map(Self::Key)
    }

    /// The protection that `kind` names, as a page or a front end gives it: "key" to the Scanner's
    /// key in `secret`, "passphrase" under the passphrase in `secret`, "none" in the open; refused
    /// for any other kind, and as the key and the passphrase are refused.
    pub fn chosen(kind: &str, secret: &str) -> Result<Self, EncryptionError> {
        match kind {
            "key" => Self::key(secret),
            "passphrase" => Self::passphrase(secret),
            "none" => Ok(Self::None),
            _ => Err(EncryptionError::ProtectionChoice),
        }
    }

    /// Under the passphrase `text`, read by [`parse_list_passphrase`].
    pub fn passphrase(text: &str) -> Result<Self, EncryptionError> {
        parse_list_passphrase(text).map(Self::Passphrase)
    }

    /// Whether the file is encrypted; one that is not holds seed phrases in the open.
    pub const fn encrypted(&self) -> bool {
        !matches!(self, Self::None)
    }

    /// How the saved file is protected, as the line that reports a save says it.
    pub const fn description(&self) -> &'static str {
        match self {
            Self::Key(_) => "encrypted to the Scanner's key",
            Self::Passphrase(_) => "encrypted with the passphrase",
            Self::None => "NOT encrypted",
        }
    }

    /// The file of `list`: encrypted through `gate` with the host's randomness, or the list itself
    /// in a locked buffer of its own; refused for a list over the size limit, a closed gate, and
    /// what the encryption refuses.
    pub fn protect(
        &self,
        list: &[u8],
        gate: &mut Gate,
        random: &mut dyn Random,
    ) -> Result<SecretBytes, EncryptionError> {
        match self {
            Self::Key(recipient) => gate.encrypt(list, To::Recipient(recipient), random),
            Self::Passphrase(passphrase) => {
                gate.encrypt(list, To::Passphrase(passphrase.as_str()), random)
            }
            Self::None => {
                check_plaintext_size(list.len())?;
                Ok(SecretBytes::copy_of("a candidate list", list))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::NoRandomness;
    use crate::refusal::Refusal;

    #[test]
    fn a_list_passphrase_is_trimmed_and_counted_in_characters() {
        let passphrase = parse_list_passphrase("\u{feff}\u{85} ünïcödé pass \u{3000}").unwrap();
        assert_eq!(passphrase.as_str(), "ünïcödé pass");
        let refusal = parse_list_passphrase("  ünïcödé 11 ").unwrap_err();
        assert_eq!(refusal, EncryptionError::PassphraseTooShort(12));
        assert_eq!(
            refusal.code(),
            "core.candidate-encryption.use-at-least-characters-passphrase-all-protects-seed"
        );
        assert_eq!(
            refusal.to_string(),
            "The passphrase for the candidates is too short: use at least 12 characters, since it is all that protects these seed phrases."
        );
    }

    #[test]
    fn each_protection_says_how_the_file_is_kept() {
        let key =
            Protection::key(" age1fdc6vcx5w70ah6qtmyctutym56y4fhw82dhvjxyjqyqxea2g34hsvnn808\n")
                .unwrap();
        assert!(key.encrypted());
        assert_eq!(key.description(), "encrypted to the Scanner's key");
        assert_eq!(
            Protection::passphrase("long enough passphrase").map(|chosen| chosen.description()),
            Ok("encrypted with the passphrase")
        );
        assert!(!Protection::None.encrypted());
        assert!(matches!(
            Protection::chosen("none", ""),
            Ok(Protection::None)
        ));
        let refusal = Protection::chosen("open", "").unwrap_err();
        assert_eq!(
            refusal.code(),
            "core.candidate-encryption.not-protection-choice"
        );
        assert_eq!(refusal.kind(), crate::refusal::RefusalKind::Type);
        assert_eq!(Protection::None.description(), "NOT encrypted");
        assert_eq!(
            Protection::key("age1").map(|chosen| chosen.encrypted()),
            Err(EncryptionError::Recipient)
        );
        let mut gate = Gate::new();
        let open = Protection::None
            .protect(&[1, 2, 3], &mut gate, &mut NoRandomness)
            .unwrap();
        assert_eq!(*open, [1, 2, 3]);
    }
}
