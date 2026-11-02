//! The search for forgotten words (MnemoCode TS 0.1.0's `WordCandidateSearch` of
//! `core/candidates.ts` and `core/word-candidate.ts`, CAP-RECOVERY-WORD-SEARCH-MISSING,
//! CAP-RECOVERY-WORD-SEARCH-RUN): every combination of the places is checked against the BIP39
//! checksum, and the candidates come in one fixed order, so that candidate N is the same on
//! MnemoCode's screen, in the Wallet Deriver and in a candidate list. A resumable search the host
//! steps (ADR 0005): it compares each candidate with the wallet, keeps the first
//! [`MAX_SHOWN_CANDIDATES`] and every one that matched, and keeps the entropy of every candidate
//! for a list. It does not derive keys beyond the wallet check, save lists or print.

use std::fmt;

use std::rc::Rc;

use super::places::{
    Combinations, ExpectedCandidates, Insertions, NARROW_WORD_SEARCH, PlaceError, WordSearch,
    check_searchable, checksum_fits, entropy_of_words, inserted_place, last_word_checksum_bits,
};
use super::wallet_check::WalletCheck;
use crate::bip39::phrase::{Phrase, PhraseError};
use crate::bip39::sizes::entropy_bytes;
use crate::candidates::format::ListError;
use crate::modes::seedshift::Indexes;
use crate::refusal::{Refusal, RefusalKind};
use crate::search::plan::counting;
use crate::search::{CountRefused, Progress, Search, SearchSize, Step, kept_count};
use crate::secret::SecretBytes;
use crate::wallet::evidence::{EvidenceError, WalletMatch};

/// Candidates that a host shows at most, each with its number: enough for a word missing at an
/// unknown place of 12 words, about 1,500. More go to a candidate list, or through a wallet check
/// that shows only those that match.
pub const MAX_SHOWN_CANDIDATES: u64 = 2048;
/// How candidates that are not shown are told apart: by the wallet.
const CHECK_AGAINST_WALLET: &str = "check them against the wallet's fingerprint or an address";
/// How candidates that are not shown become fewer.
const GIVE_LETTERS: &str = "give a few letters of the words";

/// What a host says of `count` candidates that it does not show: that they do not fit on its
/// screen, or that they are too many to show. `save` is the host's own advice for saving them as a
/// list; without it they are too many to save as well.
pub fn unshown_candidates_notice(count: u64, save: Option<&str>) -> String {
    let counted = counting(count);
    if count <= MAX_SHOWN_CANDIDATES {
        return format!(
            "{counted} candidates do not fit on this screen: {CHECK_AGAINST_WALLET}, or {GIVE_LETTERS}."
        );
    }
    match save {
        Some(save) => {
            format!("{counted} candidates are too many to show: {save}, or {CHECK_AGAINST_WALLET}.")
        }
        None => format!(
            "{counted} candidates are too many to show or to save: {CHECK_AGAINST_WALLET}, or {GIVE_LETTERS}."
        ),
    }
}

/// The refusals of a word search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WordSearchError {
    /// What the places refuse.
    Place(PlaceError),
    /// A count that the host passes.
    Count(CountRefused),
    /// More candidates than a list holds, where the host stops there.
    List(ListError),
    /// What the wallet's evidence refuses of a phrase.
    Wallet(EvidenceError),
    /// A candidate that is no phrase.
    Phrase(PhraseError),
}

impl WordSearchError {
    /// The refusal it holds.
    fn inner(&self) -> &dyn Refusal {
        match self {
            Self::Place(error) => error,
            Self::Count(error) => error,
            Self::List(error) => error,
            Self::Wallet(error) => error,
            Self::Phrase(error) => error,
        }
    }
}

// A deliberate copy of date_search.rs: each error enum forwards to what it holds.
impl fmt::Display for WordSearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self.inner(), f)
    }
}

impl std::error::Error for WordSearchError {}

impl Refusal for WordSearchError {
    fn code(&self) -> &'static str {
        self.inner().code()
    }

    fn kind(&self) -> RefusalKind {
        self.inner().kind()
    }
}

impl From<EvidenceError> for WordSearchError {
    fn from(error: EvidenceError) -> Self {
        Self::Wallet(error)
    }
}

impl From<PhraseError> for WordSearchError {
    fn from(error: PhraseError) -> Self {
        Self::Phrase(error)
    }
}

/// One candidate, numbered from 1 in the order found.
#[derive(Debug)]
pub struct WordCandidate {
    number: u64,
    words: Indexes,
}

impl WordCandidate {
    /// Its number among its search's candidates, from 1.
    pub const fn number(&self) -> u64 {
        self.number
    }

    /// Its BIP39 indexes.
    pub fn words(&self) -> &[u16] {
        self.words.as_slice()
    }

    /// Its phrase.
    pub fn phrase(&self) -> Result<Phrase, PhraseError> {
        let indexes: Vec<usize> = self.words().iter().map(|&word| usize::from(word)).collect();
        Phrase::of_indexes(&indexes)
    }

    /// The checksum bits of its last word.
    pub fn checksum_bits(&self) -> String {
        last_word_checksum_bits(self.words())
    }
}

/// A candidate kept to be shown, with what the wallet check said of it, where there was one.
#[derive(Debug)]
pub struct ShownCandidate {
    /// The candidate.
    pub candidate: WordCandidate,
    /// What the wallet check said of it.
    pub answer: Option<WalletMatch>,
    /// The places, from 0, whose words the search chose in it: the unknown places, or the place
    /// of the missing word, the first of a run of equal words.
    pub places: Vec<usize>,
}

/// The entropies a search keeps for a list, in a buffer that doubles as they come.
#[derive(Debug)]
struct EntropyList {
    bytes: SecretBytes,
    length: usize,
    count: usize,
}

impl EntropyList {
    /// A list of entropies of `length` bytes, with room for `room` of them.
    fn new(length: usize, room: usize) -> Self {
        Self {
            bytes: SecretBytes::zeroed("a list's entropies", length * room.max(1)),
            length,
            count: 0,
        }
    }

    /// Adds `entropy`.
    fn push(&mut self, entropy: &[u8]) {
        let end = (self.count + 1) * self.length;
        if end > self.bytes.len() {
            let mut grown = SecretBytes::zeroed("a list's entropies", 2 * self.bytes.len());
            grown[..self.bytes.len()].copy_from_slice(&self.bytes);
            self.bytes = grown;
        }
        self.bytes[end - self.length..end].copy_from_slice(entropy);
        self.count += 1;
    }

    /// The entropies, one after another.
    fn taken(self) -> SecretBytes {
        SecretBytes::copy_of(
            "a list's entropies",
            &self.bytes[..self.count * self.length],
        )
    }
}

/// How a word search runs: what it keeps.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WordLimits {
    /// How many candidates are kept to be shown, besides those that matched;
    /// [`MAX_SHOWN_CANDIDATES`] by default.
    pub max_shown: Option<u64>,
    /// How many entropies are kept for a candidate list; none by default.
    pub keep: Option<u64>,
    /// Whether the search stops, refused, when the candidates are more than `keep`.
    pub stop_when_full: bool,
}

/// What a word search found.
#[derive(Debug)]
pub struct WordSearchOutcome {
    /// The first candidates, as many as asked to be shown, and every later match.
    pub shown: Vec<ShownCandidate>,
    /// The entropy of every candidate for a list, one after another, record N for candidate N.
    pub entropies: SecretBytes,
    /// The candidates found, all of them.
    pub count: u64,
    /// The candidates that matched the wallet.
    pub matched: u64,
    /// The first warning of the wallet check, such as that a fingerprint is only a filter.
    pub warning: Option<&'static str>,
    /// Whether the candidates were more than `keep`, so that no list holds them.
    pub list_full: bool,
    /// Whether the host stopped the search: the counts and candidates cover only those checked
    /// before the stop, and no entropy is kept, since no list of a part is complete.
    pub stopped: bool,
}

/// Where a search stands among its combinations.
#[derive(Debug)]
enum Walk {
    Places(Combinations),
    Insertions(Insertions),
}

impl Walk {
    /// The next combination whose checksum is valid, inner none past the last; none where `work`
    /// ran out first.
    fn next_candidate(&mut self, work: &mut u32) -> Option<Option<Indexes>> {
        while *work > 0 {
            *work -= 1;
            let words = match self {
                Self::Places(walk) => walk.next_words(),
                Self::Insertions(walk) => walk.next_words(),
            };
            let Some(words) = words else {
                return Some(None);
            };
            if checksum_fits(words) {
                return Some(Some(Indexes::new(words.to_vec())));
            }
        }
        None
    }
}

/// One search for forgotten words: it checks itself once, so that one of more than 2^24
/// combinations cannot exist, and tells its size and the candidates it will find before it runs, as
/// a page shows them while the person types.
#[derive(Debug)]
pub struct WordCandidateSearch {
    search: WordSearch,
    walk: Walk,
    wallet: Option<Rc<WalletCheck>>,
    max_shown: u64,
    keep: u64,
    stop_when_full: bool,
    shown: Vec<ShownCandidate>,
    entropies: Option<EntropyList>,
    count: u64,
    matched: u64,
    warning: Option<&'static str>,
    list_full: bool,
    done: bool,
}

impl WordCandidateSearch {
    /// The search of `search`, each candidate compared with `wallet`, if any; refused for more
    /// combinations than a search takes and a count that is no whole number of 0 or more.
    pub fn new(
        search: WordSearch,
        wallet: Option<Rc<WalletCheck>>,
        limits: WordLimits,
    ) -> Result<Self, WordSearchError> {
        check_searchable(search.combinations(), NARROW_WORD_SEARCH)
            .map_err(WordSearchError::Place)?;
        let max_shown = kept_count(limits.max_shown, MAX_SHOWN_CANDIDATES, "maxShown", 0)
            .map_err(WordSearchError::Count)?;
        let keep = kept_count(limits.keep, 0, "keep", 0).map_err(WordSearchError::Count)?;
        let walk = match &search {
            WordSearch::UnknownWords(places) => Walk::Places(Combinations::new(places.clone())),
            WordSearch::MissingWord(written) => Walk::Insertions(Insertions::new(written.clone())),
        };
        let room = keep.min(search.expected().count) as usize;
        let length = entropy_bytes(search.word_count());
        Ok(Self {
            walk,
            wallet,
            max_shown,
            keep,
            stop_when_full: limits.stop_when_full,
            shown: Vec::new(),
            entropies: (keep > 0).then(|| EntropyList::new(length, room)),
            count: 0,
            matched: 0,
            warning: None,
            list_full: false,
            done: false,
            search,
        })
    }

    /// The words of every candidate: 12, 15, 18, 21 or 24.
    pub fn word_count(&self) -> usize {
        self.search.word_count()
    }

    /// The combinations that the search checks, at most 2^24.
    pub fn combinations(&self) -> u64 {
        self.search.combinations()
    }

    /// How many candidates the search finds.
    pub fn expected(&self) -> ExpectedCandidates {
        self.search.expected()
    }

    /// The places, from 0, that may hold more than one word; none for a missing word, whose place
    /// each candidate has on its own.
    pub fn unknown_places(&self) -> Vec<usize> {
        self.search.unknown_places()
    }

    /// The places, from 0, whose words the search chose in `candidate`.
    fn places_of(&self, candidate: &WordCandidate) -> Vec<usize> {
        match &self.search {
            WordSearch::UnknownWords(_) => self.unknown_places(),
            WordSearch::MissingWord(written) => {
                vec![inserted_place(written.as_slice(), candidate.words())]
            }
        }
    }

    /// The progress so far: every candidate counted is a phrase whose BIP39 checksum holds.
    fn progress(&self) -> Progress {
        Progress {
            checked: self.count,
            total: None,
            found: self.count,
            matched: self.matched,
        }
    }

    /// Compares `words`, a candidate, with the wallet, and keeps what a host shows and saves.
    fn weigh(&mut self, words: Indexes) -> Result<(), WordSearchError> {
        self.count += 1;
        let candidate = WordCandidate {
            number: self.count,
            words,
        };
        let answer = match &self.wallet {
            Some(wallet) => Some(wallet.check(&candidate.phrase()?)?),
            None => None,
        };
        if self.keep > 0 && !self.list_full && self.count > self.keep {
            self.list_full = true;
            self.entropies = None;
            if self.stop_when_full {
                return Err(WordSearchError::List(ListError::TooManyForList(
                    NARROW_WORD_SEARCH.to_owned(),
                )));
            }
        }
        let matched = answer.as_ref().is_some_and(|answer| answer.matched);
        self.matched += u64::from(matched);
        self.warning = self
            .warning
            .or(answer.as_ref().and_then(|answer| answer.warning));
        if let Some(list) = &mut self.entropies {
            list.push(&entropy_of_words(candidate.words()));
        }
        if self.count <= self.max_shown || matched {
            let places = self.places_of(&candidate);
            self.shown.push(ShownCandidate {
                candidate,
                answer,
                places,
            });
        }
        Ok(())
    }
}

impl Search for WordCandidateSearch {
    type Outcome = WordSearchOutcome;
    type Error = WordSearchError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: self.combinations(),
            pace_parts: 0,
        }
    }

    fn pace_sample(&self, _part: u8) -> Result<(), WordSearchError> {
        Ok(())
    }

    fn step(&mut self, work: u32) -> Result<Step, WordSearchError> {
        let mut left = work;
        while let Some(found) = self.walk.next_candidate(&mut left) {
            match found {
                Some(words) => self.weigh(words)?,
                None => {
                    self.done = true;
                    return Ok(Step::Done(self.progress()));
                }
            }
        }
        Ok(Step::Running(self.progress()))
    }

    fn finish(self) -> WordSearchOutcome {
        let kept = self.entropies.filter(|_| self.done);
        WordSearchOutcome {
            shown: self.shown,
            entropies: kept.map_or_else(
                || SecretBytes::zeroed("no entropies", 0),
                EntropyList::taken,
            ),
            count: self.count,
            matched: self.matched,
            warning: self.warning,
            list_full: self.list_full,
            stopped: !self.done,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wallet::evidence::Evidence;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn run(search: &mut WordCandidateSearch) {
        while let Step::Running(_) = search.step(100).unwrap() {}
    }

    #[test]
    fn the_last_word_has_as_many_candidates_as_the_count_says() {
        let places = WordSearch::unknown_words(&TWELVE.replace("about", "?")).unwrap();
        let mut search = WordCandidateSearch::new(places, None, WordLimits::default()).unwrap();
        assert_eq!(search.combinations(), 2048);
        assert_eq!(search.unknown_places(), [11]);
        run(&mut search);
        let outcome = search.finish();
        assert_eq!(outcome.count, 128);
        assert_eq!(outcome.shown.len(), 128);
        assert_eq!(outcome.shown[0].candidate.number(), 1);
        assert_eq!(outcome.shown[0].candidate.checksum_bits(), "0011");
        assert!(!outcome.stopped);
    }

    #[test]
    fn a_wallet_keeps_every_match_beyond_those_shown() {
        let wallet = WalletCheck::new(Evidence::master_fingerprint("73c5da0a").unwrap(), "");
        let places = WordSearch::unknown_words(&TWELVE.replace("about", "abo*")).unwrap();
        let limits = WordLimits {
            max_shown: Some(0),
            ..WordLimits::default()
        };
        let mut search = WordCandidateSearch::new(places, Some(Rc::new(wallet)), limits).unwrap();
        run(&mut search);
        let outcome = search.finish();
        assert_eq!(outcome.matched, 1);
        assert_eq!(outcome.shown.len(), 1);
        assert_eq!(
            outcome.shown[0].candidate.phrase().unwrap().text().as_str(),
            TWELVE
        );
        assert!(outcome.warning.is_some());
    }

    #[test]
    fn a_list_keeps_every_entropy_or_says_it_is_full() {
        let places = WordSearch::unknown_words(&TWELVE.replace("about", "?")).unwrap();
        let limits = WordLimits {
            keep: Some(128),
            ..WordLimits::default()
        };
        let mut search = WordCandidateSearch::new(places, None, limits).unwrap();
        run(&mut search);
        let outcome = search.finish();
        assert_eq!(outcome.entropies.len(), 128 * 16);
        assert!(!outcome.list_full);

        let places = WordSearch::unknown_words(&TWELVE.replace("about", "?")).unwrap();
        let limits = WordLimits {
            keep: Some(127),
            ..WordLimits::default()
        };
        let mut search = WordCandidateSearch::new(places, None, limits).unwrap();
        run(&mut search);
        let outcome = search.finish();
        assert!(outcome.entropies.is_empty());
        assert!(outcome.list_full);

        let places = WordSearch::unknown_words(&TWELVE.replace("about", "?")).unwrap();
        let limits = WordLimits {
            keep: Some(127),
            stop_when_full: true,
            ..WordLimits::default()
        };
        let mut search = WordCandidateSearch::new(places, None, limits).unwrap();
        let refused = loop {
            match search.step(100) {
                Ok(_) => {}
                Err(error) => break error,
            }
        };
        assert_eq!(
            refused.code(),
            ListError::TooManyForList(String::new()).code()
        );
    }

    #[test]
    fn a_stopped_search_keeps_no_list() {
        let places = WordSearch::unknown_words(&TWELVE.replace("about", "?")).unwrap();
        let limits = WordLimits {
            keep: Some(1000),
            ..WordLimits::default()
        };
        let mut search = WordCandidateSearch::new(places, None, limits).unwrap();
        assert!(matches!(search.step(100).unwrap(), Step::Running(_)));
        let outcome = search.finish();
        assert!(outcome.stopped);
        assert!(outcome.count > 0);
        assert!(outcome.entropies.is_empty());
    }

    #[test]
    fn a_missing_word_names_its_place() {
        let written = TWELVE.replacen("abandon ", "", 1);
        let search = WordSearch::missing_word(&written).unwrap();
        let mut search = WordCandidateSearch::new(search, None, WordLimits::default()).unwrap();
        run(&mut search);
        let count = search.expected().count;
        let found = search.count;
        assert!(found > 0 && count > 0);
        assert_eq!(search.shown[0].places.len(), 1);
    }
}
