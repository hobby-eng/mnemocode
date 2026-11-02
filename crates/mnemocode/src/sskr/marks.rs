//! The marks of a share's unreadable elements (MnemoCode TS 0.1.0's `src/sskr/repair-models.ts`
//! and the mark counts of `repair.ts`, CAP-SSKR-MARK-SYNTAX): an element that cannot be read is a ?
//! at its place, a word number, a Unicode code, a color, a Color Unicode code, a Byteword or a pair
//! of letters of a UR; a color or a code may be read in part, a ? for each digit. Each way to read
//! a marked share as units of one form is a unit model: the values read, what a solution must fit,
//! and the structures its count of units allows.

use std::fmt;

use super::forms::{ShareFormat, byteword_units};
use super::repair::units::{
    MAX_REPAIR_UNITS, Structure, mixed_unit_counts, own_unit_count, structures_of,
};
use super::share::ur_prefix_end;
use crate::bip39::table::unicode_codes_fitting;
use crate::checksum::CRC32_BYTES;
use crate::forms::colors::{
    COLOR_UNICODE_BASE, COLOR_UNICODE_POINTS_PER_COLOR, COLOR_UNICODE_WIDTH, RGB_HEX_DIGITS,
    is_color_unicode_point, marked_color_symbols,
};
use crate::refusal::Refusal;
use crate::text::codes::{
    UNICODE_CODE_DIGITS, apart_hex_units, code_tokens, fits_pattern, hex_code_point, hex_units,
    joined_hex_units, whole_mark, with_joined_marks_hint,
};
use crate::text::space::trim;

/// The bits of one hexadecimal digit.
const HEX_DIGIT_BITS: u32 = 4;
/// The longest text of one share a repair reads, in UTF-16 code units once trimmed.
pub(crate) const MAX_REPAIR_TEXT_LENGTH: usize = 2048;
/// The most explicit choices of partly read units tried during joint refinement.
pub(crate) const MAX_PARTIAL_UNIT_CANDIDATES: usize = 64;
/// Ways to read the marks of one share's Color Unicode codes that a repair tries at most.
const MAX_MARK_WIDTH_READINGS: usize = 1 << 8;
/// Steps of the search for those ways: a bound on its work.
const MAX_MARK_WIDTH_STEPS: usize = 1 << 16;
/// The bytes of a mixed share's version and length.
const SHARE_HEADER_BYTES: usize = 2;

/// Whether `text`, a share as written, marks an element that could not be read with ?.
pub fn is_marked(text: &str) -> bool {
    text.contains('?')
}

/// Marks of Color Unicode codes that fit too many ways, none of them left out unsaid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AmbiguousMarks;

impl fmt::Display for AmbiguousMarks {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Its ? marks fit too many ways to read the Color Unicode codes, each ? a code or a whole color: read more of the codes.")
    }
}

impl std::error::Error for AmbiguousMarks {}

impl Refusal for AmbiguousMarks {
    fn code(&self) -> &'static str {
        "ambiguous-marks"
    }
}

/// Codes read in full or in part that a solution must keep.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CodeConstraints {
    /// Each color's Color Unicode codes as read, in order: a code, or ? where none could be read.
    pub(crate) pairs: Vec<Vec<String>>,
    /// Whether only the pairs of the units filled so far are checked, a code holding ? digits;
    /// otherwise every pair is, each code whole or a lone ?.
    pub(crate) prefix: bool,
}

/// Redacted: it holds what was read of an element.
impl fmt::Debug for ReadBits {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "bits read")
    }
}

/// The bits of a marked unit that were read, `mask` set where `value` holds them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ReadBits {
    /// The bits read, in their places; zero where `mask` is clear.
    pub(crate) value: u32,
    /// The bits of the unit that were read.
    pub(crate) mask: u32,
}

/// A share read as units of one form: their values, none where marked. Part of the secret.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ReadingUnits {
    /// The form, which sets the bits of one unit.
    pub(crate) format: ShareFormat,
    /// Each unit's value; none where marked.
    pub(crate) values: Vec<Option<u32>>,
    /// Codes read in full or in part.
    pub(crate) code_constraints: Option<CodeConstraints>,
    /// For each marked unit read in part, the bits read.
    pub(crate) read_bits: Option<Vec<Option<ReadBits>>>,
    /// For each partly read unit whose digits are no bits of it, the values that fit.
    pub(crate) candidates: Option<Vec<Option<Vec<u32>>>>,
    /// Whether complete decoy cards follow these units.
    pub(crate) decoys: bool,
}

impl fmt::Debug for ReadingUnits {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a share's units")
    }
}

impl ReadingUnits {
    /// Units of `format` with `values`, nothing else known.
    fn plain(format: ShareFormat, values: Vec<Option<u32>>) -> Self {
        Self {
            format,
            values,
            code_constraints: None,
            read_bits: None,
            candidates: None,
            decoys: false,
        }
    }
}

/// The units of a share in one form, with every structure their count allows.
#[derive(Debug)]
pub(crate) struct UnitModel {
    /// The units.
    pub(crate) units: ReadingUnits,
    /// Every layout the number of units allows.
    pub(crate) structures: Vec<Structure>,
}

/// `units`, or none when there are more than any repairable share has.
fn within_repair(units: Option<Vec<String>>) -> Option<Vec<String>> {
    units.filter(|units| units.len() <= MAX_REPAIR_UNITS)
}

/// Hexadecimal codes of `digits` digits as a repair reads them.
fn marked_codes(text: &str, digits: usize) -> Option<Vec<String>> {
    within_repair(hex_units(text, digits, true))
}

/// Whether reading `text` as codes of `digits` digits runs a code across a separator: such a
/// reading is in another form than the one written and takes no decoy cards (AUD-022-FUN001).
fn read_across_separators(text: &str, digits: usize) -> bool {
    apart_hex_units(text, digits).is_none()
        && code_tokens(text)
            .iter()
            .any(|token| joined_hex_units(token, digits).is_none())
}

/// Whether `code` has digits that can be read and digits that cannot.
fn read_in_part(code: &str) -> bool {
    code != "?" && code.contains('?')
}

/// The digits of `code` that can be read; each digit four bits, the first highest.
fn digit_bits(code: &str) -> ReadBits {
    code.chars()
        .fold(ReadBits { value: 0, mask: 0 }, |bits, digit| {
            let read = digit.to_digit(16);
            ReadBits {
                value: bits.value << HEX_DIGIT_BITS | read.unwrap_or(0),
                mask: bits.mask << HEX_DIGIT_BITS | if read.is_some() { 0xf } else { 0 },
            }
        })
}

/// The values of `units` in `format`, none at each marked unit; none when a unit not marked has
/// none.
fn unit_values(
    format: ShareFormat,
    units: &[String],
    marked: fn(&str) -> bool,
) -> Option<Vec<Option<u32>>> {
    units
        .iter()
        .map(|unit| {
            if marked(unit) {
                Some(None)
            } else {
                format.unit_value(unit).map(Some)
            }
        })
        .collect()
}

/// A lone ?: the only mark of a Byteword, a UR pair or a word number.
fn lone_mark(unit: &str) -> bool {
    unit == "?"
}

/// The number of units a share of `format` says it has, when the units of its checksum and header
/// lead `values` and are all read.
fn own_count_read(format: ShareFormat, values: &[Option<u32>]) -> Option<usize> {
    let mixed = format.mixed()?;
    let header_units = mixed.unit_count(CRC32_BYTES + SHARE_HEADER_BYTES);
    let header: Option<Vec<u32>> = values.get(..header_units)?.iter().copied().collect();
    own_unit_count(mixed, &header?)
}

/// Adds every supported mixed prefix of `units`, the validated units after it complete decoys; a
/// standard form, and a reading across the text's separators (`prefixes` false), keep the whole.
fn add_unit_model(models: &mut Vec<UnitModel>, units: ReadingUnits, prefixes: bool) {
    let length = units.values.len();
    if length > MAX_REPAIR_UNITS {
        return;
    }
    let Some(mixed) = units.format.mixed().filter(|_| prefixes) else {
        let structures = structures_of(units.format, length);
        models.push(UnitModel { units, structures });
        return;
    };
    let own = own_count_read(units.format, &units.values);
    for count in mixed_unit_counts(mixed) {
        if count > length || own.is_some_and(|own| own != count) {
            continue;
        }
        if own.is_none() && units.values[count..].iter().any(Option::is_none) {
            continue;
        }
        let mut prefix = units.clone();
        prefix.values.truncate(count);
        if let Some(bits) = &mut prefix.read_bits {
            bits.truncate(count);
        }
        if let Some(candidates) = &mut prefix.candidates {
            candidates.truncate(count);
        }
        prefix.decoys = count < length;
        models.push(UnitModel {
            units: prefix,
            structures: structures_of(units.format, count),
        });
    }
}

/// Adds the model of `units` in `format` when every unit that is not a lone ? has a value.
fn add_model(models: &mut Vec<UnitModel>, format: ShareFormat, units: Option<Vec<String>>) {
    if let Some(values) = units.and_then(|units| unit_values(format, &units, lone_mark)) {
        add_unit_model(models, ReadingUnits::plain(format, values), true);
    }
}

/// The pairs of letters of a UR's body, with ? for an unreadable pair; none otherwise.
fn ur_pairs(body: &str) -> Option<Vec<String>> {
    let characters: Vec<char> = body.chars().collect();
    let mut units = Vec::new();
    let mut at = 0;
    while at < characters.len() {
        if characters[at] == '?' {
            units.push("?".to_owned());
            at += 1;
        } else if characters[at..]
            .get(..2)
            .is_some_and(|pair| pair.iter().all(char::is_ascii_lowercase))
        {
            units.push(characters[at..at + 2].iter().collect());
            at += 2;
        } else {
            return None;
        }
    }
    within_repair(Some(units))
}

/// A UR after its prefix: its pairs of letters, each a lone ? where it cannot be read.
fn add_ur_model(models: &mut Vec<UnitModel>, text: &str) {
    if let Some(end) = ur_prefix_end(text) {
        add_model(
            models,
            ShareFormat::Ur,
            ur_pairs(&text[end..].to_lowercase()),
        );
    }
}

/// Unicode codes of words, apart or run together; a code read in part is unknown as a whole, and
/// the words whose code fits it are its candidates.
fn add_unicode_model(models: &mut Vec<UnitModel>, text: &str) {
    let Some(codes) = marked_codes(text, UNICODE_CODE_DIGITS) else {
        return;
    };
    let Some(values) = unit_values(ShareFormat::Unicode, &codes, is_marked) else {
        return;
    };
    let candidates: Vec<Option<Vec<u32>>> = codes
        .iter()
        .map(|code| {
            read_in_part(code).then(|| {
                unicode_codes_fitting(code)
                    .into_iter()
                    .map(u32::from)
                    .collect()
            })
        })
        .collect();
    if candidates.iter().flatten().any(Vec::is_empty) {
        return;
    }
    let mut units = ReadingUnits::plain(ShareFormat::Unicode, values);
    if candidates.iter().any(Option::is_some) {
        units.candidates = Some(candidates);
    }
    add_unit_model(
        models,
        units,
        !read_across_separators(text, UNICODE_CODE_DIGITS),
    );
}

/// Colors apart, each a lone ? or with a ? for each digit not read, whose digits read are bits; or
/// run together, a ? standing for a whole color.
fn add_color_model(models: &mut Vec<UnitModel>, text: &str) {
    let Some(colors) = marked_codes(text, RGB_HEX_DIGITS) else {
        return;
    };
    let Some(values) = unit_values(ShareFormat::Colors, &colors, is_marked) else {
        return;
    };
    let mut units = ReadingUnits::plain(ShareFormat::Colors, values);
    if colors.iter().any(|color| read_in_part(color)) {
        units.read_bits = Some(
            colors
                .iter()
                .map(|color| read_in_part(color).then(|| digit_bits(color)))
                .collect(),
        );
    }
    add_unit_model(models, units, !read_across_separators(text, RGB_HEX_DIGITS));
}

/// A Color Unicode code as read, or a run of marks.
#[derive(Clone, PartialEq, Eq)]
enum CodePiece {
    Code(String),
    Marks(usize),
}

/// Redacted: it holds an element as read.
impl fmt::Debug for CodePiece {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a code as read")
    }
}

/// `scalars` with each run of ? together as one piece.
fn code_pieces(scalars: &[String]) -> Vec<CodePiece> {
    let mut pieces: Vec<CodePiece> = Vec::new();
    for code in scalars {
        match pieces.last_mut() {
            _ if code != "?" => pieces.push(CodePiece::Code(code.clone())),
            Some(CodePiece::Marks(marks)) => *marks += 1,
            _ => pieces.push(CodePiece::Marks(1)),
        }
    }
    pieces
}

/// The numbers of codes, fewest first, that `marks` marks stand for from the code at `start`:
/// each mark one code, or a whole color, which begins at the first code of a color.
fn run_lengths(marks: usize, start: usize) -> Vec<usize> {
    let mut lengths = vec![0];
    for _ in 0..marks {
        let mut next = Vec::new();
        for &length in &lengths {
            next.push(length + 1);
            if (start + length).is_multiple_of(COLOR_UNICODE_POINTS_PER_COLOR) {
                next.push(length + COLOR_UNICODE_POINTS_PER_COLOR);
            }
        }
        next.sort_unstable();
        next.dedup();
        lengths = next;
    }
    lengths
}

/// The value of the color whose two codes are `pair` run together, if they write one.
fn color_unicode_value(pair: &[String]) -> Option<u32> {
    ShareFormat::ColorsUnicode.unit_value(&pair.concat())
}

/// Whether some color fits `pair`, each ? taken as the lowest code.
fn some_color_fits(pair: &[String]) -> bool {
    let lowest: Vec<String> = pair
        .iter()
        .map(|code| {
            if code == "?" {
                hex_code_point(COLOR_UNICODE_BASE)
            } else {
                code.clone()
            }
        })
        .collect();
    color_unicode_value(&lowest).is_some()
}

/// The fewest and the most codes the pieces from each one on stand for.
fn code_counts_from(pieces: &[CodePiece]) -> (Vec<usize>, Vec<usize>) {
    let mut fewest = vec![0; pieces.len() + 1];
    let mut most = vec![0; pieces.len() + 1];
    for piece in (0..pieces.len()).rev() {
        let marks = match pieces[piece] {
            CodePiece::Code(_) => 0,
            CodePiece::Marks(marks) => marks,
        };
        fewest[piece] = fewest[piece + 1] + if marks == 0 { 1 } else { marks };
        most[piece] = most[piece + 1]
            + if marks == 0 {
                1
            } else {
                marks * COLOR_UNICODE_POINTS_PER_COLOR
            };
    }
    (fewest, most)
}

/// Whether the codes of `scalars` from each one on are decoys: valid colors only, complete ones
/// unless the share's own length is known, when a ? may stand for a code or a whole color.
fn decoys_from_each(scalars: &[String], own_known: bool) -> Vec<bool> {
    let per = COLOR_UNICODE_POINTS_PER_COLOR;
    let mut decoys = vec![false; scalars.len() + 1];
    decoys[scalars.len()] = true;
    for at in (0..scalars.len()).rev() {
        let pair = &scalars[at..(at + per).min(scalars.len())];
        decoys[at] = (own_known && scalars[at] == "?" && decoys[at + 1])
            || (pair.len() == per
                && (own_known || !pair.iter().any(|code| code == "?"))
                && some_color_fits(pair)
                && decoys[at + per]);
    }
    decoys
}

/// One way to read Color Unicode codes with marks: the codes of each color, and whether decoys
/// follow.
type Pairing = (Vec<Vec<String>>, bool);

/// The search of [`color_unicode_pairings`].
struct Pairings<'a> {
    pieces: Vec<CodePiece>,
    own: Option<usize>,
    color_counts: Vec<usize>,
    fewest: Vec<usize>,
    most: Vec<usize>,
    decoys_from: Vec<bool>,
    scalar_at: Vec<usize>,
    last_mark: Option<usize>,
    codes: Vec<String>,
    readings: Vec<Pairing>,
    steps: usize,
    _scalars: &'a [String],
}

impl Pairings<'_> {
    /// Whether the colors the codes from `from` on touch each fit some color.
    fn colors_fit(&self, from: usize) -> bool {
        let per = COLOR_UNICODE_POINTS_PER_COLOR;
        let mut color = from / per;
        while color * per < self.codes.len() {
            let pair: Vec<String> = (0..per)
                .map(|half| {
                    self.codes
                        .get(color * per + half)
                        .cloned()
                        .unwrap_or_else(|| "?".to_owned())
                })
                .collect();
            if !some_color_fits(&pair) {
                return false;
            }
            color += 1;
        }
        true
    }

    fn read(&mut self, decoys: bool) -> Result<(), AmbiguousMarks> {
        let pairs = self
            .codes
            .chunks(COLOR_UNICODE_POINTS_PER_COLOR)
            .map(<[String]>::to_vec)
            .collect();
        self.readings.push((pairs, decoys));
        if self.readings.len() > MAX_MARK_WIDTH_READINGS {
            return Err(AmbiguousMarks);
        }
        Ok(())
    }

    /// Places `length` marks, or `code`, after the codes so far and, when the colors fit, goes on.
    fn with_placed(
        &mut self,
        placed: Vec<String>,
        then: &mut dyn FnMut(&mut Self) -> Result<(), AmbiguousMarks>,
    ) -> Result<(), AmbiguousMarks> {
        let start = self.codes.len();
        self.codes.extend(placed);
        let result = if self.colors_fit(start) {
            then(self)
        } else {
            Ok(())
        };
        self.codes.truncate(start);
        result
    }

    fn place(&mut self, piece: usize) -> Result<(), AmbiguousMarks> {
        let per = COLOR_UNICODE_POINTS_PER_COLOR;
        self.steps += 1;
        if self.steps > MAX_MARK_WIDTH_STEPS {
            return Err(AmbiguousMarks);
        }
        let required = match self.last_mark {
            Some(last) if self.own.is_none() && piece <= last => {
                self.fewest[piece] - self.fewest[last + 1]
            }
            _ => 0,
        };
        let least = self.codes.len() + required;
        let greatest = self.codes.len() + self.most[piece];
        if !self
            .color_counts
            .iter()
            .any(|&count| least <= count * per && count * per <= greatest)
        {
            return Ok(());
        }
        if self.codes.len().is_multiple_of(per)
            && self.color_counts.contains(&(self.codes.len() / per))
            && self.decoys_from[self.scalar_at[piece]]
        {
            self.read(piece < self.pieces.len())?;
            if self.own.is_some() {
                return Ok(());
            }
        }
        let Some(current) = self.pieces.get(piece).cloned() else {
            return Ok(());
        };
        let marks = match current {
            CodePiece::Code(code) => {
                return self.with_placed(vec![code], &mut |this| this.place(piece + 1));
            }
            CodePiece::Marks(marks) => marks,
        };
        for length in run_lengths(marks, self.codes.len()) {
            self.with_placed(vec!["?".to_owned(); length], &mut |this| {
                this.place(piece + 1)
            })?;
        }
        // A run of marks past the end of a share of known length: the share takes the first of
        // them, and the others are decoys.
        if let Some(own) = self.own {
            for taken in 1..marks {
                for length in run_lengths(taken, self.codes.len()) {
                    if self.codes.len() + length == own * per
                        && self.decoys_from[self.scalar_at[piece] + taken]
                    {
                        self.with_placed(vec!["?".to_owned(); length], &mut |this| {
                            this.read(true)
                        })?;
                    }
                }
            }
        }
        Ok(())
    }
}

/// The ways to read `scalars`, Color Unicode codes run together with a ? for each one that cannot
/// be read, as colors: each mark one code, or a whole color that begins at the first code of a
/// color; refused when they are more than [`MAX_MARK_WIDTH_READINGS`] or take too many steps.
fn color_unicode_pairings(scalars: &[String]) -> Result<Vec<Pairing>, AmbiguousMarks> {
    let per = COLOR_UNICODE_POINTS_PER_COLOR;
    if scalars.len() > MAX_REPAIR_UNITS * per {
        return Ok(Vec::new());
    }
    let pieces = code_pieces(scalars);
    let first_mark = scalars.iter().position(|code| code == "?");
    let leading = &scalars[..first_mark.unwrap_or(scalars.len())];
    let leading_values: Vec<Option<u32>> = leading[..leading.len() - leading.len() % per]
        .chunks(per)
        .map(color_unicode_value)
        .collect();
    let own = own_count_read(ShareFormat::ColorsUnicode, &leading_values);
    let color_counts: Vec<usize> = mixed_unit_counts(super::forms::Mixed::Colors)
        .into_iter()
        .filter(|&count| own.is_none_or(|own| own == count))
        .collect();
    let (fewest, most) = code_counts_from(&pieces);
    let mut scalar_at = vec![0];
    for piece in &pieces {
        let width = match piece {
            CodePiece::Code(_) => 1,
            CodePiece::Marks(marks) => *marks,
        };
        scalar_at.push(scalar_at[scalar_at.len() - 1] + width);
    }
    let last_mark = pieces
        .iter()
        .rposition(|piece| matches!(piece, CodePiece::Marks(_)));
    let mut search = Pairings {
        decoys_from: decoys_from_each(scalars, own.is_some()),
        pieces,
        own,
        color_counts,
        fewest,
        most,
        scalar_at,
        last_mark,
        codes: Vec::new(),
        readings: Vec::new(),
        steps: 0,
        _scalars: scalars,
    };
    search.place(0)?;
    Ok(search.readings)
}

/// Colors written as Unicode codes run together, two per color: each mark may stand for one code
/// or a whole color, and every way that fits is tried.
fn add_color_unicode_models(models: &mut Vec<UnitModel>, text: &str) -> Result<(), AmbiguousMarks> {
    let Some(scalars) = marked_color_symbols(text)
        .or_else(|| within_repair(joined_hex_units(text, UNICODE_CODE_DIGITS)))
    else {
        return Ok(());
    };
    if !scalars
        .iter()
        .all(|code| code == "?" || u32::from_str_radix(code, 16).is_ok_and(is_color_unicode_point))
    {
        return Ok(());
    }
    for (pairs, decoys) in color_unicode_pairings(&scalars)? {
        let joined: Vec<String> = pairs.iter().map(|pair| pair.concat()).collect();
        let Some(values) = unit_values(ShareFormat::ColorsUnicode, &joined, is_marked) else {
            continue;
        };
        let structures = structures_of(ShareFormat::ColorsUnicode, pairs.len());
        models.push(UnitModel {
            units: ReadingUnits {
                format: ShareFormat::ColorsUnicode,
                values,
                code_constraints: Some(CodeConstraints {
                    pairs,
                    prefix: false,
                }),
                read_bits: None,
                candidates: None,
                decoys,
            },
            structures,
        });
    }
    Ok(())
}

/// The colors whose two Color Unicode codes fit `pair`, a ? for each digit not read; none where
/// they are too many to list, which stay a symbolic constraint.
fn colors_fitting(pair: &[String]) -> Option<Vec<u32>> {
    let fitting = |code: &String| -> Vec<String> {
        (0..COLOR_UNICODE_WIDTH)
            .map(|index| hex_code_point(COLOR_UNICODE_BASE + index))
            .filter(|point| fits_pattern(code, point))
            .collect()
    };
    let high = fitting(&pair[0]);
    let low = fitting(&pair[1]);
    if !low.is_empty() && high.len() > MAX_PARTIAL_UNIT_CANDIDATES / low.len() {
        return None;
    }
    Some(
        high.iter()
            .flat_map(|first| {
                low.iter()
                    .filter_map(move |second| color_unicode_value(&[first.clone(), second.clone()]))
            })
            .collect(),
    )
}

/// Colors written as Unicode codes apart, two codes a color, with a ? for each digit not read: a
/// color with a code read in part is unknown as a whole, the small sets of colors whose codes fit
/// its candidates.
fn add_color_unicode_digit_model(models: &mut Vec<UnitModel>, text: &str) {
    let Some(codes) = within_repair(apart_hex_units(text, UNICODE_CODE_DIGITS)) else {
        return;
    };
    if !codes.iter().any(|code| read_in_part(code))
        || !codes.len().is_multiple_of(COLOR_UNICODE_POINTS_PER_COLOR)
    {
        return;
    }
    let pairs: Vec<Vec<String>> = codes
        .chunks(COLOR_UNICODE_POINTS_PER_COLOR)
        .map(<[String]>::to_vec)
        .collect();
    let mut values = Vec::new();
    let mut candidates = Vec::new();
    for pair in &pairs {
        if pair.iter().any(|code| is_marked(code)) {
            values.push(None);
            let narrow = pair.iter().any(|code| read_in_part(code))
                && !pair.iter().any(|code| whole_mark(code));
            let fitting = if narrow { colors_fitting(pair) } else { None };
            if fitting.as_ref().is_some_and(Vec::is_empty) {
                return;
            }
            candidates.push(fitting);
        } else {
            let Some(value) = color_unicode_value(pair) else {
                return;
            };
            values.push(Some(value));
            candidates.push(None);
        }
    }
    let mut units = ReadingUnits::plain(ShareFormat::ColorsUnicode, values);
    if candidates.iter().any(Option::is_some) {
        units.candidates = Some(candidates);
    }
    units.code_constraints = Some(CodeConstraints {
        pairs,
        prefix: true,
    });
    add_unit_model(models, units, true);
}

/// The forms in the order a marked share is read in them: the UR, which its prefix claims, then
/// word numbers, Bytewords, Unicode codes, colors and Color Unicode.
const MODEL_ORDER: [ShareFormat; 6] = [
    ShareFormat::Ur,
    ShareFormat::Indexes,
    ShareFormat::Words,
    ShareFormat::Unicode,
    ShareFormat::Colors,
    ShareFormat::ColorsUnicode,
];

/// Every way `text` can be read as a share in one form with marked elements, the forms in their
/// order; a UR, which its prefix claims, in that form alone.
pub(crate) fn unit_models(text: &str) -> Result<Vec<UnitModel>, AmbiguousMarks> {
    let mut models = Vec::new();
    if ur_prefix_end(text).is_some() {
        add_ur_model(&mut models, text);
        return Ok(models);
    }
    for format in &MODEL_ORDER[1..] {
        match format {
            ShareFormat::Indexes => {
                add_model(&mut models, ShareFormat::Indexes, Some(code_tokens(text)))
            }
            ShareFormat::Words => {
                add_model(&mut models, ShareFormat::Words, Some(byteword_units(text)))
            }
            ShareFormat::Unicode => add_unicode_model(&mut models, text),
            ShareFormat::Colors => add_color_model(&mut models, text),
            ShareFormat::ColorsUnicode => {
                add_color_unicode_models(&mut models, text)?;
                add_color_unicode_digit_model(&mut models, text);
            }
            ShareFormat::Ur => {}
        }
    }
    Ok(models)
}

/// A form written as codes apart, as the mark counts and problems ask it.
struct CodeForm {
    /// One code as a refusal names it.
    name: &'static str,
    /// The codes as a refusal names them.
    plural: &'static str,
    /// The symbols of a code, where a ? may stand for one of them.
    digits: Option<usize>,
    /// Whether a token is one whole code of this form.
    reads: fn(&str) -> bool,
}

/// The forms written as codes apart, in their reading order.
const CODE_FORMS: [CodeForm; 4] = [
    CodeForm {
        name: "word number",
        plural: "word numbers",
        digits: None,
        reads: |token| ShareFormat::Indexes.unit_value(token).is_some(),
    },
    CodeForm {
        name: "code",
        plural: "Unicode codes",
        digits: Some(UNICODE_CODE_DIGITS),
        reads: |token| ShareFormat::Unicode.unit_value(token).is_some(),
    },
    CodeForm {
        name: "color",
        plural: "colors",
        digits: Some(RGB_HEX_DIGITS),
        reads: |token| ShareFormat::Colors.unit_value(token).is_some(),
    },
    CodeForm {
        name: "code",
        plural: "Color Unicode codes",
        digits: Some(UNICODE_CODE_DIGITS),
        reads: |token| {
            token.len() == UNICODE_CODE_DIGITS
                && token
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
                && u32::from_str_radix(token, 16).is_ok_and(is_color_unicode_point)
        },
    },
];

/// The form of codes apart that every code of `tokens` read fits, if any.
fn code_form_of(tokens: &[String]) -> Option<&'static CodeForm> {
    let read: Vec<&String> = tokens.iter().filter(|token| !is_marked(token)).collect();
    if read.is_empty() {
        return None;
    }
    CODE_FORMS
        .iter()
        .find(|form| read.iter().all(|token| (form.reads)(token)))
}

/// The codes of `text` when it is codes written apart of a form whose codes take a ? for a digit.
fn digit_codes_apart(text: &str) -> Option<Vec<String>> {
    let digits = code_form_of(&code_tokens(text))?.digits?;
    apart_hex_units(text, digits)
}

/// The marked elements of `text`: among colors or Unicode codes apart, each code with a ?; else
/// each ?, except that a code of four or six symbols with ? among its digits is one element.
pub fn mark_count(text: &str) -> usize {
    if let Some(apart) = digit_codes_apart(text) {
        return apart.iter().filter(|code| is_marked(code)).count();
    }
    code_tokens(text)
        .iter()
        .map(|token| {
            let symbols = token.matches('?').count();
            let width = token.chars().count();
            let code = CODE_FORMS.iter().any(|form| form.digits == Some(width));
            let partly = code
                && symbols > 0
                && symbols < width
                && token
                    .chars()
                    .all(|character| character == '?' || character.is_ascii_hexdigit());
            if partly { 1 } else { symbols }
        })
        .sum()
}

/// Whether `text` is longer than a repair reads or marks more than `max_elements` elements.
pub fn exceeds_marks(text: &str, max_elements: usize) -> bool {
    let trimmed = trim(text);
    trimmed.encode_utf16().count() > MAX_REPAIR_TEXT_LENGTH || mark_count(trimmed) > max_elements
}

/// The bound of [`exceeds_marks`] as a refusal says it.
pub fn mark_limit(max_elements: usize) -> String {
    format!("mark at most {max_elements} unreadable elements with ?")
}

/// Why a code with a ? among its symbols cannot be read, in words that follow "Share 2: ", when
/// the text is codes apart of one form; it names the code by its place only.
pub fn mark_problem(text: &str) -> Option<String> {
    let tokens = code_tokens(text);
    let form = code_form_of(&tokens)?;
    for (index, token) in tokens.iter().enumerate() {
        if !is_marked(token) || whole_mark(token) {
            continue;
        }
        let name = format!("{} {}", form.name, index + 1);
        let Some(digits) = form.digits else {
            return Some(format!(
                "{name} has a ? among its digits: {} take only a lone ? for a whole {}.",
                form.plural, form.name
            ));
        };
        let symbols = token.chars().count();
        if symbols < digits {
            return Some(format!(
                "{name} has {symbols} of {digits} symbols: write a ? for each digit that cannot be read, or a lone ? for the whole {}.",
                form.name
            ));
        }
    }
    None
}

/// The refusal of marks that no share fits, with the hint for codes run together where it helps.
pub(crate) fn no_share_fits(text: &str) -> String {
    with_joined_marks_hint(
        "No valid share fits the marked elements. Check their places and the other elements.",
        text,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|&item| item.to_owned()).collect()
    }

    #[test]
    fn marks_are_counted_by_element() {
        assert_eq!(mark_count("#B5?0?? #000000"), 1);
        assert_eq!(mark_count("12 ? 7 ?"), 2);
        assert_eq!(mark_count("4E00 4E?0 ????"), 2);
        assert_eq!(mark_count("4E?0 ????"), 5);
        assert!(exceeds_marks("? ? ? ? ? ? ?", 6));
        assert_eq!(
            mark_problem("12 1? 7").as_deref(),
            Some(
                "word number 2 has a ? among its digits: word numbers take only a lone ? for a whole word number."
            )
        );
        assert_eq!(
            mark_problem("4E00 4E? 4E01").as_deref(),
            Some(
                "code 2 has 3 of 4 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole code."
            )
        );
    }

    #[test]
    fn runs_of_marks_stand_for_codes_or_colors() {
        assert_eq!(run_lengths(1, 0), vec![1, 2]);
        assert_eq!(run_lengths(1, 1), vec![1]);
        assert_eq!(run_lengths(2, 0), vec![2, 3, 4]);
        assert_eq!(
            code_pieces(&strings(&["E000", "?", "?", "E001"])),
            vec![
                CodePiece::Code("E000".into()),
                CodePiece::Marks(2),
                CodePiece::Code("E001".into())
            ]
        );
        assert_eq!(
            digit_bits("B5?0??"),
            ReadBits {
                value: 0xb5_0000,
                mask: 0xff_0f00
            }
        );
        assert_eq!(ur_pairs("ae?bc").unwrap(), strings(&["ae", "?", "bc"]));
        assert!(ur_pairs("a?").is_none());
    }
}
