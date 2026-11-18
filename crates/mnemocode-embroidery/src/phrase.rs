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

use crate::legend::{self, Holds, LegendError, Reading};

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
    /// The legend holds one share of a set, where a whole backup is asked for.
    Share,
    /// The phrase cannot be split into shares, as Encode refuses it, such as for its threshold.
    #[cfg(feature = "sskr")]
    Split(mnemocode::sskr::split::SplitError),
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
            Self::Share => f.write_str(
                "This legend holds one share of a set, not a whole backup: restore the seed phrase from shares, with enough of the set's patterns.",
            ),
            #[cfg(feature = "sskr")]
            Self::Split(error) => error.fmt(f),
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
            Self::Share => "embroidery.phrase.share",
            #[cfg(feature = "sskr")]
            Self::Split(error) => error.code(),
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Backup(error) => error.kind(),
            Self::Phrase(error) => error.kind(),
            Self::Legend(error) => error.kind(),
            Self::NotRead | Self::Ambiguous | Self::Share => RefusalKind::Error,
            #[cfg(feature = "sskr")]
            Self::Split(error) => error.kind(),
        }
    }
}

/// The entropy a pattern's legend holds, what it is, and with the Original Seedshift the last word
/// its shift gave and the one the legend's phrase ends with: made by [`legend_entropy`] and the
/// functions it calls, and by [`share_entropies`] ([`crate::hide::hide`]).
pub struct LegendEntropy {
    entropy: SecretBytes,
    holds: Holds,
    last_words: Option<(u16, u16)>,
}

/// Redacted: it holds the entropy and the word to remember.
impl fmt::Debug for LegendEntropy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LegendEntropy(..)")
    }
}

impl LegendEntropy {
    /// A known answer's entropy, taken as masked: for the self-test and the tests, on public data.
    pub(crate) fn known(entropy: &[u8]) -> Self {
        Self {
            entropy: SecretBytes::copy_of("a known answer's entropy", entropy),
            holds: Holds::Entropy,
            last_words: None,
        }
    }

    /// Its bytes.
    #[must_use]
    pub const fn bytes(&self) -> &SecretBytes {
        &self.entropy
    }

    /// Whether its phrase is masked.
    #[must_use]
    pub const fn holds(&self) -> Holds {
        self.holds
    }

    /// With the Original Seedshift, the last word its shift gave, which the person keeps to restore
    /// the phrase exactly, and the one the phrase held ends with, both indexes; none otherwise.
    #[must_use]
    pub const fn last_words(&self) -> Option<(u16, u16)> {
        self.last_words
    }
}

/// The entropy of `phrase` masked with `dates` by MnemoCode Seedshift: what a pattern's legend holds.
///
/// # Errors
///
/// [`SeedStitchError::Backup`] for the dates Seedshift refuses, as Encode refuses them.
pub fn masked_entropy(phrase: &Phrase, dates: &[Date]) -> Result<LegendEntropy, SeedStitchError> {
    written_entropy(phrase, dates, Mode::Seedshift)
}

/// The entropy of `phrase` masked with `dates` by the Original Seedshift, as Encode writes it: with
/// a last word that keeps the checksum, so that it is a phrase's entropy as every other mode's.
///
/// # Errors
///
/// [`SeedStitchError::Backup`] for the dates Seedshift refuses, as Encode refuses them.
pub fn legacy_entropy(phrase: &Phrase, dates: &[Date]) -> Result<LegendEntropy, SeedStitchError> {
    written_entropy(phrase, dates, Mode::SeedshiftLegacy)
}

/// What the legends of the `count` SSKR shares of `phrase` hold, `threshold` of them needed: the
/// phrase in `mode` with `dates`, split as Encode splits it, one share to a legend.
///
/// # Errors
///
/// [`SeedStitchError::Split`] for what a split refuses.
#[cfg(feature = "sskr")]
pub fn share_entropies(
    phrase: &Phrase,
    (mode, dates): (Mode, &[Date]),
    (threshold, count): (usize, usize),
    random: &mut dyn mnemocode::random::Random,
) -> Result<Vec<LegendEntropy>, SeedStitchError> {
    let split = mnemocode::sskr::split::split_backup(phrase, mode, dates, threshold, count, random)
        .map_err(SeedStitchError::Split)?;
    let holds = Holds::Share;
    let written = split
        .held
        .index(split.held.len() - 1)
        .and_then(|index| u16::try_from(index).ok());
    let last_words = split.original_last_word.zip(written);
    Ok(split
        .shares
        .iter()
        .map(|share| LegendEntropy {
            entropy: SecretBytes::copy_of("a share", share.payload()),
            holds,
            last_words,
        })
        .collect())
}

/// The entropy of the codes `phrase` masked with `dates` in `mode` gives, which keep the checksum.
fn written_entropy(
    phrase: &Phrase,
    dates: &[Date],
    mode: Mode,
) -> Result<LegendEntropy, SeedStitchError> {
    let holds = Holds::Entropy;
    let encoding =
        Backup::encode(phrase, dates, Form::Indexes, mode).map_err(SeedStitchError::Backup)?;
    let mut indexes: Vec<usize> = encoding
        .backup
        .indexes()
        .iter()
        .map(|&index| usize::from(index))
        .collect();
    let masked = Phrase::of_indexes(&indexes);
    indexes.zeroize();
    let written = encoding.backup.indexes().last().copied();
    let last_words = encoding.original_last_word.zip(written);
    masked
        .and_then(|masked| masked.entropy())
        .map(|entropy| LegendEntropy {
            entropy,
            holds,
            last_words,
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
            holds: Holds::Entropy,
            last_words: None,
        })
        .map_err(SeedStitchError::Phrase)
}

/// What a legend holds of `phrase` in `mode`: its entropy masked with `dates`, or its own.
///
/// # Errors
///
/// [`SeedStitchError::Backup`] for dates.
pub fn legend_entropy(
    phrase: &Phrase,
    mode: Mode,
    dates: &[Date],
) -> Result<LegendEntropy, SeedStitchError> {
    mode.check_date_count(dates.len(), false, DateWords::Codes)
        .map_err(|refusal| SeedStitchError::Backup(refusal.into()))?;
    match mode {
        Mode::Direct => unmasked_entropy(phrase),
        Mode::SeedshiftLegacy | Mode::SeedshiftLegacyValid => legacy_entropy(phrase, dates),
        Mode::Seedshift => masked_entropy(phrase, dates),
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

/// Whether `text` is a legend line that reads as typed, with its DMC numbers or without them, no row
/// taken as misread: cheap, unlike a reading that looks for a misread row.
#[must_use]
pub fn reads_as_typed(text: &str) -> bool {
    let exact = |line: &str| {
        legend::parse(line).is_ok_and(|mut rows| {
            let read = legend::read_exactly(&rows).is_some();
            legend::wipe_rows(&mut rows);
            read
        })
    };
    legend::is_line(text)
        && (exact(text) || without_threads(text).is_some_and(|plain| exact(&plain)))
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
    let (held, holds, corrected, misread) = held_of_line(text)?;
    if holds.is_share() {
        return Err(SeedStitchError::Share);
    }
    // A phrase's entropy says nothing of its mode: its word numbers alone, whose mode Decode asks.
    let phrase = Phrase::of_entropy(&held).map_err(SeedStitchError::Phrase)?;
    let mut indexes: Zeroizing<Vec<u16>> = Zeroizing::new(
        (0..phrase.len())
            .map(|place| phrase.index(place).map_or(0, |index| index as u16))
            .collect(),
    );
    let backup = Backup::of(&indexes, Form::Indexes, Mode::Direct);
    indexes.zeroize();
    let record = backup
        .and_then(|backup| backup.text())
        .map_err(SeedStitchError::Backup)?;
    Ok(LineRecord {
        record,
        corrected,
        misread,
    })
}

/// A legend line of one SSKR share read back: the share, and a row taken as misread, as
/// [`LineRecord`] tells it.
#[cfg(feature = "sskr")]
#[derive(Debug)]
pub struct ShareLine {
    /// The share.
    pub share: mnemocode::sskr::share::Share,
    /// The row, from 1, read as misread, where only it explains the change.
    pub corrected_row: Option<usize>,
    /// Whether a row was read as misread.
    pub corrected: bool,
}

/// The SSKR share in `text` where it is a legend line of one, else none.
///
/// # Errors
///
/// What [`record_of_legend`] refuses of a line that does not read.
#[cfg(feature = "sskr")]
pub fn share_of_legend(text: &str) -> Result<Option<ShareLine>, SeedStitchError> {
    if !legend::is_line(text) {
        return Ok(None);
    }
    let (held, holds, corrected_row, corrected) = held_of_line(text)?;
    if !holds.is_share() {
        return Ok(None);
    }
    let share =
        mnemocode::sskr::share::Share::of_payload(&held).map_err(|_| SeedStitchError::NotRead)?;
    Ok(Some(ShareLine {
        share,
        corrected_row,
        corrected,
    }))
}

/// What the legend line `text` holds, how, and the row read as misread: as [`record_of_line`]
/// reads it.
fn held_of_line(text: &str) -> Result<(SecretBytes, Holds, Option<usize>, bool), SeedStitchError> {
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
    let (entropy, holds, corrected, misread) = match reading {
        Reading::Read { entropy, holds } => (entropy, holds, None, false),
        Reading::Corrected {
            entropy,
            holds,
            row,
        } => (entropy, holds, row, true),
        Reading::NotRead => return Err(SeedStitchError::NotRead),
        Reading::Ambiguous => return Err(SeedStitchError::Ambiguous),
    };
    Ok((entropy, holds, corrected, misread))
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
        // A record holds the word numbers alone, as a backup file does.
        let ordered = record_of_line(crate::legend::EXAMPLE_ORDERED).unwrap();
        assert_eq!(ordered.record().as_str().split(' ').count(), 24);
    }

    #[test]
    fn the_specification_legend_becomes_the_record_of_its_masked_phrase() {
        let read = record_of_line(EXAMPLE).unwrap();
        let void = Phrase::parse(VOID).unwrap();
        let numbers: Vec<String> = (0..24)
            .map(|place| (void.index(place).unwrap() + 1).to_string())
            .collect();
        assert_eq!(read.record().as_str(), numbers.join(" "));
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
        assert_eq!(own.holds(), Holds::Entropy);
        assert_eq!(&**own.bytes(), &*void.entropy().unwrap());
        let masked = legend_entropy(&void, Mode::Seedshift, &date).unwrap();
        assert_eq!(masked.holds(), Holds::Entropy);
        assert_ne!(&**masked.bytes(), &**own.bytes());
        // The Original Seedshift's codes, with the last word Encode writes, are a phrase's entropy
        // as long as every other mode's.
        let original = legend_entropy(&void, Mode::SeedshiftLegacy, &date).unwrap();
        assert_eq!(original.holds(), Holds::Entropy);
        assert_eq!(original.bytes().len(), own.bytes().len());
        assert_ne!(&**original.bytes(), &**masked.bytes());
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
            Backup::encode(&phrase, &[], Form::Indexes, Mode::Seedshift)
                .unwrap_err()
                .code()
        );
    }
}
