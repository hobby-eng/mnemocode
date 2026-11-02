//! The check of Shamir shares typed again (MnemoCode TS 0.1.0's `ShareBackupCheck` of
//! `core/backup-check.ts` and `core/backup-check-shares.ts`): the shares, then the dates, read as
//! the restore reads them. It keeps the result private and hands out nothing of it.

use std::collections::BTreeSet;
use std::fmt;

use super::{
    BackupFinding, BackupPart, BackupResult, CheckError, FindingKind, PartChecks, WrittenBackup,
    check_written, compare_date_lists, holds_phrase,
};
use crate::backup::Backup;
use crate::bip39::phrase::Phrase;
use crate::dates::{Date, Dates};
use crate::forms::Form;
use crate::modes::{Mode, ModeError};
use crate::refusal::{Refusal, RefusalKind};
use crate::secret::SecretText;
use crate::sskr::forms::read_share;
use crate::sskr::marks::is_marked;
use crate::sskr::restore::{CombineError, ShareSet};
use crate::sskr::share::Share;
use crate::sskr::typed::{
    InputError, PlacedShare, SHARE_SEPARATOR, ShareInput, ShareTrouble, TroubleCode,
};

/// The least threshold a share records.
const MIN_RECORDED_THRESHOLD: usize = 1;

/// The refusals of shares typed again, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShareCheckError {
    /// A threshold below what a share records.
    Threshold,
    /// Fewer shares than the threshold in one answer.
    SharesRefused(String),
    /// Fewer shares than the threshold.
    TooFewShares(String),
    /// As few once copies are left out: their count and the threshold.
    TooFewAfterCopies(usize, usize),
    /// What is said of complete shares before a restore, by its condition.
    Set(TroubleCode, String),
    /// A refusal of the restore, in its own words.
    DoNotRestore(CombineError),
    /// What the shares of an answer refuse.
    Input(InputError),
    /// What the mode refuses.
    Mode(ModeError),
    /// What the rest of the check refuses.
    Check(CheckError),
}

impl fmt::Display for ShareCheckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Threshold => write!(
                f,
                "A share check needs a whole threshold of at least {MIN_RECORDED_THRESHOLD}."
            ),
            Self::SharesRefused(message) | Self::TooFewShares(message) | Self::Set(_, message) => {
                f.write_str(message)
            }
            Self::TooFewAfterCopies(count, threshold) => {
                let left = if *count == 1 {
                    "one share is".to_owned()
                } else {
                    format!("{count} shares are")
                };
                write!(
                    f,
                    "Once the copies are left out, {left} left; type {threshold} different shares."
                )
            }
            Self::DoNotRestore(error) => error.fmt(f),
            Self::Input(error) => error.fmt(f),
            Self::Mode(error) => error.fmt(f),
            Self::Check(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ShareCheckError {}

impl Refusal for ShareCheckError {
    fn code(&self) -> &'static str {
        match self {
            Self::Threshold => "core.backup-check.share-check-whole-threshold-at-least",
            Self::SharesRefused(_) => "core.backup-check.shares-refused",
            Self::TooFewShares(_) => "core.backup-check.too-few-shares",
            Self::TooFewAfterCopies(..) => "core.backup-check.too-few-after-copies",
            Self::Set(code, _) => set_code(*code),
            Self::DoNotRestore(_) => "core.backup-check.shares-do-not-restore",
            Self::Input(error) => error.code(),
            Self::Mode(error) => error.code(),
            Self::Check(error) => error.code(),
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Input(error) => error.kind(),
            Self::Mode(error) => error.kind(),
            Self::Check(error) => error.kind(),
            _ => RefusalKind::Error,
        }
    }
}

/// The code of a condition of complete shares among the refusals of a backup check.
const fn set_code(code: TroubleCode) -> &'static str {
    match code {
        TroubleCode::ShareOfAnotherSet => "core.backup-check.share-of-another-set",
        TroubleCode::SharesOfDifferentSets => "core.backup-check.shares-of-different-sets",
        TroubleCode::MemberGivenTwice => "core.backup-check.member-given-twice",
        TroubleCode::GroupThresholdsConflict => "core.backup-check.group-thresholds-conflict",
        TroubleCode::TooFewForThreshold => "core.backup-check.too-few-for-threshold",
        TroubleCode::TooFewGroups => "core.backup-check.too-few-groups",
        other => other.code(),
    }
}

/// "This is one share" or "These are 3 shares".
fn shares_typed(count: usize) -> String {
    if count == 1 {
        "This is one share".to_owned()
    } else {
        format!("These are {count} shares")
    }
}

/// Why `count` shares typed are too few for a set of `threshold`, and how to type them.
fn too_few_shares(count: usize, threshold: usize) -> String {
    format!(
        "{}; type {threshold}, separated by {SHARE_SEPARATOR}.",
        shares_typed(count)
    )
}

/// `complete`, each with its place, as a set of placed shares.
fn placed_of(complete: &[(usize, Share)]) -> Vec<PlacedShare<'_>> {
    complete
        .iter()
        .map(|(place, share)| PlacedShare {
            place: *place,
            share,
        })
        .collect()
}

/// Shares typed again, each once, with their original places and copy notes.
#[derive(Debug)]
pub struct KeptShares {
    texts: Vec<SecretText>,
    places: Vec<usize>,
    notes: Vec<String>,
}

impl KeptShares {
    /// The complete shares among `typed`, read, with their places.
    fn complete_of(typed: &[(usize, &str)]) -> Vec<(usize, Share)> {
        typed
            .iter()
            .filter(|(_, text)| !is_marked(text))
            .filter_map(|&(place, text)| read_share(text).ok().map(|read| (place, read.share)))
            .collect()
    }

    /// `texts` in their order, dropping exact copies; a host first obtains the findings of shares
    /// that cannot be read.
    pub fn of<S: AsRef<str>>(texts: &[S]) -> Self {
        let typed: Vec<(usize, &str)> = texts
            .iter()
            .enumerate()
            .map(|(index, text)| (index + 1, text.as_ref()))
            .collect();
        let complete = Self::complete_of(&typed);
        let placed = placed_of(&complete);
        let copies = ShareInput::copies_of(&placed);
        let copied: BTreeSet<usize> = copies.iter().map(|copy| copy.place).collect();
        let kept: Vec<&(usize, &str)> = typed
            .iter()
            .filter(|(place, _)| !copied.contains(place))
            .collect();
        Self {
            texts: kept
                .iter()
                .map(|(_, text)| SecretText::copy_of("a share", text))
                .collect(),
            places: kept.iter().map(|(place, _)| *place).collect(),
            notes: copies.into_iter().map(|copy| copy.message).collect(),
        }
    }

    /// The shares kept, as typed.
    pub fn texts(&self) -> Vec<&str> {
        self.texts.iter().map(SecretText::as_str).collect()
    }

    /// The places of the shares kept, among those typed.
    pub fn places(&self) -> &[usize] {
        &self.places
    }

    /// One line for each copy left out.
    pub fn notes(&self) -> &[String] {
        &self.notes
    }

    /// Why complete shares do not belong together, or are too few where no marked share can
    /// complete them.
    pub fn set_problem(&self) -> Option<ShareTrouble> {
        let typed: Vec<(usize, &str)> = self.places.iter().copied().zip(self.texts()).collect();
        let complete = Self::complete_of(&typed);
        let placed = placed_of(&complete);
        ShareInput::complete_set_problem(&placed, complete.len() < typed.len())
    }
}

/// The phrase restored from shares and the places left unchecked.
#[derive(Debug)]
pub struct RestoredShares {
    phrase: Phrase,
    unchecked: Vec<usize>,
}

impl RestoredShares {
    /// The phrase of `set`, its unchecked shares named through `kept`.
    fn of(set: &ShareSet, kept: &KeptShares) -> Self {
        let unsettled = set.unsettled().iter().map(|element| element.share);
        let shares = set.unchecked().iter().copied().chain(unsettled);
        let unchecked: BTreeSet<usize> = shares.map(|share| kept.places[share - 1]).collect();
        Self {
            phrase: set.phrase().copy(),
            unchecked: unchecked.into_iter().collect(),
        }
    }

    /// Whether the shares hold `phrase`.
    fn holds(&self, phrase: &Phrase) -> bool {
        (0..phrase.len()).all(|place| self.phrase.index(place) == phrase.index(place))
            && self.phrase.len() == phrase.len()
    }

    /// Whether undoing `mode` with `dates` gives `phrase`.
    fn unmasks_to(&self, phrase: &Phrase, mode: Mode, dates: &Dates) -> Result<bool, CheckError> {
        let masked = Backup::read(self.phrase.text().as_str(), Form::English, mode)?;
        let all: Vec<Date> = dates.iter().collect();
        Ok(holds_phrase(&masked.decode(&all)?.recovered, phrase))
    }

    /// Places of the shares that took no part, or that hold elements nothing settles.
    pub fn unchecked(&self) -> &[usize] {
        &self.unchecked
    }
}

/// The result just shown, which Shamir shares typed again must give.
#[derive(Debug)]
pub struct ShareOriginal {
    /// The seed phrase.
    pub phrase: Phrase,
    /// The mode the shares were made in.
    pub mode: Mode,
    /// The shares that restore it: as many are asked for.
    pub threshold: usize,
    /// The dates of the result, when known: a date that is not one of them is named by its place.
    pub dates: Option<Dates>,
}

/// The check of Shamir shares: the shares, then the dates, built once with the result just shown,
/// its steps called as each part is typed.
#[derive(Debug)]
pub struct ShareBackupCheck {
    original: ShareOriginal,
    input: ShareInput,
    /// The phrase that shares of the result hold, when it is known.
    held: Option<Phrase>,
}

impl ShareBackupCheck {
    /// The check of `original`; `decode_entry` names the host's reader of an encoded seed phrase,
    /// which a phrase typed in place of the shares is sent to. Refused for a mode in which no
    /// shares are made, and a threshold below what a share records.
    pub fn new(original: ShareOriginal, decode_entry: &str) -> Result<Self, ShareCheckError> {
        original.mode.check_split().map_err(ShareCheckError::Mode)?;
        if original.threshold < MIN_RECORDED_THRESHOLD {
            return Err(ShareCheckError::Threshold);
        }
        Ok(Self {
            held: held_phrase(&original)?,
            input: ShareInput::new(decode_entry),
            original,
        })
    }

    /// The shares asked for.
    pub const fn threshold(&self) -> usize {
        self.original.threshold
    }

    /// The shares of one answer, as the restore reads them; at least the threshold.
    pub fn shares_of(&self, answer: &str) -> Result<Vec<String>, ShareCheckError> {
        let shares = self
            .input
            .shares_of_answer(answer, false)
            .map_err(ShareCheckError::Input)?;
        if shares.len() < self.threshold() {
            return Err(ShareCheckError::SharesRefused(too_few_shares(
                shares.len(),
                self.threshold(),
            )));
        }
        Ok(shares)
    }

    /// Why the share at `place` cannot be read, as the restore says it.
    pub fn share_problem(&self, place: usize, text: &str) -> Option<ShareTrouble> {
        self.input.read_problem(place, text)
    }

    /// Restores the shares kept; refused why they cannot be, after which they are all typed again.
    pub fn restore(&self, kept: &KeptShares) -> Result<RestoredShares, ShareCheckError> {
        let texts = kept.texts();
        let count = texts.len();
        if count < self.threshold() {
            return Err(if kept.notes().is_empty() {
                ShareCheckError::TooFewShares(too_few_shares(count, self.threshold()))
            } else {
                ShareCheckError::TooFewAfterCopies(count, self.threshold())
            });
        }
        // Shares that do not belong together, or are too few for their set, are named as
        // sskr-combine names them.
        if let Some(problem) = kept.set_problem() {
            return Err(ShareCheckError::Set(problem.code, problem.message));
        }
        let set = ShareSet::combine(&texts, Some(kept.places()))
            .map_err(ShareCheckError::DoNotRestore)?;
        Ok(RestoredShares::of(&set, kept))
    }

    /// Checks a whole backup: the shares, then the dates; shares that cannot be read or restored
    /// are a finding.
    pub fn check(&self, written: WrittenBackup<'_>) -> Result<BackupResult, ShareCheckError> {
        let unreadable = |message: String, places: Vec<usize>, notes: Vec<String>| {
            let found =
                BackupFinding::at(BackupPart::Shares, FindingKind::Unreadable, message, places);
            BackupResult::of(Some(found), notes)
        };
        let texts = match self.shares_of(written.backup) {
            Ok(texts) => texts,
            Err(error) => return Ok(unreadable(error.to_string(), Vec::new(), Vec::new())),
        };
        for (index, text) in texts.iter().enumerate() {
            if let Some(problem) = self.share_problem(index + 1, text) {
                return Ok(unreadable(problem.message, vec![index + 1], Vec::new()));
            }
        }
        let kept = KeptShares::of(&texts);
        let restored = match self.restore(&kept) {
            Ok(restored) => restored,
            Err(error) => {
                return Ok(unreadable(
                    error.to_string(),
                    Vec::new(),
                    kept.notes().to_vec(),
                ));
            }
        };
        check_written(self, &restored, written.dates, kept.notes().to_vec())
            .map_err(ShareCheckError::Check)
    }
}

/// The phrase that shares of the result hold, as far as it is known: the seed phrase itself, or the
/// phrase that Seedshift masked it as with the dates of the result.
fn held_phrase(original: &ShareOriginal) -> Result<Option<Phrase>, ShareCheckError> {
    if !original.mode.masked() {
        return Ok(Some(original.phrase.copy()));
    }
    let Some(dates) = &original.dates else {
        return Ok(None);
    };
    let all: Vec<Date> = dates.iter().collect();
    let masked = original
        .mode
        .encode(&original.phrase, &all)
        .map_err(ShareCheckError::Mode)?;
    let indexes: Vec<usize> = masked
        .shifted
        .as_slice()
        .iter()
        .map(|&index| usize::from(index))
        .collect();
    Phrase::of_indexes(&indexes)
        .map(Some)
        .map_err(|error| ShareCheckError::Mode(error.into()))
}

impl PartChecks for ShareBackupCheck {
    type Written = RestoredShares;

    fn dated(&self) -> bool {
        self.original.mode.masked()
    }

    fn word_count(&self) -> usize {
        self.original.phrase.len()
    }

    /// Whether shares that can be restored hold the phrase of the result, when it is known.
    fn compare(&self, restored: &RestoredShares) -> Result<Option<BackupFinding>, CheckError> {
        if self.held.as_ref().is_none_or(|held| restored.holds(held)) {
            return Ok(None);
        }
        Ok(Some(BackupFinding::new(
            BackupPart::Shares,
            FindingKind::OtherPhrase,
            "These shares restore another seed phrase: they are not of this backup.".to_owned(),
        )))
    }

    /// How the dates typed with shares that can be restored differ from those of the result: with
    /// the dates of the result, each date is compared; without them, the seed phrase they restore.
    /// The dates are accepted only when the shares with them really give the seed phrase back.
    fn compare_dates(
        &self,
        restored: &RestoredShares,
        dates: &Dates,
    ) -> Result<Option<BackupFinding>, CheckError> {
        if let Some(differs) = self
            .original
            .dates
            .as_ref()
            .and_then(|original| compare_date_lists(dates, original))
        {
            return Ok(Some(differs));
        }
        let mode = self.original.mode;
        if mode.masked() && restored.unmasks_to(&self.original.phrase, mode, dates)? {
            return Ok(None);
        }
        Ok(Some(BackupFinding::new(
            BackupPart::Dates,
            FindingKind::OtherPhrase,
            "The shares with these dates give another seed phrase: check the dates and the shares."
                .to_owned(),
        )))
    }

    /// Whether the shares left a part unchecked: a group not complete, or a repair not settled.
    fn compare_restored(
        &self,
        restored: &RestoredShares,
        _dates: &Dates,
    ) -> Result<Option<BackupFinding>, CheckError> {
        if restored.unchecked().is_empty() {
            return Ok(None);
        }
        Ok(Some(BackupFinding::at(
            BackupPart::Shares,
            FindingKind::Unchecked,
            "The phrase matches, but some shares or repaired elements were not checked. Supply complete groups and check the marks."
                .to_owned(),
            restored.unchecked().to_vec(),
        )))
    }
}
