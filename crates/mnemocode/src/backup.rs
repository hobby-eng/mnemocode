//! An encoded backup (MnemoCode TS 0.1.0's `core/encoded-backup.ts`,
//! CAP-PHRASE-FORMATS-ENCODED-BACKUP, -ENCODED-FINGERPRINT, -SHORTER-PHRASES,
//! -LAST-WORD-REPLACEMENT-READING): codes of a phrase in one form and one mode, checked once as
//! that mode writes them and held as word indexes that are wiped when dropped; written as codes, as
//! a [`record`] or as [`json`], and decoded with the dates.

pub mod json;
pub mod re_encoding;
pub mod record;

use std::fmt;

use crate::bip32::{Bip32Error, ExtendedKey};
use crate::bip39::phrase::Phrase;
use crate::bip39::sizes::{WORD_COUNTS, is_word_count, word_counts_text};
use crate::dates::{Date, maximum_dates};
use crate::forms::{Form, FormError};
use crate::modes::seedshift::{Indexes, Masked, Unmasked};
use crate::modes::{DateWords, Mode, ModeError};
use crate::refusal::Refusal;
use record::{RecordError, serialize_record};

/// The refusals of backups, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackupError {
    /// Codes of a count no phrase has: the count, the form's unit.
    CodeCount(usize, &'static str),
    /// A form always masked, given without a mask.
    FormAlwaysMasked,
    /// A mode only a replaced last word gives.
    NotEncodable,
    /// The replacement asked for outside the legacy mode.
    ReplacementLegacyOnly,
    /// A mode that gives several phrases, decoded as one.
    GivesSeveral,
    /// The form's refusal.
    Form(FormError),
    /// The mode's refusal.
    Mode(ModeError),
    /// The record's refusal.
    Record(RecordError),
}

impl fmt::Display for BackupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CodeCount(count, unit) => write!(f, "These are {count} {unit}; an encoded seed phrase has {}.", word_counts_text()),
            Self::FormAlwaysMasked => f.write_str("English words and word numbers are always masked: unmasked, they are the seed phrase itself. Choose a Seedshift, or Unicode codes or colors."),
            Self::NotEncodable => f.write_str("To create a legacy checksum-valid record, select legacy Seedshift and enable the checksum-word replacement."),
            Self::ReplacementLegacyOnly => f.write_str("The legacy checksum-word replacement is available only in legacy Seedshift mode."),
            Self::GivesSeveral => f.write_str("The Original Seedshift with a valid last word gives several phrases: take its candidates."),
            Self::Form(error) => error.fmt(f),
            Self::Mode(error) => error.fmt(f),
            Self::Record(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for BackupError {}

impl Refusal for BackupError {
    fn code(&self) -> &'static str {
        match self {
            Self::CodeCount(..) => "core.encoded-backup.encoded-seed-phrase",
            Self::FormAlwaysMasked => "core.encoded-backup.form-always-masked",
            Self::NotEncodable => {
                "core.encoded-backup.create-legacy-checksum-valid-record-select-legacy-seedshift"
            }
            Self::ReplacementLegacyOnly => {
                "core.encoded-backup.legacy-checksum-word-replacement-available-only-legacy-seedshift"
            }
            Self::GivesSeveral => {
                "core.encoded-backup.original-seedshift-valid-last-word-gives-several-phrases"
            }
            Self::Form(error) => error.code(),
            Self::Mode(error) => error.code(),
            Self::Record(error) => error.code(),
        }
    }

    fn kind(&self) -> crate::refusal::RefusalKind {
        match self {
            Self::Form(error) => error.kind(),
            Self::Mode(error) => error.kind(),
            _ => crate::refusal::RefusalKind::Error,
        }
    }
}

impl From<FormError> for BackupError {
    fn from(error: FormError) -> Self {
        Self::Form(error)
    }
}

impl From<ModeError> for BackupError {
    fn from(error: ModeError) -> Self {
        Self::Mode(error)
    }
}

/// What encoding gave: the backup, the result of the mode itself, and the result with a valid last
/// word where the mode offers it, whether that changed the last word and whether it was taken.
#[derive(Debug)]
pub struct Encoding {
    /// The backup.
    pub backup: Backup,
    /// The result of the mode itself.
    pub base: Masked,
    /// The result with a valid last word, where the mode offers one.
    pub valid_last_word: Option<Masked>,
    /// Whether the valid last word differs from the mode's.
    pub last_word_changed: bool,
    /// Whether the valid last word was written.
    pub replaced: bool,
}

impl Encoding {
    /// The result written: the valid last word's where it was taken.
    pub fn result(&self) -> &Masked {
        match &self.valid_last_word {
            Some(valid) if self.replaced => valid,
            _ => &self.base,
        }
    }
}

/// An encoded backup.
#[derive(Debug)]
pub struct Backup {
    indexes: Indexes,
    form: Form,
    mode: Mode,
}

impl Backup {
    /// The backup of `indexes` in `form` and `mode`; refused for a count no phrase has and codes the
    /// mode cannot have written.
    pub fn of(indexes: &[u16], form: Form, mode: Mode) -> Result<Self, BackupError> {
        if !is_word_count(indexes.len()) {
            return Err(BackupError::CodeCount(indexes.len(), form.unit()));
        }
        let held = Indexes::new(indexes.to_vec());
        mode.check_codes(&held)?;
        Ok(Self {
            indexes: held,
            form,
            mode,
        })
    }

    /// The backup that `text` writes in `form` and `mode`.
    pub fn read(text: &str, form: Form, mode: Mode) -> Result<Self, BackupError> {
        let indexes = Indexes::new(form.read(text)?);
        Self::of(indexes.as_slice(), form, mode)
    }

    /// Refuses what no encoding allows: a form always masked without a mask, a mode only a replaced
    /// last word gives, and the replacement outside the legacy mode.
    pub fn check_encodable(
        mode: Mode,
        valid_last_word: bool,
        form: Option<Form>,
    ) -> Result<(), BackupError> {
        if form.is_some_and(Form::always_masked) && !mode.masked() {
            return Err(BackupError::FormAlwaysMasked);
        }
        if !mode.encodable() {
            return Err(BackupError::NotEncodable);
        }
        if valid_last_word && mode.with_valid_last_word().is_none() {
            return Err(BackupError::ReplacementLegacyOnly);
        }
        Ok(())
    }

    /// Encodes `phrase` with `dates` in `form` and `mode`, the last word replaced by a valid one
    /// where `valid_last_word` asks it and the mode offers it.
    pub fn encode(
        phrase: &Phrase,
        dates: &[Date],
        form: Form,
        mode: Mode,
        valid_last_word: bool,
    ) -> Result<Encoding, BackupError> {
        Self::check_encodable(mode, valid_last_word, Some(form))?;
        mode.check_date_count(dates.len(), false, DateWords::Codes)?;
        let base = mode.encode(phrase, dates)?;
        let replacement = mode.with_valid_last_word();
        let valid = replacement
            .map(|replacement| replacement.encode(phrase, dates))
            .transpose()?;
        let last_word_changed = valid
            .as_ref()
            .is_some_and(|valid| valid.shifted.as_slice().last() != base.shifted.as_slice().last());
        let replaced = valid_last_word && last_word_changed;
        let (written, record_mode) = match (&valid, replacement) {
            (Some(valid), Some(replacement)) if replaced => (valid, replacement),
            _ => (&base, mode),
        };
        let backup = Self::of(written.shifted.as_slice(), form, record_mode)?;
        Ok(Encoding {
            backup,
            base,
            valid_last_word: valid,
            last_word_changed,
            replaced,
        })
    }

    /// The same codes in another mode.
    pub fn with_mode(&self, mode: Mode) -> Result<Self, BackupError> {
        Self::of(self.indexes.as_slice(), self.form, mode)
    }

    /// Its mode.
    pub const fn mode(&self) -> Mode {
        self.mode
    }

    /// Its form.
    pub const fn form(&self) -> Form {
        self.form
    }

    /// Its word indexes.
    pub fn indexes(&self) -> &[u16] {
        self.indexes.as_slice()
    }

    /// Its word count.
    pub fn words(&self) -> usize {
        self.indexes.as_slice().len()
    }

    /// Whether complete dates still leave several phrases.
    pub const fn gives_several(&self) -> bool {
        self.mode.gives_several()
    }

    /// The encoded fingerprint: the master fingerprint of the codes read as a phrase, with no
    /// passphrase; none where they are no valid phrase, as the Original Seedshift's usually are not.
    /// Compared with the one encode showed, it shows a mistyped code before any date is typed.
    pub fn fingerprint(&self) -> Result<Option<[u8; 4]>, Bip32Error> {
        let all: Vec<usize> = self
            .indexes()
            .iter()
            .map(|&index| usize::from(index))
            .collect();
        let Ok(phrase) = Phrase::of_indexes(&all) else {
            return Ok(None);
        };
        Ok(Some(ExtendedKey::of_phrase(&phrase, "")?.fingerprint()?))
    }

    /// Its codes in its form.
    pub fn text(&self) -> Result<String, BackupError> {
        Ok(self.form.codes(self.indexes())?)
    }

    /// Its record.
    pub fn record(&self) -> Result<String, BackupError> {
        serialize_record(self.mode, self.form, &self.text()?).map_err(BackupError::Record)
    }

    /// The phrase it holds under `dates`; refused where the mode gives several.
    pub fn decode(&self, dates: &[Date]) -> Result<Unmasked, BackupError> {
        if self.gives_several() {
            return Err(BackupError::GivesSeveral);
        }
        self.mode
            .undo(&self.indexes, dates)?
            .into_iter()
            .next()
            .ok_or(BackupError::GivesSeveral)
    }

    /// The backup with its last word taken as a replacement, where the mode offers one and the codes
    /// keep the checksum it needs.
    pub fn last_word_replacement(&self) -> Result<Option<Self>, BackupError> {
        let Some(mode) = self.mode.with_valid_last_word() else {
            return Ok(None);
        };
        match self.with_mode(mode) {
            Ok(backup) => Ok(Some(backup)),
            Err(BackupError::Mode(ModeError::MissingChecksum(_))) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Every phrase its codes and complete `dates` give.
    pub fn candidates(&self, dates: &[Date]) -> Result<Vec<Unmasked>, BackupError> {
        Ok(self.mode.undo(&self.indexes, dates)?)
    }

    /// The shorter phrases at its start that `dates` decode to a valid phrase, each with its word
    /// count; a start that takes fewer dates than given, or lacks the checksum its mode keeps, is
    /// left out, and any other refusal passes on.
    pub fn shorter_phrases(&self, dates: &[Date]) -> Result<Vec<(usize, Unmasked)>, BackupError> {
        if self.gives_several() {
            return Ok(Vec::new());
        }
        let mut found = Vec::new();
        // A start that takes fewer dates than given cannot have been written with them.
        let starts = WORD_COUNTS
            .into_iter()
            .filter(|&words| words < self.words() && dates.len() <= maximum_dates(words));
        for words in starts {
            let start = match Self::of(&self.indexes()[..words], self.form, self.mode) {
                Ok(start) => start,
                Err(BackupError::Mode(ModeError::MissingChecksum(_))) => continue,
                Err(error) => return Err(error),
            };
            let result = start.decode(dates)?;
            if result.checksum_valid {
                found.push((words, result));
            }
        }
        Ok(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn a_backup_encodes_and_decodes_its_phrase() {
        let phrase = Phrase::parse(ABANDON).unwrap();
        let dates = [Date::new(2020, 5, 17).unwrap()];
        let encoding =
            Backup::encode(&phrase, &dates, Form::Unicode, Mode::Seedshift, false).unwrap();
        let read = Backup::read(
            &encoding.backup.text().unwrap(),
            Form::Unicode,
            Mode::Seedshift,
        )
        .unwrap();
        let decoded = read.decode(&dates).unwrap();
        assert!(decoded.checksum_valid);
        assert_eq!(decoded.recovered.as_slice()[11], 3);
        assert!(
            read.record()
                .unwrap()
                .starts_with("MNC1:seedshift:unicode:")
        );
        assert!(read.fingerprint().unwrap().is_some());
        assert_eq!(
            Backup::encode(&phrase, &[], Form::English, Mode::Direct, false).err(),
            Some(BackupError::FormAlwaysMasked)
        );
    }

    #[test]
    fn shorter_starts_that_take_fewer_dates_are_left_out() {
        let words24 = format!("{} art", "abandon ".repeat(23).trim_end());
        let phrase = Phrase::parse(&words24).unwrap();
        let dates: Vec<Date> = (1..=6)
            .map(|day| Date::new(2000, 1, day).unwrap())
            .collect();
        let backup = Backup::encode(&phrase, &dates, Form::Indexes, Mode::SeedshiftLegacy, false)
            .unwrap()
            .backup;
        assert!(backup.shorter_phrases(&dates).is_ok());
    }

    #[test]
    fn the_direct_fingerprint_is_the_wallet_s() {
        let phrase = Phrase::parse(ABANDON).unwrap();
        let backup = Backup::encode(&phrase, &[], Form::Unicode, Mode::Direct, false)
            .unwrap()
            .backup;
        assert_eq!(
            backup.fingerprint().unwrap(),
            Some([0x73, 0xc5, 0xda, 0x0a])
        );
    }
}
