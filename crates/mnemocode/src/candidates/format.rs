//! A candidate list (MnemoCode TS 0.1.0's `core/candidate-list.ts`, CAP-RECOVERY-CANDIDATE-LIST-
//! FORMAT): the MNCL bytes a search saves for the Discovery Scanner, every candidate's BIP39
//! entropy of one length, a BIP39 passphrase for all of them or one of each, a CRC-32, and zero
//! bytes to Padmé's length so that the size tells little of the count. The entropies and the
//! passphrases are held in locked buffers, wiped when dropped.

use std::fmt;

use crate::bip39::phrase::{Phrase, PhraseError};
use crate::checksum::crc32;
use crate::refusal::Refusal;
use crate::search::plan::counting;
use crate::secret::{SecretBytes, SecretText};

/// The first bytes of every list.
const MAGIC: [u8; 4] = *b"MNCL";
/// The format's version.
const VERSION: u8 = 1;
/// One passphrase for every candidate.
const GLOBAL_PASSPHRASE_FLAG: u8 = 0b01;
/// A passphrase field after every candidate.
const RECORD_PASSPHRASE_FLAG: u8 = 0b10;
/// The most candidates one list holds.
pub const MAX_CANDIDATE_RECORDS: usize = 1 << 19;
/// The longest passphrase, in UTF-8 bytes.
pub const MAX_PASSPHRASE_BYTES: usize = 256;
/// The candidates a search keeps: one more than a list holds, to tell that it overflowed.
pub const LIST_KEEP: usize = MAX_CANDIDATE_RECORDS + 1;
/// The entropy lengths of BIP39, in bytes.
const ENTROPY_LENGTHS: [usize; 5] = [16, 20, 24, 28, 32];
/// The header: magic, version, flags, entropy length and a 32-bit count.
const HEADER_BYTES: usize = MAGIC.len() + 3 + 4;
/// A passphrase's 16-bit length.
const LENGTH_BYTES: usize = 2;
/// The CRC-32 at the end of the content.
const CRC_BYTES: usize = 4;

/// The length Padmé pads `length` to: at most 12 % more, leaking O(log log) bits of it.
pub const fn padme_length(length: usize) -> usize {
    if length < 2 {
        return length;
    }
    let exponent = usize::BITS - 1 - length.leading_zeros();
    let exponent_bits = u32::BITS - 1 - exponent.leading_zeros() + 1;
    let step = 1_usize << (exponent - exponent_bits);
    length.div_ceil(step) * step
}

/// The largest list: every candidate at the longest entropy with the longest passphrase.
pub const MAX_CANDIDATE_LIST_BYTES: usize = padme_length(
    HEADER_BYTES
        + LENGTH_BYTES
        + MAX_PASSPHRASE_BYTES
        + MAX_CANDIDATE_RECORDS * (32 + LENGTH_BYTES + MAX_PASSPHRASE_BYTES)
        + CRC_BYTES,
);

/// The refusals of candidate lists, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ListError {
    /// A passphrase longer than [`MAX_PASSPHRASE_BYTES`]; what it is.
    PassphraseTooLong(String),
    /// No candidate, or more than a list holds.
    RecordCount,
    /// Entropies of more than one length, or of none of BIP39.
    EntropyLengths,
    /// The bytes end too soon.
    CutShort,
    /// A passphrase field of a wrong length.
    PassphraseLength,
    /// A passphrase field that is not UTF-8.
    PassphraseNotUtf8,
    /// Other first bytes.
    NotAList,
    /// Another version.
    Version(u8),
    /// Flags this version has not.
    UnknownFlags,
    /// An entropy length of none of BIP39.
    WrongEntropyLength,
    /// A record count of no list.
    WrongRecordCount,
    /// A CRC-32 that does not match.
    Damaged,
    /// Padding of another length or not zero.
    WrongPadding,
    /// A list larger than any.
    TooLarge,
    /// More candidates than a list holds: what to do instead.
    TooManyForList(String),
}

impl fmt::Display for ListError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PassphraseTooLong(what) => {
                write!(f, "The {what} is longer than {MAX_PASSPHRASE_BYTES} bytes.")
            }
            Self::RecordCount => write!(
                f,
                "A candidate list holds 1 to {} records.",
                counting(MAX_CANDIDATE_RECORDS as u64)
            ),
            Self::EntropyLengths => {
                f.write_str("Every candidate must be BIP39 entropy of one length, 16 to 32 bytes.")
            }
            Self::CutShort => f.write_str("The candidate list is cut short."),
            Self::PassphraseLength => {
                f.write_str("A passphrase in the candidate list has a wrong length.")
            }
            Self::PassphraseNotUtf8 => {
                f.write_str("A passphrase in the candidate list is not valid UTF-8 text.")
            }
            Self::NotAList => f.write_str("This is not a MnemoCode candidate list."),
            Self::Version(version) => {
                write!(f, "Candidate list version {version} is not supported.")
            }
            Self::UnknownFlags => f.write_str("The candidate list has unknown flags."),
            Self::WrongEntropyLength => {
                f.write_str("The candidate list has a wrong entropy length.")
            }
            Self::WrongRecordCount => f.write_str("The candidate list has a wrong record count."),
            Self::Damaged => {
                f.write_str("The candidate list is damaged: its CRC-32 does not match.")
            }
            Self::WrongPadding => f.write_str("The candidate list has wrong padding."),
            Self::TooLarge => write!(
                f,
                "The plaintext candidate list exceeds the supported limit of {MAX_CANDIDATE_LIST_BYTES} bytes."
            ),
            Self::TooManyForList(advice) => write!(
                f,
                "More than {} candidates, more than one list holds: {advice}.",
                counting(MAX_CANDIDATE_RECORDS as u64)
            ),
        }
    }
}

impl std::error::Error for ListError {}

impl Refusal for ListError {
    fn code(&self) -> &'static str {
        match self {
            Self::PassphraseTooLong(_) => "core.candidate-list.longer-than-bytes",
            Self::RecordCount => "core.candidate-list.candidate-list-holds-1-records",
            Self::EntropyLengths => {
                "core.candidate-list.every-candidate-bip39-entropy-one-length-16-32"
            }
            Self::CutShort => "core.candidate-list.candidate-list-cut-short",
            Self::PassphraseLength => "core.candidate-list.passphrase-candidate-list-wrong-length",
            Self::PassphraseNotUtf8 => {
                "core.candidate-list.passphrase-candidate-list-not-valid-utf-8-text"
            }
            Self::NotAList => "core.candidate-list.not-mnemo-code-candidate-list",
            Self::Version(_) => "core.candidate-list.candidate-list-version-not-supported",
            Self::UnknownFlags => "core.candidate-list.candidate-list-unknown-flags",
            Self::WrongEntropyLength => "core.candidate-list.candidate-list-wrong-entropy-length",
            Self::WrongRecordCount => "core.candidate-list.candidate-list-wrong-record-count",
            Self::Damaged => "core.candidate-list.candidate-list-damaged-crc-32-does-not-match",
            Self::WrongPadding => "core.candidate-list.candidate-list-wrong-padding",
            Self::TooLarge => "core.candidate-file-refusal.plaintext-list-too-large",
            Self::TooManyForList(_) => "core.candidate-list.too-many-for-list",
        }
    }
}

/// A list's candidates as a search keeps them: their entropies, one after another in one locked
/// buffer, a passphrase for all of them, and each one's where it has its own.
#[derive(Debug)]
pub struct CandidateList {
    entropies: SecretBytes,
    entropy_length: usize,
    passphrase: Option<SecretText>,
    own: Vec<Option<SecretText>>,
}

/// Which passphrases a list holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListPassphrases {
    /// None.
    None,
    /// One for every candidate.
    List,
    /// One of each candidate's.
    Records,
}

/// `passphrase` held to the length of a list's; none for an empty one.
pub(super) fn checked_passphrase(
    passphrase: Option<&str>,
    what: &str,
) -> Result<Option<SecretText>, ListError> {
    match passphrase {
        None | Some("") => Ok(None),
        Some(text) if text.len() > MAX_PASSPHRASE_BYTES => {
            Err(ListError::PassphraseTooLong(what.to_owned()))
        }
        Some(text) => Ok(Some(SecretText::copy_of("a list's passphrase", text))),
    }
}

impl CandidateList {
    /// The list of `entropies`, each `entropy_length` bytes, the BIP39 `passphrase` of them all and
    /// `own`, each one's where it has its own; refused for no candidate or more than a list holds,
    /// entropies of other lengths, and a passphrase longer than a list takes.
    pub fn new(
        entropies: SecretBytes,
        entropy_length: usize,
        passphrase: Option<&str>,
        own: &[Option<&str>],
    ) -> Result<Self, ListError> {
        if !ENTROPY_LENGTHS.contains(&entropy_length)
            || !entropies.len().is_multiple_of(entropy_length)
        {
            return Err(ListError::EntropyLengths);
        }
        let count = entropies.len() / entropy_length;
        if count == 0 || count > MAX_CANDIDATE_RECORDS || (!own.is_empty() && own.len() != count) {
            return Err(ListError::RecordCount);
        }
        let passphrase = checked_passphrase(passphrase, "passphrase for all candidates")?;
        let own = own
            .iter()
            .enumerate()
            .map(|(index, text)| {
                checked_passphrase(*text, &format!("passphrase of candidate {}", index + 1))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            entropies,
            entropy_length,
            passphrase,
            own,
        })
    }

    /// How many candidates it holds.
    pub fn count(&self) -> usize {
        self.entropies.len() / self.entropy_length
    }

    /// Which passphrases it holds.
    pub fn passphrases(&self) -> ListPassphrases {
        if self.own.iter().any(Option::is_some) {
            ListPassphrases::Records
        } else if self.passphrase.is_some() {
            ListPassphrases::List
        } else {
            ListPassphrases::None
        }
    }

    /// The candidate `place`, from 0: its phrase and its BIP39 passphrase.
    pub fn candidate(&self, place: usize) -> Result<(Phrase, &str), PhraseError> {
        let start = place * self.entropy_length;
        let entropy = self
            .entropies
            .get(start..start + self.entropy_length)
            .ok_or(PhraseError::WordCount)?;
        let phrase = Phrase::of_entropy(entropy)?;
        let own = self.own.get(place).and_then(Option::as_ref);
        let passphrase = own
            .or(self.passphrase.as_ref())
            .map_or("", SecretText::as_str);
        Ok((phrase, passphrase))
    }

    /// The MNCL bytes of the list, in a locked buffer.
    pub fn encode(&self) -> SecretBytes {
        let per_record = self.own.iter().any(Option::is_some);
        let field =
            |text: Option<&SecretText>| text.map_or(0, |text| LENGTH_BYTES + text.as_str().len());
        let content = HEADER_BYTES
            + self.passphrase.as_ref().map_or(0, |text| field(Some(text)))
            + self.entropies.len()
            + if per_record {
                self.own
                    .iter()
                    .map(|text| LENGTH_BYTES + text.as_ref().map_or(0, |text| text.as_str().len()))
                    .sum()
            } else {
                0
            };
        let total = padme_length(content + CRC_BYTES);
        let mut bytes = SecretBytes::zeroed("a candidate list", total);
        let mut at = 0;
        let mut put = |part: &[u8]| {
            bytes[at..at + part.len()].copy_from_slice(part);
            at += part.len();
        };
        put(&MAGIC);
        let flags = if self.passphrase.is_some() {
            GLOBAL_PASSPHRASE_FLAG
        } else {
            0
        } | if per_record {
            RECORD_PASSPHRASE_FLAG
        } else {
            0
        };
        put(&[
            VERSION,
            flags,
            u8::try_from(self.entropy_length).unwrap_or(0),
        ]);
        put(&u32::try_from(self.count()).unwrap_or(0).to_be_bytes());
        let text_field = |text: &str, put: &mut dyn FnMut(&[u8])| {
            put(&u16::try_from(text.len()).unwrap_or(0).to_be_bytes());
            put(text.as_bytes());
        };
        if let Some(passphrase) = &self.passphrase {
            text_field(passphrase.as_str(), &mut put);
        }
        for (place, entropy) in self.entropies.chunks(self.entropy_length).enumerate() {
            put(entropy);
            if per_record {
                text_field(
                    self.own
                        .get(place)
                        .and_then(Option::as_ref)
                        .map_or("", SecretText::as_str),
                    &mut put,
                );
            }
        }
        let checksum = crc32(&bytes[..at]);
        bytes[at..at + CRC_BYTES].copy_from_slice(&checksum.to_be_bytes());
        bytes
    }

    /// The list `bytes` hold; refused for any part out of the format.
    pub fn decode(bytes: &[u8]) -> Result<Self, ListError> {
        if bytes.len() > MAX_CANDIDATE_LIST_BYTES {
            return Err(ListError::TooLarge);
        }
        let mut reader = Reader { bytes, at: 0 };
        if reader.take(MAGIC.len())? != MAGIC {
            return Err(ListError::NotAList);
        }
        let [version, flags, entropy_length] = reader.array()?;
        if version != VERSION {
            return Err(ListError::Version(version));
        }
        if flags & !(GLOBAL_PASSPHRASE_FLAG | RECORD_PASSPHRASE_FLAG) != 0 {
            return Err(ListError::UnknownFlags);
        }
        let entropy_length = usize::from(entropy_length);
        if !ENTROPY_LENGTHS.contains(&entropy_length) {
            return Err(ListError::WrongEntropyLength);
        }
        let count = usize::try_from(u32::from_be_bytes(reader.array()?)).unwrap_or(usize::MAX);
        if count == 0 || count > MAX_CANDIDATE_RECORDS {
            return Err(ListError::WrongRecordCount);
        }
        let passphrase = if flags & GLOBAL_PASSPHRASE_FLAG == 0 {
            None
        } else {
            reader.passphrase(1)?
        };
        let mut entropies = SecretBytes::zeroed("candidate entropies", count * entropy_length);
        let mut own = Vec::new();
        for place in 0..count {
            entropies[place * entropy_length..(place + 1) * entropy_length]
                .copy_from_slice(reader.take(entropy_length)?);
            if flags & RECORD_PASSPHRASE_FLAG != 0 {
                own.push(reader.passphrase(0)?);
            }
        }
        let content = reader.at;
        if u32::from_be_bytes(reader.array()?) != crc32(&bytes[..content]) {
            return Err(ListError::Damaged);
        }
        if bytes.len() != padme_length(reader.at)
            || bytes[reader.at..].iter().any(|&byte| byte != 0)
        {
            return Err(ListError::WrongPadding);
        }
        Ok(Self {
            entropies,
            entropy_length,
            passphrase,
            own,
        })
    }
}

/// The bytes of a list, read from the start.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    /// The next `length` bytes; refused where the list ends before them.
    fn take(&mut self, length: usize) -> Result<&'a [u8], ListError> {
        let part = self
            .bytes
            .get(self.at..self.at + length)
            .ok_or(ListError::CutShort)?;
        self.at += length;
        Ok(part)
    }

    /// The next `N` bytes.
    fn array<const N: usize>(&mut self) -> Result<[u8; N], ListError> {
        self.take(N)?.try_into().map_err(|_| ListError::CutShort)
    }

    /// A passphrase field of at least `minimum` bytes; none for an empty one.
    fn passphrase(&mut self, minimum: usize) -> Result<Option<SecretText>, ListError> {
        let length = usize::from(u16::from_be_bytes(self.array()?));
        if length < minimum || length > MAX_PASSPHRASE_BYTES {
            return Err(ListError::PassphraseLength);
        }
        if length == 0 {
            return Ok(None);
        }
        let text =
            std::str::from_utf8(self.take(length)?).map_err(|_| ListError::PassphraseNotUtf8)?;
        Ok(Some(SecretText::copy_of("a list's passphrase", text)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn padme_pads_by_a_few_percent() {
        assert_eq!(padme_length(2), 2);
        assert_eq!(padme_length(100), 104);
        assert_eq!(padme_length(1000), 1024);
        assert_eq!(padme_length(1025), 1088);
    }

    #[test]
    fn a_list_comes_back_as_it_was_written() {
        let entropies = SecretBytes::copy_of("test entropies", &[0; 32]);
        let list = CandidateList::new(entropies, 16, Some("TREZOR"), &[None, Some("own")]).unwrap();
        let bytes = list.encode();
        assert_eq!(bytes.len(), padme_length(bytes.len()));
        let read = CandidateList::decode(&bytes).unwrap();
        assert_eq!(read.count(), 2);
        assert_eq!(read.passphrases(), ListPassphrases::Records);
        let (phrase, passphrase) = read.candidate(1).unwrap();
        assert_eq!(passphrase, "own");
        assert!(phrase.text().as_str().ends_with("about"));
        assert_eq!(read.candidate(0).unwrap().1, "TREZOR");
        let mut damaged = bytes.to_vec();
        damaged[20] ^= 1;
        assert_eq!(
            CandidateList::decode(&damaged).unwrap_err(),
            ListError::Damaged
        );
        assert_eq!(
            CandidateList::decode(b"MNCX").unwrap_err(),
            ListError::NotAList
        );
    }
}
