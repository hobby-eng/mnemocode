//! The writing of a candidate list (MnemoCode TS 0.1.0's `core/candidate-list-writer.ts`,
//! CAP-RECOVERY-CANDIDATE-LIST-WRITER): the phrases of a search as their BIP39 entropy in their
//! order, in one owner reserved at the list's exact size from the count (ADR 0003), with one BIP39
//! passphrase for all, encoded ([`super::format`]) and protected as the person chose
//! ([`super::protection`]). No list is written for no candidate, or for more than one list holds.
//! The phrases are the library's own [`Phrase`] values, checked when they were made, so TS's
//! checks of a host's phrase texts go (CORE-54).

use std::fmt;

use super::age::EncryptionError;
use super::format::{CandidateList, ListError, MAX_CANDIDATE_RECORDS, checked_passphrase};
use super::gate::Gate;
use super::protection::Protection;
use crate::bip39::phrase::{Phrase, PhraseError};
use crate::bip39::sizes::entropy_bytes;
use crate::random::Random;
use crate::refusal::Refusal;
use crate::secret::{SecretBytes, SecretText, equal_bytes};

/// What a host says when a list was asked for but no candidate went into it.
pub const NO_CANDIDATE_TO_SAVE: &str = "No candidate to save, so no list was written.";

/// A candidate list ready to be saved.
#[derive(Debug)]
pub struct ListFile {
    /// The file's bytes; without encryption every candidate's entropy in the open.
    pub bytes: SecretBytes,
    /// How it is protected, in the words of its protection.
    pub description: &'static str,
    /// Whether the bytes are encrypted; false only when the person asked for a list in the open.
    pub encrypted: bool,
    /// The records it holds.
    pub records: usize,
}

/// What became of a list: written, or why none was.
#[derive(Debug)]
pub enum ListOutcome {
    /// Written: the list is ready to be saved.
    List(ListFile),
    /// More candidates than one list holds: no list is written.
    Full,
    /// No candidate went into it: no list is written.
    Empty,
}

/// Why a list was not written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteError {
    /// The list refused its candidates or passphrase.
    List(ListError),
    /// The protection refused.
    Encryption(EncryptionError),
    /// A phrase gave no entropy.
    Phrase(PhraseError),
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::List(error) => error.fmt(f),
            Self::Encryption(error) => error.fmt(f),
            Self::Phrase(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for WriteError {}

impl Refusal for WriteError {
    fn code(&self) -> &'static str {
        match self {
            Self::List(error) => error.code(),
            Self::Encryption(error) => error.code(),
            Self::Phrase(error) => error.code(),
        }
    }
}

impl From<ListError> for WriteError {
    fn from(error: ListError) -> Self {
        Self::List(error)
    }
}

impl From<EncryptionError> for WriteError {
    fn from(error: EncryptionError) -> Self {
        Self::Encryption(error)
    }
}

impl From<PhraseError> for WriteError {
    fn from(error: PhraseError) -> Self {
        Self::Phrase(error)
    }
}

/// Writes candidate lists with one protection and one BIP39 passphrase, both settled before the
/// search, so that a passphrase no list can take is refused at once instead of after it.
#[derive(Debug)]
pub struct Writer {
    protection: Protection,
    passphrase: Option<SecretText>,
}

impl Writer {
    /// A writer protecting each list with `protection` and storing `passphrase`, the BIP39
    /// passphrase of every record ("" stores none); refused for one longer than a list holds.
    pub fn new(protection: Protection, passphrase: &str) -> Result<Self, ListError> {
        // The label says that the limit is the list's: BIP39 itself takes a longer passphrase.
        let passphrase =
            checked_passphrase(Some(passphrase), "BIP39 passphrase that the list stores")?;
        Ok(Self {
            protection,
            passphrase,
        })
    }

    /// The same protection storing `passphrase` instead, refused as [`Writer::new`] refuses it.
    pub fn with_passphrase(self, passphrase: &str) -> Result<Self, ListError> {
        Self::new(self.protection, passphrase)
    }

    /// Whether it stores `passphrase`; it never gives its own out.
    pub fn uses_passphrase(&self, passphrase: &str) -> bool {
        let own = self.passphrase.as_ref().map_or("", SecretText::as_str);
        equal_bytes(own.as_bytes(), passphrase.as_bytes())
    }

    /// The list of `entropies`, each `entropy_length` bytes, record N for candidate N: protected
    /// through `gate` with the host's randomness; refused as the list and the protection refuse.
    pub fn write(
        &self,
        entropies: SecretBytes,
        entropy_length: usize,
        gate: &mut Gate,
        random: &mut dyn Random,
    ) -> Result<ListOutcome, WriteError> {
        let count = entropies.len().checked_div(entropy_length).unwrap_or(0);
        if count > MAX_CANDIDATE_RECORDS {
            return Ok(ListOutcome::Full);
        }
        if entropies.is_empty() {
            return Ok(ListOutcome::Empty);
        }
        let passphrase = self.passphrase.as_ref().map(SecretText::as_str);
        let list = CandidateList::new(entropies, entropy_length, passphrase, &[])?;
        let bytes = self.protection.protect(&list.encode(), gate, random)?;
        Ok(ListOutcome::List(ListFile {
            bytes,
            description: self.protection.description(),
            encrypted: self.protection.encrypted(),
            records: list.count(),
        }))
    }

    /// The list of `phrases` in their order, as [`Writer::write`] makes it; too many are told
    /// before any phrase is turned into entropy, and phrases of more than one length are refused.
    pub fn write_phrases(
        &self,
        phrases: &[Phrase],
        gate: &mut Gate,
        random: &mut dyn Random,
    ) -> Result<ListOutcome, WriteError> {
        if phrases.len() > MAX_CANDIDATE_RECORDS {
            return Ok(ListOutcome::Full);
        }
        if phrases.is_empty() {
            return Ok(ListOutcome::Empty);
        }
        let (entropies, length) = entropies_of(phrases)?;
        self.write(entropies, length, gate, random)
    }
}

/// The entropy of each of `phrases`, one after another, and its length; phrases of more than one
/// length are refused.
pub fn entropies_of(phrases: &[Phrase]) -> Result<(SecretBytes, usize), WriteError> {
    let length = phrases
        .first()
        .map_or(0, |first| entropy_bytes(first.len()));
    let mut entropies = SecretBytes::zeroed("a list's entropies", phrases.len() * length);
    if length == 0 {
        return Ok((entropies, 0));
    }
    for (phrase, slot) in phrases.iter().zip(entropies.chunks_mut(length)) {
        let mnemonic = phrase.mnemonic()?;
        let (mut bytes, used) = mnemonic.to_entropy_array();
        let fits = used == length;
        if fits {
            slot.copy_from_slice(&bytes[..length]);
        }
        zeroize::Zeroize::zeroize(&mut bytes);
        if !fits {
            return Err(ListError::EntropyLengths.into());
        }
    }
    Ok((entropies, length))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::NoRandomness;
    use crate::self_check::vectors::{THREE_PHRASES_ENTROPY, THREE_PHRASES_LIST};
    use crate::text::hex::{bytes_of_hex, hex_of_bytes};

    fn three_phrases() -> Vec<Phrase> {
        THREE_PHRASES_ENTROPY
            .iter()
            .map(|entropy| Phrase::of_entropy(&bytes_of_hex(entropy).unwrap()).unwrap())
            .collect()
    }

    #[test]
    fn the_three_phrases_are_written_as_ts_writes_them() {
        let writer = Writer::new(Protection::None, "").unwrap();
        let outcome = writer
            .write_phrases(&three_phrases(), &mut Gate::new(), &mut NoRandomness)
            .unwrap();
        let ListOutcome::List(list) = outcome else {
            panic!("no list");
        };
        assert_eq!(hex_of_bytes(&list.bytes), THREE_PHRASES_LIST);
        assert_eq!(list.records, 3);
        assert!(!list.encrypted);
        assert_eq!(list.description, "NOT encrypted");
        assert!(writer.uses_passphrase(""));
        assert!(!writer.uses_passphrase("TREZOR"));
    }

    #[test]
    fn no_candidate_too_long_a_passphrase_and_mixed_lengths_write_no_list() {
        let writer = Writer::new(Protection::None, "").unwrap();
        let outcome = writer.write_phrases(&[], &mut Gate::new(), &mut NoRandomness);
        assert!(matches!(outcome, Ok(ListOutcome::Empty)));
        let refusal = Writer::new(Protection::None, &"x".repeat(257)).unwrap_err();
        assert_eq!(
            refusal.to_string(),
            "The BIP39 passphrase that the list stores is longer than 256 bytes."
        );
        let mut phrases = three_phrases();
        phrases.push(Phrase::of_entropy(&[0; 32]).unwrap());
        let refusal = writer
            .write_phrases(&phrases, &mut Gate::new(), &mut NoRandomness)
            .unwrap_err();
        assert_eq!(refusal, WriteError::List(ListError::EntropyLengths));
    }
}
