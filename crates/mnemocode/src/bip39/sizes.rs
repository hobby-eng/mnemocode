//! The sizes of BIP39 phrases (MnemoCode TS 0.1.0's `core/bip39-sizes.ts`): the word counts, the
//! bits a word index and the checksum take, the entropy, and the word numbers, from 1 through
//! 2,048, as Seedshift counts them.

use std::fmt;

use crate::refusal::Refusal;
use crate::text::numbers::{WholeRange, integer_refusal};
use crate::text::words::list_in_words;

/// The word counts of BIP39 phrases.
pub const WORD_COUNTS: [usize; 5] = [12, 15, 18, 21, 24];
/// The bits of one word index.
pub const INDEX_BITS: u32 = 11;
/// The words of the BIP39 lists.
pub const DICTIONARY_SIZE: usize = 2048;
/// The word numbers, counted from 1 as Seedshift counts them.
pub const WORD_NUMBER_RANGE: WholeRange = WholeRange::new(1, 2048);
/// The word indexes, counted from 0.
pub const WORD_INDEX_RANGE: WholeRange = WholeRange::new(0, 2047);
/// The digits of the highest word number.
pub const WORD_NUMBER_DIGITS: usize = 4;
/// Seedshift's words for each checksum bit: a checksum bit for every three words.
const WORDS_PER_CHECKSUM_BIT: usize = 3;

/// "12, 15, 18, 21 or 24".
pub fn word_counts_text() -> String {
    list_in_words(&WORD_COUNTS, "or")
}

/// "11, 14, 17, 20 or 23": one word fewer than each count.
pub fn word_counts_less_one_text() -> String {
    let less: Vec<usize> = WORD_COUNTS.iter().map(|count| count - 1).collect();
    list_in_words(&less, "or")
}

/// Whether BIP39 has phrases of `count` words.
pub fn is_word_count(count: usize) -> bool {
    WORD_COUNTS.contains(&count)
}

/// The checksum bits of a phrase of `word_count` words.
pub const fn checksum_bits(word_count: usize) -> usize {
    word_count / WORDS_PER_CHECKSUM_BIT
}

/// The entropy bits of a phrase of `word_count` words.
pub const fn entropy_bits(word_count: usize) -> usize {
    word_count * INDEX_BITS as usize - checksum_bits(word_count)
}

/// The entropy bytes of a phrase of `word_count` words.
pub const fn entropy_bytes(word_count: usize) -> usize {
    entropy_bits(word_count) / 8
}

/// The entropy bits the last word holds besides the checksum.
pub const fn last_word_entropy_bits(word_count: usize) -> usize {
    INDEX_BITS as usize - checksum_bits(word_count)
}

/// The word count of `bytes` of entropy, if BIP39 has one.
pub fn word_count_of_entropy(bytes: usize) -> Option<usize> {
    WORD_COUNTS
        .into_iter()
        .find(|&count| entropy_bytes(count) == bytes)
}

/// The refusals of sizes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SizesError {
    /// A count of indexes that no phrase has.
    ExpectedWordIndexes,
    /// An index outside the lists.
    WordIndex,
}

impl fmt::Display for SizesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExpectedWordIndexes => write!(f, "Expected {} word indexes.", word_counts_text()),
            Self::WordIndex => f.write_str(&integer_refusal(
                "Every BIP39 index",
                WORD_INDEX_RANGE,
                None,
            )),
        }
    }
}

impl std::error::Error for SizesError {}

impl Refusal for SizesError {
    fn code(&self) -> &'static str {
        match self {
            Self::ExpectedWordIndexes => "core.bip39-sizes.expected-word-indexes",
            Self::WordIndex => "core.bip39-sizes.assert-word-indexes-refused",
        }
    }
}

/// Refuses a count of words that no phrase has.
pub fn check_word_count(count: usize) -> Result<(), SizesError> {
    if is_word_count(count) {
        Ok(())
    } else {
        Err(SizesError::ExpectedWordIndexes)
    }
}

/// Refuses an index outside the lists.
pub fn check_word_indexes(indexes: &[u16]) -> Result<(), SizesError> {
    if indexes
        .iter()
        .all(|&index| usize::from(index) < DICTIONARY_SIZE)
    {
        Ok(())
    } else {
        Err(SizesError::WordIndex)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sizes_follow_the_word_count() {
        assert_eq!(entropy_bytes(12), 16);
        assert_eq!(entropy_bytes(24), 32);
        assert_eq!(last_word_entropy_bits(12), 7);
        assert_eq!(word_count_of_entropy(20), Some(15));
        assert_eq!(word_counts_text(), "12, 15, 18, 21 or 24");
        assert_eq!(
            SizesError::WordIndex.to_string(),
            "Every BIP39 index must be an integer from 0 through 2047."
        );
    }
}
