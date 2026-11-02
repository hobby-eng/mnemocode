//! The places of a seed phrase (MnemoCode TS 0.1.0's `core/candidates.ts`,
//! CAP-RECOVERY-WORD-SEARCH-PLACES): unknown words at known places, each marked with ?, a prefix
//! with * or a few words joined by |, or one word missing at an unknown place; the BIP39 checksum
//! every candidate is held to; and the counter through every combination of the places, which the
//! word search and the search of marked codes both count through. Always built: the reader of
//! marked codes needs it. Its messages name a wrong word by its place, never by what was typed.

use std::fmt;

use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::bip39::phrase::english_tokens;
use crate::bip39::sizes::{
    DICTIONARY_SIZE, INDEX_BITS, checksum_bits, entropy_bytes, is_word_count,
    word_counts_less_one_text, word_counts_text,
};
use crate::bip39::table::english;
use crate::modes::seedshift::Indexes;
use crate::refusal::Refusal;
use crate::search::plan::counting;
use crate::secret::SecretBytes;

/// Combinations that one search may check; at a few microseconds each, about a minute.
pub const MAX_SEARCH_COMBINATIONS: u64 = 1 << 24;
/// How a word search with too many combinations or candidates is narrowed, in every message.
pub const NARROW_WORD_SEARCH: &str = "give more of the words, or a few letters of them";
/// The bytes of the longest entropy with the checksum, which the packing of words fills.
const LONGEST_PACKED: usize = 33;
/// The bits of a byte.
const BYTE_BITS: u32 = 8;

/// The refusals of written places, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlaceError {
    /// No BIP39 word starts with the letters at a place, from 1.
    NoWordStarts(usize),
    /// A word of no BIP39 list at a place, from 1, among places.
    UnknownWord(usize),
    /// Another count of places than a phrase has.
    PlaceCount,
    /// No place marked.
    NoPlaceMarked,
    /// Another count of words than a phrase with one missing has.
    WordCount,
    /// A word of no BIP39 list at a place, from 1, among the words there are.
    UnknownWrittenWord(usize),
    /// More combinations than a search takes, with what makes it smaller.
    TooManyCombinations(&'static str),
}

impl fmt::Display for PlaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoWordStarts(place) => {
                write!(f, "No BIP39 word starts with the letters at place {place}.")
            }
            Self::UnknownWord(place) | Self::UnknownWrittenWord(place) => {
                write!(f, "Unknown English BIP39 word at place {place}.")
            }
            Self::PlaceCount => write!(
                f,
                "Enter {} places: words, ?, a prefix with *, or a|b.",
                word_counts_text()
            ),
            Self::NoPlaceMarked => {
                f.write_str("Mark each forgotten word with ?, a prefix with *, or a|b.")
            }
            Self::WordCount => write!(
                f,
                "Enter the {} words you have, in their order.",
                word_counts_less_one_text()
            ),
            Self::TooManyCombinations(narrow) => write!(
                f,
                "This search has more than {} combinations: {narrow}.",
                counting(MAX_SEARCH_COMBINATIONS)
            ),
        }
    }
}

impl std::error::Error for PlaceError {}

impl Refusal for PlaceError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoWordStarts(_) => "core.candidates.no-bip39-word-starts-letters-at",
            Self::UnknownWord(_) => "core.candidates.unknown-english-bip39-word-at",
            Self::PlaceCount => "core.candidates.enter-places-words-prefix-b",
            Self::NoPlaceMarked => "core.candidates.mark-each-forgotten-word-prefix-b",
            Self::WordCount => "core.candidates.enter-words-you-their-order",
            Self::UnknownWrittenWord(_) => "core.candidates.unknown-english-bip39-word-at-place",
            Self::TooManyCombinations(_) => "core.candidates.search-more-than-combinations",
        }
    }
}

/// How many candidates a search finds: exactly, where the checksum tells it, or about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExpectedCandidates {
    /// The candidates; when not exact, their expected number rounded to a whole one.
    pub count: u64,
    /// Whether `count` is exact, as it is when the last place may hold any word.
    pub exact: bool,
}

/// Every word, for a place marked with ? or one that cannot be read at all.
pub fn every_word() -> Indexes {
    Indexes::new((0..DICTIONARY_SIZE as u16).collect())
}

/// The index of `word` in the English list.
fn index_of(word: &str) -> Option<u16> {
    let index = english().binary_search(&word).ok()?;
    u16::try_from(index).ok()
}

/// The words that one written place allows, a word, ?, a prefix with * or words joined by |; the
/// place, from 1, named only by its number in a refusal.
pub fn word_place_of(written: &str, position: usize) -> Result<Indexes, PlaceError> {
    if written == "?" {
        return Ok(every_word());
    }
    if let Some(prefix) = written.strip_suffix('*') {
        let words: Vec<u16> = (0..DICTIONARY_SIZE as u16)
            .filter(|&index| english()[usize::from(index)].starts_with(prefix))
            .collect();
        // The letters are part of a secret word: the message names only their place.
        if prefix.is_empty() || prefix.contains(['*', '?', '|']) || words.is_empty() {
            return Err(PlaceError::NoWordStarts(position));
        }
        return Ok(Indexes::new(words));
    }
    let mut words = written
        .split('|')
        .map(|word| index_of(word).ok_or(PlaceError::UnknownWord(position)))
        .collect::<Result<Vec<u16>, PlaceError>>()?;
    words.sort_unstable();
    words.dedup();
    Ok(Indexes::new(words))
}

/// A search: unknown words at known places, or one word missing at an unknown place.
#[derive(Debug)]
pub enum WordSearch {
    /// The places of the phrase in order, one a word, with their words.
    UnknownWords(Vec<Indexes>),
    /// The words there are, in order: one fewer than a phrase has.
    MissingWord(Indexes),
}

impl WordSearch {
    /// Reads a phrase with unknown words at known places; at least one must be unknown.
    pub fn unknown_words(text: &str) -> Result<Self, PlaceError> {
        let written = english_tokens(text);
        if !is_word_count(written.len()) {
            return Err(PlaceError::PlaceCount);
        }
        let places = written
            .iter()
            .enumerate()
            .map(|(place, word)| word_place_of(word, place + 1))
            .collect::<Result<Vec<Indexes>, PlaceError>>()?;
        if places.iter().all(|place| place.as_slice().len() == 1) {
            return Err(PlaceError::NoPlaceMarked);
        }
        Ok(Self::UnknownWords(places))
    }

    /// Reads a phrase with one word missing at an unknown place: one word fewer than a valid
    /// length.
    pub fn missing_word(text: &str) -> Result<Self, PlaceError> {
        let written = english_tokens(text);
        if !is_word_count(written.len() + 1) {
            return Err(PlaceError::WordCount);
        }
        let words = written
            .iter()
            .enumerate()
            .map(|(place, word)| index_of(word).ok_or(PlaceError::UnknownWrittenWord(place + 1)))
            .collect::<Result<Vec<u16>, PlaceError>>()?;
        Ok(Self::MissingWord(Indexes::new(words)))
    }

    /// The words of every candidate: 12, 15, 18, 21 or 24.
    pub fn word_count(&self) -> usize {
        match self {
            Self::UnknownWords(places) => places.len(),
            Self::MissingWord(written) => written.as_slice().len() + 1,
        }
    }

    /// The combinations the search checks: the work it takes.
    pub fn combinations(&self) -> u64 {
        match self {
            Self::UnknownWords(places) => combinations_of(places),
            Self::MissingWord(_) => self.word_count() as u64 * DICTIONARY_SIZE as u64,
        }
    }

    /// How many candidates the search finds, told before it runs. When the last place may hold any
    /// word, exactly one in 2^(words / 3) of its words passes the checksum for each combination of
    /// the other places, so the count is exact; otherwise a combination passes that often on
    /// average.
    pub fn expected(&self) -> ExpectedCandidates {
        match self {
            Self::UnknownWords(places) => expected_of(places),
            // The inserted word is the last only at the last place.
            Self::MissingWord(_) => expected_count(self.combinations(), self.word_count(), false),
        }
    }

    /// The places, from 0, that may hold more than one word; none for a missing word, whose place
    /// each candidate has on its own.
    pub fn unknown_places(&self) -> Vec<usize> {
        match self {
            Self::UnknownWords(places) => unknown_places_of(places),
            Self::MissingWord(_) => Vec::new(),
        }
    }
}

/// How many of `combinations` of a phrase of `word_count` words pass the checksum, one in
/// 2^(words / 3): at least one where it is not `exact`, since the right phrase is always among the
/// candidates, and the time of a search is planned by this count.
fn expected_count(combinations: u64, word_count: usize, exact: bool) -> ExpectedCandidates {
    let passing = combinations as f64 / f64::from(1_u32 << checksum_bits(word_count));
    let count = if exact {
        passing
    } else {
        passing.round().max(1.0)
    };
    ExpectedCandidates {
        count: count as u64,
        exact,
    }
}

/// How many candidates `places` give.
pub fn expected_of(places: &[Indexes]) -> ExpectedCandidates {
    let exact = places.last().map_or(0, |place| place.as_slice().len()) == DICTIONARY_SIZE;
    expected_count(combinations_of(places), places.len(), exact)
}

/// The combinations of `places`, however many: a count above what a search takes needs no exact
/// value.
pub fn combinations_of(places: &[Indexes]) -> u64 {
    places.iter().fold(1_u64, |product, place| {
        product.saturating_mul(place.as_slice().len() as u64)
    })
}

/// Refuses a search of more combinations than [`MAX_SEARCH_COMBINATIONS`], with `narrow`, what
/// makes it smaller in the words of its search.
pub fn check_searchable(combinations: u64, narrow: &'static str) -> Result<(), PlaceError> {
    if combinations > MAX_SEARCH_COMBINATIONS {
        return Err(PlaceError::TooManyCombinations(narrow));
    }
    Ok(())
}

/// The places, from 0, that a search tries several words in.
pub fn unknown_places_of(places: &[Indexes]) -> Vec<usize> {
    places
        .iter()
        .enumerate()
        .filter(|(_, place)| place.as_slice().len() > 1)
        .map(|(index, _)| index)
        .collect()
}

/// Where a missing-word candidate holds its inserted word, from 0: the first place of a run of
/// equal words, as the search counts it.
pub fn inserted_place(written: &[u16], words: &[u16]) -> usize {
    let mut place = 0;
    while place < written.len() && words[place] == written[place] {
        place += 1;
    }
    while place > 0 && words[place - 1] == words[place] {
        place -= 1;
    }
    place
}

/// The bits of `words` from the first, filling `packed`: the entropy, then what is left of the
/// checksum.
fn pack_words(words: &[u16], packed: &mut [u8; LONGEST_PACKED]) {
    let (mut held, mut bits, mut at) = (0_u32, 0_u32, 0);
    for &word in words {
        held = (held << INDEX_BITS) | u32::from(word);
        bits += INDEX_BITS;
        while bits >= BYTE_BITS {
            bits -= BYTE_BITS;
            packed[at] = (held >> bits) as u8;
            at += 1;
        }
        held &= (1 << bits) - 1;
    }
    if bits > 0 {
        packed[at] = (held << (BYTE_BITS - bits)) as u8;
    }
}

/// The BIP39 entropy that `words`, a phrase's indexes, carry, without their checksum bits.
pub fn entropy_of_words(words: &[u16]) -> SecretBytes {
    let mut packed = [0_u8; LONGEST_PACKED];
    pack_words(words, &mut packed);
    let entropy = SecretBytes::copy_of("a phrase's entropy", &packed[..entropy_bytes(words.len())]);
    packed.zeroize();
    entropy
}

/// Whether the last bits of the last word of `words`, a phrase's indexes, are the BIP39 checksum of
/// the entropy before them.
pub fn checksum_fits(words: &[u16]) -> bool {
    let mut packed = [0_u8; LONGEST_PACKED];
    pack_words(words, &mut packed);
    let digest = Sha256::digest(&packed[..entropy_bytes(words.len())]);
    packed.zeroize();
    let bits = checksum_bits(words.len()) as u32;
    let last = words.last().copied().unwrap_or(0);
    u32::from(last) & ((1 << bits) - 1) == u32::from(digest[0]) >> (BYTE_BITS - bits)
}

/// The checksum bits of the last word of `words`, a phrase's indexes, as written.
pub fn last_word_checksum_bits(words: &[u16]) -> String {
    let bits = checksum_bits(words.len());
    let last = u32::from(words.last().copied().unwrap_or(0)) & ((1 << bits) - 1);
    format!("{last:0bits$b}")
}

/// Every combination of some places, in lexicographic order of their words with the last place
/// changing fastest, as a mixed-radix counter: it keeps its place, so that a search that the host
/// steps stops and goes on anywhere.
#[derive(Debug)]
pub struct Combinations {
    places: Vec<Indexes>,
    counters: Indexes,
    words: Indexes,
    started: bool,
    ended: bool,
}

impl Combinations {
    /// The combinations of `places`, each of which holds at least one word.
    pub fn new(places: Vec<Indexes>) -> Self {
        let counters = Indexes::new(vec![0; places.len()]);
        let words = Indexes::new(
            places
                .iter()
                .map(|place| place.as_slice().first().copied().unwrap_or(0))
                .collect(),
        );
        Self {
            places,
            counters,
            words,
            started: false,
            ended: false,
        }
    }

    /// The next combination, kept here: a caller that keeps it copies it. None after the last.
    pub fn next_words(&mut self) -> Option<&[u16]> {
        if self.ended {
            return None;
        }
        if !self.started {
            self.started = true;
            return Some(self.words.as_slice());
        }
        let counters = self.counters.as_mut_slice();
        let words = self.words.as_mut_slice();
        for (place, words_here) in self.places.iter().enumerate().rev() {
            let here = words_here.as_slice();
            let next = usize::from(counters[place]) + 1;
            if next < here.len() {
                counters[place] = next as u16;
                words[place] = here[next];
                return Some(self.words.as_slice());
            }
            counters[place] = 0;
            words[place] = here[0];
        }
        self.ended = true;
        None
    }
}

/// Every phrase with one word inserted into some written ones, place ascending, then the word in
/// list order; a word inserted just after the same written word repeats the phrase of the place
/// before, and is left out.
#[derive(Debug)]
pub struct Insertions {
    written: Indexes,
    words: Indexes,
    place: usize,
    word: u16,
}

impl Insertions {
    /// The phrases of `written`.
    pub fn new(written: Indexes) -> Self {
        let words = Indexes::new(vec![0; written.as_slice().len() + 1]);
        Self {
            written,
            words,
            place: 0,
            word: 0,
        }
    }

    /// The next phrase, kept here: a caller that keeps it copies it. None after the last.
    pub fn next_words(&mut self) -> Option<&[u16]> {
        let written = self.written.as_slice();
        loop {
            if usize::from(self.word) == DICTIONARY_SIZE {
                self.word = 0;
                self.place += 1;
            }
            if self.place > written.len() {
                return None;
            }
            let (place, word) = (self.place, self.word);
            self.word += 1;
            if place > 0 && written[place - 1] == word {
                continue;
            }
            let words = self.words.as_mut_slice();
            words[..place].copy_from_slice(&written[..place]);
            words[place] = word;
            words[place + 1..].copy_from_slice(&written[place..]);
            return Some(self.words.as_slice());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bip39::phrase::Phrase;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn indexes_of(text: &str) -> Vec<u16> {
        text.split(' ')
            .map(|word| index_of(word).unwrap())
            .collect()
    }

    #[test]
    fn a_place_is_a_word_a_mark_a_prefix_or_several_words() {
        assert_eq!(word_place_of("?", 1).unwrap().as_slice().len(), 2048);
        assert_eq!(word_place_of("about", 1).unwrap().as_slice(), &[3]);
        assert_eq!(
            word_place_of("about|abandon|about", 1).unwrap().as_slice(),
            &[0, 3]
        );
        assert_eq!(word_place_of("abo*", 1).unwrap().as_slice(), &[3, 4]);
        assert_eq!(word_place_of("*", 4), Err(PlaceError::NoWordStarts(4)));
        assert_eq!(word_place_of("a?*", 4), Err(PlaceError::NoWordStarts(4)));
        assert_eq!(word_place_of("zzz", 5), Err(PlaceError::UnknownWord(5)));
    }

    #[test]
    fn a_phrase_needs_a_count_and_a_mark() {
        assert_eq!(
            WordSearch::unknown_words("abandon about").unwrap_err(),
            PlaceError::PlaceCount
        );
        assert_eq!(
            WordSearch::unknown_words(TWELVE).unwrap_err(),
            PlaceError::NoPlaceMarked
        );
        let missing = WordSearch::missing_word(&TWELVE.replacen("abandon ", "", 1)).unwrap();
        assert_eq!(missing.word_count(), 12);
        assert_eq!(missing.combinations(), 12 * 2048);
        assert_eq!(
            WordSearch::missing_word(TWELVE).unwrap_err(),
            PlaceError::WordCount
        );
    }

    #[test]
    fn the_checksum_is_the_one_bip39_gives() {
        let words = indexes_of(TWELVE);
        assert!(checksum_fits(&words));
        let mut wrong = words.clone();
        wrong[11] = 2;
        assert!(!checksum_fits(&wrong));
        let phrase = Phrase::parse(TWELVE).unwrap();
        assert_eq!(&*entropy_of_words(&words), &*phrase.entropy().unwrap());
        assert_eq!(last_word_checksum_bits(&words), "0011");
    }

    #[test]
    fn the_expected_count_is_exact_with_a_whole_last_place() {
        let last = WordSearch::unknown_words(&TWELVE.replace("about", "?")).unwrap();
        assert_eq!(
            last.expected(),
            ExpectedCandidates {
                count: 128,
                exact: true
            }
        );
        let first = WordSearch::unknown_words(&TWELVE.replacen("abandon", "?", 1)).unwrap();
        assert_eq!(
            first.expected(),
            ExpectedCandidates {
                count: 128,
                exact: false
            }
        );
    }

    #[test]
    fn combinations_change_the_last_place_fastest() {
        let places = vec![
            Indexes::new(vec![1, 2]),
            Indexes::new(vec![5]),
            Indexes::new(vec![7, 8]),
        ];
        let mut walk = Combinations::new(places);
        let mut seen = Vec::new();
        while let Some(words) = walk.next_words() {
            seen.push(words.to_vec());
        }
        assert_eq!(seen, [[1, 5, 7], [1, 5, 8], [2, 5, 7], [2, 5, 8]]);
        assert_eq!(walk.next_words(), None);
    }

    #[test]
    fn an_insertion_repeats_no_phrase() {
        let mut walk = Insertions::new(Indexes::new(vec![0; 11]));
        let mut seen = std::collections::BTreeSet::new();
        let mut count = 0;
        while let Some(words) = walk.next_words() {
            seen.insert(words.to_vec());
            count += 1;
        }
        assert_eq!(count, seen.len());
        assert_eq!(count, 12 * 2048 - 11);
    }

    #[test]
    fn an_inserted_word_is_at_the_first_of_its_run() {
        assert_eq!(inserted_place(&[1, 2, 3], &[1, 2, 2, 3]), 1);
        assert_eq!(inserted_place(&[1, 2, 3], &[9, 1, 2, 3]), 0);
        assert_eq!(inserted_place(&[1, 2, 3], &[1, 2, 3, 9]), 3);
    }
}
