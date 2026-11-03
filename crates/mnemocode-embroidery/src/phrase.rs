//! The phrase of a pattern as every front end handles it (ADR 0010): masked with MnemoCode
//! Seedshift before it is hidden, since the format is public, and a legend line read back as the
//! record of the masked phrase, which Decode turns back into the phrase with the dates.

use std::fmt;

use mnemocode::backup::{Backup, BackupError};
use mnemocode::bip39::phrase::{Phrase, PhraseError};
use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::refusal::{Refusal, RefusalKind};
use mnemocode::secret::{SecretBytes, SecretText};
use zeroize::Zeroize;

use crate::legend::{self, LegendError, Reading};

/// Why a phrase cannot be masked for a pattern, or a legend line read back.
#[derive(Debug)]
pub enum SeedStitchError {
    /// The phrase or its dates, refused as Seedshift refuses them.
    Backup(BackupError),
    /// The masked phrase, refused as BIP39 refuses it.
    Phrase(PhraseError),
    /// The line is no legend.
    Legend(LegendError),
    /// No change of one row reads as a phrase.
    NotRead,
    /// Changes of different rows read as different phrases.
    Ambiguous,
}

impl fmt::Display for SeedStitchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backup(error) => error.fmt(f),
            Self::Phrase(error) => error.fmt(f),
            Self::Legend(error) => error.fmt(f),
            Self::NotRead => f.write_str(
                "The legend does not read: check each row's symbol number and stitches against the paper.",
            ),
            Self::Ambiguous => f.write_str(
                "The legend reads in more than one way: more than one row may be wrong. Check each row against the paper.",
            ),
        }
    }
}

impl std::error::Error for SeedStitchError {}

impl Refusal for SeedStitchError {
    fn code(&self) -> &'static str {
        match self {
            Self::Backup(error) => error.code(),
            Self::Phrase(error) => error.code(),
            Self::Legend(error) => error.code(),
            Self::NotRead => "embroidery.phrase.legend-not-read",
            Self::Ambiguous => "embroidery.phrase.legend-ambiguous",
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Backup(error) => error.kind(),
            Self::Phrase(error) => error.kind(),
            Self::Legend(error) => error.kind(),
            Self::NotRead | Self::Ambiguous => RefusalKind::Error,
        }
    }
}

/// The entropy of a phrase masked with Seedshift dates: what a pattern's legend may hold. Only
/// [`masked_entropy`] makes one for a front end, so that none hides a phrase that is not masked in
/// the legend of a public format ([`crate::hide::hide`]).
#[derive(Debug)]
pub struct MaskedEntropy(SecretBytes);

impl MaskedEntropy {
    /// A known answer's entropy, taken as masked: for the self-test and the tests, on public data.
    pub(crate) fn known(entropy: &[u8]) -> Self {
        Self(SecretBytes::copy_of("a known answer's entropy", entropy))
    }

    /// Its bytes.
    #[must_use]
    pub fn bytes(&self) -> &SecretBytes {
        &self.0
    }
}

/// The entropy of `phrase` masked with `dates` by MnemoCode Seedshift: what a pattern's legend holds.
///
/// # Errors
///
/// [`SeedStitchError::Backup`] for the dates Seedshift refuses, as Encode refuses them.
pub fn masked_entropy(phrase: &Phrase, dates: &[Date]) -> Result<MaskedEntropy, SeedStitchError> {
    let encoding = Backup::encode(phrase, dates, Form::Indexes, Mode::Seedshift, false)
        .map_err(SeedStitchError::Backup)?;
    let mut indexes: Vec<usize> = encoding
        .backup
        .indexes()
        .iter()
        .map(|&index| usize::from(index))
        .collect();
    let masked = Phrase::of_indexes(&indexes);
    indexes.zeroize();
    masked
        .and_then(|masked| masked.entropy())
        .map(MaskedEntropy)
        .map_err(SeedStitchError::Phrase)
}

/// A legend line read back.
#[derive(Debug)]
pub struct LineRecord {
    record: SecretText,
    corrected: Option<usize>,
}

impl LineRecord {
    /// The record of the masked phrase, `MNC1:seedshift:indexes:…`, which Decode turns back into
    /// the phrase with the dates.
    #[must_use]
    pub const fn record(&self) -> &SecretText {
        &self.record
    }

    /// The row, from 1, that did not fit and was read as the only change of it that gives a phrase;
    /// none where the line read as it is.
    #[must_use]
    pub const fn corrected_row(&self) -> Option<usize> {
        self.corrected
    }

    /// The record, kept without a copy.
    #[must_use]
    pub fn into_record(self) -> SecretText {
        self.record
    }
}

/// The record of the masked phrase that `text` holds where it is written as a legend line
/// ([`legend::is_line`]), as Decode reads one in place of codes; none where it is not one, such as
/// codes or a record.
///
/// # Errors
///
/// [`SeedStitchError::Legend`] for a line that is no legend, [`SeedStitchError::NotRead`] and
/// [`SeedStitchError::Ambiguous`].
pub fn record_of_legend(text: &str) -> Result<Option<LineRecord>, SeedStitchError> {
    if legend::is_line(text) {
        record_of_line(text).map(Some)
    } else {
        Ok(None)
    }
}

/// The legend line `text` read back as the record of its masked phrase.
fn record_of_line(text: &str) -> Result<LineRecord, SeedStitchError> {
    let mut rows = legend::parse(text).map_err(SeedStitchError::Legend)?;
    let reading = legend::read(&rows);
    legend::wipe_rows(&mut rows);
    let (entropy, corrected) = match reading {
        Reading::Read(entropy) => (entropy, None),
        Reading::Corrected { entropy, row } => (entropy, Some(row)),
        Reading::NotRead => return Err(SeedStitchError::NotRead),
        Reading::Ambiguous => return Err(SeedStitchError::Ambiguous),
    };
    let masked = Phrase::of_entropy(&entropy).map_err(SeedStitchError::Phrase)?;
    let mut indexes: Vec<u16> = (0..masked.len())
        .map(|place| masked.index(place).map_or(0, |index| index as u16))
        .collect();
    let backup = Backup::of(&indexes, Form::Indexes, Mode::Seedshift);
    indexes.zeroize();
    let record = backup
        .and_then(|backup| backup.record())
        .map_err(SeedStitchError::Backup)?;
    Ok(LineRecord { record, corrected })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legend::EXAMPLE;

    /// Trezor's published 24-word test vector, which the specification's legend holds.
    const VOID: &str = "void come effort suffer camp survey warrior heavy shoot primary clutch crush \
                        open amazing screen patrol group space point ten exist slush involve unfold";

    #[test]
    fn the_specification_legend_becomes_the_record_of_its_masked_phrase() {
        let read = record_of_line(EXAMPLE).unwrap();
        let void = Phrase::parse(VOID).unwrap();
        let numbers: Vec<String> = (0..24)
            .map(|place| (void.index(place).unwrap() + 1).to_string())
            .collect();
        assert_eq!(
            read.record().as_str(),
            format!("MNC1:seedshift:indexes:{}", numbers.join(" "))
        );
        assert_eq!(read.corrected_row(), None);
    }

    #[test]
    fn a_line_with_one_row_mistyped_names_the_row() {
        let mistyped = EXAMPLE.replacen("28:1725", "28:1752", 1);
        let read = record_of_line(&mistyped).unwrap();
        assert_eq!(read.corrected_row(), Some(1));
        assert_eq!(
            read.record().as_str(),
            record_of_line(EXAMPLE).unwrap().record().as_str()
        );
        assert_eq!(
            record_of_line("28:1725 25:2163").unwrap_err().code(),
            "embroidery.phrase.legend-not-read"
        );
        assert!(record_of_legend(EXAMPLE).unwrap().is_some());
        for codes in ["1 2 3", "MNC1:seedshift:indexes:1 2 3", "#0191F4 #238E92"] {
            assert!(record_of_legend(codes).unwrap().is_none(), "{codes}");
        }
    }

    #[test]
    fn a_masked_phrase_decodes_with_its_dates_to_the_phrase() {
        let indexes = |phrase: &Phrase| -> Vec<u16> {
            (0..phrase.len())
                .map(|place| phrase.index(place).unwrap() as u16)
                .collect()
        };
        let phrase = Phrase::parse(VOID).unwrap();
        let dates = [mnemocode::dates::parse_date("23-09-2026").unwrap()];
        let entropy = masked_entropy(&phrase, &dates).unwrap();
        assert_ne!(entropy.bytes().to_vec(), phrase.entropy().unwrap().to_vec());
        let masked = Phrase::of_entropy(entropy.bytes()).unwrap();
        let backup = Backup::of(&indexes(&masked), Form::Indexes, Mode::Seedshift).unwrap();
        assert_eq!(
            backup.decode(&dates).unwrap().recovered.as_slice(),
            indexes(&phrase)
        );
        assert_eq!(
            masked_entropy(&phrase, &[]).unwrap_err().code(),
            Backup::encode(&phrase, &[], Form::Indexes, Mode::Seedshift, false)
                .unwrap_err()
                .code()
        );
    }
}
