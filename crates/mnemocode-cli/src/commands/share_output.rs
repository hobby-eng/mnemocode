//! What the share commands write (MnemoCode TS 0.1.0's `cli/sskr-output.ts`): the shares in their
//! forms on the screen, and the files, cards and QR codes that the options name, each saved with a
//! choice after a failure.

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::sskr::export::WrittenShare;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::keeping::{Packaging, share_keeping_note};
use mnemocode::sskr::share::{Share, TransportError};

use super::resolved;
use super::saving::{ResultName, folder_taken, save_output};
use crate::args::{Parsed, parse_arguments, value};
use crate::gate::Stop;
use crate::os::{self, FileError, Folder};
use mnemocode_cards::content::SskrLayout;
use mnemocode_cards::export::{
    ExportError as CardExportError, ShareCardOptions, ShareCardSet, ShareQrCode,
};
use mnemocode_cards::raster::ImageFormat;
use mnemocode_cards::templates::{
    CardDrawing, DEFAULT_SHARE_TEMPLATE_ID, TemplateError, select_template,
};

use super::cards::{
    BUSINESS_OPTIONS, card_file_format, card_settings, check_card_output, export_page_images,
    export_share_files, format_name, image_format, publish_pdf, save_qr_beside, save_qr_inside,
    saved_pages_notice,
};
use crate::os::SystemRandom;
use crate::terminal::result::{backup_code_lines, code_lines, print};
use crate::terminal::{
    self, Channel, NoticeKind, can_redraw, notice, printable, result_lines, saved, show_result,
};

/// Reports only images already verified and successfully published.
pub(crate) fn report_qr_verified(count: usize) {
    if count == 1 {
        saved("QR code verified.");
    } else if count > 1 {
        saved(&format!("{count} QR codes verified."));
    }
}

/// A form that is no share's.
#[derive(Debug)]
struct NoShareFormat(TransportError);

impl fmt::Display for NoShareFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} These are share formats, not BIP39 representations.",
            self.0
        )
    }
}

impl std::error::Error for NoShareFormat {}

impl Refusal for NoShareFormat {
    fn code(&self) -> &'static str {
        "cli.sskr-output.share-formats-not-bip39-representations"
    }
}

/// The form that `name` names, the default one without it.
pub(crate) fn share_format_named(name: Option<&str>) -> Result<ShareFormat, Stop> {
    let Some(name) = name else {
        return Ok(ShareFormat::DEFAULT);
    };
    ShareFormat::named(name).map_err(|error| NoShareFormat(error).into())
}

/// The form of --format.
pub(crate) fn share_format(parsed: &Parsed) -> Result<ShareFormat, Stop> {
    share_format_named(value(parsed, "format"))
}

/// Shares in the same form, in their order, as a split makes them.
pub(crate) fn in_form(shares: &[Share], format: ShareFormat) -> Vec<WrittenShare> {
    shares
        .iter()
        .enumerate()
        .map(|(index, share)| WrittenShare {
            share: share.copy(),
            format,
            number: index + 1,
        })
        .collect()
}

/// How shares are printed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Presentation {
    /// An accepted split or export.
    Backup,
    /// An unconfirmed repair variant, which is not marked as a share to save.
    Candidate,
}

/// The lines of one share under `title`, with its form and what it holds where that is known: as a
/// result header on a terminal, as one line before it elsewhere.
fn share_block_lines(
    title: &str,
    share: &Share,
    format: ShareFormat,
    holds: Option<&str>,
    purpose: Presentation,
) -> Vec<(Channel, String)> {
    let form = format.label();
    let mut facts = vec![("Format", form.clone())];
    facts.extend(holds.map(|holds| ("Holds", holds.to_owned())));
    let mut lines: Vec<(Channel, String)> = if can_redraw(Channel::Output) {
        result_lines(Channel::Output, title, &facts)
            .into_iter()
            .map(|line| (Channel::Output, line))
            .collect()
    } else {
        let holding = holds.map_or_else(String::new, |holds| format!(", holds {holds}"));
        vec![(Channel::Error, format!("{title} — {form}{holding}:"))]
    };
    let text = format.write(share);
    let codes = match purpose {
        Presentation::Backup => backup_code_lines(&text, format.mirrored(), "share"),
        Presentation::Candidate => code_lines(&text, format.mirrored()),
    };
    lines.extend(codes.into_iter().map(|line| (Channel::Output, line)));
    lines
}

/// Prints `lines`, each on its channel, as a result.
fn print_share_lines(lines: &[(Channel, String)]) {
    show_result();
    for (channel, line) in lines {
        print(*channel, std::slice::from_ref(line));
    }
}

/// Prints one share under `title`.
pub(crate) fn print_share_block(title: &str, share: &Share, format: ShareFormat) {
    print_share_lines(&share_block_lines(
        title,
        share,
        format,
        None,
        Presentation::Candidate,
    ));
}

/// Prints shares as "SSKR share N of M", by their places among the `total` made or typed, with what
/// they hold where that is known, so that a masked phrase is not taken for the wallet's.
pub(crate) fn print_shares(
    shares: &[WrittenShare],
    total: usize,
    holds: Option<&str>,
    purpose: Presentation,
) {
    let lines: Vec<(Channel, String)> = shares
        .iter()
        .flat_map(|written| {
            let title = format!("SSKR share {} of {total}", written.number);
            share_block_lines(&title, &written.share, written.format, holds, purpose)
        })
        .collect();
    print_share_lines(&lines);
}

/// The cards of shares that the options ask for: how they are drawn, and the format of their files.
#[derive(Debug)]
pub(crate) struct ShareCards {
    drawing: CardDrawing,
    /// How they are drawn.
    pub(crate) options: ShareCardOptions,
    file_format: Option<ImageFormat>,
}

/// The cards of shares in `format` that the options name, settled once; none without a card output.
pub(crate) fn export_options(
    parsed: &Parsed,
    format: ShareFormat,
) -> Result<Option<ShareCards>, Stop> {
    let settings_names: Vec<&str> = ["card-layout", "template"]
        .into_iter()
        .chain(BUSINESS_OPTIONS)
        .collect();
    let outputs = check_card_output(parsed, &settings_names)?;
    if !outputs.sheets && !outputs.cards {
        return Ok(None);
    }
    // Before any secret is asked, as the cards would refuse it later.
    format.check_has_cards()?;
    let id = value(parsed, "template").unwrap_or(DEFAULT_SHARE_TEMPLATE_ID);
    let template = select_template(Some(id))?;
    let requested = SskrLayout::parse(value(parsed, "card-layout"))?;
    let settings = card_settings(parsed, Some(template))?;
    // Resolved here so that the messages below describe what is actually written.
    let layout = SskrLayout::resolved(requested, settings.page_size)?;
    layout.check_qr(&settings)?;
    if layout.separate_cards() && !template.draws_separate_cards() {
        return Err(TemplateError::SheetsOnly.into());
    }
    Ok(Some(ShareCards {
        drawing: CardDrawing::new(),
        options: ShareCardOptions {
            template,
            layout: Some(layout),
            share_format: format,
            title: None,
            settings,
        },
        file_format: card_file_format(parsed)?,
    }))
}

/// Refuses the menu's card options where the cards of shares in `format` could not be printed. It
/// says nothing: the menu's record of answers counts every line it writes.
pub(crate) fn share_cards_fit_of(options: &[String], format: ShareFormat) -> Result<(), Stop> {
    if let Some(cards) = export_options(&parse_arguments(options)?, format)? {
        ShareCardSet::check_printable(&cards.drawing, &mut SystemRandom, &cards.options)?;
    }
    Ok(())
}

/// Refuses cards that could not be printed for every seed phrase, where they are asked for.
pub(crate) fn check_share_cards_printable(cards: Option<&ShareCards>) -> Result<(), Stop> {
    if let Some(cards) = cards {
        cards.check_printable(cards.options.share_format)?;
    }
    Ok(())
}

impl ShareCards {
    /// Refuses these cards where they could not be printed in `format`.
    pub(crate) fn check_printable(&self, format: ShareFormat) -> Result<(), CardExportError> {
        let options = ShareCardOptions {
            share_format: format,
            ..self.options.clone()
        };
        terminal::work("Checking that the share cards can be printed…");
        ShareCardSet::check_printable(&self.drawing, &mut SystemRandom, &options)
    }

    /// Prints these cards in `format` from now on.
    pub(crate) const fn show_in(&mut self, format: ShareFormat) {
        self.options.share_format = format;
    }
}

/// The QR code of each share's sheets, also saved as an image where the cards went (`save`), which
/// Restore reads back.
fn save_share_qrs(
    set: &ShareCardSet,
    save: &dyn Fn(&ShareQrCode) -> Result<Option<String>, Stop>,
) -> Result<(), Stop> {
    let mut count = 0;
    for code in set.qr_codes() {
        if save(&code)?.is_some() {
            count += 1;
        }
    }
    if count > 0 {
        let files = if count == 1 { "file" } else { "files" };
        saved(&format!(
            "Saved the QR codes of the share sheets as images beside them: {count} PNG {files}."
        ));
    }
    Ok(())
}

/// Saves the cards, the PDF and the images of the shares that the options name, from `set`.
fn save_share_cards(
    set: &ShareCardSet,
    parsed: &mut Parsed,
    cards: &ShareCards,
    keep: &dyn Fn(Packaging) -> Result<(), Stop>,
) -> Result<(), Stop> {
    let drawing = &cards.drawing;
    let mut random = SystemRandom;
    if value(parsed, "cards-dir").is_some() {
        let format = cards.file_format;
        let mut files = 0;
        let directory = save_output(
            parsed,
            "cards-dir",
            ResultName::one("The folder of share cards"),
            |path| {
                files = export_share_files(drawing, path, format, set)?;
                Ok(())
            },
        )?;
        if let Some(directory) = directory {
            saved(&format!(
                "Saved {files} {} files to: {}",
                format_name(format),
                printable(&directory)
            ));
            save_share_qrs(set, &|code| {
                save_qr_inside(&code.payload, &directory, &code.name)
            })?;
            keep(if set.layout().separate_cards() {
                Packaging::Folders
            } else if format.is_some() {
                Packaging::Pages
            } else {
                Packaging::Files
            })?;
        }
    }
    let pdf = save_output(
        parsed,
        "pdf",
        ResultName::one("The PDF of the shares"),
        |path| publish_pdf(drawing, set.pages(drawing, &mut random), &resolved(path)),
    )?;
    if let Some(pdf) = pdf {
        saved(&format!("Saved SSKR collection PDF: {}", printable(&pdf)));
        keep(Packaging::File)?;
        save_share_qrs(set, &|code| {
            save_qr_beside(&code.payload, &pdf, &format!("-{}", code.reference))
        })?;
    }
    let (format, mut count) = (image_format(parsed)?, 0);
    let images = save_output(
        parsed,
        "images-dir",
        ResultName::one("The folder of share images"),
        |path| {
            let pages = set.pages(drawing, &mut random);
            count = export_page_images(drawing, pages, path, format)?;
            Ok(())
        },
    )?;
    if let Some(images) = images {
        saved_pages_notice(parsed, count, &images, Some("SSKR"))?;
        keep(Packaging::Folder)?;
        save_share_qrs(set, &|code| {
            save_qr_inside(&code.payload, &images, &code.name)
        })?;
    }
    Ok(())
}

/// Saves the shares where the options say, each output followed by how its shares are kept:
/// `masked` says that they hold the masked phrase. One set of cards for every file, so that each
/// shows the same decoys.
pub(crate) fn save_shares(
    shown: &[&WrittenShare],
    parsed: &mut Parsed,
    cards: Option<&ShareCards>,
    masked: bool,
) -> Result<(), Stop> {
    let shares: Vec<Share> = shown.iter().map(|written| written.share.copy()).collect();
    let keep = |packaging: Packaging| -> Result<(), Stop> {
        notice(
            &share_keeping_note(&shares, packaging, masked)?,
            NoticeKind::Info,
        );
        Ok(())
    };
    if let Some(cards) = cards {
        terminal::work("Rendering the share cards…");
        let records: Vec<String> = shown
            .iter()
            .map(|written| written.share.ur().as_str().to_owned())
            .collect();
        let set =
            ShareCardSet::create(&cards.drawing, &mut SystemRandom, &records, &cards.options)?;
        save_share_cards(&set, parsed, cards, &keep)?;
    }
    let qr_folder = save_output(
        parsed,
        "qr-dir",
        ResultName {
            what: "The QR images of the shares",
            plural: true,
        },
        |path| {
            let taken = folder_taken("qr-dir").to_owned();
            let folder = Folder::claim(
                std::path::Path::new(path),
                terminal::environment().current.as_deref(),
                taken,
            )?;
            folder.publish(".mnemocode-share-qr-", |staging| {
                for written in shown {
                    let text = written.format.write(&written.share);
                    let image = mnemocode::qr::png(&text).map_err(step_failed)?;
                    let name = format!("share-{}-qr.png", written.number);
                    os::write_new_private_file(&staging.join(name), &image)?;
                }
                Ok(())
            })
        },
    )?;
    if let Some(folder) = qr_folder {
        report_qr_verified(shown.len());
        saved(&format!(
            "Saved {} share QR images to: {}",
            shown.len(),
            printable(&folder)
        ));
        keep(Packaging::Folder)?;
    }
    // Each share in its form, as the terminal shows it.
    let mut text = String::new();
    for written in shown {
        text.push_str(&written.format.write(&written.share));
        text.push('\n');
    }
    let output = save_output(
        parsed,
        "output",
        ResultName::one("The file of the shares"),
        |path| os::publish_new_file(&resolved(path), text.as_bytes()),
    )?;
    if let Some(output) = output {
        saved(&format!(
            "Saved SSKR records: {} (one complete share per line).",
            printable(&output)
        ));
        keep(Packaging::File)?;
    }
    Ok(())
}

/// A step of a save that is not the file system's.
pub(crate) fn step_failed<E: Refusal + Send + Sync + 'static>(error: E) -> FileError {
    FileError::Step(Box::new(error))
}
