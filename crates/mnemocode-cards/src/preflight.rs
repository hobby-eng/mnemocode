//! Whether the cards that a host was asked for can be printed (MnemoCode TS 0.1.0's
//! `cli/cards-fit.ts` and `CardPreview.assertColorsPrint`, CAP-CARDS-PRINTABILITY-PREFLIGHT): the
//! cards drawn in memory with a sample phrase of the longest length, before a secret is asked, so
//! that a detail too long for its card is refused then, not after the result is shown.

use mnemocode::forms::Form;
use mnemocode::random::Random;

use crate::export::{CardPreview, CardPreviewOptions, ExportError, LONGEST_SAMPLE_WORDS};
use crate::settings::CardSettings;
use crate::templates::CardDrawing;

/// What cards a host saves.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CardOutputs {
    /// Sheets of cards, in a PDF or as page images.
    pub sheets: bool,
    /// Separate cards, one file for each card.
    pub cards: bool,
}

/// What colour cards are checked with.
#[derive(Clone, Copy, Debug)]
pub struct ColorCardsCheck<'a> {
    /// The design, by its id or number.
    pub template: Option<&'a str>,
    /// The settings of the cards.
    pub settings: &'a CardSettings,
    /// The title of the sheet.
    pub title: Option<&'a str>,
    /// The form of the codes.
    pub form: Form,
    /// What is saved.
    pub outputs: CardOutputs,
}

/// Refuses colour cards that cannot be printed with `check`, drawing them with a sample phrase of
/// the longest length. Nothing is kept.
pub fn check_color_cards_fit(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    check: &ColorCardsCheck<'_>,
) -> Result<(), ExportError> {
    let preview = CardPreview::new(
        random,
        CardPreviewOptions {
            words: Some(LONGEST_SAMPLE_WORDS),
            settings: check.settings.clone(),
            title: check.title.map(str::to_owned),
            color_form: Some(check.form),
        },
    )?;
    let CardOutputs { sheets, cards } = check.outputs;
    preview.check_colors_print(drawing, random, check.template, (sheets, cards))
}
