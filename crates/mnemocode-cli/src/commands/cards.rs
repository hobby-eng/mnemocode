//! The cards that a command saves (MnemoCode TS 0.1.0's `cli/card-options.ts`,
//! `business-options.ts`, `image-options.ts`, `cards-fit.ts`, `qr-export.ts` and the saving parts
//! of `export/individual-cards.ts`, `sskr-cards.ts` and `image-export.ts`, CAP-CARDS-CLI-CARD-OPTIONS):
//! the options that settle them, what is checked before any secret, and the files and folders they
//! are written to. The cards crate draws; every file is written here.

use std::fmt;
use std::path::{Component, Path, PathBuf};

use mnemocode::forms::Form;
use mnemocode::refusal::Refusal;
use mnemocode_cards::content::{check_phrase_sheet_qr, page_file_name};
use mnemocode_cards::details::{CardCopy, ExportDetails};
use mnemocode_cards::export::{
    CardJob, ExportError, NamedDocument, ShareCardSet, pdf_of, planned_card_job, separate_card_job,
    write_pdf,
};
use mnemocode_cards::pdf::PdfError;
use mnemocode_cards::preflight::{CardOutputs, ColorCardsCheck, check_color_cards_fit};
use mnemocode_cards::raster::{ImageFormat, page_image};
use mnemocode_cards::scene::Page;
use mnemocode_cards::settings::{CardProfile, CardSettings, Orientation, PageSize, ProfileField};
use mnemocode_cards::templates::{CardDrawing, CardTemplate, select_template};

use super::given::card_format_numbers;
use super::resolved;
use super::saving::{ResultName, folder_taken, save_output};
use super::share_output::{report_qr_verified, step_failed};
use crate::args::{Given, Parsed, assert_text_values, is_on, parse_arguments, value};
use crate::gate::Stop;
use crate::os::{self, FileError, Folder, SystemRandom};
use crate::output::first_free_name;
use crate::terminal::{self, printable, saved};

/// The options of each detail of the person on the cards, by the detail.
pub(crate) const PROFILE_OPTIONS: [(ProfileField, &str); 7] = [
    (ProfileField::Name, "card-name"),
    (ProfileField::Role, "card-role"),
    (ProfileField::Company, "card-company"),
    (ProfileField::Email, "card-email"),
    (ProfileField::Phone, "card-phone"),
    (ProfileField::Website, "card-website"),
    (ProfileField::Location, "card-location"),
];
/// The options of the texts of a card design, in the order of their random choices.
pub(crate) const COPY_OPTIONS: [&str; 5] = [
    "studio-name",
    "card-slogan",
    "card-subtitle",
    "card-footer",
    "card-reference-label",
];
/// What a command that saves cards takes beside its own.
pub(crate) const CARD_OPTIONS: [&str; 19] = [
    "cards-dir",
    "template",
    "images-dir",
    "image-format",
    "page-size",
    "orientation",
    "card-name",
    "card-role",
    "card-company",
    "card-email",
    "card-phone",
    "card-website",
    "card-location",
    "studio-name",
    "card-slogan",
    "card-subtitle",
    "card-footer",
    "card-reference-label",
    "card-qr",
];
/// The options that say how cards are printed.
pub(crate) const BUSINESS_OPTIONS: [&str; 15] = [
    "page-size",
    "orientation",
    "card-name",
    "card-role",
    "card-company",
    "card-email",
    "card-phone",
    "card-website",
    "card-location",
    "studio-name",
    "card-slogan",
    "card-subtitle",
    "card-footer",
    "card-reference-label",
    "card-qr",
];

/// The refusals of the card options.
#[derive(Debug)]
enum CardOptionError {
    CardFolderOnce,
    NoOutput,
    RequiresFormat,
    ImageFormatWithoutFolder,
}

impl fmt::Display for CardOptionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CardFolderOnce => f.write_str(
                "Provide the individual-card output folder once, using a non-empty path.",
            ),
            Self::NoOutput => f.write_str(
                "Card settings require a PDF file, an image output folder or an individual-card output folder.",
            ),
            Self::RequiresFormat => {
                write!(f, "Card export requires format {}.", card_format_numbers())
            }
            Self::ImageFormatWithoutFolder => f.write_str(
                "An image format can be selected only when an image output folder or individual-card output folder is provided.",
            ),
        }
    }
}

impl std::error::Error for CardOptionError {}

impl Refusal for CardOptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::CardFolderOnce => {
                "cli.card-options.provide-individual-card-output-folder-once-using-non"
            }
            Self::NoOutput => "cli.card-options.card-settings-require-pdf-file-image-output-folder",
            Self::RequiresFormat => "cli.card-options.card-export-requires-format",
            Self::ImageFormatWithoutFolder => {
                "cli.image-options.image-format-can-selected-only-when-image-output"
            }
        }
    }
}

/// Which card outputs the options name.
pub(crate) fn card_outputs(parsed: &Parsed) -> CardOutputs {
    CardOutputs {
        sheets: value(parsed, "pdf").is_some() || value(parsed, "images-dir").is_some(),
        cards: value(parsed, "cards-dir").is_some(),
    }
}

/// The card outputs that the options name, after refusing a folder of separate cards given twice,
/// and any of `settings`, the card settings of a command, given without a card output.
pub(crate) fn check_card_output(parsed: &Parsed, settings: &[&str]) -> Result<CardOutputs, Stop> {
    if parsed.contains_key("cards-dir") && value(parsed, "cards-dir").is_none() {
        return Err(CardOptionError::CardFolderOnce.into());
    }
    let outputs = card_outputs(parsed);
    let unused = !outputs.sheets && !outputs.cards;
    if unused && settings.iter().any(|name| parsed.contains_key(*name)) {
        return Err(CardOptionError::NoOutput.into());
    }
    Ok(outputs)
}

/// The size of the page that the options name.
fn page_size_of(parsed: &Parsed) -> Result<Option<PageSize>, Stop> {
    Ok(value(parsed, "page-size")
        .map(|name| PageSize::parse(Some(name)))
        .transpose()?)
}

/// The settings of the cards that the options describe, the person and the texts that they do not
/// give chosen once with the system's randomness, which suit `template`, the first design if any.
pub(crate) fn card_settings(
    parsed: &Parsed,
    template: Option<&CardTemplate>,
) -> Result<CardSettings, Stop> {
    let texts: Vec<&str> = BUSINESS_OPTIONS
        .into_iter()
        .filter(|&name| name != "card-qr")
        .collect();
    assert_text_values(parsed, &texts)?;
    let mut profile = CardProfile::default();
    for (field, option) in PROFILE_OPTIONS {
        if let Some(text) = value(parsed, option) {
            profile.set(field, text.to_owned());
        }
    }
    let [studio_name, slogan, subtitle, footer, reference_label] =
        COPY_OPTIONS.map(|option| value(parsed, option).map(str::to_owned));
    let details = ExportDetails::drawn(
        &mut SystemRandom,
        &profile.validated()?,
        &CardCopy {
            studio_name,
            slogan,
            subtitle,
            footer,
            reference_label,
        },
        template.and_then(CardTemplate::sector),
    )?;
    Ok(CardSettings {
        page_size: page_size_of(parsed)?,
        orientation: Orientation::parse(value(parsed, "orientation"))?,
        profile: details.profile,
        presentation: Some(details.presentation),
        card_qr: is_on(parsed, "card-qr"),
    })
}

/// The design of the colour cards that --template names.
pub(crate) fn card_template(parsed: &Parsed) -> Result<&'static CardTemplate, Stop> {
    Ok(select_template(value(parsed, "template"))?)
}

/// The settings of a card output, which it must use.
pub(crate) const ENCODE_CARD_SETTINGS: [&str; 17] = [
    "template",
    "title",
    "page-size",
    "orientation",
    "card-name",
    "card-role",
    "card-company",
    "card-email",
    "card-phone",
    "card-website",
    "card-location",
    "studio-name",
    "card-slogan",
    "card-subtitle",
    "card-footer",
    "card-reference-label",
    "card-qr",
];

/// Refuses card options that cannot draw cards of codes in `form`, before a secret is asked.
pub(crate) fn validate_card_options(parsed: &Parsed, form: Form) -> Result<(), Stop> {
    let outputs = check_card_output(parsed, &ENCODE_CARD_SETTINGS)?;
    if !outputs.sheets && !outputs.cards {
        return Ok(());
    }
    if !form.has_cards() {
        return Err(CardOptionError::RequiresFormat.into());
    }
    // A card page size makes a PDF or page images of separate cards too.
    if outputs.cards || page_size_of(parsed)? == Some(PageSize::Business) {
        mnemocode_cards::export::check_individual_template(card_template(parsed)?, false)?;
    }
    card_settings(parsed, None)?;
    card_template(parsed)?;
    Ok(())
}

/// Refuses image settings that do not go together, or an image format that does not exist.
pub(crate) fn validate_image_options(parsed: &Parsed) -> Result<(), Stop> {
    let format = value(parsed, "image-format");
    let folder = value(parsed, "images-dir").is_some() || value(parsed, "cards-dir").is_some();
    if format.is_some() && !folder {
        return Err(CardOptionError::ImageFormatWithoutFolder.into());
    }
    image_format(parsed)?;
    Ok(())
}

/// The format of page images: png unless --image-format names another.
pub(crate) fn image_format(parsed: &Parsed) -> Result<ImageFormat, Stop> {
    Ok(ImageFormat::parse(value(parsed, "image-format"))?)
}

/// The format of separate card files: the image format given, or PDF without one.
pub(crate) fn card_file_format(parsed: &Parsed) -> Result<Option<ImageFormat>, Stop> {
    if parsed.contains_key("image-format") {
        Ok(Some(image_format(parsed)?))
    } else {
        Ok(None)
    }
}

/// Says that `count` pages were saved as images into `folder`; `what` names them where a command
/// saves more than one kind.
pub(crate) fn saved_pages_notice(
    parsed: &Parsed,
    count: usize,
    folder: &str,
    what: Option<&str>,
) -> Result<(), Stop> {
    let kind = what.map_or_else(String::new, |what| format!("{what} "));
    saved(&format!(
        "Saved {count} {} {kind}pages to: {}",
        image_format(parsed)?.extension().to_uppercase(),
        printable(folder)
    ));
    Ok(())
}

/// Whether the card options may keep the cards from being printed, after refusing at once a QR
/// code on separate cards. Random details come from lists that fit every design: what can fail is a
/// text the person typed.
fn cards_may_fail(parsed: &Parsed, settings: &CardSettings) -> Result<bool, Stop> {
    check_phrase_sheet_qr(settings)?;
    Ok(PROFILE_OPTIONS
        .iter()
        .map(|(_, option)| *option)
        .chain(COPY_OPTIONS)
        .chain(["title"])
        .any(|option| parsed.contains_key(option)))
}

/// Draws the colour cards in `form` in memory, which refuses a detail too long for its card.
fn color_cards_fit(
    drawing: &CardDrawing,
    parsed: &Parsed,
    settings: &CardSettings,
    form: Form,
) -> Result<(), Stop> {
    check_color_cards_fit(
        drawing,
        &mut SystemRandom,
        &ColorCardsCheck {
            template: value(parsed, "template"),
            settings,
            title: value(parsed, "title"),
            form,
            outputs: card_outputs(parsed),
        },
    )?;
    Ok(())
}

/// Refuses colour cards in `form` that cannot be printed with what the person typed. A render takes
/// seconds, so it is not made where nothing can fail.
pub(crate) fn check_cards_fit(
    drawing: &CardDrawing,
    parsed: &Parsed,
    settings: &CardSettings,
    form: Form,
) -> Result<(), Stop> {
    if cards_may_fail(parsed, settings)? {
        terminal::work("Checking that the cards can be printed…");
        color_cards_fit(drawing, parsed, settings, form)?;
    }
    Ok(())
}

/// The same for the menu's card options, as soon as they are typed. It says nothing: the menu's
/// record of answers counts every line it writes.
pub(crate) fn color_cards_fit_of(options: &[String], form: Form) -> Result<(), Stop> {
    let parsed = parse_arguments(options)?;
    let outputs = card_outputs(&parsed);
    if !outputs.sheets && !outputs.cards {
        return Ok(());
    }
    let settings = card_settings(&parsed, None)?;
    if cards_may_fail(&parsed, &settings)? {
        color_cards_fit(&CardDrawing::new(), &parsed, &settings, form)?;
    }
    Ok(())
}

/// Writes one file of an export at `path`.
fn write_file(path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    os::write_new_private_file(path, bytes).map_err(FileError::from)
}

impl From<PdfError> for FileError {
    fn from(error: PdfError) -> Self {
        match error {
            PdfError::Write(error) => error.into(),
            PdfError::Font(_) => step_failed(error),
        }
    }
}

/// A page as a save takes it, between the drawing of the page before and of this one: every page
/// of a card file passes here, a drawing refused being a step of the save that failed.
pub(crate) fn saved_page(page: Result<Page, ExportError>) -> Result<Page, FileError> {
    os::stop_if_signalled()?;
    page.map_err(step_failed)
}

/// Writes `pages` at `base`, without an ending: the PDF, or the image of each page, written as it is
/// drawn and numbered when there are several; how many files it wrote.
pub(crate) fn write_document(
    drawing: &CardDrawing,
    pages: impl Iterator<Item = Result<Page, ExportError>>,
    base: &Path,
    format: Option<ImageFormat>,
) -> Result<usize, FileError> {
    let named = |index: usize, count: usize, extension: &str| {
        PathBuf::from(page_file_name(
            &base.to_string_lossy(),
            index,
            count,
            extension,
        ))
    };
    let mut pages = pages.map(saved_page).peekable();
    let Some(format) = format else {
        let pdf = pdf_of(&drawing.font, pages)?;
        write_file(&named(0, 1, "pdf"), &pdf)?;
        return Ok(1);
    };
    let mut written = 0;
    while let Some(page) = pages.next() {
        let image = page_image(&drawing.font, &page?, format).map_err(step_failed)?;
        // A name tells one page from several: only the first has to look for a next, which is
        // drawn here, once this page is let go.
        let count = if written == 0 && pages.peek().is_none() {
            1
        } else {
            written + 2
        };
        write_file(&named(written, count, format.extension()), &image)?;
        written += 1;
    }
    Ok(written)
}

/// Publishes the PDF of `pages` at `path`, each page written to the staged file as it is drawn.
pub(crate) fn publish_pdf(
    drawing: &CardDrawing,
    pages: impl Iterator<Item = Result<Page, ExportError>>,
    path: &Path,
) -> Result<(), FileError> {
    os::publish_written_file(path, |file| {
        write_pdf(&drawing.font, pages.map(saved_page), file)?;
        Ok(())
    })
}

/// Saves `pages` as images of `format` in the new folder `directory`, each as it is drawn, published
/// together only once every page is written; how many files it wrote.
pub(crate) fn export_page_images(
    drawing: &CardDrawing,
    pages: impl Iterator<Item = Result<Page, ExportError>>,
    directory: &str,
    format: ImageFormat,
) -> Result<usize, FileError> {
    let folder = claimed(directory, folder_taken("images-dir"))?;
    folder.publish(".mnemocode-images-", |staging| {
        write_document(drawing, pages, &staging.join("page"), Some(format))
    })
}

/// Claims the new folder `directory`, refused with `taken` where something is there.
fn claimed(directory: &str, taken: &str) -> Result<Folder, FileError> {
    Folder::claim(
        Path::new(directory),
        terminal::environment().current.as_deref(),
        taken.to_owned(),
    )
}

/// Writes `document` in `folder`; how many files it wrote.
fn write_named(
    drawing: &CardDrawing,
    document: NamedDocument,
    folder: &Path,
    format: Option<ImageFormat>,
) -> Result<usize, FileError> {
    let pages = document.pages.into_iter().map(Ok);
    write_document(drawing, pages, &folder.join(&document.name), format)
}

/// Saves each of `documents`, as it is drawn, in the new folder `directory`; how many files it
/// wrote.
pub(crate) fn export_card_files(
    drawing: &CardDrawing,
    documents: impl Iterator<Item = Result<NamedDocument, ExportError>>,
    directory: &str,
    format: Option<ImageFormat>,
) -> Result<usize, FileError> {
    let folder = claimed(directory, folder_taken("cards-dir"))?;
    folder.publish(".card-collection-", |staging| {
        let mut files = 0;
        for document in documents {
            let document = document.map_err(step_failed)?;
            files += write_named(drawing, document, staging, format)?;
        }
        Ok(files)
    })
}

/// Saves the documents of each share of `set`, as each is drawn, with the share's folder if it has
/// one, in the new folder `directory`; how many files it wrote.
pub(crate) fn export_share_files(
    drawing: &CardDrawing,
    directory: &str,
    format: Option<ImageFormat>,
    set: &ShareCardSet,
) -> Result<usize, FileError> {
    let folder = claimed(directory, folder_taken("cards-dir"))?;
    folder.publish(".sskr-cards-", |staging| {
        let mut files = 0;
        for (place, share) in set.shares().enumerate() {
            let inside = match &share.folder {
                // Private like the staging folder: it holds the cards of one share.
                Some(name) => {
                    let path = staging.join(name);
                    os::make_private_folder(&path)?;
                    path
                }
                None => staging.to_path_buf(),
            };
            for index in 0..share.documents {
                os::stop_if_signalled()?;
                let document = set
                    .document(drawing, &mut SystemRandom, place, index)
                    .map_err(step_failed)?;
                files += write_named(drawing, document, &inside, format)?;
            }
        }
        Ok(files)
    })
}

/// The cards of one export, planned once on the first save, so that its PDF, its page images and
/// its card files show the same cards.
pub(crate) struct PlannedCards {
    job: CardJob,
    planned: Option<CardJob>,
    orientation: Option<Orientation>,
}

impl PlannedCards {
    /// The cards of `job`, the orientation of separate cards being the one the person gave.
    pub(crate) fn new(job: CardJob) -> Self {
        Self {
            orientation: job.cards.settings.orientation,
            job,
            planned: None,
        }
    }

    /// The planned job.
    pub(crate) fn job(&mut self, drawing: &CardDrawing) -> Result<&CardJob, Stop> {
        if self.planned.is_none() {
            let planned = planned_card_job(drawing, &mut SystemRandom, &self.job)?;
            self.planned = Some(planned);
        }
        self.planned.as_ref().ok_or(Stop::Cancelled)
    }

    /// Every real code and one decoy as separate files, turned as the person asked.
    pub(crate) fn separate_job(&mut self, drawing: &CardDrawing) -> Result<CardJob, Stop> {
        let orientation = self.orientation;
        Ok(separate_card_job(self.job(drawing)?, orientation)?)
    }
}

/// `path` beside the sheet `sheet`, named after it, "cards.pdf" giving "cards-qr.png", with `suffix`
/// before "-qr".
fn beside(sheet: &str, suffix: &str) -> PathBuf {
    let path = Path::new(sheet);
    let name = path
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!("{name}{suffix}-qr.png"))
}

/// The image of a QR code that a sheet prints, saved beside the PDF `sheet`, under a free name; the
/// name used, none when skipped.
pub(crate) fn save_qr_beside(
    payload: &str,
    sheet: &str,
    suffix: &str,
) -> Result<Option<String>, Stop> {
    save_qr_at(payload, &beside(sheet, suffix))
}

/// The same inside the sheets' folder, as "qr.png" or "<name>-qr.png".
pub(crate) fn save_qr_inside(
    payload: &str,
    folder: &str,
    name: &str,
) -> Result<Option<String>, Stop> {
    let file = if name.is_empty() {
        "qr.png".to_owned()
    } else {
        format!("{name}-qr.png")
    };
    save_qr_at(payload, &Path::new(folder).join(file))
}

/// `path` without its "." and the folders that a ".." goes back from, as a saved name is shown.
fn normalised(path: &Path) -> PathBuf {
    let mut kept = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir
                if matches!(kept.components().next_back(), Some(Component::Normal(_))) =>
            {
                kept.pop();
            }
            other => kept.push(other),
        }
    }
    kept
}

/// Saves the QR image of `payload` at the first free name from `path`, as every result is saved.
fn save_qr_at(payload: &str, path: &Path) -> Result<Option<String>, Stop> {
    let free = first_free_name(&normalised(path).to_string_lossy())?;
    let image = mnemocode::qr::png(payload)?;
    let mut output = Parsed::new();
    output.insert("qr".to_owned(), Given::One(free));
    let saved_at = save_output(
        &mut output,
        "qr",
        ResultName::one("The QR code of the sheet"),
        |path| os::publish_new_file(&resolved(path), &image),
    )?;
    if saved_at.is_some() {
        report_qr_verified(1);
    }
    Ok(saved_at)
}

/// A printed count of files in a format: PDF where the format is none.
pub(crate) fn format_name(format: Option<ImageFormat>) -> String {
    format.map_or("pdf", ImageFormat::extension).to_uppercase()
}
