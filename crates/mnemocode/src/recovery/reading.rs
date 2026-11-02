//! How a backup that a person types, pastes or reads from a file is to be read, before its dates
//! (MnemoCode TS 0.1.0's `core/backup-reading.ts`, CAP-PHRASE-FORMATS-BACKUP-READING): its MNC1
//! record header, if it has one; a record without Seedshift where only a Seedshift backup will do;
//! a Shamir share given where an encoded seed phrase was asked for; the mode, from the record or
//! from the host, and what to say when the two differ; the form of the codes, from the record, from
//! the host, or every form that fits; and then the codes themselves. The command line and a page
//! ask the person in between, each its own way; the rules and their lines are here. Its messages
//! name places, counts, modes and forms, never a code.

use std::fmt;

use super::marked::{MarkedError, MissingCodes};
use crate::backup::record::{RecordError, parse_record};
use crate::backup::{Backup, BackupError};
use crate::bip39::sizes::{SizesError, check_word_count};
use crate::forms::Form;
use crate::forms::detection::detect;
use crate::modes::Mode;
use crate::refusal::{Refusal, RefusalKind};
use crate::secret::SecretText;
#[cfg(feature = "sskr")]
use crate::sskr::forms::read_share;
#[cfg(feature = "sskr")]
use crate::sskr::repair::reading::MarkedReading;
#[cfg(feature = "sskr")]
use crate::sskr::set::SetError;
#[cfg(feature = "sskr")]
use crate::sskr::typed::ShareInput;
use crate::text::codes::with_joined_marks_hint;
#[cfg(feature = "sskr")]
use crate::text::space::trim;

/// Why codes fit no form.
const FIT_NO_FORM: &str = "These codes fit no form of an encoded seed phrase";
/// Unknown bits of a marked share below which its solution settles that the text is a share: its
/// CRC-32 alone is 32 bits, and its version, length and layout add some 20 more.
#[cfg(feature = "sskr")]
const SURE_SHARE_UNKNOWN_BITS: usize = 32;

/// The refusals of a backup as given, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadingError {
    /// A header that cannot be read.
    Record(RecordError),
    /// A record without Seedshift where only Seedshift will do.
    SeedshiftOnly,
    /// A Shamir share where an encoded seed phrase was asked for: the host's reader of shares.
    Share(String),
    /// Codes that the likely form reads, yet fit no form as a whole.
    FitNoForm,
    /// Marked codes that fit no form, with a hint where they are run together.
    MarkedFitNoForm(String),
    /// A length of a phrase that none has.
    Sizes(SizesError),
    /// What the codes refuse.
    Backup(BackupError),
    /// More parts than a set has shares.
    #[cfg(feature = "sskr")]
    Set(SetError),
}

impl fmt::Display for ReadingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Record(error) => error.fmt(f),
            Self::SeedshiftOnly => {
                f.write_str("Date recovery is available only for records created with Seedshift.")
            }
            Self::Share(reader) => write!(
                f,
                "This is a Shamir share, not an encoded seed phrase: {reader} reads it."
            ),
            Self::FitNoForm => write!(f, "{FIT_NO_FORM}."),
            Self::MarkedFitNoForm(message) => f.write_str(message),
            Self::Sizes(error) => error.fmt(f),
            Self::Backup(error) => error.fmt(f),
            #[cfg(feature = "sskr")]
            Self::Set(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ReadingError {}

impl Refusal for ReadingError {
    fn code(&self) -> &'static str {
        match self {
            Self::Record(error) => error.code(),
            Self::SeedshiftOnly => {
                "core.backup-reading.date-recovery-available-only-records-created-seedshift"
            }
            Self::Share(_) => "core.backup-reading.shamir-share-not-encoded-seed-phrase-reads",
            Self::FitNoForm => "core.backup-reading.codes-fit-no-form",
            Self::MarkedFitNoForm(_) => "core.backup-reading.marked-codes-fit-no-form",
            Self::Sizes(error) => error.code(),
            Self::Backup(error) => error.code(),
            #[cfg(feature = "sskr")]
            Self::Set(error) => error.code(),
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Record(error) => error.kind(),
            Self::Sizes(error) => error.kind(),
            Self::Backup(error) => error.kind(),
            #[cfg(feature = "sskr")]
            Self::Set(error) => error.kind(),
            _ => RefusalKind::Error,
        }
    }
}

impl From<RecordError> for ReadingError {
    fn from(error: RecordError) -> Self {
        Self::Record(error)
    }
}

impl From<BackupError> for ReadingError {
    fn from(error: BackupError) -> Self {
        Self::Backup(error)
    }
}

/// What a host reads a backup for.
#[derive(Clone, Copy, Debug)]
pub struct ReadingRules<'a> {
    /// Only a Seedshift backup will do, as for a search of forgotten date digits.
    pub seedshift_only: bool,
    /// Where the host reads Shamir shares, for the refusal of a share typed here.
    pub share_reader: &'a str,
    /// The words of the seed phrase, where the person gave them: only the codes of so many words
    /// from the start are read, as printed cards end with decoys.
    pub words: Option<usize>,
}

/// What a text given in place of an encoded seed phrase is: a Shamir share, or either a share or
/// the codes, which only the person can tell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShareKind {
    /// A Shamir share.
    Share,
    /// A share or the codes.
    Either,
}

/// One backup as given, before its codes are read: the text and its record header.
#[derive(Debug)]
pub struct BackupReading {
    record: Option<(Mode, Form)>,
    text: SecretText,
    words: Option<usize>,
}

impl BackupReading {
    /// Reads the record header of `text`, if it has one, and refuses at once what no answer to a
    /// later question can mend: a header that cannot be read, a record without Seedshift where only
    /// Seedshift will do, a Shamir share where an encoded seed phrase was asked for, and rules
    /// whose `words` no phrase has.
    pub fn of(text: &str, rules: ReadingRules<'_>) -> Result<Self, ReadingError> {
        if let Some(words) = rules.words {
            check_word_count(words).map_err(ReadingError::Sizes)?;
        }
        let record = parse_record(text)?;
        if record
            .as_ref()
            .is_some_and(|record| !record.mode.masked() && rules.seedshift_only)
        {
            return Err(ReadingError::SeedshiftOnly);
        }
        let payload = record.as_ref().map_or(text, |record| record.payload);
        // A share's own checksum makes a phrase's codes read as one only by a chance of about one
        // in four billion; a record header says it is no share.
        #[cfg(feature = "sskr")]
        if record.is_none() && read_share(payload).is_ok() {
            return Err(ReadingError::Share(rules.share_reader.to_owned()));
        }
        Ok(Self {
            record: record.map(|record| (record.mode, record.form)),
            text: SecretText::copy_of("a backup", payload),
            words: rules.words,
        })
    }

    /// The text of the codes in `form`: with the words of the phrase given, only the codes of so
    /// many words from the start; all of them otherwise.
    fn payload_in(&self, form: Form) -> String {
        match self.words {
            Some(words) => form.leading_codes(self.text.as_str(), words),
            None => self.text.as_str().to_owned(),
        }
    }

    /// The text in the record's form, or the form its characters most likely are.
    fn likely_payload(&self) -> String {
        let form = self
            .record
            .map_or_else(|| Form::likely(self.text.as_str()), |(_, form)| form);
        self.payload_in(form)
    }

    /// The forms that `found` finds the codes to fit, each tried on its own leading codes where the
    /// words of the phrase were given.
    fn fitting(&self, found: impl Fn(&str) -> Vec<Form>) -> Vec<Form> {
        if self.words.is_none() {
            return found(self.text.as_str());
        }
        Form::ALL
            .into_iter()
            .filter(|&form| found(&self.payload_in(form)).contains(&form))
            .collect()
    }

    /// Whether `text`, given in place of an encoded seed phrase, holds Shamir shares: a share when
    /// it reads as one and not as codes, either when it reads as both; none when it is no share, or
    /// carries a record header, which only codes have. Marked with ?, it is a share when one of its
    /// readings as a share has a solution; with few marks the share's checksum settles it, with
    /// many they are either. A file or paste is split first, so later shares are not mistaken for
    /// the decoy codes after the first one.
    #[cfg(feature = "sskr")]
    pub fn share_kind(text: &str) -> Result<Option<ShareKind>, ReadingError> {
        if parse_record(text)?.is_some() {
            return Ok(None);
        }
        let parts = ShareInput::parts_of_text(text).map_err(ReadingError::Set)?;
        if parts.len() > 1 {
            let mut possible = None;
            for part in &parts {
                match Self::share_kind(part)? {
                    Some(ShareKind::Share) => return Ok(Some(ShareKind::Share)),
                    kind => possible = possible.or(kind),
                }
            }
            return Ok(possible);
        }
        let part = parts.first().map_or(text, String::as_str);
        if read_share(part).is_ok() {
            return Ok(Some(ShareKind::Share));
        }
        if !MissingCodes::marked(part) {
            return Ok(None);
        }
        let Ok(readings) = MarkedReading::of(trim(part)) else {
            return Ok(None);
        };
        let unknown_bits: Vec<usize> = readings
            .iter()
            .filter_map(MarkedReading::space)
            .map(|space| space.unknown_bits())
            .collect();
        if unknown_bits.is_empty() {
            return Ok(None);
        }
        // A share's checksum and layout are more than 50 bits of rules: marks of up to 32 unknown
        // bits that still meet them leave no doubt, while text of another kind meets them by chance
        // only.
        if unknown_bits
            .iter()
            .any(|&bits| bits <= SURE_SHARE_UNKNOWN_BITS)
        {
            return Ok(Some(ShareKind::Share));
        }
        Ok(Some(if MissingCodes::forms(part).is_empty() {
            ShareKind::Share
        } else {
            ShareKind::Either
        }))
    }

    /// Whether the text has an MNC1 record header, which names the mode and the form.
    pub const fn has_record(&self) -> bool {
        self.record.is_some()
    }

    /// The mode of the codes: the record's, or `given` by the host; none when neither names it.
    pub fn mode(&self, given: Option<Mode>) -> Option<Mode> {
        self.record.map(|(mode, _)| mode).or(given)
    }

    /// The line that says that the record names another mode than `given`.
    pub fn mode_conflict(&self, given: Option<Mode>) -> Option<String> {
        mode_conflict_of(self.record.map(|(mode, _)| mode), given)
    }

    /// The line that says that the record holds codes of another form than `given`.
    pub fn form_conflict(&self, given: Option<Form>) -> Option<String> {
        form_conflict_of(self.record.map(|(_, form)| form), given)
    }

    /// The form that is named, before any is detected: the record's, which wins over `given`.
    fn named_form(&self, given: Option<Form>) -> Option<Form> {
        self.record.map(|(_, form)| form).or(given)
    }

    /// The forms that the codes may be in: the record's, or `given`, or every form that they fit,
    /// of which the host asks for one when there are several. Codes that fit no form are refused as
    /// the form that their characters most likely are refuses them, naming places or the count
    /// only; codes that this form reads, but that fit no form as a whole, are refused as such.
    pub fn forms(&self, given: Option<Form>) -> Result<Vec<Form>, ReadingError> {
        if let Some(forms) = self.named_or_fitting(given, detect) {
            return Ok(forms);
        }
        let likely = self.likely_payload();
        Backup::read(&likely, Form::likely(&likely), Mode::Direct)?;
        Err(ReadingError::FitNoForm)
    }

    /// Whether `text`, given where the words of a seed phrase were asked for, is the codes of an
    /// encoded seed phrase in a form other than words: complete, or marked with ?. A host that
    /// reads words then says where codes are read instead.
    pub fn is_codes(text: &str) -> bool {
        let forms = if MissingCodes::marked(text) {
            MissingCodes::forms(text)
        } else {
            detect(text)
        };
        forms.iter().any(|form| !form.written_in_words())
    }

    /// The form that the record or `given` names, or those that `fit` finds; none where none fits.
    fn named_or_fitting(
        &self,
        given: Option<Form>,
        fit: impl Fn(&str) -> Vec<Form>,
    ) -> Option<Vec<Form>> {
        if let Some(named) = self.named_form(given) {
            return Some(vec![named]);
        }
        let fitting = self.fitting(fit);
        (!fitting.is_empty()).then_some(fitting)
    }

    /// Whether the codes mark some that cannot be read, to be searched.
    pub fn marked(&self) -> bool {
        if self.record.is_none() && self.words.is_some() {
            // Hexadecimal Color Unicode also looks like word Unicode: a fitting form, rather than
            // that guess, decides which codes precede the decoys when no record names the form.
            let fitting = self.fitting(MissingCodes::forms);
            if !fitting.is_empty() {
                return fitting
                    .into_iter()
                    .any(|form| MissingCodes::marked(&self.payload_in(form)));
            }
        }
        MissingCodes::marked(&self.likely_payload())
    }

    /// The forms that the marked codes may be in: the record's, or `given`, or every form that they
    /// fit. Marked codes that fit no form are refused, with a hint where they are run together.
    pub fn marked_forms(&self, given: Option<Form>) -> Result<Vec<Form>, ReadingError> {
        if let Some(forms) = self.named_or_fitting(given, MissingCodes::forms) {
            return Ok(forms);
        }
        Err(ReadingError::MarkedFitNoForm(with_joined_marks_hint(
            &format!("{FIT_NO_FORM}: mark each code that cannot be read with ?, in its place."),
            self.text.as_str(),
        )))
    }

    /// The marked codes in `form`, taken as not masked until the host gives their mode.
    pub fn missing_codes(&self, form: Form) -> Result<MissingCodes, MarkedError> {
        MissingCodes::read(&self.payload_in(form), form, Mode::Direct)
    }

    /// The codes in `form`, held to the rules that need no mode: their count, and that each is a
    /// code of that form. The host then gives them their mode, which may find the checksum missing.
    pub fn codes(&self, form: Form) -> Result<Backup, BackupError> {
        Backup::read(&self.payload_in(form), form, Mode::Direct)
    }
}

/// The line that says that a record made with `recorded` was given another mode, `given`, or none
/// when either is missing or they agree.
pub fn mode_conflict_of(recorded: Option<Mode>, given: Option<Mode>) -> Option<String> {
    let (recorded, given) = (recorded?, given?);
    (recorded != given).then(|| {
        format!(
            "The record was made with {}, not with {}.",
            recorded.name(),
            given.name()
        )
    })
}

/// The same for the form of the codes.
pub fn form_conflict_of(recorded: Option<Form>, given: Option<Form>) -> Option<String> {
    let (recorded, given) = (recorded?, given?);
    (recorded != given).then(|| {
        format!(
            "The record holds {} codes, not {}.",
            recorded.name(),
            given.name()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::record::serialize_record;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const RULES: ReadingRules<'static> = ReadingRules {
        seedshift_only: false,
        share_reader: "the Shares tab",
        words: None,
    };

    #[test]
    fn a_record_names_its_mode_and_form() {
        let record = serialize_record(Mode::Seedshift, Form::English, TWELVE).unwrap();
        let reading = BackupReading::of(&record, RULES).unwrap();
        assert!(reading.has_record());
        assert_eq!(reading.mode(Some(Mode::Direct)), Some(Mode::Seedshift));
        assert_eq!(reading.forms(Some(Form::Colors)).unwrap(), [Form::English]);
        assert!(reading.mode_conflict(Some(Mode::Direct)).is_some());
        assert_eq!(reading.mode_conflict(Some(Mode::Seedshift)), None);
        assert_eq!(
            reading.form_conflict(Some(Form::Colors)).as_deref(),
            Some("The record holds english codes, not colors.")
        );
    }

    #[test]
    fn a_record_without_seedshift_is_refused_where_only_seedshift_will_do() {
        let record = serialize_record(Mode::Direct, Form::English, TWELVE).unwrap();
        let rules = ReadingRules {
            seedshift_only: true,
            ..RULES
        };
        assert_eq!(
            BackupReading::of(&record, rules).unwrap_err(),
            ReadingError::SeedshiftOnly
        );
    }

    #[test]
    fn codes_that_fit_no_form_say_why() {
        let reading = BackupReading::of("abandon", RULES).unwrap();
        assert!(reading.forms(None).is_err());
        let reading = BackupReading::of("# # #", RULES).unwrap();
        assert_eq!(
            reading.marked_forms(None).unwrap_err().code(),
            "core.backup-reading.marked-codes-fit-no-form"
        );
    }

    #[test]
    fn marked_words_are_told_from_complete_ones() {
        let marked = TWELVE.replace("about", "?");
        let reading = BackupReading::of(&marked, RULES).unwrap();
        assert!(reading.marked());
        assert!(reading.marked_forms(None).unwrap().contains(&Form::English));
        assert!(!BackupReading::of(TWELVE, RULES).unwrap().marked());
    }

    #[test]
    fn codes_are_told_from_words() {
        assert!(BackupReading::is_codes(&["1"; 12].join(" ")));
        assert!(!BackupReading::is_codes(TWELVE));
    }
}
