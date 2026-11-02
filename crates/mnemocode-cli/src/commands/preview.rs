//! The command `preview` (MnemoCode TS 0.1.0's `cli/preview-command.ts`, CAP-CARDS-SAMPLE-PREVIEW):
//! the list of card designs, and sample cards of one design or of all, saved as the cards of a
//! backup are. The sample phrase comes from the cards crate; this command reads the options and
//! saves the files.

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode_cards::export::{
    CardPreview, CardPreviewOptions, DesignSelection, card_pages, individual_cards,
};
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing, find_template};

use super::cards::{
    BUSINESS_OPTIONS, card_file_format, card_settings, export_card_files, export_page_images,
    image_format, publish_pdf, saved_pages_notice, validate_card_options, validate_image_options,
};
use super::given::{WORD_COUNT_RANGE, card_format_numbers};
use super::resolved;
use crate::args::{Parsed, integer_option, is_on, value};
use crate::gate::Stop;
use crate::os::SystemRandom;
use crate::terminal::result::result_header;
use crate::terminal::{self, Channel, TEXT_WIDTH, paint, printable, saved, style, wrap_text};

/// The options `preview` takes.
pub(crate) const OPTIONS: [&str; 24] = [
    "list",
    "all",
    "pdf",
    "cards-dir",
    "template",
    "title",
    "words",
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

/// The refusals of the command.
#[derive(Debug)]
enum PreviewError {
    ListWithSettings,
    NoOutput,
    AllAndOne,
}

impl fmt::Display for PreviewError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ListWithSettings => {
                "Template listing cannot be combined with preview output settings."
            }
            Self::NoOutput => {
                "To save a preview, provide a PDF file, an image output folder, or an individual-card output folder. To inspect the available designs, request the template list."
            }
            Self::AllAndOne => "Choose either all templates or one specific template, not both.",
        })
    }
}

impl std::error::Error for PreviewError {}

impl Refusal for PreviewError {
    fn code(&self) -> &'static str {
        match self {
            Self::ListWithSettings => {
                "cli.preview-command.template-listing-cannot-combined-preview-output-settings"
            }
            Self::NoOutput => {
                "cli.preview-command.save-preview-provide-pdf-file-image-output-folder"
            }
            Self::AllAndOne => {
                "cli.preview-command.choose-either-all-templates-one-specific-template-not"
            }
        }
    }
}

/// The card templates, each with its number. At a terminal the description is running text, wrapped
/// under the id; a file or a pipe gets one line per template.
fn print_template_list() {
    let print = terminal::result_line;
    let on_terminal = result_header(
        "Card templates",
        &[
            ("Installed", CARD_TEMPLATES.len().to_string()),
            ("Prints", format!("format {}", card_format_numbers())),
        ],
        Channel::Output,
    );
    let number_width = CARD_TEMPLATES.len().to_string().len();
    let id_width = CARD_TEMPLATES
        .iter()
        .map(|one| one.id.len())
        .max()
        .unwrap_or(0);
    let name_width = CARD_TEMPLATES
        .iter()
        .map(|one| one.name().chars().count())
        .max()
        .unwrap_or(0);
    // The description starts under the id: after the number and the two spaces that follow it.
    let indent = " ".repeat(number_width + 2);
    for (index, template) in CARD_TEMPLATES.iter().enumerate() {
        let (number, id, name) = (index + 1, template.id, template.name());
        if !on_terminal {
            print(&format!(
                "{number:>number_width$}  {id:<id_width$}   {name:<name_width$}   {}",
                template.description()
            ));
            continue;
        }
        print(&format!(
            "{number:>number_width$}  {id:<id_width$}   {name}"
        ));
        for line in wrap_text(&template.description(), TEXT_WIDTH - indent.len()) {
            let line = paint(Channel::Output, style::MUTED, &line);
            print(&format!("{indent}{line}"));
        }
    }
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let path = value(parsed, "pdf");
    let directory = value(parsed, "cards-dir");
    let images = value(parsed, "images-dir");
    let id = value(parsed, "template");
    let every = is_on(parsed, "all");
    if is_on(parsed, "list") {
        let chosen = [
            "images-dir",
            "image-format",
            "pdf",
            "cards-dir",
            "template",
            "all",
            "title",
            "words",
        ];
        if chosen
            .iter()
            .chain(&BUSINESS_OPTIONS)
            .any(|key| parsed.contains_key(*key))
        {
            return Err(PreviewError::ListWithSettings.into());
        }
        print_template_list();
        return Ok(());
    }
    if path.is_none() && directory.is_none() && images.is_none() {
        return Err(PreviewError::NoOutput.into());
    }
    if every && id.is_some() {
        return Err(PreviewError::AllAndOne.into());
    }
    let selection = if every {
        DesignSelection::Every
    } else {
        DesignSelection::One(id)
    };
    if directory.is_some() {
        CardPreview::check_one_design(selection)?;
        validate_card_options(parsed, mnemocode::forms::Form::Colors)?;
    }
    validate_image_options(parsed)?;
    let template = if every { None } else { find_template(id) };
    let settings = card_settings(parsed, template)?;
    let words = value(parsed, "words")
        .map(|_| integer_option(parsed, "words", WORD_COUNT_RANGE, None, None))
        .transpose()?
        .map(|words| words as usize);
    let mut random = SystemRandom;
    let preview = CardPreview::new(
        &mut random,
        CardPreviewOptions {
            words,
            settings,
            title: value(parsed, "title").map(str::to_owned),
            color_form: None,
        },
    )?;
    let drawing = CardDrawing::new();
    let jobs = preview.jobs(selection)?;
    if let Some(directory) = directory {
        let job = &jobs[0];
        let cards = individual_cards(&drawing, &mut random, job.template, &job.cards)?;
        let format = card_file_format(parsed)?;
        let count = export_card_files(&drawing, cards, directory, format)?;
        saved(&format!(
            "Saved {count} individual card preview files to: {}",
            printable(directory)
        ));
    }
    if let Some(path) = path {
        let pages = card_pages(&drawing, &mut random, &jobs)?;
        publish_pdf(&drawing, pages, &resolved(path))?;
        let templates = if jobs.len() == 1 {
            "template"
        } else {
            "templates"
        };
        saved(&format!(
            "Saved preview PDF ({} {templates}): {}",
            jobs.len(),
            printable(path)
        ));
    }
    if let Some(images) = images {
        let pages = card_pages(&drawing, &mut random, &jobs)?;
        let count = export_page_images(&drawing, pages, images, image_format(parsed)?)?;
        saved_pages_notice(parsed, count, images, Some("preview"))?;
    }
    Ok(())
}
