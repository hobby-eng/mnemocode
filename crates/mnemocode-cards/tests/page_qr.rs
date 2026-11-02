//! The QR code of a sheet as a host reads it back from the page image it saved, as TS's reader does
//! (PLAN.md, the parity of page images). The designs differ in what lies around the code, and the
//! codes in how many pixels their modules take; every kind of page is read.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use common::{LONG_PHRASE, PHRASE, direct_backup, first_choices, pages_of, template};
use mnemocode::forms::Form;
use mnemocode::qr::read_png;
use mnemocode::self_check::vectors::{LONG_SHARES, OFFICIAL_SHARES};
use mnemocode::sskr::forms::ShareFormat;
use mnemocode_cards::content::{SskrLayout, backup_card_content};
use mnemocode_cards::export::{CardJob, ShareCardOptions, ShareCardSet, render_cards};
use mnemocode_cards::raster::{ImageFormat, page_image};
use mnemocode_cards::scene::Page;
use mnemocode_cards::settings::{CardSettings, Orientation, PageSize};
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing};

/// The sheets that TS's reader reads: A4 is past the pixels that an image may have.
const SIZES: [PageSize; 2] = [PageSize::A6, PageSize::A5];
const TURNS: [Orientation; 2] = [Orientation::Portrait, Orientation::Landscape];
/// The forms of a backup that have cards: their codes differ in what a QR code holds.
const FORMS: [Form; 2] = [Form::Unicode, Form::Colors];

/// What the QR code of `page` reads as from its image; the refusal where it does not read.
fn read_image(drawing: &CardDrawing, page: &Page) -> String {
    let image = page_image(&drawing.font, page, ImageFormat::Png).expect("the image");
    read_png(&image).map_or_else(
        |refusal| refusal.to_string(),
        |text| text.as_str().to_owned(),
    )
}

/// A sheet of `size`, turned to `turn`, with a QR code.
fn sheet(size: PageSize, turn: Orientation) -> CardSettings {
    CardSettings {
        page_size: Some(size),
        orientation: Some(turn),
        card_qr: true,
        ..CardSettings::default()
    }
}

/// Expects the QR code of the sheet of `phrase` in `form` in the design `id` to read as it was
/// written.
#[track_caller]
fn check_sheet(
    drawing: &CardDrawing,
    id: &str,
    phrase: &str,
    form: Form,
    (size, turn): (PageSize, Orientation),
) {
    let backup = direct_backup(phrase, form);
    let cards = backup_card_content(&backup, sheet(size, turn), None).expect("the content");
    let payload = cards.codes.payload.clone();
    let job = CardJob {
        template: template(id),
        cards,
    };
    let pages = render_cards(drawing, &mut first_choices(), &[job]).expect("the sheet");
    let read = read_image(drawing, &pages[0]);
    assert_eq!(read, payload, "{id} {size:?} {turn:?} {}", form.name());
}

/// Expects the QR code of each sheet of `records` in the design `id` to read as it was written.
#[track_caller]
fn check_shares(
    drawing: &CardDrawing,
    id: &str,
    records: &[&str],
    share_format: ShareFormat,
    (size, layout): (PageSize, SskrLayout),
) {
    let options = ShareCardOptions {
        template: template(id),
        layout: Some(layout),
        share_format,
        title: None,
        settings: CardSettings {
            page_size: Some(size),
            card_qr: true,
            ..CardSettings::default()
        },
    };
    let set = ShareCardSet::create(drawing, &mut first_choices(), records, &options);
    let set = set.expect("the cards");
    let pages = pages_of(&set, drawing);
    assert_eq!(pages.len(), records.len());
    for (page, code) in pages.iter().zip(set.qr_codes()) {
        let read = read_image(drawing, page);
        assert_eq!(read, code.payload, "{id} {size:?} {layout:?}");
    }
}

#[test]
fn the_qr_code_of_a_sheet_reads_from_its_page_image() {
    let drawing = CardDrawing::new();
    for id in ["business-mixed", "material-enclosure"] {
        for turn in TURNS {
            check_sheet(&drawing, id, PHRASE, Form::Colors, (PageSize::A6, turn));
        }
    }
}

#[test]
fn the_qr_code_of_a_share_reads_from_the_image_of_its_sheet() {
    let drawing = CardDrawing::new();
    for layout in [SskrLayout::Collection, SskrLayout::Qr] {
        check_shares(
            &drawing,
            "business-it",
            &OFFICIAL_SHARES[..2],
            ShareFormat::Colors,
            (PageSize::A6, layout),
        );
    }
}

#[test]
#[ignore = "104 page images of 13 designs, minutes in a debug build: it runs at release"]
fn every_design_reads_on_every_sheet_at_either_turn() {
    let drawing = CardDrawing::new();
    for design in CARD_TEMPLATES {
        for size in SIZES {
            for turn in TURNS {
                for form in FORMS {
                    check_sheet(&drawing, design.id, PHRASE, form, (size, turn));
                }
            }
        }
    }
}

#[test]
#[ignore = "the longest backups and shares of 13 designs, minutes: it runs at release"]
fn the_longest_codes_of_every_design_read_on_every_sheet() {
    let drawing = CardDrawing::new();
    for design in CARD_TEMPLATES {
        for size in SIZES {
            for form in FORMS {
                check_sheet(
                    &drawing,
                    design.id,
                    LONG_PHRASE,
                    form,
                    (size, Orientation::Portrait),
                );
            }
            for layout in [SskrLayout::Collection, SskrLayout::Qr] {
                // A material has fewer samples than a share has Unicode codes.
                let formats: &[ShareFormat] = if design.draws_separate_cards() {
                    &[ShareFormat::Colors, ShareFormat::Unicode]
                } else {
                    &[ShareFormat::Colors]
                };
                for format in formats {
                    check_shares(&drawing, design.id, &LONG_SHARES, *format, (size, layout));
                }
            }
        }
    }
}

#[test]
#[ignore = "page images of 13 designs: it runs at release"]
fn the_qr_card_of_a_share_reads_at_the_size_of_a_card() {
    let drawing = CardDrawing::new();
    for design in CARD_TEMPLATES {
        let size_and_layout = (PageSize::Business, SskrLayout::Qr);
        check_shares(
            &drawing,
            design.id,
            &LONG_SHARES,
            ShareFormat::Colors,
            size_and_layout,
        );
    }
}
