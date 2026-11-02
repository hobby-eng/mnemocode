//! The split of a phrase into the shares of one group (MnemoCode TS 0.1.0's `src/sskr/split.ts`,
//! CAP-SSKR-SPLIT-PHRASE and CAP-SSKR-SPLIT-BACKUP): a backup is masked first in its mode, so the
//! shares hold the phrase its codes hold; the seed of the split comes from the host's randomness
//! (CORE-46); and every new split is restored, each share checked, before it is given out, as the
//! product's promise that written shares restore. The engine is the program's own and linked, so
//! its output is not checked again apart from that restore (CORE-54).

use std::fmt;

use super::engine::{EngineError, Group, split as engine_split};
use super::restore::restore_complete;
use super::set::MIN_DIGEST_THRESHOLD;
use super::share::{MAX_GROUP_MEMBERS, Share};
use crate::bip39::phrase::{Phrase, PhraseError};
use crate::dates::Date;
use crate::modes::{Mode, ModeError};
use crate::random::Random;
use crate::refusal::Refusal;
use crate::secret::equal_bytes;
use crate::text::numbers::{TypedNumberRefused, WholeRange, typed_whole_number};

/// A split makes one group, of at most as many members as SSKR numbers.
pub const MAX_SHARES: usize = MAX_GROUP_MEMBERS;
/// The least threshold of a split: one whose shares keep a digest.
pub const MIN_THRESHOLD: usize = MIN_DIGEST_THRESHOLD;

/// The refusals of a split, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SplitError {
    /// A threshold or a count SSKR does not split into.
    Threshold,
    /// A mode without shares, or dates it refuses.
    Mode(ModeError),
    /// A phrase whose entropy could not be read.
    Phrase(PhraseError),
    /// The engine refused, or the host's randomness failed.
    Engine(EngineError),
    /// Shares that do not give the phrase back.
    Unrestored,
}

impl fmt::Display for SplitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Threshold => write!(
                f,
                "A split needs a threshold from {MIN_THRESHOLD} to the number of shares, and at most {MAX_SHARES} shares: with a threshold of 1 no share would be checked."
            ),
            Self::Mode(error) => error.fmt(f),
            Self::Phrase(error) => error.fmt(f),
            Self::Engine(error) => error.fmt(f),
            Self::Unrestored => {
                f.write_str("SSKR generated shares did not reconstruct the source entropy.")
            }
        }
    }
}

impl std::error::Error for SplitError {}

impl Refusal for SplitError {
    fn code(&self) -> &'static str {
        match self {
            Self::Threshold => "sskr.split.split-threshold-from-number-shares-at-most-shares",
            Self::Mode(error) => error.code(),
            Self::Phrase(error) => error.code(),
            Self::Engine(error) => error.code(),
            Self::Unrestored => {
                "sskr.split.sskr-generated-shares-did-not-reconstruct-source-entropy"
            }
        }
    }
}

/// Refuses a threshold and a count SSKR cannot split into: a threshold from [`MIN_THRESHOLD`] to
/// the count, and at most [`MAX_SHARES`] shares.
pub const fn check_threshold(threshold: usize, count: usize) -> Result<(), SplitError> {
    if threshold >= MIN_THRESHOLD && count >= threshold && count <= MAX_SHARES {
        Ok(())
    } else {
        Err(SplitError::Threshold)
    }
}

/// The `count` shares of `phrase`, `threshold` of them needed, in member order, from a seed of
/// the host's `random`. They are restored before they are returned, every share checked, and must
/// give the phrase back.
pub fn split(
    phrase: &Phrase,
    threshold: usize,
    count: usize,
    random: &mut dyn Random,
) -> Result<Vec<Share>, SplitError> {
    check_threshold(threshold, count)?;
    let entropy = phrase.entropy().map_err(SplitError::Phrase)?;
    let payloads = engine_split(&entropy, 1, &[Group { threshold, count }], random)
        .map_err(SplitError::Engine)?;
    let shares = payloads
        .iter()
        .map(|payload| Share::of_payload(payload))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| SplitError::Unrestored)?;
    let all: Vec<&Share> = shares.iter().collect();
    let restored = restore_complete(&all, None).map_err(|_| SplitError::Unrestored)?;
    let again = restored.phrase.entropy().map_err(SplitError::Phrase)?;
    if !equal_bytes(&again, &entropy) {
        return Err(SplitError::Unrestored);
    }
    Ok(shares)
}

/// A backup split into shares: the shares, and the phrase they hold.
#[derive(Debug)]
pub struct BackupSplit {
    /// The shares, in member order.
    pub shares: Vec<Share>,
    /// The phrase the shares hold: the seed phrase itself, or its Seedshift mask.
    pub held: Phrase,
}

/// How many Shamir shares to make, and how many of them restore the seed phrase: a set that SSKR
/// would refuse cannot exist. A host offers the usual sets and builds one of the person's own from
/// two typed numbers, each refused with a line that says what fits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShareSetChoice {
    threshold: usize,
    count: usize,
}

impl ShareSetChoice {
    /// The usual sets, offered first; Other takes any that SSKR allows.
    pub const PRESETS: [Self; 6] = [
        Self {
            threshold: 2,
            count: 3,
        },
        Self {
            threshold: 2,
            count: 4,
        },
        Self {
            threshold: 3,
            count: 4,
        },
        Self {
            threshold: 3,
            count: 5,
        },
        Self {
            threshold: 4,
            count: 6,
        },
        Self {
            threshold: 5,
            count: 7,
        },
    ];

    /// `count` shares of which `threshold` restore the phrase; refused as a split refuses them.
    pub fn of(threshold: usize, count: usize) -> Result<Self, SplitError> {
        check_threshold(threshold, count)?;
        Ok(Self { threshold, count })
    }

    /// The number of shares in all, as typed; refused unless it is a number SSKR allows.
    pub fn typed_count(answer: &str) -> Result<usize, TypedNumberRefused> {
        let range = WholeRange::new(MIN_THRESHOLD as u64, MAX_SHARES as u64);
        let refusal = format!("Choose {MIN_THRESHOLD} to {MAX_SHARES} shares.");
        Ok(typed_whole_number(answer, range, Some(&refusal))? as usize)
    }

    /// How many of `count` shares restore the phrase, as typed; refused unless it fits `count`.
    pub fn typed_threshold(answer: &str, count: usize) -> Result<usize, TypedNumberRefused> {
        let range = WholeRange::new(MIN_THRESHOLD as u64, count as u64);
        let refusal =
            format!("Type a number from {MIN_THRESHOLD} to {count}, the number of shares.");
        Ok(typed_whole_number(answer, range, Some(&refusal))? as usize)
    }

    /// The fewest distinct shares that restore the phrase.
    #[must_use]
    pub const fn threshold(self) -> usize {
        self.threshold
    }

    /// The shares made.
    #[must_use]
    pub const fn count(self) -> usize {
        self.count
    }

    /// The set in a few words, such as "2 of 3".
    #[must_use]
    pub fn label(self) -> String {
        format!("{} of {}", self.threshold, self.count)
    }

    /// What the set means, such as "3 shares, any 2 restore it".
    #[must_use]
    pub fn note(self) -> String {
        format!("{} shares, any {} restore it", self.count, self.threshold)
    }
}

/// The shares of a backup: the phrase `phrase` makes in `mode` with `dates`, split as [`split`]
/// splits it. The command line and a page split a backup through it, so both put the same phrase
/// into the shares. Refuses a mode without shares and dates the mode refuses before the threshold.
pub fn split_backup(
    phrase: &Phrase,
    mode: Mode,
    dates: &[Date],
    threshold: usize,
    count: usize,
    random: &mut dyn Random,
) -> Result<BackupSplit, SplitError> {
    mode.check_split().map_err(SplitError::Mode)?;
    let masked = mode.encode(phrase, dates).map_err(SplitError::Mode)?;
    let indexes: Vec<usize> = masked
        .shifted
        .as_slice()
        .iter()
        .map(|&index| usize::from(index))
        .collect();
    let held = Phrase::of_indexes(&indexes).map_err(SplitError::Phrase)?;
    let shares = split(&held, threshold, count, random)?;
    Ok(BackupSplit { shares, held })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::parse_date;
    use crate::random::NoRandomness;
    use crate::self_check::vectors::PUBLIC_MNEMONIC;
    use crate::sskr::testing::Counting;

    #[test]
    fn a_split_restores_its_phrase() {
        let phrase = Phrase::parse(PUBLIC_MNEMONIC).unwrap();
        let shares = split(&phrase, 2, 3, &mut Counting(0)).unwrap();
        assert_eq!(shares.len(), 3);
        assert!(
            shares
                .iter()
                .enumerate()
                .all(|(member, share)| share.info().member_index == member
                    && share.info().member_threshold == 2)
        );
        assert_eq!(
            split(&phrase, 1, 3, &mut Counting(0)).unwrap_err(),
            SplitError::Threshold
        );
        assert_eq!(
            split(&phrase, 2, 17, &mut Counting(0)).unwrap_err(),
            SplitError::Threshold
        );
        assert!(matches!(
            split(&phrase, 2, 3, &mut NoRandomness).unwrap_err(),
            SplitError::Engine(EngineError::Random(_))
        ));
    }

    #[test]
    fn a_backup_is_masked_before_it_is_split() {
        let phrase = Phrase::parse(PUBLIC_MNEMONIC).unwrap();
        let date = parse_date("01-02-1990").unwrap();
        let backup =
            split_backup(&phrase, Mode::Seedshift, &[date], 2, 2, &mut Counting(9)).unwrap();
        assert_ne!(backup.held.text().as_str(), phrase.text().as_str());
        assert_eq!(
            split_backup(
                &phrase,
                Mode::SeedshiftLegacy,
                &[date],
                2,
                2,
                &mut Counting(9)
            )
            .unwrap_err()
            .code(),
            "core.masking.split-modes-only"
        );
        let direct = split_backup(&phrase, Mode::Direct, &[], 2, 2, &mut Counting(9)).unwrap();
        assert_eq!(direct.held.text().as_str(), PUBLIC_MNEMONIC);
    }
}
