//! The sheet for heirs on the command line (MnemoCode TS 0.1.0's `cli/heir-sheet.ts`,
//! CAP-CARDS-HEIR-SHEET-TEXT): its route through the start menu, its size, and saving it. The words
//! and the layout are the cards crate's; the route names the menu's entries, questions and answers,
//! and the one address it prints is the repository's, whose README leads to the guide for heirs.

use std::fmt;

use mnemocode::modes::Mode;
use mnemocode::refusal::Refusal;
use mnemocode_cards::heir::{
    HeirError, HeirRoute, HeirSheetFacts, HeirSheetSize, heir_sheet_text, render_heir_sheet,
};
use mnemocode_cards::pdf::document;
use mnemocode_cards::scene::UiFont;

use super::VERSION;
use super::backup_questions::{
    ENCODED_SEEDSHIFT_QUESTION, SHARE_SEEDSHIFT_QUESTION, encoded_seedshift_label,
    share_seedshift_label,
};
use super::menu_entries::{
    DECODE, PHRASE_WORDS_QUESTION, RECOVER, RESTORE, TYPED_SOURCE, phrase_words_answer, shown_entry,
};
use super::resolved;
use super::saving::{ResultName, save_output};
use crate::args::{Parsed, value};
use crate::gate::Stop;
use crate::os;
use crate::terminal::{README_URL, printable, saved};

/// A size without a sheet.
#[derive(Debug)]
struct SizeWithoutSheet;

impl fmt::Display for SizeWithoutSheet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("--heir-sheet-size needs --heir-sheet.")
    }
}

impl std::error::Error for SizeWithoutSheet {}

impl Refusal for SizeWithoutSheet {
    fn code(&self) -> &'static str {
        "cli.heir-sheet.heir-sheet-size-heir-sheet"
    }
}

/// ", then `dates`" after what is typed, or nothing when no dates are asked.
fn then_dates(dates: Option<&str>) -> String {
    dates.map_or_else(String::new, |dates| format!(", then {dates}"))
}

/// The way through MnemoCode's start menu, as a double-click opens it.
struct MenuRoute;

impl HeirRoute for MenuRoute {
    fn subtitle(&self) -> String {
        format!("Made with MnemoCode {VERSION}, free and offline.")
    }

    fn address(&self) -> String {
        README_URL.to_owned()
    }

    fn start(&self) -> Vec<String> {
        vec![
            format!(
                "On a computer you trust, open {README_URL}, download MnemoCode under \"Releases\" and check it as the guide for heirs there says."
            ),
            "Go offline, then start MnemoCode by a double-click: it shows a menu.".to_owned(),
        ]
    }

    fn decode(&self, mode: Mode, words: usize, dates: Option<&str>) -> Vec<String> {
        vec![
            format!(
                "Choose \"{}\", then \"{TYPED_SOURCE}\". To \"{PHRASE_WORDS_QUESTION}\" answer \"{}\", and to \"{ENCODED_SEEDSHIFT_QUESTION}\" answer \"{}\".",
                shown_entry(DECODE),
                phrase_words_answer(words),
                encoded_seedshift_label(mode)
            ),
            format!(
                "Type the backup{}. MnemoCode shows the seed phrase.",
                then_dates(dates)
            ),
        ]
    }

    fn restore(&self, mode: Mode, threshold: usize, dates: Option<&str>) -> Vec<String> {
        vec![
            format!(
                "Choose \"{}\". To \"{SHARE_SEEDSHIFT_QUESTION}\" answer \"{}\".",
                shown_entry(RESTORE),
                share_seedshift_label(mode)
            ),
            format!(
                "Type any {threshold} shares, separated by \"{}\"{}. MnemoCode shows the seed phrase.",
                mnemocode::sskr::typed::SHARE_SEPARATOR,
                then_dates(dates)
            ),
        ]
    }

    fn date_digit_help(&self) -> Option<String> {
        RECOVER.digit.map(|digit| {
            format!("If a digit of a date is unclear, menu entry {digit} tries every possibility.")
        })
    }
}

/// The size of the sheet; checked before any secret is asked.
fn sheet_size(parsed: &Parsed) -> Result<HeirSheetSize, HeirError> {
    HeirSheetSize::parse(value(parsed, "heir-sheet-size"))
}

/// Refuses a size without a sheet, or a size that does not exist.
pub(crate) fn validate_heir_sheet_options(parsed: &Parsed) -> Result<(), Stop> {
    if parsed.contains_key("heir-sheet-size") && !parsed.contains_key("heir-sheet") {
        return Err(SizeWithoutSheet.into());
    }
    sheet_size(parsed)?;
    Ok(())
}

/// Saves the sheet when --heir-sheet names a file, as every result is saved.
pub(crate) fn save_heir_sheet(parsed: &mut Parsed, facts: &HeirSheetFacts) -> Result<(), Stop> {
    let size = sheet_size(parsed)?;
    if !parsed.contains_key("heir-sheet") {
        return Ok(());
    }
    let font = UiFont::load();
    let name = ResultName::one("The sheet for heirs");
    let text = heir_sheet_text(&MenuRoute, facts)?;
    let pages = render_heir_sheet(&font, &text, size)?;
    let bytes = document(&font, &pages)?;
    let path = save_output(parsed, "heir-sheet", name, |path| {
        os::publish_new_file(&resolved(path), &bytes)
    })?;
    if let Some(path) = path {
        saved(&format!(
            "Saved instructions for heirs: {}",
            printable(&path)
        ));
    }
    Ok(())
}
