//! The rules of the texts that cards print (MnemoCode TS 0.1.0's `export/card-settings.ts`,
//! CAP-CARDS-TEXT-RULES): a text of a card is on one line, without control characters, in NFC and
//! of a length that a card prints; "-" hides a line.

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::text::space::trim;
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

/// The longest text of a card, in characters as it is drawn.
pub const MAX_CARD_TEXT_LENGTH: usize = 100;
/// What hides a line of a design, which card text never is otherwise.
pub const HIDE_MARKER: &str = "-";
/// How the refusal of a blank title ends.
const BLANK_TITLE: &str = "; leave it out to print the studio name.";

/// What a text of a card refuses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextError {
    /// Not text on one line; the label and how the refusal ends.
    NotOneLine(String, String),
    /// Longer than a card prints; the label.
    TooLong(String),
}

impl fmt::Display for TextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotOneLine(label, ending) => {
                write!(f, "Card {label} must be non-empty text on one line{ending}")
            }
            Self::TooLong(label) => write!(
                f,
                "Card {label} is too long (maximum {MAX_CARD_TEXT_LENGTH} characters)."
            ),
        }
    }
}

impl std::error::Error for TextError {}

impl Refusal for TextError {
    fn code(&self) -> &'static str {
        match self {
            Self::NotOneLine(..) => "export.card-settings.card-non-empty-text-on-one-line",
            Self::TooLong(_) => "export.card-settings.card-too-long-maximum-characters",
        }
    }
}

/// A text of a card as it is drawn, in NFC and trimmed: refused unless it is text on one line
/// without control characters, and no longer than [`MAX_CARD_TEXT_LENGTH`] once drawn. The refusal
/// of a blank one says "Card `label` must be non-empty text on one line" and then `blank_ending`.
pub fn card_text(text: &str, label: &str, blank_ending: &str) -> Result<String, TextError> {
    // Measured as drawn: NFC may make a text longer or shorter, and a text settled once must pass
    // again as it is (AUD-037-API006).
    let normalized: String = text.nfc().collect();
    let drawn = trim(&normalized);
    let forbidden = |character: char| {
        matches!(
            character.general_category(),
            GeneralCategory::Control
                | GeneralCategory::Format
                | GeneralCategory::LineSeparator
                | GeneralCategory::ParagraphSeparator
        )
    };
    if drawn.is_empty() || normalized.chars().any(forbidden) {
        return Err(TextError::NotOneLine(
            label.to_owned(),
            blank_ending.to_owned(),
        ));
    }
    if drawn.chars().count() > MAX_CARD_TEXT_LENGTH {
        return Err(TextError::TooLong(label.to_owned()));
    }
    Ok(drawn.to_owned())
}

/// The title of a sheet as it is drawn in place of the studio name, where a design shows one.
pub fn card_title(title: &str) -> Result<String, TextError> {
    card_text(title, "title", BLANK_TITLE)
}
