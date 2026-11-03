//! `mnemocode stitch` (docs/SEEDSTITCH.md, ADR 0010): the phrase, masked with MnemoCode's
//! Seedshift, hidden in the legend of a cross-stitch pattern of a picture, the pattern saved as a
//! PDF. The picture is read before the phrase is asked; where it cannot be used, at the terminal,
//! another picture or width is asked instead of ending (CORE-42). Where Decode takes codes, a
//! SeedStitch legend typed or read is turned back into the record of the masked phrase, so that
//! Decode, and the menu's Decode, go on as for any record.

use std::fmt;
use std::path::Path;

use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode::text::numbers::typed_whole_number;
use mnemocode_embroidery::hide::{HideError, hide};
use mnemocode_embroidery::picture::{self, DEFAULT_WIDTH, Grid, MAX_FILE_BYTES, WIDTHS};
use mnemocode_embroidery::{chart, legend, phrase};

use super::asking::{AfterFailure, after_failure, value_until};
use super::encode_questions::file_questions;
use super::given::{PATH_LIMIT, check_date_input, phrase_and_dates};
use super::output_questions::input_file;
use super::resolved;
use super::saving::{ResultName, save_output};
use crate::args::{Parsed, integer_option, is_on, value};
use crate::gate::Stop;
use crate::input::read_picture;
use crate::os::{self, SystemRandom};
use crate::output::report_renamed;
use crate::terminal::result::{print, result_header};
use crate::terminal::{
    self, Choice, NoticeKind, TEXT_WIDTH, clear_private_screen, lasting_warning, notice, printable,
    saved, wrap_text,
};

/// The options `stitch` takes.
pub(crate) const OPTIONS: [&str; 9] = [
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "date",
    "dates-file",
    "picture",
    "stitches-across",
    "pdf",
    "output",
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

    /// Asks after `failure` for another picture or another width; false where the person stops.
    fn change(&mut self, failure: &str) -> Result<bool, Stop> {
        let now = format!("now {}", self.width);
        let choices = [
            Choice::noted(
                "Another picture",
                "a photograph with smooth shades works best",
                Next::Picture,
            ),
            Choice::noted("Other stitches across", &now, Next::Width),
            Choice::new("Stop", Next::Stop),
        ];
        loop {
            match after_failure(failure, &choices, AfterFailure::default())? {
                Next::Stop => return Ok(false),
                Next::Picture => {
                    let typed = value_until(
                        file_questions::PICTURE,
                        "the name of a PNG or JPEG file",
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
                    let what = format!("a number from {}", WIDTHS.to());
                    let typed = value_until(
                        &format!("Stitches across ({})", WIDTHS.to()),
                        &what,
                        PATH_LIMIT,
                        None,
                        |answer| typed_whole_number(answer, WIDTHS, None),
                    )?;
                    if let Some(width) = typed {
                        self.width = width as usize;
                        return Ok(true);
                    }
                }
            }
        }
    }
}

/// Runs the command: every option checked and the picture read before the phrase is asked or read,
/// `cli.stitch.no-picture` and `cli.stitch.no-pdf` among them.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
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
    check_date_input(parsed, Mode::Seedshift, DateWords::Codes)?;
    let mut source = Source {
        path: path.to_owned(),
        width,
        asking: is_on(parsed, "ask-secrets"),
    };
    let mut grid = source.usable_grid()?;
    let (phrase, dates) = match phrase_and_dates(parsed, Mode::Seedshift, DateWords::Codes, None)? {
        Ok(given) => given,
        Err(_) => return Err(Stop::Cancelled),
    };
    let entropy = phrase::masked_entropy(&phrase, &dates)?;
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
    let pdf = chart::chart(&hidden)?;
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
    print(channel, &wrap_text(line.as_str(), TEXT_WIDTH));
    notice(
        "Decode reads this line back: each row's symbol number, a colon and its stitches, from the top of the legend.",
        NoticeKind::Info,
    );
    let mut outputs = parsed.clone();
    let saved_pdf = save_output(
        &mut outputs,
        "pdf",
        ResultName::one("The pattern"),
        |path| os::publish_new_file(&resolved(path), &pdf),
    )?;
    if let Some(path) = saved_pdf {
        saved(&format!("Saved pattern: {}", printable(&path)));
    }
    let text = SecretText::build("a SeedStitch legend", line.len() + 1, |filler| {
        filler.push_str(line.as_str())?;
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
            printable(&path)
        ));
    }
    report_renamed();
    Ok(())
}

/// The record of the masked phrase that `text` holds where it is a SeedStitch legend line; none
/// where it is not one. A legend read by taking one row as misread names the row, and the warning
/// stays in the summary.
///
/// # Errors
///
/// The legend's refusals: `embroidery.legend.*`, `embroidery.phrase.legend-not-read` and
/// `embroidery.phrase.legend-ambiguous`.
pub(crate) fn record_of_legend(text: &str) -> Result<Option<SecretText>, Stop> {
    let Some(read) = phrase::record_of_legend(text)? else {
        return Ok(None);
    };
    if let Some(row) = read.corrected_row() {
        lasting_warning(&format!(
            "Row {row} of the legend did not fit; it was read as the only change of it that gives a phrase. Check that row on the paper."
        ));
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
