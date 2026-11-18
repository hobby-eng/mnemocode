//! `mnemocode stitch` (docs/SEEDSTITCH.md, ADR 0010): the phrase, masked with Seedshift unless
//! --mode direct, hidden in the legend of a cross-stitch pattern saved as a PDF; with --shares, split
//! into Shamir shares, one pattern a share from the same picture. The picture is read before the
//! phrase is asked. Legends that Decode reads are turned back into records or shares here.

use std::fmt;
use std::path::Path;

use mnemocode::backup::Backup;
use mnemocode::forms::Form;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::Refusal;
use mnemocode::secret::{SecretBytes, SecretText};
use mnemocode::sskr::split::{MAX_SHARES, check_threshold};
use mnemocode_embroidery::fabric::{self, DEFAULT_FABRIC, Fabric};
use mnemocode_embroidery::hide::{Hidden, HideError, hide};
use mnemocode_embroidery::phrase::SeedStitchError;
use mnemocode_embroidery::picture::{self, DEFAULT_WIDTH, Grid, MAX_FILE_BYTES, WIDTHS};
use mnemocode_embroidery::{chart, legend, phrase};
use zeroize::Zeroizing;

use super::asking::{AfterFailure, after_failure, value_until};
use super::configure::run_configured;
use super::encode::{masked_words_requested, original_copy_requested, write_qr};
use super::encode_questions::file_questions;
use super::given::{PATH_LIMIT, check_date_input, given_mode, phrase_and_dates};
use super::heir_sheet::{save_heir_sheet, validate_heir_sheet_options};
use super::output_questions::input_file;
use super::pattern_questions::ask_size;
use super::resolved;
use super::saving::{ResultName, folder_taken, save_output};
use super::share_output::report_qr_verified;
use super::sskr_split::SHARE_RANGE;
use crate::args::{Parsed, integer_option, is_on, value};
use crate::gate::Stop;
use crate::input::read_picture;
use crate::os::{self, Folder, SystemRandom};
use crate::output::{report_renamed, shown_path};
use crate::terminal::result::{phrase_grid, print, result_header, words_per_row};
use crate::terminal::{
    self, Channel, Choice, NoticeKind, clear_private_screen, lasting_warning, notice, saved,
    wrap_text,
};
use mnemocode_cards::heir::{HeirBackup, HeirSheetFacts};

/// The options `stitch` takes: those of every new backup, then the pattern's own.
pub(crate) const OPTIONS: [&str; 22] = [
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
    "threshold",
    "shares",
    "pdf-dir",
    "qr-dir",
];

/// The refusals of SeedStitch in the command line.
#[derive(Debug)]
enum StitchError {
    /// --picture is missing.
    NoPicture,
    /// An option that names one pattern's file, given with --shares.
    NotWithShares(&'static str),
    /// An option for the patterns of shares, given without --shares.
    OnlyWithShares(&'static str),
}

impl fmt::Display for StitchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoPicture => f.write_str("Name the picture of the pattern with --picture PATH."),
            Self::NotWithShares(option) => write!(
                f,
                "With --shares each share has its own pattern: name new folders with --pdf-dir and --qr-dir, not {option}."
            ),
            Self::OnlyWithShares(option) => write!(
                f,
                "{option} is for the patterns of Shamir shares: add --threshold and --shares."
            ),
        }
    }
}

impl std::error::Error for StitchError {}

impl Refusal for StitchError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoPicture => "cli.stitch.no-picture",
            Self::NotWithShares(_) => "cli.stitch.not-with-shares",
            Self::OnlyWithShares(_) => "cli.stitch.only-with-shares",
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
    run_configured(
        parsed,
        protection,
        super::pattern_questions::ask_pattern,
        |fresh, dates| run_with_dates(fresh, dates.as_deref()),
    )
}

/// The set that --threshold and --shares ask for, none for one pattern of the whole backup, its
/// options checked: each pattern of a share goes into the folder of --pdf-dir.
fn share_set(parsed: &Parsed) -> Result<Option<(usize, usize)>, Stop> {
    if !parsed.contains_key("threshold") && !parsed.contains_key("shares") {
        for (key, option) in [("pdf-dir", "--pdf-dir"), ("qr-dir", "--qr-dir")] {
            if parsed.contains_key(key) {
                return Err(StitchError::OnlyWithShares(option).into());
            }
        }
        return Ok(None);
    }
    let threshold = integer_option(parsed, "threshold", SHARE_RANGE, None, None)? as usize;
    let count = integer_option(parsed, "shares", SHARE_RANGE, None, None)? as usize;
    check_threshold(threshold, count)?;
    for (key, option) in [("pdf", "--pdf"), ("qr", "--qr")] {
        if parsed.contains_key(key) {
            return Err(StitchError::NotWithShares(option).into());
        }
    }
    Ok(Some((threshold, count)))
}

fn run_with_dates(parsed: &Parsed, dates: Option<&[mnemocode::dates::Date]>) -> Result<(), Stop> {
    let path = value(parsed, "picture").ok_or(StitchError::NoPicture)?;
    let set = share_set(parsed)?;
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
    let mode = given_mode(parsed)?.unwrap_or(Mode::Seedshift);
    check_date_input(parsed, mode, DateWords::Codes)?;
    // What every new backup may ask for, checked before a secret is read, as Encode checks it.
    super::hidden_qr::validate(parsed)?;
    let original_copy = original_copy_requested(parsed)?;
    let masked_words = masked_words_requested(parsed, mode)?;
    validate_heir_sheet_options(parsed)?;
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
    let entropies = match set {
        None => vec![phrase::legend_entropy(&phrase, mode, &dates)?],
        Some(set) => phrase::share_entropies(&phrase, (mode, &dates), set, &mut SystemRandom)?,
    };
    // Every pattern from the same picture, so that the shares look alike.
    let hidden = loop {
        terminal::work("Making the pattern…");
        let made: Result<Vec<Hidden>, HideError> = entropies
            .iter()
            .map(|entropy| hide(&grid, entropy, &mut SystemRandom))
            .collect();
        match made {
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
    // The charts are drawn only where a PDF is saved; the legend alone is shown otherwise.
    let pdfs = if parsed.contains_key("pdf") || parsed.contains_key("pdf-dir") {
        hidden
            .iter()
            .map(|one| chart::chart(one, fabric))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };
    let lines = hidden
        .iter()
        .map(|one| legend::line(one.rows()))
        .collect::<Result<Vec<_>, _>>()?;
    // The result is a step of its own: the questions are cleared away (CORE-39).
    clear_private_screen();
    let masked = if masked_words {
        Some(
            Backup::encode(&phrase, &dates, Form::English, mode)?
                .backup
                .text()?,
        )
    } else {
        None
    };
    let original = original_copy.then(|| phrase.text());
    show_result(
        (&hidden, &lines),
        (set, mode.masked()),
        (
            masked.as_ref().map(SecretText::as_str),
            original.as_ref().map(SecretText::as_str),
        ),
    );
    if let Some((original, written)) = entropies.first().and_then(|entropy| entropy.last_words()) {
        super::encode::print_last_word(original, written);
    }
    let backup = match set {
        None => HeirBackup::Pattern {
            words: phrase.len(),
        },
        Some((threshold, count)) => HeirBackup::PatternShares { threshold, count },
    };
    let facts = HeirSheetFacts {
        backup,
        mode,
        dates: dates.len(),
    };
    match (set, lines.first()) {
        (None, Some(line)) => save_pattern(parsed, (pdfs.first(), line.as_str()), &facts),
        _ => save_share_patterns(parsed, (&pdfs, &lines), &facts),
    }
}

/// A heading of the result, a blank line above it.
fn heading(channel: Channel, text: &str) -> [String; 2] {
    [
        String::new(),
        terminal::paint(channel, terminal::style::HEADING, text),
    ]
}

/// Shows the result, each part under its heading with room between them: the phrase after
/// Seedshift and the original phrase where `masked` and `original` give them, then the legend
/// `lines` of the patterns `hidden`, one of the whole backup or one a share of `set`, read back with
/// the dates where `dated`. The files saved are named below it.
fn show_result(
    (hidden, lines): (&[Hidden], &[SecretText]),
    (set, dated): (Option<(usize, usize)>, bool),
    (masked, original): (Option<&str>, Option<&str>),
) {
    let channel = terminal::secret_channel();
    let Some(first) = hidden.first() else {
        return;
    };
    let mut facts = vec![(
        "Pattern",
        format!(
            "{} by {} stitches, {} threads",
            first.pattern().width(),
            first.pattern().height(),
            first.rows().len()
        ),
    )];
    if let Some((threshold, count)) = set {
        facts.push((
            "Shares",
            format!("any {threshold} of {count}, a pattern each"),
        ));
    }
    result_header("Embroidery", &facts, channel);
    // The phrases go where a phrase always goes, the codes where the codes do; on a terminal both
    // are the private screen.
    // As much on one screen as its width allows: the private screen keeps no scrollback.
    let width = terminal::columns().clamp(40, 160);
    let per_row = words_per_row(width);
    if let Some(words) = masked {
        print(
            Channel::Output,
            &heading(Channel::Output, "Seed phrase after Seedshift"),
        );
        print(
            Channel::Output,
            &phrase_grid(words, Channel::Output, per_row),
        );
        terminal::result_hint(
            "Only your dates turn these words back into the wallet's seed phrase.",
        );
    }
    if let Some(phrase) = original {
        print(
            Channel::Output,
            &heading(Channel::Output, "Original seed phrase"),
        );
        print(
            Channel::Output,
            &phrase_grid(phrase, Channel::Output, per_row),
        );
        notice(
            "Keep the original phrase apart from the patterns.",
            NoticeKind::Warning,
        );
    }
    let title = match set {
        None => "Legend line: keep it, in this exact order, or the PDF that holds it",
        Some(_) if masked.is_some() => "That phrase split into Shamir shares",
        Some(_) => "The seed phrase split into Shamir shares",
    };
    print(channel, &heading(channel, title));
    // Each share's name beside its legend, the legend wrapped under it.
    let label_width = set.map_or(2, |(_, count)| format!("Share {count} of {count}  ").len());
    for (place, line) in lines.iter().enumerate() {
        if place > 0 {
            print(channel, &[String::new()]);
        }
        let label = set.map_or_else(String::new, |(_, count)| {
            format!("Share {} of {count}", place + 1)
        });
        let rows: Vec<String> = wrap_text(line.as_str(), width.saturating_sub(label_width))
            .iter()
            .enumerate()
            .map(|(row, text)| {
                let lead = if row == 0 {
                    terminal::paint(
                        channel,
                        terminal::style::STRONG,
                        &format!("{label:<label_width$}"),
                    )
                } else {
                    " ".repeat(label_width)
                };
                format!("{lead}{text}")
            })
            .collect();
        print(channel, &rows);
    }
    // Format 2, whose rows' order holds part of the phrase, names each row's thread.
    let named = hidden
        .iter()
        .any(|one| one.rows().iter().any(|row| row.thread().is_some()));
    let row = if named {
        "Each item is a floss key row from the top: symbol number, DMC number, stitches."
    } else {
        "Each pair is a floss key row from the top: symbol number, stitches."
    };
    let reader = match set {
        None => "Decode reads the line back".to_owned(),
        Some((threshold, _)) => format!("Restore from shares reads any {threshold} back"),
    };
    let dates = if dated { ", with your dates" } else { "" };
    print(channel, &[String::new()]);
    notice(&format!("{row} {reader}{dates}."), NoticeKind::Info);
    print(channel, &heading(channel, "Saved files"));
}

/// The legend `lines` as a text file, one to a line.
fn line_text(lines: &[SecretText]) -> Result<SecretText, Stop> {
    let length: usize = lines.iter().map(|line| line.as_str().len() + 1).sum();
    Ok(SecretText::build("SeedStitch legends", length, |filler| {
        for line in lines {
            filler.push_str(line.as_str())?;
            filler.push('\n')?;
        }
        Ok::<(), mnemocode::secret::CapacityExceeded>(())
    })?)
}

/// Saves the pattern's `pdf` and what the options name besides: the legend `line` as text and as a
/// QR code, and the sheet for heirs of `facts`, as every new backup saves them.
fn save_pattern(
    parsed: &Parsed,
    (pdf, line): (Option<&SecretBytes>, &str),
    facts: &HeirSheetFacts,
) -> Result<(), Stop> {
    let mut outputs = parsed.clone();
    if let Some(pdf) = pdf {
        let saved_pdf = save_output(
            &mut outputs,
            "pdf",
            ResultName::one("The pattern"),
            |path| os::publish_new_file(&resolved(path), pdf),
        )?;
        if let Some(path) = saved_pdf {
            saved(&format!("Saved pattern: {}", shown_path(&path)));
        }
    }
    let text = line_text(&[SecretText::copy_of("a SeedStitch legend", line)])?;
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

/// Saves `files`, each a name and its bytes, in the new folder that `key` names; the folder, where
/// it was saved.
fn save_folder(
    outputs: &mut Parsed,
    key: &'static str,
    what: &'static str,
    files: &[(String, &[u8])],
) -> Result<Option<String>, Stop> {
    save_output(outputs, key, ResultName { what, plural: true }, |path| {
        let folder = Folder::claim(
            Path::new(path),
            terminal::environment().current.as_deref(),
            folder_taken(key).to_owned(),
        )?;
        folder.publish(".mnemocode-pattern-", |staging| {
            for (name, bytes) in files {
                os::write_new_private_file(&staging.join(name), bytes)?;
            }
            Ok(())
        })
    })
}

/// Saves the patterns of the shares, a PDF each in the folder of --pdf-dir, and what the options
/// name besides: their legend `lines` as text, one to a line, and as QR codes in a folder of their
/// own, and the sheet for heirs of `facts`.
fn save_share_patterns(
    parsed: &Parsed,
    (pdfs, lines): (&[SecretBytes], &[SecretText]),
    facts: &HeirSheetFacts,
) -> Result<(), Stop> {
    let mut outputs = parsed.clone();
    let files: Vec<(String, &[u8])> = pdfs
        .iter()
        .enumerate()
        .map(|(place, pdf)| (format!("share-{}-pattern.pdf", place + 1), &pdf[..]))
        .collect();
    if let Some(folder) = save_folder(
        &mut outputs,
        "pdf-dir",
        "The patterns of the shares",
        &files,
    )? {
        saved(&format!(
            "Saved {} patterns, one a share: {}",
            pdfs.len(),
            shown_path(&folder)
        ));
    }
    let text = line_text(lines)?;
    let saved_lines = save_output(
        &mut outputs,
        "output",
        ResultName::one("The legends"),
        |path| os::publish_new_file(&resolved(path), text.as_str().as_bytes()),
    )?;
    if let Some(path) = saved_lines {
        saved(&format!(
            "Saved the legends as typed back, one share a line: {}",
            shown_path(&path)
        ));
    }
    if parsed.contains_key("qr-dir") {
        let images = lines
            .iter()
            .map(|line| super::hidden_qr::image(parsed, line.as_str()))
            .collect::<Result<Vec<_>, _>>()?;
        let files: Vec<(String, &[u8])> = images
            .iter()
            .enumerate()
            .map(|(place, image)| (format!("share-{}-qr.png", place + 1), &image[..]))
            .collect();
        if let Some(folder) = save_folder(
            &mut outputs,
            "qr-dir",
            "The QR codes of the legends",
            &files,
        )? {
            report_qr_verified(images.len());
            saved(&format!(
                "Saved {} QR codes, one a share's legend line: {}",
                images.len(),
                shown_path(&folder)
            ));
        }
    }
    save_heir_sheet(&mut outputs, facts)?;
    report_renamed();
    Ok(())
}

/// Warns that a row of a legend was read as misread: `row`, where only it explains the change.
fn warn_misread(row: Option<usize>, corrected: bool) {
    if let Some(row) = row {
        lasting_warning(&format!(
            "Row {row} of the legend did not fit; it was read as the only change of it that gives a phrase. Check that row on the paper."
        ));
    } else if corrected {
        lasting_warning(
            "A row of the legend did not fit; a change of any of several rows gives the same phrase, so the row cannot be told. Check the rows on the paper.",
        );
    }
}

/// What the SeedStitch legend line `text` holds: its phrase's word numbers, or the share as a
/// share's code (ur:sskr/…); none for another text. A misread row is warned of.
fn read_legend(text: &str) -> Result<Option<SecretText>, Stop> {
    match phrase::record_of_legend(text) {
        Ok(None) => Ok(None),
        Ok(Some(read)) => {
            warn_misread(read.corrected_row(), read.corrected());
            Ok(Some(read.into_record()))
        }
        Err(SeedStitchError::Share) => {
            let Some(line) = phrase::share_of_legend(text)? else {
                return Ok(None);
            };
            warn_misread(line.corrected_row, line.corrected);
            Ok(Some(line.share.ur()))
        }
        Err(error) => Err(error.into()),
    }
}

/// What `text` stands for where it is a SeedStitch legend line: the record of the masked phrase, or
/// the share it holds as a share's code (ur:sskr/…), which a restore from shares takes. Several
/// legends of shares, as a restore takes them, give their shares. A misread row is warned of.
///
/// # Errors
///
/// The legend's refusals: `embroidery.legend.*` and `embroidery.phrase.legend-*`.
pub(crate) fn text_of_legend(text: &str) -> Result<Option<SecretText>, Stop> {
    match read_legend(text) {
        Ok(read) => Ok(read),
        // Legends of several shares, one after another.
        Err(refused) if text.contains([';', '\n']) => match shares_of_legends(text) {
            Ok(Some(shares)) => Ok(Some(shares)),
            _ => Err(refused),
        },
        Err(refused) => Err(refused),
    }
}

/// The symbol numbers of the rows of the legend line `piece`, as each row starts with one.
fn symbols_of(piece: &str) -> Zeroizing<Vec<usize>> {
    Zeroizing::new(
        piece
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter_map(|row| row.split(':').next()?.parse().ok())
            .collect(),
    )
}

/// Where the legend line that starts at `pieces[at]` ends, one wrapped over several pieces: the
/// fewest pieces that read as typed, else the most that name no symbol twice; `at` where that piece
/// is no legend line. Only a reading as typed is tried, which is quick.
fn legend_end(pieces: &[&str], at: usize) -> usize {
    let mut joined = Zeroizing::new(String::new());
    let mut named = Zeroizing::new([0_u8; legend::MAX_ROWS + 1]);
    let mut rows = 0;
    let mut end = at;
    for piece in &pieces[at..] {
        if !legend::is_line(piece) {
            break;
        }
        let symbols = symbols_of(piece);
        let twice = symbols
            .iter()
            .any(|&symbol| named.get(symbol).is_none_or(|&seen| seen == 1));
        if end > at && (twice || rows + symbols.len() > legend::MAX_ROWS) {
            break;
        }
        for &symbol in symbols.iter() {
            if let Some(seen) = named.get_mut(symbol) {
                *seen = 1;
            }
        }
        rows += symbols.len();
        if !joined.is_empty() {
            joined.push(' ');
        }
        joined.push_str(piece);
        end += 1;
        if phrase::reads_as_typed(&joined) {
            break;
        }
    }
    end
}

/// `text` of shares with each SeedStitch legend line in it taken for the share it holds: the parts
/// split as shares are, a legend wrapped over several of them joined again. None where no part is a
/// legend line, or where they make more legends than a set has shares. A share whose phrase is
/// masked, or not, where `masked` says otherwise is refused.
///
/// # Errors
///
/// The legend's refusals for a legend line that does not read, and `cli.stitch.share-mode`.
pub(crate) fn shares_of_legends(text: &str) -> Result<Option<SecretText>, Stop> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let pieces: Vec<&str> = text
        .split([';', '\n'])
        .map(str::trim)
        .filter(|piece| !piece.is_empty())
        .collect();
    let mut parts = Vec::new();
    let mut at = 0;
    while at < pieces.len() {
        let end = legend_end(&pieces, at).max(at + 1);
        parts.push((at, end));
        at = end;
    }
    let legends = parts
        .iter()
        .filter(|&&(at, _)| legend::is_line(pieces[at]))
        .count();
    if legends == 0 || legends > MAX_SHARES {
        return Ok(None);
    }
    let mut read = Vec::with_capacity(parts.len());
    for (at, end) in parts {
        let joined = Zeroizing::new(pieces[at..end].join(" "));
        read.push(match read_legend(&joined)? {
            Some(share) => share,
            None => SecretText::copy_of("a typed share", &joined),
        });
    }
    line_text(&read).map(Some)
}

#[cfg(test)]
mod tests {
    use mnemocode_embroidery::legend::EXAMPLE;

    use super::*;

    #[test]
    fn only_a_line_of_number_colon_number_words_is_taken_for_a_legend() {
        assert!(text_of_legend("1 2 3").unwrap().is_none());
        assert!(
            text_of_legend("MNC1:seedshift:indexes:1 2 3")
                .unwrap()
                .is_none()
        );
        assert!(text_of_legend("28:1725 #ff0000").unwrap().is_none());
        // A legend gives the word numbers of its phrase alone, as a record file holds them.
        let record = text_of_legend(EXAMPLE).unwrap().unwrap();
        assert_eq!(record.as_str().split(' ').count(), 24);
        assert!(
            record
                .as_str()
                .split(' ')
                .all(|number| number.parse::<u16>().is_ok())
        );
        assert!(text_of_legend("28:1725 25:2163").is_err());
    }
}
