//! Cards against MnemoCode TS 0.1.0 (RUST-14): with the fixed sequence of the TS repository's
//! `scripts/rust-parity/cards.mjs` in place of randomness, each design draws the texts and images
//! that its TS build drew, recorded in vectors/ts-0.1.0/, in the same order and at the same places.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

mod common;

use common::Choices;
use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::qr::matrix;
use mnemocode::random::Random;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode_cards::content::{SskrLayout, backup_card_content};
use mnemocode_cards::export::{
    CardJob, ShareCardOptions, ShareCardSet, planned_card_job, render_cards,
    render_individual_cards, separate_card_job,
};
use mnemocode_cards::heir::{
    HeirBackup, HeirRoute, HeirSheetFacts, HeirSheetSize, heir_sheet_text, render_heir_sheet,
};
use mnemocode_cards::scene::{Page, Step};
use mnemocode_cards::settings::{CardProfile, CardSettings, Orientation, PageSize, ProfileField};
use mnemocode_cards::templates::{CardDrawing, select_template};
use serde_json::Value;

const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/cards-v1.json");
/// The recording keeps a millionth of a point.
const TOLERANCE: f64 = 2e-6;
/// The public phrases of the cards.
const SHORT_PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// The recorder's fixed sequence, a Lehmer generator, in place of randomness.
fn sequence() -> Choices<impl FnMut(u32) -> u32> {
    let mut state = 20_261_027_u64;
    Choices::new(move |upper| {
        state = state * 48_271 % 2_147_483_647;
        (state % u64::from(upper)) as u32
    })
}

fn recorded() -> Value {
    serde_json::from_str(RECORDED).expect("the recording reads")
}

fn phrase_of(words: u64) -> Phrase {
    let text = if words == 12 {
        SHORT_PHRASE.to_owned()
    } else {
        format!("{}art", "abandon ".repeat(23))
    };
    Phrase::parse(&text).expect("a public phrase")
}

/// The first place where `pages` leave what TS drew; none where they keep to it.
fn difference(recorded: &Value, pages: &[Page]) -> Option<String> {
    let wanted = recorded.as_array().expect("pages");
    if wanted.len() != pages.len() {
        return Some(format!("{} pages for {}", pages.len(), wanted.len()));
    }
    for (place, (page, want)) in pages.iter().zip(wanted).enumerate() {
        let size = &want["size"];
        let (width, height) = (number(&size[0]), number(&size[1]));
        if (page.width - width).abs() > TOLERANCE || (page.height - height).abs() > TOLERANCE {
            return Some(format!("page {place}: {} x {}", page.width, page.height));
        }
        let steps: Vec<&Step> = page
            .steps
            .iter()
            .filter(|step| matches!(step, Step::Text { .. } | Step::Image { .. }))
            .collect();
        let wanted_steps = want["steps"].as_array().expect("steps");
        for (index, want_step) in wanted_steps.iter().enumerate() {
            let Some(step) = steps.get(index) else {
                return Some(format!("page {place}: ends at {index}, before {want_step}"));
            };
            if !same_step(step, want_step) {
                return Some(format!(
                    "page {place} step {index}: {} for {want_step}",
                    shown(step)
                ));
            }
        }
        if steps.len() != wanted_steps.len() {
            return Some(format!(
                "page {place}: {} steps for {}: {}",
                steps.len(),
                wanted_steps.len(),
                shown(steps[wanted_steps.len()])
            ));
        }
    }
    None
}

fn number(value: &Value) -> f64 {
    value.as_f64().expect("a number")
}

fn close(values: &[f64], recorded: &Value) -> bool {
    let wanted = recorded.as_array().expect("numbers");
    values.len() == wanted.len()
        && values
            .iter()
            .zip(wanted)
            .all(|(value, want)| (value - number(want)).abs() <= TOLERANCE)
}

fn same_step(step: &Step, recorded: &Value) -> bool {
    match step {
        Step::Text {
            text,
            x,
            y,
            size,
            color,
            ..
        } => {
            recorded["text"] == text.as_str()
                && close(&[*x, *y, *size], &recorded["at"])
                && close(&[color.red, color.green, color.blue], &recorded["rgb"])
        }
        Step::Image { place, .. } => close(
            &[place.x, place.y, place.width, place.height],
            &recorded["image"],
        ),
        _ => false,
    }
}

fn shown(step: &Step) -> String {
    match step {
        Step::Text {
            text,
            x,
            y,
            size,
            color,
            ..
        } => format!("{text:?} at {x} {y} size {size} {color:?}"),
        Step::Image { place, .. } => format!("image {place:?}"),
        _ => "another step".to_owned(),
    }
}

fn profile_of(recorded: &Value) -> CardProfile {
    let mut profile = CardProfile::default();
    for (key, field) in [
        ("name", ProfileField::Name),
        ("company", ProfileField::Company),
        ("email", ProfileField::Email),
    ] {
        if let Some(value) = recorded[key].as_str() {
            profile.set(field, value.to_owned());
        }
    }
    profile
}

/// The cards of a recorded case, planned as a save plans them.
fn planned(drawing: &CardDrawing, random: &mut dyn Random, given: &Value) -> CardJob {
    let phrase = phrase_of(given["words"].as_u64().expect("words"));
    let form = Form::named(given["format"].as_str().expect("a form")).expect("a form");
    let encoding = Backup::encode(&phrase, &[], form, Mode::Direct, false).expect("a backup");
    let settings = CardSettings {
        page_size: given["pageSize"]
            .as_str()
            .map(|size| PageSize::parse(Some(size)).expect("a page size")),
        orientation: Orientation::parse(given["turn"].as_str()).expect("a turn"),
        profile: profile_of(&given["profile"]),
        presentation: None,
        card_qr: given["cardQr"] == true,
    };
    let cards = backup_card_content(&encoding.backup, settings, given["title"].as_str())
        .expect("the content");
    let template = select_template(given["template"].as_str()).expect("a design");
    planned_card_job(drawing, random, &CardJob { template, cards }).expect("the plan")
}

fn label(given: &Value) -> String {
    format!(
        "{} {} {} {} {} {}",
        given["template"],
        given["words"],
        given["format"],
        given["pageSize"],
        given["turn"],
        given["layout"]
    )
}

/// Each case of `section`, drawn by `draw`, against what TS drew.
fn replay(section: &str, draw: impl Fn(&CardDrawing, &Value) -> Vec<Page>) {
    let recorded = recorded();
    let drawing = CardDrawing::new();
    let cases = recorded[section].as_array().expect("cases");
    // A section that a recorder left empty would pass here and check nothing.
    assert!(!cases.is_empty(), "{section}: no cases");
    let mut differences = Vec::new();
    for given in cases {
        if let Some(found) = difference(&given["pages"], &draw(&drawing, given)) {
            differences.push(format!("{}: {found}", label(given)));
        }
    }
    assert!(differences.is_empty(), "{}", differences.join("\n"));
}

#[test]
fn the_sheets_of_a_backup_are_those_of_ts() {
    replay("backups", |drawing, given| {
        let mut random = sequence();
        let job = planned(drawing, &mut random, given);
        render_cards(drawing, &mut random, &[job]).expect("the sheets")
    });
}

#[test]
fn separate_cards_are_those_of_ts() {
    replay("separate", |drawing, given| {
        let mut random = sequence();
        let job = planned(drawing, &mut random, given);
        let job = separate_card_job(&job, None).expect("the job");
        render_individual_cards(drawing, &mut random, job.template, &job.cards)
            .expect("the cards")
            .into_iter()
            .flat_map(|document| document.pages)
            .collect()
    });
}

#[test]
fn the_cards_of_shares_are_those_of_ts() {
    let recorded_records = recorded();
    let records: Vec<&str> = recorded_records["records"]
        .as_array()
        .expect("records")
        .iter()
        .map(|record| record.as_str().expect("a record"))
        .collect();
    replay("shares", |drawing, given| {
        let mut random = sequence();
        let options = ShareCardOptions {
            template: select_template(given["template"].as_str()).expect("a design"),
            layout: SskrLayout::parse(given["layout"].as_str()).expect("a layout"),
            share_format: ShareFormat::named(given["shareFormat"].as_str().expect("a form"))
                .expect("a form"),
            title: None,
            settings: CardSettings::default(),
        };
        let set = ShareCardSet::create(drawing, &mut random, &records, &options).expect("the set");
        let mut names = Vec::new();
        let mut pages = Vec::new();
        let shares: Vec<usize> = set.shares().map(|share| share.documents).collect();
        for (place, documents) in shares.into_iter().enumerate() {
            for index in 0..documents {
                let document = set
                    .document(drawing, &mut random, place, index)
                    .expect("a document");
                names.push(document.name);
                pages.extend(document.pages);
            }
        }
        assert_eq!(serde_json::json!(names), given["names"], "{}", label(given));
        pages
    });
}

#[test]
fn the_qr_codes_of_recorded_payloads_have_the_size_that_ts_gives() {
    let recorded = recorded();
    let cases = recorded["qrSizes"].as_array().expect("the cases");
    assert!(!cases.is_empty());
    let mut differences = Vec::new();
    for case in cases {
        let payload = case["payload"].as_str().expect("a payload");
        let size = matrix(payload).expect("a matrix").size();
        if case["size"] != size {
            differences.push(format!("{payload}: {size} modules for {}", case["size"]));
        }
    }
    assert!(differences.is_empty(), "{}", differences.join("\n"));
}

/// The recorder's way through a program to the seed phrase.
struct Route(Value);

/// ", then `dates`", or nothing without dates.
fn then(dates: Option<&str>) -> String {
    dates.map_or_else(String::new, |dates| format!(", then {dates}"))
}

impl HeirRoute for Route {
    fn subtitle(&self) -> String {
        self.0["subtitle"].as_str().expect("a line").to_owned()
    }

    fn address(&self) -> String {
        self.0["address"].as_str().expect("an address").to_owned()
    }

    fn start(&self) -> Vec<String> {
        self.0["start"]
            .as_array()
            .expect("steps")
            .iter()
            .map(|step| step.as_str().expect("a step").to_owned())
            .collect()
    }

    fn decode(&self, mode: Mode, words: usize, dates: Option<&str>) -> Vec<String> {
        vec![format!(
            "Read the {words} codes in {}{}.",
            mode.id(),
            then(dates)
        )]
    }

    fn restore(&self, mode: Mode, threshold: usize, dates: Option<&str>) -> Vec<String> {
        vec![format!(
            "Type {threshold} shares in {}{}.",
            mode.id(),
            then(dates)
        )]
    }

    fn date_digit_help(&self) -> Option<String> {
        self.0["dateDigitHelp"].as_str().map(str::to_owned)
    }
}

fn facts_of(recorded: &Value) -> HeirSheetFacts {
    let backup = &recorded["backup"];
    let size = |key: &str| backup[key].as_u64().expect("a number") as usize;
    HeirSheetFacts {
        backup: if backup["kind"] == "encoded" {
            HeirBackup::Encoded {
                form: Form::named(backup["format"].as_str().expect("a form")).expect("a form"),
                words: size("words"),
            }
        } else {
            HeirBackup::Shares {
                format: ShareFormat::named(backup["format"].as_str().expect("a form"))
                    .expect("a form"),
                threshold: size("threshold"),
                count: size("count"),
                codes: backup["codes"].as_u64().map(|codes| codes as usize),
            }
        },
        mode: Mode::named(recorded["mode"].as_str().expect("a mode")).expect("a mode"),
        dates: recorded["dates"].as_u64().expect("dates") as usize,
    }
}

#[test]
fn sheets_for_heirs_are_those_of_ts() {
    let route = Route(recorded()["route"].clone());
    replay("heirs", |drawing, given| {
        let text = heir_sheet_text(&route, &facts_of(&given["facts"])).expect("the words");
        let size = HeirSheetSize::parse(given["size"].as_str()).expect("a size");
        render_heir_sheet(&drawing.font, &text, size).expect("the sheet")
    });
}
