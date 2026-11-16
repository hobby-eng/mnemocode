//! `mnemocode stitch` (docs/SEEDSTITCH.md, ADR 0010): the phrase, masked with Seedshift unless
//! --mode direct, hidden in the legend of a cross-stitch pattern saved as a PDF. The picture is
//! read before the phrase is asked. Legends that Decode reads are turned back into records here.

use std::fmt;
use std::path::Path;

use mnemocode::backup::Backup;
use mnemocode::forms::Form;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode_embroidery::fabric::{self, DEFAULT_FABRIC, Fabric};
use mnemocode_embroidery::hide::{HideError, hide};
use mnemocode_embroidery::picture::{self, DEFAULT_WIDTH, Grid, MAX_FILE_BYTES, WIDTHS};
use mnemocode_embroidery::{chart, legend, phrase};

use super::asking::{AfterFailure, after_failure, value_until};
use super::configure::asked_options;
use super::encode::{
    legacy_sentences, masked_words_requested, original_copy_requested, print_masked_words,
    print_original_copy, write_qr,
};
use super::encode_questions::file_questions;
use super::given::{PATH_LIMIT, check_date_input, given_mode, phrase_and_dates};
use super::heir_sheet::{save_heir_sheet, validate_heir_sheet_options};
use super::output_questions::input_file;
use super::pattern_questions::ask_size;
use super::resolved;
use super::saving::{ResultName, save_output};
use super::share_output::report_qr_verified;
use crate::args::{Parsed, integer_option, is_on, value};
use crate::gate::Stop;
use crate::input::read_picture;
use crate::os::{self, SystemRandom};
use crate::output::{report_renamed, shown_path};
use crate::terminal::result::{print, print_sentence, result_header};
use crate::terminal::{
    self, Choice, NoticeKind, TEXT_WIDTH, clear_private_screen, lasting_warning, more_line, notice,
    saved, wrap_text,
};
use mnemocode_cards::heir::{HeirBackup, HeirSheetFacts};

/// The options `stitch` takes: those of every new backup, then the pattern's own.
pub(crate) const OPTIONS: [&str; 18] = [
    "mode",
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "date",
    "dates-file",
    "output",
    "qr",
    "qr-hidden",
    "qr-text",
    "show-original",
    "show-masked-words",
    "heir-sheet",
    "heir-sheet-size",
    "picture",
    "stitches-across",
    "fabric",
    "pdf",
];

/// The refusals of SeedStitch in the command line.
#[derive(Debug)]
enum StitchError {
    /// --picture is missing.
    NoPicture,
    /// --pdf is missing.
    NoPdf,
}

impl fmt::Display for StitchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoPicture => f.write_str("Name the picture of the pattern with --picture PATH."),
            Self::NoPdf => f.write_str("Name the PDF of the pattern with --pdf PATH."),
        }
    }
}

impl std::error::Error for StitchError {}

impl Refusal for StitchError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoPicture => "cli.stitch.no-picture",
            Self::NoPdf => "cli.stitch.no-pdf",
        }
    }
}

/// What the person chose when the picture cannot be used.
#[derive(Clone, Copy)]
enum Next {
    Picture,
    Width,
    Stop,
}

/// The picture of the pattern and its stitches across, as the options give them and as the person
/// changes them where the picture cannot be used.
struct Source {
    path: String,
    width: usize,
    /// The fabric the sizes offered again are worked out for.
    fabric: Fabric,
    /// Whether the person is at the terminal to choose another picture or width.
    asking: bool,
}

impl Source {
    /// The picture's stitches, refused as the library refuses the picture.
    fn grid(&self) -> Result<Grid, Stop> {
        let file = read_picture(Path::new(&self.path))?;
        Ok(picture::grid(&file, self.width)?)
    }

    /// The stitches of a picture that can be used: of the one given, or, at the terminal, of one
    /// the person chooses after it cannot be used.
    fn usable_grid(&mut self) -> Result<Grid, Stop> {
        loop {
            match self.grid() {
                Ok(grid) => return Ok(grid),
                Err(refused @ Stop::Refused(_)) if self.asking => {
                    if !self.change(&refused.message())? {
                        return Err(refused);
                    }
                }
                Err(stop) => return Err(stop),
            }
        }
    }

    /// Asks after `failure` for another picture or another size, offered as the menu offers it
    /// first; false where the person stops. Another size is not offered for a picture that no size
    /// can make a pattern of.
    fn change(&mut self, failure: &str) -> Result<bool, Stop> {
        // The picture's size and the widths it allows; none where it is no picture that a size helps.
        let sized = read_picture(Path::new(&self.path))
            .ok()
            .and_then(|file| picture::upright_size(&file).ok())
            .and_then(|size| Some((size, fabric::widths(size).ok()?)));
        let now = format!("now {} stitches across", self.width);
        let mut choices = vec![Choice::noted(
            "Another picture",
            "a photograph with smooth shades works best",
            Next::Picture,
        )];
        if sized.is_some() {
            choices.push(Choice::noted("Another size", &now, Next::Width));
        }
        choices.push(Choice::new("Stop", Next::Stop));
        loop {
            match after_failure(failure, &choices, AfterFailure::default())? {
                Next::Stop => return Ok(false),
                Next::Picture => {
                    let typed = value_until(
                        file_questions::PICTURE,
                        "the name of a PNG, JPEG or WebP file",
                        PATH_LIMIT,
                        None,
                        |answer| input_file(answer, MAX_FILE_BYTES),
                    )?;
                    if let Some(path) = typed {
                        self.path = path;
                        return Ok(true);
                    }
                }
                Next::Width => {
                    let Some((size, widths)) = sized else {
                        continue;
                    };
                    if let Some(width) = ask_size(size, widths, self.fabric)? {
                        self.width = width;
                        return Ok(true);
                    }
                }
            }
        }
    }
}

/// Runs the command: every option checked and the picture read before the phrase is asked or read,
/// `cli.stitch.no-picture` and `cli.stitch.no-pdf` among them.
pub(crate) fn run(parsed: &Parsed, protection: &mut crate::os::Protection) -> Result<(), Stop> {
    let (fresh, dates) = asked_options(parsed, protection, super::pattern_questions::ask_pattern)?;
    run_with_dates(&fresh, dates.as_deref())
}

fn run_with_dates(parsed: &Parsed, dates: Option<&[mnemocode::dates::Date]>) -> Result<(), Stop> {
    let path = value(parsed, "picture").ok_or(StitchError::NoPicture)?;
    if value(parsed, "pdf").is_none() {
        return Err(StitchError::NoPdf.into());
    }
    let width = integer_option(
        parsed,
        "stitches-across",
        WIDTHS,
        Some(DEFAULT_WIDTH as u64),
        None,
    )? as usize;
    let fabric = match value(parsed, "fabric") {
        None => DEFAULT_FABRIC,
        Some(text) => Fabric::named(text)?,
    };
    // Masked unless the person says otherwise, as before --mode was there.
    let mode = phrase::legend_mode(given_mode(parsed)?.unwrap_or(Mode::Seedshift))?;
    check_date_input(parsed, mode, DateWords::Codes)?;
    // What every new backup may ask for, checked before a secret is read, as Encode checks it.
    super::hidden_qr::validate(parsed)?;
    let original_copy = original_copy_requested(parsed)?;
    let masked_words = masked_words_requested(parsed, mode)?;
    validate_heir_sheet_options(parsed)?;
    // The original Seedshift's last word is replaced in a legend, and no sheet leads through that.
    let legacy = mode == Mode::SeedshiftLegacy;
    if parsed.contains_key("heir-sheet") {
        mode.with_valid_last_word()
            .unwrap_or(mode)
            .check_heir_sheet()?;
    }
    let mut source = Source {
        path: path.to_owned(),
        width,
        fabric,
        asking: is_on(parsed, "ask-secrets"),
    };
    let mut grid = source.usable_grid()?;
    let (phrase, dates) = match phrase_and_dates(parsed, mode, DateWords::Codes, None, dates)? {
        Ok(given) => given,
        Err(_) => return Err(Stop::Cancelled),
    };
    let entropy = phrase::legend_entropy(&phrase, mode, &dates)?;
    let hidden = loop {
        terminal::work("Making the pattern…");
        match hide(&grid, &entropy, &mut SystemRandom) {
            Ok(hidden) => break hidden,
            Err(error @ (HideError::TooFewColours | HideError::NoLegend)) if source.asking => {
                if !source.change(&error.to_string())? {
                    return Err(error.into());
                }
                grid = source.usable_grid()?;
            }
            Err(error) => return Err(error.into()),
        }
    };
    let pdf = chart::chart(&hidden, fabric)?;
    // The result is a step of its own: the questions are cleared away (CORE-39).
    clear_private_screen();
    let line = legend::line(hidden.rows())?;
    let channel = terminal::secret_channel();
    let facts = [
        ("Rows", hidden.rows().len().to_string()),
        (
            "Pattern",
            format!(
                "{} by {} stitches, {} moved to set the counts",
                hidden.pattern().width(),
                hidden.pattern().height(),
                hidden.moved()
            ),
        ),
        (
            "Looks like the picture",
            format!(
                "{:.1} apart, seen from a little distance",
                hidden.pattern().seen_difference(&grid)
            ),
        ),
    ];
    result_header("SeedStitch legend", &facts, channel);
    let heading = "Legend line: keep it, in this exact order, or the PDF that holds it";
    print(
        channel,
        &[terminal::paint(channel, terminal::style::STRONG, heading)],
    );
    print(channel, &wrap_text(line.as_str(), TEXT_WIDTH));
    // Format 2, whose rows' order holds part of the phrase, names each row's thread.
    let named = hidden.rows().iter().any(|row| row.thread().is_some());
    let row = if named {
        "Each word is a row of the floss key from the top: its symbol's number, its DMC number and its stitches, colons between them."
    } else {
        "Each pair is a row of the floss key from the top: its symbol's number, a colon and its stitches."
    };
    notice(
        &format!(
            "{row} Decode reads the line back, with the dates where Seedshift masked the phrase."
        ),
        NoticeKind::Info,
    );
    // The masked phrase in words, made only where it is shown or a replaced last word is told.
    let masked = (masked_words || legacy)
        .then(|| Backup::encode(&phrase, &dates, Form::English, mode, legacy))
        .transpose()?;
    // Named by the mode the legend keeps: a replaced last word, for the original Seedshift.
    if let (true, Some(masked)) = (masked_words, &masked) {
        print_masked_words(masked.backup.text()?.as_str(), masked.backup.mode());
    }
    if let (true, Some(masked)) = (legacy, &masked) {
        // As Encode says of a replaced last word, on the private screen as there: the word it
        // names is the one the legend drops. Then what it means for a pattern.
        terminal::error_line(&more_line("transformation-modes"));
        for sentence in legacy_sentences(masked)? {
            print_sentence(&sentence);
        }
        let words = phrase.len();
        lasting_warning(&format!(
            "Only the Original Seedshift loses a word in a pattern: it keeps {} of the {words} words. Remember your seed phrase's real last word.",
            words - 1
        ));
    }
    if original_copy {
        print_original_copy(phrase.text().as_str());
    }
    let facts = HeirSheetFacts {
        backup: HeirBackup::Pattern {
            words: phrase.len(),
        },
        mode,
        dates: dates.len(),
    };
    save_pattern(parsed, (&pdf, line.as_str()), &facts)
}

/// Saves the pattern's `pdf` and what the options name besides: the legend `line` as text and as a
/// QR code, and the sheet for heirs of `facts`, as every new backup saves them.
fn save_pattern(
    parsed: &Parsed,
    (pdf, line): (&[u8], &str),
    facts: &HeirSheetFacts,
) -> Result<(), Stop> {
    let mut outputs = parsed.clone();
    let saved_pdf = save_output(
        &mut outputs,
        "pdf",
        ResultName::one("The pattern"),
        |path| os::publish_new_file(&resolved(path), pdf),
    )?;
    if let Some(path) = saved_pdf {
        saved(&format!("Saved pattern: {}", shown_path(&path)));
    }
    let text = SecretText::build("a SeedStitch legend", line.len() + 1, |filler| {
        filler.push_str(line)?;
        filler.push('\n')
    })?;
    let saved_line = save_output(
        &mut outputs,
        "output",
        ResultName::one("The legend"),
        |path| os::publish_new_file(&resolved(path), text.as_str().as_bytes()),
    )?;
    if let Some(path) = saved_line {
        saved(&format!(
            "Saved the legend as typed back: {}",
            shown_path(&path)
        ));
    }
    let qr_saved = save_output(&mut outputs, "qr", ResultName::one("The QR code"), |path| {
        write_qr(parsed, line, path)
    })?;
    if let Some(path) = qr_saved {
        report_qr_verified(1);
        saved(&format!(
            "Saved QR code (the legend line): {}",
            shown_path(&path)
        ));
    }
    save_heir_sheet(&mut outputs, facts)?;
    report_renamed();
    Ok(())
}

/// The masked phrase's record where `text` is a SeedStitch legend line, warning of a misread row.
///
/// # Errors
///
/// The legend's refusals: `embroidery.legend.*` and `embroidery.phrase.legend-*`.
pub(crate) fn record_of_legend(text: &str) -> Result<Option<SecretText>, Stop> {
    let Some(read) = phrase::record_of_legend(text)? else {
        return Ok(None);
    };
    if let Some(row) = read.corrected_row() {
        lasting_warning(&format!(
            "Row {row} of the legend did not fit; it was read as the only change of it that gives a phrase. Check that row on the paper."
        ));
    } else if read.corrected() {
        lasting_warning(
            "A row of the legend did not fit; a change of any of several rows gives the same phrase, so the row cannot be told. Check the rows on the paper.",
        );
    }
    Ok(Some(read.into_record()))
}

#[cfg(test)]
mod tests {
    use mnemocode_embroidery::legend::EXAMPLE;

    use super::*;

    #[test]
    fn only_a_line_of_number_colon_number_words_is_taken_for_a_legend() {
        assert!(record_of_legend("1 2 3").unwrap().is_none());
        assert!(
            record_of_legend("MNC1:seedshift:indexes:1 2 3")
                .unwrap()
                .is_none()
        );
        assert!(record_of_legend("28:1725 #ff0000").unwrap().is_none());
        let record = record_of_legend(EXAMPLE).unwrap().unwrap();
        assert!(record.as_str().starts_with("MNC1:seedshift:indexes:"));
        assert!(record_of_legend("28:1725 25:2163").is_err());
    }
}
