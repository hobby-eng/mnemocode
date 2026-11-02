//! Shamir shares against MnemoCode TS 0.1.0 (RUST-14): every answer that the TS repository's
//! `scripts/rust-parity/shares.mjs` and `share-repair.mjs` recorded from its build in
//! vectors/ts-0.1.0/, public shares and fixed changes of them, given again by the Rust modules.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::parse_date;
use mnemocode::forms::Form;
use mnemocode::forms::hints::{WordHint, WordHints};
use mnemocode::modes::Mode;
use mnemocode::random::{Random, RandomError};
use mnemocode::refusal::Refusal;
use mnemocode::search::{Search, Step};
use mnemocode::sskr::export::ShareExport;
use mnemocode::sskr::forms::{ShareFormat, check_share_qr, read_share};
use mnemocode::sskr::joint::{
    JointAssessment, JointAssessor, JointError, JointPlan, JointSearch, NoFitKind, RepairSearch,
    Verdict,
};
use mnemocode::sskr::keeping::{Packaging, share_keeping_note};
use mnemocode::sskr::marks::{exceeds_marks, mark_count, mark_problem};
use mnemocode::sskr::repair::report::{DateWork, RepairReport};
use mnemocode::sskr::restore::{MarkedElement, SetShare, ShareSet};
use mnemocode::sskr::set::read_set;
use mnemocode::sskr::share::Share;
use mnemocode::sskr::split::split_backup;
use mnemocode::sskr::typed::{
    CheckedExport, CompleteOutcome, EachRepair, ShareInput, ShareTrouble, TroubleKind,
    share_word_hints,
};
use serde_json::{Map, Value, json};

mod common;

use common::{close, items, line_value, optional, refused, repairs_list, text, texts};

const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/shares-v1.json");
const RECORDED_REPAIR: &str = include_str!("../../../vectors/ts-0.1.0/share-repair-v1.json");
/// The pace of a recorded report: digest checks a second.
const PACE: f64 = 1_000_000.0;
/// The date search a recorded report adds.
const DATE_WORK: DateWork = DateWork {
    combinations: 3650,
    seconds_each: 0.5,
};
/// The public seed the recorder fills a split's randomness with.
const SEED: u8 = 7;
/// What the recorder calls the host's reader of an encoded phrase.
const DECODE: &str = "Decode";

fn recorded() -> Value {
    // Two refusals name the function that a caller takes, by this library's name for it.
    let written = RECORDED.replace("combineSskrShareSet", "ShareSet::combine");
    serde_json::from_str(&written).expect("the recorded file is JSON")
}

fn recorded_repair() -> Value {
    serde_json::from_str(RECORDED_REPAIR).expect("the recorded file is JSON")
}

fn number(value: &Value) -> usize {
    usize::try_from(value.as_u64().expect("a whole number")).expect("a small number")
}

fn numbers(value: &Value) -> Vec<usize> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(number)
        .collect()
}

/// A share's UR.
fn ur_of(share: &Share) -> String {
    share.ur().as_str().to_owned()
}

/// A share as a repair gives it.
fn share_value(share: &SetShare) -> Value {
    let filled: Vec<Value> = share
        .filled
        .iter()
        .map(|element| json!({ "position": element.position, "value": element.value.as_str() }))
        .collect();
    json!({
        "ur": ur_of(&share.share),
        "format": share.format.name(),
        "repaired": share.repaired(),
        "filled": filled,
    })
}

/// A restored set as the recorder's `setPlain` writes it.
fn set_value(set: &ShareSet) -> Value {
    let unsettled: Vec<Value> = set
        .unsettled()
        .iter()
        .map(|element| json!({ "share": element.share, "position": element.position }))
        .collect();
    json!({
        "mnemonic": set.phrase().text().as_str(),
        "shares": set.shares().iter().map(share_value).collect::<Vec<_>>(),
        "unsettled": unsettled,
        "unchecked": set.unchecked(),
        "digestUnchecked": !set.digest_checked(),
    })
}

/// A set's facts, as the recorder's `setFacts` writes them.
fn set_facts(set: &ShareSet) -> Value {
    let named: Vec<usize> = (0..set.shares().len()).map(|index| index + 3).collect();
    let mut facts = set_value(set);
    let groups: Vec<Value> = set
        .groups()
        .iter()
        .map(|group| {
            json!({
                "index": group.index,
                "threshold": group.threshold,
                "members": group.members,
            })
        })
        .collect();
    let more = json!({
        "digestChecked": set.digest_checked(),
        "checked": set.checked(),
        "groupThreshold": set.group_threshold(),
        "groupCount": set.group_count(),
        "groups": groups,
        "secretBytes": set.secret_bytes(),
        "wordCount": set.word_count(),
        "note": optional(set.unchecked_note(Some(&named))),
        "plainNote": optional(set.unchecked_note(None)),
    });
    let object = facts.as_object_mut().expect("an object");
    object.extend(more.as_object().expect("an object").clone());
    facts
}

/// A trouble as the recorder writes it, the cause left out: Rust's message carries what it says.
fn trouble_value(trouble: &ShareTrouble) -> Value {
    let kind = match trouble.kind {
        TroubleKind::Unreadable => "unreadable",
        TroubleKind::Odd => "odd",
        TroubleKind::Few => "few",
        TroubleKind::Refused => "refused",
    };
    let code = trouble.code.code().trim_start_matches("sskr.share-input.");
    let mut value = json!({ "kind": kind, "code": code, "message": trouble.message });
    if let Some(place) = trouble.place {
        value["place"] = json!(place);
    }
    value
}

/// A recorded trouble without its cause.
fn without_cause(recorded: &Value) -> Value {
    let mut value = recorded.clone();
    if let Some(object) = value.as_object_mut() {
        object.remove("cause");
    }
    value
}

#[test]
fn every_form_says_what_ts_says_of_it() {
    let recorded = recorded();
    for entry in items(&recorded["forms"]) {
        if let Some(form) = entry.get("form") {
            let form = Form::named(text(form)).unwrap();
            assert_eq!(
                ShareFormat::mirroring(form).name(),
                text(&entry["mirroring"])
            );
            continue;
        }
        let format = ShareFormat::named(text(&entry["format"])).unwrap();
        assert_eq!(format.label(), text(&entry["name"]));
        assert_eq!(format.mirrored().name(), text(&entry["mirrored"]));
        assert_eq!(format.is_color(), entry["color"].as_bool().unwrap());
        assert_eq!(format.has_cards(), entry["cards"].as_bool().unwrap());
        let cards = format
            .check_has_cards()
            .err()
            .map_or(Value::Null, |error| refused(&error));
        assert_eq!(cards, entry["cardsRefusal"]);
    }
    assert_eq!(ShareFormat::DEFAULT.name(), "ur");
}

#[test]
fn shares_are_written_and_read_as_ts_does() {
    let recorded = recorded();
    for entry in items(&recorded["reads"]["written"]) {
        let share = read_share(text(&entry["ur"])).unwrap().share;
        let format = ShareFormat::named(text(&entry["format"])).unwrap();
        assert_eq!(format.write(&share).as_str(), text(&entry["text"]));
    }
    for entry in items(&recorded["reads"]["read"]) {
        let typed = text(&entry["text"]);
        match read_share(typed) {
            Ok(read) => {
                assert_eq!(ur_of(&read.share), text(&entry["ur"]), "{typed}");
                assert_eq!(read.format.name(), text(&entry["format"]), "{typed}");
            }
            Err(error) => assert_eq!(refused(&error), entry["refused"], "{typed}"),
        }
    }
}

/// The URs of `texts` read together, or the refusal, as the recorder writes them.
fn set_read(texts: &[String], require_quorum: bool) -> Value {
    match read_set(texts, require_quorum) {
        Ok(read) => {
            let urs: Vec<String> = read.iter().map(|read| ur_of(&read.share)).collect();
            json!({ "urs": urs })
        }
        Err(error) => json!({ "refused": refused(&error) }),
    }
}

#[test]
fn sets_are_checked_and_restored_as_ts_does() {
    let recorded = recorded();
    for entry in items(&recorded["sets"]) {
        let shares = texts(&entry["texts"]);
        assert_eq!(set_read(&shares, true), entry["valid"], "{shares:?}");
        assert_eq!(set_read(&shares, false), entry["loose"], "{shares:?}");
        let listed: Vec<usize> = (0..shares.len()).map(|index| index + 3).collect();
        let restored = match ShareSet::combine(&shares, Some(&listed)) {
            Ok(set) => set_facts(&set),
            Err(error) => json!({ "refused": refused(&error) }),
        };
        assert_eq!(restored, entry["restored"], "{shares:?}");
        let phrase = match ShareSet::combine_phrase(&shares) {
            Ok(phrase) => json!({ "phrase": phrase.text().as_str() }),
            Err(error) => json!({ "refused": refused(&error) }),
        };
        assert_eq!(phrase, entry["phrase"], "{shares:?}");
    }
}

#[test]
fn marks_are_counted_and_refused_as_ts_does() {
    let recorded = recorded_repair();
    for entry in items(&recorded["marks"]) {
        let marked = text(&entry["text"]);
        assert_eq!(mark_count(marked), number(&entry["count"]), "{marked}");
        assert_eq!(
            exceeds_marks(marked, 6),
            entry["over"].as_bool().unwrap(),
            "{marked}"
        );
        assert_eq!(optional(mark_problem(marked)), entry["problem"], "{marked}");
    }
}

/// A share repaired alone, as the recorder's `repaired` writes it.
fn repair_of(typed: &str) -> Value {
    let mut input = ShareInput::new(DECODE);
    input.add(&[typed]).unwrap();
    match input.repair_each() {
        EachRepair::Repaired(shares) => {
            json!({ "shares": shares.iter().map(share_value).collect::<Vec<_>>() })
        }
        EachRepair::Variants {
            variants, message, ..
        } => json!({
            "variants": variants.iter().map(share_value).collect::<Vec<_>>(),
            "message": message,
        }),
        EachRepair::Unreadable { message, code, .. } => {
            json!({ "message": message, "code": code })
        }
    }
}

#[test]
#[ignore = "a replay of about 1,000 recorded repairs, some 12 s: it runs at release"]
fn one_share_is_repaired_as_ts_repairs_it() {
    let recorded = recorded_repair();
    for entry in items(&recorded["repairs"]) {
        let typed = text(&entry["text"]);
        let mut expected = entry.clone();
        expected.as_object_mut().unwrap().remove("text");
        assert_eq!(repair_of(typed), expected, "{typed}");
    }
}

/// A verdict as the recorder writes it.
const fn verdict_name(verdict: Verdict) -> &'static str {
    match verdict {
        Verdict::Determined => "determined",
        Verdict::Search => "search",
        Verdict::TooUncertain => "too-uncertain",
        Verdict::NoFit(_) => "no-fit",
        Verdict::NotEnough => "not-enough",
        Verdict::Stopped => "stopped",
    }
}

/// Checks `assessment`, field by field, against the recorder's.
fn check_assessment(assessment: &JointAssessment, entry: &Value, name: &str) {
    let shares: Vec<Value> = assessment
        .shares
        .iter()
        .map(|share| {
            let forms: Vec<&str> = share.forms.iter().map(|form| form.name()).collect();
            json!({ "marks": share.marks, "forms": forms, "openAlone": share.open_alone })
        })
        .collect();
    assert_eq!(json!(shares), entry["shares"], "{name}");
    let optional_number = |value: Option<usize>| value.map_or(Value::Null, |value| json!(value));
    let absent = Value::Null;
    let field = |key: &str| entry.get(key).unwrap_or(&absent).clone();
    assert_eq!(
        optional_number(assessment.secret_bytes),
        field("secretBytes"),
        "{name}"
    );
    assert_eq!(
        optional_number(assessment.threshold),
        field("threshold"),
        "{name}"
    );
    assert_eq!(assessment.branches, number(&entry["branches"]), "{name}");
    assert_eq!(assessment.open_bits, number(&entry["openBits"]), "{name}");
    assert!(
        close(assessment.combinations, &entry["combinations"]),
        "{name}"
    );
    assert!(
        close(assessment.expected_false, &entry["expectedFalse"]),
        "{name}"
    );
    assert_eq!(
        assessment.more_shares,
        number(&entry["moreShares"]),
        "{name}"
    );
    let helps: Vec<Value> = assessment
        .helps
        .iter()
        .map(|help| {
            json!({
                "share": help.element.share,
                "position": help.element.position,
                "openBits": help.open_bits,
            })
        })
        .collect();
    assert_eq!(json!(helps), entry["helps"], "{name}");
    assert_eq!(optional_number(assessment.unfit), field("unfit"), "{name}");
    assert_eq!(
        verdict_name(assessment.verdict),
        text(&entry["verdict"]),
        "{name}"
    );
    let no_fit = match assessment.verdict {
        Verdict::NoFit(NoFitKind::ShareUnreadable) => json!("share-unreadable"),
        Verdict::NoFit(NoFitKind::SeveralGroups) => json!("several-groups"),
        Verdict::NoFit(NoFitKind::SharesDoNotFit) => json!("shares-do-not-fit"),
        _ => Value::Null,
    };
    assert_eq!(no_fit, field("noFit"), "{name}");
    assert_eq!(
        optional(assessment.reason.clone()),
        field("reason"),
        "{name}"
    );
}

/// Checks the report of `assessment` against the recorder's.
fn check_report(assessment: &JointAssessment, places: &[usize], entry: &Value, name: &str) {
    let report = RepairReport::new(assessment.clone(), PACE, Some(places)).expect("a pace");
    let lines: Vec<Value> = report.lines().iter().map(line_value).collect();
    assert_eq!(json!(lines), entry["lines"], "{name}");
    assert!(close(report.seconds(None), &entry["seconds"]), "{name}");
    assert!(
        close(report.seconds(Some(DATE_WORK)), &entry["secondsWithDates"]),
        "{name}"
    );
    assert_eq!(
        report.needs_question(None, None, None),
        entry["needsQuestion"].as_bool().unwrap(),
        "{name}"
    );
    assert_eq!(
        report.needs_question(Some(1000), None, None),
        entry["needsQuestionLimit"].as_bool().unwrap(),
        "{name}"
    );
    assert_eq!(
        report.needs_question(None, Some(DATE_WORK), Some(100)),
        entry["needsQuestionDates"].as_bool().unwrap(),
        "{name}"
    );
    assert_eq!(
        report.search_question(None),
        text(&entry["question"]),
        "{name}"
    );
    assert_eq!(
        report.search_question(Some(DATE_WORK)),
        text(&entry["questionWithDates"]),
        "{name}"
    );
    assert_eq!(report.search_extent(None), text(&entry["extent"]), "{name}");
    assert_eq!(report.search_notice(None), text(&entry["notice"]), "{name}");
    assert_eq!(
        report.search_notice(Some(DATE_WORK)),
        text(&entry["noticeWithDates"]),
        "{name}"
    );
}

/// The repairs of `set`, as the recorder writes them.
fn repairs_value(set: &ShareSet, places: &[usize]) -> Value {
    let list = repairs_list(&RepairReport::repairs(set, Some(places)));
    let lines: Vec<Value> = RepairReport::repair_lines(set, Some(places))
        .iter()
        .map(line_value)
        .collect();
    json!({ "list": list, "lines": lines })
}

/// The plan of `shares` assessed a piece at a time, as a host steps it.
fn stepped_plan(shares: &[String], listed: &[usize]) -> Result<JointPlan, JointError> {
    let mut assessor = JointAssessor::new(shares, Some(listed))?;
    while let Step::Running(_) = assessor.step(1)? {}
    Ok(assessor.finish())
}

/// What `search` finds stepped one try at a time, its counts held to its size.
fn stepped_search(mut search: JointSearch) -> RepairSearch {
    let size = search.size();
    let mut tries = 0;
    loop {
        let step = search.step(1).expect("a search");
        tries += 1;
        let progress = step.progress();
        assert_eq!(progress.checked, tries);
        assert_eq!(progress.total, Some(size.candidates));
        if matches!(step, Step::Done(_)) {
            assert_eq!(tries, size.candidates);
            return search.finish();
        }
    }
}

#[test]
#[ignore = "a replay of 88 recorded lists of shares, some 10 s: it runs at release"]
fn shares_together_are_assessed_reported_and_searched_as_ts_does() {
    let recorded = recorded_repair();
    for entry in items(&recorded["joint"]) {
        let shares = texts(&entry["texts"]);
        let name = format!("{shares:?}");
        let listed: Vec<usize> = (0..shares.len()).map(|index| index + 2).collect();
        let plan = match stepped_plan(&shares, &listed) {
            Ok(plan) => plan,
            Err(error) => {
                assert_eq!(refused(&error), entry["refused"], "{name}");
                continue;
            }
        };
        check_assessment(&plan.assessment, &entry["assessment"], &name);
        check_report(&plan.assessment, &listed, &entry["report"], &name);
        let Some(recorded_sets) = entry.get("sets") else {
            continue;
        };
        let found = stepped_search(plan.search().expect("a plan with a search"));
        assert!(!found.stopped);
        let sets: Vec<Value> = found.sets.iter().map(set_value).collect();
        assert_eq!(json!(sets), *recorded_sets, "{name}");
        let repairs: Vec<Value> = found
            .sets
            .iter()
            .map(|set| repairs_value(set, &listed))
            .collect();
        assert_eq!(json!(repairs), entry["repairs"], "{name}");
    }
}

#[test]
fn a_search_stopped_after_a_find_keeps_it_and_says_it_stopped() {
    let recorded = recorded_repair();
    let mut stopped = 0;
    for entry in items(&recorded["joint"]) {
        let found_one = entry.get("sets").is_some_and(|sets| items(sets).len() == 1);
        if !found_one || number(&entry["assessment"]["branches"]) < 2 {
            continue;
        }
        let shares = texts(&entry["texts"]);
        let plan = stepped_plan(&shares, &[2, 3]).expect("a plan");
        let mut search = plan.search().expect("a plan with a search");
        let step = loop {
            let step = search.step(1).expect("a search");
            if step.progress().found == 1 || matches!(step, Step::Done(_)) {
                break step;
            }
        };
        let found = search.finish();
        assert_eq!(found.sets.len(), 1);
        assert_eq!(found.stopped, matches!(step, Step::Running(_)));
        stopped += usize::from(found.stopped);
    }
    assert!(stopped > 0);
}

/// The parts of an answer, or the refusal, as the recorder writes them.
fn listed_or_refused<E: Refusal>(result: Result<Vec<String>, E>, key: &str) -> Value {
    let mut value = Map::new();
    match result {
        Ok(parts) => value.insert(key.to_owned(), json!(parts)),
        Err(error) => value.insert("refused".to_owned(), refused(&error)),
    };
    Value::Object(value)
}

/// Each share repaired alone, as the recorder's `each` writes it.
fn each_value(input: &ShareInput) -> Value {
    match input.repair_each() {
        EachRepair::Repaired(shares) => json!({
            "kind": "repaired",
            "shares": shares.iter().map(share_value).collect::<Vec<_>>(),
        }),
        EachRepair::Variants {
            place,
            variants,
            message,
        } => json!({
            "kind": "variants",
            "place": place,
            "count": variants.len(),
            "message": message,
        }),
        EachRepair::Unreadable {
            place,
            message,
            code,
        } => json!({ "kind": "unreadable", "place": place, "message": message, "code": code }),
    }
}

/// A share typed again, as the recorder writes it, without what only names the text.
fn copies_value(copies: &[mnemocode::sskr::typed::ShareCopy]) -> Value {
    let copies: Vec<Value> = copies
        .iter()
        .map(|copy| json!({ "place": copy.place, "of": copy.of, "message": copy.message }))
        .collect();
    json!(copies)
}

/// Checks a list of shares through the readings and checks of the shares as typed.
fn check_typed(entry: &Value) {
    let answer = text(&entry["answer"]);
    let input = ShareInput::new(DECODE);
    let parts = ShareInput::parts_of_text(answer);
    assert_eq!(
        listed_or_refused(parts.clone(), "parts"),
        entry["parts"],
        "{answer}"
    );
    assert_eq!(
        listed_or_refused(input.shares_of_text(answer, "The file holds"), "shares"),
        entry["ofText"],
        "{answer}"
    );
    assert_eq!(
        listed_or_refused(input.shares_of_answer(answer, false), "shares"),
        entry["ofAnswer"],
        "{answer}"
    );
    let Some(parts) = parts.ok().filter(|parts| !parts.is_empty()) else {
        return;
    };
    let mut input = input;
    input.add(&parts).unwrap();
    assert_eq!(
        input.marked(),
        entry["marked"].as_bool().unwrap(),
        "{answer}"
    );
    assert_eq!(input.list().len(), items(&entry["problems"]).len());
    for (typed, problem) in input.list().iter().zip(items(&entry["problems"])) {
        let found = input
            .read_problem(typed.place, typed.text.as_str())
            .map_or(Value::Null, |trouble| trouble_value(&trouble));
        assert_eq!(found, without_cause(problem), "{answer}");
    }
    let first = input
        .first_unreadable()
        .map_or(Value::Null, |trouble| trouble_value(&trouble));
    assert_eq!(first, without_cause(&entry["first"]), "{answer}");
    assert_eq!(each_value(&input), entry["each"], "{answer}");
    if input.marked() {
        return;
    }
    let rewritten = match input.rewritten() {
        Ok(shares) => json!({ "shares": shares.iter().map(share_value).collect::<Vec<_>>() }),
        Err(trouble) => json!({ "trouble": trouble_value(&trouble) }),
    };
    let mut expected = entry["rewritten"].clone();
    if let Some(trouble) = expected.get("trouble") {
        expected = json!({ "trouble": without_cause(trouble) });
    }
    assert_eq!(rewritten, expected, "{answer}");
    let (outcome, copies) = input.restore_complete().unwrap();
    let recorded = &entry["restored"];
    assert_eq!(copies_value(&copies), recorded["copies"], "{answer}");
    assert_eq!(json!(input.places()), recorded["places"], "{answer}");
    match outcome {
        CompleteOutcome::Complete {
            set,
            secret_bytes,
            places,
        } => {
            assert_eq!(set_value(&set), recorded["set"], "{answer}");
            assert_eq!(secret_bytes, number(&recorded["secretBytes"]), "{answer}");
            assert_eq!(json!(places), recorded["setPlaces"], "{answer}");
        }
        CompleteOutcome::Trouble(trouble) => assert_eq!(
            trouble_value(&trouble),
            without_cause(&recorded["trouble"]),
            "{answer}"
        ),
    }
}

#[test]
fn shares_as_typed_keep_their_places_and_troubles_as_in_ts() {
    let recorded = recorded();
    for entry in items(&recorded["typed"]["cases"]) {
        check_typed(entry);
    }
    let steps = &recorded["typed"]["steps"];
    let shares = texts(&steps["texts"]);
    let mut input = ShareInput::new(DECODE);
    input.add(&shares[..2]).unwrap();
    input.add(&shares[2..]).unwrap();
    input.leave_out(2);
    input.replace(3, &shares[1]).unwrap();
    let refused_place = input.replace(2, &shares[0]).unwrap_err();
    assert_eq!(refused(&refused_place), steps["refusedPlace"]["refused"]);
    input.add(&shares[2..]).unwrap();
    assert_eq!(json!(input.places()), steps["places"]);
    input.replace_all(&shares[2..]).unwrap();
    assert_eq!(json!(input.places()), steps["after"]);
}

/// The value of an export, as the recorder writes it.
fn export_value(kind: &str, written: &ShareExport, trouble: Option<&ShareTrouble>) -> Value {
    let shown: Vec<Value> = written
        .shown()
        .iter()
        .map(|share| {
            json!({
                "ur": ur_of(&share.share),
                "format": share.format.name(),
                "number": share.number,
            })
        })
        .collect();
    let saved: Vec<usize> = written.saved().iter().map(|share| share.number).collect();
    let forms: Vec<&str> = written.forms().iter().map(|form| form.name()).collect();
    let writings: Vec<String> = written
        .shown()
        .iter()
        .map(|share| share.format.write(&share.share).as_str().to_owned())
        .collect();
    let colors = written.in_form(ShareFormat::Colors);
    let in_colors: Vec<Value> = colors
        .shown()
        .iter()
        .map(|share| json!({ "format": share.format.name(), "number": share.number }))
        .collect();
    json!({
        "kind": kind,
        "trouble": trouble.map_or(Value::Null, trouble_value),
        "shown": shown,
        "saved": saved,
        "forms": forms,
        "leftOut": written.left_out(),
        "messages": written.left_out_messages(),
        "total": written.total(),
        "note": written.copies_note(),
        "text": writings,
        "inColors": in_colors,
    })
}

#[test]
fn shares_are_exported_as_ts_exports_them() {
    let recorded = recorded();
    for entry in items(&recorded["exports"]) {
        let shares: Vec<SetShare> = texts(&entry["shares"])
            .iter()
            .map(|ur| SetShare::from(read_share(ur).unwrap()))
            .collect();
        let unsettled: Vec<MarkedElement> = items(&entry["unsettled"])
            .iter()
            .map(|element| MarkedElement {
                share: number(&element["share"]),
                position: number(&element["position"]),
            })
            .collect();
        let form = entry["form"]
            .as_str()
            .map(|name| ShareFormat::named(name).unwrap());
        let places = numbers(&entry["places"]);
        let outcome = match ShareInput::checked_export(&shares, &unsettled, &places, form) {
            Ok(CheckedExport::Written(written)) => export_value("written", &written, None),
            Ok(CheckedExport::None(written)) => export_value("none", &written, None),
            Ok(CheckedExport::Trouble(written, trouble)) => {
                export_value("trouble", &written, Some(&trouble))
            }
            Err(error) => json!({ "refused": refused(&error) }),
        };
        assert_eq!(outcome, entry["outcome"], "{entry}");
    }
}

/// The recorder's public seed, in place of randomness.
struct Filled;

impl Random for Filled {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        bytes.fill(SEED);
        Ok(())
    }
}

#[test]
fn backups_are_split_and_refused_as_ts_does() {
    let recorded = recorded();
    let phrase = Phrase::parse(mnemocode::self_check::vectors::PUBLIC_MNEMONIC).unwrap();
    for entry in items(&recorded["splits"]) {
        let mode = Mode::named(text(&entry["mode"])).unwrap();
        let date = parse_date(mnemocode::self_check::vectors::MASKED_DATE).unwrap();
        let dates = vec![date; number(&entry["dates"])];
        let (threshold, count) = (number(&entry["threshold"]), number(&entry["count"]));
        let outcome = match split_backup(&phrase, mode, &dates, threshold, count, &mut Filled) {
            Ok(split) => json!({
                "count": split.shares.len(),
                "held": split.held.text().as_str(),
                "original": phrase.text().as_str(),
            }),
            Err(error) => json!({ "refused": refused(&error) }),
        };
        assert_eq!(outcome, entry["outcome"], "{entry}");
    }
}

#[test]
fn keeping_notes_say_what_ts_says() {
    let recorded = recorded();
    for entry in items(&recorded["keeping"]) {
        let shares: Vec<Share> = texts(&entry["records"])
            .iter()
            .map(|ur| read_share(ur).unwrap().share)
            .collect();
        let masked = entry["masked"].as_bool().unwrap();
        // TS names no share before it reads the packaging; a type here settles the packaging first.
        let packaging = if shares.is_empty() {
            Ok(Packaging::File)
        } else {
            Packaging::named(text(&entry["packaging"]))
        };
        let outcome =
            packaging.and_then(|packaging| share_keeping_note(&shares, packaging, masked));
        match outcome {
            Ok(note) => assert_eq!(note, text(&entry["note"]), "{entry}"),
            Err(error) => assert_eq!(refused(&error), entry["refused"], "{entry}"),
        }
    }
}

#[test]
fn a_share_qr_is_checked_as_ts_checks_it() {
    let recorded = recorded();
    for entry in items(&recorded["qr"]) {
        let colors = texts(&entry["colors"]).join(" ");
        let labels = entry["labels"]
            .is_array()
            .then(|| texts(&entry["labels"]).join(" "));
        match check_share_qr(&colors, text(&entry["payload"]), labels.as_deref()) {
            Ok(()) => assert_eq!(entry["fits"], json!(true), "{entry}"),
            Err(error) => assert_eq!(refused(&error), entry["refused"], "{entry}"),
        }
    }
}

#[test]
fn shares_being_typed_are_hinted_as_ts_hints_them() {
    let recorded = recorded();
    let hints = share_word_hints();
    for entry in items(&recorded["hints"]) {
        let line = text(&entry["line"]);
        let hint = match hints.hint(line) {
            WordHint::Nothing => json!({ "kind": "nothing" }),
            WordHint::Count(count, shown) => {
                json!({ "kind": "count", "count": count, "text": shown })
            }
            WordHint::Words(words) => json!({ "kind": "words", "words": words }),
            WordHint::NoWord(shown) => json!({ "kind": "no-word", "text": shown }),
        };
        assert_eq!(hint, entry["hint"], "{line}");
        let completion = hints.completion(line);
        assert_eq!(
            json!({ "letters": completion.letters, "wordEnds": completion.word_ends }),
            entry["completion"],
            "{line}"
        );
    }
}
