//! Forgotten Seedshift dates (MnemoCode TS 0.1.0's `core/date-recovery.ts` and
//! `core/date-search.ts`, CAP-RECOVERY-DATE-CANDIDATES, CAP-RECOVERY-DATE-SEARCH): every combination
//! that the date patterns allow is tried with the known dates, and each checksum-valid phrase is
//! compared with the wallet. A resumable search the host steps (ADR 0005): the time of a search is
//! told from public samples before the person consents. It does not ask, print or read files, and
//! it keeps no phrase beyond its outcome.

mod candidates;

use std::fmt;
use std::rc::Rc;

use super::wallet_check::WalletCheck;
use crate::bip39::phrase::{Phrase, PhraseError};
use crate::bip39::sizes::{SizesError, entropy_bytes};
use crate::dates::answer::{AnswerError, DatesAnswer};
use crate::dates::{Dates, DatesError};
use crate::modes::seedshift::Indexes;
use crate::modes::{Mode, ModeError};
use crate::refusal::{Refusal, RefusalKind};
use crate::search::plan::{SearchPlan, counted};
use crate::search::{CountRefused, Progress, Search, SearchSize, Step, kept_count};
use crate::secret::SecretText;
use crate::wallet::evidence::EvidenceError;
pub use candidates::{DateCandidate, DateCandidates};

/// Matches that a search keeps to show unless the host asks for another number.
pub const MAX_SHOWN_MATCHES: u64 = 100;
/// How a date search with more matches than a candidate list holds is narrowed.
pub const NARROW_DATE_SEARCH: &str = "narrow the dates, or give the wallet's fingerprint";
/// Wallet checks timed for an estimate: enough to smooth a first slow call, quick to make.
pub const PROBE_CHECKS: u32 = 3;
/// Combinations decoded for an estimate: some hundredths of a second, enough to be steady.
const PROBE_COMBINATIONS: u64 = 256;
/// The words of the public phrase that a wallet check is timed with.
const PROBE_WORDS: usize = 12;

/// Whether a mode gives a checksum-valid phrase for every date, so that only the wallet tells the
/// right dates.
pub const fn wallet_needed(mode: Mode) -> bool {
    mode.keeps_checksum()
}

/// Why the wallet is asked for before a date search in `mode`, or in a mode not known yet.
pub fn wallet_reason(mode: Option<Mode>) -> &'static str {
    if mode.is_some_and(wallet_needed) {
        "Each guessed date gives a valid phrase; the wallet tells which is yours."
    } else {
        "Several guessed dates may give a valid phrase; the wallet tells yours."
    }
}

/// The refusals of a date search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DateSearchError {
    /// The indexes are no phrase's.
    Sizes(SizesError),
    /// What the mode refuses of the codes or the dates.
    Mode(ModeError),
    /// What the dates refuse.
    Dates(DatesError),
    /// What the dates answer refuses.
    Answer(AnswerError),
    /// A count that the host passes.
    Count(CountRefused),
    /// What the wallet's evidence refuses of a phrase.
    Wallet(EvidenceError),
    /// A phrase the codes gave that is no phrase.
    Phrase(PhraseError),
}

impl DateSearchError {
    /// The refusal it holds.
    fn inner(&self) -> &dyn Refusal {
        match self {
            Self::Sizes(error) => error,
            Self::Mode(error) => error,
            Self::Dates(error) => error,
            Self::Answer(error) => error,
            Self::Count(error) => error,
            Self::Wallet(error) => error,
            Self::Phrase(error) => error,
        }
    }
}

// A deliberate copy of word_search.rs: each error enum forwards to what it holds.
impl fmt::Display for DateSearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self.inner(), f)
    }
}

impl std::error::Error for DateSearchError {}

impl Refusal for DateSearchError {
    fn code(&self) -> &'static str {
        self.inner().code()
    }

    fn kind(&self) -> RefusalKind {
        self.inner().kind()
    }
}

impl From<ModeError> for DateSearchError {
    fn from(error: ModeError) -> Self {
        Self::Mode(error)
    }
}

impl From<DatesError> for DateSearchError {
    fn from(error: DatesError) -> Self {
        Self::Dates(error)
    }
}

impl From<EvidenceError> for DateSearchError {
    fn from(error: EvidenceError) -> Self {
        Self::Wallet(error)
    }
}

impl From<PhraseError> for DateSearchError {
    fn from(error: PhraseError) -> Self {
        Self::Phrase(error)
    }
}

/// How fast a search goes in a host, in seconds, from what it timed of the public samples.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SearchPace {
    /// One wallet check; 0 without one.
    pub per_check: f64,
    /// Decoding one combination of the dates.
    pub per_combination: f64,
}

/// The combinations a decoding sample decodes, of `combinations`.
pub fn decoded_in_sample(combinations: u64) -> u64 {
    combinations.clamp(1, PROBE_COMBINATIONS)
}

/// Seconds that one combination of the dates takes at `pace`, with `checks` wallet checks.
pub fn seconds_each(pace: SearchPace, checks: f64) -> f64 {
    pace.per_combination + checks * pace.per_check
}

/// The wallet checks of the public phrase that a host times, [`PROBE_CHECKS`] of them.
pub fn wallet_sample(wallet: &WalletCheck) -> Result<(), DateSearchError> {
    let phrase = zero_phrase(PROBE_WORDS)?;
    for _ in 0..PROBE_CHECKS {
        std::hint::black_box(wallet.check(&phrase)?);
    }
    Ok(())
}

/// The public phrase of `word_count` words with all-zero entropy, which the decoding and the wallet
/// check are timed with.
fn zero_phrase(word_count: usize) -> Result<Phrase, PhraseError> {
    Phrase::of_entropy(&vec![0; entropy_bytes(word_count)])
}

/// The decoding of the first combinations of `dates` in `mode`, on the public phrase of
/// `word_count` words, that a host times: how many it decoded. Its length counts: with a valid last
/// word, the Original Seedshift decodes 2^(11 - checksum bits) phrases for each combination.
pub fn decoding_sample(
    mode: Mode,
    dates: &DatesAnswer,
    word_count: usize,
) -> Result<u64, DateSearchError> {
    let public = zero_phrase(word_count)?;
    let indexes = (0..word_count)
        .map(|place| public.index(place).unwrap_or(0) as u16)
        .collect();
    let mut candidates = DateCandidates::new(Indexes::new(indexes), dates, mode)?;
    let mut decoded = 0;
    while decoded < PROBE_COMBINATIONS {
        if std::hint::black_box(candidates.next_combination()?).is_none() {
            break;
        }
        decoded += 1;
    }
    Ok(decoded)
}

/// A match: its dates, its phrase, and its path.
#[derive(Debug)]
pub struct DateMatch {
    /// The dates that were guessed, as DD-MM-YYYY joined by spaces: what the search found.
    pub dates: SecretText,
    /// Every date that decodes the codes to `phrase`, the known ones with the guessed, sorted.
    pub all_dates: Dates,
    /// The seed phrase that the codes give with these dates, its BIP39 checksum valid.
    pub phrase: Phrase,
    /// Where the wallet matched; none without a wallet check, or a match without a path.
    pub evidence: Option<String>,
    /// What the wallet check said of the match, such as that a master fingerprint is only a filter.
    pub warning: Option<&'static str>,
}

/// What a search found.
#[derive(Debug)]
pub struct DateSearchOutcome {
    /// The date combinations searched.
    pub combinations: u64,
    /// The candidates with a valid BIP39 checksum.
    pub checksum_valid: u64,
    /// The candidates that matched the wallet, or every checksum-valid one without a wallet.
    pub match_count: u64,
    /// The first matches, as many as asked to be shown.
    pub shown: Vec<DateMatch>,
    /// The phrase of every match, as many as asked to be kept.
    pub kept: Vec<Phrase>,
    /// The first warning that the wallet check gave with a match.
    pub warning: Option<&'static str>,
    /// The date combinations checked: all of them, unless the search was stopped.
    pub checked: u64,
    /// Whether the host stopped the search: the counts and matches cover only what it checked.
    pub stopped: bool,
}

/// How many matches a date search shows and keeps: the host's, or by default
/// [`MAX_SHOWN_MATCHES`] shown and none kept.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MatchLimits {
    /// How many matches are kept to be shown.
    pub max_shown: Option<u64>,
    /// How many match phrases are kept, for a candidate list.
    pub keep: Option<u64>,
}

/// The counts of `limits`, refused unless each is a whole number of 0 or more.
pub fn match_counts(limits: MatchLimits) -> Result<(u64, u64), CountRefused> {
    Ok((
        kept_count(limits.max_shown, MAX_SHOWN_MATCHES, "maxShown", 0)?,
        kept_count(limits.keep, 0, "keep", 0)?,
    ))
}

/// One search for the forgotten digits of the dates: built once with its phrase, dates, mode and
/// wallet check, which it checks against each other, it tells its size and work before it runs, as
/// a page shows them before the person starts it.
#[derive(Debug)]
pub struct DateSearch {
    dates: Rc<DatesAnswer>,
    mode: Mode,
    word_count: usize,
    wallet: Option<Rc<WalletCheck>>,
    candidates: DateCandidates,
    max_shown: u64,
    keep: u64,
    checked: u64,
    outcome: DateSearchOutcome,
    done: bool,
}

impl DateSearch {
    /// The search of `indexes`, in `mode`, with `dates`, each checksum-valid phrase compared with
    /// `wallet`, or kept without one.
    pub fn new(
        indexes: Indexes,
        dates: Rc<DatesAnswer>,
        mode: Mode,
        wallet: Option<Rc<WalletCheck>>,
        limits: MatchLimits,
    ) -> Result<Self, DateSearchError> {
        indexes.check().map_err(DateSearchError::Sizes)?;
        if !mode.masked() {
            return Err(ModeError::Unsupported.into());
        }
        let word_count = indexes.as_slice().len();
        if !dates.fits_phrase(word_count) {
            return Err(DateSearchError::Answer(AnswerError::TooManyDates(
                word_count,
            )));
        }
        let (max_shown, keep) = match_counts(limits).map_err(DateSearchError::Count)?;
        let combinations = dates.combinations();
        Ok(Self {
            candidates: DateCandidates::new(indexes, &dates, mode)?,
            dates,
            mode,
            word_count,
            wallet,
            max_shown,
            keep,
            checked: 0,
            outcome: DateSearchOutcome {
                combinations,
                checksum_valid: 0,
                match_count: 0,
                shown: Vec::new(),
                kept: Vec::new(),
                warning: None,
                checked: 0,
                stopped: false,
            },
            done: false,
        })
    }

    /// The date combinations that the search tries.
    pub fn combinations(&self) -> u64 {
        self.outcome.combinations
    }

    /// The pace of this search from the seconds a host timed of each part of its sample.
    pub fn pace(&self, seconds: &[f64]) -> SearchPace {
        let (checks, decoding) = match (&self.wallet, seconds) {
            (Some(_), [checks, decoding, ..]) => (*checks / f64::from(PROBE_CHECKS), *decoding),
            (None, [decoding, ..]) => (0.0, *decoding),
            _ => (0.0, 0.0),
        };
        SearchPace {
            per_check: checks,
            per_combination: decoding / decoded_in_sample(self.combinations()) as f64,
        }
    }

    /// The checksum-valid phrases, so the wallet checks, that one combination gives on average.
    pub fn checks(&self) -> Result<f64, ModeError> {
        self.mode.checks_per_combination(self.word_count)
    }

    /// About how many seconds the search takes at `pace`.
    pub fn estimated_seconds(&self, pace: SearchPace) -> Result<f64, ModeError> {
        let checks = if self.wallet.is_some() {
            self.checks()?
        } else {
            0.0
        };
        Ok(self.combinations() as f64 * seconds_each(pace, checks))
    }

    /// The plan of the search at `pace`: asked for first when it tries more combinations than
    /// `limit`, the person's own limit, or without one takes longer than twelve hours.
    pub fn plan(&self, pace: SearchPace, limit: Option<u64>) -> Result<SearchPlan, ModeError> {
        let combinations = self.combinations();
        Ok(SearchPlan::new(
            counted(combinations, "date combination"),
            combinations,
            self.estimated_seconds(pace)?,
            limit,
        ))
    }

    /// The progress so far.
    fn progress(&self) -> Progress {
        Progress {
            checked: self.checked,
            total: Some(self.outcome.combinations),
            found: self.outcome.checksum_valid,
            matched: self.outcome.match_count,
        }
    }

    /// Compares `candidate` with the wallet and keeps it where it matches.
    fn weigh(&mut self, candidate: DateCandidate) -> Result<(), DateSearchError> {
        let outcome = &mut self.outcome;
        outcome.checksum_valid += 1;
        let answer = self
            .wallet
            .as_ref()
            .map(|wallet| wallet.check(&candidate.phrase))
            .transpose()?;
        if answer.as_ref().is_some_and(|answer| !answer.matched) {
            return Ok(());
        }
        outcome.match_count += 1;
        let warning = answer.as_ref().and_then(|answer| answer.warning);
        outcome.warning = outcome.warning.or(warning);
        if (outcome.kept.len() as u64) < self.keep {
            outcome.kept.push(candidate.phrase.copy());
        }
        if (outcome.shown.len() as u64) < self.max_shown {
            let written: Vec<String> = candidate
                .dates
                .iter()
                .map(|date| date.to_string())
                .collect();
            outcome.shown.push(DateMatch {
                dates: SecretText::copy_of("dates", &written.join(" ")),
                all_dates: candidate.all_dates,
                phrase: candidate.phrase,
                evidence: answer.and_then(|answer| answer.path),
                warning,
            });
        }
        Ok(())
    }
}

impl Search for DateSearch {
    type Outcome = DateSearchOutcome;
    type Error = DateSearchError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: self.outcome.combinations,
            pace_parts: if self.wallet.is_some() { 2 } else { 1 },
        }
    }

    fn pace_sample(&self, part: u8) -> Result<(), DateSearchError> {
        match &self.wallet {
            Some(wallet) if part == 0 => wallet_sample(wallet),
            _ => decoding_sample(self.mode, &self.dates, self.word_count).map(|_| ()),
        }
    }

    fn step(&mut self, work: u32) -> Result<Step, DateSearchError> {
        for _ in 0..work {
            let Some(candidates) = self.candidates.next_combination()? else {
                self.done = true;
                return Ok(Step::Done(self.progress()));
            };
            self.checked += 1;
            for candidate in candidates {
                self.weigh(candidate)?;
            }
            if self.checked == self.outcome.combinations {
                self.done = true;
                return Ok(Step::Done(self.progress()));
            }
        }
        Ok(Step::Running(self.progress()))
    }

    fn finish(self) -> DateSearchOutcome {
        DateSearchOutcome {
            checked: self.checked,
            stopped: !self.done,
            ..self.outcome
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::{Date, parse_date};
    use crate::wallet::evidence::Evidence;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn answer(line: &str) -> Rc<DatesAnswer> {
        Rc::new(DatesAnswer::parse(line, Some(12), true).unwrap())
    }

    /// The codes of the public phrase masked in `mode` with `dates`.
    fn masked(mode: Mode, dates: &[&str]) -> Indexes {
        let phrase = Phrase::parse(TWELVE).unwrap();
        let dates: Vec<Date> = dates.iter().map(|date| parse_date(date).unwrap()).collect();
        mode.encode(&phrase, &dates).unwrap().shifted
    }

    fn run(search: DateSearch) -> DateSearchOutcome {
        let mut search = search;
        while let Step::Running(_) = search.step(7).unwrap() {}
        search.finish()
    }

    #[test]
    fn a_wallet_tells_the_forgotten_digits() {
        let codes = masked(Mode::Seedshift, &["23-09-2026"]);
        let wallet = WalletCheck::new(Evidence::master_fingerprint("73c5da0a").unwrap(), "");
        let search = DateSearch::new(
            codes,
            answer("2?-09-2026"),
            Mode::Seedshift,
            Some(Rc::new(wallet)),
            MatchLimits::default(),
        )
        .unwrap();
        assert_eq!(search.size().pace_parts, 2);
        let outcome = run(search);
        assert_eq!(outcome.combinations, 10);
        assert_eq!(outcome.checked, 10);
        assert!(!outcome.stopped);
        assert_eq!(outcome.match_count, 1);
        assert_eq!(outcome.shown[0].dates.as_str(), "23-09-2026");
        assert_eq!(outcome.shown[0].phrase.text().as_str(), TWELVE);
        assert_eq!(outcome.shown[0].evidence.as_deref(), Some("m"));
        assert!(outcome.warning.is_some());
    }

    #[test]
    fn a_stopped_search_says_it_is_partial() {
        let codes = masked(Mode::Seedshift, &["23-09-2026"]);
        let mut search = DateSearch::new(
            codes,
            answer("2?-09-2026"),
            Mode::Seedshift,
            None,
            MatchLimits::default(),
        )
        .unwrap();
        assert!(
            matches!(search.step(4).unwrap(), Step::Running(progress) if progress.checked == 4)
        );
        let outcome = search.finish();
        assert!(outcome.stopped);
        assert_eq!(outcome.checked, 4);
    }

    #[test]
    fn dates_in_another_order_give_no_phrase_twice() {
        let codes = masked(Mode::Seedshift, &["01-01-2000", "02-01-2000"]);
        let search = DateSearch::new(
            codes,
            answer("0?-01-2000 0?-01-2000"),
            Mode::Seedshift,
            None,
            MatchLimits::default(),
        )
        .unwrap();
        // The same key in ascending order: 10 by 10 up to the order, the 45 combinations left.
        assert_eq!(search.combinations(), 45);
        let outcome = run(search);
        assert_eq!(outcome.checked, 45);
    }

    #[test]
    fn a_year_2048_years_later_shifts_alike() {
        let codes = masked(Mode::Seedshift, &["05-05-0100"]);
        let search = DateSearch::new(
            codes,
            answer("05-05-0100|2148"),
            Mode::Seedshift,
            None,
            MatchLimits::default(),
        )
        .unwrap();
        let outcome = run(search);
        assert_eq!(outcome.checked, 2);
        assert_eq!(outcome.match_count, 1);
    }
}
