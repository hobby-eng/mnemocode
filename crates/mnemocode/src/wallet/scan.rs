//! How many addresses a check compares, and the comparison itself (MnemoCode TS 0.1.0's
//! `core/address-scan.ts`, CAP-WALLET-ADDRESS-SCAN): from the first index of a branch, one key
//! after another, each key's private half wiped once its public key is compared.

use std::fmt;

use super::coins::KeyPath;
use crate::bip32::{Bip32Error, ExtendedKey, LAST_NORMAL_INDEX};
use crate::refusal::Refusal;
use crate::text::numbers::{WholeRange, integer_refusal};

/// Addresses compared where the person names no number.
pub const DEFAULT_ADDRESS_COUNT: u32 = 20;
/// The most addresses one check compares.
pub const MAX_ADDRESS_COUNT: u32 = 1_000;
/// The numbers of addresses a check takes.
pub const ADDRESS_COUNT_RANGE: WholeRange = WholeRange::new(1, MAX_ADDRESS_COUNT as u64);
/// BIP32's normal indexes.
pub const NORMAL_INDEX_RANGE: WholeRange = WholeRange::new(0, LAST_NORMAL_INDEX as u64);

/// The refusals of a scan, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScanError {
    /// A first index outside the normal indexes.
    FirstIndex,
    /// A count outside [`ADDRESS_COUNT_RANGE`].
    Count,
    /// A range that would pass the last normal index.
    PastLastIndex,
    /// BIP32's refusal.
    Bip32(Bip32Error),
}

impl fmt::Display for ScanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FirstIndex => f.write_str(&integer_refusal(
                "The first index",
                NORMAL_INDEX_RANGE,
                None,
            )),
            Self::Count => f.write_str(&integer_refusal(
                "The number of addresses compared",
                ADDRESS_COUNT_RANGE,
                None,
            )),
            Self::PastLastIndex => {
                write!(
                    f,
                    "The addresses compared would pass index {LAST_NORMAL_INDEX}."
                )
            }
            Self::Bip32(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ScanError {}

impl Refusal for ScanError {
    fn code(&self) -> &'static str {
        match self {
            Self::FirstIndex => "core.address-scan.first-index-refused",
            Self::Count => "core.address-scan.address-count-refused",
            Self::PastLastIndex => "core.address-scan.addresses-compared-would-pass-index",
            Self::Bip32(error) => error.code(),
        }
    }
}

impl From<Bip32Error> for ScanError {
    fn from(error: Bip32Error) -> Self {
        Self::Bip32(error)
    }
}

/// The addresses compared where the person names none: 20, fewer where the last index comes first.
pub fn default_address_count(first: u32) -> u32 {
    DEFAULT_ADDRESS_COUNT
        .min(LAST_NORMAL_INDEX - first.min(LAST_NORMAL_INDEX) + 1)
        .max(1)
}

/// The number of addresses compared from `first`: one where none is `requested`; refused outside
/// the range or past the last normal index.
pub fn address_count(requested: Option<u64>, first: u64) -> Result<u32, ScanError> {
    if first > u64::from(LAST_NORMAL_INDEX) {
        return Err(ScanError::FirstIndex);
    }
    let Some(requested) = requested else {
        return Ok(1);
    };
    if !(ADDRESS_COUNT_RANGE.min..=ADDRESS_COUNT_RANGE.max).contains(&requested) {
        return Err(ScanError::Count);
    }
    if first + requested - 1 > u64::from(LAST_NORMAL_INDEX) {
        return Err(ScanError::PastLastIndex);
    }
    u32::try_from(requested).map_err(|_| ScanError::Count)
}

/// What a comparison found: what was derived, as the evidence writes it, and the key's path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FoundKey {
    /// The derived value.
    pub derived: String,
    /// The path.
    pub path: KeyPath,
}

/// The key at `path` below `root`, compared by `matched`, which gives what it derived where it
/// matches.
pub fn match_at_path(
    root: &ExtendedKey,
    path: &KeyPath,
    matched: &mut impl FnMut(&ExtendedKey, &[u8; 33]) -> Option<String>,
) -> Result<Option<FoundKey>, ScanError> {
    let key = root.derive(&path.0)?;
    Ok(matched(&key, &key.public_key()?).map(|derived| FoundKey {
        derived,
        path: path.clone(),
    }))
}

/// The keys from `first`, `count` of them, of the branch at `branch` below `root`, each compared by
/// `matched`; the first that matches.
pub fn scan_branch(
    root: &ExtendedKey,
    branch: &KeyPath,
    (first, count): (u32, u32),
    matched: &mut impl FnMut(&ExtendedKey, &[u8; 33]) -> Option<String>,
) -> Result<Option<FoundKey>, ScanError> {
    address_count(Some(u64::from(count)), u64::from(first))?;
    let node = root.derive(&branch.0)?;
    for index in first..first + count {
        let key = node.child(index)?;
        if let Some(derived) = matched(&key, &key.public_key()?) {
            let mut path = branch.0.clone();
            path.push(index);
            return Ok(Some(FoundKey {
                derived,
                path: KeyPath(path),
            }));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_stay_within_the_normal_indexes() {
        assert_eq!(address_count(None, 5), Ok(1));
        assert_eq!(address_count(Some(20), 0), Ok(20));
        assert_eq!(address_count(Some(0), 0), Err(ScanError::Count));
        assert_eq!(
            address_count(Some(2), u64::from(LAST_NORMAL_INDEX)),
            Err(ScanError::PastLastIndex)
        );
        assert_eq!(default_address_count(LAST_NORMAL_INDEX - 4), 5);
        assert_eq!(default_address_count(0), 20);
    }
}
