//! The material designs, as MnemoCode TS 0.1.0's material-cards tests pin them: the samples that a
//! reference shows, the tint that lies on them, and the sheets that a material is printed on.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use std::collections::HashSet;

use common::{
    colors_of, count, first_choices, fixed_details, millimetres, phrase_cards, read_drawn_qr,
    refused, sheet_pages, studio, template, texts,
};
use mnemocode_cards::content::ColorCards;
use mnemocode_cards::export::render_individual_cards;
use mnemocode_cards::scene::{Blend, Page, Segment, Step};
use mnemocode_cards::settings::{CardProfile, CardSettings, Orientation, PageSize, ProfileField};
use mnemocode_cards::templates::material::{
    TINT_OPACITY, choose_material_samples, material_samples, tinted_look,
};
use mnemocode_cards::templates::{CardDrawing, MaterialStyle};

const STYLES: [MaterialStyle; 5] = [
    MaterialStyle::Kitchen,
    MaterialStyle::Vehicle,
    MaterialStyle::Enclosure,
    MaterialStyle::Tile,
    MaterialStyle::Switch,
];
/// The most references a card holds.
const MAX_REFERENCES: usize = 16;
/// The CIE76 distance from which two samples side by side read as different colors, not as one
/// color printed twice; a just noticeable difference is about 2.3.
const MIN_LOOK_DIFFERENCE: f64 = 10.0;
/// Why a material design is not drawn as separate cards.
const SHEETS_ONLY: &str =
    "This design is printed on sheets only: separate cards are made in the business card designs.";
/// How far the middle of a tinted object may lie from the middle of its crop, as a share of it: an
/// outline runs a little beyond some of them, such as the shadow line under a kitchen front.
const CROP_TOLERANCE: f64 = 0.02;

/// The colors of the sheets of these tests: 16, the most of a phrase.
fn material_colors() -> Vec<String> {
    colors_of((0..24).map(|index| index * 73 + 1))
}

/// The design of `style`.
fn design_of(style: MaterialStyle) -> String {
    format!("material-{}", style.name())
}

/// CIE Lab (D65) of a color, computed here independently of the module under test.
fn lab(hex: &str) -> [f64; 3] {
    /// From linear sRGB to XYZ, row by row (IEC 61966-2-1).
    const TO_XYZ: [[f64; 3]; 3] = [
        [0.412_456_4, 0.357_576_1, 0.180_437_5],
        [0.212_672_9, 0.715_152_2, 0.072_175],
        [0.019_333_9, 0.119_192, 0.950_304_1],
    ];
    /// XYZ of the D65 white.
    const WHITE: [f64; 3] = [0.95047, 1.0, 1.08883];
    let digits = hex.trim_start_matches('#');
    let linear = [0, 2, 4].map(|at| {
        let byte = u8::from_str_radix(&digits[at..at + 2], 16).expect("two digits");
        let channel = f64::from(byte) / 255.0;
        if channel <= 0.04045 {
            channel / 12.92
        } else {
            ((channel + 0.055) / 1.055).powf(2.4)
        }
    });
    let [x, y, z] = [0, 1, 2].map(|row| {
        let weighted = (0..3).map(|column| TO_XYZ[row][column] * linear[column]);
        let relative = weighted.sum::<f64>() / WHITE[row];
        if relative > 216.0 / 24389.0 {
            relative.cbrt()
        } else {
            (relative * 24389.0 / 27.0 + 16.0) / 116.0
        }
    });
    [116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z)]
}

#[test]
fn a_material_refuses_a_reference_that_is_not_six_hexadecimal_digits() {
    for invalid in ["123", "#1234567", "oops!!"] {
        let refusal = choose_material_samples(MaterialStyle::Vehicle, &[invalid.to_owned()]);
        assert_eq!(
            refused(refusal).0,
            "export.material-artwork.material-reference-contain-exactly-six-hexadecimal-digits"
        );
    }
}

#[test]
fn every_sample_of_a_material_looks_different_from_the_others() {
    for style in STYLES {
        let samples = material_samples(style).expect("the samples");
        assert!(samples.len() >= MAX_REFERENCES + 8, "{style:?}");
        let labels: HashSet<&String> = samples.iter().map(|sample| &sample.label).collect();
        assert_eq!(labels.len(), samples.len(), "{style:?}");
        for (place, sample) in samples.iter().enumerate() {
            let look = lab(&sample.look);
            for other in &samples[place + 1..] {
                let theirs = lab(&other.look);
                let [dl, da, db] = [0, 1, 2].map(|at| look[at] - theirs[at]);
                let distance = (dl * dl + da * da + db * db).sqrt();
                assert!(
                    distance >= MIN_LOOK_DIFFERENCE,
                    "{} / {}",
                    sample.label,
                    other.label
                );
            }
            if let Some(tint) = sample.tint {
                assert!(sample.finish.surface.is_some(), "{}", sample.label);
                let tinted = tinted_look(sample.finish.color, tint).expect("colors");
                assert_eq!(sample.look, tinted, "{}", sample.label);
            }
        }
    }
}

/// The labels of the samples that `style` shows for `references`.
fn labels_of(style: MaterialStyle, references: &[String]) -> Vec<String> {
    choose_material_samples(style, references)
        .expect("the samples")
        .into_iter()
        .map(|sample| sample.label)
        .collect()
}

#[test]
fn two_different_references_never_share_a_sample_and_one_keeps_its_sample() {
    let colors = material_colors();
    for style in STYLES {
        let mut seed: u64 = 7;
        for _ in 0..200 {
            let codes: Vec<String> = (0..MAX_REFERENCES)
                .map(|_| {
                    seed = (seed * 1_103_515_245 + 12_345) % (1 << 31);
                    format!("#{:06X}", seed % (1 << 24))
                })
                .collect();
            let samples = labels_of(style, &codes);
            for (place, code) in codes.iter().enumerate() {
                for (other, other_code) in codes.iter().enumerate() {
                    assert_eq!(samples[place] == samples[other], code == other_code);
                }
            }
        }
        // Within one collection a reference keeps its sample in any case and order, and when it is
        // repeated. Other references may change it, so this is not checked across collections.
        let reversed: Vec<String> = colors.iter().rev().cloned().collect();
        let lower: Vec<String> = colors.iter().map(|color| color.to_lowercase()).collect();
        let mut backwards = labels_of(style, &reversed);
        backwards.reverse();
        assert_eq!(labels_of(style, &lower), backwards);
        let twice = labels_of(style, &[colors[0].clone(), colors[0].clone()]);
        assert_eq!(labels_of(style, &colors[..1]), twice[..1]);
    }
}

#[test]
fn a_sample_keeps_the_direction_of_the_color_of_its_reference() {
    // Clear colors of every direction, each with its hue in degrees; together on one card.
    let references = [
        ("#B3261E", 36.0),
        ("#E0761C", 60.0),
        ("#E5D222", 96.0),
        ("#5CBD6A", 143.0),
        ("#2AA7A7", 200.0),
        ("#1F08F3", 302.0),
        ("#9C2FB5", 316.0),
    ];
    let codes = references.map(|(code, _)| code.to_owned());
    for style in STYLES {
        let samples = choose_material_samples(style, &codes).expect("the samples");
        for (sample, (_, hue)) in samples.iter().zip(references) {
            let [_, a, b] = lab(&sample.look);
            let look_hue = b.atan2(a).to_degrees();
            let difference = (((look_hue - hue + 540.0) % 360.0) - 180.0).abs();
            assert!(difference <= 45.0, "{style:?}: {}", sample.label);
        }
    }
}

/// The left, right, bottom and top of the points of `path`.
fn extent(path: &[Segment]) -> [f64; 4] {
    let mut sides = [f64::MAX, f64::MIN, f64::MAX, f64::MIN];
    for segment in path {
        if let Segment::Move(x, y) | Segment::Line(x, y) = segment {
            sides = [
                sides[0].min(*x),
                sides[1].max(*x),
                sides[2].min(*y),
                sides[3].max(*y),
            ];
        }
    }
    sides
}

/// The middle of the first ring of the outline `ring`, as a share of the crop `crop` across and
/// down: where the object that a tint covers lies in its sample.
fn middle_in_crop(ring: &[Segment], crop: [f64; 4]) -> (f64, f64) {
    let first: Vec<Segment> = ring
        .iter()
        .copied()
        .take_while(|segment| *segment != Segment::Close)
        .collect();
    let [left, right, bottom, top] = extent(&first);
    let [crop_left, crop_right, crop_bottom, crop_top] = crop;
    (
        (f64::midpoint(left, right) - crop_left) / (crop_right - crop_left),
        (f64::midpoint(bottom, top) - crop_bottom) / (crop_top - crop_bottom),
    )
}

/// A sheet of the design of `style` that shows every one of its samples: a phrase's own cards, and
/// as decoys the looks of as many samples as are left, so that each takes a sample of its own.
fn sheet_of_every_sample(drawing: &CardDrawing, style: MaterialStyle) -> Page {
    let samples = material_samples(style).expect("the samples");
    let own = colors_of(0..12);
    let mut colors = own.clone();
    colors.extend(
        samples[own.len()..]
            .iter()
            .map(|sample| sample.look.clone()),
    );
    let mut cards = phrase_cards(&colors);
    cards.codes.payload = own.join(" ");
    cards.decoys = Some(colors.len() - own.len());
    cards.settings.page_size = Some(PageSize::A4);
    sheet_pages(drawing, &design_of(style), &cards).remove(0)
}

#[test]
fn the_object_of_every_tinted_sample_lies_in_the_middle_of_its_crop() {
    let drawing = CardDrawing::new();
    // The box of the enclosure runs off its photograph.
    for style in STYLES
        .into_iter()
        .filter(|style| *style != MaterialStyle::Enclosure)
    {
        let tints = material_samples(style)
            .expect("the samples")
            .iter()
            .filter(|sample| sample.tint.is_some())
            .count();
        assert!(tints > 0, "{style:?}");
        let sheet = sheet_of_every_sample(&drawing, style);
        let mut crop = [0.0; 4];
        let mut outlines = 0;
        for step in &sheet.steps {
            match step {
                Step::Clip {
                    path,
                    even_odd: false,
                } => crop = extent(path),
                Step::Clip {
                    path,
                    even_odd: true,
                } => {
                    outlines += 1;
                    let (across, down) = middle_in_crop(path, crop);
                    assert!((across - 0.5).abs() < CROP_TOLERANCE, "{style:?} {across}");
                    assert!((down - 0.5).abs() < CROP_TOLERANCE, "{style:?} {down}");
                }
                _ => {}
            }
        }
        assert_eq!(outlines, tints, "{style:?}");
    }
}

#[test]
fn a_tint_lies_on_the_object_of_a_photograph_as_a_color_blend_inside_its_outline() {
    let drawing = CardDrawing::new();
    let colors = material_colors();
    let cards = ColorCards {
        settings: CardSettings {
            page_size: Some(PageSize::A4),
            ..fixed_details()
        },
        ..phrase_cards(&colors)
    };
    for style in STYLES {
        let pages = sheet_pages(&drawing, &design_of(style), &cards);
        let tinted = count(&pages[0], |step| {
            matches!(
                step,
                Step::Fill { blend: Blend::Color, opacity, .. } if *opacity == TINT_OPACITY
            )
        });
        let outlines = count(&pages[0], |step| {
            matches!(step, Step::Clip { even_odd: true, .. })
        });
        // Every tinted sample draws its outline, a clipping path, just before its tint.
        let outlined = pages[0]
            .steps
            .windows(2)
            .filter(|steps| {
                matches!(
                    steps,
                    [
                        Step::Clip { even_odd: true, .. },
                        Step::Fill {
                            blend: Blend::Color,
                            ..
                        }
                    ]
                )
            })
            .count();
        let samples = choose_material_samples(style, &colors).expect("the samples");
        let tints = samples
            .iter()
            .filter(|sample| sample.tint.is_some())
            .count();
        assert!(tints > 0, "{style:?}");
        assert_eq!(
            (tinted, outlines, outlined),
            (tints, tints, tints),
            "{style:?}"
        );
    }
}

#[test]
fn a_material_sheet_honors_both_orientations_on_every_page_size() {
    let drawing = CardDrawing::new();
    let colors = material_colors();
    for (size, (width, height)) in [
        (PageSize::Business, (90.0, 50.0)),
        (PageSize::A6, (148.0, 105.0)),
        (PageSize::A5, (210.0, 148.0)),
        (PageSize::A4, (297.0, 210.0)),
    ] {
        for orientation in Orientation::ALL {
            let cards = ColorCards {
                settings: CardSettings {
                    page_size: Some(size),
                    orientation: Some(orientation),
                    ..fixed_details()
                },
                ..phrase_cards(&colors)
            };
            let pages = sheet_pages(&drawing, "material-vehicle", &cards);
            let wanted = match orientation {
                Orientation::Landscape => (width, height),
                Orientation::Portrait => (height, width),
            };
            assert_eq!(pages.len(), 1, "{size:?}");
            assert_eq!(millimetres(&pages[0]), wanted, "{size:?} {orientation:?}");
        }
    }
}

#[test]
fn a_material_sheet_prints_exact_references_and_finish_names_beside_its_qr_code() {
    let drawing = CardDrawing::new();
    let colors = material_colors();
    let mut profile = CardProfile::default();
    profile.set(ProfileField::Name, "John Smith".to_owned());
    let cards = ColorCards {
        settings: CardSettings {
            page_size: Some(PageSize::A6),
            profile,
            presentation: Some(studio("AURORA STUDIO")),
            card_qr: true,
            ..CardSettings::default()
        },
        ..phrase_cards(&colors)
    };
    let pages = sheet_pages(&drawing, "material-vehicle", &cards);
    assert_eq!(pages.len(), 1);
    let lines = texts(&pages[0]);
    assert!(lines.contains(&"AURORA STUDIO"));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("Prepared for John Smith"))
    );
    assert!(!lines.contains(&"NORTHLINE STUDIO"));
    let whole = lines.join(" ");
    let samples = labels_of(MaterialStyle::Vehicle, &colors);
    for (index, color) in colors.iter().enumerate() {
        let reference = format!("{:02}  {}", index + 1, &color[1..]);
        assert!(lines.contains(&reference.as_str()), "{reference}");
        // A long name may take two lines, drawn one after the other.
        assert!(whole.contains(&samples[index]), "{}", samples[index]);
    }
    assert_eq!(read_drawn_qr(&pages[0]), cards.codes.payload);
}

#[test]
fn a_material_design_prints_a_sheet_of_a6_where_no_page_size_is_given() {
    let drawing = CardDrawing::new();
    let cards = ColorCards {
        settings: fixed_details(),
        ..phrase_cards(&material_colors())
    };
    for style in STYLES {
        let pages = sheet_pages(&drawing, &design_of(style), &cards);
        assert_eq!(millimetres(&pages[0]), (148.0, 105.0), "{style:?}");
    }
}

#[test]
fn a_material_design_draws_no_separate_cards() {
    let drawing = CardDrawing::new();
    let cards = phrase_cards(&material_colors());
    for style in STYLES {
        let design = template(&design_of(style));
        assert!(!design.draws_separate_cards());
        let refusal = render_individual_cards(&drawing, &mut first_choices(), design, &cards);
        assert_eq!(refused(refusal).1, SHEETS_ONLY);
    }
    let card = template("material-switch").draw(&drawing, &mut first_choices(), &cards, Some(2), 0);
    assert_eq!(refused(card).1, SHEETS_ONLY);
    // The business card designs keep theirs.
    assert!(template("business-it").draws_separate_cards());
}

#[test]
fn a_material_sheet_refuses_a_qr_code_of_other_references() {
    let mut cards = phrase_cards(&material_colors());
    // The colors of other word numbers: a readable QR code of other references.
    cards.codes.payload = colors_of((0..24).map(|index| index * 73 + 2)).join(" ");
    let refusal =
        template("material-tile").draw(&CardDrawing::new(), &mut first_choices(), &cards, None, 0);
    assert_eq!(
        refused(refusal).1,
        "Collection QR does not match the printed references."
    );
}
