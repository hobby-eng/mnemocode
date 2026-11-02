//! The seed phrases that restored sets of shares give (MnemoCode TS 0.1.0's
//! `sskr/share-unmasking.ts`, CAP-SSKR-UNMASK-SHARES, CAP-SSKR-WALLET-CHECK-SETS). Shares made
//! without Seedshift hold the seed phrase itself; shares of a phrase masked with MnemoCode Seedshift
//! hold the masked phrase, which the dates unmask: decoded with whole dates, or searched where a
//! date holds ? for a forgotten digit. With a wallet check only the phrases of the wallet are kept,
//! and for a candidate list every match. The dates must fit each set's phrase, and the time of a
//! date search is told before it runs.

use std::rc::Rc;

use super::ShareFlowError;
use crate::backup::Backup;
use crate::bip39::phrase::Phrase;
use crate::bip39::sizes::WORD_COUNTS;
use crate::dates::Date;
use crate::dates::answer::DatesAnswer;
use crate::forms::Form;
use crate::modes::{DateWords, Mode};
use crate::recovery::date_search::{
    DateSearch, MatchLimits, PROBE_CHECKS, SearchPace, decoded_in_sample, decoding_sample,
    match_counts, seconds_each, wallet_needed, wallet_sample,
};
use crate::recovery::wallet_check::WalletCheck;
use crate::search::{Progress, Search, SearchSize, Step};
use crate::secret::SecretText;
use crate::sskr::repair::report::DateWork;
use crate::sskr::restore::ShareSet;

/// The longest phrase, which every count of dates fits.
const LONGEST_WORD_COUNT: usize = WORD_COUNTS[WORD_COUNTS.len() - 1];
/// A phrase length for the wallet checks of one date combination: MnemoCode Seedshift gives one
/// valid phrase for every date, whatever the number of words, and the time of a search is told
/// before the shares say how many words their phrase has.
const ANY_WORD_COUNT: usize = WORD_COUNTS[0];

/// A seed phrase that a set gives.
#[derive(Debug)]
pub struct UnmaskedPhrase {
    /// The set of shares that gave the phrase.
    pub set: Rc<ShareSet>,
    /// The seed phrase: the set's own in direct mode, or what the dates unmask.
    pub phrase: Phrase,
    /// The dates that a date search found for it, DD-MM-YYYY, sorted and joined by spaces.
    pub dates: Option<SecretText>,
    /// Where the wallet matched in a date search, such as m/84'/0'/0'/0/0.
    pub matched_at: Option<String>,
    /// What the wallet check said of the match, such as that a fingerprint is only a filter.
    pub warning: Option<&'static str>,
}

/// What the sets give: the phrases kept, and every one for a list; or why the dates do not fit.
#[derive(Debug)]
pub enum Unmasked {
    /// The phrases the sets give.
    Phrases {
        /// The phrases kept: all of them, or those the wallet matched, possibly none.
        phrases: Vec<UnmaskedPhrase>,
        /// Every phrase for a candidate list, also the matches of a search beyond those shown.
        listed: Vec<Phrase>,
        /// The phrases that the sets give in all, beyond those listed.
        matches: u64,
    },
    /// The dates are more than a set's phrase takes: why, for the person.
    Dates(String),
    /// The host stopped the date search: no phrase is told.
    Stopped,
}

/// How the sets of one restore are turned into seed phrases: built once with the mode, the dates
/// and the wallet check, so that the time it announces and the search it runs follow from the same.
#[derive(Clone, Debug)]
pub struct ShareUnmasking {
    mode: Mode,
    dates: Option<Rc<DatesAnswer>>,
    wallet: Option<Rc<WalletCheck>>,
    limits: MatchLimits,
    keep: u64,
}

impl ShareUnmasking {
    /// The unmasking in `mode`; refused for a mode in which no shares are made, Seedshift without
    /// dates, dates for a mode that takes none, and a count that is no whole number of 0 or more:
    /// in every mode, before any work, rather than at a search after the shares are restored.
    pub fn new(
        mode: Mode,
        dates: Option<Rc<DatesAnswer>>,
        wallet: Option<Rc<WalletCheck>>,
        limits: MatchLimits,
    ) -> Result<Self, ShareFlowError> {
        mode.check_split()?;
        if mode.masked() && dates.is_none() {
            return Err(ShareFlowError::NoDates);
        }
        mode.check_date_count(
            dates.as_ref().map_or(0, |answer| answer.count()),
            false,
            DateWords::Codes,
        )?;
        let (_, keep) = match_counts(limits).map_err(ShareFlowError::Count)?;
        Ok(Self {
            mode,
            dates: dates.filter(|_| mode.masked()),
            wallet,
            limits,
            keep,
        })
    }

    /// Whether a date holds ?, so that each phrase of the shares is searched.
    pub fn searches(&self) -> bool {
        self.dates
            .as_ref()
            .is_some_and(|dates| dates.has_forgotten_digits())
    }

    /// The date combinations that each phrase is searched with; none without a search.
    pub fn searched_combinations(&self) -> Option<u64> {
        self.dates
            .as_ref()
            .filter(|dates| dates.has_forgotten_digits())
            .map(|dates| dates.combinations())
    }

    /// Whether the search needs the wallet to tell the right dates.
    pub fn needs_wallet(&self) -> bool {
        self.searches() && wallet_needed(self.mode)
    }

    /// The date search that each phrase of the shares needs, for its time, from the seconds a host
    /// timed of [`ShareUnmasking::pace_parts`]; none without a search.
    pub fn date_work(&self, seconds: &[f64]) -> Result<Option<DateWork>, ShareFlowError> {
        let Some(dates) = self.dates.as_ref().filter(|_| self.searches()) else {
            return Ok(None);
        };
        let decoded = decoded_in_sample(dates.combinations()) as f64;
        let per_combination = seconds.first().copied().unwrap_or(0.0) / decoded;
        let per_check = seconds.get(1).copied().unwrap_or(0.0) / f64::from(PROBE_CHECKS);
        let seconds_each = if self.wallet.is_some() {
            let pace = SearchPace {
                per_check,
                per_combination,
            };
            seconds_each(pace, self.mode.checks_per_combination(ANY_WORD_COUNT)?)
        } else {
            per_combination
        };
        Ok(Some(DateWork {
            combinations: dates.combinations(),
            seconds_each,
        }))
    }

    /// The parts of public work a host times before a date search: the decoding of the dates, and
    /// with a wallet check its checks; none without a search.
    pub fn pace_parts(&self) -> u8 {
        match (self.searches(), self.wallet.is_some()) {
            (false, _) => 0,
            (true, false) => 1,
            (true, true) => 2,
        }
    }

    /// Runs part `part` of the public work. The shares do not say yet how long their phrase is: the
    /// decoding of the dates is timed with the longest phrase, which every count of dates fits.
    pub fn pace_sample(&self, part: u8) -> Result<(), ShareFlowError> {
        match (part, &self.dates, &self.wallet) {
            (0, Some(dates), _) => {
                decoding_sample(self.mode, dates, LONGEST_WORD_COUNT)?;
            }
            (_, _, Some(wallet)) => wallet_sample(wallet)?,
            _ => {}
        }
        Ok(())
    }

    /// The phrases that `sets` give, in their order, searched step by step where a date holds ?.
    pub fn unmask(&self, sets: Vec<Rc<ShareSet>>) -> UnmaskSearch {
        UnmaskSearch {
            unmasking: self.clone(),
            sets,
            place: 0,
            current: None,
            running: Progress::default(),
            phrases: Vec::new(),
            listed: Vec::new(),
            matches: 0,
            ended: None,
            combinations: self.searched_combinations().unwrap_or(1),
        }
    }

    /// What the wallet says of `phrase`: whether it matched and the warning of its match. Every
    /// phrase matches without a wallet check.
    fn check(&self, phrase: &Phrase) -> Result<(bool, Option<&'static str>), ShareFlowError> {
        Ok(match &self.wallet {
            None => (true, None),
            Some(wallet) => {
                let answer = wallet.check(phrase)?;
                (answer.matched, answer.warning)
            }
        })
    }
}

/// The search through the sets of a restore, which the host steps.
#[derive(Debug)]
pub struct UnmaskSearch {
    unmasking: ShareUnmasking,
    sets: Vec<Rc<ShareSet>>,
    place: usize,
    current: Option<DateSearch>,
    /// How far the date search under way has come.
    running: Progress,
    phrases: Vec<UnmaskedPhrase>,
    listed: Vec<Phrase>,
    matches: u64,
    ended: Option<Unmasked>,
    combinations: u64,
}

impl UnmaskSearch {
    /// The next set with no date search; a date search begun, or the dates refused, for the others.
    fn take_set(&mut self) -> Result<(), ShareFlowError> {
        let set = Rc::clone(&self.sets[self.place]);
        let mode = self.unmasking.mode;
        let Some(dates) = &self.unmasking.dates else {
            let phrase = set.phrase().copy();
            let (matched, warning) = self.unmasking.check(&phrase)?;
            if matched {
                self.keep(set, phrase, warning);
            }
            self.place += 1;
            return Ok(());
        };
        let backup = Backup::read(set.phrase().text().as_str(), Form::English, mode)?;
        if let Some(too_many) = dates.too_many_for(Some(backup.words())) {
            self.ended = Some(Unmasked::Dates(too_many));
            return Ok(());
        }
        if dates.has_forgotten_digits() {
            self.current = Some(DateSearch::new(
                crate::modes::seedshift::Indexes::new(backup.indexes().to_vec()),
                Rc::clone(dates),
                mode,
                self.unmasking.wallet.clone(),
                self.unmasking.limits,
            )?);
            return Ok(());
        }
        let known: Vec<Date> = dates.known().iter().collect();
        let recovered = backup.decode(&known)?.recovered;
        let indexes: Vec<usize> = recovered
            .as_slice()
            .iter()
            .map(|&index| usize::from(index))
            .collect();
        let phrase = Phrase::of_indexes(&indexes)?;
        let (matched, warning) = self.unmasking.check(&phrase)?;
        if matched {
            self.keep(set, phrase, warning);
        }
        self.place += 1;
        Ok(())
    }

    /// Keeps a phrase that whole dates or none gave, listed as it is kept.
    fn keep(&mut self, set: Rc<ShareSet>, phrase: Phrase, warning: Option<&'static str>) {
        self.listed.push(phrase.copy());
        self.matches += 1;
        self.phrases.push(UnmaskedPhrase {
            set,
            phrase,
            dates: None,
            matched_at: None,
            warning,
        });
    }

    /// Takes in the date search that ended.
    fn take_search(&mut self, search: DateSearch) {
        let set = Rc::clone(&self.sets[self.place]);
        let keeps_list = self.unmasking.keep > 0;
        let outcome = search.finish();
        self.matches += outcome.match_count;
        // A list takes every match; without one, those shown stand for the matches.
        self.listed.extend(outcome.kept);
        for shown in outcome.shown {
            if !keeps_list {
                self.listed.push(shown.phrase.copy());
            }
            self.phrases.push(UnmaskedPhrase {
                set: Rc::clone(&set),
                phrase: shown.phrase,
                dates: Some(shown.dates),
                matched_at: shown.evidence,
                warning: shown.warning,
            });
        }
        self.place += 1;
    }

    /// The progress so far: the sets gone through, and the date search under way.
    fn progress(&self) -> Progress {
        let kept = self.phrases.len() as u64;
        Progress {
            checked: self.place as u64 * self.combinations + self.running.checked,
            total: Some(self.sets.len() as u64 * self.combinations),
            found: kept + self.running.found,
            matched: kept + self.running.matched,
        }
    }
}

impl Search for UnmaskSearch {
    type Outcome = Unmasked;
    type Error = ShareFlowError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: self.sets.len() as u64 * self.combinations,
            pace_parts: self.unmasking.pace_parts(),
        }
    }

    fn pace_sample(&self, part: u8) -> Result<(), ShareFlowError> {
        self.unmasking.pace_sample(part)
    }

    fn step(&mut self, work: u32) -> Result<Step, ShareFlowError> {
        let mut left = work;
        while left > 0 {
            if self.ended.is_some() {
                return Ok(Step::Done(self.progress()));
            }
            if let Some(mut search) = self.current.take() {
                let step = search.step(left)?;
                let now = step.progress();
                let tried = now.checked.saturating_sub(self.running.checked);
                left = left.saturating_sub(u32::try_from(tried).unwrap_or(left));
                self.running = now;
                match step {
                    Step::Running(_) => {
                        self.current = Some(search);
                        return Ok(Step::Running(self.progress()));
                    }
                    Step::Done(_) => {
                        self.running = Progress::default();
                        self.take_search(search);
                    }
                }
                continue;
            }
            if self.place == self.sets.len() {
                // Before the phrases leave: the last progress counts them.
                let progress = self.progress();
                let phrases = std::mem::take(&mut self.phrases);
                let listed = std::mem::take(&mut self.listed);
                let matches = self.matches;
                self.ended = Some(Unmasked::Phrases {
                    phrases,
                    listed,
                    matches,
                });
                return Ok(Step::Done(progress));
            }
            self.take_set()?;
            left = left.saturating_sub(1);
        }
        Ok(Step::Running(self.progress()))
    }

    fn finish(self) -> Unmasked {
        self.ended.unwrap_or(Unmasked::Stopped)
    }
}
