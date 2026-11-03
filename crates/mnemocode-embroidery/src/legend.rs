//! The legend of a pattern as a backup: what each row's symbol and stitch count stand for, and how
//! they are read back with no picture. Format 1:
//!
//! - The rows are read in the order the legend prints them, each as its symbol's number in
//!   [`SYMBOLS`] and its count of stitches.
//! - A row's symbol stands for its place among the symbols that no row above it took.
//! - The row with the most stitches carries no more; any other row carries the last two digits
//!   of its count from 1000 stitches, the last digit from 100, nothing below.
//! - Read as one number, the first row's symbol lowest, its remainder below 2 to the power of
//!   `8 * L + 32` is the entropy of a phrase (L of 16, 20, 24, 28 or 32 bytes) and a check of four
//!   bytes: the first four of SHA-256 of `MnemoCode embroidery 1`, the byte L and the entropy. What
//!   lies above it is chosen freely by the writer.
//!
//! A reading whose check fails is tried again with every change of one row: another symbol, one
//! digit of its count or two neighbouring digits swapped, its count on the other side of a limit,
//! or another row as the biggest. Where
//! exactly one entropy comes out, the row is taken as misread.

mod number;
pub mod symbols;

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::secret::{
    CapacityExceeded, SecretBytes, SecretText, TextFiller, equal_bytes, redacted,
};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use number::Number;
pub use symbols::{Glyph, SYMBOLS, Shape, Symbol};

/// The entropy lengths of phrases of 12, 15, 18, 21 and 24 words, in bytes.
pub const ENTROPY_LENGTHS: [usize; 5] = [16, 20, 24, 28, 32];
/// The bytes of the check.
const CHECK_BYTES: usize = 4;
/// What the check's hash starts with.
const CHECK_DOMAIN: &[u8] = b"MnemoCode embroidery 1";
/// The most rows a legend has: one for each symbol.
pub const MAX_ROWS: usize = SYMBOLS.len();
/// The most stitches a row may count.
pub const MAX_STITCHES: u32 = 1_000_000;
/// From this many stitches a row carries the last two digits of its count.
pub const TWO_DIGITS_FROM: u32 = 1000;
/// From this many stitches a row carries the last digit of its count.
pub const ONE_DIGIT_FROM: u32 = 100;
/// The legend of docs/SEEDSTITCH.md, "Example": rows that hold the entropy of Trezor's published
/// 24-word BIP39 test vector "void come effort ... unfold". The self-test reads it, and the menu
/// shows its start as a sample.
pub const EXAMPLE: &str = "28:1725 25:2163 57:3275 34:3917 9:480 54:1505 17:5063 63:372 46:328 \
    7:2818 62:1114 53:1997 37:2496 40:1945 3:882 58:7130 41:180 59:336 22:1634 36:778 64:1147 \
    10:3804 24:1214 69:479 56:931 30:2066 23:3224 29:797";

/// Why typed rows of a legend cannot be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegendError {
    /// No row was given.
    Empty,
    /// More than [`MAX_ROWS`] rows were given.
    TooManyRows,
    /// Row `n` (from 1) is not a symbol's number, a colon and a count.
    NotARow(usize),
    /// Row `n` names no symbol of [`SYMBOLS`].
    UnknownSymbol(usize),
    /// Row `n` counts no stitch, or more than [`MAX_STITCHES`].
    CountOutOfRange(usize),
}

impl fmt::Display for LegendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("Type the rows of the legend: each as the symbol's number, a colon and the stitches."),
            Self::TooManyRows => write!(f, "A legend has at most {MAX_ROWS} rows."),
            Self::NotARow(n) => write!(
                f,
                "Row {n} is not the symbol's number, a colon and the stitches, such as 12:3401."
            ),
            Self::UnknownSymbol(n) => write!(
                f,
                "Row {n} names no symbol: they are numbered 1 to {}.",
                SYMBOLS.len()
            ),
            Self::CountOutOfRange(n) => write!(
                f,
                "Row {n} counts no stitch, or more than {MAX_STITCHES}."
            ),
        }
    }
}

impl std::error::Error for LegendError {}

impl Refusal for LegendError {
    fn code(&self) -> &'static str {
        match self {
            Self::Empty => "embroidery.legend.empty",
            Self::TooManyRows => "embroidery.legend.too-many-rows",
            Self::NotARow(_) => "embroidery.legend.not-a-row",
            Self::UnknownSymbol(_) => "embroidery.legend.unknown-symbol",
            Self::CountOutOfRange(_) => "embroidery.legend.count-out-of-range",
        }
    }
}

/// One row of a legend as a person reads it. Its values stand for part of a backup, so its `Debug`
/// tells nothing (RUST-13).
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Row {
    /// The symbol's number, from 1.
    symbol: usize,
    stitches: u32,
}

impl fmt::Debug for Row {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, "Row")
    }
}

impl Row {
    /// The row of symbol number `symbol` (from 1) and `stitches`.
    ///
    /// # Errors
    ///
    /// [`LegendError::UnknownSymbol`] or [`LegendError::CountOutOfRange`], naming row `place`.
    pub fn new(place: usize, symbol: usize, stitches: u32) -> Result<Self, LegendError> {
        if !(1..=SYMBOLS.len()).contains(&symbol) {
            return Err(LegendError::UnknownSymbol(place));
        }
        if !(1..=MAX_STITCHES).contains(&stitches) {
            return Err(LegendError::CountOutOfRange(place));
        }
        Ok(Self { symbol, stitches })
    }

    /// The symbol's number, from 1.
    #[must_use]
    pub const fn symbol(&self) -> usize {
        self.symbol
    }

    /// Its stitches.
    #[must_use]
    pub const fn stitches(&self) -> u32 {
        self.stitches
    }
}

/// The words of a legend line: apart by spaces, commas, semicolons or line breaks.
fn line_words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter(|word| !word.is_empty())
}

/// Whether `text` is written as a legend line: at least one word, and every word digits, a colon and
/// digits. Codes and records of MnemoCode's forms never are.
#[must_use]
pub fn is_line(text: &str) -> bool {
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    let mut words = line_words(text).peekable();
    words.peek().is_some()
        && words.all(|word| {
            word.split_once(':')
                .is_some_and(|(symbol, stitches)| digits(symbol) && digits(stitches))
        })
}

/// `rows` as the line a person types back: each row's symbol number, a colon and its stitches, a
/// space between rows, as `28:1725 25:2163`.
///
/// # Errors
///
/// [`CapacityExceeded`] where a row is longer than a legend's rows can be, which none is.
pub fn line(rows: &[Row]) -> Result<SecretText, CapacityExceeded> {
    // Each row at most "70:1000000 ".
    SecretText::build("a SeedStitch legend", rows.len() * 11, |filler| {
        for (place, row) in rows.iter().enumerate() {
            if place > 0 {
                filler.push(' ')?;
            }
            push_number(filler, row.symbol as u32)?;
            filler.push(':')?;
            push_number(filler, row.stitches)?;
        }
        Ok(())
    })
}

/// Writes the decimal digits of `value`, leaving no copy behind.
fn push_number(filler: &mut TextFiller<'_, '_>, value: u32) -> Result<(), CapacityExceeded> {
    let mut digits = [0_u8; 10];
    let mut rest = value;
    let mut length = 0;
    loop {
        digits[length] = b'0' + (rest % 10) as u8;
        length += 1;
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    let written = digits[..length]
        .iter()
        .rev()
        .try_for_each(|&digit| filler.push(char::from(digit)));
    digits.zeroize();
    written
}

/// The rows of `text`: each a symbol's number, a colon and a count, apart by spaces, commas, semicolons
/// or line breaks, as `12:3401 7:85`.
///
/// # Errors
///
/// [`LegendError`]: `legend.empty`, `legend.too-many-rows`, `legend.not-a-row`,
/// `legend.unknown-symbol` and `legend.count-out-of-range` of the `embroidery` namespace.
pub fn parse(text: &str) -> Result<Vec<Row>, LegendError> {
    let tokens: Vec<&str> = line_words(text).take(MAX_ROWS + 1).collect();
    if tokens.is_empty() {
        return Err(LegendError::Empty);
    }
    if tokens.len() > MAX_ROWS {
        return Err(LegendError::TooManyRows);
    }
    let mut rows = Vec::with_capacity(tokens.len());
    for (index, token) in tokens.iter().enumerate() {
        let place = index + 1;
        let (symbol, stitches) = token.split_once(':').ok_or(LegendError::NotARow(place))?;
        let digits = |part: &str| {
            (!part.is_empty() && part.len() <= 7 && part.bytes().all(|b| b.is_ascii_digit()))
                .then(|| part.parse::<u32>().ok())
                .flatten()
        };
        let symbol = digits(symbol).ok_or(LegendError::NotARow(place))?;
        let stitches = digits(stitches).ok_or(LegendError::NotARow(place))?;
        rows.push(Row::new(place, symbol as usize, stitches)?);
    }
    Ok(rows)
}

/// The digits that a row of `stitches` carries, as the number its count is divided by: 100 from
/// [`TWO_DIGITS_FROM`], 10 from [`ONE_DIGIT_FROM`], 1 (none) below and for the biggest row.
#[must_use]
pub const fn modulus(stitches: u32, biggest: bool) -> u32 {
    if biggest || stitches < ONE_DIGIT_FROM {
        1
    } else if stitches < TWO_DIGITS_FROM {
        10
    } else {
        100
    }
}

/// The modulus of each row of `counts`; none where two rows share the most stitches.
#[must_use]
pub fn moduli(counts: &[u32]) -> Option<Vec<u32>> {
    let most = *counts.iter().max()?;
    let biggest = counts.iter().position(|&n| n == most)?;
    if counts.iter().filter(|&&n| n == most).count() > 1 {
        return None;
    }
    Some(moduli_with_biggest(counts, biggest))
}

fn moduli_with_biggest(counts: &[u32], biggest: usize) -> Vec<u32> {
    counts
        .iter()
        .enumerate()
        .map(|(i, &n)| modulus(n, i == biggest))
        .collect()
}

/// The four bytes of the check of `entropy`.
fn check(entropy: &[u8]) -> [u8; CHECK_BYTES] {
    let mut hash = Sha256::new();
    hash.update(CHECK_DOMAIN);
    hash.update([entropy.len() as u8]);
    hash.update(entropy);
    let digest = hash.finalize();
    [digest[0], digest[1], digest[2], digest[3]]
}

/// The bits the entropy and its check take for an entropy of `length` bytes.
#[must_use]
pub const fn payload_bits(length: usize) -> usize {
    8 * (length + CHECK_BYTES)
}

/// How many symbols and digits of rows with `moduli` can be: the room of a legend, in bits.
#[must_use]
pub fn room_bits(moduli: &[u32]) -> f64 {
    let symbols: f64 = (0..moduli.len())
        .map(|i| libm::log2((SYMBOLS.len() - i.min(SYMBOLS.len() - 1)) as f64))
        .sum();
    symbols
        + moduli
            .iter()
            .map(|&m| libm::log2(f64::from(m)))
            .sum::<f64>()
}

/// How many values the part above the payload of `length` bytes may take in rows with `moduli`;
/// zero where the rows cannot hold the payload. Capped at [`u64::MAX`].
pub(crate) fn free_values(length: usize, moduli: &[u32]) -> u64 {
    if moduli.len() > SYMBOLS.len() {
        return 0;
    }
    let mut room = Number::of(1);
    for (i, &m) in moduli.iter().enumerate() {
        room.mul_add(u32::try_from(SYMBOLS.len() - i).unwrap_or(1), 0);
        room.mul_add(m, 0);
    }
    room.shifted_down(payload_bits(length))
}

/// The symbols (places in [`SYMBOLS`]) and the digits of rows with `moduli` that hold `entropy`
/// with `free` above it. Both hold part of a backup and are wiped when dropped.
pub(crate) struct Assignment {
    pub(crate) symbols: Vec<usize>,
    pub(crate) digits: Vec<u32>,
}

impl Drop for Assignment {
    fn drop(&mut self) {
        self.symbols.zeroize();
        self.digits.zeroize();
    }
}

/// The rows' symbols and digits that hold `entropy` with `free` above it.
pub(crate) fn assign(entropy: &[u8], moduli: &[u32], free: u64) -> Assignment {
    let mut payload = SecretBytes::zeroed("an embroidery's payload", entropy.len() + CHECK_BYTES);
    payload[..entropy.len()].copy_from_slice(entropy);
    payload[entropy.len()..].copy_from_slice(&check(entropy));
    let mut n = Number::of_be_bytes(&payload);
    n.add_shifted(free, payload_bits(entropy.len()));
    let mut left: Vec<usize> = (0..SYMBOLS.len()).collect();
    let mut assignment = Assignment {
        symbols: Vec::with_capacity(moduli.len()),
        digits: Vec::with_capacity(moduli.len()),
    };
    for (i, &m) in moduli.iter().enumerate() {
        let rank = n.div_small(u32::try_from(SYMBOLS.len() - i).unwrap_or(1)) as usize;
        assignment
            .symbols
            .push(left.remove(rank.min(left.len().saturating_sub(1))));
        assignment
            .digits
            .push(if m > 1 { n.div_small(m) } else { 0 });
    }
    left.zeroize();
    assignment
}

/// What reading a legend gave.
pub enum Reading {
    /// The entropy of the phrase.
    Read(SecretBytes),
    /// The entropy of the phrase, found by taking one row as misread.
    Corrected {
        /// The entropy.
        entropy: SecretBytes,
        /// The row taken as misread, from 1.
        row: usize,
    },
    /// No phrase: the check fails and no change of one row makes it pass.
    NotRead,
    /// Changes of different rows give different phrases: the legend must be read again.
    Ambiguous,
}

impl fmt::Debug for Reading {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, "Reading")
    }
}

/// The phrase's entropy that `rows` hold, as a legend of format 1 lists them.
#[must_use]
pub fn read(rows: &[Row]) -> Reading {
    if let Some(entropy) = entropy_by_counts(rows) {
        return Reading::Read(entropy);
    }
    let mut found: Vec<(SecretBytes, usize)> = Vec::new();
    let mut note = |entropy: SecretBytes, row: usize| {
        if !found.iter().any(|(e, _)| equal_bytes(e, &entropy)) {
            found.push((entropy, row));
        }
    };
    let mut changed = rows.to_vec();
    for i in 0..rows.len() {
        let original = rows[i];
        for symbol in 1..=SYMBOLS.len() {
            if symbol != original.symbol {
                changed[i] = Row { symbol, ..original };
                if let Some(entropy) = entropy_by_counts(&changed) {
                    note(entropy, i + 1);
                }
            }
        }
        for stitches in misread_counts(original.stitches) {
            changed[i] = Row {
                stitches,
                ..original
            };
            if let Some(entropy) = entropy_by_counts(&changed) {
                note(entropy, i + 1);
            }
        }
        changed[i] = original;
        let mut counts = counts(rows);
        let as_biggest = moduli_with_biggest(&counts, i);
        if let Some(entropy) = entropy_of(rows, &as_biggest) {
            note(entropy, i + 1);
        }
        if let Some(mut base) = moduli(&counts) {
            for m in [1, 10, 100] {
                if m != base[i] {
                    let kept = base[i];
                    base[i] = m;
                    if let Some(entropy) = entropy_of(rows, &base) {
                        note(entropy, i + 1);
                    }
                    base[i] = kept;
                }
            }
        }
        counts.zeroize();
    }
    wipe_rows(&mut changed);
    match found.len() {
        0 => Reading::NotRead,
        1 => {
            let (entropy, row) = found.remove(0);
            Reading::Corrected { entropy, row }
        }
        _ => Reading::Ambiguous,
    }
}

/// The stitch counts of `rows`.
fn counts(rows: &[Row]) -> Vec<u32> {
    rows.iter().map(|r| r.stitches).collect()
}

/// The entropy `rows` hold read by the digit rule of their own counts, the working copy wiped.
fn entropy_by_counts(rows: &[Row]) -> Option<SecretBytes> {
    let mut counted = counts(rows);
    let entropy = moduli(&counted).and_then(|m| entropy_of(rows, &m));
    counted.zeroize();
    entropy
}

/// Every count a person may have meant where they wrote `stitches`: one digit changed, or two
/// neighbouring digits swapped; never with a leading zero, never outside the limits.
fn misread_counts(stitches: u32) -> Vec<u32> {
    let digits: Vec<u8> = stitches.to_string().into_bytes();
    let mut out = Vec::new();
    let mut keep = |candidate: &[u8]| {
        if candidate.len() > 1 && candidate[0] == b'0' {
            return;
        }
        if let Some(value) = std::str::from_utf8(candidate)
            .ok()
            .and_then(|t| t.parse::<u32>().ok())
            && value != stitches
            && (1..=MAX_STITCHES).contains(&value)
        {
            out.push(value);
        }
    };
    let mut changed = digits.clone();
    for place in 0..digits.len() {
        for new in b'0'..=b'9' {
            changed[place] = new;
            keep(&changed);
        }
        changed[place] = digits[place];
        if place + 1 < digits.len() {
            changed.swap(place, place + 1);
            keep(&changed);
            changed.swap(place, place + 1);
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// The entropy that `rows` read with `moduli` hold; none where no length's check passes, or where
/// two do.
fn entropy_of(rows: &[Row], moduli: &[u32]) -> Option<SecretBytes> {
    let mut left: Vec<usize> = (1..=SYMBOLS.len()).collect();
    let mut ranks = Vec::with_capacity(rows.len());
    for row in rows {
        let rank = left.iter().position(|&s| s == row.symbol)?;
        left.remove(rank);
        ranks.push(rank);
    }
    let mut n = Number::of(0);
    for i in (0..rows.len()).rev() {
        if moduli[i] > 1 {
            n.mul_add(moduli[i], rows[i].stitches % moduli[i]);
        }
        n.mul_add(
            u32::try_from(SYMBOLS.len() - i).ok()?,
            u32::try_from(ranks[i]).ok()?,
        );
    }
    ranks.zeroize();
    left.zeroize();
    let mut passing = None;
    for length in ENTROPY_LENGTHS {
        let payload = n.low_be_bytes("an embroidery's payload", payload_bits(length));
        let (entropy, sum) = payload.split_at(length);
        if equal_bytes(sum, &check(entropy)) {
            if passing.is_some() {
                return None;
            }
            passing = Some(SecretBytes::copy_of("a phrase's entropy", entropy));
        }
    }
    passing
}

/// Wipes rows that held part of a backup.
pub(crate) fn wipe_rows(rows: &mut [Row]) {
    for row in rows {
        row.symbol.zeroize();
        row.stitches.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The entropy of BIP39's 24-word test vector "void come effort ... unfold" (Trezor's
    /// vectors.json), and of its 12-word "legal winner ... yellow" (all 0x7f).
    const VOID_COME: &str = "f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f";

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect()
    }

    /// Rows of the given counts written with `entropy` and `free`.
    fn written(entropy: &[u8], counts: &[u32], free: u64) -> Vec<Row> {
        let moduli = moduli(counts).unwrap();
        let assignment = assign(entropy, &moduli, free);
        counts
            .iter()
            .zip(&assignment.symbols)
            .zip(&moduli)
            .zip(&assignment.digits)
            .map(|(((&n, &s), &m), &d)| Row {
                symbol: s + 1,
                stitches: if m > 1 { n - n % m + d } else { n },
            })
            .collect()
    }

    fn counts_for(rows: usize) -> Vec<u32> {
        (0..rows)
            .map(|i| 1500 + 137 * i as u32)
            .chain([90_000])
            .collect()
    }

    #[test]
    fn the_legend_of_the_specification_reads_as_its_published_phrase() {
        // docs/SEEDSTITCH.md, "Example": the entropy is Trezor's published 24-word test vector.
        let line = EXAMPLE;
        match read(&parse(line).unwrap()) {
            Reading::Read(entropy) => assert_eq!(&*entropy, &hex(VOID_COME)[..]),
            _ => panic!("not read"),
        }
        let mut digits_swapped = parse(line).unwrap();
        digits_swapped[0].stitches = 1752;
        assert!(matches!(
            read(&digits_swapped),
            Reading::Corrected { row: 1, .. }
        ));
    }

    #[test]
    fn a_written_legend_reads_back_as_its_entropy() {
        for entropy in [hex(VOID_COME), vec![0x7f; 16]] {
            let rows = written(&entropy, &counts_for(25), 12_345);
            match read(&rows) {
                Reading::Read(read) => assert_eq!(&*read, &entropy[..]),
                _ => panic!("not read"),
            }
        }
    }

    #[test]
    fn one_misread_row_is_corrected_and_named() {
        let entropy = hex(VOID_COME);
        let rows = written(&entropy, &counts_for(25), 7);
        let mut wrong = rows.clone();
        wrong[3].symbol = if wrong[3].symbol == 1 { 2 } else { 1 };
        let mut digit = rows.clone();
        digit[10].stitches += 1;
        for (misread, expected_row) in [(wrong, 4), (digit, 11)] {
            match read(&misread) {
                Reading::Corrected { entropy: e, row } => {
                    assert_eq!(&*e, &entropy[..]);
                    assert_eq!(row, expected_row);
                }
                _ => panic!("not corrected"),
            }
        }
    }

    #[test]
    fn two_misread_rows_are_refused_not_guessed() {
        let entropy = hex(VOID_COME);
        let mut rows = written(&entropy, &counts_for(25), 99);
        rows.swap(2, 3);
        assert!(matches!(read(&rows), Reading::NotRead));
    }

    #[test]
    fn typed_rows_are_parsed_and_wrong_ones_refused_by_place() {
        let rows = parse("12:3401, 7:85\n70:1").unwrap();
        assert_eq!((rows[0].symbol(), rows[0].stitches()), (12, 3401));
        assert_eq!(rows.len(), 3);
        assert_eq!(parse("  "), Err(LegendError::Empty));
        assert_eq!(parse("12:3401 7-85"), Err(LegendError::NotARow(2)));
        assert_eq!(parse("71:5"), Err(LegendError::UnknownSymbol(1)));
        assert_eq!(parse("3:0"), Err(LegendError::CountOutOfRange(1)));
        assert_eq!(parse("3:+5"), Err(LegendError::NotARow(1)));
    }

    #[test]
    fn a_legend_line_is_written_as_it_is_typed_back_and_told_from_codes() {
        let rows = parse("28:1725, 25:2163\n57:3275").unwrap();
        assert_eq!(line(&rows).unwrap().as_str(), "28:1725 25:2163 57:3275");
        assert!(is_line("28:1725, 25:2163;57:3275"));
        for codes in [
            "",
            " ",
            "1 2 3",
            "MNC1:seedshift:indexes:1 2 3",
            "28:1725 #ff0000",
            "28:",
            ":5",
        ] {
            assert!(!is_line(codes), "{codes:?}");
        }
    }

    #[test]
    fn the_digit_limits_and_the_biggest_row_set_what_a_count_carries() {
        assert_eq!(
            moduli(&[99, 100, 999, 1000, 5000]),
            Some(vec![1, 10, 10, 100, 1])
        );
        assert_eq!(moduli(&[5000, 5000]), None);
    }

    #[test]
    fn the_check_is_sha256_of_the_domain_the_length_and_the_entropy() {
        // SHA-256("MnemoCode embroidery 1" || 0x10 || 0x00 * 16), computed with Python's hashlib.
        assert_eq!(check(&[0; 16]), CHECK_OF_ZERO_16);
    }

    /// The first four bytes of that hash, 22bec22d, written down when the format was fixed.
    const CHECK_OF_ZERO_16: [u8; 4] = [0x22, 0xbe, 0xc2, 0x2d];
}
