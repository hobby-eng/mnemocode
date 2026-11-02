//! What the tests that replay a recording of the TS program share.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![allow(dead_code, reason = "each replay takes what it needs")]

use mnemocode::dates::{Date, Dates, parse_date};
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::recovery::wallet_check::WalletCheck;
use mnemocode::refusal::{Refusal, RefusalKind};
use mnemocode::sskr::repair::report::{ReportLine, ShareRepairs};
use mnemocode::wallet::evidence::Evidence;
use serde_json::{Value, json};

pub(crate) fn text(value: &Value) -> &str {
    value.as_str().expect("a string")
}

pub(crate) fn texts(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|item| text(item).to_owned())
        .collect()
}

pub(crate) fn items(value: &Value) -> &Vec<Value> {
    value.as_array().expect("an array")
}

/// `value`, or JSON's null.
pub(crate) fn optional(value: Option<String>) -> Value {
    value.map_or(Value::Null, Value::String)
}

/// A refusal as the recorder writes it.
pub(crate) fn refused(error: &impl Refusal) -> Value {
    let kind = match error.kind() {
        RefusalKind::Error => "Error",
        RefusalKind::Range => "RangeError",
        RefusalKind::Type => "TypeError",
    };
    json!({ "code": error.code(), "message": error.to_string(), "kind": kind })
}

/// A line of a report as the recorder writes it.
pub(crate) fn line_value(line: &ReportLine) -> Value {
    match line {
        ReportLine::Status { label, value, good } => {
            json!({ "kind": "status", "label": label, "value": value, "good": good })
        }
        ReportLine::Hint(text) => json!({ "kind": "hint", "text": text }),
        ReportLine::Notice(text) => json!({ "kind": "notice", "text": text }),
        ReportLine::Warning(text) => json!({ "kind": "warning", "text": text }),
        ReportLine::More(anchor) => json!({ "kind": "more", "anchor": anchor }),
    }
}

pub(crate) const RECORDED: &str = include_str!("../../../../vectors/ts-0.1.0/recovery-v1.json");

/// The public phrase.
pub(crate) const TWELVE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// What the recorder calls the host's reader of an encoded phrase.
pub(crate) const DECODE: &str = "Decode";

/// What it calls the host's reader of shares.
pub(crate) const SHARE_READER: &str = "the Shares tab";

pub(crate) fn recorded_recovery() -> Value {
    serde_json::from_str(RECORDED).expect("the recorded file is JSON")
}

pub(crate) fn number(value: &Value) -> u64 {
    value.as_u64().expect("a whole number")
}

/// The wallet of `fingerprint`.
pub(crate) fn wallet(fingerprint: &str) -> WalletCheck {
    WalletCheck::new(
        Evidence::master_fingerprint(fingerprint).expect("a fingerprint"),
        "",
    )
}

/// The wallet of a recorded fingerprint, none for null.
pub(crate) fn wallet_of(fingerprint: &Value) -> Option<WalletCheck> {
    fingerprint.as_str().map(wallet)
}

pub(crate) fn date_list(values: &[&str]) -> Dates {
    let dates: Vec<Date> = values
        .iter()
        .map(|value| parse_date(value).expect("a date"))
        .collect();
    Dates::new(&dates)
}

/// The form of a recorded name.
pub(crate) fn form_named(name: &str) -> Form {
    Form::named(name).expect("a form")
}

/// The mode of a recorded name.
pub(crate) fn mode_named(name: &str) -> Mode {
    Mode::named(name).expect("a mode")
}

/// The refusal of `error` as the recorder writes it, without its kind where it leaves it out.
pub(crate) fn code_and_message(error: &impl Refusal) -> Value {
    json!({ "code": error.code(), "message": error.to_string() })
}

/// The seconds a search of `size` parts takes to time at the recorder's clock.
pub(crate) fn fixed_seconds(parts: u8) -> Vec<f64> {
    vec![1.0; usize::from(parts)]
}

/// What a repair filled in, as the recorder writes it.
pub(crate) fn repairs_list(repairs: &[ShareRepairs]) -> Value {
    let list: Vec<Value> = repairs
        .iter()
        .map(|repairs| {
            let elements: Vec<Value> = repairs
                .elements
                .iter()
                .map(|element| {
                    json!({
                        "position": element.position,
                        "value": element.value,
                        "guess": element.guess,
                    })
                })
                .collect();
            json!({ "share": repairs.share, "elements": elements })
        })
        .collect();
    json!(list)
}

/// Whether two numbers are the same, but for the last bits of a recorded double.
pub(crate) fn close(actual: f64, recorded: &Value) -> bool {
    let recorded = recorded.as_f64().expect("a number");
    (actual - recorded).abs() <= recorded.abs() * 1e-12
}
