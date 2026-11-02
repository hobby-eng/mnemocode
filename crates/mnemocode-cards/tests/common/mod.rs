//! What the tests of the cards share: the public data they draw, the random sources that stand in
//! for a host's, and what they read of a drawn page.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![allow(dead_code, reason = "each test file takes what it needs")]

use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::forms::Form;
use mnemocode::forms::colors::indexes_to_colors;
use mnemocode::modes::Mode;
use mnemocode::qr::Matrix;
use mnemocode::random::{Random, RandomError};
use mnemocode::refusal::Refusal;
use mnemocode_cards::content::{CardCodes, ColorCards, ContentKind, backup_card_content};
use mnemocode_cards::details::{CardCopy, resolve_presentation};
use mnemocode_cards::export::ShareCardSet;
use mnemocode_cards::raster::{IMAGE_DPI, png_of};
use mnemocode_cards::scene::{MM, POINTS_PER_INCH, Page, Segment, Step, rgb};
use mnemocode_cards::settings::{
    CardPresentation, CardProfile, CardSettings, Orientation, PageSize, ProfileField,
};
use mnemocode_cards::sheet::{
    LayoutRequest, MINIMUM_FONT, SheetError, StudyLayout, collection_sheet_layout,
};
use mnemocode_cards::templates::{CardDrawing, CardTemplate, select_template};

/// The public test phrase of twelve words.
pub(crate) const PHRASE: &str = mnemocode::self_check::vectors::PUBLIC_MNEMONIC;
/// The public test phrase of 24 words.
pub(crate) const LONG_PHRASE: &str = mnemocode::self_check::vectors::PUBLIC_MNEMONIC_24;
/// The first deterministic split of vectors/sskr-v1.json: public shares, any 2 of these 3.
pub(crate) const SET_SHARES: [&str; 3] = [
    "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf",
    "ur:sskr/goemjzaeadadflihpkmhspcheycndschfhcmkelyvaveiesolrls",
    "ur:sskr/goemjzaeadaockjsrlamsebalrbysbjngeeysnplutlywdfytpwe",
];

/// A host's random source: each choice is `choose` of its upper bound, and the bounds are kept.
pub(crate) struct Choices<F> {
    choose: F,
    /// The upper bound of each choice so far, in order.
    pub(crate) asked: Vec<u32>,
}

impl<F: FnMut(u32) -> u32> Choices<F> {
    pub(crate) const fn new(choose: F) -> Self {
        Self {
            choose,
            asked: Vec::new(),
        }
    }
}

impl<F: FnMut(u32) -> u32> Random for Choices<F> {
    fn fill(&mut self, _bytes: &mut [u8]) -> Result<(), RandomError> {
        Err(RandomError::Unavailable)
    }

    fn below(&mut self, upper: u32) -> Result<u32, RandomError> {
        self.asked.push(upper);
        Ok((self.choose)(upper))
    }
}

/// A source that gives the first of everything.
pub(crate) fn first_choices() -> Choices<fn(u32) -> u32> {
    Choices::new(|_| 0)
}

/// A source that gives the last of everything.
pub(crate) fn last_choices() -> Choices<fn(u32) -> u32> {
    Choices::new(|upper| upper - 1)
}

/// A source that refuses every draw, for what must choose nothing.
pub(crate) struct NoChoices;

impl Random for NoChoices {
    fn fill(&mut self, _bytes: &mut [u8]) -> Result<(), RandomError> {
        Err(RandomError::Unavailable)
    }
}

/// The code and the words of the refusal that `result` must be.
#[track_caller]
pub(crate) fn refused<T, E: Refusal>(result: Result<T, E>) -> (&'static str, String) {
    match result {
        Ok(_) => panic!("this must be refused"),
        Err(error) => (error.code(), error.to_string()),
    }
}

/// The design `id`.
pub(crate) fn template(id: &str) -> &'static CardTemplate {
    select_template(Some(id)).expect("an installed design")
}

/// The backup of the public phrase `phrase` in `form`, not masked.
pub(crate) fn direct_backup(phrase: &str, form: Form) -> Backup {
    let phrase = Phrase::parse(phrase).expect("a public phrase");
    Backup::encode(&phrase, &[], form, Mode::Direct, false)
        .expect("a backup")
        .backup
}

/// The colors of the word indexes `indexes`.
pub(crate) fn colors_of(indexes: impl IntoIterator<Item = u16>) -> Vec<String> {
    let indexes: Vec<u16> = indexes.into_iter().collect();
    indexes_to_colors(&indexes).expect("the colors of a phrase")
}

/// The cards of a phrase written as `colors`, whose QR code holds them.
pub(crate) fn phrase_cards(colors: &[String]) -> ColorCards {
    ColorCards {
        kind: ContentKind::Colors,
        codes: CardCodes {
            colors: colors.to_vec(),
            labels: None,
            payload: colors.join(" "),
        },
        decoys: None,
        title: None,
        reference: None,
        qr_card: false,
        settings: CardSettings::default(),
    }
}

/// The cards of the public phrase in Unicode codes: its eleven words alike share one color, so that
/// a business sheet recolours its artwork twice, where a phrase in colors does so for every card.
pub(crate) fn unicode_cards(settings: CardSettings) -> ColorCards {
    backup_card_content(&direct_backup(PHRASE, Form::Unicode), settings, None).expect("the cards")
}

/// The first texts of their pools, with the studio `name`.
pub(crate) fn studio(name: &str) -> CardPresentation {
    let copy = CardCopy {
        studio_name: Some(name.to_owned()),
        ..CardCopy::default()
    };
    resolve_presentation(&mut first_choices(), &copy).expect("public texts")
}

/// The first texts of their pools with the person Alex Morgan, so that nothing of a drawing is left
/// to chance and two drawings differ only by the setting under test.
pub(crate) fn fixed_details() -> CardSettings {
    let mut profile = CardProfile::default();
    profile.set(ProfileField::Name, "Alex Morgan".to_owned());
    CardSettings {
        profile,
        presentation: Some(studio("NORTHLINE STUDIO")),
        ..CardSettings::default()
    }
}

/// The texts that `page` draws, in order.
pub(crate) fn texts(page: &Page) -> Vec<&str> {
    page.steps
        .iter()
        .filter_map(|step| match step {
            Step::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

/// How many steps of `page` are of the kind that `kind` tells.
pub(crate) fn count(page: &Page, kind: impl Fn(&Step) -> bool) -> usize {
    page.steps.iter().filter(|step| kind(step)).count()
}

/// The size of `page` in millimetres, to a tenth.
pub(crate) fn millimetres(page: &Page) -> (f64, f64) {
    let tenths = |points: f64| (points / MM * 10.0).round() / 10.0;
    (tenths(page.width), tenths(page.height))
}

/// Expects `page` to paint as a card does: its artwork, its letters and every state it saves
/// restored, in the steps that the PDF writer and the page images both take.
#[track_caller]
pub(crate) fn assert_paints(page: &Page, what: &str) {
    let images = count(page, |step| matches!(step, Step::Image { .. }));
    let saves = count(page, |step| matches!(step, Step::Save));
    let restores = count(page, |step| matches!(step, Step::Restore));
    assert!(images > 0, "{what}: no artwork");
    assert!(!texts(page).is_empty(), "{what}: no letters");
    assert_eq!(saves, restores, "{what}: saves and restores");
}

/// The dark modules of `code`.
pub(crate) fn dark_modules(code: &Matrix) -> usize {
    let side = 0..code.size();
    side.clone()
        .flat_map(|row| side.clone().map(move |column| (row, column)))
        .filter(|&(row, column)| code.is_dark(row, column))
        .count()
}

/// Whether `step` draws a module of a QR code: nothing else on a page is opaque black.
fn is_module(step: &Step) -> bool {
    matches!(
        step,
        Step::Fill { color, opacity, .. } if *color == rgb(0.0, 0.0, 0.0) && *opacity == 1.0
    )
}

/// How many modules of a QR code `page` draws.
pub(crate) fn drawn_modules(page: &Page) -> usize {
    count(page, is_module)
}

/// The left, right, top and bottom of the rectangle `path` of `step` in pixels of `dpi`, from the
/// top left corner of a page `height` points high.
fn pixel_box(step: &Step, height: f64, dpi: f64) -> [usize; 4] {
    let Step::Fill { path, .. } = step else {
        panic!("a rectangle");
    };
    let [
        Segment::Move(left, bottom),
        _,
        Segment::Line(right, top),
        ..,
    ] = path.as_slice()
    else {
        panic!("a rectangle");
    };
    let pixel = |points: f64| (points * dpi / POINTS_PER_INCH).round() as usize;
    [
        pixel(*left),
        pixel(*right),
        pixel(height - top),
        pixel(height - bottom),
    ]
}

/// What the QR code on the sheet `page` reads as at the resolution of its page images, where the
/// modules of 0.3 mm of a sheet's code are printed: too fine for the 200 dpi of a card-qr test.
pub(crate) fn read_drawn_qr(page: &Page) -> String {
    read_drawn_qr_at(page, IMAGE_DPI)
}

/// What the QR code that `page` draws reads as: the rectangles of its modules, as they are drawn,
/// painted at `dpi` on its plate, the step before them, and read back by the library's reader.
pub(crate) fn read_drawn_qr_at(page: &Page, dpi: f64) -> String {
    let first = page
        .steps
        .iter()
        .position(is_module)
        .expect("a QR code on the page");
    let [left, right, top, bottom] = pixel_box(&page.steps[first - 1], page.height, dpi);
    let (width, height) = (right - left, bottom - top);
    let mut pixels = vec![u8::MAX; width * height * 4];
    for step in page.steps[first..]
        .iter()
        .take_while(|step| is_module(step))
    {
        let [from, to, above, below] = pixel_box(step, page.height, dpi);
        for row in above - top..below - top {
            let line = &mut pixels[row * width * 4..(row + 1) * width * 4];
            let (dark, _) = line[(from - left) * 4..(to - left) * 4].as_chunks_mut::<4>();
            for pixel in dark {
                pixel[..3].fill(0);
            }
        }
    }
    let file = png_of(width as u32, height as u32, &pixels).expect("an image");
    let text = mnemocode::qr::read_png(&file).expect("a readable QR code");
    text.as_str().to_owned()
}

/// Every page of `set`.
pub(crate) fn pages_of(set: &ShareCardSet, drawing: &CardDrawing) -> Vec<Page> {
    set.pages(drawing, &mut first_choices())
        .collect::<Result<_, _>>()
        .expect("the pages")
}

/// The sheet of `cards` in the design `id`, as the design itself draws it, without a plan of decoys.
pub(crate) fn sheet_pages(drawing: &CardDrawing, id: &str, cards: &ColorCards) -> Vec<Page> {
    vec![
        template(id)
            .draw(drawing, &mut first_choices(), cards, None, 0)
            .expect("the sheet"),
    ]
}

/// What a sheet of `count` cards of `aspect` lays out, each caption of `lines` lines.
pub(crate) fn layout_of(
    (size, orientation): (PageSize, Option<Orientation>),
    (count, aspect): (usize, f64),
    lines: &dyn Fn(f64, f64) -> usize,
    code: Option<&Matrix>,
) -> Result<StudyLayout, SheetError> {
    collection_sheet_layout(&LayoutRequest {
        size,
        orientation,
        count,
        aspect,
        caption_lines: lines,
        code,
        minimum_caption_width: 0.0,
    })
}

/// The width of a column that holds `lines` at the least size that a sheet prints, in millimetres,
/// with the slack of 0.1 mm of TS's `studyCaptionWidth`.
pub(crate) fn caption_width(drawing: &CardDrawing, lines: &[&str]) -> f64 {
    let widest = lines
        .iter()
        .map(|line| drawing.font.width(line, MINIMUM_FONT))
        .fold(0.0, f64::max);
    widest / MM + 0.1
}

/// Expects the PDF `file` to say nothing of when and by what it was made: no document information,
/// and no key of it anywhere.
#[track_caller]
pub(crate) fn assert_no_metadata(file: &[u8]) {
    for key in [
        "/Info",
        "/CreationDate",
        "/ModDate",
        "/Producer",
        "/Creator",
        "/Title",
        "/Author",
        "/Subject",
        "/Keywords",
    ] {
        let found = file.windows(key.len()).any(|place| place == key.as_bytes());
        assert!(!found, "{key}");
    }
}
