//! Hidden and ordinary QR layers stay legible and separate from every card design.
#![cfg(test)]
#![cfg(feature = "default")]
#![expect(
    clippy::disallowed_methods,
    reason = "the test saves only public-vector layout previews in its ignored test-output folder"
)]
mod common;

use common::{
    LONG_PHRASE, direct_backup, first_choices, fixed_details, read_drawn_hidden_qr, read_drawn_qr,
};
use mnemocode::forms::Form;
use mnemocode_cards::content::backup_card_content;
use mnemocode_cards::export::{CardJob, render_cards};
use mnemocode_cards::raster::{ImageFormat, page_image};
use mnemocode_cards::scene::{MM, Page, PointRect, Segment, Step, rgb};
use mnemocode_cards::settings::{CardSettings, Orientation, PageSize, ProfileField};
use mnemocode_cards::sheet::QR_PLATE_MARGIN;
use mnemocode_cards::sheet::frame::collection_matrix;
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing};
use std::path::{Path, PathBuf};

/// The renderer rounds vector coordinates only when serializing the final PDF.
const SLACK_POINTS: f64 = 0.001;

#[test]
#[ignore = "All-template QR/readback matrix and public page images; run for card-layout acceptance."]
fn every_sheet_design_keeps_both_qr_layers_clear_of_artwork_and_text() {
    let folder = preview_folder();
    let drawing = CardDrawing::new();
    let mut checked = 0;
    let mut minimum_gap = f64::INFINITY;
    for template in CARD_TEMPLATES {
        for size in [PageSize::A6, PageSize::A5, PageSize::A4] {
            for orientation in Orientation::ALL {
                for form in [Form::Unicode, Form::ColorsUnicode, Form::Colors] {
                    for hidden in [false, true] {
                        let settings = CardSettings {
                            page_size: Some(size),
                            orientation: Some(orientation),
                            card_qr: true,
                            hidden_qr: hidden,
                            ..fixed_details()
                        };
                        let mut settings = settings;
                        for (field, value) in [
                            (ProfileField::Name, "Alex Morgan"),
                            (ProfileField::Role, "Designer"),
                            (ProfileField::Company, "Public Studio"),
                            (ProfileField::Email, "alex@example.com"),
                            (ProfileField::Phone, "+1 202 555 0148"),
                            (ProfileField::Website, "example.com"),
                            (ProfileField::Location, "Test City"),
                        ] {
                            settings.profile.set(field, value.to_owned());
                        }
                        let backup = direct_backup(LONG_PHRASE, form);
                        let cards = backup_card_content(&backup, settings, None).unwrap();
                        let payload = cards.codes.payload.clone();
                        let visible = cards.settings.profile.qr_contact();
                        let code = collection_matrix(&cards).unwrap().unwrap();
                        let pages = render_cards(
                            &drawing,
                            &mut first_choices(),
                            &[CardJob { template, cards }],
                        )
                        .unwrap_or_else(|error| {
                            panic!(
                                "{} {size:?} {orientation:?} {form:?} hidden={hidden}: {error}",
                                template.id
                            )
                        });
                        assert_eq!(pages.len(), 1);
                        let page = &pages[0];
                        let label = format!(
                            "{} {size:?} {orientation:?} {form:?} hidden={hidden}",
                            template.id
                        );
                        minimum_gap = minimum_gap.min(check_clearance(page, &drawing, &label));
                        assert_eq!(
                            common::drawn_modules(page),
                            common::dark_modules(&code),
                            "{label}"
                        );
                        assert_eq!(
                            read_drawn_qr(page),
                            if hidden {
                                visible.as_str()
                            } else {
                                payload.as_str()
                            },
                            "{label}"
                        );
                        if hidden {
                            assert_eq!(read_drawn_hidden_qr(page), payload.as_str(), "{label}");
                        }
                        if hidden && form == Form::Colors && size == PageSize::A6 {
                            save_case(
                                &folder,
                                &drawing,
                                page,
                                &format!("{}-{}", template.id, orientation.name()),
                                &payload,
                                &visible,
                            );
                        }
                        checked += 1;
                    }
                }
            }
        }
    }
    assert_eq!(
        checked,
        CARD_TEMPLATES.len() * 3 * Orientation::ALL.len() * 3 * 2
    );
    let summary =
        serde_json::json!({"layout_cases": checked, "minimum_artwork_gap_mm": minimum_gap / MM});
    std::fs::write(
        folder.join("summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
}

#[test]
fn a_hidden_qr_leaves_room_for_the_narrow_portrait_sheet_heading() {
    let drawing = CardDrawing::new();
    let backup = direct_backup(LONG_PHRASE, Form::Colors);
    let cards = backup_card_content(
        &backup,
        CardSettings {
            page_size: Some(PageSize::A6),
            orientation: Some(Orientation::Portrait),
            card_qr: true,
            hidden_qr: true,
            ..fixed_details()
        },
        None,
    )
    .unwrap();
    let payload = cards.codes.payload.clone();
    let pages = render_cards(
        &drawing,
        &mut first_choices(),
        &[CardJob {
            template: common::template("business-architect"),
            cards,
        }],
    )
    .unwrap();
    assert_eq!(pages.len(), 1);
    check_clearance(&pages[0], &drawing, "A6 portrait hidden QR");
    assert_eq!(read_drawn_hidden_qr(&pages[0]), payload.as_str());
}

fn save_case(
    folder: &Path,
    drawing: &CardDrawing,
    page: &Page,
    base: &str,
    payload: &str,
    visible: &str,
) {
    let png = page_image(&drawing.font, page, ImageFormat::Png).unwrap();
    std::fs::write(folder.join(format!("{base}.png")), &*png).unwrap();
    let pdf = mnemocode_cards::pdf::document(&drawing.font, std::slice::from_ref(page)).unwrap();
    std::fs::write(folder.join(format!("{base}.pdf")), &*pdf).unwrap();
    std::fs::write(folder.join(format!("{base}.payload.txt")), payload).unwrap();
    let plate = qr_plate(page).1;
    let metadata = serde_json::json!({
        "pdf": format!("{base}.pdf"), "payload": format!("{base}.payload.txt"),
        "visible": visible,
        "qr_points_from_top": [plate.x, page.height - plate.y - plate.height, plate.width, plate.height],
    });
    std::fs::write(
        folder.join(format!("{base}.json")),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    )
    .unwrap();
}

fn preview_folder() -> PathBuf {
    let parent = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    for index in 0..1000 {
        let folder = parent.join(format!("hidden-qr-layout-{index}"));
        match std::fs::create_dir(&folder) {
            Ok(()) => return folder,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => panic!("Could not save public layout previews: {error}"),
        }
    }
    panic!("No unused public preview folder");
}

fn qr_plate(page: &Page) -> (usize, PointRect) {
    let first = page.steps.iter().position(|step| matches!(step, Step::Fill { color, opacity, .. } if *color == rgb(0.,0.,0.) && *opacity == 1.)).unwrap();
    let Step::Fill { path, .. } = &page.steps[first - 1] else {
        panic!("QR paper before its modules");
    };
    (first, path_bounds(path))
}

fn path_bounds(path: &[Segment]) -> PointRect {
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    let mut point = |x: f64, y: f64| {
        bounds[0] = bounds[0].min(x);
        bounds[1] = bounds[1].min(y);
        bounds[2] = bounds[2].max(x);
        bounds[3] = bounds[3].max(y);
    };
    for segment in path {
        match segment {
            Segment::Move(x, y) | Segment::Line(x, y) => point(*x, *y),
            Segment::Curve(a, b, c, d, x, y) => {
                point(*a, *b);
                point(*c, *d);
                point(*x, *y);
            }
            Segment::Close => {}
        }
    }
    PointRect {
        x: bounds[0],
        y: bounds[1],
        width: bounds[2] - bounds[0],
        height: bounds[3] - bounds[1],
    }
}

fn intersection(a: PointRect, b: PointRect) -> Option<PointRect> {
    let x = a.x.max(b.x);
    let y = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let top = (a.y + a.height).min(b.y + b.height);
    (right > x && top > y).then_some(PointRect {
        x,
        y,
        width: right - x,
        height: top - y,
    })
}

fn clearance(a: PointRect, b: PointRect) -> f64 {
    let dx = (a.x - b.x - b.width).max(b.x - a.x - a.width).max(0.);
    let dy = (a.y - b.y - b.height).max(b.y - a.y - a.height).max(0.);
    dx.hypot(dy)
}

fn check_clearance(page: &Page, drawing: &CardDrawing, label: &str) -> f64 {
    let (first, plate) = qr_plate(page);
    assert!(
        plate.x >= 0.
            && plate.y >= 0.
            && plate.x + plate.width <= page.width + SLACK_POINTS
            && plate.y + plate.height <= page.height + SLACK_POINTS,
        "{label}"
    );
    let whole = PointRect {
        x: 0.,
        y: 0.,
        width: page.width,
        height: page.height,
    };
    let mut clip = whole;
    let mut stack = Vec::new();
    let mut gap = f64::INFINITY;
    for (index, step) in page.steps.iter().enumerate() {
        match step {
            Step::Save => stack.push(clip),
            Step::Restore => clip = stack.pop().expect("balanced clip stack"),
            Step::Clip { path, .. } => {
                clip = intersection(clip, path_bounds(path)).expect("nonempty test clip");
            }
            Step::Image { place, .. } if index >= first => {
                // Material artwork intentionally overscans its clipped sample.
                // Only the portion surviving the renderer's clip can touch the QR.
                if let Some(visible) = intersection(clip, *place) {
                    let distance = clearance(plate, visible);
                    assert!(
                        distance + SLACK_POINTS >= QR_PLATE_MARGIN * MM,
                        "{label}: visible artwork reaches QR plate"
                    );
                    gap = gap.min(distance);
                }
            }
            Step::Text {
                text, x, y, size, ..
            } => {
                let bounds = PointRect {
                    x: *x,
                    y: y - size * 0.3,
                    width: drawing.font.width(text, *size),
                    height: size * 1.3,
                };
                if let Some(visible) = intersection(clip, bounds) {
                    assert!(
                        clearance(plate, visible) > SLACK_POINTS,
                        "{label}: text reaches QR paper"
                    );
                }
            }
            _ => {}
        }
    }
    assert!(stack.is_empty());
    assert!(gap.is_finite(), "{label}: no artwork");
    gap
}
