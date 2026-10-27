//! The forms codes are written in (MnemoCode TS 0.1.0's `core/encoded-form.ts`,
//! CAP-PHRASE-FORMATS-FORM-*): English words (1), word numbers (2), Unicode codes (3), colours (4)
//! and Color Unicode (5). Every form is written from the word indexes alone, so that no two forms
//! of one result can disagree, and read back by its own reader, whose refusals name the place of a
//! code, never the code.

pub mod colors;
pub mod detection;
pub mod hints;

use std::fmt;

use crate::bip39::phrase::{
    PhraseError, canonical_words, unicode_indexes_of, word_index_of_number,
};
use crate::bip39::sizes::{SizesError, check_word_count, check_word_indexes};
use crate::bip39::table::{english, index_of_english, unicode_code};
use crate::refusal::Refusal;
use crate::text::codes::{UNICODE_CODE_DIGITS, code_tokens, compact_code, elements_fit, hex_units};
use crate::text::pieces::text_pieces;
use colors::{
    COLOR_UNICODE_POINTS_PER_COLOR, ColorsError, RGB_HEX_DIGITS, color_count, color_symbols_of,
    colors_to_indexes, colors_to_unicode, indexes_to_colors, is_color_unicode_symbol, parse_colors,
    typed_places_of_colors, unicode_to_colors,
};

/// A form of codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Form {
    /// English words: the phrase itself.
    English,
    /// Word numbers, from 1 through 2,048.
    Indexes,
    /// Unicode codes of the Traditional Chinese words.
    Unicode,
    /// Colours as Color Unicode.
    ColorsUnicode,
    /// Colours #RRGGBB.
    Colors,
}

/// Why codes could not be read or written in a form.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FormError {
    /// A value that names no form.
    Unsupported,
    /// Words or numbers that are no phrase.
    Phrase(PhraseError),
    /// Colours that are no phrase.
    Colors(ColorsError),
    /// Indexes that are no phrase.
    Sizes(SizesError),
    /// Joined codes that are no whole number of codes.
    Pieces(crate::text::pieces::PiecesError),
}

impl fmt::Display for FormError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => f.write_str("Unsupported encoded format."),
            Self::Phrase(error) => error.fmt(f),
            Self::Colors(error) => error.fmt(f),
            Self::Sizes(error) => error.fmt(f),
            Self::Pieces(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for FormError {}

impl Refusal for FormError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "core.encoded-form.unsupported-encoded-format",
            Self::Phrase(error) => error.code(),
            Self::Colors(error) => error.code(),
            Self::Sizes(error) => error.code(),
            Self::Pieces(error) => error.code(),
        }
    }

    fn kind(&self) -> crate::refusal::RefusalKind {
        match self {
            Self::Pieces(error) => error.kind(),
            _ => crate::refusal::RefusalKind::Error,
        }
    }
}

impl From<PhraseError> for FormError {
    fn from(error: PhraseError) -> Self {
        Self::Phrase(error)
    }
}

impl From<ColorsError> for FormError {
    fn from(error: ColorsError) -> Self {
        Self::Colors(error)
    }
}

impl From<SizesError> for FormError {
    fn from(error: SizesError) -> Self {
        Self::Sizes(error)
    }
}

/// The order in which the forms are guessed from typed text: the most telling characters first,
/// English words last, which every other text is taken for.
const LIKELY_ORDER: [Form; 5] = [
    Form::Colors,
    Form::ColorsUnicode,
    Form::Indexes,
    Form::Unicode,
    Form::English,
];

/// Refuses indexes that are no phrase.
fn phrase_indexes(indexes: &[u16]) -> Result<(), FormError> {
    check_word_count(indexes.len())?;
    check_word_indexes(indexes)?;
    Ok(())
}

impl Form {
    /// Every form, by its number 1 through 5.
    pub const ALL: [Self; 5] = [
        Self::English,
        Self::Indexes,
        Self::Unicode,
        Self::ColorsUnicode,
        Self::Colors,
    ];

    /// The record's and the command line's name of the form.
    pub const fn name(self) -> &'static str {
        match self {
            Self::English => "english",
            Self::Indexes => "indexes",
            Self::Unicode => "unicode",
            Self::ColorsUnicode => "colors-unicode",
            Self::Colors => "colors",
        }
    }

    /// The form of `name`; refused for any other value.
    pub fn named(name: &str) -> Result<Self, FormError> {
        Self::ALL
            .into_iter()
            .find(|form| form.name() == name)
            .ok_or(FormError::Unsupported)
    }

    /// The form typed text most likely is, judged by its characters.
    pub fn likely(text: &str) -> Self {
        LIKELY_ORDER
            .into_iter()
            .find(|form| form.looks(text))
            .unwrap_or(Self::English)
    }

    /// Whether typed text looks like this form, judged by its characters alone.
    fn looks(self, text: &str) -> bool {
        match self {
            Self::English => true,
            Self::Indexes => elements_fit(text, |token| {
                token.bytes().all(|byte| byte.is_ascii_digit())
            }),
            Self::Unicode => elements_fit(text, |token| {
                token
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
            }),
            Self::ColorsUnicode => text.chars().any(is_color_unicode_symbol),
            Self::Colors => text.contains('#'),
        }
    }

    /// The word indexes of `text`, codes in this form; refused as its reader refuses them.
    pub fn read(self, text: &str) -> Result<Vec<u16>, FormError> {
        let narrow = |indexes: Vec<usize>| {
            indexes
                .into_iter()
                .map(|index| u16::try_from(index).unwrap_or(u16::MAX))
                .collect()
        };
        Ok(match self {
            Self::English => {
                let words = canonical_words(text)?;
                narrow(
                    words
                        .iter()
                        .filter_map(|word| index_of_english(word))
                        .collect(),
                )
            }
            Self::Indexes => narrow(
                code_tokens(text)
                    .iter()
                    .map(|token| word_index_of_number(token))
                    .collect::<Result<_, _>>()?,
            ),
            Self::Unicode => narrow(unicode_indexes_of(text)?),
            Self::ColorsUnicode => colors_to_indexes(&unicode_to_colors(text)?)?,
            Self::Colors => colors_to_indexes(&parse_colors(text)?)?,
        })
    }

    /// The codes of `indexes` written in this form; indexes that are no phrase are refused.
    pub fn codes(self, indexes: &[u16]) -> Result<String, FormError> {
        phrase_indexes(indexes)?;
        Ok(match self {
            Self::English => indexes
                .iter()
                .map(|&index| english()[usize::from(index)])
                .collect::<Vec<_>>()
                .join(" "),
            Self::Indexes => indexes
                .iter()
                .map(|&index| (u32::from(index) + 1).to_string())
                .collect::<Vec<_>>()
                .join(" "),
            Self::Unicode => indexes
                .iter()
                .map(|&index| unicode_code(usize::from(index)))
                .collect(),
            Self::ColorsUnicode => colors_to_unicode(&indexes_to_colors(indexes)?)?,
            Self::Colors => indexes_to_colors(indexes)?.join(" "),
        })
    }

    /// What a place of a phrase is called in a message: a code where each code is a word, a word
    /// where the codes are colours.
    pub const fn place_name(self) -> &'static str {
        match self {
            Self::ColorsUnicode | Self::Colors => "Word",
            _ => "Code",
        }
    }

    /// How many elements a phrase of `words` words has in this form: one a word, or a colour.
    pub fn element_count(self, words: usize) -> usize {
        match self {
            Self::ColorsUnicode | Self::Colors => color_count(words),
            _ => words,
        }
    }

    /// The elements of a phrase of `words` words at the start of `text`, as text of this form: those
    /// of a backup printed on cards, before the decoys; text this form cannot split is given back.
    pub fn leading_codes(self, text: &str, words: usize) -> String {
        let count = self.element_count(words);
        let leading = match self {
            Self::English => Some(
                crate::bip39::phrase::english_tokens(text)
                    .into_iter()
                    .take(count)
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
            Self::Indexes => Some(
                code_tokens(text)
                    .into_iter()
                    .take(count)
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
            Self::Unicode => hex_units(text, UNICODE_CODE_DIGITS, false)
                .map(|units| units.into_iter().take(count).collect::<Vec<_>>().join(" ")),
            Self::ColorsUnicode => {
                let points = count * COLOR_UNICODE_POINTS_PER_COLOR;
                match color_symbols_of(text) {
                    Some(symbols) => Some(symbols.into_iter().take(points).collect()),
                    None => hex_units(text, UNICODE_CODE_DIGITS, false)
                        .map(|units| units.into_iter().take(points).collect::<Vec<_>>().join(" ")),
                }
            }
            Self::Colors => hex_units(text, RGB_HEX_DIGITS, false).map(|units| {
                units
                    .into_iter()
                    .take(count)
                    .map(|unit| format!("#{unit}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            }),
        };
        leading.unwrap_or_else(|| text.to_owned())
    }

    /// The codes of `indexes` one by one, as a person types them in this form.
    pub fn elements(self, indexes: &[u16]) -> Result<Vec<String>, FormError> {
        phrase_indexes(indexes)?;
        Ok(match self {
            Self::ColorsUnicode => owned(
                text_pieces(
                    &colors_to_unicode(&indexes_to_colors(indexes)?)?,
                    UNICODE_CODE_DIGITS,
                )
                .map_err(FormError::Pieces)?,
            ),
            Self::Colors => indexes_to_colors(indexes)?,
            _ => indexes.iter().map(ToString::to_string).collect(),
        })
    }

    /// For each of the `count` codes of `text`, its place among the codes as typed: colours may be
    /// typed in any order; other forms take their codes in the order typed.
    pub fn typed_places(self, text: &str, count: usize) -> Result<Vec<usize>, FormError> {
        Ok(match self {
            Self::Colors => typed_places_of_colors(&parse_colors(text)?)?,
            Self::ColorsUnicode => typed_places_of_colors(&unicode_to_colors(text)?)?
                .into_iter()
                .flat_map(|color| {
                    (0..COLOR_UNICODE_POINTS_PER_COLOR)
                        .map(move |point| color * COLOR_UNICODE_POINTS_PER_COLOR + point)
                })
                .collect(),
            _ => (0..count).collect(),
        })
    }

    /// What one code is called in a message.
    pub const fn one(self) -> &'static str {
        match self {
            Self::English => "word",
            Self::Indexes => "word number",
            _ => "code",
        }
    }

    /// What the codes are called in a message about their count.
    pub const fn unit(self) -> &'static str {
        match self {
            Self::English => "words",
            Self::Indexes => "word numbers",
            _ => "codes",
        }
    }

    /// The codes of joined text one by one, where the form writes them joined; none for a form
    /// whose codes are apart already. Joined text that is no whole number of codes is refused.
    pub fn apart_codes(self, text: &str) -> Result<Option<Vec<String>>, FormError> {
        match self {
            Self::Unicode | Self::ColorsUnicode => {
                text_pieces(&compact_code(text), UNICODE_CODE_DIGITS)
                    .map(|pieces| Some(owned(pieces)))
                    .map_err(FormError::Pieces)
            }
            _ => Ok(None),
        }
    }

    /// Whether its codes are colours, which the terminal shows as coloured cards.
    pub const fn written_in_colors(self) -> bool {
        matches!(self, Self::ColorsUnicode | Self::Colors)
    }

    /// Whether its codes are the English words of the phrase they are written from.
    pub const fn written_in_words(self) -> bool {
        matches!(self, Self::English)
    }

    /// Whether a phrase in it is always masked: words are the phrase itself, and anyone with the
    /// BIP39 list reads word numbers.
    pub const fn always_masked(self) -> bool {
        matches!(self, Self::English | Self::Indexes)
    }

    /// Whether it prints on colour cards.
    pub const fn has_cards(self) -> bool {
        !matches!(self, Self::English | Self::Indexes)
    }
}

/// `pieces` as owned strings.
fn owned(pieces: Vec<&str>) -> Vec<String> {
    pieces.into_iter().map(str::to_owned).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_form_reads_back_what_it_writes() {
        let indexes: Vec<u16> = (0..12).map(|word| word * 100).collect();
        for form in Form::ALL {
            let text = form.codes(&indexes).unwrap();
            assert_eq!(form.read(&text).unwrap(), indexes, "{}", form.name());
        }
        assert_eq!(Form::named("pdf"), Err(FormError::Unsupported));
        assert_eq!(Form::likely("#000064"), Form::Colors);
        assert_eq!(Form::likely("12 15"), Form::Indexes);
        assert_eq!(Form::likely("abandon"), Form::English);
    }
}
