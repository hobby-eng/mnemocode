//! What a host saves (MnemoCode TS 0.1.0's `export/render.ts`, `sskr-render.ts` and
//! `card-preview.ts`, CAP-CARDS-RENDER-SHEETS-PDF, CAP-CARDS-INDIVIDUAL-CARDS,
//! CAP-CARDS-SHARE-CARD-SET, CAP-CARDS-SAMPLE-PREVIEW): the pages of the cards of a backup, of the
//! cards of each share, and of sample cards, as a PDF or as page images; the host writes the files.
//!
//! An export's pages are drawn one at a time, as an iterator asks for them: a page holds the artwork
//! of its cards, and a set of shares would not fit the memory cap of a command all at once. A host
//! that must be able to stop puts its check between the pages with `map`: an error it gives there
//! ends the iterator's consumer, [`pdf_of`] or the host's own loop over [`crate::raster::page_image`].

use std::fmt;
use std::io::Write;
use std::ops::Range;

use mnemocode::backup::{Backup, BackupError};
use mnemocode::bip39::phrase::{Phrase, PhraseError};
use mnemocode::bip39::sizes::{WORD_COUNTS, entropy_bytes, is_word_count, word_counts_text};
use mnemocode::dates::{Date, DatesError, parse_date};
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::random::{Random, RandomError};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretBytes;
#[cfg(feature = "sskr")]
use mnemocode::self_check::vectors::LONG_SHARES;
#[cfg(feature = "sskr")]
use mnemocode::sskr::forms::ShareFormat;
#[cfg(feature = "sskr")]
use mnemocode::sskr::set::{SetError, read_set};
#[cfg(feature = "sskr")]
use mnemocode::sskr::share::{Share, TransportError};

#[cfg(feature = "sskr")]
use crate::content::{CardCodes, SskrLayout};
use crate::content::{
    ColorCards, ContentError, ContentKind, EMPTY_CARD_COLLECTION, backup_card_content,
    separate_card_name,
};
use crate::details::ExportDetails;
#[cfg(feature = "sskr")]
use crate::palette::code_colors;
use crate::pdf::{PdfError, PdfPages};
use crate::plan::with_planned_decoys;
use crate::raster::RasterError;
use crate::scene::{Page, UiFont};
use crate::settings::{
    CardSettings, Orientation, PageSize, SettingsError, check_separate_card_size,
};
use crate::templates::{CardDrawing, CardTemplate, TemplateError, select_template, sheets_only};
#[cfg(feature = "sskr")]
use crate::text_rules::card_title;

/// The name of a file of sample cards, before what each front end adds.
pub const SAMPLE_FILE_BASE: &str = "mnemocode-preview";
/// Why separate sample cards of every design are refused: their folder shows one design.
pub const ONE_DESIGN_FOR_SEPARATE_CARDS: &str =
    "Separate sample cards show one design: choose one design.";
/// The length of the sample phrase when none is chosen: the shortest.
pub const DEFAULT_SAMPLE_WORDS: usize = WORD_COUNTS[0];
/// The longest sample phrase, BIP39's longest: the most codes, and cards, that a backup prints.
pub const LONGEST_SAMPLE_WORDS: usize = WORD_COUNTS[WORD_COUNTS.len() - 1];
/// The fixed public dates that the sample phrase is masked with.
const SAMPLE_DATES: [&str; 4] = ["31-10-2008", "03-01-2009", "12-01-2009", "22-05-2010"];
/// Why content cannot be drawn as separate cards.
const NO_INDIVIDUAL_CARDS: &str = "Only color codes are drawn as individual business cards.";

/// What an export refuses.
#[derive(Debug)]
pub enum ExportError {
    /// No design was given.
    NoCards,
    /// A design of another kind than its content; the design's id.
    NotSupported(&'static str),
    /// A design without separate cards, in the words of the refusal.
    SheetsOnly(String),
    /// Content that is drawn on sheets only.
    NoIndividualCards,
    /// No card at all.
    Empty,
    /// A place of no share.
    NoShare,
    /// Separate cards of a QR card.
    QrCards,
    /// Share cards that cannot be printed for every seed phrase; the refusal's own text.
    NotPrintable(String),
    /// A sample phrase of no length.
    SampleWords,
    /// Colour cards in a form they are not written in; its name.
    NoColourCards(&'static str),
    /// Separate sample cards of every design.
    OneDesign,
    /// What the design refuses.
    Template(TemplateError),
    /// What the content of the cards refuses.
    Content(ContentError),
    /// What the settings refuse.
    Settings(SettingsError),
    /// What the PDF refuses.
    Pdf(PdfError),
    /// What the images refuse.
    Raster(RasterError),
    /// What the backup refuses.
    Backup(BackupError),
    /// What the sample phrase refuses.
    Phrase(PhraseError),
    /// What the dates refuse.
    Date(DatesError),
    /// The random source.
    Random(RandomError),
    /// What the shares of a set refuse.
    #[cfg(feature = "sskr")]
    Set(SetError),
    /// What the text of a share refuses.
    #[cfg(feature = "sskr")]
    Transport(TransportError),
}

impl fmt::Display for ExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoCards => f.write_str("No cards to render: no design was given."),
            Self::NotSupported(id) => write!(f, "Template {id} does not support sskr."),
            Self::SheetsOnly(text) => f.write_str(text),
            Self::NoIndividualCards => f.write_str(NO_INDIVIDUAL_CARDS),
            Self::Empty => f.write_str(EMPTY_CARD_COLLECTION),
            Self::NoShare => f.write_str("There is no share at that place in the set."),
            Self::QrCards => f.write_str(
                "A whole-share QR card cannot become individual fragments. Start with a collection sheet.",
            ),
            Self::NotPrintable(text) => write!(
                f,
                "These share cards cannot be printed for every seed phrase, the longest of {LONGEST_SAMPLE_WORDS} words included: {text}"
            ),
            Self::SampleWords => write!(
                f,
                "The preview mnemonic must contain {} words.",
                word_counts_text()
            ),
            Self::NoColourCards(form) => write!(f, "Colour cards are not written as {form}."),
            Self::OneDesign => f.write_str(ONE_DESIGN_FOR_SEPARATE_CARDS),
            Self::Template(error) => error.fmt(f),
            Self::Content(error) => error.fmt(f),
            Self::Settings(error) => error.fmt(f),
            Self::Pdf(error) => error.fmt(f),
            Self::Raster(error) => error.fmt(f),
            Self::Backup(error) => error.fmt(f),
            Self::Phrase(error) => error.fmt(f),
            Self::Date(error) => error.fmt(f),
            Self::Random(error) => error.fmt(f),
            #[cfg(feature = "sskr")]
            Self::Set(error) => error.fmt(f),
            #[cfg(feature = "sskr")]
            Self::Transport(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ExportError {}

impl Refusal for ExportError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoCards => "export.render.no-cards-to-render",
            Self::NotSupported(_) => "export.render.template-does-not-support",
            Self::SheetsOnly(_) => "export.render.assert-individual-template-refused",
            Self::NoIndividualCards => "export.render.no-individual-cards",
            Self::Empty => "export.render.empty-card-collection",
            Self::NoShare => "export.sskr-render.there-no-share-at-place-set",
            Self::QrCards => "export.sskr-render.qr-cards-cannot-become-fragments",
            Self::NotPrintable(_) => {
                "export.sskr-render.share-cards-cannot-printed-every-seed-phrase-longest"
            }
            Self::SampleWords => "export.card-preview.preview-mnemonic-contain-words",
            Self::NoColourCards(_) => "export.card-preview.colour-cards-not-written-as",
            Self::OneDesign => "export.card-preview.one-design-separate-cards",
            Self::Template(error) => error.code(),
            Self::Content(error) => error.code(),
            Self::Settings(error) => error.code(),
            Self::Pdf(error) => error.code(),
            Self::Raster(error) => error.code(),
            Self::Backup(error) => error.code(),
            Self::Phrase(error) => error.code(),
            Self::Date(error) => error.code(),
            Self::Random(error) => error.code(),
            #[cfg(feature = "sskr")]
            Self::Set(error) => error.code(),
            #[cfg(feature = "sskr")]
            Self::Transport(error) => error.code(),
        }
    }
}

macro_rules! from_error {
    ($($(#[$meta:meta])* $error:ty => $variant:ident),+ $(,)?) => {
        $($(#[$meta])* impl From<$error> for ExportError {
            fn from(error: $error) -> Self {
                Self::$variant(error)
            }
        })+
    };
}

from_error!(
    TemplateError => Template,
    ContentError => Content,
    SettingsError => Settings,
    PdfError => Pdf,
    RasterError => Raster,
    BackupError => Backup,
    PhraseError => Phrase,
    DatesError => Date,
    RandomError => Random,
    #[cfg(feature = "sskr")]
    SetError => Set,
    #[cfg(feature = "sskr")]
    TransportError => Transport,
);

/// One card output: the design that draws it and the content it draws.
#[derive(Clone, Debug)]
pub struct CardJob {
    /// The design.
    pub template: &'static CardTemplate,
    /// The codes, the settings and the texts that the design draws; its decoys once planned.
    pub cards: ColorCards,
}

/// One document of an export: its pages, and the name of its file without the extension.
#[derive(Clone, Debug)]
pub struct NamedDocument {
    /// The name of its file, such as collection-376C-1-2 or 03.
    pub name: String,
    /// Its pages.
    pub pages: Vec<Page>,
}

/// `cards` with the decoys that `template` plans for them.
fn planned_content(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    template: &CardTemplate,
    cards: &ColorCards,
    separate: bool,
) -> Result<ColorCards, ExportError> {
    Ok(with_planned_decoys(
        template, drawing, random, cards, separate,
    )?)
}

/// `job` with the decoys that its template plans: for separate cards where its page has a card
/// size. A host that saves one export in several files plans it once and passes it to each, so that
/// every file shows the same cards.
pub fn planned_card_job(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    job: &CardJob,
) -> Result<CardJob, ExportError> {
    let separate = job.cards.settings.page_size == Some(PageSize::Business);
    Ok(CardJob {
        template: job.template,
        cards: planned_content(drawing, random, job.template, &job.cards, separate)?,
    })
}

/// `job`, planned for a sheet, as separate cards draw it: every real code and one decoy kept, its
/// orientation the one the person gave, never the one the sheet plan chose.
pub fn separate_card_job(
    job: &CardJob,
    orientation: Option<Orientation>,
) -> Result<CardJob, ExportError> {
    let mut cards = if job.cards.decoys.unwrap_or(0) == 0 {
        job.cards.clone()
    } else {
        job.cards.kept_individual()?
    };
    cards.settings.orientation = orientation;
    Ok(CardJob {
        template: job.template,
        cards,
    })
}

/// Refuses a template that draws no separate cards: also before any content exists. `named`: the
/// design is one of several drawn together, and the refusal names it.
pub fn check_individual_template(template: &CardTemplate, named: bool) -> Result<(), ExportError> {
    if template.draws_separate_cards() {
        return Ok(());
    }
    let design = if named {
        format!("The design \"{}\"", template.name())
    } else {
        "This design".to_owned()
    };
    Err(ExportError::SheetsOnly(sheets_only(&design)))
}

/// Refuses what cannot be drawn as separate cards: a template without them, content that is no
/// colors, no card at all, colors that are not the backup its QR code holds, or a sheet size.
pub fn check_individual_cards(
    template: &CardTemplate,
    cards: &ColorCards,
) -> Result<(), ExportError> {
    check_individual_template(template, false)?;
    if cards.kind != ContentKind::Colors {
        return Err(ExportError::NoIndividualCards);
    }
    if cards.codes.colors.is_empty() {
        return Err(ExportError::Empty);
    }
    cards.check()?;
    check_separate_card_size(cards.settings.page_size)?;
    Ok(())
}

/// `cards` with the details of the export, a design's own over those of the export.
fn with_details(cards: &ColorCards, details: &ExportDetails) -> Result<ColorCards, ExportError> {
    let mut resolved = cards.clone();
    resolved.settings.presentation = Some(match &cards.settings.presentation {
        Some(given) => crate::details::checked_presentation(given)?,
        None => details.presentation.clone(),
    });
    resolved.settings.profile = details.profile.overlaid(&cards.settings.profile);
    Ok(resolved)
}

/// `cards` as separate cards draw them, refused as [`check_individual_cards`] refuses them: their
/// details settled for `template`, their decoys planned.
fn planned_individual(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    template: &CardTemplate,
    cards: &ColorCards,
) -> Result<ColorCards, ExportError> {
    check_individual_cards(template, cards)?;
    let details = ExportDetails::of(random, &cards.settings, template.sector())?;
    let mut resolved = cards.clone();
    resolved.settings.presentation = Some(details.presentation);
    resolved.settings.profile = details.profile;
    planned_content(drawing, random, template, &resolved, true)
}

/// One document per card, all sharing one identity, each drawn as the iterator asks for it.
pub fn individual_cards<'a>(
    drawing: &'a CardDrawing,
    random: &'a mut dyn Random,
    template: &'a CardTemplate,
    cards: &ColorCards,
) -> Result<impl Iterator<Item = Result<NamedDocument, ExportError>> + use<'a>, ExportError> {
    let planned = planned_individual(drawing, random, template, cards)?;
    Ok((0..planned.codes.colors.len()).map(move |index| {
        Ok(NamedDocument {
            name: separate_card_name(index),
            pages: vec![template.draw(drawing, random, &planned, Some(index), 0)?],
        })
    }))
}

/// [`individual_cards`] all drawn, for a host that keeps them.
pub fn render_individual_cards(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    template: &CardTemplate,
    cards: &ColorCards,
) -> Result<Vec<NamedDocument>, ExportError> {
    individual_cards(drawing, random, template, cards)?.collect()
}

/// Whether `cards` are drawn as separate cards: a card size gives one page per card.
fn separate_page_size(cards: &ColorCards) -> bool {
    cards.kind == ContentKind::Colors && cards.settings.page_size == Some(PageSize::Business)
}

/// The planned cards of one job and which of them are still to be drawn: a sheet, or separate cards.
struct JobPages {
    template: &'static CardTemplate,
    cards: ColorCards,
    separate: bool,
    left: Range<usize>,
}

/// The pages of jobs, one person and one set of texts for every design, the employer suiting the
/// first, each drawn as the iterator asks for it: see [`card_pages`].
pub struct CardPages<'a> {
    drawing: &'a CardDrawing,
    random: &'a mut dyn Random,
    jobs: std::slice::Iter<'a, CardJob>,
    details: ExportDetails,
    job: Option<JobPages>,
}

impl CardPages<'_> {
    /// `job` with its cards planned, which draws from the random source in the order of the jobs.
    fn job_pages(&mut self, job: &CardJob) -> Result<JobPages, ExportError> {
        let template = job.template;
        if job.cards.kind != ContentKind::Colors {
            return Err(ExportError::NotSupported(template.id));
        }
        // A design's own texts and details print over those of the export.
        let resolved = with_details(&job.cards, &self.details)?;
        resolved.check_sheet_qr()?;
        if separate_page_size(&resolved) {
            let cards = planned_individual(self.drawing, self.random, template, &resolved)?;
            let left = 0..cards.codes.colors.len();
            return Ok(JobPages {
                template,
                cards,
                separate: true,
                left,
            });
        }
        let mut cards = planned_content(self.drawing, self.random, template, &resolved, false)?;
        // Without a page size every template uses the A6 sheet.
        cards.settings.page_size = Some(PageSize::resolve(cards.settings.page_size, false));
        Ok(JobPages {
            template,
            cards,
            separate: false,
            left: 0..1,
        })
    }
}

impl Iterator for CardPages<'_> {
    type Item = Result<Page, ExportError>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(job) = &mut self.job
                && let Some(index) = job.left.next()
            {
                let fragment = job.separate.then_some(index);
                let page = job
                    .template
                    .draw(self.drawing, self.random, &job.cards, fragment, 0);
                return Some(page.map_err(ExportError::from));
            }
            let job = self.jobs.next()?;
            match self.job_pages(job) {
                Ok(pages) => self.job = Some(pages),
                Err(refusal) => return Some(Err(refusal)),
            }
        }
    }
}

/// The pages of `jobs`: a sheet size gives one page per template, a card size one page per card.
/// Preview and encode share this path; no simplified preview renderer exists. What can be refused
/// before anything is drawn is refused here, the rest by the page that it stops.
pub fn card_pages<'a>(
    drawing: &'a CardDrawing,
    random: &'a mut dyn Random,
    jobs: &'a [CardJob],
) -> Result<CardPages<'a>, ExportError> {
    let Some(first) = jobs.first() else {
        return Err(ExportError::NoCards);
    };
    for job in jobs {
        if separate_page_size(&job.cards) {
            check_individual_template(job.template, jobs.len() > 1)?;
        }
    }
    let details = ExportDetails::of(random, &first.cards.settings, first.template.sector())?;
    Ok(CardPages {
        drawing,
        random,
        jobs: jobs.iter(),
        details,
        job: None,
    })
}

/// [`card_pages`] all drawn, for a host that keeps them.
pub fn render_cards(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    jobs: &[CardJob],
) -> Result<Vec<Page>, ExportError> {
    card_pages(drawing, random, jobs)?.collect()
}

/// Writes the PDF of `pages` to `sink`, without metadata: each is drawn as this asks for it and let
/// go once it is written. The first error of `pages` ends it, which gives a host its place to stop,
/// and the sink holds part of a file then. A file of a set of shares takes hundreds of megabytes,
/// which only a sink on disk keeps out of memory.
pub fn write_pdf<E: From<PdfError>, W: Write>(
    font: &UiFont,
    pages: impl IntoIterator<Item = Result<Page, E>>,
    sink: W,
) -> Result<W, E> {
    let mut pdf = PdfPages::new(sink)?;
    for page in pages {
        pdf.add(&page?)?;
    }
    Ok(pdf.finish(font)?)
}

/// The PDF of `pages` in memory, as [`write_pdf`] writes it: for what fits there.
pub fn pdf_of<E: From<PdfError>>(
    font: &UiFont,
    pages: impl IntoIterator<Item = Result<Page, E>>,
) -> Result<SecretBytes, E> {
    let file = write_pdf(font, pages, Vec::new())?;
    Ok(SecretBytes::large("a card document", file))
}

/// The designs of a preview.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesignSelection<'a> {
    /// Every installed design, in the order of the list.
    Every,
    /// One design: by its id or number, or the first.
    One(Option<&'a str>),
}

/// What a set of sample cards is drawn with.
#[derive(Clone, Debug, Default)]
pub struct CardPreviewOptions {
    /// The words of the sample phrase; 12 by default.
    pub words: Option<usize>,
    /// The page, the profile and the texts of the cards, as for a real export.
    pub settings: CardSettings,
    /// The title of the sheet, where a design shows one.
    pub title: Option<String>,
    /// The form of the codes of colour cards, which their QR code holds: colors by default.
    pub color_form: Option<Form>,
}

/// Sample cards of the installed designs: a sample phrase made for them, with the host's
/// randomness, masked with public dates, so that a person can see the designs before writing a
/// real backup.
#[derive(Debug)]
pub struct CardPreview {
    cards: ColorCards,
}

impl CardPreview {
    /// Draws a sample phrase of the length of `options`, masks it and builds its cards.
    pub fn new(random: &mut dyn Random, options: CardPreviewOptions) -> Result<Self, ExportError> {
        let words = options.words.unwrap_or(DEFAULT_SAMPLE_WORDS);
        if !is_word_count(words) {
            return Err(ExportError::SampleWords);
        }
        let form = options.color_form.unwrap_or(Form::Colors);
        if !form.has_cards() {
            return Err(ExportError::NoColourCards(form.name()));
        }
        let mut entropy = SecretBytes::zeroed("a sample phrase's entropy", entropy_bytes(words));
        for byte in entropy.iter_mut() {
            *byte = random.below(256)? as u8;
        }
        let phrase = Phrase::of_entropy(&entropy)?;
        let dates = SAMPLE_DATES
            .iter()
            .map(|date| parse_date(date))
            .collect::<Result<Vec<Date>, _>>()?;
        let encoding = Backup::encode(&phrase, &dates, form, Mode::Seedshift, false)?;
        let cards =
            backup_card_content(&encoding.backup, options.settings, options.title.as_deref())?;
        Ok(Self { cards })
    }

    /// The design that `id` names with the sample cards.
    pub fn job(&self, id: Option<&str>) -> Result<CardJob, ExportError> {
        Ok(CardJob {
            template: select_template(id)?,
            cards: self.cards.clone(),
        })
    }

    /// The designs of `selection` with the sample cards, in the order of the installed list.
    pub fn jobs(&self, selection: DesignSelection<'_>) -> Result<Vec<CardJob>, ExportError> {
        match selection {
            DesignSelection::One(id) => Ok(vec![self.job(id)?]),
            DesignSelection::Every => Ok(crate::templates::CARD_TEMPLATES
                .iter()
                .map(|template| CardJob {
                    template,
                    cards: self.cards.clone(),
                })
                .collect()),
        }
    }

    /// Refuses separate sample cards of every design: a folder of separate cards shows one.
    pub const fn check_one_design(selection: DesignSelection<'_>) -> Result<(), ExportError> {
        match selection {
            DesignSelection::Every => Err(ExportError::OneDesign),
            DesignSelection::One(_) => Ok(()),
        }
    }

    /// Draws in memory the colour cards of `id` as a save would, its sheets or its separate cards or
    /// both, and refuses why they cannot be drawn; nothing is written.
    pub fn check_colors_print(
        &self,
        drawing: &CardDrawing,
        random: &mut dyn Random,
        id: Option<&str>,
        (sheets, separate): (bool, bool),
    ) -> Result<(), ExportError> {
        let job = self.job(id)?;
        if sheets {
            render_cards(drawing, random, std::slice::from_ref(&job))?;
        }
        if separate {
            render_individual_cards(drawing, random, job.template, &job.cards)?;
        }
        Ok(())
    }
}

/// How the cards of shares are drawn.
#[cfg(feature = "sskr")]
#[derive(Clone, Debug)]
pub struct ShareCardOptions {
    /// The design of the cards.
    pub template: &'static CardTemplate,
    /// The layout; none: decided by the page size.
    pub layout: Option<SskrLayout>,
    /// The form of the shares: colors, or Unicode codes, which the cards print, one to a card.
    pub share_format: ShareFormat,
    /// The title of each share's sheet, where a design shows one, in place of the studio name.
    pub title: Option<String>,
    /// The page, the profile and the texts of the cards.
    pub settings: CardSettings,
}

/// One share of the set, as its cards are made.
#[cfg(feature = "sskr")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareCardShare {
    /// The share's reference printed on its cards, such as 376C-1-2.
    pub reference: String,
    /// The base name of the share's output, such as collection-376C-1-2.
    pub name: String,
    /// How many documents its cards take: one per card for separate cards, otherwise one.
    pub documents: usize,
    /// The folder that keeps its fragments together, none when the share is one document.
    pub folder: Option<String>,
}

/// The QR code that the sheets of one share print.
#[cfg(feature = "sskr")]
#[derive(Clone)]
pub struct ShareQrCode {
    /// The share's reference.
    pub reference: String,
    /// The base name of the share's output, which its image is named after.
    pub name: String,
    /// The text the code holds: the share in its written form.
    pub payload: String,
}

/// One share's place in a set of cards.
#[cfg(feature = "sskr")]
#[derive(Clone, Debug)]
struct Member {
    share: ShareCardShare,
    member_index: usize,
    cards: ColorCards,
}

/// The reference that the cards of `share` print: its set, group and member, such as 4BBF-1-2.
#[cfg(feature = "sskr")]
#[must_use]
pub fn share_reference(share: &Share) -> String {
    let info = share.info();
    format!(
        "{:04X}-{}-{}",
        info.identifier,
        info.group_index + 1,
        info.member_index + 1
    )
}

/// What the cards of a share in `format` print, before their decoys: its colors, which are the
/// share, in a color form; in Unicode codes its codes, one to a card, with a color for each
/// distinct code that only decorates it. The QR code holds the share as written.
#[cfg(feature = "sskr")]
pub fn share_card_codes(share: &Share, format: ShareFormat) -> Result<CardCodes, ExportError> {
    let payload = format.write(share).as_str().to_owned();
    if format.is_color() {
        let colors = ShareFormat::Colors.write(share);
        let colors = colors.as_str().split(' ').map(str::to_owned).collect();
        return Ok(CardCodes {
            colors,
            labels: None,
            payload,
        });
    }
    let labels: Vec<String> = payload.split(' ').map(str::to_owned).collect();
    let colors = code_colors(&labels).map_err(ContentError::from)?;
    Ok(CardCodes {
        colors,
        labels: Some(labels),
        payload,
    })
}

/// How many cards of the share `record` print its own codes in `format`, before the decoys: what
/// the sheet for heirs tells; none where the form has no cards.
#[cfg(feature = "sskr")]
pub fn own_share_cards(record: &str, format: ShareFormat) -> Result<Option<usize>, ExportError> {
    if !format.has_cards() {
        return Ok(None);
    }
    let read = mnemocode::sskr::forms::read_share(record)
        .map_err(|error| ExportError::Content(error.into()))?;
    Ok(Some(share_card_codes(&read.share, format)?.colors.len()))
}

/// The cards of one set of shares: the options, the shares, the invented details and the decoys are
/// checked and settled once, and every document rendered from it belongs to the same set. It
/// renders on request and keeps no rendered document.
#[cfg(feature = "sskr")]
#[derive(Debug)]
pub struct ShareCardSet {
    template: &'static CardTemplate,
    layout: SskrLayout,
    members: Vec<Member>,
}

#[cfg(feature = "sskr")]
impl ShareCardSet {
    /// Checks the layout, the title, the form and the shares, settles the details of the cards and
    /// plans the decoys after each share's codes. The details first, then the shares: the order in
    /// which the random choices are made.
    pub fn create<S: AsRef<str>>(
        drawing: &CardDrawing,
        random: &mut dyn Random,
        records: &[S],
        requested: &ShareCardOptions,
    ) -> Result<Self, ExportError> {
        let title = requested
            .title
            .as_deref()
            .map(card_title)
            .transpose()
            .map_err(ContentError::from)?;
        let format = requested.share_format;
        format.check_has_cards()?;
        let settings = &requested.settings;
        let layout = SskrLayout::resolved(requested.layout, settings.page_size)?;
        layout.check_qr(settings)?;
        let template = requested.template;
        if layout.separate_cards() && !template.draws_separate_cards() {
            return Err(TemplateError::SheetsOnly.into());
        }
        let mut options = settings.clone();
        // Sheets are A6 when no size is given, in every design, as ordinary cards are; separate
        // cards have the business size.
        if options.page_size.is_none() && !layout.separate_cards() {
            options.page_size = Some(PageSize::A6);
        }
        let details = ExportDetails::of(random, &options, template.sector())?;
        let shares = read_set(records, false)?;
        let mut members = Vec::with_capacity(shares.len());
        for read in &shares {
            let reference = share_reference(&read.share);
            let mut settings = options.clone();
            settings.presentation = Some(details.presentation.clone());
            settings.profile = details.profile.clone();
            settings.card_qr = layout.whole_share_qr() || options.card_qr;
            let cards = ColorCards {
                kind: ContentKind::Sskr,
                codes: share_card_codes(&read.share, format)?,
                decoys: None,
                title: title.clone(),
                reference: Some(reference.clone()),
                qr_card: layout.whole_share_qr(),
                settings,
            };
            let separate = layout.separate_cards();
            let cards = planned_content(drawing, random, template, &cards, separate)?;
            let name = format!("collection-{reference}");
            members.push(Member {
                share: ShareCardShare {
                    reference,
                    documents: if separate {
                        cards.codes.colors.len()
                    } else {
                        1
                    },
                    folder: separate.then(|| name.clone()),
                    name,
                },
                member_index: read.share.info().member_index,
                cards,
            });
        }
        Ok(Self {
            template,
            layout,
            members,
        })
    }

    /// A retained collection or individual set as separate business cards: every real code and its
    /// first decoy, with the same colors, identities and share references. Only the requested page
    /// size and orientation apply; the sheet's orientation is not inherited.
    pub fn for_individual_cards(
        &self,
        page_size: Option<PageSize>,
        orientation: Option<Orientation>,
    ) -> Result<Self, ExportError> {
        if self.layout.whole_share_qr() {
            return Err(ExportError::QrCards);
        }
        if !self.template.draws_separate_cards() {
            return Err(TemplateError::SheetsOnly.into());
        }
        check_separate_card_size(page_size)?;
        let mut members = Vec::with_capacity(self.members.len());
        for member in &self.members {
            let mut cards = member.cards.kept_individual()?;
            cards.settings.page_size = Some(PageSize::resolve(page_size, true));
            cards.settings.orientation = orientation;
            cards.settings.card_qr = false;
            cards.qr_card = false;
            let mut share = member.share.clone();
            share.documents = cards.codes.colors.len();
            share.folder = Some(share.name.clone());
            members.push(Member {
                share,
                member_index: member.member_index,
                cards,
            });
        }
        Ok(Self {
            template: self.template,
            layout: SskrLayout::Individual,
            members,
        })
    }

    /// The layout the set resolved to, so that a host packs the documents as they were made.
    #[must_use]
    pub const fn layout(&self) -> SskrLayout {
        self.layout
    }

    /// The shares, in the order they were given.
    pub fn shares(&self) -> impl Iterator<Item = &ShareCardShare> {
        self.members.iter().map(|member| &member.share)
    }

    /// The QR codes that the sheets print, one for each share: none for separate cards.
    #[must_use]
    pub fn qr_codes(&self) -> Vec<ShareQrCode> {
        self.members
            .iter()
            .filter(|member| member.cards.settings.card_qr)
            .map(|member| ShareQrCode {
                reference: member.share.reference.clone(),
                name: member.share.name.clone(),
                payload: member.cards.codes.payload.clone(),
            })
            .collect()
    }

    fn member(&self, place: usize) -> Result<&Member, ExportError> {
        self.members.get(place).ok_or(ExportError::NoShare)
    }

    /// What the cards of the share at `place` print, in order, one code to a card.
    pub fn printed_codes(&self, place: usize) -> Result<Vec<String>, ExportError> {
        let codes = &self.member(place)?.cards.codes;
        Ok((0..codes.colors.len())
            .map(|index| codes.printed(index))
            .collect())
    }

    /// How many cards of the share at `place` print the share's own codes, before the decoys.
    pub fn own_codes(&self, place: usize) -> Result<usize, ExportError> {
        Ok(self.member(place)?.cards.own()?)
    }

    /// The page of the document `index` of `member`: a separate card, a sheet or a QR card.
    fn page(
        &self,
        drawing: &CardDrawing,
        random: &mut dyn Random,
        member: &Member,
        index: usize,
    ) -> Result<Page, ExportError> {
        // On QR cards the mixed style starts each share's sheet at another design, by its member.
        let offset = if self.layout.design_by_member() {
            member.member_index
        } else {
            0
        };
        let fragment = self.layout.separate_cards().then_some(index);
        Ok(self
            .template
            .draw(drawing, random, &member.cards, fragment, offset)?)
    }

    /// The document `index` of the share at `place`.
    pub fn document(
        &self,
        drawing: &CardDrawing,
        random: &mut dyn Random,
        place: usize,
        index: usize,
    ) -> Result<NamedDocument, ExportError> {
        let member = self.member(place)?;
        let name = if member.share.folder.is_some() {
            separate_card_name(index)
        } else {
            member.share.name.clone()
        };
        Ok(NamedDocument {
            name,
            pages: vec![self.page(drawing, random, member, index)?],
        })
    }

    /// Every page of the share at `place` and of no other share.
    pub fn render_share(
        &self,
        drawing: &CardDrawing,
        random: &mut dyn Random,
        place: usize,
    ) -> Result<Vec<Page>, ExportError> {
        let member = self.member(place)?;
        (0..member.share.documents)
            .map(|index| self.page(drawing, random, member, index))
            .collect()
    }

    /// Every page of every share, in the order they were given, each drawn as the iterator asks
    /// for it.
    pub fn pages<'a>(
        &'a self,
        drawing: &'a CardDrawing,
        random: &'a mut dyn Random,
    ) -> impl Iterator<Item = Result<Page, ExportError>> + 'a {
        let documents = self
            .members
            .iter()
            .flat_map(|member| (0..member.share.documents).map(move |index| (member, index)));
        documents.map(move |(member, index)| self.page(drawing, random, member, index))
    }

    /// Refuses `requested` where the cards of a share of the longest secret cannot be drawn: a
    /// typed detail too long for its card, or a material with fewer distinct samples than such a
    /// share has codes. A host asks it before any secret is asked. Every refusal is one, which ends
    /// with the refusal's own text.
    pub fn check_printable(
        drawing: &CardDrawing,
        random: &mut dyn Random,
        requested: &ShareCardOptions,
    ) -> Result<(), ExportError> {
        Self::create(drawing, random, &LONG_SHARES, requested)
            .and_then(|set| set.render_share(drawing, random, 0))
            .map(|_| ())
            .map_err(|refusal| ExportError::NotPrintable(refusal.to_string()))
    }
}
