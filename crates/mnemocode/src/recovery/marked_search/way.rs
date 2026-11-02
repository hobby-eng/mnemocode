//! One way of the search of marked codes, prepared with its answers: its plan first, then its run,
//! which the host steps (MnemoCode TS 0.1.0's way classes of `core/missing-codes-search.ts`).

use std::rc::Rc;

use super::{
    MAX_LISTED, MarkedSearchError, MissingCodesFound, MissingCodesResult, MissingCodesRow,
    listed_row, listed_text, several_sets, texts,
};
use crate::backup::Backup;
use crate::bip32::{ExtendedKey, fingerprint_hex};
use crate::bip39::phrase::Phrase;
use crate::bip39::sizes::entropy_bytes;
use crate::dates::answer::DatesAnswer;
use crate::dates::{Date, Dates};
use crate::modes::Mode;
use crate::modes::seedshift::Indexes;
use crate::recovery::date_search::{
    DateMatch, DateSearch, MatchLimits, PROBE_CHECKS, SearchPace, decoded_in_sample,
    decoding_sample, seconds_each, wallet_sample,
};
use crate::recovery::marked::{MAX_FOUND_CODES, MarkedCandidates, MissingCodes};
use crate::recovery::wallet_check::WalletCheck;
use crate::search::plan::{SearchPlan, counted};
use crate::search::{Progress, Search, SearchSize, Step};
use crate::secret::SecretText;
use crate::wallet::evidence::FINGERPRINT_WARNING;

/// The phrases that `backup` gives with `dates` and that pass their own checksum.
fn phrases_of(backup: &Backup, dates: &[Date]) -> Result<Vec<Phrase>, MarkedSearchError> {
    let mut phrases = Vec::new();
    for result in backup.candidates(dates)? {
        if result.checksum_valid {
            let indexes: Vec<usize> = result
                .recovered
                .as_slice()
                .iter()
                .map(|&index| usize::from(index))
                .collect();
            phrases.push(Phrase::of_indexes(&indexes)?);
        }
    }
    Ok(phrases)
}

/// The master fingerprint of `phrase` with an empty BIP39 passphrase.
fn fingerprint_of(phrase: &Phrase) -> Result<String, MarkedSearchError> {
    Ok(fingerprint_hex(
        ExtendedKey::of_phrase(phrase, "")?.fingerprint()?,
    ))
}

/// What is known of the search of one way where its dates have forgotten digits.
#[derive(Debug)]
pub(super) struct WalletAndDates {
    pub(super) wallet: Rc<WalletCheck>,
    pub(super) dates: Rc<DatesAnswer>,
    /// The date search of the candidate at hand, with its codes.
    pub(super) current: Option<(DateSearch, Indexes)>,
    /// The match of the first set of codes and dates that matched.
    pub(super) first: Option<DateMatch>,
    /// Each phrase that the wallet check passed, once over the whole search: one phrase reached by
    /// several sets of codes and dates is one wallet.
    pub(super) phrases: Vec<Phrase>,
    /// How many sets of codes and dates passed.
    pub(super) sets: u64,
}

/// How a way tells the right codes.
#[derive(Debug)]
pub(super) enum Test {
    Encoded {
        fingerprint: String,
    },
    Wallet {
        wallet: Rc<WalletCheck>,
        dates: Dates,
    },
    WalletAndDates(Box<WalletAndDates>),
    List {
        dates: Dates,
    },
}

/// The date combinations that one turn of a candidate's date search tries at most.
const MOST_DATE_WORK: u32 = 1 << 16;

/// One way prepared with its answers: its plan first, then its run, which the host steps.
#[derive(Debug)]
pub struct WaySearch {
    codes: MissingCodes,
    candidates: MarkedCandidates,
    test: Test,
    max_found: u64,
    found: Vec<Backup>,
    passed: u64,
    count: u64,
    warning: Option<&'static str>,
    result: Option<MissingCodesResult>,
}

impl WaySearch {
    pub(super) fn new(codes: MissingCodes, test: Test, max_found: Option<u64>) -> Self {
        Self {
            candidates: codes.candidates(),
            codes,
            test,
            max_found: max_found.unwrap_or(MAX_FOUND_CODES),
            found: Vec::new(),
            passed: 0,
            count: 0,
            warning: None,
            result: None,
        }
    }

    /// Seconds of each candidate from the seconds a host timed of the sample's parts.
    fn seconds_each(&self, seconds: &[f64]) -> Result<f64, MarkedSearchError> {
        let word_count = self.codes.word_count();
        Ok(match &self.test {
            Test::Encoded { .. } => {
                seconds.first().copied().unwrap_or(0.0) / f64::from(PROBE_CHECKS)
            }
            Test::Wallet { .. } => {
                let per_check = seconds.first().copied().unwrap_or(0.0) / f64::from(PROBE_CHECKS);
                let decoding = seconds.get(1).copied().unwrap_or(0.0);
                decoding + self.codes.mode().checks_per_decoding(word_count)? * per_check
            }
            Test::WalletAndDates(way) => {
                let per_check = seconds.first().copied().unwrap_or(0.0) / f64::from(PROBE_CHECKS);
                let decoding = seconds.get(1).copied().unwrap_or(0.0);
                let decoded = decoded_in_sample(way.dates.combinations()) as f64;
                let pace = SearchPace {
                    per_check,
                    per_combination: decoding / decoded,
                };
                let checks = self.codes.mode().checks_per_combination(word_count)?;
                way.dates.combinations() as f64 * seconds_each(pace, checks)
            }
            Test::List { .. } => 0.0,
        })
    }

    /// The size of the search and about how long it takes here, from the seconds a host timed of
    /// each part of its sample; asked for first when it tries more than `limit`, the person's own
    /// limit, or without one takes longer than twelve hours.
    pub fn plan(
        &self,
        seconds: &[f64],
        limit: Option<u64>,
    ) -> Result<SearchPlan, MarkedSearchError> {
        let expected = self.codes.expected();
        let total = expected as f64 * self.seconds_each(seconds)?;
        Ok(match &self.test {
            Test::Encoded { .. } | Test::Wallet { .. } => {
                SearchPlan::new(counted(expected, "candidate"), expected, total, limit)
            }
            Test::WalletAndDates(way) => {
                let combinations = way.dates.combinations();
                let size = format!(
                    "{} with {} each",
                    counted(expected, "candidate"),
                    counted(combinations, "date combination")
                );
                // No candidate at all: nothing to try or time, and the run finds none at once.
                if self.codes.candidates().next_codes().is_none() {
                    return Ok(SearchPlan::new(size, 0, 0.0, limit));
                }
                SearchPlan::new(size, expected.saturating_mul(combinations), total, limit)
            }
            // Said as the list's rows; counted as the sets of codes that a limit of candidates
            // counts.
            Test::List { .. } => SearchPlan::new(listed_text(&self.codes)?, expected, 0.0, limit),
        })
    }

    /// Whether `codes`, a candidate, pass the way's test; for the date search of a candidate, none
    /// until it ended.
    fn passes(
        &mut self,
        codes: &Indexes,
        work: &mut u32,
    ) -> Result<Option<bool>, MarkedSearchError> {
        let (form, mode) = (self.codes.form(), self.codes.mode());
        match &mut self.test {
            Test::Encoded { fingerprint } => {
                let indexes: Vec<usize> = codes
                    .as_slice()
                    .iter()
                    .map(|&code| usize::from(code))
                    .collect();
                let matched = fingerprint_of(&Phrase::of_indexes(&indexes)?)? == *fingerprint;
                if matched {
                    self.warning = Some(FINGERPRINT_WARNING);
                }
                *work = work.saturating_sub(1);
                Ok(Some(matched))
            }
            Test::Wallet { wallet, dates } => {
                let backup = Backup::of(codes.as_slice(), form, mode)?;
                let dates: Vec<Date> = dates.iter().collect();
                *work = work.saturating_sub(1);
                for phrase in phrases_of(&backup, &dates)? {
                    let answer = wallet.check(&phrase)?;
                    if answer.matched {
                        self.warning = self.warning.or(answer.warning);
                        return Ok(Some(true));
                    }
                }
                Ok(Some(false))
            }
            Test::List { .. } => {
                *work = work.saturating_sub(1);
                Ok(Some(true))
            }
            Test::WalletAndDates(way) => way.step(codes, mode, work),
        }
    }

    /// The result of a search that ended.
    fn result_of(&mut self) -> Result<MissingCodesResult, MarkedSearchError> {
        let test = std::mem::replace(
            &mut self.test,
            Test::List {
                dates: Dates::new(&[]),
            },
        );
        match test {
            Test::Encoded { .. } => Ok(self.found_one(texts::NONE_BY_FINGERPRINT, None)),
            Test::Wallet { dates, .. } => Ok(self.found_one(texts::NONE_BY_WALLET, Some(dates))),
            Test::WalletAndDates(way) => self.found_with_dates(*way),
            Test::List { dates } => self.rows(&dates),
        }
    }

    /// The one set found, none, or several, as a result.
    fn found_one(&mut self, nothing: &'static str, dates: Option<Dates>) -> MissingCodesResult {
        // Counted by every set that passed, as the progress counts them, not by those kept.
        if self.passed > 1 {
            return several_sets(self.passed, "codes");
        }
        self.found
            .pop()
            .map_or(MissingCodesResult::None(nothing), |backup| {
                MissingCodesResult::Found(Box::new(MissingCodesFound {
                    backup,
                    dates,
                    found_dates: None,
                    others: None,
                    warning: self.warning,
                }))
            })
    }

    /// The result where codes and dates were found together: two phrases fit, which a fingerprint
    /// leaves only by chance, whether they differ in their codes or only in their dates; or one.
    fn found_with_dates(
        &mut self,
        way: WalletAndDates,
    ) -> Result<MissingCodesResult, MarkedSearchError> {
        if way.phrases.len() > 1 {
            return Ok(several_sets(way.phrases.len() as u64, "codes and dates"));
        }
        let (Some(backup), Some(first)) = (self.found.pop(), way.first) else {
            return Ok(MissingCodesResult::None(texts::NONE_BY_WALLET));
        };
        // The codes are decoded with every date, the known ones too: the guessed ones alone give
        // another phrase (AUD-012-FUN001). Checked here, so that no host decodes another wallet.
        let dates: Vec<Date> = first.all_dates.iter().collect();
        let matched = first.phrase.text();
        let decoded = phrases_of(&backup, &dates)?;
        if !decoded
            .iter()
            .any(|phrase| phrase.text().as_str() == matched.as_str())
        {
            return Err(MarkedSearchError::OtherWallet);
        }
        Ok(MissingCodesResult::Found(Box::new(MissingCodesFound {
            backup,
            dates: Some(first.all_dates),
            found_dates: Some(first.dates),
            others: (way.sets > 1).then(|| way.sets - 1),
            warning: first.warning,
        })))
    }

    /// The rows of a list; refused where more fit than it holds.
    fn rows(&self, dates: &Dates) -> Result<MissingCodesResult, MarkedSearchError> {
        // The expected count is an average; `passed` counts every candidate. Where one set gives
        // several phrases, more sets than the list holds give more phrases too.
        let overflow = MarkedSearchError::ListOverflow(if listed_row(&self.codes) == "phrase" {
            "phrases"
        } else {
            "candidates"
        });
        if self.passed > MAX_LISTED {
            return Err(overflow);
        }
        let dates: Vec<Date> = dates.iter().collect();
        let mut rows = Vec::new();
        for backup in &self.found {
            for phrase in phrases_of(backup, &dates)? {
                // One set of legacy valid-last-word codes may decode to several phrases.
                if rows.len() as u64 == MAX_LISTED {
                    return Err(overflow);
                }
                let fingerprint = fingerprint_of(&phrase)?;
                rows.push(MissingCodesRow {
                    codes: SecretText::copy_of("codes", &backup.text()?),
                    phrase,
                    fingerprint,
                });
            }
        }
        Ok(MissingCodesResult::List(rows))
    }

    /// The progress so far: `total` is about how many candidates the search checks.
    fn progress(&self) -> Progress {
        Progress {
            checked: self.count,
            total: Some(self.codes.expected()),
            found: self.passed,
            matched: self.passed,
        }
    }
}

impl WalletAndDates {
    /// Steps the date search of `codes`, a candidate: whether it passes once the search ended.
    fn step(
        &mut self,
        codes: &Indexes,
        mode: Mode,
        work: &mut u32,
    ) -> Result<Option<bool>, MarkedSearchError> {
        let (mut search, of) = match self.current.take() {
            Some(running) => running,
            None => {
                let limits = MatchLimits {
                    max_shown: Some(1),
                    keep: Some(u64::from(u32::MAX)),
                };
                let search = DateSearch::new(
                    codes.clone(),
                    Rc::clone(&self.dates),
                    mode,
                    Some(Rc::clone(&self.wallet)),
                    limits,
                )?;
                (search, codes.clone())
            }
        };
        let turn = (*work).clamp(1, MOST_DATE_WORK);
        let step = search.step(turn)?;
        *work = work.saturating_sub(turn);
        if matches!(step, Step::Running(_)) {
            self.current = Some((search, of));
            return Ok(None);
        }
        let mut outcome = search.finish();
        self.sets += outcome.match_count;
        for phrase in outcome.kept.drain(..) {
            let text = phrase.text();
            if !self
                .phrases
                .iter()
                .any(|known| known.text().as_str() == text.as_str())
            {
                self.phrases.push(phrase);
            }
        }
        let first = outcome.shown.pop();
        let passed = first.is_some();
        if self.first.is_none() {
            self.first = first;
        }
        Ok(Some(passed))
    }
}

impl Search for WaySearch {
    type Outcome = MissingCodesResult;
    type Error = MarkedSearchError;

    fn size(&self) -> SearchSize {
        let expected = self.codes.expected();
        let (candidates, pace_parts) = match &self.test {
            Test::Encoded { .. } => (expected, 1),
            Test::Wallet { .. } => (expected, 2),
            Test::WalletAndDates(way) => (expected.saturating_mul(way.dates.combinations()), 2),
            Test::List { .. } => (expected, 0),
        };
        SearchSize {
            candidates,
            pace_parts,
        }
    }

    fn pace_sample(&self, part: u8) -> Result<(), MarkedSearchError> {
        let public = Phrase::of_entropy(&vec![0; entropy_bytes(self.codes.word_count())])?;
        match (&self.test, part) {
            (Test::Encoded { .. }, _) => {
                for _ in 0..PROBE_CHECKS {
                    std::hint::black_box(fingerprint_of(&public)?);
                }
            }
            (Test::Wallet { wallet, .. }, 0) => wallet_sample(wallet)?,
            (Test::Wallet { dates, .. }, _) => {
                let indexes: Vec<u16> = (0..public.len())
                    .map(|place| public.index(place).unwrap_or(0) as u16)
                    .collect();
                let backup = Backup::of(&indexes, self.codes.form(), self.codes.mode())?;
                let dates: Vec<Date> = dates.iter().collect();
                std::hint::black_box(phrases_of(&backup, &dates)?);
            }
            (Test::WalletAndDates(way), 0) => wallet_sample(&way.wallet)?,
            (Test::WalletAndDates(way), _) => {
                let mode = self.codes.mode();
                std::hint::black_box(decoding_sample(mode, &way.dates, self.codes.word_count())?);
            }
            (Test::List { .. }, _) => {}
        }
        Ok(())
    }

    fn step(&mut self, work: u32) -> Result<Step, MarkedSearchError> {
        if self.result.is_some() {
            return Ok(Step::Done(self.progress()));
        }
        let mut left = work;
        loop {
            if left == 0 {
                return Ok(Step::Running(self.progress()));
            }
            // A candidate whose date search is under way goes on.
            let held = match &self.test {
                Test::WalletAndDates(way) => way.current.as_ref().map(|(_, codes)| codes.clone()),
                _ => None,
            };
            let codes = match held.or_else(|| self.candidates.next_codes()) {
                Some(codes) => codes,
                None => {
                    self.result = Some(self.result_of()?);
                    return Ok(Step::Done(self.progress()));
                }
            };
            let Some(passes) = self.passes(&codes, &mut left)? else {
                continue;
            };
            self.count += 1;
            if passes {
                self.passed += 1;
                if (self.found.len() as u64) < self.max_found {
                    let (form, mode) = (self.codes.form(), self.codes.mode());
                    self.found.push(Backup::of(codes.as_slice(), form, mode)?);
                }
            }
        }
    }

    fn finish(self) -> MissingCodesResult {
        self.result.unwrap_or(MissingCodesResult::Stopped)
    }
}
