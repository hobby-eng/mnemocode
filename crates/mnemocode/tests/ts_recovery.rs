//! Recovery against MnemoCode TS 0.1.0 (RUST-14): every answer that the TS repository's
//! `scripts/rust-parity/recovery.mjs` recorded from its build in vectors/ts-0.1.0/, over public
//! phrases, given again by the Rust modules: the places of a phrase, marked codes, the date, word
//! and marked-code searches, how a backup is read, the check of a written backup and the restore of
//! shares in its steps. Times are those of a clock of fixed steps, one second between two reads.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(all(
    feature = "sskr",
    feature = "search-date",
    feature = "search-word",
    feature = "search-marked-codes"
))]

use std::rc::Rc;

use mnemocode::backup::Backup;
use mnemocode::dates::Dates;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::recovery::date_search::{
    DateSearch, MatchLimits, SearchPace, wallet_needed, wallet_reason,
};
use mnemocode::recovery::marked::MissingCodes;
use mnemocode::recovery::marked_search::{MissingCodesResult, MissingCodesSearch, Way, WaySearch};
use mnemocode::recovery::places::{WordSearch, word_place_of};
use mnemocode::recovery::word_search::{
    WordCandidateSearch, WordLimits, unshown_candidates_notice,
};
use mnemocode::search::plan::SearchPlan;
use mnemocode::search::{Search, Step};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

mod common;

use common::{
    close, code_and_message, date_list, fixed_seconds, form_named, items, mode_named, number,
    optional, recorded_recovery as recorded, refused, text, texts, wallet, wallet_of,
};

/// The most candidates a recording shows.
const SHOWN: usize = 8;

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `dates` as DD-MM-YYYY, sorted as they came.
fn written_dates(dates: &Dates) -> Value {
    json!(
        dates
            .iter()
            .map(|date| date.to_string())
            .collect::<Vec<_>>()
    )
}

/// What a report's plan says, as the recorder writes it.
fn plan_value(plan: &SearchPlan) -> Value {
    json!({
        "size": plan.size(),
        "count": plan.count(),
        "seconds": plan.seconds(),
        "ask": plan.ask(),
        "tell": plan.tell(),
        "question": plan.question(),
        "notice": plan.notice(),
        "extent": plan.extent(),
    })
}

/// `plan` held to the recorded one; its seconds, a double, as near as the sum of them lets.
fn check_plan(plan: &SearchPlan, entry: &Value, name: &str) {
    assert!(close(plan.seconds(), &entry["seconds"]), "{name}");
    let mut value = plan_value(plan);
    value["seconds"] = entry["seconds"].clone();
    assert_eq!(value, *entry, "{name}");
}

#[test]
fn places_are_read_as_ts_reads_them() {
    let recorded = recorded();
    for entry in items(&recorded["places"]) {
        let written = text(&entry["written"]);
        let found = match word_place_of(written, 3) {
            Ok(words) => json!({ "written": written, "words": words.as_slice() }),
            Err(error) => json!({ "written": written, "refused": code_and_message(&error) }),
        };
        assert_eq!(found, *entry);
    }
    for entry in items(&recorded["notices"]) {
        assert_eq!(
            unshown_candidates_notice(number(&entry["count"]), entry["save"].as_str()),
            text(&entry["text"])
        );
    }
}

/// The search of `kind` of `text`.
fn word_search_of(text: &str, kind: &str) -> Result<WordSearch, Value> {
    let search = if kind == "missing-word" {
        WordSearch::missing_word(text)
    } else {
        WordSearch::unknown_words(text)
    };
    search.map_err(|error| refused(&error))
}

#[test]
fn word_searches_tell_their_size_as_ts_does() {
    let recorded = recorded();
    for entry in items(&recorded["words"]) {
        let (typed, kind) = (text(&entry["text"]), text(&entry["kind"]));
        let found = word_search_of(typed, kind).and_then(|search| {
            WordCandidateSearch::new(search, None, WordLimits::default())
                .map_err(|error| refused(&error))
        });
        let value = match found {
            Ok(search) => json!({
                "text": typed,
                "kind": kind,
                "wordCount": search.word_count(),
                "combinations": search.combinations(),
                "expected": {
                    "count": search.expected().count,
                    "exact": search.expected().exact,
                },
                "unknownPlaces": search.unknown_places(),
            }),
            Err(refusal) => json!({ "text": typed, "kind": kind, "refused": refusal }),
        };
        assert_eq!(value, *entry);
    }
}

/// What a word search of `entry` found, as the recorder writes it.
fn word_run(entry: &Value) -> Value {
    let (typed, kind) = (text(&entry["text"]), text(&entry["kind"]));
    let search = word_search_of(typed, kind).expect("a search");
    let limits = WordLimits {
        max_shown: entry["maxShown"].as_u64(),
        keep: entry["keep"].as_u64().filter(|&keep| keep > 0),
        stop_when_full: false,
    };
    let wallet = wallet_of(&entry["fingerprint"]).map(Rc::new);
    let mut search = WordCandidateSearch::new(search, wallet, limits).expect("a search");
    while let Step::Running(_) = search.step(512).expect("a step") {}
    let outcome = search.finish();
    let phrases: Vec<String> = outcome
        .shown
        .iter()
        .map(|shown| {
            shown
                .candidate
                .phrase()
                .expect("a phrase")
                .text()
                .as_str()
                .to_owned()
        })
        .collect();
    let shown: Vec<Value> = outcome
        .shown
        .iter()
        .take(SHOWN)
        .zip(&phrases)
        .map(|(shown, phrase)| {
            json!({
                "number": shown.candidate.number(),
                "phrase": phrase,
                "bits": shown.candidate.checksum_bits(),
                "places": shown.places,
                "match": shown.answer.as_ref().map(|answer| json!({
                    "matched": answer.matched,
                    "path": answer.path,
                })),
            })
        })
        .collect();
    json!({
        "text": typed,
        "kind": kind,
        "keep": entry["keep"],
        "maxShown": entry["maxShown"],
        "fingerprint": entry["fingerprint"],
        "count": outcome.count,
        "matched": outcome.matched,
        "warning": outcome.warning,
        "listFull": outcome.list_full,
        "shownCount": outcome.shown.len(),
        "shownHash": sha256(phrases.join("\n").as_bytes()),
        "shown": shown,
        "entropies": sha256(&outcome.entropies),
    })
}

#[test]
fn word_searches_find_the_candidates_ts_finds_in_its_order() {
    let recorded = recorded();
    for entry in items(&recorded["wordRuns"]) {
        assert_eq!(word_run(entry), *entry, "{}", text(&entry["text"]));
    }
}

/// What marked codes read give, as the recorder writes it.
fn marked_value(entry: &Value) -> Value {
    let (typed, form, mode) = (
        text(&entry["text"]),
        text(&entry["format"]),
        text(&entry["mode"]),
    );
    let head = json!({ "text": typed, "format": form, "mode": mode });
    let body = match MissingCodes::read(typed, form_named(form), mode_named(mode)) {
        Err(error) => json!({ "refused": refused(&error) }),
        Ok(codes) => {
            let mut candidates = codes.candidates();
            let mut lines: Vec<String> = Vec::new();
            while let Some(candidate) = candidates.next_codes() {
                let numbers: Vec<String> =
                    candidate.as_slice().iter().map(u16::to_string).collect();
                lines.push(numbers.join(" "));
            }
            json!({
                "wordCount": codes.word_count(),
                "placements": codes.placements(),
                "combinations": codes.combinations(),
                "checksummed": codes.checksummed(),
                "expected": codes.expected(),
                "candidates": lines.len(),
                "hash": sha256(lines.join("\n").as_bytes()),
            })
        }
    };
    let mut value = head;
    for (key, field) in body.as_object().expect("an object") {
        value[key] = field.clone();
    }
    value
}

#[test]
#[ignore = "a replay of every marked text, some 30 s: it runs at release"]
fn marked_codes_are_read_as_ts_reads_them() {
    let recorded = recorded();
    for entry in items(&recorded["marked"]) {
        assert_eq!(marked_value(entry), *entry);
    }
    for entry in items(&recorded["forms"]) {
        let typed = text(&entry["text"]);
        let forms: Vec<&str> = MissingCodes::forms(typed)
            .iter()
            .map(|form| form.name())
            .collect();
        assert_eq!(
            json!({ "text": typed, "marked": MissingCodes::marked(typed), "forms": forms }),
            *entry
        );
    }
}

/// The way of `way`.
fn prepared_way(
    search: &MissingCodesSearch,
    way: &Value,
    word_count: usize,
) -> Result<WaySearch, Value> {
    let prepared = match text(&way["kind"]) {
        "encoded" => search.by_encoded_fingerprint(text(&way["fingerprint"])),
        "wallet" => {
            let dates = way.get("dates").map(|dates| {
                Rc::new(DatesAnswer::parse(text(dates), Some(word_count), true).expect("dates"))
            });
            search.by_wallet(Rc::new(wallet(text(&way["fingerprint"]))), dates)
        }
        _ => {
            let complete: Vec<String> = way.get("complete").map(texts).unwrap_or_default();
            let days: Vec<&str> = complete.iter().map(String::as_str).collect();
            search.listed(&date_list(&days))
        }
    };
    prepared.map_err(|error| refused(&error))
}

/// What a way found, as the recorder writes it.
fn way_result(result: MissingCodesResult) -> Value {
    match result {
        MissingCodesResult::Found(found) => json!({
            "kind": "found",
            "codes": found.backup.text().expect("codes").as_str(),
            "dates": found.dates.as_ref().map(written_dates),
            "foundDates": found.found_dates.as_ref().map(|dates| dates.as_str().to_owned()),
            "others": found.others,
            "warning": found.warning,
        }),
        MissingCodesResult::List(rows) => {
            let rows: Vec<Value> = rows
                .iter()
                .map(|row| {
                    json!({
                        "codes": row.codes.as_str(),
                        "phrase": row.phrase.text().as_str(),
                        "fingerprint": row.fingerprint,
                    })
                })
                .collect();
            json!({ "kind": "list", "rows": rows })
        }
        MissingCodesResult::None(message) => json!({ "kind": "none", "message": message }),
        MissingCodesResult::Several { count, message } => {
            json!({ "kind": "several", "count": count, "message": message })
        }
        MissingCodesResult::Stopped => json!({ "kind": "stopped" }),
    }
}

#[test]
fn searches_of_marked_codes_go_as_ts_goes() {
    let recorded = recorded();
    for entry in items(&recorded["searches"]) {
        let (typed, form, mode) = (
            text(&entry["text"]),
            text(&entry["format"]),
            text(&entry["mode"]),
        );
        let codes = MissingCodes::read(typed, form_named(form), mode_named(mode)).expect("codes");
        let word_count = codes.word_count();
        let search = MissingCodesSearch::new(codes);
        assert_eq!(
            MissingCodesSearch::places_text(search.codes()),
            text(&entry["places"])
        );
        assert_eq!(
            search.unreadable().expect("words"),
            text(&entry["unreadable"])
        );
        assert_eq!(json!(search.many().expect("a count")), entry["many"]);
        assert_eq!(json!(search.needs_dates()), entry["needsDates"]);
        let ways: Vec<Value> = search
            .ways()
            .expect("ways")
            .iter()
            .map(|choice| {
                let way = match choice.way {
                    Way::Encoded => "encoded",
                    Way::Wallet => "wallet",
                    Way::List => "list",
                };
                json!({ "way": way, "label": choice.label, "note": choice.note })
            })
            .collect();
        assert_eq!(json!(ways), entry["ways"], "{typed}");
        for (name, way) in [
            ("encoded", Way::Encoded),
            ("wallet", Way::Wallet),
            ("list", Way::List),
        ] {
            let why = search.why_not(way).expect("words");
            assert_eq!(optional(why), entry["whyNot"][name], "{typed}");
        }
        for answer in items(&entry["answers"]) {
            let name = format!("{typed} {}", answer["way"]);
            let mut way = match prepared_way(&search, &answer["way"], word_count) {
                Ok(way) => way,
                Err(refusal) => {
                    assert_eq!(refusal, answer["refused"], "{name}");
                    continue;
                }
            };
            let seconds = fixed_seconds(way.size().pace_parts);
            let plan = way.plan(&seconds, None).expect("a plan");
            check_plan(&plan, &answer["plan"], &name);
            let ran = loop {
                match way.step(64) {
                    Ok(Step::Running(_)) => {}
                    Ok(Step::Done(_)) => break Ok(way.finish()),
                    Err(error) => break Err(refused(&error)),
                }
            };
            match ran {
                Ok(result) => assert_eq!(way_result(result), answer["result"], "{name}"),
                Err(refusal) => assert_eq!(refusal, answer["refused"], "{name}"),
            }
        }
    }
}

#[test]
fn dates_as_typed_say_what_ts_says() {
    let recorded = recorded();
    for entry in items(&recorded["dateAnswers"]) {
        let line = text(&entry["line"]);
        let (words, patterns) = (
            usize::try_from(number(&entry["wordCount"])).expect("a count"),
            entry["patterns"].as_bool().expect("a flag"),
        );
        let head = json!({ "line": line, "wordCount": words, "patterns": patterns });
        let body = match DatesAnswer::parse(line, Some(words), patterns) {
            Err(error) => json!({ "refused": code_and_message(&error) }),
            Ok(answer) => json!({
                "count": answer.count(),
                "forgotten": answer.has_forgotten_digits(),
                "combinations": answer.combinations(),
                "note": answer.forgotten_digits_note(),
                "fits12": answer.fits_phrase(12),
                "tooMany12": answer.too_many_for(Some(12)),
                "incomplete": answer.check_incomplete().err().map(|error| code_and_message(&error)),
            }),
        };
        let mut value = head;
        for (key, field) in body.as_object().expect("an object") {
            value[key] = field.clone();
        }
        assert_eq!(value, *entry, "{line}");
    }
    for entry in items(&recorded["wallets"]) {
        let mode = mode_named(text(&entry["mode"]));
        assert_eq!(json!(wallet_needed(mode)), entry["needed"]);
        assert_eq!(wallet_reason(Some(mode)), text(&entry["reason"]));
    }
    assert_eq!(wallet_reason(None), text(&recorded["unknownReason"]));
}

/// What a date search of `entry` found, as the recorder writes it; its refusal otherwise.
fn date_run(entry: &Value) -> Result<Value, Value> {
    let mode = Mode::named(text(&entry["mode"])).expect("a mode");
    let codes =
        Backup::read(text(&entry["text"]), Form::English, mode).map_err(|error| refused(&error))?;
    let answer = DatesAnswer::parse(text(&entry["dates"]), Some(codes.words()), true)
        .map_err(|error| refused(&error))?;
    let note = answer.forgotten_digits_note();
    let limits = MatchLimits {
        max_shown: entry["maxShown"].as_u64(),
        keep: entry["keep"].as_u64().filter(|&keep| keep > 0),
    };
    let mut search = DateSearch::new(
        mnemocode::modes::seedshift::Indexes::new(codes.indexes().to_vec()),
        Rc::new(answer),
        mode,
        wallet_of(&entry["fingerprint"]).map(Rc::new),
        limits,
    )
    .map_err(|error| refused(&error))?;
    let pace = SearchPace {
        per_check: 1.0 / 3.0,
        per_combination: 0.25,
    };
    let plan = search.plan(pace, None).expect("a plan");
    let checks = search.checks().expect("checks");
    let seconds = search.estimated_seconds(pace).expect("seconds");
    while let Step::Running(_) = search.step(32).map_err(|error| refused(&error))? {}
    let found = search.finish();
    let shown: Vec<Value> = found
        .shown
        .iter()
        .take(SHOWN)
        .map(|shown| {
            json!({
                "dates": shown.dates.as_str(),
                "phrase": shown.phrase.text().as_str(),
                "evidence": shown.evidence,
                "warning": shown.warning,
            })
        })
        .collect();
    let lines: Vec<String> = found
        .shown
        .iter()
        .map(|shown| format!("{} {}", shown.dates.as_str(), shown.phrase.text().as_str()))
        .collect();
    let kept: Vec<String> = found
        .kept
        .iter()
        .map(|phrase| phrase.text().as_str().to_owned())
        .collect();
    Ok(json!({
        "text": entry["text"],
        "mode": entry["mode"],
        "dates": entry["dates"],
        "fingerprint": entry["fingerprint"],
        "maxShown": entry["maxShown"],
        "keep": entry["keep"],
        "note": note,
        "checks": checks,
        "seconds": seconds,
        "plan": { "size": plan.size(), "count": plan.count(), "ask": plan.ask() },
        "combinations": found.combinations,
        "checksumValid": found.checksum_valid,
        "matchCount": found.match_count,
        "checked": found.checked,
        "warning": found.warning,
        "kept": kept,
        "shown": shown,
        "hash": sha256(lines.join("\n").as_bytes()),
    }))
}

#[test]
fn date_searches_find_what_ts_finds() {
    let recorded = recorded();
    for entry in items(&recorded["dateRuns"]) {
        let name = format!("{} {}", text(&entry["mode"]), text(&entry["dates"]));
        match date_run(entry) {
            Ok(mut value) => {
                assert!(close(
                    value["seconds"].as_f64().expect("seconds"),
                    &entry["seconds"]
                ));
                value["seconds"] = entry["seconds"].clone();
                value["checks"] = entry["checks"].clone();
                assert_eq!(value, *entry, "{name}");
            }
            Err(refusal) => assert_eq!(refusal, entry["refused"], "{name}"),
        }
    }
}
