//! Colours (MnemoCode TS 0.1.0's `core/colors.ts`, CAP-PHRASE-FORMATS-FORM-COLORS, -FORM-COLOR-UNICODE):
//! the word numbers of a phrase, four decimal digits each, packed six digits to a colour after a
//! two-digit order tag, written #RRGGBB (8 colours for 12 words, BIP39Colors-compatible for 12 and
//! 24 words); and Color Unicode, each colour as two code points of the Private Use Area, the
//! quotient and the remainder of its value in 0x1900.

use std::fmt;

use crate::bip39::sizes::{SizesError, WORD_COUNTS, check_word_count, check_word_indexes};
use crate::refusal::Refusal;
use crate::text::codes::{
    compact_code, complete_hex_units, hex_code_point, unspaced_code, without_separators,
};
use crate::text::words::list_in_words;

/// The hexadecimal digits of a colour #RRGGBB.
pub const RGB_HEX_DIGITS: usize = 6;
/// The largest colour, #FFFFFF.
pub const RGB_MAX_VALUE: u32 = 0xff_ffff;
/// The first code point of Color Unicode.
pub const COLOR_UNICODE_BASE: u32 = 0xe000;
/// How many code points Color Unicode uses.
pub const COLOR_UNICODE_WIDTH: u32 = 0x1900;
/// Code points for one colour.
pub const COLOR_UNICODE_POINTS_PER_COLOR: usize = 2;
/// The decimal position digits in one colour.
const PAYLOAD_DIGITS: usize = 6;
/// The digits of a word number in the colours.
const WORD_DIGITS: usize = 4;

/// The colours of a phrase of each word count: 8, 10, 12, 14 or 16.
pub fn color_count(word_count: usize) -> usize {
    word_count * WORD_DIGITS / PAYLOAD_DIGITS
}

/// The colour counts of the phrases.
pub fn color_counts() -> Vec<usize> {
    WORD_COUNTS
        .iter()
        .map(|&words| color_count(words))
        .collect()
}

/// The refusals of colours, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ColorsError {
    /// A colour not in upper-case #RRGGBB form.
    ColorCode,
    /// A colour of an export that is no RGB reference.
    InvalidReference,
    /// A count of colours that no phrase has.
    Count,
    /// Colours written with # that are not whole colours.
    Hashed,
    /// A run of digits that is not whole colours.
    Joined,
    /// Order tags not of one set.
    InvalidSet,
    /// A colour that is no word's.
    NoWord,
    /// The colours read do not place the others.
    CannotPlace,
    /// A code point outside Color Unicode.
    OutsideUnicode,
    /// A Color Unicode value above #FFFFFF.
    OutsideRange,
    /// Code points that do not pair into colours.
    Pairs,
    /// A count of Color Unicode code points that no phrase has.
    CodesAll,
    /// Indexes that are no phrase.
    Sizes(SizesError),
}

/// Why Color Unicode is refused whose codes do not pair into colours.
pub const COLOR_UNICODE_PAIRS: &str = "Color Unicode needs two four-digit codes for every color.";

impl fmt::Display for ColorsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ColorCode => f.write_str("Each color must use uppercase #RRGGBB form."),
            Self::InvalidReference => f.write_str("Invalid RGB reference."),
            Self::Count => write!(
                f,
                "Enter {} colors for a standard BIP39 word count.",
                list_in_words(&color_counts(), "or")
            ),
            Self::Hashed => {
                f.write_str("Colors must use #RRGGBB codes, separated or concatenated.")
            }
            Self::Joined => f.write_str(
                "A continuous RGB stream must contain complete six-digit RRGGBB values.",
            ),
            Self::InvalidSet => {
                f.write_str("These colors do not form a valid BIP39Colors-compatible set.")
            }
            Self::NoWord => {
                f.write_str("The color codes do not contain valid BIP39 word positions.")
            }
            Self::CannotPlace => {
                f.write_str("The colors that can be read do not tell where the others belong.")
            }
            Self::OutsideUnicode => {
                f.write_str("Color Unicode uses only MnemoCode Private Use Area code points.")
            }
            Self::OutsideRange => {
                f.write_str("Color Unicode contains a value outside the #RRGGBB range.")
            }
            Self::Pairs => f.write_str(COLOR_UNICODE_PAIRS),
            Self::CodesAll => {
                let counts: Vec<usize> = color_counts()
                    .iter()
                    .map(|count| count * COLOR_UNICODE_POINTS_PER_COLOR)
                    .collect();
                write!(
                    f,
                    "{}: {} codes in all.",
                    COLOR_UNICODE_PAIRS.trim_end_matches('.'),
                    list_in_words(&counts, "or")
                )
            }
            Self::Sizes(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ColorsError {}

impl Refusal for ColorsError {
    fn code(&self) -> &'static str {
        match self {
            Self::ColorCode => "core.colors.each-color-use-uppercase-rrggbb-form",
            Self::InvalidReference => "core.colors.invalid-rgb-reference",
            Self::Count => "core.colors.enter-colors-standard-bip39-word-count",
            Self::Hashed => "core.colors.hashed-colors-refused",
            Self::Joined => "core.colors.joined-colors-refused",
            Self::InvalidSet => "core.colors.invalid-color-set",
            Self::NoWord => "core.colors.color-codes-do-not-contain-valid-bip39-word",
            Self::CannotPlace => "core.colors.colors-can-read-do-not-tell-where-others",
            Self::OutsideUnicode => "core.colors.color-unicode-uses-only-mnemo-code-private-use",
            Self::OutsideRange => "core.colors.color-unicode-contains-value-outside-rrggbb-range",
            Self::Pairs => "core.colors.color-unicode-pairs",
            Self::CodesAll => "core.colors.codes-all",
            Self::Sizes(error) => error.code(),
        }
    }
}

/// A colour value as # and six upper-case hexadecimal digits.
pub fn rgb_hex(value: u32) -> String {
    format!("#{value:06X}")
}

/// Whether `color` is a colour in upper-case #RRGGBB form.
fn is_color_code(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
}

/// Whether `reference` is a colour as the card exports take it: six hexadecimal digits in any
/// case, with or without #.
pub fn is_rgb_reference(reference: &str) -> bool {
    let digits = reference.strip_prefix('#').unwrap_or(reference);
    digits.len() == 6 && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// The six digits of a colour reference in capitals, without #.
pub fn rgb_reference_digits(reference: &str) -> Result<String, ColorsError> {
    if !is_rgb_reference(reference) {
        return Err(ColorsError::InvalidReference);
    }
    Ok(reference.trim_start_matches('#').to_uppercase())
}

fn check_count(count: usize) -> Result<(), ColorsError> {
    if color_counts().contains(&count) {
        Ok(())
    } else {
        Err(ColorsError::Count)
    }
}

/// How far apart the order tags are: 8 colours of 12 words 0, 2, 4…, the others 0, 1, 2….
fn tag_step(colors: usize) -> u32 {
    if colors == color_count(12) { 2 } else { 1 }
}

/// The order tag and the six position digits of a colour, from its decimal value.
fn tag_and_payload(color: &str) -> Result<(u32, String), ColorsError> {
    if !is_color_code(color) {
        return Err(ColorsError::ColorCode);
    }
    let value = u32::from_str_radix(&color[1..], 16).map_err(|_| ColorsError::ColorCode)?;
    let digits = format!("{value:08}");
    let tag = digits[..2].parse::<u32>().unwrap_or(0);
    Ok((tag, digits[2..].to_owned()))
}

/// The colours of word indexes, from 0.
pub fn indexes_to_colors(indexes: &[u16]) -> Result<Vec<String>, ColorsError> {
    check_word_count(indexes.len()).map_err(ColorsError::Sizes)?;
    check_word_indexes(indexes).map_err(ColorsError::Sizes)?;
    let digits: String = indexes
        .iter()
        .map(|&index| format!("{:04}", u32::from(index) + 1))
        .collect();
    let chunks: Vec<&str> = digits
        .as_bytes()
        .chunks(PAYLOAD_DIGITS)
        .filter_map(|chunk| std::str::from_utf8(chunk).ok())
        .collect();
    let step = tag_step(chunks.len());
    Ok(chunks
        .iter()
        .zip(0_u32..)
        .map(|(chunk, position)| {
            rgb_hex(
                format!("{}{chunk}", position * step)
                    .parse::<u32>()
                    .unwrap_or(0),
            )
        })
        .collect())
}

/// The colours of a phrase written as #RRGGBB codes or six digits each, apart or together.
pub fn parse_colors(value: &str) -> Result<Vec<String>, ColorsError> {
    let hashed = value.contains('#');
    let codes = if hashed && !hashed_colors(&unspaced_code(value)) {
        None
    } else {
        complete_hex_units(value, RGB_HEX_DIGITS)
    };
    let codes = codes.ok_or(if hashed {
        ColorsError::Hashed
    } else {
        ColorsError::Joined
    })?;
    let colors: Vec<String> = codes.iter().map(|code| format!("#{code}")).collect();
    check_count(colors.len())?;
    Ok(colors)
}

/// Whether `text` is colours each with its #, nothing else.
fn hashed_colors(text: &str) -> bool {
    !text.is_empty()
        && text.split('#').skip(1).all(|part| {
            part.len() == 6
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
        })
        && text.starts_with('#')
}

/// The place of each colour among them as given, in the order of their tags.
pub fn typed_places_of_colors(colors: &[String]) -> Result<Vec<usize>, ColorsError> {
    let mut tagged = colors
        .iter()
        .enumerate()
        .map(|(place, color)| Ok((tag_and_payload(color)?.0, place)))
        .collect::<Result<Vec<_>, ColorsError>>()?;
    tagged.sort_by_key(|&(tag, _)| tag);
    Ok(tagged.into_iter().map(|(_, place)| place).collect())
}

/// The word indexes, from 0, that colours stand for, in any order.
pub fn colors_to_indexes(colors: &[String]) -> Result<Vec<u16>, ColorsError> {
    check_count(colors.len())?;
    let mut encoded = colors
        .iter()
        .map(|color| tag_and_payload(color))
        .collect::<Result<Vec<_>, _>>()?;
    encoded.sort_by_key(|(tag, _)| *tag);
    let step = tag_step(colors.len());
    if encoded
        .windows(2)
        .any(|pair| pair[1].0.checked_sub(pair[0].0) != Some(step))
    {
        return Err(ColorsError::InvalidSet);
    }
    let digits: String = encoded
        .iter()
        .map(|(_, payload)| payload.as_str())
        .collect();
    digits
        .as_bytes()
        .chunks(WORD_DIGITS)
        .map(|chunk| {
            let number = std::str::from_utf8(chunk)
                .ok()
                .and_then(|text| text.parse::<u16>().ok())
                .unwrap_or(0);
            if (1..=2048).contains(&number) {
                Ok(number - 1)
            } else {
                Err(ColorsError::NoWord)
            }
        })
        .collect()
}

/// The word positions, from 1, four digits each, that colours give where some cannot be read
/// (`None`): ? for every digit of such a colour, for each placement the order tags allow.
pub fn word_position_placements(
    colors: &[Option<String>],
) -> Result<Vec<Vec<String>>, ColorsError> {
    check_count(colors.len())?;
    let step = tag_step(colors.len());
    let mut payloads: Vec<(u32, String)> = Vec::new();
    for color in colors.iter().flatten() {
        let (tag, payload) = tag_and_payload(color)?;
        if payloads.iter().any(|(known, _)| *known == tag) {
            return Err(ColorsError::InvalidSet);
        }
        payloads.push((tag, payload));
    }
    let lowest = payloads.iter().map(|(tag, _)| *tag).min();
    let count = u32::try_from(colors.len()).unwrap_or(u32::MAX);
    let fits = |offset: u32| {
        payloads
            .iter()
            .all(|(tag, _)| (tag - offset).is_multiple_of(step) && (tag - offset) / step < count)
    };
    let offsets: Vec<u32> = (0..=lowest.unwrap_or(0))
        .filter(|&offset| offset <= lowest.unwrap_or(0) && fits(offset))
        .collect();
    if offsets.is_empty() {
        return Err(ColorsError::CannotPlace);
    }
    Ok(offsets
        .into_iter()
        .map(|offset| {
            let digits: String = (0..count)
                .map(|slot| {
                    payloads
                        .iter()
                        .find(|(tag, _)| *tag == offset + slot * step)
                        .map_or_else(
                            || "?".repeat(PAYLOAD_DIGITS),
                            |(_, payload)| payload.clone(),
                        )
                })
                .collect();
            digits
                .as_bytes()
                .chunks(WORD_DIGITS)
                .filter_map(|chunk| std::str::from_utf8(chunk).ok())
                .map(str::to_owned)
                .collect()
        })
        .collect())
}

/// Whether `point` is a code point of Color Unicode.
pub fn is_color_unicode_point(point: u32) -> bool {
    (COLOR_UNICODE_BASE..COLOR_UNICODE_BASE + COLOR_UNICODE_WIDTH).contains(&point)
}

/// Whether `character` is one character of Color Unicode.
pub fn is_color_unicode_symbol(character: char) -> bool {
    is_color_unicode_point(u32::from(character))
}

/// The #RRGGBB colour of two code points of Color Unicode.
pub fn color_of_unicode_pair(high: u32, low: u32) -> Result<String, ColorsError> {
    if !is_color_unicode_point(high) || !is_color_unicode_point(low) {
        return Err(ColorsError::OutsideUnicode);
    }
    let color = (high - COLOR_UNICODE_BASE) * COLOR_UNICODE_WIDTH + low - COLOR_UNICODE_BASE;
    if color > RGB_MAX_VALUE {
        return Err(ColorsError::OutsideRange);
    }
    Ok(rgb_hex(color))
}

/// Colours as Color Unicode: two four-digit code points each, as hexadecimal digits.
pub fn colors_to_unicode(colors: &[String]) -> Result<String, ColorsError> {
    let mut text = String::new();
    for color in colors {
        if !is_color_code(color) {
            return Err(ColorsError::ColorCode);
        }
        let value = u32::from_str_radix(&color[1..], 16).map_err(|_| ColorsError::ColorCode)?;
        text.push_str(&hex_code_point(
            COLOR_UNICODE_BASE + value / COLOR_UNICODE_WIDTH,
        ));
        text.push_str(&hex_code_point(
            COLOR_UNICODE_BASE + value % COLOR_UNICODE_WIDTH,
        ));
    }
    Ok(text)
}

/// The code points of Color Unicode text: four hexadecimal digits each, or the symbols themselves,
/// the separators of codes left out.
fn color_unicode_points(value: &str) -> Vec<u32> {
    let compact = compact_code(value);
    if !compact.is_empty()
        && compact.bytes().all(|byte| byte.is_ascii_hexdigit())
        && compact.len().is_multiple_of(4)
    {
        return compact
            .as_bytes()
            .chunks(4)
            .filter_map(|chunk| {
                std::str::from_utf8(chunk)
                    .ok()
                    .and_then(|code| u32::from_str_radix(code, 16).ok())
            })
            .collect();
    }
    without_separators(value).chars().map(u32::from).collect()
}

fn colors_from_points(points: &[u32]) -> Result<Vec<String>, ColorsError> {
    if points.is_empty() || !points.len().is_multiple_of(COLOR_UNICODE_POINTS_PER_COLOR) {
        return Err(ColorsError::Pairs);
    }
    if !points.iter().all(|&point| is_color_unicode_point(point)) {
        return Err(ColorsError::OutsideUnicode);
    }
    points
        .chunks(2)
        .map(|pair| color_of_unicode_pair(pair[0], pair[1]))
        .collect()
}

/// The colours of Color Unicode of a phrase: 8 to 16 colours, two code points each.
pub fn unicode_to_colors(value: &str) -> Result<Vec<String>, ColorsError> {
    let points = color_unicode_points(value);
    let pairs = points.len() / COLOR_UNICODE_POINTS_PER_COLOR;
    if !points.len().is_multiple_of(COLOR_UNICODE_POINTS_PER_COLOR)
        || !color_counts().contains(&pairs)
    {
        return Err(ColorsError::CodesAll);
    }
    colors_from_points(&points)
}

/// The colours of Color Unicode of any length, such as a share written as colours.
pub fn unicode_to_color_codes(value: &str) -> Result<Vec<String>, ColorsError> {
    colors_from_points(&color_unicode_points(value))
}

/// Color Unicode written as its symbols, with ? where one cannot be read: the symbols and marks,
/// the separators left out; none when the text is empty or holds anything else.
pub fn color_symbols_of(text: &str) -> Option<Vec<char>> {
    let symbols: Vec<char> = without_separators(text).chars().collect();
    (!symbols.is_empty()
        && symbols
            .iter()
            .all(|&symbol| symbol == '?' || is_color_unicode_symbol(symbol)))
    .then_some(symbols)
}

/// The symbols of [`color_symbols_of`], each as its four hexadecimal digits, or ?.
pub fn marked_color_symbols(text: &str) -> Option<Vec<String>> {
    color_symbols_of(text).map(|symbols| {
        symbols
            .into_iter()
            .map(|symbol| {
                if symbol == '?' {
                    "?".to_owned()
                } else {
                    hex_code_point(u32::from(symbol))
                }
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_pack_word_numbers_behind_order_tags() {
        let zero = vec![0_u16; 12];
        let colors = indexes_to_colors(&zero).unwrap();
        assert_eq!(colors.len(), 8);
        assert_eq!(colors[0], "#000064");
        assert_eq!(colors[1], rgb_hex(2_010_001));
        assert_eq!(colors_to_indexes(&colors).unwrap(), zero);
        let mut reversed = colors.clone();
        reversed.reverse();
        assert_eq!(colors_to_indexes(&reversed).unwrap(), zero);
        let unicode = colors_to_unicode(&colors).unwrap();
        assert_eq!(unicode_to_colors(&unicode).unwrap(), colors);
        assert_eq!(parse_colors(&colors.join(" ")).unwrap(), colors);
        assert_eq!(parse_colors("#1234"), Err(ColorsError::Hashed));
    }
}
