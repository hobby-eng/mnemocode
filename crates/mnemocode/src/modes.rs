//! The transformation modes (MnemoCode TS 0.1.0's `core/masking.ts`, CAP-PHRASE-FORMATS-MASKING-RULES):
//! no Seedshift, MnemoCode Seedshift, the Original Seedshift and the Original Seedshift with a
//! valid last word, each with its rules: whether it masks with dates, keeps the checksum, gives
//! several phrases for complete dates, and what a backup of it allows (shares, a check of what was
//! written, a sheet for heirs). Every rule that tells the modes apart is a method of [`Mode`], so
//! that no caller switches over their names.

pub mod seedshift;

use std::fmt;

use crate::bip39::phrase::{Phrase, PhraseError};
use crate::bip39::sizes::{
    DICTIONARY_SIZE, SizesError, check_word_count, checksum_bits, last_word_entropy_bits,
};
use crate::dates::Date;
use crate::refusal::Refusal;
use seedshift::{Indexes, Masked, ShiftError, Unmasked};

/// A transformation mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Mode {
    /// No Seedshift: the words themselves.
    Direct,
    /// MnemoCode Seedshift, which keeps the checksum.
    Seedshift,
    /// The Original Seedshift, kept for existing records.
    SeedshiftLegacy,
    /// The Original Seedshift whose last word was replaced by one with a valid checksum.
    SeedshiftLegacyValid,
}

/// What a backup made with a mode allows besides the backup itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capabilities {
    /// Whether the phrase can be split into Shamir shares.
    pub split: bool,
    /// Whether what was written down can be checked against the result.
    pub backup_check: bool,
    /// Whether a sheet for heirs can be made.
    pub heir_sheet: bool,
}

/// How a refusal of a wrong number of dates is worded, by the command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DateWords {
    /// Encode, decode and every host.
    Codes,
    /// A split into shares.
    Split,
    /// A restore or export from shares.
    Recovery,
}

/// The refusals of the modes, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ModeError {
    /// A value that names no mode, or no mode with dates where one is needed.
    Unsupported,
    /// No date where the mode needs them.
    DateCount(String),
    /// Dates where the mode takes none.
    TakesDates(String),
    /// A mode in which no shares are made.
    SplitModesOnly,
    /// A mode for which no sheet for heirs can be made; the mode's name.
    HeirSheet(&'static str),
    /// Codes without the checksum their mode gives them; the mode's name.
    MissingChecksum(&'static str),
    /// The phrase, its sizes or its dates.
    Shift(ShiftError),
}

impl fmt::Display for ModeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => f.write_str("Unsupported Seedshift mode."),
            Self::DateCount(message) | Self::TakesDates(message) => f.write_str(message),
            Self::SplitModesOnly => {
                f.write_str("Shares are made without Seedshift or with MnemoCode Seedshift.")
            }
            Self::HeirSheet(name) => write!(
                f,
                "A sheet for heirs cannot be made for {name}: only a search finds its seed phrase."
            ),
            Self::MissingChecksum(name) => write!(
                f,
                "These codes lack the BIP39 checksum that {name} gives them."
            ),
            Self::Shift(ShiftError::Sizes(error)) => error.fmt(f),
            Self::Shift(ShiftError::Dates(error)) => error.fmt(f),
            Self::Shift(ShiftError::Phrase(error)) => error.fmt(f),
        }
    }
}

impl std::error::Error for ModeError {}

impl Refusal for ModeError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "core.masking.unsupported-mode",
            Self::DateCount(_) => "core.masking.assert-date-count-refused",
            Self::TakesDates(_) => "core.masking.assert-takes-dates-refused",
            Self::SplitModesOnly => "core.masking.split-modes-only",
            Self::HeirSheet(_) => "core.masking.sheet-heirs-cannot-made-only-search-finds-seed",
            Self::MissingChecksum(_) => "core.masking.missing-checksum",
            Self::Shift(ShiftError::Sizes(error)) => error.code(),
            Self::Shift(ShiftError::Dates(error)) => error.code(),
            Self::Shift(ShiftError::Phrase(error)) => error.code(),
        }
    }

    fn kind(&self) -> crate::refusal::RefusalKind {
        match self {
            Self::Shift(ShiftError::Dates(error)) => error.kind(),
            _ => crate::refusal::RefusalKind::Error,
        }
    }
}

impl From<ShiftError> for ModeError {
    fn from(error: ShiftError) -> Self {
        Self::Shift(error)
    }
}

impl From<SizesError> for ModeError {
    fn from(error: SizesError) -> Self {
        Self::Shift(ShiftError::Sizes(error))
    }
}

impl From<PhraseError> for ModeError {
    fn from(error: PhraseError) -> Self {
        Self::Shift(ShiftError::Phrase(error))
    }
}

/// The label of the fingerprint of codes.
const ENCODED_FINGERPRINT: &str = "Encoded fingerprint";

/// The words every result uses for the two phrases, so that no one takes the masked phrase for the
/// wallet's.
pub mod phrase_words {
    /// The original seed phrase.
    pub const ORIGINAL: &str = "the original seed phrase, the wallet's";
    /// The label above each phrase that a restore found.
    pub const ORIGINAL_LABEL: &str = "Original seed phrase, the wallet's";
    /// What unmasked codes hold.
    pub const ORIGINAL_ITSELF: &str = "the original seed phrase itself";
    /// What masked codes hold.
    pub const MASKED: &str = "the masked phrase (decoy)";
    /// The fingerprint of the original phrase.
    pub const ORIGINAL_FINGERPRINT: &str = "Original fingerprint";
    /// The fingerprint of masked codes.
    pub const ENCODED_FINGERPRINT: &str = "Encoded fingerprint (of the masked phrase)";
    /// Under both fingerprints of a masked backup.
    pub const FINGERPRINT_ROLES: &str =
        "Original is the wallet itself; encoded is the masked phrase (decoy).";
}

impl Mode {
    /// Every mode, in the order the menu and the help name them.
    pub const ALL: [Self; 4] = [
        Self::Direct,
        Self::Seedshift,
        Self::SeedshiftLegacy,
        Self::SeedshiftLegacyValid,
    ];

    /// The stable record and command-line identifier.
    pub const fn id(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Seedshift => "seedshift",
            Self::SeedshiftLegacy => "seedshift-legacy",
            Self::SeedshiftLegacyValid => "seedshift-legacy-valid",
        }
    }

    /// The mode identified by `id`; refused for any other value.
    pub fn named(id: &str) -> Result<Self, ModeError> {
        Self::ALL
            .into_iter()
            .find(|mode| mode.id() == id)
            .ok_or(ModeError::Unsupported)
    }

    /// Its name in a sentence: "MnemoCode Seedshift".
    pub const fn name(self) -> &'static str {
        match self {
            Self::Direct => "no Seedshift",
            Self::Seedshift => "MnemoCode Seedshift",
            Self::SeedshiftLegacy => "the Original Seedshift",
            Self::SeedshiftLegacyValid => "the Original Seedshift with a valid last word",
        }
    }

    /// Whether it masks with dates, which are then needed to undo it.
    pub const fn masked(self) -> bool {
        !matches!(self, Self::Direct)
    }

    /// Whether its codes are a valid BIP39 phrase themselves.
    pub const fn keeps_checksum(self) -> bool {
        matches!(self, Self::Seedshift | Self::SeedshiftLegacyValid)
    }

    /// Whether complete dates still leave several phrases.
    pub const fn gives_several(self) -> bool {
        matches!(self, Self::SeedshiftLegacyValid)
    }

    /// What a backup of it allows.
    pub const fn capabilities(self) -> Capabilities {
        match self {
            Self::Direct | Self::Seedshift => Capabilities {
                split: true,
                backup_check: true,
                heir_sheet: true,
            },
            Self::SeedshiftLegacy => Capabilities {
                split: false,
                backup_check: true,
                heir_sheet: true,
            },
            Self::SeedshiftLegacyValid => Capabilities {
                split: false,
                backup_check: false,
                heir_sheet: false,
            },
        }
    }

    /// The mode a backup names once its last word is replaced by a valid one, where it offers that.
    pub const fn with_valid_last_word(self) -> Option<Self> {
        match self {
            Self::SeedshiftLegacy => Some(Self::SeedshiftLegacyValid),
            _ => None,
        }
    }

    /// Whether a phrase can be encoded in it directly: a mode that only a replaced last word gives
    /// cannot.
    pub fn encodable(self) -> bool {
        !Self::ALL
            .into_iter()
            .any(|mode| mode.with_valid_last_word() == Some(self))
    }

    /// What its codes hold, as a result says it.
    pub const fn holds(self) -> &'static str {
        if self.masked() {
            phrase_words::MASKED
        } else {
            phrase_words::ORIGINAL_ITSELF
        }
    }

    /// The label of the fingerprint of its codes.
    pub const fn encoded_fingerprint_label(self) -> &'static str {
        if self.masked() {
            phrase_words::ENCODED_FINGERPRINT
        } else {
            ENCODED_FINGERPRINT
        }
    }

    /// The warning about wrong dates, where it masks.
    pub fn wrong_date_warning(self) -> Option<String> {
        if !self.masked() {
            return None;
        }
        let result = if self.keeps_checksum() {
            "Wrong dates can still give a valid seed phrase."
        } else {
            "Wrong dates may fail the checksum or give a valid seed phrase."
        };
        Some(format!(
            "{result} A valid checksum does not confirm the owner's wallet."
        ))
    }

    /// Refuses `count` dates where it takes none, and none where it needs them unless they are asked
    /// later, in the command's `words`.
    pub fn check_date_count(
        self,
        count: usize,
        asked_later: bool,
        words: DateWords,
    ) -> Result<(), ModeError> {
        self.check_takes_dates(count, words)?;
        if self.masked() && count == 0 && !asked_later {
            let message = match words {
                DateWords::Codes => format!("{} requires at least one date.", self.id()),
                DateWords::Split => "Seedshift requires at least one date.".to_owned(),
                DateWords::Recovery => "Seedshift recovery requires its original dates.".to_owned(),
            };
            return Err(ModeError::DateCount(message));
        }
        Ok(())
    }

    fn check_takes_dates(self, count: usize, words: DateWords) -> Result<(), ModeError> {
        if !self.masked() && count > 0 {
            let message = match words {
                DateWords::Codes => "Dates cannot be used in direct mode.",
                DateWords::Split | DateWords::Recovery => "Direct mode does not accept dates.",
            };
            return Err(ModeError::TakesDates(message.to_owned()));
        }
        Ok(())
    }

    /// Refuses a mode in which no shares are made.
    pub fn check_split(self) -> Result<(), ModeError> {
        if self.capabilities().split {
            Ok(())
        } else {
            Err(ModeError::SplitModesOnly)
        }
    }

    /// Refuses a mode for which no sheet for heirs can be made.
    pub fn check_heir_sheet(self) -> Result<(), ModeError> {
        if self.capabilities().heir_sheet {
            Ok(())
        } else {
            Err(ModeError::HeirSheet(self.name()))
        }
    }

    /// The codes of `phrase` masked with `dates` in this mode.
    pub fn encode(self, phrase: &Phrase, dates: &[Date]) -> Result<Masked, ModeError> {
        self.check_takes_dates(dates.len(), DateWords::Codes)?;
        Ok(match self {
            Self::Direct => {
                let indexes: Vec<u16> = (0..phrase.len())
                    .map(|place| u16::try_from(phrase.index(place).unwrap_or(0)).unwrap_or(0))
                    .collect();
                Masked {
                    shifts: vec![0; indexes.len()],
                    shifted: Indexes::new(indexes),
                    dates: Vec::new(),
                }
            }
            Self::Seedshift => seedshift::mask(phrase, dates)?,
            Self::SeedshiftLegacy => seedshift::mask_legacy(phrase, dates)?,
            Self::SeedshiftLegacyValid => {
                let masked = seedshift::mask_legacy(phrase, dates)?;
                Masked {
                    shifted: seedshift::legacy_checksum_valid(&masked.shifted)?,
                    dates: masked.dates,
                    shifts: masked.shifts,
                }
            }
        })
    }

    /// Refuses codes this mode cannot have written: no phrase's count or indexes, and, where it
    /// keeps the checksum, codes without one.
    pub fn check_codes(self, indexes: &Indexes) -> Result<(), ModeError> {
        indexes.check()?;
        if self.keeps_checksum() {
            let all: Vec<usize> = indexes
                .as_slice()
                .iter()
                .map(|&index| usize::from(index))
                .collect();
            if Phrase::of_indexes(&all).is_err() {
                return Err(ModeError::MissingChecksum(self.name()));
            }
        }
        Ok(())
    }

    /// Every phrase `indexes` and the complete `dates` give: one, unless it gives several.
    pub fn undo(self, indexes: &Indexes, dates: &[Date]) -> Result<Vec<Unmasked>, ModeError> {
        self.check_takes_dates(dates.len(), DateWords::Codes)?;
        self.check_codes(indexes)?;
        Ok(match self {
            Self::Direct => vec![seedshift::direct(indexes)?],
            Self::Seedshift => vec![seedshift::unmask(indexes, dates)?],
            Self::SeedshiftLegacy => vec![seedshift::unmask_legacy(indexes, dates)?],
            Self::SeedshiftLegacyValid => seedshift::unmask_legacy_valid(indexes, dates)?,
        })
    }

    /// The checksum-valid phrases, so the wallet checks, one date combination gives on average.
    pub fn checks_per_combination(self, word_count: usize) -> Result<f64, ModeError> {
        check_word_count(word_count)?;
        Ok(match self {
            Self::Direct => 0.0,
            Self::Seedshift => 1.0,
            Self::SeedshiftLegacy => {
                2_f64.powi(-i32::try_from(checksum_bits(word_count)).unwrap_or(0))
            }
            Self::SeedshiftLegacyValid => f64::from(1_u32 << last_word_entropy_bits(word_count)),
        })
    }

    /// The wallet checks one decoding with complete dates gives on average.
    pub fn checks_per_decoding(self, word_count: usize) -> Result<f64, ModeError> {
        if self.masked() {
            self.checks_per_combination(word_count)
        } else {
            Ok(1.0)
        }
    }

    /// What the shift of the last word of a `word_count`-word phrase is taken modulo.
    pub fn last_shift_modulus(self, word_count: usize) -> Result<u32, ModeError> {
        check_word_count(word_count)?;
        Ok(match self {
            Self::Direct | Self::SeedshiftLegacy => DICTIONARY_SIZE as u32,
            Self::Seedshift => 1 << last_word_entropy_bits(word_count),
            Self::SeedshiftLegacyValid => 1,
        })
    }

    /// The shifts of one date combination as this mode applies them, so that two combinations with
    /// the same effective shifts give the same phrases.
    pub fn effective_shifts(self, shifts: &[u16]) -> Result<Vec<u32>, ModeError> {
        let last = self.last_shift_modulus(shifts.len())?;
        Ok(shifts
            .iter()
            .enumerate()
            .map(|(place, &shift)| {
                let modulus = if place + 1 == shifts.len() {
                    last
                } else {
                    DICTIONARY_SIZE as u32
                };
                u32::from(shift) % modulus
            })
            .collect())
    }
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.id())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_modes_keep_their_rules() {
        assert_eq!(Mode::named("seedshift-legacy"), Ok(Mode::SeedshiftLegacy));
        assert_eq!(Mode::named("x"), Err(ModeError::Unsupported));
        assert!(!Mode::SeedshiftLegacyValid.encodable());
        assert!(Mode::Seedshift.encodable());
        assert_eq!(
            Mode::Direct
                .check_date_count(1, false, DateWords::Codes)
                .map_err(|error| error.to_string()),
            Err("Dates cannot be used in direct mode.".to_owned())
        );
        assert_eq!(
            Mode::Seedshift
                .check_date_count(0, false, DateWords::Codes)
                .map_err(|error| error.to_string()),
            Err("seedshift requires at least one date.".to_owned())
        );
        assert_eq!(Mode::Seedshift.last_shift_modulus(12), Ok(128));
        assert_eq!(
            Mode::SeedshiftLegacyValid.checks_per_combination(12),
            Ok(128.0)
        );
        assert_eq!(
            ModeError::MissingChecksum(Mode::Seedshift.name()).code(),
            "core.masking.missing-checksum"
        );
    }
}
