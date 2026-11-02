//! Pages and sheets, as MnemoCode TS 0.1.0's tests pin them (card-page-sizes, collection-sheet,
//! card-qr and the sheets of card-sets): how a page size decides between a sheet and separate cards,
//! how a sheet lays out its cards, captions, backdrop and QR code, and what it refuses.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use common::{
    PHRASE, SET_SHARES, caption_width, colors_of, count, dark_modules, drawn_modules,
    first_choices, layout_of, millimetres, pages_of, phrase_cards, read_drawn_qr, read_drawn_qr_at,
    refused, sheet_pages, studio, template, texts, unicode_cards,
};
use mnemocode::qr::matrix;
use mnemocode::refusal::Refusal;
use mnemocode::self_check::vectors::LONG_SHARES;
use mnemocode::sskr::forms::{ShareFormat, read_share};
use mnemocode_cards::content::{ColorCards, MAX_DECOYS, SskrLayout};
use mnemocode_cards::export::{
    CardJob, ExportError, ShareCardOptions, ShareCardSet, render_cards, render_individual_cards,
};
use mnemocode_cards::scene::{MM, Page, Rgb, Segment, Step, UiFont, rgb};
use mnemocode_cards::settings::{CardSettings, Orientation, PageSize, check_separate_card_size};
use mnemocode_cards::sheet::backdrops::{MaterialBackdrop, draw_material_backdrop};
use mnemocode_cards::sheet::frame::{MIN_MODULE_MM, draw_collection_qr};
use mnemocode_cards::sheet::{
    MAX_SHEET_CARDS, MIN_SHEET_ROWS, SHEET_PLAN_TEXT, StudyCaptions, StudyLayout,
    plan_collection_sheet, qr_size_for_module,
};
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing};

/// How far a measure of a layout may lie past its limit, in millimetres.
const SLACK: f64 = 0.001;
/// The resolution at which TS's card-qr tests read a code of the least modules a card keeps.
const QR_TEST_DPI: f64 = 200.0;
const LANDSCAPE: Option<Orientation> = Some(Orientation::Landscape);
const PORTRAIT: Option<Orientation> = Some(Orientation::Portrait);

/// The page size of the settings of a test.
fn page(size: Option<PageSize>, orientation: Option<Orientation>) -> CardSettings {
    CardSettings {
        page_size: size,
        orientation,
        ..CardSettings::default()
    }
}

/// The sizes in millimetres of the pages of `cards`, saved in the design `id`.
fn sizes_of(
    drawing: &CardDrawing,
    id: &str,
    cards: ColorCards,
) -> Result<Vec<(f64, f64)>, ExportError> {
    let job = CardJob {
        template: template(id),
        cards,
    };
    let pages = render_cards(drawing, &mut first_choices(), &[job])?;
    Ok(pages.iter().map(millimetres).collect())
}

#[test]
fn only_the_business_size_is_a_size_of_separate_cards() {
    for size in [PageSize::A6, PageSize::A5, PageSize::A4] {
        assert_eq!(
            refused(check_separate_card_size(Some(size))),
            (
                "export.card-settings.separate-cards-business-size-choose-business-size-leave",
                "Separate cards have the business size. Choose the business size, or leave the size out."
                    .to_owned()
            ),
            "{size:?}"
        );
    }
    assert_eq!(check_separate_card_size(Some(PageSize::Business)), Ok(()));
    assert_eq!(check_separate_card_size(None), Ok(()));
}

#[test]
fn a_sheet_holds_the_whole_collection_on_one_page_turned_as_given() {
    let drawing = CardDrawing::new();
    let sheet = |id: &str, size, orientation| {
        sizes_of(&drawing, id, unicode_cards(page(size, orientation))).expect("a sheet")
    };
    for id in ["business-it", "material-tile"] {
        // Without an orientation the sheet is turned the way its cards are largest.
        let turned = sheet(id, None, None);
        assert_eq!(turned.len(), 1, "{id}");
        let (width, height) = turned[0];
        assert_eq!(
            (width.min(height), width.max(height)),
            (105.0, 148.0),
            "{id}"
        );
        assert_eq!(sheet(id, None, LANDSCAPE), [(148.0, 105.0)], "{id}");
        assert_eq!(sheet(id, None, PORTRAIT), [(105.0, 148.0)], "{id}");
    }
    assert_eq!(sheet("business-it", Some(PageSize::A4), None).len(), 1);
    assert_eq!(
        sheet("business-it", Some(PageSize::A5), PORTRAIT),
        [(148.0, 210.0)]
    );
}

#[test]
fn a_card_size_gives_a_page_of_90_by_50_mm_for_each_code_and_one_decoy() {
    let drawing = CardDrawing::new();
    let colors = colors_of((0..12).map(|index| index * 7));
    let business = || ColorCards {
        settings: page(Some(PageSize::Business), None),
        ..phrase_cards(&colors)
    };
    let cards = sizes_of(&drawing, "business-it", business()).expect("the cards");
    assert_eq!(cards, vec![(90.0, 50.0); colors.len() + 1]);
    // A material design is printed on sheets only.
    let material = refused(sizes_of(&drawing, "material-tile", business()));
    assert!(material.1.contains("printed on sheets only"));
    let unknown = refused(PageSize::parse(Some("wallet")));
    assert!(unknown.1.contains("a6, a5, a4 or business"));
}

#[test]
fn separate_cards_of_a_sheet_size_are_refused() {
    let drawing = CardDrawing::new();
    let it = template("business-it");
    for size in [PageSize::A6, PageSize::A4] {
        let cards = ColorCards {
            settings: page(Some(size), None),
            ..phrase_cards(&colors_of(0..12))
        };
        let refusal = render_individual_cards(&drawing, &mut first_choices(), it, &cards);
        assert!(
            refused(refusal)
                .1
                .starts_with("Separate cards have the business size.")
        );
    }
}

#[test]
fn every_page_size_knows_its_measures_in_both_orientations() {
    assert_eq!(PageSize::A4.dimensions(None), (210.0, 297.0));
    assert_eq!(PageSize::A4.dimensions(LANDSCAPE), (297.0, 210.0));
    assert_eq!(PageSize::A6.dimensions(None), (148.0, 105.0));
    assert_eq!(PageSize::A6.dimensions(PORTRAIT), (105.0, 148.0));
    assert_eq!(PageSize::A5.dimensions(PORTRAIT), (148.0, 210.0));
    assert_eq!(PageSize::A5.dimensions(LANDSCAPE), (210.0, 148.0));
    assert_eq!(PageSize::Business.dimensions(PORTRAIT), (50.0, 90.0));
    assert_eq!(PageSize::Business.dimensions(LANDSCAPE), (90.0, 50.0));
}

#[test]
fn a_separate_card_has_rounded_corners_that_clip_its_artwork() {
    let drawing = CardDrawing::new();
    for id in ["business-it", "business-architect"] {
        let cards = unicode_cards(page(Some(PageSize::Business), None));
        let card = template(id)
            .draw(&drawing, &mut first_choices(), &cards, Some(0), 0)
            .expect("the card");
        let steps = &card.steps;
        let image = steps
            .iter()
            .position(|step| matches!(step, Step::Image { .. }));
        let clip = steps
            .iter()
            .position(|step| matches!(step, Step::Clip { .. }));
        assert!(clip.is_some() && clip < image, "{id}");
        // Four curves form the corners of the clipping path, and nothing else on a card curves.
        let curves = |path: &[Segment]| {
            let curve = |segment: &&Segment| matches!(segment, Segment::Curve(..));
            path.iter().filter(curve).count()
        };
        let clipped = steps.iter().find_map(|step| match step {
            Step::Clip { path, .. } => Some(curves(path)),
            _ => None,
        });
        assert_eq!(clipped, Some(4), "{id}");
        let drawn: usize = steps
            .iter()
            .map(|step| match step {
                Step::Clip { path, .. } | Step::Fill { path, .. } | Step::Stroke { path, .. } => {
                    curves(path)
                }
                _ => 0,
            })
            .sum();
        assert_eq!(drawn, 4, "{id}");
    }
}

#[test]
fn a_qr_code_on_separate_cards_is_refused() {
    let cards = unicode_cards(CardSettings {
        card_qr: true,
        ..page(Some(PageSize::Business), None)
    });
    let refusal = sizes_of(&CardDrawing::new(), "business-it", cards);
    assert!(
        refused(refusal)
            .1
            .starts_with("A QR code is printed on a sheet only.")
    );
}

#[test]
fn the_page_size_chooses_the_layout_of_share_cards_and_a_conflict_is_refused() {
    let resolved = SskrLayout::resolved;
    let layout = |requested, size| resolved(requested, size).expect("a layout");
    let (qr, collection, individual) = (
        SskrLayout::Qr,
        SskrLayout::Collection,
        SskrLayout::Individual,
    );
    assert_eq!(layout(None, None), collection);
    assert_eq!(layout(None, Some(PageSize::A4)), collection);
    assert_eq!(layout(None, Some(PageSize::Business)), individual);
    assert_eq!(layout(Some(individual), None), individual);
    // A QR card holds one whole share and exists in every size.
    for size in [None, Some(PageSize::A6), Some(PageSize::Business)] {
        assert_eq!(layout(Some(qr), size), qr);
    }
    let business = resolved(Some(collection), Some(PageSize::Business));
    assert!(refused(business).1.contains("gives separate cards"));
    let sheet_size = resolved(Some(individual), Some(PageSize::A6));
    assert!(
        refused(sheet_size)
            .1
            .contains("Separate cards have the business size")
    );
}

/// Share cards of `template_id` in colors, drawn with `settings`.
fn share_options(
    template_id: &str,
    layout: Option<SskrLayout>,
    settings: CardSettings,
) -> ShareCardOptions {
    ShareCardOptions {
        template: template(template_id),
        layout,
        share_format: ShareFormat::Colors,
        title: None,
        settings,
    }
}

#[test]
fn a_card_size_gives_a_share_one_page_for_each_card_and_its_decoys() {
    let drawing = CardDrawing::new();
    let options = share_options("business-it", None, page(Some(PageSize::Business), None));
    let set = ShareCardSet::create(&drawing, &mut first_choices(), &SET_SHARES, &options);
    let set = set.expect("the cards");
    assert_eq!(set.layout(), SskrLayout::Individual);
    let documents: usize = set.shares().map(|share| share.documents).sum();
    let own: usize = (0..SET_SHARES.len())
        .map(|place| set.own_codes(place).expect("a share"))
        .sum();
    assert!(documents > own);
    // The cards of the first share: a page of a card each, its decoy included.
    let cards = set
        .render_share(&drawing, &mut first_choices(), 0)
        .expect("the cards");
    let first_share = set.shares().next().expect("a share").documents;
    assert_eq!(
        cards.iter().map(millimetres).collect::<Vec<_>>(),
        vec![(90.0, 50.0); first_share]
    );
}

#[test]
fn the_qr_card_of_a_share_is_a_compact_sheet_of_the_business_size() {
    let drawing = CardDrawing::new();
    let options = share_options(
        "business-it",
        Some(SskrLayout::Qr),
        page(Some(PageSize::Business), None),
    );
    let shares = &SET_SHARES[..2];
    let set = ShareCardSet::create(&drawing, &mut first_choices(), shares, &options);
    let set = set.expect("the cards");
    let pages = pages_of(&set, &drawing);
    // One page for every share, each with its whole share in a QR code of its own.
    assert_eq!(pages.len(), shares.len());
    assert_eq!(set.qr_codes().len(), shares.len());
    for ((sheet, code), record) in pages.iter().zip(set.qr_codes()).zip(shares) {
        let share = read_share(record).expect("a public share").share;
        let written = ShareFormat::Colors.write(&share);
        assert_eq!(code.payload, written.as_str());
        assert_eq!(millimetres(sheet), (90.0, 50.0));
        assert_eq!(read_drawn_qr(sheet), code.payload);
    }
    // This is the only use of the compact sheet.
    let code = matrix("payload").expect("a QR code");
    let compact = |size| {
        let layout = layout_of((size, None), (1, 1.8), &|_, _| 1, Some(&code));
        layout.expect("a layout").compact
    };
    assert!(compact(PageSize::Business));
    assert!(!compact(PageSize::A6));
}

#[test]
fn a_sheet_tells_the_order_of_its_preference_in_the_words_of_its_rule() {
    assert_eq!(MIN_SHEET_ROWS, 3);
    assert_eq!(SHEET_PLAN_TEXT, "at least three rows, the largest cards");
}

/// Expects the `count` cards of `layout`, with their captions and its QR code, to overlap nothing.
fn assert_kept_apart(layout: &StudyLayout, count: usize) {
    let metrics = &layout.metrics;
    let line = metrics.line_height;
    let indexes: Vec<usize> = layout.cards.iter().map(|place| place.index).collect();
    assert_eq!(indexes, (0..count).collect::<Vec<_>>());
    for place in &layout.cards {
        assert!(place.x >= metrics.margin - SLACK);
        assert!(place.y >= metrics.heading_height - SLACK);
        assert!(place.x + place.width <= layout.width - metrics.margin + SLACK);
        let bottom = place.caption_top + line;
        assert!(bottom <= layout.height - metrics.footer + SLACK);
        if let Some(qr) = layout.qr {
            // Landscape sheets keep the cells left of the QR code; portrait sheets start below it
            // and its one-line caption.
            let right = (place.x + place.width).max(place.caption_x + place.caption_width);
            assert!(right <= qr.x || place.y >= qr.y + qr.size + line);
        }
        for other in layout
            .cards
            .iter()
            .filter(|other| other.index != place.index)
        {
            assert!(
                place.caption_x + place.caption_width <= other.caption_x
                    || other.caption_x + other.caption_width <= place.caption_x
                    || bottom <= other.y
                    || other.caption_top + line <= place.y
            );
        }
    }
}

#[test]
fn a_sheet_keeps_artwork_captions_and_qr_code_apart_at_every_count_that_fits() {
    let payload = colors_of((0..24).map(|index| index * 73 + 1)).join(" ");
    let code = matrix(&payload).expect("a QR code");
    let sizes = [PageSize::Business, PageSize::A6, PageSize::A4];
    for size in sizes {
        for orientation in Orientation::ALL {
            for cards in 1..=MAX_SHEET_CARDS {
                for qr in [None, Some(&code)] {
                    let turned = (size, Some(orientation));
                    match layout_of(turned, (cards, 1.8), &|_, _| 1, qr) {
                        Ok(layout) => assert_kept_apart(&layout, cards),
                        Err(error) => {
                            // A6 and A4 take every count; a business card only what it has room for.
                            assert_eq!((size, cards > 16), (PageSize::Business, true));
                            assert_eq!(error.code(), "export.collection-layout.no-room");
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn a_sheet_fills_every_row_where_a_count_of_columns_can_with_the_largest_cards() {
    let sheet = (PageSize::A6, PORTRAIT);
    let layout = layout_of(sheet, (28, 1.8), &|_, _| 1, None).expect("a layout");
    assert_eq!((layout.columns, layout.rows), (4, 7));
    assert_eq!(28 % layout.columns, 0);
    // 13 fills its rows only in one column, too narrow here: then the largest cards of any.
    let thirteen = layout_of(sheet, (13, 1.8), &|_, _| 1, None).expect("a layout");
    assert_ne!(13 % thirteen.columns, 0);
}

#[test]
fn a_sheet_is_planned_with_a_decoy_and_full_rows_in_the_orientation_given() {
    let drawing = CardDrawing::new();
    let colors = colors_of((0..24).map(|index| index * 85));
    let pool = phrase_cards(&colors)
        .with_decoy_pool(&mut first_choices())
        .expect("the decoys");
    let (own, most) = (colors.len(), pool.codes.colors.len());
    let a6 = PageSize::A6;
    template("business-it")
        .with_sheet_shape(&drawing, &pool, a6, |shape| {
            let plan = plan_collection_sheet((a6, None), own, most, shape, None)?;
            assert!(plan.count > own);
            assert!(plan.count <= own + MAX_DECOYS);
            let turned = (a6, Some(plan.orientation));
            let drawn = layout_of(turned, (plan.count, shape.aspect), &|_, _| 1, None)?;
            assert_eq!(plan.count % drawn.columns, 0);
            // An orientation given is kept.
            for orientation in Orientation::ALL {
                let given = (a6, Some(orientation));
                let plan = plan_collection_sheet(given, 16, most, shape, None)?;
                assert_eq!(plan.orientation, orientation);
            }
            Ok(())
        })
        .expect("a plan");
}

#[test]
fn a_long_name_under_a_card_takes_two_lines_rather_than_small_print() {
    let drawing = CardDrawing::new();
    let font: &UiFont = &drawing.font;
    let size = 8.0;
    let captions = [
        ["01  016451", "Racing green anodised"],
        ["02  1AE090", "Teal"],
        ["03  0A0B0C", "Unbreakablelongname"],
    ]
    .map(|lines| lines.map(str::to_owned).to_vec());
    let room = StudyCaptions::new(font, &captions);
    let name = font.width("Racing green anodised", size) / MM;
    // Wide enough: every line keeps its size on one line.
    assert_eq!(room.lines(name + 1.0, size), 2);
    assert_eq!(room.wrapped(0, name + 1.0, size), captions[0]);
    // Narrower: the name takes two lines, split where the halves balance best.
    assert_eq!(room.lines(name - 1.0, size), 3);
    assert_eq!(
        room.wrapped(0, name - 1.0, size),
        ["01  016451", "Racing green", "anodised"]
    );
    assert_eq!(room.wrapped(1, name - 1.0, size), captions[1]);
    // A single word cannot be split, and the line with the code never is.
    assert_eq!(room.wrapped(2, 1.0, size), captions[2]);
    // A column may be narrower than the whole name at the least size, as its halves fit.
    let whole = ["Unbreakablelongname", "Racing green anodised", "01  016451"];
    let halves = ["Unbreakablelongname", "Racing green", "01  016451"];
    assert!(room.minimum_width() < caption_width(&drawing, &whole) + 1.0);
    assert!(room.minimum_width() >= caption_width(&drawing, &halves));
}

#[test]
fn a_sheet_gives_split_names_the_room_they_take() {
    let a4 = (PageSize::A4, PORTRAIT);
    let lines = |width: f64, _size: f64| if width < 50.0 { 3 } else { 2 };
    // Twenty cards take columns narrower than 50 mm, whose names take three lines and leave less
    // room for each card, so the layout weighs them so.
    let split = layout_of(a4, (20, 1.2), &lines, None).expect("a layout");
    let fixed = layout_of(a4, (20, 1.2), &|_, _| 2, None).expect("a layout");
    assert!(split.cards[0].height < fixed.cards[0].height);
    // Twelve cards take wider columns, whose names keep two lines.
    let wide = layout_of(a4, (12, 1.2), &lines, None).expect("a layout");
    let same = layout_of(a4, (12, 1.2), &|_, _| 2, None).expect("a layout");
    assert_eq!(format!("{wide:?}"), format!("{same:?}"));
}

/// Where across the page the joints of `backdrop` run, in millimetres: concrete draws them as a dark
/// line and a light one, of which the dark one counts, tiles as their own left edges.
fn joints_of(page: &Page, backdrop: MaterialBackdrop) -> Vec<f64> {
    let across = |step: &Step| match (backdrop, step) {
        (MaterialBackdrop::Concrete, Step::Stroke { path, .. }) => match path.as_slice() {
            [Segment::Move(x, _), Segment::Line(end, _)] if x == end => Some(x / MM),
            _ => None,
        },
        (MaterialBackdrop::Tiled, Step::Fill { path, .. }) => match path.as_slice() {
            [Segment::Move(x, _), ..] => Some(x / MM),
            _ => None,
        },
        _ => None,
    };
    let every: Vec<f64> = page.steps.iter().filter_map(across).collect();
    let step = if backdrop == MaterialBackdrop::Concrete {
        2
    } else {
        1
    };
    every.into_iter().step_by(step).collect()
}

#[test]
fn the_joints_of_a_backdrop_lie_between_the_cards_on_every_page_size() {
    let sheets = [
        (PageSize::A5, PORTRAIT),
        (PageSize::A5, LANDSCAPE),
        (PageSize::A6, LANDSCAPE),
        (PageSize::A4, PORTRAIT),
    ];
    for sheet in sheets {
        let layout = layout_of(sheet, (16, 1.0), &|_, _| 2, None).expect("a layout");
        let grid = layout.grid;
        for backdrop in [MaterialBackdrop::Concrete, MaterialBackdrop::Tiled] {
            let mut drawn = Page::new(layout.width, layout.height);
            draw_material_backdrop(&mut drawn, backdrop, layout.width, layout.height, grid);
            let joints = joints_of(&drawn, backdrop);
            assert!(!joints.is_empty(), "{backdrop:?} {sheet:?}");
            for x in joints {
                let along = (x - grid.left) / grid.column_pitch;
                // Within the grout of half a millimetre of a joint between two columns of cards.
                let off = (along - along.round()).abs() * grid.column_pitch;
                assert!(off < 0.5, "{backdrop:?} {sheet:?} at {x}");
            }
        }
    }
}

#[test]
fn a_business_size_proposal_of_every_design_holds_one_whole_qr_code_and_every_code() {
    let drawing = CardDrawing::new();
    assert_eq!(CARD_TEMPLATES.len(), 13);
    let settings = CardSettings {
        presentation: Some(studio("REVIEW STUDIO")),
        card_qr: true,
        ..page(Some(PageSize::Business), LANDSCAPE)
    };
    let cards = unicode_cards(settings);
    let code = matrix(&cards.codes.payload).expect("a QR code");
    for design in CARD_TEMPLATES {
        let pages = sheet_pages(&drawing, design.id, &cards);
        assert_eq!(pages.len(), 1, "{}", design.id);
        assert_eq!(millimetres(&pages[0]), (90.0, 50.0), "{}", design.id);
        // One code of the whole payload, every module of it once.
        assert_eq!(
            drawn_modules(&pages[0]),
            dark_modules(&code),
            "{}",
            design.id
        );
        assert_eq!(
            read_drawn_qr(&pages[0]),
            cards.codes.payload,
            "{}",
            design.id
        );
        let labels = texts(&pages[0]);
        assert!(labels.contains(&"REVIEW STUDIO"), "{}", design.id);
        assert!(
            labels.contains(&"DESIGN STUDY / FOR SELECTION"),
            "{}",
            design.id
        );
        assert!(
            labels.iter().any(|label| label.starts_with("Series ")),
            "{}",
            design.id
        );
        let codes = cards.codes.labels.as_ref().expect("Unicode codes");
        for (index, code) in codes.iter().enumerate() {
            let number = format!("{:02}  {code}", index + 1);
            assert!(labels.contains(&number.as_str()), "{} {number}", design.id);
        }
    }
}

#[test]
fn the_study_pages_of_shares_keep_one_studio_and_each_its_own_qr_code() {
    let drawing = CardDrawing::new();
    let settings = CardSettings {
        presentation: Some(studio("REVIEW STUDIO")),
        card_qr: true,
        ..page(Some(PageSize::A6), LANDSCAPE)
    };
    let options = share_options("material-vehicle", Some(SskrLayout::Collection), settings);
    let set = ShareCardSet::create(&drawing, &mut first_choices(), &SET_SHARES, &options);
    let set = set.expect("the sheets");
    let pages = pages_of(&set, &drawing);
    assert_eq!(pages.len(), SET_SHARES.len());
    let mut series = Vec::new();
    for (sheet, record) in pages.iter().zip(SET_SHARES) {
        let share = read_share(record).expect("a public share").share;
        assert_eq!(
            read_drawn_qr(sheet),
            ShareFormat::Colors.write(&share).as_str()
        );
        let labels = texts(sheet);
        assert!(labels.contains(&"REVIEW STUDIO"));
        // The footer line carries the slogan, the series of the share and the footer text.
        series.extend(
            labels
                .iter()
                .filter(|label| label.contains("Series "))
                .map(|label| (*label).to_owned()),
        );
    }
    series.sort();
    series.dedup();
    assert_eq!(series.len(), SET_SHARES.len());
}

#[test]
fn the_artwork_and_the_qr_code_of_a_design_stand_together_on_each_sheet() {
    let drawing = CardDrawing::new();
    for id in ["business-it", "material-kitchen"] {
        for size in [PageSize::Business, PageSize::A6, PageSize::A4] {
            for orientation in Orientation::ALL {
                let settings = CardSettings {
                    card_qr: true,
                    ..page(Some(size), Some(orientation))
                };
                let cards = unicode_cards(settings);
                let code = matrix(&cards.codes.payload).expect("a QR code");
                let pages = sheet_pages(&drawing, id, &cards);
                let what = format!("{id} {size:?} {orientation:?}");
                assert_eq!(pages.len(), 1, "{what}");
                let images = count(&pages[0], |step| matches!(step, Step::Image { .. }));
                assert!(images > 0, "{what}");
                assert_eq!(drawn_modules(&pages[0]), dark_modules(&code), "{what}");
                assert_eq!(read_drawn_qr(&pages[0]), cards.codes.payload, "{what}");
            }
        }
    }
}

/// The first color that a sheet of the design `id` paints: its background over the whole page.
fn background_of(drawing: &CardDrawing, id: &str) -> Rgb {
    let settings = CardSettings {
        presentation: Some(studio("REVIEW STUDIO")),
        ..page(Some(PageSize::A6), None)
    };
    let pages = sheet_pages(drawing, id, &unicode_cards(settings));
    pages[0]
        .steps
        .iter()
        .find_map(|step| match step {
            Step::Fill { color, .. } => Some(*color),
            _ => None,
        })
        .expect("a background")
}

#[test]
fn business_cards_and_enclosures_lie_on_the_dark_sheet_and_other_materials_on_their_own() {
    let drawing = CardDrawing::new();
    let dark = rgb(0.043, 0.047, 0.059);
    for id in ["business-it", "business-architect", "material-enclosure"] {
        assert_eq!(background_of(&drawing, id), dark, "{id}");
    }
    // A showroom, a concrete wall, a tiled wall and an oak floor, each over its base color.
    for (id, base) in [
        ("material-vehicle", rgb(0.86, 0.87, 0.88)),
        ("material-switch", rgb(0.8, 0.79, 0.765)),
        ("material-tile", rgb(0.93, 0.92, 0.9)),
        ("material-kitchen", rgb(0.86, 0.8, 0.71)),
    ] {
        assert_eq!(background_of(&drawing, id), base, "{id}");
    }
}

#[test]
fn a_qr_code_that_leaves_no_room_for_the_cards_is_refused() {
    let code = matrix(&"x".repeat(2000)).expect("a QR code");
    let refusal = layout_of(
        (PageSize::Business, None),
        (16, 1.8),
        &|_, _| 1,
        Some(&code),
    );
    assert!(refused(refusal).1.contains("choose a larger page size"));
}

/// What the code of `payload` reads as, drawn at least `minimum` mm wide on a page of `size` mm.
fn drawn_and_read(payload: &str, minimum: f64, (width, height): (f64, f64)) -> String {
    let code = matrix(payload).expect("a QR code");
    let side = qr_size_for_module(&code, minimum, MIN_MODULE_MM).expect("a size");
    let mut drawn = Page::new(width, height);
    draw_collection_qr(&mut drawn, &code, (5.0, 5.0), side, MIN_MODULE_MM).expect("the code");
    read_drawn_qr_at(&drawn, QR_TEST_DPI)
}

#[test]
fn a_drawn_qr_code_reads_as_its_exact_data_at_200_dpi() {
    let record = format!("MNC1:direct:english:{PHRASE}");
    let symbols = "\u{E001}\u{E002}".repeat(16);
    for (payload, minimum) in [
        (
            "#01AB63 #225531 #3E8775 #613911 #7C5809 #98BDC1 #B8E412 #E3AFE8",
            28.0,
        ),
        (record.as_str(), 28.0),
        (symbols.as_str(), 28.0),
        ("#01AB63", 15.0),
    ] {
        assert_eq!(drawn_and_read(payload, minimum, (85.6, 54.0)), payload);
    }
}

#[test]
fn a_verified_qr_code_reads_on_every_sheet_size() {
    let record = format!("MNC1:direct:english:{PHRASE}");
    let share = read_share(LONG_SHARES[0]).expect("a public share").share;
    let written = ShareFormat::Unicode.write(&share);
    for size in [PageSize::A6, PageSize::A5, PageSize::A4] {
        for payload in [record.as_str(), written.as_str()] {
            assert_eq!(
                drawn_and_read(payload, 28.0, size.dimensions(None)),
                payload
            );
        }
    }
}

#[test]
fn a_qr_code_too_small_or_off_its_page_is_refused_before_anything_is_drawn() {
    let code = matrix(&"public transport data ".repeat(10)).expect("a QR code");
    let side = qr_size_for_module(&code, 28.0, MIN_MODULE_MM).expect("a size");
    let mut card = Page::new(90.0, 50.0);
    let small = draw_collection_qr(&mut card, &code, (1.0, 1.0), 5.0, MIN_MODULE_MM);
    assert!(refused(small).1.contains("too small"));
    for corner in [(-1.0, 1.0), (80.0, 1.0)] {
        let outside = draw_collection_qr(&mut card, &code, corner, side, MIN_MODULE_MM);
        assert!(refused(outside).1.contains("does not fit"));
    }
    assert!(card.steps.is_empty());
}
