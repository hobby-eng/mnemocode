//! The phrase of a pattern as every front end handles it (ADR 0010): masked with MnemoCode
//! Seedshift before it is hidden, since the format is public, unless the person chooses the phrase
//! itself; and a legend line read back as the record that Decode turns into the phrase.

use std::fmt;

use mnemocode::backup::{Backup, BackupError};
use mnemocode::bip39::phrase::{Phrase, PhraseError};
use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::{Refusal, RefusalKind};
use mnemocode::secret::{SecretBytes, SecretText};
use zeroize::{Zeroize, Zeroizing};

use crate::legend::{self, LegendError, Masking, Reading};

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
    /// The mode is the original Seedshift, whose result a legend cannot hold.
    Mode,
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
            Self::Mode => f.write_str(
                "A pattern holds a phrase masked with MnemoCode Seedshift, or the phrase itself: the original Seedshift's result usually fails the checksum, and a legend holds only a valid phrase.",
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
            Self::Mode => "embroidery.phrase.mode",
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Backup(error) => error.kind(),
            Self::Phrase(error) => error.kind(),
            Self::Legend(error) => error.kind(),
            Self::NotRead | Self::Ambiguous | Self::Mode => RefusalKind::Error,
        }
    }
}

/// The entropy a pattern's legend holds and whether its phrase is masked: made only by
/// [`masked_entropy`] or, where the person chooses it, [`unmasked_entropy`] ([`crate::hide::hide`]).
#[derive(Debug)]
pub struct LegendEntropy {
    entropy: SecretBytes,
    masking: Masking,
}

impl LegendEntropy {
    /// A known answer's entropy, taken as masked: for the self-test and the tests, on public data.
    pub(crate) fn known(entropy: &[u8]) -> Self {
        Self {
            entropy: SecretBytes::copy_of("a known answer's entropy", entropy),
            masking: Masking::Seedshift,
        }
    }

    /// Its bytes.
    #[must_use]
    pub const fn bytes(&self) -> &SecretBytes {
        &self.entropy
    }

    /// Whether its phrase is masked.
    #[must_use]
    pub const fn masking(&self) -> Masking {
        self.masking
    }
}

/// The entropy of `phrase` masked with `dates` by MnemoCode Seedshift: what a pattern's legend holds.
///
/// # Errors
///
/// [`SeedStitchError::Backup`] for the dates Seedshift refuses, as Encode refuses them.
pub fn masked_entropy(phrase: &Phrase, dates: &[Date]) -> Result<LegendEntropy, SeedStitchError> {
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
        .map(|entropy| LegendEntropy {
            entropy,
            masking: Masking::Seedshift,
        })
        .map_err(SeedStitchError::Phrase)
}

/// The entropy of `phrase` itself, unmasked: anyone who knows the public format reads it.
///
/// # Errors
///
/// [`SeedStitchError::Phrase`] for a phrase whose entropy cannot be taken.
pub fn unmasked_entropy(phrase: &Phrase) -> Result<LegendEntropy, SeedStitchError> {
    phrase
        .entropy()
        .map(|entropy| LegendEntropy {
            entropy,
            masking: Masking::Unmasked,
        })
        .map_err(SeedStitchError::Phrase)
}

/// `mode` where a pattern can hold its result: MnemoCode Seedshift, or none.
///
/// # Errors
///
/// [`SeedStitchError::Mode`] for the original Seedshift.
pub const fn legend_mode(mode: Mode) -> Result<Mode, SeedStitchError> {
    match mode {
        Mode::Seedshift | Mode::Direct => Ok(mode),
        _ => Err(SeedStitchError::Mode),
    }
}

/// What a legend holds of `phrase` in `mode`: its entropy masked with `dates`, or its own.
///
/// # Errors
///
/// [`SeedStitchError::Mode`] for the original Seedshift; [`SeedStitchError::Backup`] for dates.
pub fn legend_entropy(
    phrase: &Phrase,
    mode: Mode,
    dates: &[Date],
) -> Result<LegendEntropy, SeedStitchError> {
    let mode = legend_mode(mode)?;
    mode.check_date_count(dates.len(), false, DateWords::Codes)
        .map_err(|refusal| SeedStitchError::Backup(refusal.into()))?;
    match mode {
        Mode::Direct => unmasked_entropy(phrase),
        _ => masked_entropy(phrase, dates),
    }
}

/// A legend line read back.
#[derive(Debug)]
pub struct LineRecord {
    record: SecretText,
    corrected: Option<usize>,
    /// Whether a row was taken as misread, told for sure or not.
    misread: bool,
}

impl LineRecord {
    /// The record of the phrase: `MNC1:seedshift:indexes:…` for a masked one, which Decode turns
    /// back into the phrase with the dates, or `MNC1:direct:indexes:…`.
    #[must_use]
    pub const fn record(&self) -> &SecretText {
        &self.record
    }

    /// The row, from 1, that did not fit and was read as the only change of it that gives a phrase;
    /// none where the line read as it is, or where changes of several rows give the same phrase.
    #[must_use]
    pub const fn corrected_row(&self) -> Option<usize> {
        self.corrected
    }

    /// Whether a row did not fit and was read as changed, whether or not [`Self::corrected_row`]
    /// can tell which.
    #[must_use]
    pub const fn corrected(&self) -> bool {
        self.misread
    }

    /// The record, kept without a copy.
    #[must_use]
    pub fn into_record(self) -> SecretText {
        self.record
    }
}

/// The record of the phrase in `text` where it is a legend line ([`legend::is_line`]), else none.
///
/// # Errors
///
/// [`SeedStitchError::Legend`], [`SeedStitchError::NotRead`] and [`SeedStitchError::Ambiguous`].
pub fn record_of_legend(text: &str) -> Result<Option<LineRecord>, SeedStitchError> {
    if legend::is_line(text) {
        record_of_line(text).map(Some)
    } else {
        Ok(None)
    }
}

/// How the rows of `text` read.
fn reading_of(text: &str) -> Result<Reading, SeedStitchError> {
    let mut rows = legend::parse(text).map_err(SeedStitchError::Legend)?;
    let reading = legend::read(&rows);
    legend::wipe_rows(&mut rows);
    Ok(reading)
}

/// `text` with the DMC number taken out of each row, where every row has one: a format 1 sheet
/// prints the threads too, and a person may type them (AUD-007-FUN001).
fn without_threads(text: &str) -> Option<Zeroizing<String>> {
    let mut plain = Zeroizing::new(String::with_capacity(text.len()));
    for word in text
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter(|word| !word.is_empty())
    {
        let mut parts = word.split(':');
        let (Some(symbol), Some(_thread), Some(stitches), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        if !plain.is_empty() {
            plain.push(' ');
        }
        plain.push_str(symbol);
        plain.push(':');
        plain.push_str(stitches);
    }
    (!plain.is_empty()).then_some(plain)
}

/// The legend line `text` read back as the record of its phrase, masked or not. Rows typed with a DMC
/// number read as format 2, and also as format 1 without the numbers, as a person types a format 1
/// sheet whose key prints each row's thread: a reading as typed beats one that corrects a row.
fn record_of_line(text: &str) -> Result<LineRecord, SeedStitchError> {
    let first = reading_of(text);
    let reading = if matches!(first, Ok(Reading::Read { .. })) {
        first?
    } else {
        match (first, without_threads(text).map(|plain| reading_of(&plain))) {
            (_, Some(Ok(read @ Reading::Read { .. }))) => read,
            (Ok(corrected @ Reading::Corrected { .. }), _)
            | (_, Some(Ok(corrected @ Reading::Corrected { .. }))) => corrected,
            (first, _) => first?,
        }
    };
    let (entropy, masking, corrected, misread) = match reading {
        Reading::Read { entropy, masking } => (entropy, masking, None, false),
        Reading::Corrected {
            entropy,
            masking,
            row,
        } => (entropy, masking, row, true),
        Reading::NotRead => return Err(SeedStitchError::NotRead),
        Reading::Ambiguous => return Err(SeedStitchError::Ambiguous),
    };
    let masked = Phrase::of_entropy(&entropy).map_err(SeedStitchError::Phrase)?;
    let mut indexes: Vec<u16> = (0..masked.len())
        .map(|place| masked.index(place).map_or(0, |index| index as u16))
        .collect();
    let mode = match masking {
        Masking::Seedshift => Mode::Seedshift,
        Masking::Unmasked => Mode::Direct,
    };
    let backup = Backup::of(&indexes, Form::Indexes, mode);
    indexes.zeroize();
    let record = backup
        .and_then(|backup| backup.record())
        .map_err(SeedStitchError::Backup)?;
    Ok(LineRecord {
        record,
        corrected,
        misread,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legend::EXAMPLE;

    /// Trezor's published 24-word test vector, which the specification's legend holds.
    const VOID: &str = "void come effort suffer camp survey warrior heavy shoot primary clutch crush \
                        open amazing screen patrol group space point ten exist slush involve unfold";

    // AUD-007-FUN001: a format 1 sheet typed with the DMC column its key prints reads as typed
    // without it; a format 2 line still reads as format 2.
    #[test]
    fn a_format_1_legend_typed_with_its_threads_reads_as_without_them() {
        let typed: Vec<String> = EXAMPLE
            .split_whitespace()
            .zip(crate::dmc::THREADS.iter())
            .map(|(row, thread)| {
                let (symbol, stitches) = row.split_once(':').unwrap();
                format!("{symbol}:{}:{stitches}", thread.number())
            })
            .collect();
        let plain = record_of_line(EXAMPLE).unwrap();
        let with_threads = record_of_line(&typed.join(" ")).unwrap();
        assert_eq!(with_threads.record().as_str(), plain.record().as_str());
        let ordered = record_of_line(crate::legend::EXAMPLE_ORDERED).unwrap();
        assert!(ordered.record().as_str().starts_with("MNC1:"));
    }

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
    fn a_legend_holds_the_phrase_masked_by_mnemocode_seedshift_or_itself_and_no_other() {
        let void = Phrase::parse(VOID).unwrap();
        let date = [mnemocode::dates::parse_date("23-09-2026").unwrap()];
        let own = legend_entropy(&void, Mode::Direct, &[]).unwrap();
        // Dates the mode does not take, or lacks, are refused as Encode refuses them.
        assert_eq!(
            legend_entropy(&void, Mode::Direct, &date)
                .unwrap_err()
                .code(),
            "core.masking.assert-takes-dates-refused"
        );
        assert_eq!(
            legend_entropy(&void, Mode::Seedshift, &[])
                .unwrap_err()
                .code(),
            "core.masking.assert-date-count-refused"
        );
        assert_eq!(own.masking(), Masking::Unmasked);
        assert_eq!(&**own.bytes(), &*void.entropy().unwrap());
        let masked = legend_entropy(&void, Mode::Seedshift, &date).unwrap();
        assert_eq!(masked.masking(), Masking::Seedshift);
        assert_ne!(&**masked.bytes(), &**own.bytes());
        for original in [Mode::SeedshiftLegacy, Mode::SeedshiftLegacyValid] {
            assert_eq!(
                legend_entropy(&void, original, &date).unwrap_err().code(),
                "embroidery.phrase.mode"
            );
        }
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
