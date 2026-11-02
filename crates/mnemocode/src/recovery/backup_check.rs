//! The written-backup check (MnemoCode TS 0.1.0's `core/backup-check.ts`, CAP-RECOVERY-BACKUP-CHECK
//! and its parts): whether a backup typed again from paper restores the seed phrase just encoded,
//! without showing it. Most losses come from a backup written wrongly, not from theft. Two kinds of
//! backup are checked: the encoded seed phrase, as codes or an MNC1 record, and Shamir shares, each
//! with its dates when Seedshift masked it. What does not fit is a finding: its part, its places in
//! that part, counted from 1, and a line that says it without repeating any secret. A host with a
//! form calls `check` with the whole backup; a host that asks part by part calls the steps and asks
//! again only for the part that a finding names.

use std::fmt;

use super::reading::mode_conflict_of;
use crate::backup::record::parse_record;
use crate::backup::{Backup, BackupError};
use crate::bip39::phrase::Phrase;
use crate::dates::answer::{AnswerError, DatesAnswer};
use crate::dates::{Date, Dates};
use crate::forms::{Form, FormError};
use crate::modes::seedshift::Indexes;
use crate::modes::{Mode, ModeError};
use crate::refusal::{Refusal, RefusalKind};
use crate::text::words::{places_in_words, places_named};

/// The line of a check that found nothing.
pub const RESTORES_MESSAGE: &str = "The backup restores this seed phrase.";

/// The refusals of a backup check.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckError {
    /// A backup made with the Original Seedshift with a valid last word.
    Uncheckable,
    /// What a backup refuses.
    Backup(BackupError),
    /// What a form refuses.
    Form(FormError),
    /// What a mode refuses.
    Mode(ModeError),
}

impl fmt::Display for CheckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Uncheckable => f.write_str(
                "A backup made with the Original Seedshift with a valid last word cannot be checked: its last word was replaced.",
            ),
            Self::Backup(error) => error.fmt(f),
            Self::Form(error) => error.fmt(f),
            Self::Mode(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for CheckError {}

impl Refusal for CheckError {
    fn code(&self) -> &'static str {
        match self {
            Self::Uncheckable => "core.backup-check.uncheckable",
            Self::Backup(error) => error.code(),
            Self::Form(error) => error.code(),
            Self::Mode(error) => error.code(),
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Uncheckable => RefusalKind::Error,
            Self::Backup(error) => error.kind(),
            Self::Form(error) => error.kind(),
            Self::Mode(error) => error.kind(),
        }
    }
}

impl From<BackupError> for CheckError {
    fn from(error: BackupError) -> Self {
        Self::Backup(error)
    }
}

impl From<FormError> for CheckError {
    fn from(error: FormError) -> Self {
        Self::Form(error)
    }
}

/// The part of a backup that a finding is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackupPart {
    /// The codes.
    Codes,
    /// The shares.
    Shares,
    /// The dates.
    Dates,
}

/// Why a part does not give the result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FindingKind {
    /// It cannot be read.
    Unreadable,
    /// A record names another mode.
    Mode,
    /// It has another number of codes or dates.
    Count,
    /// The codes or dates at its places are not those of the result.
    Places,
    /// It gives another seed phrase.
    OtherPhrase,
    /// It gives this one, but some shares or repaired elements were not checked.
    Unchecked,
}

/// A part of a backup that does not give the result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupFinding {
    /// The part.
    pub part: BackupPart,
    /// Why it does not, which gives the verdict of the whole check.
    pub kind: FindingKind,
    /// Where in the part, from 1; empty when the line is about the part as a whole.
    pub places: Vec<usize>,
    /// One line that says it, naming places only.
    pub message: String,
}

impl BackupFinding {
    fn new(part: BackupPart, kind: FindingKind, message: String) -> Self {
        Self::at(part, kind, message, Vec::new())
    }

    fn at(part: BackupPart, kind: FindingKind, message: String, places: Vec<usize>) -> Self {
        Self {
            part,
            kind,
            places,
            message,
        }
    }
}

/// What a whole check found, in one word.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackupVerdict {
    /// The backup restores the result.
    Restores,
    /// A part can be read, but does not fit.
    Differs,
    /// A part cannot be read.
    Unreadable,
    /// It restores the result, but not all of it was checked.
    Unchecked,
}

/// What a whole check found: the verdict, its line, the finding behind it, and notes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupResult {
    /// The verdict.
    pub verdict: BackupVerdict,
    /// [`RESTORES_MESSAGE`], or the finding's line.
    pub message: String,
    /// The finding behind the verdict; none when the backup restores.
    pub finding: Option<BackupFinding>,
    /// What was left out on the way, such as a copy of a share, one line each.
    pub notes: Vec<String>,
}

impl BackupResult {
    /// The result of `found`, with `notes`.
    fn of(found: Option<BackupFinding>, notes: Vec<String>) -> Self {
        match found {
            None => Self {
                verdict: BackupVerdict::Restores,
                message: RESTORES_MESSAGE.to_owned(),
                finding: None,
                notes,
            },
            Some(finding) => Self {
                verdict: match finding.kind {
                    FindingKind::Unreadable => BackupVerdict::Unreadable,
                    FindingKind::Unchecked => BackupVerdict::Unchecked,
                    FindingKind::Mode
                    | FindingKind::Count
                    | FindingKind::Places
                    | FindingKind::OtherPhrase => BackupVerdict::Differs,
                },
                message: finding.message.clone(),
                finding: Some(finding),
                notes,
            },
        }
    }
}

/// A backup as written down, typed again whole.
#[derive(Clone, Copy, Debug)]
pub struct WrittenBackup<'a> {
    /// The codes or an MNC1 record; or the shares, separated by ;, with ? for unreadable elements.
    pub backup: &'a str,
    /// The dates, separated by spaces; not read for a backup without Seedshift.
    pub dates: Option<&'a str>,
}

/// How dates that can be read differ from the dates of the result: their count, or the places of
/// those that are not among them. The order does not matter: Seedshift sorts the dates.
fn compare_date_lists(typed: &Dates, original: &Dates) -> Option<BackupFinding> {
    let (typed_count, original_count) = (typed.len(), original.len());
    if typed_count != original_count {
        let dates = if original_count == 1 { "date" } else { "dates" };
        let were = if typed_count == 1 { "was" } else { "were" };
        return Some(BackupFinding::new(
            BackupPart::Dates,
            FindingKind::Count,
            format!(
                "The backup was made with {original_count} {dates}; {typed_count} {were} typed."
            ),
        ));
    }
    let mut left: Vec<Date> = original.iter().collect();
    let mut places = Vec::new();
    for (place, date) in typed.iter().enumerate() {
        match left.iter().position(|other| *other == date) {
            Some(found) => {
                left.remove(found);
            }
            None => places.push(place + 1),
        }
    }
    if places.is_empty() {
        return None;
    }
    let is = if places.len() == 1 {
        "is not one of the dates"
    } else {
        "are not dates"
    };
    Some(BackupFinding::at(
        BackupPart::Dates,
        FindingKind::Places,
        format!("{} {is} of this backup.", places_named("Date", &places)),
        places,
    ))
}

/// What a check asks next: nothing, as the backup restores; a finding; or the dates.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NextFinding {
    /// Nothing differs.
    None,
    /// What differs.
    Found(BackupFinding),
    /// The dates are needed.
    Dates,
}

/// The comparisons of one kind of backup over what was written down: the codes as read, or the
/// shares as restored.
pub trait PartChecks {
    /// What was written down, as read.
    type Written;

    /// Whether the backup has dates, which are compared after what was written down.
    fn dated(&self) -> bool;
    /// The words of the seed phrase, which bound the number of dates.
    fn word_count(&self) -> usize;
    /// The complete dates of `line`, at most as many as the phrase takes; refused why they cannot
    /// be read, naming dates by place.
    fn read_dates(&self, line: &str) -> Result<Dates, AnswerError> {
        Ok(DatesAnswer::parse(line, Some(self.word_count()), false)?
            .known()
            .clone())
    }
    /// How what was written down differs from the result.
    fn compare(&self, written: &Self::Written) -> Result<Option<BackupFinding>, CheckError>;
    /// How `dates` differ from those of the result, with `written`.
    fn compare_dates(
        &self,
        written: &Self::Written,
        dates: &Dates,
    ) -> Result<Option<BackupFinding>, CheckError>;
    /// What is left once the parts agree: whether `written` with `dates` restores the result, all
    /// of it checked. `dates` is empty for a backup without dates.
    fn compare_restored(
        &self,
        written: &Self::Written,
        dates: &Dates,
    ) -> Result<Option<BackupFinding>, CheckError>;
}

/// The first finding of a check: what was written down, then the dates where the backup is dated,
/// then what the two restore.
pub fn next_finding<C: PartChecks>(
    checks: &C,
    written: &C::Written,
    dates: Option<&Dates>,
) -> Result<NextFinding, CheckError> {
    let found = checks.compare(written)?;
    let found = match found {
        Some(found) => Some(found),
        None if !checks.dated() => checks.compare_restored(written, &Dates::new(&[]))?,
        None => {
            let Some(dates) = dates else {
                return Ok(NextFinding::Dates);
            };
            match checks.compare_dates(written, dates)? {
                Some(found) => Some(found),
                None => checks.compare_restored(written, dates)?,
            }
        }
    };
    Ok(found.map_or(NextFinding::None, NextFinding::Found))
}

/// The result of a whole check once what was written down is read.
fn check_written<C: PartChecks>(
    checks: &C,
    written: &C::Written,
    date_line: Option<&str>,
    notes: Vec<String>,
) -> Result<BackupResult, CheckError> {
    let dates = match next_finding(checks, written, None)? {
        NextFinding::None => return Ok(BackupResult::of(None, notes)),
        NextFinding::Found(found) => return Ok(BackupResult::of(Some(found), notes)),
        NextFinding::Dates => match checks.read_dates(date_line.unwrap_or("")) {
            Ok(dates) => dates,
            Err(error) => {
                let found = BackupFinding::new(
                    BackupPart::Dates,
                    FindingKind::Unreadable,
                    error.to_string(),
                );
                return Ok(BackupResult::of(Some(found), notes));
            }
        },
    };
    Ok(match next_finding(checks, written, Some(&dates))? {
        NextFinding::Found(found) => BackupResult::of(Some(found), notes),
        NextFinding::None | NextFinding::Dates => BackupResult::of(None, notes),
    })
}

/// Codes typed again: the mode they were written with, and the codes, read without their mode's
/// checksum, so that a mistyped code is named by its place rather than refused.
#[derive(Debug)]
pub struct WrittenCodes {
    mode: Mode,
    codes: Backup,
    /// For each code, in the order of `Form::elements`, its place as typed, from 0.
    places: Vec<usize>,
}

impl WrittenCodes {
    /// Reads the codes of a backup as written down, in `form` with `mode`, unless a record names
    /// its own form and mode.
    pub fn read(typed: &str, form: Form, mode: Mode) -> Result<Self, CheckError> {
        let record = parse_record(typed).map_err(BackupError::Record)?;
        let text = record.as_ref().map_or(typed, |record| record.payload);
        let form = record.as_ref().map_or(form, |record| record.form);
        let mode = record.as_ref().map_or(mode, |record| record.mode);
        let codes = Backup::read(text, form, Mode::Direct)?;
        let count = form.elements(codes.indexes())?.len();
        let places = form.typed_places(text, count)?;
        Ok(Self {
            mode,
            codes,
            places,
        })
    }

    /// The form the codes were written in: a record's own, or the one they were read in.
    pub const fn form(&self) -> Form {
        self.codes.form()
    }

    /// The recorded mode, or the supplied mode without a record.
    pub const fn mode(&self) -> Mode {
        self.mode
    }

    /// Whether these codes and `dates` restore `phrase`, without handing out what they restore.
    fn restores(&self, phrase: &Phrase, dates: &Dates) -> Result<bool, CheckError> {
        // The mode is taken only here: read as direct, a mistyped code is named by its place
        // instead of being refused for its checksum.
        let backup = self.codes.with_mode(self.mode)?;
        let all: Vec<Date> = dates.iter().collect();
        let recovered = backup.decode(&all)?.recovered;
        Ok(holds_phrase(&recovered, phrase))
    }
}

/// Whether `indexes` are the words of `phrase`.
fn holds_phrase(indexes: &Indexes, phrase: &Phrase) -> bool {
    let words = indexes.as_slice();
    words.len() == phrase.len()
        && words
            .iter()
            .enumerate()
            .all(|(place, &word)| phrase.index(place) == Some(usize::from(word)))
}

/// The result just shown, which an encoded backup typed again must give.
#[derive(Debug)]
pub struct EncodedOriginal {
    /// The seed phrase.
    pub phrase: Phrase,
    /// The form the codes were shown in, which codes typed again are read in without a record.
    pub form: Form,
    /// The mode of the result.
    pub mode: Mode,
    /// The codes of the result.
    pub codes: Indexes,
    /// The dates of the result, empty without Seedshift; compared in any order.
    pub dates: Dates,
}

/// The check of an encoded seed phrase: the codes or a record, then the dates, built once with the
/// result just shown, its steps called as each part is typed.
#[derive(Debug)]
pub struct EncodedBackupCheck {
    original: EncodedOriginal,
}

impl EncodedBackupCheck {
    /// Whether a backup made in `mode` can be checked: not the Original Seedshift with a valid last
    /// word, whose last word was replaced, so that only a search finds the seed phrase again.
    pub const fn supports(mode: Mode) -> bool {
        mode.capabilities().backup_check
    }

    /// The check of `original`; refused for a mode whose backup cannot be checked.
    pub fn new(original: EncodedOriginal) -> Result<Self, CheckError> {
        if !Self::supports(original.mode) {
            return Err(CheckError::Uncheckable);
        }
        Ok(Self { original })
    }

    /// Reads the codes as written down, in the form and mode of the result.
    pub fn read_codes(&self, typed: &str) -> Result<WrittenCodes, CheckError> {
        WrittenCodes::read(typed, self.original.form, self.original.mode)
    }

    /// Checks a whole backup: the codes, then the dates; a part that cannot be read is a finding,
    /// not a refusal.
    pub fn check(&self, written: WrittenBackup<'_>) -> Result<BackupResult, CheckError> {
        match self.read_codes(written.backup) {
            Ok(codes) => check_written(self, &codes, written.dates, Vec::new()),
            Err(error) => Ok(BackupResult::of(
                Some(BackupFinding::new(
                    BackupPart::Codes,
                    FindingKind::Unreadable,
                    error.to_string(),
                )),
                Vec::new(),
            )),
        }
    }
}

impl PartChecks for EncodedBackupCheck {
    type Written = WrittenCodes;

    fn dated(&self) -> bool {
        self.original.mode.masked()
    }

    fn word_count(&self) -> usize {
        self.original.codes.as_slice().len()
    }

    /// Their mode, count or places, both counted and placed in the form the codes were written in,
    /// as they were typed: colours by the place they were typed at, in Color Unicode each of their
    /// two codes.
    fn compare(&self, codes: &WrittenCodes) -> Result<Option<BackupFinding>, CheckError> {
        if let Some(conflict) = mode_conflict_of(Some(codes.mode), Some(self.original.mode)) {
            return Ok(Some(BackupFinding::new(
                BackupPart::Codes,
                FindingKind::Mode,
                conflict,
            )));
        }
        let form = codes.form();
        let written = form.elements(codes.codes.indexes())?;
        let result = form.elements(self.original.codes.as_slice())?;
        if written.len() != result.len() {
            return Ok(Some(BackupFinding::new(
                BackupPart::Codes,
                FindingKind::Count,
                format!(
                    "The backup has {} {}; these are {}.",
                    result.len(),
                    form.unit(),
                    written.len()
                ),
            )));
        }
        let mut places: Vec<usize> = written
            .iter()
            .zip(&result)
            .enumerate()
            .filter(|(_, (code, other))| code != other)
            .map(|(place, _)| codes.places[place] + 1)
            .collect();
        places.sort_unstable();
        Ok(match places.as_slice() {
            [] => None,
            [place] => Some(BackupFinding::at(
                BackupPart::Codes,
                FindingKind::Places,
                format!(
                    "The {} at place {place} differs from the result.",
                    form.one()
                ),
                places,
            )),
            _ => Some(BackupFinding::at(
                BackupPart::Codes,
                FindingKind::Places,
                format!(
                    "The {} at places {} differ from the result.",
                    form.unit(),
                    places_in_words(&places)
                ),
                places,
            )),
        })
    }

    fn compare_dates(
        &self,
        _codes: &WrittenCodes,
        dates: &Dates,
    ) -> Result<Option<BackupFinding>, CheckError> {
        Ok(compare_date_lists(dates, &self.original.dates))
    }

    /// Whether the codes and the dates, each of the result, restore its seed phrase. Only a fault
    /// of MnemoCode gives a finding here; it names the codes, which are then typed again.
    fn compare_restored(
        &self,
        codes: &WrittenCodes,
        dates: &Dates,
    ) -> Result<Option<BackupFinding>, CheckError> {
        if codes.restores(&self.original.phrase, dates)? {
            return Ok(None);
        }
        Ok(Some(BackupFinding::new(
            BackupPart::Codes,
            FindingKind::OtherPhrase,
            "The backup gives another seed phrase: check the codes and the dates.".to_owned(),
        )))
    }
}

#[cfg(feature = "sskr")]
pub use shares::{KeptShares, RestoredShares, ShareBackupCheck, ShareCheckError, ShareOriginal};

/// The check of Shamir shares (CAP-RECOVERY-BACKUP-CHECK-SHARES).
#[cfg(feature = "sskr")]
pub mod shares;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::parse_date;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn check(mode: Mode, dates: &[Date]) -> (EncodedBackupCheck, String) {
        let phrase = Phrase::parse(TWELVE).unwrap();
        let masked = mode.encode(&phrase, dates).unwrap();
        let text = Form::English.codes(masked.shifted.as_slice()).unwrap();
        let text = text.as_str().to_owned();
        let check = EncodedBackupCheck::new(EncodedOriginal {
            phrase,
            form: Form::English,
            mode,
            codes: masked.shifted.clone(),
            dates: Dates::new(dates),
        })
        .unwrap();
        (check, text)
    }

    #[test]
    fn the_right_codes_and_dates_restore() {
        let date = parse_date("23-09-2026").unwrap();
        let (check, text) = check(Mode::Seedshift, &[date]);
        let result = check
            .check(WrittenBackup {
                backup: &text,
                dates: Some("23-09-2026"),
            })
            .unwrap();
        assert_eq!(result.verdict, BackupVerdict::Restores);
        assert_eq!(result.message, RESTORES_MESSAGE);
    }

    #[test]
    fn a_wrong_code_is_named_by_its_place() {
        let (check, text) = check(Mode::Direct, &[]);
        let wrong = text.replacen("abandon", "ability", 1);
        let result = check
            .check(WrittenBackup {
                backup: &wrong,
                dates: None,
            })
            .unwrap();
        assert_eq!(result.verdict, BackupVerdict::Differs);
        let finding = result.finding.unwrap();
        assert_eq!(finding.part, BackupPart::Codes);
        assert_eq!(finding.places, [1]);
        assert_eq!(
            result.message,
            "The word at place 1 differs from the result."
        );
    }

    #[test]
    fn dates_are_compared_in_any_order() {
        let early = parse_date("01-02-2001").unwrap();
        let late = parse_date("23-09-2026").unwrap();
        let (check, text) = check(Mode::Seedshift, &[early, late]);
        let result = check
            .check(WrittenBackup {
                backup: &text,
                dates: Some("23-09-2026 01-02-2001"),
            })
            .unwrap();
        assert_eq!(result.verdict, BackupVerdict::Restores);
        let result = check
            .check(WrittenBackup {
                backup: &text,
                dates: Some("23-09-2026 02-02-2001"),
            })
            .unwrap();
        assert_eq!(
            result.message,
            "Date 2 is not one of the dates of this backup."
        );
        let result = check
            .check(WrittenBackup {
                backup: &text,
                dates: Some("23-09-2026"),
            })
            .unwrap();
        assert_eq!(
            result.message,
            "The backup was made with 2 dates; 1 was typed."
        );
        let result = check
            .check(WrittenBackup {
                backup: &text,
                dates: Some("no date"),
            })
            .unwrap();
        assert_eq!(result.verdict, BackupVerdict::Unreadable);
    }

    #[test]
    fn a_mode_whose_last_word_was_replaced_cannot_be_checked() {
        assert!(!EncodedBackupCheck::supports(Mode::SeedshiftLegacyValid));
        assert!(EncodedBackupCheck::supports(Mode::Direct));
    }
}
