//! Seedshift (MnemoCode TS 0.1.0's `core/seedshift.ts`, CAP-PHRASE-FORMATS-MODE-SEEDSHIFT, -MODE-LEGACY,
//! -MODE-DIRECT): each word moved by the shift its date gives it, modulo the 2,048 words.
//!
//! - MnemoCode Seedshift moves the entropy, not the checksum: each 11-bit chunk modulo 2,048 and the
//!   bits the last word keeps beside the checksum modulo their own range, so that the masked words
//!   keep a valid checksum, which BIP39 computes again. Modular addition is reversible even where
//!   several dates give the same shifts.
//! - The Original Seedshift moves each word number modulo 2,048, kept for existing records; its
//!   masked words need not keep the checksum.
//! - Direct writes the words themselves.
//!
//! The word indexes are counted from 0 and held in [`Indexes`], which wipes them when dropped.

use bip39::{Language, Mnemonic};
use zeroize::Zeroize;

use crate::bip39::phrase::{Phrase, PhraseError, valid_last_word_indexes};
use crate::bip39::sizes::{
    DICTIONARY_SIZE, SizesError, check_word_count, check_word_indexes, last_word_entropy_bits,
};
use crate::dates::{Date, Dates, DatesError, Shifts, derive_shifts};

/// Word indexes, from 0, wiped when dropped.
#[derive(Clone, PartialEq, Eq)]
pub struct Indexes(Vec<u16>);

impl Indexes {
    /// The indexes `values`; each below 2,048 is the caller's to check (`check`).
    pub fn new(values: Vec<u16>) -> Self {
        Self(values)
    }

    /// The indexes.
    pub fn as_slice(&self) -> &[u16] {
        &self.0
    }

    /// Refuses a count that no phrase has and an index outside the lists.
    pub fn check(&self) -> Result<(), SizesError> {
        check_word_count(self.0.len())?;
        check_word_indexes(&self.0)
    }
}

impl Drop for Indexes {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl std::fmt::Debug for Indexes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        crate::secret::redacted(f, "word indexes")
    }
}

/// Why a Seedshift was refused: by the phrase's sizes or by its dates.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShiftError {
    /// The indexes are no phrase.
    Sizes(SizesError),
    /// The dates give no shifts.
    Dates(DatesError),
    /// The phrase could not be read.
    Phrase(PhraseError),
}

impl From<SizesError> for ShiftError {
    fn from(error: SizesError) -> Self {
        Self::Sizes(error)
    }
}

impl From<DatesError> for ShiftError {
    fn from(error: DatesError) -> Self {
        Self::Dates(error)
    }
}

impl From<PhraseError> for ShiftError {
    fn from(error: PhraseError) -> Self {
        Self::Phrase(error)
    }
}

/// Masks (+) or unmasks (−).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Direction {
    Mask,
    Unmask,
}

/// `value` moved by `shift` in `direction`, modulo `modulus`.
fn moved(value: u64, shift: u64, modulus: u64, direction: Direction) -> u64 {
    let shift = shift % modulus;
    match direction {
        Direction::Mask => (value + shift) % modulus,
        Direction::Unmask => (value + modulus - shift) % modulus,
    }
}

/// The Original Seedshift on word indexes.
fn shifted_indexes(indexes: &[u16], shifts: &[u16], direction: Direction) -> Vec<u16> {
    indexes
        .iter()
        .zip(shifts)
        .map(|(&index, &shift)| {
            let size = DICTIONARY_SIZE as u64;
            u16::try_from(moved(u64::from(index), u64::from(shift), size, direction)).unwrap_or(0)
        })
        .collect()
}

/// The entropy of a phrase of `indexes`, which must keep the checksum, as bytes.
fn entropy_of(indexes: &[u16]) -> Result<Vec<u8>, PhraseError> {
    let phrase = Phrase::of_indexes(
        &indexes
            .iter()
            .map(|&index| usize::from(index))
            .collect::<Vec<_>>(),
    )?;
    let (bytes, length) = phrase.mnemonic()?.to_entropy_array();
    let entropy = bytes.get(..length).map(<[u8]>::to_vec).unwrap_or_default();
    let mut bytes = bytes;
    bytes.zeroize();
    Ok(entropy)
}

/// The word indexes of a phrase of `entropy`, whose checksum BIP39 computes.
fn indexes_of_entropy(entropy: &[u8]) -> Result<Vec<u16>, PhraseError> {
    let mnemonic = Mnemonic::from_entropy_in(Language::English, entropy)
        .map_err(|_| PhraseError::WordCount)?;
    Ok(mnemonic
        .word_indices()
        .map(|index| u16::try_from(index).unwrap_or(0))
        .collect())
}

/// Reads `width` bits of `bytes` from bit `at`, the most significant first.
fn bits_at(bytes: &[u8], at: usize, width: usize) -> u64 {
    (0..width).fold(0, |value, offset| {
        let bit = at + offset;
        let set = bytes
            .get(bit / 8)
            .is_some_and(|byte| byte & (0x80 >> (bit % 8)) != 0);
        (value << 1) | u64::from(set)
    })
}

/// Writes the `width` low bits of `value` into `bytes` from bit `at`.
fn put_bits(bytes: &mut [u8], at: usize, width: usize, value: u64) {
    for offset in 0..width {
        let bit = at + offset;
        let set = (value >> (width - 1 - offset)) & 1 == 1;
        if let Some(byte) = bytes.get_mut(bit / 8) {
            if set {
                *byte |= 0x80 >> (bit % 8);
            } else {
                *byte &= !(0x80 >> (bit % 8));
            }
        }
    }
}

/// MnemoCode Seedshift on the entropy of a phrase of `word_count` words: each 11-bit chunk moved
/// modulo 2,048, the last word's entropy bits modulo their own range.
fn shifted_entropy(
    entropy: &[u8],
    shifts: &[u16],
    word_count: usize,
    direction: Direction,
) -> Vec<u8> {
    let mut out = vec![0_u8; entropy.len()];
    for (chunk, &shift) in shifts.iter().enumerate().take(word_count - 1) {
        let value = bits_at(entropy, chunk * 11, 11);
        put_bits(
            &mut out,
            chunk * 11,
            11,
            moved(value, u64::from(shift), DICTIONARY_SIZE as u64, direction),
        );
    }
    let tail_width = last_word_entropy_bits(word_count);
    let tail_at = (word_count - 1) * 11;
    let tail = bits_at(entropy, tail_at, tail_width);
    let last_shift = u64::from(shifts.get(word_count - 1).copied().unwrap_or(0));
    put_bits(
        &mut out,
        tail_at,
        tail_width,
        moved(tail, last_shift, 1 << tail_width, direction),
    );
    out
}

/// A masked record: the phrase's words, the masked indexes, the dates in calendar order and the
/// shift of each word.
pub struct Masked {
    /// The masked word indexes.
    pub shifted: Indexes,
    /// The dates, earliest first.
    pub dates: Dates,
    /// The shift of each word.
    pub shifts: Shifts,
}

/// Redacted: it holds the dates, which are part of the secret.
impl std::fmt::Debug for Masked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        crate::secret::redacted(f, "a masked record")
    }
}

/// The phrase's word indexes.
fn phrase_indexes(phrase: &Phrase) -> Vec<u16> {
    (0..phrase.len())
        .map(|place| u16::try_from(phrase.index(place).unwrap_or(0)).unwrap_or(0))
        .collect()
}

/// The dates in calendar order and the shifts they give a phrase of `word_count` words.
fn dated(dates: &[Date], word_count: usize) -> Result<(Vec<Date>, Vec<u16>), ShiftError> {
    check_word_count(word_count)?;
    let mut sorted = dates.to_vec();
    sorted.sort_unstable();
    let shifts = derive_shifts(&sorted, word_count)?;
    Ok((sorted, shifts))
}

/// The MnemoCode Seedshift record of `phrase` under `dates`, whose masked words keep a valid
/// checksum.
pub fn mask(phrase: &Phrase, dates: &[Date]) -> Result<Masked, ShiftError> {
    let indexes = phrase_indexes(phrase);
    let (dates, shifts) = dated(dates, indexes.len())?;
    let mut entropy = entropy_of(&indexes)?;
    let mut moved_entropy = shifted_entropy(&entropy, &shifts, indexes.len(), Direction::Mask);
    let shifted = indexes_of_entropy(&moved_entropy)?;
    entropy.zeroize();
    moved_entropy.zeroize();
    Ok(Masked {
        shifted: Indexes(shifted),
        dates: Dates::new(&dates),
        shifts: Shifts::new(&shifts),
    })
}

/// The Original Seedshift record of `phrase` under `dates`.
pub fn mask_legacy(phrase: &Phrase, dates: &[Date]) -> Result<Masked, ShiftError> {
    let mut indexes = phrase_indexes(phrase);
    let (dates, shifts) = dated(dates, indexes.len())?;
    let shifted = shifted_indexes(&indexes, &shifts, Direction::Mask);
    indexes.zeroize();
    Ok(Masked {
        shifted: Indexes(shifted),
        dates: Dates::new(&dates),
        shifts: Shifts::new(&shifts),
    })
}

/// The masked indexes of a legacy record with only their checksum bits replaced, so that they keep a
/// valid checksum while the entropy they show stays.
pub fn legacy_checksum_valid(shifted: &Indexes) -> Result<Indexes, ShiftError> {
    shifted.check()?;
    let word_count = shifted.0.len();
    let mut entropy = vec![0_u8; crate::bip39::sizes::entropy_bytes(word_count)];
    for (place, &index) in shifted.0.iter().enumerate() {
        let width = if place + 1 == word_count {
            last_word_entropy_bits(word_count)
        } else {
            11
        };
        let value = if place + 1 == word_count {
            u64::from(index) >> (11 - width)
        } else {
            u64::from(index)
        };
        put_bits(&mut entropy, place * 11, width, value);
    }
    let indexes = indexes_of_entropy(&entropy)?;
    entropy.zeroize();
    Ok(Indexes(indexes))
}

/// What a decoder recovered: the phrase's indexes, the dates, the shifts, and whether the phrase
/// keeps its checksum.
pub struct Unmasked {
    /// The recovered word indexes.
    pub recovered: Indexes,
    /// The dates, earliest first.
    pub dates: Dates,
    /// The shift of each word.
    pub shifts: Shifts,
    /// Whether the recovered phrase keeps the BIP39 checksum.
    pub checksum_valid: bool,
}

/// Redacted: it holds the dates, which are part of the secret.
impl std::fmt::Debug for Unmasked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        crate::secret::redacted(f, "a decoded record")
    }
}

/// Whether the indexes keep the BIP39 checksum.
fn keeps_checksum(indexes: &[u16]) -> bool {
    Phrase::of_indexes(
        &indexes
            .iter()
            .map(|&index| usize::from(index))
            .collect::<Vec<_>>(),
    )
    .is_ok()
}

/// The phrase that [`mask`] masked into `indexes` under `dates`; the codes must keep the checksum.
pub fn unmask(indexes: &Indexes, dates: &[Date]) -> Result<Unmasked, ShiftError> {
    let (dates, shifts) = checked_and_dated(indexes, dates)?;
    let mut entropy = entropy_of(&indexes.0)?;
    let mut moved_entropy = shifted_entropy(&entropy, &shifts, indexes.0.len(), Direction::Unmask);
    let recovered = indexes_of_entropy(&moved_entropy)?;
    entropy.zeroize();
    moved_entropy.zeroize();
    Ok(unmasked(recovered, dates, shifts))
}

/// `indexes`, refused where they are no phrase, and the dates in order with their shifts.
fn checked_and_dated(
    indexes: &Indexes,
    dates: &[Date],
) -> Result<(Vec<Date>, Vec<u16>), ShiftError> {
    indexes.check()?;
    dated(dates, indexes.0.len())
}

/// What was recovered, with whether it keeps the checksum.
fn unmasked(recovered: Vec<u16>, dates: Vec<Date>, shifts: Vec<u16>) -> Unmasked {
    let checksum_valid = keeps_checksum(&recovered);
    Unmasked {
        recovered: Indexes(recovered),
        dates: Dates::new(&dates),
        shifts: Shifts::new(&shifts),
        checksum_valid,
    }
}

/// The phrase of an Original Seedshift record, whose masked words need not keep the checksum.
pub fn unmask_legacy(indexes: &Indexes, dates: &[Date]) -> Result<Unmasked, ShiftError> {
    let (dates, shifts) = checked_and_dated(indexes, dates)?;
    let recovered = shifted_indexes(&indexes.0, &shifts, Direction::Unmask);
    Ok(unmasked(recovered, dates, shifts))
}

/// Every phrase an old legacy record may hold after its final word was replaced by a valid one:
/// the replacement discards bits, so other evidence selects a candidate.
pub fn unmask_legacy_valid(indexes: &Indexes, dates: &[Date]) -> Result<Vec<Unmasked>, ShiftError> {
    let (dates, shifts) = checked_and_dated(indexes, dates)?;
    let prefix = shifted_indexes(
        &indexes.0[..indexes.0.len() - 1],
        &shifts,
        Direction::Unmask,
    );
    let prefix_usize: Vec<usize> = prefix.iter().map(|&index| usize::from(index)).collect();
    Ok(valid_last_word_indexes(&prefix_usize)?
        .into_iter()
        .map(|last| {
            let mut recovered = prefix.clone();
            recovered.push(u16::try_from(last).unwrap_or(0));
            Unmasked {
                recovered: Indexes(recovered),
                dates: Dates::new(&dates),
                shifts: Shifts::new(&shifts),
                checksum_valid: true,
            }
        })
        .collect())
}

/// The indexes of a record written without date shifting: the words themselves.
pub fn direct(indexes: &Indexes) -> Result<Unmasked, ShiftError> {
    indexes.check()?;
    let checksum_valid = keeps_checksum(&indexes.0);
    Ok(Unmasked {
        recovered: indexes.clone(),
        dates: Dates::new(&[]),
        shifts: Shifts::new(&vec![0; indexes.0.len()]),
        checksum_valid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn seedshift_masks_and_unmasks_keeping_the_checksum() {
        let phrase = Phrase::parse(ABANDON).unwrap();
        let dates = [Date::new(2001, 2, 3).unwrap()];
        let masked = mask(&phrase, &dates).unwrap();
        assert!(keeps_checksum(masked.shifted.as_slice()));
        let back = unmask(&masked.shifted, &dates).unwrap();
        assert!(back.checksum_valid);
        let original: Vec<u16> = phrase_indexes(&phrase);
        assert_eq!(back.recovered.as_slice(), original.as_slice());
    }

    #[test]
    fn the_original_seedshift_moves_word_numbers() {
        let phrase = Phrase::parse(ABANDON).unwrap();
        let dates = [Date::new(2001, 2, 3).unwrap()];
        let masked = mask_legacy(&phrase, &dates).unwrap();
        assert_eq!(masked.shifted.as_slice()[0], 2001);
        assert_eq!(masked.shifted.as_slice()[1], 2);
        let back = unmask_legacy(&masked.shifted, &dates).unwrap();
        assert_eq!(
            back.recovered.as_slice(),
            phrase_indexes(&phrase).as_slice()
        );
    }
}
