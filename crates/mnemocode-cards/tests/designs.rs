//! The business designs and what every design shares, as MnemoCode TS 0.1.0's tests pin them
//! (card-numbering, business-cards, card-drawing, export, aud-014-export, aud-026-export): what a
//! card prints and refuses, and that every page paints as a card does.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use common::{
    Choices, PHRASE, SET_SHARES, assert_no_metadata, assert_paints, colors_of, direct_backup,
    drawn_modules, first_choices, fixed_details, millimetres, phrase_cards, read_drawn_qr, refused,
    sheet_pages, studio, template, texts, unicode_cards,
};
use mnemocode::forms::Form;
use mnemocode::forms::colors::colors_to_unicode;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode_cards::content::{ColorCards, SskrLayout, backup_card_content};
use mnemocode_cards::export::{
    CardJob, ShareCardOptions, ShareCardSet, render_cards, render_individual_cards,
};
use mnemocode_cards::pdf::document;
use mnemocode_cards::scene::Page;
use mnemocode_cards::settings::{CardProfile, CardSettings, Orientation, PageSize, ProfileField};
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing, CardStyle};

/// The designs with separate cards, in the order of the installed list.
const BUSINESS_DESIGNS: [&str; 8] = [
    "business-architect",
    "business-it",
    "business-estate",
    "business-diagonal",
    "business-contact",
    "business-curves",
    "business-facets",
    "business-mixed",
];
/// The designs printed on sheets only, in the order of the installed list.
const MATERIAL_DESIGNS: [&str; 5] = [
    "material-vehicle",
    "material-enclosure",
    "material-tile",
    "material-switch",
    "material-kitchen",
];

/// Whether `text` names the size of a set as "07 / 12": no card does, as the cards end with decoys.
fn counts_the_set(text: &str) -> bool {
    text.as_bytes().windows(7).any(|place| {
        place[..2].iter().all(u8::is_ascii_digit)
            && &place[2..5] == b" / "
            && place[5..].iter().all(u8::is_ascii_digit)
    })
}

#[test]
fn every_separate_card_prints_its_number_before_its_code_and_is_named_by_it() {
    let drawing = CardDrawing::new();
    let colors = colors_of((0..12).map(|index| index * 7));
    for id in ["business-it", "business-mixed"] {
        let documents = render_individual_cards(
            &drawing,
            &mut first_choices(),
            template(id),
            &phrase_cards(&colors),
        )
        .expect("the cards");
        // The codes, then at least one decoy, numbered on.
        assert!(documents.len() > colors.len());
        for (index, document) in documents.iter().enumerate() {
            let number = format!("{:02}", index + 1);
            assert_eq!(document.name, number);
            assert_eq!(document.pages.len(), 1);
            let card = &document.pages[0];
            assert_paints(card, id);
            let lines = texts(card);
            assert!(!lines.iter().any(|line| counts_the_set(line)), "{lines:?}");
            let code = lines
                .iter()
                .find_map(|line| line.strip_prefix(&format!("Ref. {number}  ")))
                .expect("the number before the code");
            match colors.get(index) {
                Some(color) => assert_eq!(code, &color[1..]),
                None => assert!(code.len() == 6 && code.bytes().all(|b| b.is_ascii_hexdigit())),
            }
        }
    }
}

#[test]
fn the_recording_holds_the_separate_cards_of_every_business_design() {
    const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/cards-v1.json");
    let recording: serde_json::Value = serde_json::from_str(RECORDED).expect("the recording reads");
    let cases = recording["separate"].as_array().expect("the cases");
    let designs = CARD_TEMPLATES
        .iter()
        .filter(|design| design.draws_separate_cards());
    for design in designs {
        assert!(
            cases.iter().any(|case| case["template"] == design.id),
            "{}",
            design.id
        );
    }
}

#[test]
fn a_decoy_label_stays_out_of_the_names_of_the_files() {
    let mut cards = unicode_cards(CardSettings::default());
    cards.codes.colors.push("#468080".to_owned());
    cards.decoys = Some(1);
    if let Some(labels) = &mut cards.codes.labels {
        labels.push("x/../../escaped".to_owned());
    }
    let documents = render_individual_cards(
        &CardDrawing::new(),
        &mut first_choices(),
        template("business-it"),
        &cards,
    )
    .expect("the cards");
    let names: Vec<String> = documents
        .into_iter()
        .map(|document| document.name)
        .collect();
    let numbers: Vec<String> = (1..=13).map(|number| format!("{number:02}")).collect();
    assert_eq!(names, numbers);
}

#[test]
fn business_sheets_print_given_details_with_either_form_of_the_qr_code() {
    let drawing = CardDrawing::new();
    let colors = colors_of((0..12).map(|index| index * 7));
    // Neither design prints a phone number, which is given all the same.
    let printed = [
        (ProfileField::Name, "Alex Morgan"),
        (ProfileField::Email, "me@example.com"),
        (ProfileField::Company, "VECTOR SYSTEMS"),
        (ProfileField::Role, "IT SOLUTIONS DIRECTOR"),
        (ProfileField::Website, "vector.example"),
        (ProfileField::Location, "International"),
    ];
    let mut profile = CardProfile::default();
    profile.set(ProfileField::Phone, "+1 202 555 0148".to_owned());
    for (field, value) in printed {
        profile.set(field, value.to_owned());
    }
    let unicode = colors_to_unicode(&colors).expect("the colors");
    for (id, size, orientation, measures, payload) in [
        (
            "business-architect",
            PageSize::A6,
            Orientation::Landscape,
            (148.0, 105.0),
            colors.join(" "),
        ),
        (
            "business-it",
            PageSize::A4,
            Orientation::Portrait,
            (210.0, 297.0),
            unicode,
        ),
    ] {
        let mut cards = phrase_cards(&colors);
        cards.codes.payload.clone_from(&payload);
        cards.settings = CardSettings {
            page_size: Some(size),
            orientation: Some(orientation),
            profile: profile.clone(),
            presentation: Some(studio("VECTOR STUDIO")),
            card_qr: true,
        };
        let pages = sheet_pages(&drawing, id, &cards);
        assert_eq!(pages.len(), 1, "{id}");
        assert_eq!(millimetres(&pages[0]), measures, "{id}");
        assert_eq!(read_drawn_qr(&pages[0]), payload, "{id}");
        let lines = texts(&pages[0]);
        for (_, value) in printed {
            assert!(lines.contains(&value), "{id}: {value}");
        }
        assert_no_metadata(&document(&drawing.font, &pages).expect("the PDF"));
    }
}

#[test]
fn a_sheet_refuses_other_qr_data_and_details_that_it_cannot_print() {
    let drawing = CardDrawing::new();
    let colors = colors_of((0..24).map(|index| index * 73 + 1));
    let draw = |cards: &ColorCards| {
        template("business-it")
            .draw(&drawing, &mut first_choices(), cards, None, 0)
            .map(|_| ())
    };
    // Colors, but not all that the cards print: the QR code holds other references.
    let mut other = phrase_cards(&colors);
    other.codes.payload = colors[1..].join(" ");
    assert_eq!(
        refused(draw(&other)).0,
        "export.content-kinds.collection-qr-does-not-match-printed-references"
    );
    // Text that is no colors is read as Color Unicode, which refuses it as such.
    other.codes.payload = "MNC1:secret".to_owned();
    assert_eq!(refused(draw(&other)).0, "core.colors.codes-all");
    for (field, value, refusal) in [
        (
            ProfileField::Company,
            "\u{1F6F8}".to_owned(),
            "not supported",
        ),
        (ProfileField::Email, "x".repeat(95), "too long"),
    ] {
        let mut cards = phrase_cards(&colors);
        cards.settings.profile.set(field, value);
        assert!(refused(draw(&cards)).1.contains(refusal));
    }
}

#[test]
fn a_separate_card_stays_free_of_a_qr_code_and_unchanged_by_it() {
    let drawing = CardDrawing::new();
    let colors = colors_of(0..12);
    let card = |id: &str, page_size, card_qr| {
        let cards = ColorCards {
            settings: CardSettings {
                page_size,
                card_qr,
                ..fixed_details()
            },
            ..phrase_cards(&colors)
        };
        template(id)
            .draw(&drawing, &mut first_choices(), &cards, Some(0), 0)
            .expect("the card")
    };
    let sized = [
        ("business-it", Some(PageSize::Business)),
        ("business-curves", Some(PageSize::Business)),
        ("business-mixed", Some(PageSize::Business)),
    ];
    let every = CARD_TEMPLATES
        .iter()
        .filter(|design| design.draws_separate_cards())
        .map(|design| (design.id, None));
    for (id, size) in every.chain(sized) {
        let with_qr = card(id, size, true);
        assert_eq!(drawn_modules(&with_qr), 0, "{id}");
        assert_eq!(with_qr, card(id, size, false), "{id}");
    }
}

#[test]
fn thirteen_designs_are_installed_with_separate_cards_in_the_business_ones_only() {
    let ids: Vec<&str> = CARD_TEMPLATES.iter().map(|design| design.id).collect();
    assert_eq!(ids, [&BUSINESS_DESIGNS[..], &MATERIAL_DESIGNS].concat());
    for design in CARD_TEMPLATES {
        let business = BUSINESS_DESIGNS.contains(&design.id);
        let family = matches!(design.style, CardStyle::Business(_));
        assert_eq!(family, business, "{}", design.id);
        assert_eq!(design.draws_separate_cards(), business, "{}", design.id);
    }
}

#[test]
fn every_design_prints_one_page_of_one_export_with_one_person_and_one_studio() {
    let drawing = CardDrawing::new();
    let jobs: Vec<CardJob> = CARD_TEMPLATES
        .iter()
        .map(|design| CardJob {
            template: design,
            cards: unicode_cards(CardSettings::default()),
        })
        .collect();
    // Every choice another, so that a person or a studio chosen again would show on its page.
    let mut made = 0;
    let mut turning = Choices::new(|upper| {
        made += 1;
        made % upper
    });
    let pages = render_cards(&drawing, &mut turning, &jobs).expect("the pages");
    assert_eq!(pages.len(), CARD_TEMPLATES.len());
    let frame = |page: &Page| -> Vec<String> {
        texts(page)
            .iter()
            .filter(|line| line.contains("Prepared for"))
            .map(|line| (*line).to_owned())
            .chain(texts(page).first().map(|line| (*line).to_owned()))
            .collect()
    };
    // The line that names the person, and the title, which names the studio.
    assert_eq!(frame(&pages[0]).len(), 2);
    for (page, design) in pages.iter().zip(CARD_TEMPLATES) {
        assert_paints(page, design.id);
        assert_eq!(frame(page), frame(&pages[0]), "{}", design.id);
    }
}

#[test]
fn a_titled_sheet_keeps_the_orientation_asked_for_with_its_qr_code() {
    let drawing = CardDrawing::new();
    for (size, orientation, title) in [
        (PageSize::A4, Orientation::Landscape, Some("Public sample")),
        (PageSize::A6, Orientation::Portrait, None),
    ] {
        let settings = CardSettings {
            page_size: Some(size),
            orientation: Some(orientation),
            card_qr: true,
            ..CardSettings::default()
        };
        let backup = direct_backup(PHRASE, Form::Unicode);
        let cards = backup_card_content(&backup, settings, title).expect("the cards");
        for id in ["business-architect", "material-vehicle"] {
            let job = CardJob {
                template: template(id),
                cards: cards.clone(),
            };
            let pages = render_cards(&drawing, &mut first_choices(), &[job]).expect("the sheet");
            let what = format!("{id} {size:?}");
            assert_eq!(pages.len(), 1, "{what}");
            assert_paints(&pages[0], &what);
            assert_eq!(read_drawn_qr(&pages[0]), cards.codes.payload, "{what}");
            let wide = pages[0].width > pages[0].height;
            assert_eq!(wide, orientation == Orientation::Landscape, "{what}");
            if let Some(title) = title {
                assert!(texts(&pages[0]).contains(&title), "{what}");
            }
        }
    }
}

/// Share cards of `id` in `layout`, in `format`, of the public shares.
fn share_set(
    drawing: &CardDrawing,
    id: &str,
    layout: SskrLayout,
    format: ShareFormat,
) -> ShareCardSet {
    let options = ShareCardOptions {
        template: template(id),
        layout: Some(layout),
        share_format: format,
        title: None,
        // Separate cards never carry a QR code, and refuse one.
        settings: CardSettings {
            card_qr: !layout.separate_cards(),
            ..CardSettings::default()
        },
    };
    ShareCardSet::create(drawing, &mut first_choices(), &SET_SHARES, &options).expect("the cards")
}

#[test]
fn share_cards_paint_in_every_layout_and_every_form_that_has_cards() {
    let drawing = CardDrawing::new();
    // Each layout of each family, then the forms on a material's sheet, which recolours nothing.
    let cases = [
        ("business-architect", SskrLayout::Qr, ShareFormat::Colors),
        (
            "business-architect",
            SskrLayout::Collection,
            ShareFormat::Colors,
        ),
        ("material-vehicle", SskrLayout::Qr, ShareFormat::Colors),
        (
            "material-vehicle",
            SskrLayout::Collection,
            ShareFormat::Colors,
        ),
        (
            "material-vehicle",
            SskrLayout::Collection,
            ShareFormat::Unicode,
        ),
        (
            "material-vehicle",
            SskrLayout::Collection,
            ShareFormat::ColorsUnicode,
        ),
        (
            "business-architect",
            SskrLayout::Individual,
            ShareFormat::Colors,
        ),
    ];
    for (id, layout, format) in cases {
        let set = share_set(&drawing, id, layout, format);
        let document = set
            .document(&drawing, &mut first_choices(), 0, 0)
            .expect("the first document");
        assert_paints(&document.pages[0], &format!("{id} {layout:?} {format:?}"));
    }
}
