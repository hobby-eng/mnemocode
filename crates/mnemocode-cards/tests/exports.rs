//! What a host saves and checks, as MnemoCode TS 0.1.0's tests pin it (export, card-preview,
//! aud-014-export, sskr-card-self-test): the document of a set of pages, the sample cards and the
//! self-test of the cards.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use common::{
    Choices, LONG_PHRASE, PHRASE, assert_no_metadata, colors_of, first_choices, millimetres,
    pages_of, phrase_cards, png_pixels, refused, template,
};
use mnemocode::backup::Backup;
use mnemocode::dates::parse_date;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::qr::{matrix, png as qr_image, read_png};
use mnemocode::self_check::vectors::OFFICIAL_SHARES;
use mnemocode::self_check::{Check, Tier};
use mnemocode::sskr::forms::ShareFormat;
use mnemocode_cards::checks::{CARD_EXPORT, ROWS, startup};
use mnemocode_cards::content::{ColorCards, ContentKind, SskrLayout};
use mnemocode_cards::export::{
    CardJob, CardPreview, CardPreviewOptions, DesignSelection, ExportError, ShareCardOptions,
    ShareCardSet, card_pages, pdf_of, render_cards, write_pdf,
};
use mnemocode_cards::pdf::{PdfError, document};
use mnemocode_cards::raster::{ImageFormat, page_image, png_of};
use mnemocode_cards::scene::{Page, Picture, Step};
use mnemocode_cards::settings::{CardSettings, Orientation, PageSize};
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing};
use std::io::{self, Write};
use std::rc::{Rc, Weak};

/// What the QR images of these tests hold.
const QR_PAYLOAD: &str = "public expected QR payload";
/// The public dates that TS 0.1.0 masks a sample phrase with.
const SAMPLE_DATES: [&str; 4] = ["31-10-2008", "03-01-2009", "12-01-2009", "22-05-2010"];

/// How many pages the PDF `file` holds.
fn pages_of_pdf(file: &[u8]) -> usize {
    let found = |key: &[u8]| {
        file.windows(key.len())
            .filter(|place| *place == key)
            .count()
    };
    found(b"/Type /Page") - found(b"/Type /Pages")
}

#[test]
fn a_pdf_keeps_every_page_of_its_designs_and_no_metadata() {
    let drawing = CardDrawing::new();
    let job = |id: &str, page_size| CardJob {
        template: template(id),
        cards: ColorCards {
            settings: CardSettings {
                page_size,
                orientation: Some(Orientation::Landscape),
                ..CardSettings::default()
            },
            ..phrase_cards(&colors_of(0..12))
        },
    };
    // Sheets of one design each, unchanged in size; separate cards take a page each.
    let sheets = [
        job("material-tile", Some(PageSize::A5)),
        job("material-vehicle", None),
    ];
    let pages = render_cards(&drawing, &mut first_choices(), &sheets).expect("the pages");
    assert_eq!(
        pages.iter().map(millimetres).collect::<Vec<_>>(),
        [(210.0, 148.0), (148.0, 105.0)]
    );
    let file = document(&drawing.font, &pages).expect("the PDF");
    assert!(file.starts_with(b"%PDF-"));
    assert_eq!(pages_of_pdf(&file), 2);
    assert_no_metadata(&file);
    let mixed = [
        job("business-it", Some(PageSize::Business)),
        job("material-tile", None),
    ];
    let pages = render_cards(&drawing, &mut first_choices(), &mixed).expect("the pages");
    assert_eq!(pages.len(), 9 + 1);
}

/// A job of separate cards of the public codes, each with artwork of its own.
fn separate_job() -> CardJob {
    CardJob {
        template: template("business-it"),
        cards: ColorCards {
            settings: CardSettings {
                page_size: Some(PageSize::Business),
                ..CardSettings::default()
            },
            ..phrase_cards(&colors_of(0..12))
        },
    }
}

/// The picture that `page` draws first.
fn first_picture(page: &Page) -> &Rc<Picture> {
    let picture = page.steps.iter().find_map(|step| match step {
        Step::Image { picture, .. } => Some(picture),
        _ => None,
    });
    picture.expect("artwork")
}

#[test]
fn a_pdf_lets_each_page_go_before_the_next_is_drawn_and_keeps_every_picture() {
    let drawing = CardDrawing::new();
    let jobs = [separate_job()];
    let mut before: Option<Weak<Picture>> = None;
    let mut random = first_choices();
    let pages = card_pages(&drawing, &mut random, &jobs).expect("the pages");
    let pages = pages.map(|page| {
        let page = page?;
        let gone = before
            .take()
            .is_none_or(|picture| picture.upgrade().is_none());
        assert!(gone, "a page outlived its turn");
        before = Some(Rc::downgrade(first_picture(&page)));
        Ok::<_, ExportError>(page)
    });
    let file = pdf_of(&drawing.font, pages).expect("the PDF");
    // Each card has its own colors, so that its picture is its own, whatever address it came to.
    let found = |key: &[u8]| file.windows(key.len()).filter(|at| *at == key).count();
    assert_eq!(pages_of_pdf(&file), 9);
    assert_eq!(found(b"/Subtype /Image") - found(b"/SMask"), 9);
}

/// A set of cards of the first two official shares in colors.
fn official_set(drawing: &CardDrawing, id: &str, layout: SskrLayout) -> ShareCardSet {
    let options = ShareCardOptions {
        template: template(id),
        layout: Some(layout),
        share_format: ShareFormat::Colors,
        title: None,
        settings: CardSettings::default(),
    };
    let records = &OFFICIAL_SHARES[..2];
    ShareCardSet::create(drawing, &mut first_choices(), records, &options).expect("the set")
}

#[test]
fn the_pages_of_a_set_are_those_of_its_shares_in_their_order() {
    let drawing = CardDrawing::new();
    let set = official_set(&drawing, "business-it", SskrLayout::Collection);
    let mut each = Vec::new();
    for place in 0..2 {
        each.extend(
            set.render_share(&drawing, &mut first_choices(), place)
                .expect("a share"),
        );
    }
    assert_eq!(pages_of(&set, &drawing), each);
}

#[test]
fn the_table_at_the_end_of_a_pdf_says_where_each_object_lies() {
    let drawing = CardDrawing::new();
    let jobs = [separate_job()];
    let pages = render_cards(&drawing, &mut first_choices(), &jobs).expect("the pages");
    let file = document(&drawing.font, &pages[..2]).expect("the PDF");
    let before = file
        .windows(6)
        .rposition(|at| at == b"\nxref\n")
        .expect("the table");
    let table = before + 1;
    let text = String::from_utf8_lossy(&file[table..]);
    let mut lines = text.lines();
    assert_eq!(lines.next(), Some("xref"));
    let size = lines.next().expect("its range");
    let size: usize = size.strip_prefix("0 ").expect("0").parse().expect("a size");
    assert_eq!(lines.next(), Some("0000000000 65535 f"));
    for number in 1..size {
        let entry = lines.next().expect("an entry");
        assert!(entry.ends_with(" 00000 n"), "{entry}");
        let offset: usize = entry[..10].parse().expect("an offset");
        let start = format!("{number} 0 obj");
        assert!(file[offset..].starts_with(start.as_bytes()), "{number}");
    }
    let rest: Vec<&str> = lines.collect();
    assert!(rest.contains(&"trailer"));
    assert!(rest.contains(&format!("  /Size {size}").as_str()));
    assert_eq!(rest[rest.len() - 2], table.to_string());
    assert_eq!(rest[rest.len() - 1], "%%EOF");
}

/// A sink that takes `room` bytes and then refuses.
struct FullDisk {
    room: usize,
}

impl Write for FullDisk {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self.room.checked_sub(bytes.len()) {
            Some(room) => {
                self.room = room;
                Ok(bytes.len())
            }
            None => Err(io::ErrorKind::StorageFull.into()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn a_sink_that_refuses_ends_the_pdf_with_its_refusal() {
    let drawing = CardDrawing::new();
    let jobs = [separate_job()];
    let mut random = first_choices();
    let pages = card_pages(&drawing, &mut random, &jobs).expect("the pages");
    let written = write_pdf::<ExportError, _>(&drawing.font, pages, FullDisk { room: 4096 });
    assert_eq!(refused(written).0, "export.pdf-documents.not-written");
}

/// What a host's check gives between two pages, or that the export refused.
#[derive(Debug)]
enum Ended {
    Asked,
    Refused,
}

impl From<ExportError> for Ended {
    fn from(_: ExportError) -> Self {
        Self::Refused
    }
}

impl From<PdfError> for Ended {
    fn from(_: PdfError) -> Self {
        Self::Refused
    }
}

#[test]
fn an_error_of_a_host_between_two_pages_ends_the_pdf_there() {
    let drawing = CardDrawing::new();
    let jobs = [separate_job()];
    let mut random = first_choices();
    let mut asked = 0;
    let pages = card_pages(&drawing, &mut random, &jobs).expect("the pages");
    let pages = pages.map(|page| {
        asked += 1;
        if asked == 3 {
            return Err(Ended::Asked);
        }
        Ok(page?)
    });
    assert!(matches!(pdf_of(&drawing.font, pages), Err(Ended::Asked)));
    assert_eq!(asked, 3);
}

#[test]
fn no_job_and_cards_of_another_kind_are_refused() {
    let drawing = CardDrawing::new();
    let empty = render_cards(&drawing, &mut first_choices(), &[]);
    assert!(refused(empty).1.starts_with("No cards to render"));
    let job = CardJob {
        template: template("business-it"),
        cards: ColorCards {
            kind: ContentKind::Sskr,
            ..phrase_cards(&colors_of(0..12))
        },
    };
    let refusal = render_cards(&drawing, &mut first_choices(), &[job]);
    assert!(refused(refusal).1.contains("does not support"));
}

#[test]
fn a_preview_draws_one_design_from_a_sample_phrase_and_lists_every_design() {
    let drawing = CardDrawing::new();
    let options = CardPreviewOptions {
        words: Some(24),
        ..CardPreviewOptions::default()
    };
    let longest = CardPreview::new(&mut first_choices(), options).expect("the preview");
    let job = longest.job(Some("material-tile")).expect("a design");
    let pages = render_cards(&drawing, &mut first_choices(), &[job]).expect("the sheet");
    assert_eq!(pages.len(), 1);
    let jobs = longest.jobs(DesignSelection::Every).expect("the designs");
    let ids: Vec<&str> = jobs.iter().map(|job| job.template.id).collect();
    let installed: Vec<&str> = CARD_TEMPLATES.iter().map(|design| design.id).collect();
    assert_eq!(ids, installed);
}

#[test]
fn a_preview_draws_a_sample_phrase_of_its_own_a_byte_at_a_time() {
    // The phrases of entropy bytes all 0x7f and all 0x00, masked with the four sample dates. The
    // colors come from TS's independent oracle of docs/SEEDSHIFT_CONSTRUCTION.md.
    for (byte, colors) in [
        (
            0x7f,
            "#017EE4 #22833E #4016B7 #688BD1 #7D1C97 #9BCED8 #BA1FB9 #E446DA",
        ),
        (
            0x00,
            "#0310C4 #203250 #401A28 #5BDBA4 #7D2328 #98E4AD #BA2C8C #D68B50",
        ),
    ] {
        let mut random = Choices::new(move |_| byte);
        let preview = CardPreview::new(&mut random, CardPreviewOptions::default());
        let job = preview.expect("the preview").job(None).expect("a design");
        assert_eq!(job.cards.codes.payload, colors);
        // 16 bytes for 12 words, each drawn from the 256 values of a byte.
        assert_eq!(random.asked, [256; 16]);
    }
}

/// The words that the cards of `preview` print: their colors, unmasked with the sample dates.
fn sample_words(preview: &CardPreview) -> String {
    let dates = SAMPLE_DATES.map(|date| parse_date(date).expect("a public date"));
    let job = preview.job(None).expect("a design");
    let backup = Backup::read(&job.cards.codes.payload, Form::Colors, Mode::Seedshift);
    let phrase = backup.expect("the codes").decode(&dates).expect("a phrase");
    let words = Form::English.codes(phrase.recovered.as_slice());
    words.expect("the words").as_str().to_owned()
}

#[test]
fn a_sample_phrase_comes_from_its_entropy_drawn_byte_by_byte() {
    // Published BIP39 vectors (trezor/python-mnemonic, vectors.json): each byte of the entropy alike.
    for (byte, words) in [
        (0x00, PHRASE),
        (
            0x7f,
            "legal winner thank year wave sausage worth useful legal winner thank yellow",
        ),
        (
            0x80,
            "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
        ),
        (0xff, "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"),
    ] {
        let mut random = Choices::new(move |_| byte);
        let preview = CardPreview::new(&mut random, CardPreviewOptions::default());
        assert_eq!(sample_words(&preview.expect("the preview")), words);
        // 16 bytes for 12 words, each drawn from the 256 values of a byte.
        assert_eq!(random.asked, [256; 16]);
    }
    let mut random = first_choices();
    let options = CardPreviewOptions {
        words: Some(24),
        ..CardPreviewOptions::default()
    };
    let preview = CardPreview::new(&mut random, options).expect("the preview");
    assert_eq!(random.asked, [256; 32]);
    assert_eq!(sample_words(&preview), LONG_PHRASE);
}

/// The data of the chunk `name` of the PNG `file`.
fn png_chunk<'a>(file: &'a [u8], name: &[u8; 4]) -> Option<&'a [u8]> {
    let mut rest = &file[8..];
    while rest.len() >= 12 {
        let length = u32::from_be_bytes(rest[..4].try_into().expect("four bytes")) as usize;
        if &rest[4..8] == name {
            return Some(&rest[8..8 + length]);
        }
        rest = &rest[12 + length..];
    }
    None
}

#[test]
fn a_page_image_says_the_resolution_that_it_prints_at_as_ts_does() {
    let drawing = CardDrawing::new();
    let jobs = [separate_job()];
    let pages = render_cards(&drawing, &mut first_choices(), &jobs).expect("the pages");
    let png = page_image(&drawing.font, &pages[0], ImageFormat::Png).expect("the image");
    // As pdftocairo writes them: relative colorimetric, 11811 pixels per metre on both sides.
    assert_eq!(png_chunk(&png, b"sRGB"), Some(&[1][..]));
    assert_eq!(
        png_chunk(&png, b"pHYs"),
        Some(&[0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1][..])
    );
    let jpeg = page_image(&drawing.font, &pages[0], ImageFormat::Jpg).expect("the image");
    // JFIF after the start of the file and its segment's length: a version, inches, 300 by 300.
    assert_eq!(&jpeg[6..11], b"JFIF\0");
    assert_eq!(&jpeg[13..18], [1, 1, 44, 1, 44]);
}

#[test]
fn a_preview_refuses_a_phrase_length_that_bip39_does_not_have() {
    let options = CardPreviewOptions {
        words: Some(13),
        ..CardPreviewOptions::default()
    };
    let refusal = CardPreview::new(&mut first_choices(), options);
    assert!(refused(refusal).1.contains("12, 15, 18, 21 or 24"));
}

#[test]
fn the_sample_cards_hold_no_word_of_one_coin_so_that_a_host_for_another_can_take_them() {
    let source = include_str!("../src/export.rs").to_lowercase();
    assert!(!source.contains("bitcoin"));
}

#[test]
fn the_self_test_rows_of_the_cards_pass_at_both_tiers() {
    startup().expect("the startup cases");
    for row in ROWS.iter().chain([&CARD_EXPORT]) {
        row.run(Tier::Full).expect("the full cases");
    }
}

#[test]
fn a_set_of_the_official_shares_is_planned_with_its_cards_and_its_qr_codes() {
    let set = official_set(&CardDrawing::new(), "material-tile", SskrLayout::Qr);
    assert_eq!(set.layout(), SskrLayout::Qr);
    assert_eq!(set.shares().count(), 2);
    assert_eq!(set.qr_codes().len(), 2);
}

/// The side in pixels of the grey image `file`, and whether each pixel is dark, row by row.
fn dark_pixels(file: &[u8]) -> (usize, Vec<bool>) {
    let (frame, pixels) = png_pixels(file);
    assert_eq!(frame.width, frame.height);
    assert_eq!(frame.line_size, frame.width as usize, "one byte a pixel");
    let dark = pixels.iter().map(|level| *level < 128).collect();
    (frame.width as usize, dark)
}

#[test]
fn a_saved_qr_image_leaves_a_quiet_zone_of_four_modules_on_every_side() {
    let image = qr_image(QR_PAYLOAD).expect("an image");
    assert_eq!(read_png(&image).expect("a code").as_str(), QR_PAYLOAD);
    let (side, dark) = dark_pixels(&image);
    // The dark pixels span the whole symbol: its finder patterns fill three of its corners.
    let across = |pixel: usize| pixel % side;
    let down = |pixel: usize| pixel / side;
    let places = || {
        dark.iter()
            .enumerate()
            .filter(|(_, dark)| **dark)
            .map(|(pixel, _)| pixel)
    };
    let (left, right) = (
        places().map(across).min().expect("a code"),
        places().map(across).max().expect("a code"),
    );
    let (top, bottom) = (
        places().map(down).min().expect("a code"),
        places().map(down).max().expect("a code"),
    );
    let modules = matrix(QR_PAYLOAD).expect("a QR code").size();
    let module_pixels = (right - left + 1) as f64 / modules as f64;
    let quiet = [left, side - 1 - right, top, side - 1 - bottom]
        .map(|pixels| (pixels as f64 / module_pixels).round());
    assert_eq!(quiet, [4.0; 4]);
}

#[test]
fn an_image_with_the_one_module_quiet_zone_of_the_first_release_still_reads() {
    const SIDE: usize = 720;
    const FORMER_QUIET_MODULES: usize = 1;
    let code = matrix(QR_PAYLOAD).expect("a QR code");
    let scale = (code.size() + 2 * FORMER_QUIET_MODULES) as f64 / SIDE as f64;
    let module = |pixel: usize| ((pixel as f64 * scale) as usize).checked_sub(FORMER_QUIET_MODULES);
    let mut pixels = vec![u8::MAX; SIDE * SIDE * 4];
    for (place, pixel) in pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        if let (Some(row), Some(column)) = (module(place / SIDE), module(place % SIDE))
            && code.is_dark(row, column)
        {
            pixel[..3].fill(0);
        }
    }
    let file = png_of(SIDE as u32, SIDE as u32, &pixels).expect("an image");
    assert_eq!(read_png(&file).expect("a code").as_str(), QR_PAYLOAD);
}
