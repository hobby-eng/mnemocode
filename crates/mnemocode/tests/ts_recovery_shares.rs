//! How a backup is read, checked and restored from shares against MnemoCode TS 0.1.0 (RUST-14): what
//! the TS repository's `scripts/rust-parity/recovery.mjs` recorded, public phrases and shares,
//! given again by the Rust modules. Times are those of a clock of fixed steps, one second between
//! two reads.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(all(feature = "sskr", feature = "search-date"))]

use std::rc::Rc;

use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::Date;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::recovery::backup_check::{
    BackupPart, BackupResult, BackupVerdict, EncodedBackupCheck, EncodedOriginal, FindingKind,
    ShareBackupCheck, ShareOriginal, WrittenBackup,
};
use mnemocode::recovery::reading::{BackupReading, ReadingRules};
use mnemocode::recovery::shares::flow::{RestoreFlow, ShareRestoreOutcome, ShareRestoreRequest};
use mnemocode::recovery::shares::repair::{ShareRepairOutcome, repair_before_restore, repaired};
use mnemocode::recovery::shares::{
    SearchLimits, WALLET_CHECK_NEEDS_THRESHOLD, several_sets_note, variants_message,
};
use mnemocode::search::{Search, Step};
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::joint::tries_per_second;
use mnemocode::sskr::typed::ShareInput;
use serde_json::{Value, json};

mod common;

use common::{
    DECODE, SHARE_READER, TWELVE, code_and_message, date_list, fixed_seconds, form_named, items,
    line_value, mode_named, number, optional, recorded_recovery as recorded, refused, repairs_list,
    text, texts, wallet,
};

/// The dates of the encoded backup that is checked again.
const CHECKED_DATES: [&str; 2] = ["01-02-2001", "23-09-2026"];

#[test]
fn backups_are_read_as_ts_reads_them() {
    let recorded = recorded();
    for entry in items(&recorded["readings"]) {
        let typed = text(&entry["text"]);
        let rules = ReadingRules {
            seedshift_only: entry["rules"]["seedshiftOnly"].as_bool().unwrap_or(false),
            share_reader: SHARE_READER,
            words: entry["rules"]["words"]
                .as_u64()
                .map(|words| usize::try_from(words).expect("a count")),
        };
        let mode = entry["given"]["mode"].as_str().map(mode_named);
        let form = entry["given"]["format"].as_str().map(form_named);
        let reading = match BackupReading::of(typed, rules) {
            Ok(reading) => reading,
            Err(error) => {
                assert_eq!(refused(&error), entry["refused"], "{typed}");
                continue;
            }
        };
        let said =
            |forms: Result<Vec<Form>, mnemocode::recovery::reading::ReadingError>| match forms {
                Ok(forms) => {
                    let names: Vec<&str> = forms.iter().map(|form| form.name()).collect();
                    json!({ "value": names })
                }
                Err(error) => json!({ "refused": code_and_message(&error) }),
            };
        assert_eq!(json!(reading.has_record()), entry["record"], "{typed}");
        assert_eq!(
            optional(reading.mode(mode).map(|mode| mode.id().to_owned())),
            entry["mode"],
            "{typed}"
        );
        assert_eq!(
            optional(reading.mode_conflict(mode)),
            entry["modeConflict"],
            "{typed}"
        );
        assert_eq!(
            optional(reading.form_conflict(form)),
            entry["formatConflict"],
            "{typed}"
        );
        assert_eq!(json!(reading.marked()), entry["marked"], "{typed}");
        assert_eq!(said(reading.forms(form)), entry["forms"], "{typed}");
        assert_eq!(
            said(reading.marked_forms(form)),
            entry["markedForms"],
            "{typed}"
        );
    }
}

/// What a check found, as the recorder writes it.
fn result_value(result: &BackupResult) -> Value {
    let verdict = match result.verdict {
        BackupVerdict::Restores => "restores",
        BackupVerdict::Differs => "differs",
        BackupVerdict::Unreadable => "unreadable",
        BackupVerdict::Unchecked => "unchecked",
    };
    let finding = result.finding.as_ref().map(|finding| {
        let part = match finding.part {
            BackupPart::Codes => "codes",
            BackupPart::Shares => "shares",
            BackupPart::Dates => "dates",
        };
        let kind = match finding.kind {
            FindingKind::Unreadable => "unreadable",
            FindingKind::Mode => "mode",
            FindingKind::Count => "count",
            FindingKind::Places => "places",
            FindingKind::OtherPhrase => "other-phrase",
            FindingKind::Unchecked => "unchecked",
        };
        json!({
            "part": part,
            "kind": kind,
            "places": finding.places,
            "message": finding.message,
        })
    });
    json!({
        "verdict": verdict,
        "message": result.message,
        "finding": finding,
        "notes": result.notes,
    })
}

#[test]
fn a_written_backup_is_checked_as_ts_checks_it() {
    let recorded = recorded();
    let dates = date_list(&CHECKED_DATES);
    let all: Vec<Date> = dates.iter().collect();
    let phrase = Phrase::parse(TWELVE).expect("a phrase");
    let masked = Mode::Seedshift.encode(&phrase, &all).expect("a mask");
    let check = EncodedBackupCheck::new(EncodedOriginal {
        phrase,
        form: Form::English,
        mode: Mode::Seedshift,
        codes: masked.shifted.clone(),
        dates,
    })
    .expect("a check");
    assert_eq!(
        Form::English
            .codes(masked.shifted.as_slice())
            .expect("codes"),
        text(&recorded["encodedChecks"]["words"])
    );
    for entry in items(&recorded["encodedChecks"]["answers"]) {
        let written = WrittenBackup {
            backup: text(&entry["written"]["backup"]),
            dates: entry["written"]["dates"].as_str(),
        };
        let mut expected = entry.clone();
        expected
            .as_object_mut()
            .expect("an object")
            .remove("written");
        let result = check.check(written).expect("a result");
        assert_eq!(result_value(&result), expected, "{entry}");
    }
    for entry in items(&recorded["shareChecks"]) {
        let original = &entry["original"];
        let mode = mode_named(text(&original["mode"]));
        let dates = original.get("dates").map(|dates| {
            let days = texts(dates);
            let days: Vec<&str> = days.iter().map(String::as_str).collect();
            date_list(&days)
        });
        let check = ShareBackupCheck::new(
            ShareOriginal {
                phrase: Phrase::parse(TWELVE).expect("a phrase"),
                mode,
                threshold: 2,
                dates,
            },
            DECODE,
        )
        .expect("a check");
        let written = WrittenBackup {
            backup: text(&entry["written"]["backup"]),
            dates: entry["written"]["dates"].as_str(),
        };
        let mut expected = entry.clone();
        let fields = expected.as_object_mut().expect("an object");
        fields.remove("original");
        fields.remove("written");
        let result = check.check(written).expect("a result");
        assert_eq!(result_value(&result), expected, "{entry}");
    }
}

/// The request of a recorded restore.
fn request_of(entry: &Value) -> Result<ShareRestoreRequest, Value> {
    let mut input = ShareInput::new(DECODE);
    input.add(&texts(&entry["texts"])).expect("shares");
    let dates = entry
        .get("dates")
        .map(|dates| DatesAnswer::parse(text(dates), None, true).map(Rc::new))
        .transpose()
        .map_err(|error| refused(&error))?;
    Ok(ShareRestoreRequest {
        input,
        mode: mode_named(text(&entry["mode"])),
        dates,
        wallet: entry
            .get("fingerprint")
            .map(|fingerprint| Rc::new(wallet(text(fingerprint)))),
        keep: entry.get("keep").and_then(Value::as_u64),
        limits: SearchLimits {
            shares: None,
            dates: entry["limits"]["dates"].as_u64(),
        },
        confirmed: entry["confirmed"].as_bool().unwrap_or(false),
    })
}

/// What the flow of `request` ends with, at the recorder's clock.
fn restore_of(request: ShareRestoreRequest) -> Result<ShareRestoreOutcome, Value> {
    let mut flow = RestoreFlow::new(request).map_err(|error| refused(&error))?;
    let seconds = fixed_seconds(flow.size().pace_parts - 1);
    flow.begin(tries_per_second(1.0), &seconds)
        .map_err(|error| refused(&error))?;
    while let Step::Running(_) = flow.step(64).map_err(|error| refused(&error))? {}
    Ok(flow.finish())
}

/// The lines of a report, as the recorder writes them.
fn lines_value(lines: &[mnemocode::sskr::repair::report::ReportLine]) -> Value {
    json!(lines.iter().map(line_value).collect::<Vec<_>>())
}

/// What a restore ended with, as the recorder writes it.
fn restored_value(outcome: &ShareRestoreOutcome) -> Value {
    match outcome {
        ShareRestoreOutcome::Trouble { message, lines } => json!({
            "kind": "trouble", "lines": lines_value(lines), "message": message, "question": null,
        }),
        ShareRestoreOutcome::Few { message, lines } => json!({
            "kind": "few", "lines": lines_value(lines), "message": message, "question": null,
        }),
        ShareRestoreOutcome::Question { question, lines } => json!({
            "kind": "question", "lines": lines_value(lines), "message": null, "question": question,
        }),
        ShareRestoreOutcome::Stopped { lines } => json!({
            "kind": "stopped", "lines": lines_value(lines), "message": null, "question": null,
        }),
        ShareRestoreOutcome::Phrases {
            found,
            places,
            lines,
            notes,
        } => {
            let phrases: Vec<Value> = found
                .phrases
                .iter()
                .map(|phrase| {
                    json!({
                        "phrase": phrase.unmasked.phrase.text().as_str(),
                        "held": phrase.unmasked.set.phrase().text().as_str(),
                        "dates": phrase.unmasked.dates.as_ref().map(|dates| dates.as_str().to_owned()),
                        "matchedAt": phrase.unmasked.matched_at,
                        "warning": phrase.unmasked.warning,
                        "repairs": repairs_list(&phrase.repairs),
                        "backup": phrase.backup.as_ref().map(|backup| json!({
                            "form": backup.form.name(),
                            "text": backup.text.as_str(),
                        })),
                    })
                })
                .collect();
            let listed: Vec<String> = found
                .listed
                .iter()
                .map(|phrase| phrase.text().as_str().to_owned())
                .collect();
            json!({
                "kind": "phrases",
                "lines": lines_value(lines),
                "places": places,
                "notes": notes,
                "sets": found.sets.len(),
                "listed": listed,
                "phrases": phrases,
            })
        }
    }
}

/// Holds what a restore gave to the recorder's entry.
fn check_restored(found: &Value, entry: &Value) {
    let name = entry.to_string();
    for (key, value) in found.as_object().expect("an object") {
        assert_eq!(*value, entry[key], "{key} of {name}");
    }
}

#[test]
fn shares_are_restored_in_the_steps_ts_takes() {
    let recorded = recorded();
    for entry in items(&recorded["restores"]) {
        let outcome = request_of(entry).and_then(restore_of);
        match outcome {
            Ok(outcome) => check_restored(&restored_value(&outcome), entry),
            Err(refusal) => assert_eq!(refusal, entry["refused"], "{entry}"),
        }
    }
}

/// What a repair of `entry` ends with.
fn repair_of(entry: &Value) -> Result<ShareRepairOutcome, Value> {
    let form = entry["form"]
        .as_str()
        .map(|name| ShareFormat::named(name).expect("a form"));
    let request = request_of(entry)?;
    let mode = request.mode;
    let wallet_given = request.wallet.is_some();
    let mut input = ShareInput::new(DECODE);
    input.add(&texts(&entry["texts"])).expect("shares");
    if let Some(outcome) =
        repair_before_restore(&input, mode, wallet_given, form).map_err(|error| refused(&error))?
    {
        return Ok(outcome);
    }
    let restored = restore_of(request)?;
    repaired(restored, &input, form, wallet_given).map_err(|error| refused(&error))
}

/// What a repair ended with, as the recorder writes it.
fn repair_value(outcome: &ShareRepairOutcome) -> Value {
    let shares_value = |shares: &[mnemocode::recovery::shares::repair::RepairedShare]| {
        let list: Vec<Value> = shares
            .iter()
            .map(|share| {
                json!({
                    "number": share.number,
                    "text": share.text.as_str(),
                    "format": share.format.name(),
                    "record": share.record.as_str(),
                })
            })
            .collect();
        json!(list)
    };
    let base = |kind: &str,
                lines: &[mnemocode::sskr::repair::report::ReportLine],
                warning: Option<&String>,
                message: Option<&String>,
                question: Option<&String>| {
        json!({
            "kind": kind,
            "lines": lines_value(lines),
            "warning": warning,
            "message": message,
            "question": question,
        })
    };
    match outcome {
        ShareRepairOutcome::Trouble { message, lines } => {
            base("trouble", lines, None, Some(message), None)
        }
        ShareRepairOutcome::Question { question, lines } => {
            base("question", lines, None, None, Some(question))
        }
        ShareRepairOutcome::Stopped { lines } => base("stopped", lines, None, None, None),
        ShareRepairOutcome::Shares {
            shares,
            form,
            repairs,
            lines,
            notes,
            warning,
        } => {
            let mut value = base("shares", lines, warning.as_ref(), None, None);
            value["shares"] = shares_value(shares);
            value["form"] = json!(form.map(ShareFormat::name));
            value["repairs"] = repairs_list(repairs);
            value["notes"] = json!(notes);
            value
        }
        ShareRepairOutcome::Variants {
            message,
            variants,
            lines,
            warning,
        } => {
            let mut value = base("variants", lines, warning.as_ref(), Some(message), None);
            let list: Vec<Value> = variants
                .iter()
                .map(|variant| {
                    json!({
                        "fingerprint": variant.fingerprint,
                        "shares": shares_value(&variant.shares),
                        "repairs": repairs_list(&variant.repairs),
                    })
                })
                .collect();
            value["variants"] = json!(list);
            value
        }
    }
}

#[test]
fn damaged_shares_are_written_again_as_ts_writes_them() {
    let recorded = recorded();
    for entry in items(&recorded["repairs"]) {
        match repair_of(entry) {
            Ok(outcome) => check_restored(&repair_value(&outcome), entry),
            Err(refusal) => assert_eq!(refusal, entry["refused"], "{entry}"),
        }
    }
}

#[test]
fn the_words_of_several_sets_are_as_ts_writes_them() {
    let recorded = recorded();
    assert_eq!(
        WALLET_CHECK_NEEDS_THRESHOLD,
        text(&recorded["warnings"]["needsThreshold"])
    );
    for entry in items(&recorded["several"]) {
        let sets = usize::try_from(number(&entry["count"])).expect("a count");
        assert_eq!(several_sets_note(sets), text(&entry["note"]));
        assert_eq!(variants_message(sets, false), text(&entry["withoutWallet"]));
        assert_eq!(variants_message(sets, true), text(&entry["withWallet"]));
    }
}
