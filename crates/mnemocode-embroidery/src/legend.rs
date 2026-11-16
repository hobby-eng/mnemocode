//! The legend of a pattern as a backup: what each row's symbol and stitch count stand for, and how
//! they are read back with no picture. Both formats are specified in docs/SEEDSTITCH.md; MnemoCode
//! writes format 1 wherever it holds the phrase. A reading whose check fails is tried again with
//! every change of one row, and taken where exactly one entropy comes out.

mod number;
pub mod symbols;

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::secret::{
    CapacityExceeded, SecretBytes, SecretText, TextFiller, equal_bytes, redacted,
};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use mnemocode::random::{Random, RandomError};

use crate::dmc::{self, THREADS};
pub(crate) use number::Number;
pub use symbols::{Glyph, SYMBOLS, Shape, Symbol};

/// The entropy lengths of phrases of 12, 15, 18, 21 and 24 words, in bytes.
pub const ENTROPY_LENGTHS: [usize; 5] = [16, 20, 24, 28, 32];
/// The bytes of 12 to 24 word numbers of 11 bits each, packed: the original Seedshift's result,
/// whose last word is usually no phrase's checksum, kept whole.
pub const WORD_LENGTHS: [usize; 5] = [17, 21, 25, 29, 33];
/// The bytes of an SSKR share of a phrase of 12 to 24 words: 5 bytes of the set, then a value as
/// long as the phrase's entropy.
pub const SHARE_LENGTHS: [usize; 5] = [21, 25, 29, 33, 37];
/// The bytes of the check.
const CHECK_BYTES: usize = 4;
/// What a legend's phrase is, which the domain its check's hash starts with says, so that a reader
/// learns from the check alone whether to ask for dates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Masking {
    /// Masked with MnemoCode Seedshift dates: Decode asks for them.
    Seedshift,
    /// The phrase itself, for one protected some other way: anyone who knows the format reads it.
    Unmasked,
    /// Masked with the original Seedshift's dates, every word number kept: Decode asks for them.
    SeedshiftLegacy,
    /// One SSKR share of a phrase masked with MnemoCode Seedshift: restored from shares, with the
    /// dates.
    Share,
    /// One SSKR share of the phrase itself.
    ShareUnmasked,
}

impl Masking {
    /// What the check's hash starts with, in format 2 where the rows' order counts (`ordered`).
    const fn domain(self, ordered: bool) -> &'static [u8] {
        match (self, ordered) {
            (Self::Seedshift, false) => b"MnemoCode embroidery 1",
            (Self::Unmasked, false) => b"MnemoCode embroidery 1 unmasked",
            (Self::Seedshift, true) => b"MnemoCode embroidery 2",
            (Self::Unmasked, true) => b"MnemoCode embroidery 2 unmasked",
            (Self::SeedshiftLegacy, false) => b"MnemoCode embroidery 1 original",
            (Self::SeedshiftLegacy, true) => b"MnemoCode embroidery 2 original",
            (Self::Share, false) => b"MnemoCode embroidery 1 share",
            (Self::Share, true) => b"MnemoCode embroidery 2 share",
            (Self::ShareUnmasked, false) => b"MnemoCode embroidery 1 share unmasked",
            (Self::ShareUnmasked, true) => b"MnemoCode embroidery 2 share unmasked",
        }
    }

    /// The lengths in bytes of what a legend of it holds.
    #[must_use]
    pub const fn lengths(self) -> &'static [usize] {
        match self {
            Self::Seedshift | Self::Unmasked => &ENTROPY_LENGTHS,
            Self::SeedshiftLegacy => &WORD_LENGTHS,
            Self::Share | Self::ShareUnmasked => &SHARE_LENGTHS,
        }
    }

    /// Whether it is one share of a set, which restores the phrase only with others.
    #[must_use]
    pub const fn is_share(self) -> bool {
        matches!(self, Self::Share | Self::ShareUnmasked)
    }
}

/// Every masking a reader tries.
const MASKINGS: [Masking; 5] = [
    Masking::Seedshift,
    Masking::Unmasked,
    Masking::SeedshiftLegacy,
    Masking::Share,
    Masking::ShareUnmasked,
];
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
/// The format 2 legend of docs/SEEDSTITCH.md, "Examples": 30 rows that name their threads and hold
/// the public phrase "abandon … art" masked with the date 01-01-2000. The full self-test reads it.
pub const EXAMPLE_ORDERED: &str = "15:407:38 23:703:169 70:471:337 20:898:65 16:936:36 \
    52:3772:73 48:368:113 10:523:87 12:3825:16 67:742:31 41:3787:25 57:469:67 17:3371:72 59:317:49 \
    61:829:27 30:535:53 3:905:72 2:03:315 26:07:160 21:610:136 64:3021:58 58:3031:76 66:3072:433 \
    44:06:291 9:3032:163 25:642:55 63:3864:60 19:3013:93 45:310:325 29:414:105";

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
    /// Row `n` names no DMC thread.
    UnknownThread(usize),
}

impl fmt::Display for LegendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("Type the rows of the legend: each as the symbol's number, a colon and the stitches, with the DMC number between them where the legend gives it."),
            Self::TooManyRows => write!(f, "A legend has at most {MAX_ROWS} rows."),
            Self::NotARow(n) => write!(
                f,
                "Row {n} is not the symbol's number, a colon and the stitches, such as 12:3401, or with the DMC number between them, such as 12:310:3401, as every row is."
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
            Self::UnknownThread(n) => write!(f, "Row {n} names no DMC thread."),
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
            Self::UnknownThread(_) => "embroidery.legend.unknown-thread",
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
    /// The place in [`THREADS`] of the row's thread, in format 2; none in format 1.
    thread: Option<usize>,
}

impl Zeroize for Row {
    fn zeroize(&mut self) {
        self.symbol.zeroize();
        self.stitches.zeroize();
        self.thread.zeroize();
    }
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
        Ok(Self {
            symbol,
            stitches,
            thread: None,
        })
    }

    /// The row as format 2 writes it, naming its thread, the place `thread` in [`THREADS`].
    ///
    /// # Errors
    ///
    /// As [`Row::new`], and [`LegendError::UnknownThread`] for a place past [`THREADS`].
    pub fn naming(
        place: usize,
        symbol: usize,
        thread: usize,
        stitches: u32,
    ) -> Result<Self, LegendError> {
        if thread >= THREADS.len() {
            return Err(LegendError::UnknownThread(place));
        }
        Ok(Self {
            thread: Some(thread),
            ..Self::new(place, symbol, stitches)?
        })
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

    /// The thread it names, in format 2.
    #[must_use]
    pub fn thread(&self) -> Option<&'static dmc::Thread> {
        self.thread.map(|place| &THREADS[place])
    }
}

/// The words of a legend line: apart by spaces, commas, semicolons or line breaks.
fn line_words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter(|word| !word.is_empty())
}

/// Whether `text` is written as a legend line: at least one word, and every word digits, a colon and
/// digits, or with a DMC number of letters and digits and a colon between them. Codes and records
/// of MnemoCode's forms never are.
#[must_use]
pub fn is_line(text: &str) -> bool {
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    let number = |part: &str| {
        (1..=6).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_alphanumeric())
    };
    let mut words = line_words(text).peekable();
    words.peek().is_some()
        && words.all(|word| {
            let parts: Vec<&str> = word.split(':').collect();
            match parts.as_slice() {
                [symbol, stitches] => digits(symbol) && digits(stitches),
                [symbol, thread, stitches] => digits(symbol) && number(thread) && digits(stitches),
                _ => false,
            }
        })
}

/// `rows` as the line a person types back, as `28:1725 25:2163`, or in format 2 `28:310:1725`.
///
/// # Errors
///
/// [`CapacityExceeded`] where a row is longer than a legend row can be, which none is.
pub fn line(rows: &[Row]) -> Result<SecretText, CapacityExceeded> {
    // Each row at most "70:B5200:1000000 ".
    SecretText::build("a SeedStitch legend", rows.len() * 17, |filler| {
        for (place, row) in rows.iter().enumerate() {
            if place > 0 {
                filler.push(' ')?;
            }
            push_number(filler, row.symbol as u32)?;
            filler.push(':')?;
            if let Some(thread) = row.thread() {
                filler.push_str(thread.number())?;
                filler.push(':')?;
            }
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

/// The rows of `text` apart by white space, `,` or `;`: `12:3401 7:85`, in format 2 `12:310:3401`.
///
/// # Errors
///
/// [`LegendError`]: the `embroidery.legend.*` refusals.
pub fn parse(text: &str) -> Result<Vec<Row>, LegendError> {
    let tokens: Vec<&str> = line_words(text).take(MAX_ROWS + 1).collect();
    if tokens.is_empty() {
        return Err(LegendError::Empty);
    }
    if tokens.len() > MAX_ROWS {
        return Err(LegendError::TooManyRows);
    }
    let mut rows = Vec::with_capacity(tokens.len());
    let first_parts = tokens[0].split(':').count();
    for (index, token) in tokens.iter().enumerate() {
        let place = index + 1;
        let parts: Vec<&str> = token.split(':').collect();
        // Every row as the first is: with a DMC number, or every row without one.
        if parts.len() != first_parts || !(2..=3).contains(&parts.len()) {
            return Err(LegendError::NotARow(place));
        }
        let digits = |part: &str| {
            (!part.is_empty() && part.len() <= 7 && part.bytes().all(|b| b.is_ascii_digit()))
                .then(|| part.parse::<u32>().ok())
                .flatten()
        };
        let symbol = digits(parts[0]).ok_or(LegendError::NotARow(place))?;
        let stitches = digits(parts[parts.len() - 1]).ok_or(LegendError::NotARow(place))?;
        let row = if parts.len() == 3 {
            let thread = dmc::find(parts[1]).ok_or(LegendError::UnknownThread(place))?;
            Row::naming(place, symbol as usize, thread, stitches)?
        } else {
            Row::new(place, symbol as usize, stitches)?
        };
        rows.push(row);
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

/// The four bytes of the check of `entropy` with `masking`, in format 2 where `ordered`.
pub(crate) fn check(entropy: &[u8], masking: Masking, ordered: bool) -> [u8; CHECK_BYTES] {
    let mut hash = Sha256::new();
    hash.update(masking.domain(ordered));
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

/// How many symbols and digits of rows with `moduli` can be, and in format 2 (`ordered`) their
/// orders too: the room of a legend, in bits.
#[must_use]
pub fn room_bits(moduli: &[u32], ordered: bool) -> f64 {
    let symbols: f64 = (0..moduli.len())
        .map(|i| libm::log2((SYMBOLS.len() - i.min(SYMBOLS.len() - 1)) as f64))
        .sum();
    let orders: f64 = if ordered {
        (2..=moduli.len()).map(|k| libm::log2(k as f64)).sum()
    } else {
        0.0
    };
    symbols
        + orders
        + moduli
            .iter()
            .map(|&m| libm::log2(f64::from(m)))
            .sum::<f64>()
}

/// How many values the part above the payload of `length` bytes may take in rows with `moduli`;
/// zero where the rows cannot hold the payload. It is kept whole, so that every row of a long
/// legend is drawn at random: cut to 64 bits, the last rows of a 40-row legend took the first free
/// symbols and counts ending in 00 in every pattern.
pub(crate) fn free_values(length: usize, moduli: &[u32], ordered: bool) -> Number {
    if moduli.len() > SYMBOLS.len() {
        return Number::of(0);
    }
    let mut room = Number::of(1);
    for (i, &m) in moduli.iter().enumerate() {
        room.mul_add(u32::try_from(SYMBOLS.len() - i).unwrap_or(1), 0);
        room.mul_add(m, 0);
        if ordered {
            room.mul_add(u32::try_from(moduli.len() - i).unwrap_or(1), 0);
        }
    }
    room.shifted_down(payload_bits(length))
}

/// The part above the payload for the draw `attempt`, below `free`, which is not 0: 64 bits more
/// than `free` takes, drawn from `random`, with `attempt` added, divided by `free`; what is left is
/// uniform to within 2^-64. The attempt's number makes a source that gives the same bytes every
/// time still try other legends, and drawing nothing again keeps every draw to one call.
pub(crate) fn draw_free(
    random: &mut dyn Random,
    free: &Number,
    attempt: u32,
) -> Result<Number, RandomError> {
    let mut bytes = SecretBytes::zeroed("a legend's free part", free.bit_length().div_ceil(8) + 8);
    random.fill(&mut bytes)?;
    let mut drawn = Number::of_be_bytes(&bytes);
    drawn.add_shifted(&Number::of(attempt), 0);
    Ok(drawn.remainder(free))
}

/// The symbols (places in [`SYMBOLS`]) and the digits of the threads with `moduli` that hold
/// `entropy` with `free` above it, each by its thread's place, and the threads in the legend's
/// order: their own in format 1, chosen in format 2. All hold part of a backup and are wiped when
/// dropped.
pub(crate) struct Assignment {
    pub(crate) symbols: Vec<usize>,
    pub(crate) digits: Vec<u32>,
    pub(crate) order: Vec<usize>,
}

impl Drop for Assignment {
    fn drop(&mut self) {
        self.symbols.zeroize();
        self.digits.zeroize();
        self.order.zeroize();
    }
}

/// The symbols and digits of the threads with `moduli`, in their own order, that hold `entropy`
/// with `masking` and `free` above it, and in format 2 (`ordered`) the legend's order of them.
pub(crate) fn assign(
    entropy: &[u8],
    masking: Masking,
    moduli: &[u32],
    free: &Number,
    ordered: bool,
) -> Assignment {
    let mut payload = SecretBytes::zeroed("an embroidery's payload", entropy.len() + CHECK_BYTES);
    payload[..entropy.len()].copy_from_slice(entropy);
    payload[entropy.len()..].copy_from_slice(&check(entropy, masking, ordered));
    let mut n = Number::of_be_bytes(&payload);
    n.add_shifted(free, payload_bits(entropy.len()));
    let rows = moduli.len();
    let mut left: Vec<usize> = (0..SYMBOLS.len()).collect();
    let mut threads_left: Vec<usize> = (0..rows).collect();
    let mut assignment = Assignment {
        symbols: vec![0; rows],
        digits: vec![0; rows],
        order: Vec::with_capacity(rows),
    };
    for i in 0..rows {
        // The row's digits come off the number in the reverse of the order a reader puts them on:
        // its thread's place, then its symbol, then its digit.
        let thread = if ordered {
            let rank = n.div_small(u32::try_from(rows - i).unwrap_or(1)) as usize;
            threads_left.remove(rank.min(threads_left.len().saturating_sub(1)))
        } else {
            i
        };
        let rank = n.div_small(u32::try_from(SYMBOLS.len() - i).unwrap_or(1)) as usize;
        assignment.symbols[thread] = left.remove(rank.min(left.len().saturating_sub(1)));
        let m = moduli[thread];
        assignment.digits[thread] = if m > 1 { n.div_small(m) } else { 0 };
        assignment.order.push(thread);
    }
    left.zeroize();
    threads_left.zeroize();
    assignment
}

/// What reading a legend gave.
pub enum Reading {
    /// The entropy of the phrase and what the phrase is.
    Read {
        /// The entropy.
        entropy: SecretBytes,
        /// Whether the phrase is masked.
        masking: Masking,
    },
    /// The entropy of the phrase, found by taking one row as misread.
    Corrected {
        /// The entropy.
        entropy: SecretBytes,
        /// Whether the phrase is masked.
        masking: Masking,
        /// The row taken as misread, from 1; none where changes of different rows give this same
        /// phrase, so that the phrase is sure but the row is not (AUD-007-FUN004).
        row: Option<usize>,
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

/// The phrase's entropy that `rows` hold and how it is masked, as a legend of format 1 lists them
/// or, where every row names its thread, of format 2.
#[must_use]
pub fn read(rows: &[Row]) -> Reading {
    if let Some((entropy, masking)) = entropy_by_counts(rows) {
        return Reading::Read { entropy, masking };
    }
    let mut found: Vec<(SecretBytes, Masking, Option<usize>)> = Vec::new();
    let mut note = |(entropy, masking): (SecretBytes, Masking), row: usize| {
        note_explanation(&mut found, entropy, masking, row);
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
            let (entropy, masking, row) = found.remove(0);
            Reading::Corrected {
                entropy,
                masking,
                row,
            }
        }
        _ => Reading::Ambiguous,
    }
}

/// Notes that changing `row` gives `entropy` with `masking`: a phrase found once more from another row
/// keeps the phrase and loses its row, which is then no longer told for sure.
fn note_explanation(
    found: &mut Vec<(SecretBytes, Masking, Option<usize>)>,
    entropy: SecretBytes,
    masking: Masking,
    row: usize,
) {
    match found
        .iter_mut()
        .find(|(e, m, _)| *m == masking && equal_bytes(e, &entropy))
    {
        Some((_, _, known)) if *known != Some(row) => *known = None,
        Some(_) => {}
        None => found.push((entropy, masking, Some(row))),
    }
}

/// The stitch counts of `rows`.
fn counts(rows: &[Row]) -> Vec<u32> {
    rows.iter().map(|r| r.stitches).collect()
}

/// What `rows` hold read exactly as they are, and its masking, no row taken as misread: the first
/// step of [`read`], without its search.
#[must_use]
pub fn read_exactly(rows: &[Row]) -> Option<(SecretBytes, Masking)> {
    entropy_by_counts(rows)
}

/// The entropy `rows` hold read by the digit rule of their own counts, and its masking, the working
/// copy wiped.
fn entropy_by_counts(rows: &[Row]) -> Option<(SecretBytes, Masking)> {
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

/// The entropy that `rows` read with `moduli` hold, and its masking; none where no length's check
/// passes with any masking, or where two do.
fn entropy_of(rows: &[Row], moduli: &[u32]) -> Option<(SecretBytes, Masking)> {
    // Each working copy is wiped however the reading ends: a correction's search tries many
    // changed rows that stop early, such as at a symbol named twice.
    let mut left: Zeroizing<Vec<usize>> = Zeroizing::new((1..=SYMBOLS.len()).collect());
    let mut ranks = Zeroizing::new(Vec::with_capacity(rows.len()));
    for row in rows {
        let rank = left.iter().position(|&s| s == row.symbol)?;
        left.remove(rank);
        ranks.push(rank);
    }
    let ordered = rows.iter().all(|row| row.thread.is_some());
    let places = if ordered {
        thread_places(rows)?
    } else {
        Zeroizing::new(Vec::new())
    };
    let mut n = Number::of(0);
    for i in (0..rows.len()).rev() {
        if moduli[i] > 1 {
            n.mul_add(moduli[i], rows[i].stitches % moduli[i]);
        }
        n.mul_add(
            u32::try_from(SYMBOLS.len() - i).ok()?,
            u32::try_from(ranks[i]).ok()?,
        );
        if ordered {
            n.mul_add(
                u32::try_from(rows.len() - i).ok()?,
                u32::try_from(places[i]).ok()?,
            );
        }
    }
    drop((ranks, places, left));
    let mut passing = None;
    for masking in MASKINGS {
        for &length in masking.lengths() {
            let payload = n.low_be_bytes("an embroidery's payload", payload_bits(length));
            let (held, sum) = payload.split_at(length);
            if equal_bytes(sum, &check(held, masking, ordered)) {
                if passing.is_some() {
                    return None;
                }
                passing = Some((SecretBytes::copy_of("what a legend holds", held), masking));
            }
        }
    }
    passing
}

/// The place of each row's thread, counted from 0, in the threads' own order
/// ([`dmc::Thread::order`]) among the threads that no row above it named; none where two rows name
/// one thread.
fn thread_places(rows: &[Row]) -> Option<Zeroizing<Vec<usize>>> {
    let mut sorted: Zeroizing<Vec<usize>> =
        Zeroizing::new(rows.iter().filter_map(|row| row.thread).collect());
    sorted.sort_by_key(|&place| THREADS[place].order());
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return None;
    }
    let mut places = Zeroizing::new(Vec::with_capacity(rows.len()));
    for row in rows {
        let place = sorted.iter().position(|&t| Some(t) == row.thread)?;
        sorted.remove(place);
        places.push(place);
    }
    Some(places)
}

/// Wipes rows that held part of a backup.
pub(crate) fn wipe_rows(rows: &mut [Row]) {
    rows.iter_mut().for_each(Zeroize::zeroize);
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

    /// Rows of the given counts written with `entropy` and `free`, masked with Seedshift, in
    /// format 1.
    fn written(entropy: &[u8], counts: &[u32], free: u64) -> Vec<Row> {
        written_as(entropy, Masking::Seedshift, counts, (free, false))
    }

    /// Rows of threads with the given counts, the first threads in their own order, written with
    /// `entropy`, `masking` and `free`, in format 2 where `ordered`, in the legend's order.
    fn written_as(
        entropy: &[u8],
        masking: Masking,
        counts: &[u32],
        (free, ordered): (u64, bool),
    ) -> Vec<Row> {
        let moduli = moduli(counts).unwrap();
        let free = Number::of_be_bytes(&free.to_be_bytes());
        let assignment = assign(entropy, masking, &moduli, &free, ordered);
        let mut threads: Vec<usize> = (0..THREADS.len()).collect();
        threads.sort_by_key(|&t| THREADS[t].order());
        assignment
            .order
            .iter()
            .map(|&t| {
                let (n, m) = (counts[t], moduli[t]);
                Row {
                    symbol: assignment.symbols[t] + 1,
                    stitches: if m > 1 {
                        n - n % m + assignment.digits[t]
                    } else {
                        n
                    },
                    thread: ordered.then_some(threads[t]),
                }
            })
            .collect()
    }

    /// A source of bytes that look random and repeat from run to run.
    struct Xorshift(u64);

    impl Random for Xorshift {
        fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
            for byte in bytes {
                self.0 ^= self.0 << 13;
                self.0 ^= self.0 >> 7;
                self.0 ^= self.0 << 17;
                *byte = self.0 as u8;
            }
            Ok(())
        }
    }

    // AUD-007-FUN004: the same phrase from changes of two rows keeps the phrase and loses the row.
    #[test]
    fn a_phrase_explained_by_two_rows_names_no_row() {
        let bytes = |b: u8| SecretBytes::copy_of("a test entropy", &[b; 16]);
        let mut found = Vec::new();
        note_explanation(&mut found, bytes(7), Masking::Unmasked, 2);
        note_explanation(&mut found, bytes(7), Masking::Unmasked, 2);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].2, Some(2));
        note_explanation(&mut found, bytes(7), Masking::Unmasked, 5);
        assert_eq!((found.len(), found[0].2), (1, None));
        note_explanation(&mut found, bytes(8), Masking::Unmasked, 5);
        assert_eq!(found.len(), 2, "another phrase is another explanation");
    }

    #[test]
    fn every_row_of_a_long_legend_is_drawn_at_random() {
        // The 40 threads of a pattern of a photograph: 30 rows of 1000 stitches or more, 9 of 100
        // or more and the biggest, which holds a 12-word phrase with some 300 bits to spare.
        let mut moduli = vec![100; 30];
        moduli.extend([10; 9]);
        moduli.push(1);
        let free = free_values(16, &moduli, false);
        assert!(free.bit_length() > 64);
        let mut random = Xorshift(0x9e37_79b9_7f4a_7c15);
        let mut last_rows = std::collections::HashSet::new();
        for _ in 0..20 {
            let drawn = draw_free(&mut random, &free, 0).unwrap();
            assert!(drawn.is_below(&free));
            let assignment = assign(&[7; 16], Masking::Seedshift, &moduli, &drawn, false);
            last_rows.insert((assignment.symbols[38], assignment.digits[38]));
        }
        // Cut to 64 bits, the free part left this row the first free symbol and the digit 0 in
        // every legend.
        assert!(last_rows.len() > 10, "{last_rows:?}");
    }

    /// Asserts that `rows` read as `entropy` with `masking`, unchanged.
    #[track_caller]
    fn assert_reads(rows: &[Row], entropy: &[u8], masking: Masking) {
        match read(rows) {
            Reading::Read {
                entropy: read,
                masking: as_read,
            } => {
                assert_eq!(&*read, entropy);
                assert_eq!(as_read, masking);
            }
            other => panic!("{masking:?} of {} bytes not read: {other:?}", entropy.len()),
        }
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
            Reading::Read { entropy, masking } => {
                assert_eq!(&*entropy, &hex(VOID_COME)[..]);
                assert_eq!(masking, Masking::Seedshift);
            }
            _ => panic!("not read"),
        }
        let mut digits_swapped = parse(line).unwrap();
        digits_swapped[0].stitches = 1752;
        assert!(matches!(
            read(&digits_swapped),
            Reading::Corrected { row: Some(1), .. }
        ));
    }

    // No domain, its length byte and what it holds is another domain's: a domain ends where the
    // byte of a length begins. The length 32 is a space, which every longer domain has next.
    #[test]
    fn no_domain_and_length_read_as_another_one() {
        for ordered in [false, true] {
            for short in MASKINGS {
                for &length in short.lengths() {
                    for long in MASKINGS {
                        let (short_domain, long_domain) =
                            (short.domain(ordered), long.domain(ordered));
                        let Some(rest) = long_domain.strip_prefix(short_domain) else {
                            continue;
                        };
                        if rest.first().copied() != u8::try_from(length).ok() {
                            continue;
                        }
                        // What follows the longer domain is its own length byte, then what it holds.
                        let held = length - (rest.len() - 1) - 1;
                        assert!(
                            !long.lengths().contains(&held),
                            "{short:?} of {length} bytes reads as {long:?} of {held}"
                        );
                    }
                }
            }
        }
    }

    /// Entropies of the shortest and the longest length that `masking` takes.
    fn entropies_of(masking: Masking) -> [Vec<u8>; 2] {
        let lengths = masking.lengths();
        let longest = lengths[lengths.len() - 1];
        let published = hex(VOID_COME).into_iter().cycle().take(longest).collect();
        [published, vec![0x7f; lengths[0]]]
    }

    #[test]
    fn a_written_legend_reads_back_as_its_entropy() {
        for masking in MASKINGS {
            for entropy in entropies_of(masking) {
                // Rows enough for the longest share, of 24 words.
                let rows = written_as(&entropy, masking, &counts_for(32), (12_345, false));
                assert_reads(&rows, &entropy, masking);
            }
        }
    }

    #[test]
    fn a_legend_in_its_rows_order_reads_back_and_never_as_format_1() {
        for masking in MASKINGS {
            for entropy in entropies_of(masking) {
                let rows = written_as(&entropy, masking, &counts_for(26), (54_321, true));
                assert_reads(&rows, &entropy, masking);
                // Without its threads the order is lost, and format 1 does not read the rows.
                let plain: Vec<Row> = rows.iter().map(|r| Row { thread: None, ..*r }).collect();
                assert!(!matches!(read(&plain), Reading::Read { .. }));
            }
        }
        // One row read wrong is found in format 2 too.
        let entropy = hex(VOID_COME);
        let mut rows = written_as(&entropy, Masking::Seedshift, &counts_for(20), (3, true));
        // A row other than the biggest, whose digits carry part of the number.
        let most = rows.iter().map(|r| r.stitches).max().unwrap();
        let wrong = rows.iter().position(|r| r.stitches != most).unwrap();
        let n = rows[wrong].stitches;
        rows[wrong].stitches = n - n % 10 + (n % 10 + 1) % 10;
        assert!(matches!(
            read(&rows),
            Reading::Corrected { row, .. } if row == Some(wrong + 1)
        ));
    }

    #[test]
    fn the_format_2_example_of_the_specification_reads_as_a_masked_phrase() {
        // The masked words 2001 2 2 … 2001 2 322, as the manual recovery guide's own helper reads
        // the line, in Python.
        let words = [[2001, 2, 2]; 8].concat();
        let mut bits: Vec<bool> = Vec::new();
        for (place, word) in words.iter().enumerate() {
            let number: u32 = if place == 23 { 322 } else { *word };
            bits.extend((0..11).rev().map(|bit| (number - 1) >> bit & 1 == 1));
        }
        let expected: Vec<u8> = bits[..256]
            .chunks(8)
            .map(|byte| {
                byte.iter()
                    .fold(0, |value, &bit| value << 1 | u8::from(bit))
            })
            .collect();
        assert_reads(
            &parse(EXAMPLE_ORDERED).unwrap(),
            &expected,
            Masking::Seedshift,
        );
    }

    // AUD-007-DOC001: format 2 sees only a thread's place in DMC's order, so a misread number that
    // keeps that place goes unnoticed and one that moves it does not.
    #[test]
    fn a_misread_thread_is_noticed_only_where_its_place_moves() {
        let as_written = parse(EXAMPLE_ORDERED).unwrap();
        let Reading::Read { entropy, .. } = read(&as_written) else {
            panic!("the example reads");
        };
        // 400 falls between 368 and 414, as 407 does: the same place, the same phrase.
        let kept = parse(&EXAMPLE_ORDERED.replacen("15:407:", "15:400:", 1)).unwrap();
        assert!(matches!(read(&kept), Reading::Read { entropy: e, .. } if *e == *entropy));
        // 3865 comes after every thread of the line: another place, and the check fails.
        let moved = parse(&EXAMPLE_ORDERED.replacen("15:407:", "15:3865:", 1)).unwrap();
        assert!(matches!(read(&moved), Reading::NotRead));
    }

    #[test]
    fn a_line_names_its_threads_in_format_2_and_every_row_alike() {
        let rows = parse("12:310:3401 7:06:85, 3:blanc:1").unwrap();
        assert_eq!(rows[1].thread().unwrap().number(), "06");
        assert_eq!(rows[2].thread().unwrap().number(), "Blanc");
        assert_eq!(
            line(&rows).unwrap().as_str(),
            "12:310:3401 7:06:85 3:Blanc:1"
        );
        assert!(is_line("12:310:3401 7:B5200:85"));
        assert_eq!(parse("12:310:3401 7:85"), Err(LegendError::NotARow(2)));
        assert_eq!(parse("12:9999:3401"), Err(LegendError::UnknownThread(1)));
        assert_eq!(dmc::find("6"), dmc::find("06"));
    }

    #[test]
    fn one_misread_row_is_corrected_and_named() {
        let entropy = hex(VOID_COME);
        let rows = written_as(&entropy, Masking::Unmasked, &counts_for(25), (7, false));
        let mut wrong = rows.clone();
        wrong[3].symbol = if wrong[3].symbol == 1 { 2 } else { 1 };
        let mut digit = rows.clone();
        digit[10].stitches += 1;
        for (misread, expected_row) in [(wrong, 4), (digit, 11)] {
            match read(&misread) {
                Reading::Corrected {
                    entropy: e,
                    masking,
                    row,
                } => {
                    assert_eq!(&*e, &entropy[..]);
                    assert_eq!(masking, Masking::Unmasked);
                    assert_eq!(row, Some(expected_row));
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
        // SHA-256("MnemoCode embroidery 1" || 0x10 || 0x00 * 16), and of the domain
        // "MnemoCode embroidery 1 unmasked", computed with Python's hashlib.
        assert_eq!(check(&[0; 16], Masking::Seedshift, false), CHECK_OF_ZERO_16);
        assert_eq!(
            check(&[0; 16], Masking::Unmasked, false),
            UNMASKED_CHECK_OF_ZERO_16
        );
    }

    /// The first four bytes of those hashes, 22bec22d and 4b0a75ea, written down when the format
    /// was fixed.
    const CHECK_OF_ZERO_16: [u8; 4] = [0x22, 0xbe, 0xc2, 0x2d];
    const UNMASKED_CHECK_OF_ZERO_16: [u8; 4] = [0x4b, 0x0a, 0x75, 0xea];
    #[test]
    #[ignore = "Twelve public legend/contact QR capacity cases; run for hidden-QR acceptance."]
    #[expect(
        clippy::print_stderr,
        reason = "the requested capacity measurement reports only public fixture sizes and QR dimensions"
    )]
    fn full_legends_and_card_contacts_fit_and_recover_both_qr_layers() {
        use mnemocode::qr;
        use mnemocode_cards::settings::{CardProfile, ProfileField};
        let mut contact = CardProfile::default();
        for (field, value) in [
            (ProfileField::Name, "Alex Morgan"),
            (ProfileField::Company, "Public Studio"),
            (ProfileField::Role, "Designer"),
            (ProfileField::Email, "alex@example.com"),
            (ProfileField::Phone, "+1 202 555 0148"),
        ] {
            contact.set(field, value.to_owned());
        }
        let mut long = CardProfile::default();
        for field in [
            ProfileField::Name,
            ProfileField::Company,
            ProfileField::Role,
            ProfileField::Email,
            ProfileField::Phone,
        ] {
            long.set(
                field,
                "A".repeat(mnemocode_cards::text_rules::MAX_CARD_TEXT_LENGTH),
            );
        }
        let contacts = [
            contact.validated().unwrap().qr_contact(),
            long.validated().unwrap().qr_contact(),
        ];
        let entropy = hex(VOID_COME);
        // Public fixture sizes, independent of the writer's search configuration.
        for count in [40, 60, MAX_ROWS] {
            for ordered in [false, true] {
                let rows = written_as(
                    &entropy,
                    Masking::Seedshift,
                    &counts_for(count - 1),
                    (42, ordered),
                );
                assert_eq!(rows.len(), count);
                assert_reads(&rows, &entropy, Masking::Seedshift);
                let text = line(&rows).unwrap();
                for visible in &contacts {
                    let code = qr::hidden::matrix(visible, text.as_str()).unwrap();
                    let png = qr::hidden::png(visible, text.as_str()).unwrap();
                    assert_eq!(qr::read_png(&png).unwrap().as_str(), visible);
                    let recovered = qr::hidden::read_png(&png).unwrap();
                    assert_eq!(recovered.as_str(), text.as_str());
                    let parsed = parse(recovered.as_str()).unwrap();
                    assert_eq!(parsed, rows);
                    assert_reads(&parsed, &entropy, Masking::Seedshift);
                    eprintln!(
                        "public_legend rows={count} ordered={ordered} contact_bytes={} legend_bytes={} qr_modules={}",
                        visible.len(),
                        text.len(),
                        code.size()
                    );
                }
            }
        }
        // A QR cannot promise room for arbitrary amounts of visible text.
        assert!(matches!(
            qr::hidden::matrix(&"A".repeat(2400), EXAMPLE),
            Err(qr::QrError::TooLarge)
        ));
    }
}
