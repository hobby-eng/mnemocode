//! Phrases as BIP39 takes them (MnemoCode TS 0.1.0's `core/words.ts` and `core/english-words.ts`,
//! CAP-PHRASE-FORMATS-PHRASE-VALIDATION): the tokens, the count and the places of the words are
//! MnemoCode's, the checksum and the entropy the bip39 crate's (owner, 2026-10-27: no own BIP39
//! code). A [`Phrase`] is a phrase checked once, so that later steps never check it again; its
//! words live in a locked buffer that is wiped when it is dropped. Word numbers, from 1 through
//! 2,048, and Unicode codes, four hexadecimal digits of each word's Traditional Chinese character,
//! are read here for every reader of them.

use std::fmt;

use bip39::{Language, Mnemonic};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroize;

use super::sizes::{
    WORD_NUMBER_DIGITS, WORD_NUMBER_RANGE, check_word_count, checksum_bits, entropy_bytes,
    is_word_count, last_word_entropy_bits, word_counts_text,
};
use super::table::{english, index_of_english, index_of_number, index_of_unicode};
use crate::refusal::Refusal;
use crate::secret::SecretText;
use crate::text::codes::{UNICODE_CODE_DIGITS, complete_hex_units};
use crate::text::space::tokens;

/// The refusals of phrases and word numbers, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PhraseError {
    /// The checksum fails.
    Checksum,
    /// A count of words that BIP39 does not have.
    WordCount,
    /// A word that is not English BIP39, at its position from 1.
    UnknownWord(usize),
    /// Word numbers written together.
    RunTogether,
    /// A word number of other characters than decimal digits.
    NotDecimal,
    /// A word number outside 1 through 2,048.
    NotWordNumber,
    /// Text that is not whole Unicode codes.
    UnicodeCodes,
    /// A Unicode code that is no word's, at its place from 1.
    UnicodeNotWord(usize),
    /// A ? among the words where the exact old final word is needed.
    QuestionMark,
    /// A count of word indexes that no phrase has.
    Sizes(super::sizes::SizesError),
}

impl fmt::Display for PhraseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Checksum => f.write_str("These words fail the BIP39 checksum: check each word and their order."),
            Self::WordCount => write!(f, "Enter {} English BIP39 words.", word_counts_text()),
            Self::UnknownWord(position) => write!(f, "Unknown English BIP39 word at position {position}."),
            Self::RunTogether => f.write_str(
                "Word numbers run together cannot be told apart: write them apart, separated by spaces.",
            ),
            Self::NotDecimal => {
                write!(f, "Indexes must be decimal integers from {}.", WORD_NUMBER_RANGE.through())
            }
            Self::NotWordNumber => write!(
                f,
                "Indexes use Seedshift-compatible numbering from {}.",
                WORD_NUMBER_RANGE.through()
            ),
            Self::UnicodeCodes => f.write_str(
                "Unicode codes have four hexadecimal digits each, separated by spaces or joined.",
            ),
            Self::UnicodeNotWord(place) => write!(f, "The Unicode code at place {place} is not a BIP39 word."),
            Self::QuestionMark => f.write_str("This mode needs the exact old final word: ? stands for no word here."),
            Self::Sizes(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for PhraseError {}

impl Refusal for PhraseError {
    fn code(&self) -> &'static str {
        match self {
            Self::Checksum => "core.words.words-fail-bip39-checksum-check-each-word-their",
            Self::WordCount => "core.words.enter-english-bip39-words",
            Self::UnknownWord(_) => "core.words.unknown-english-bip39-word-at-position",
            Self::RunTogether => "core.words.word-numbers-run-together",
            Self::NotDecimal => "core.words.indexes-decimal-integers-from",
            Self::NotWordNumber => "core.words.indexes-use-seedshift-compatible-numbering-from",
            Self::UnicodeCodes => {
                "core.words.unicode-codes-four-hexadecimal-digits-each-separated-by"
            }
            Self::UnicodeNotWord(_) => "core.words.unicode-code-not-bip39-word",
            Self::QuestionMark => "core.words.mode-exact-old-final-word-stands-no-word",
            Self::Sizes(error) => error.code(),
        }
    }
}

impl From<super::sizes::SizesError> for PhraseError {
    fn from(error: super::sizes::SizesError) -> Self {
        Self::Sizes(error)
    }
}

/// The tokens of `text` as English words: NFKD and lower case, split at white space.
pub fn english_tokens(text: &str) -> Vec<String> {
    let normalized: String = text.nfkd().collect::<String>().to_lowercase();
    tokens(&normalized).map(str::to_owned).collect()
}

/// A phrase that BIP39 accepts, checked once: its word indexes in a locked buffer.
pub struct Phrase {
    /// The indexes, two bytes each, little-endian.
    indexes: crate::secret::SecretBytes,
}

impl Phrase {
    /// The phrase that `text` writes in English words; refused for a count BIP39 does not have, a
    /// word that is not in its list (named by its position) and a failed checksum.
    pub fn parse(text: &str) -> Result<Self, PhraseError> {
        let words = canonical_words(text)?;
        let mut indexes = Vec::with_capacity(words.len());
        for word in &words {
            indexes.push(index_of_english(word).ok_or(PhraseError::Checksum)?);
        }
        let phrase = Self::of_indexes(&indexes);
        indexes.zeroize();
        phrase
    }

    /// The phrase of the word indexes `indexes`, from 0; refused for a failed checksum.
    pub fn of_indexes(indexes: &[usize]) -> Result<Self, PhraseError> {
        check_word_count(indexes.len()).map_err(|_| PhraseError::WordCount)?;
        let text = SecretText::build("a phrase", indexes.len() * 9, |filler| {
            for (place, index) in indexes.iter().enumerate() {
                if place > 0 {
                    filler.push(' ')?;
                }
                filler.push_str(english().get(*index).copied().unwrap_or_default())?;
            }
            Ok::<_, crate::secret::CapacityExceeded>(())
        })
        .map_err(|_| PhraseError::WordCount)?;
        Mnemonic::parse_in_normalized(Language::English, &text)
            .map_err(|_| PhraseError::Checksum)?;
        let bytes =
            crate::secret::SecretBytes::build("a phrase's indexes", indexes.len() * 2, |filler| {
                for index in indexes {
                    filler.extend(&u16::try_from(*index).unwrap_or(u16::MAX).to_le_bytes())?;
                }
                Ok::<_, crate::secret::CapacityExceeded>(())
            })
            .map_err(|_| PhraseError::WordCount)?;
        Ok(Self { indexes: bytes })
    }

    /// The phrase of BIP39 `entropy`, 16 to 32 bytes; refused for another length.
    pub fn of_entropy(entropy: &[u8]) -> Result<Self, PhraseError> {
        let mnemonic = Mnemonic::from_entropy_in(Language::English, entropy)
            .map_err(|_| PhraseError::WordCount)?;
        let mut indexes: Vec<usize> = mnemonic.word_indices().collect();
        let phrase = Self::of_indexes(&indexes);
        indexes.zeroize();
        phrase
    }

    /// The number of words.
    pub fn len(&self) -> usize {
        self.indexes.len() / 2
    }

    /// Whether it has no words: never, a phrase has 12 or more.
    pub fn is_empty(&self) -> bool {
        self.indexes.is_empty()
    }

    /// The index, from 0, of the word at `place`, from 0.
    pub fn index(&self, place: usize) -> Option<usize> {
        let bytes = self.indexes.get(place * 2..place * 2 + 2)?;
        Some(usize::from(u16::from_le_bytes([bytes[0], bytes[1]])))
    }

    /// Its words, as the English list writes them, joined by single spaces, in a locked buffer.
    pub fn text(&self) -> SecretText {
        let count = self.len();
        SecretText::build("a phrase", count * 9, |filler| {
            for place in 0..count {
                if place > 0 {
                    filler.push(' ')?;
                }
                filler.push_str(
                    english()
                        .get(self.index(place).unwrap_or(0))
                        .copied()
                        .unwrap_or_default(),
                )?;
            }
            Ok::<_, crate::secret::CapacityExceeded>(())
        })
        .unwrap_or_else(|_| SecretText::copy_of("a phrase", ""))
    }

    /// Its entropy, 16 to 32 bytes, in a locked buffer.
    pub fn entropy(&self) -> Result<crate::secret::SecretBytes, PhraseError> {
        let (mut bytes, length) = self.mnemonic()?.to_entropy_array();
        let entropy = crate::secret::SecretBytes::copy_of("a phrase's entropy", &bytes[..length]);
        bytes.zeroize();
        Ok(entropy)
    }

    /// The bip39 crate's mnemonic of the phrase, for its seed and entropy.
    pub(crate) fn mnemonic(&self) -> Result<Mnemonic, PhraseError> {
        Mnemonic::parse_in_normalized(Language::English, &self.text())
            .map_err(|_| PhraseError::Checksum)
    }
}

impl fmt::Debug for Phrase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a phrase")
    }
}

/// The English words of `text`, NFKD and lower case; refused for a count BIP39 does not have and a
/// word that is not in its list, named by its position.
pub fn canonical_words(text: &str) -> Result<Vec<String>, PhraseError> {
    let words = english_tokens(text);
    if !is_word_count(words.len()) {
        return Err(PhraseError::WordCount);
    }
    for (position, word) in words.iter().enumerate() {
        if index_of_english(word).is_none() {
            return Err(PhraseError::UnknownWord(position + 1));
        }
    }
    Ok(words)
}

/// Whether `token`, digits and ? for unread ones, is word numbers run together: more digits than
/// the highest word number has, and no word number with leading zeros.
pub fn run_together_numbers(token: &str) -> bool {
    !token.is_empty()
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'?')
        && token.len() > WORD_NUMBER_DIGITS
        && index_of_number(token).is_none()
}

/// The index, from 0, of a word number of a phrase; refused why it is none.
pub fn word_index_of_number(token: &str) -> Result<usize, PhraseError> {
    if run_together_numbers(token) {
        return Err(PhraseError::RunTogether);
    }
    if token.is_empty() || !token.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(PhraseError::NotDecimal);
    }
    index_of_number(token).ok_or(PhraseError::NotWordNumber)
}

/// The indexes of Unicode codes, four hexadecimal digits each, written apart or joined; a refusal
/// names the place, never the code.
pub fn unicode_indexes_of(text: &str) -> Result<Vec<usize>, PhraseError> {
    let codes = complete_hex_units(text, UNICODE_CODE_DIGITS).ok_or(PhraseError::UnicodeCodes)?;
    codes
        .iter()
        .enumerate()
        .map(|(place, code)| {
            index_of_unicode(&code.to_uppercase()).ok_or(PhraseError::UnicodeNotWord(place + 1))
        })
        .collect()
}

/// The word indexes, from 0 and in their order, that end a phrase of `prefix` (every word but the
/// last) with a valid checksum: one for each value of the entropy bits the last word holds, found
/// from the entropy rather than by checking 2,048 phrases.
pub fn valid_last_word_indexes(prefix: &[usize]) -> Result<Vec<usize>, PhraseError> {
    let word_count = prefix.len() + 1;
    check_word_count(word_count)?;
    let indexes: Vec<u16> = prefix
        .iter()
        .map(|&index| u16::try_from(index).unwrap_or(u16::MAX))
        .collect();
    super::sizes::check_word_indexes(&indexes)?;
    let tail_bits = last_word_entropy_bits(word_count);
    let bytes = entropy_bytes(word_count);
    let mut found = Vec::with_capacity(1 << tail_bits);
    for tail in 0..(1_usize << tail_bits) {
        let mut entropy = [0_u8; 32];
        // The known words' 11 bits each, then the tail's bits.
        let mut bit = 0;
        let mut put = |value: usize, width: usize, entropy: &mut [u8; 32]| {
            for shift in (0..width).rev() {
                if (value >> shift) & 1 == 1 {
                    entropy[bit / 8] |= 0x80 >> (bit % 8);
                }
                bit += 1;
            }
        };
        for &index in prefix {
            put(index, 11, &mut entropy);
        }
        put(tail, tail_bits, &mut entropy);
        let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy[..bytes]);
        entropy.zeroize();
        let last = mnemonic
            .ok()
            .and_then(|mnemonic| mnemonic.word_indices().last())
            .ok_or(PhraseError::Checksum)?;
        found.push(last);
    }
    Ok(found)
}

/// A replacement of the final word of an old exact-legacy phrase: its index, from 0, and whether it
/// keeps the old final word's entropy bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LastWordCandidate {
    /// The word's index, from 0.
    pub index: usize,
    /// Whether it keeps the entropy-bearing high bits of the old final word.
    pub preserves_entropy: bool,
}

/// The checksum-valid replacements of the final word of `text`, an old shifted phrase whose final
/// word may fail the checksum; refused for a ? among the words and what [`canonical_words`]
/// refuses.
pub fn legacy_valid_last_words(text: &str) -> Result<Vec<LastWordCandidate>, PhraseError> {
    if english_tokens(text).iter().any(|word| word == "?") {
        return Err(PhraseError::QuestionMark);
    }
    let words = canonical_words(text)?;
    let indexes: Vec<usize> = words
        .iter()
        .filter_map(|word| index_of_english(word))
        .collect();
    let (last, prefix) = indexes.split_last().ok_or(PhraseError::WordCount)?;
    let checksum = checksum_bits(words.len());
    let old_tail = last >> checksum;
    Ok(valid_last_word_indexes(prefix)?
        .into_iter()
        .map(|index| LastWordCandidate {
            index,
            preserves_entropy: index >> checksum == old_tail,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn a_phrase_is_checked_once_by_the_crate() {
        let phrase = Phrase::parse(&ABANDON.to_uppercase()).unwrap();
        assert_eq!(phrase.len(), 12);
        assert_eq!(&*phrase.text(), ABANDON);
        assert_eq!(format!("{phrase:?}"), "[a phrase: redacted]");
        let wrong = ABANDON.replace("about", "abandon");
        assert!(matches!(Phrase::parse(&wrong), Err(PhraseError::Checksum)));
        assert!(matches!(
            Phrase::parse("abandon zzz"),
            Err(PhraseError::WordCount)
        ));
        let unknown = ABANDON.replace("about", "aboutx");
        assert!(matches!(
            Phrase::parse(&unknown),
            Err(PhraseError::UnknownWord(12))
        ));
    }

    #[test]
    fn the_valid_last_words_come_from_the_entropy() {
        let found = valid_last_word_indexes(&[0; 11]).unwrap();
        assert_eq!(found.len(), 128);
        assert_eq!(found.first().map(|&index| english()[index]), Some("about"));
    }

    #[test]
    fn word_numbers_and_codes_are_read_by_one_rule() {
        assert_eq!(word_index_of_number("2048"), Ok(2047));
        assert_eq!(word_index_of_number("12345"), Err(PhraseError::RunTogether));
        assert_eq!(word_index_of_number("0"), Err(PhraseError::NotWordNumber));
        assert_eq!(word_index_of_number("1a"), Err(PhraseError::NotDecimal));
        assert_eq!(unicode_indexes_of("7684 5728"), Ok(vec![0, 3]));
        assert_eq!(
            unicode_indexes_of("7684 0000"),
            Err(PhraseError::UnicodeNotWord(2))
        );
    }
}
