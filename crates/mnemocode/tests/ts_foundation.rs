//! The foundation against MnemoCode TS 0.1.0 (RUST-14): every answer that the TS repository's
//! `scripts/rust-parity/foundation.mjs` recorded from its build in
//! vectors/ts-0.1.0/foundation-v1.json, given again by the Rust modules.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use mnemocode::checksum::crc32;
use mnemocode::refusal::Refusal;
use mnemocode::search::kept_count;
use mnemocode::search::plan::{CORRECT_WRITTEN_COPY, SearchPlan, counted, counting, duration};
use mnemocode::self_check::vectors;
use mnemocode::self_check::{CheckFailure, expect_refused, expect_same};
use mnemocode::text::codes::{
    apart_hex_units, code_tokens, compact_code, complete_hex_units, fits_pattern, hex_code_point,
    hex_units, joined_hex_units, unspaced_code, with_joined_marks_hint,
};
use mnemocode::text::display::is_unsafe;
use mnemocode::text::hex::{bytes_of_hex, hex_of_bytes};
use mnemocode::text::limits::{InputTooLarge, MEBIBYTE, limit_name};
use mnemocode::text::numbers::{WholeRange, integer_refusal, typed_whole_number, whole_number_of};
use mnemocode::text::pieces::text_pieces;
use mnemocode::text::space::{is_ecmascript_space, trim};
use mnemocode::text::utf8::strict_utf8;
use mnemocode::text::words::{
    after_place, capitalized, list_in_words, lower_first, number_word, place_of, places_named,
};
use serde_json::Value;

mod common;

use common::{text, texts};

const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/foundation-v1.json");

fn recorded() -> Value {
    serde_json::from_str(RECORDED).expect("the recorded file is JSON")
}

fn number(value: &Value) -> u64 {
    value.as_u64().expect("a whole number")
}

/// Asserts that `refusal` has the recorded code, message and kind of error.
fn assert_refusal(refusal: &impl Refusal, recorded: &Value) {
    assert_eq!(refusal.code(), text(&recorded["code"]));
    assert_eq!(refusal.to_string(), text(&recorded["message"]));
    assert_eq!(refusal.kind().name(), text(&recorded["kind"]));
}

fn points(value: &Value) -> Vec<u32> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|point| u32::try_from(number(point)).expect("a code point"))
        .collect()
}

fn points_where(test: impl Fn(char) -> bool) -> Vec<u32> {
    (0..=u32::from(char::MAX))
        .filter_map(char::from_u32)
        .filter(|character| test(*character))
        .map(u32::from)
        .collect()
}

#[test]
fn white_space_and_safe_display_match_over_every_scalar_value() {
    let recorded = recorded();
    assert_eq!(
        points_where(is_ecmascript_space),
        points(&recorded["ecmascriptSpace"])
    );
    let trimmed = points_where(|character| trim(&character.to_string()).is_empty());
    assert_eq!(trimmed, points(&recorded["whiteSpaceTrimmed"]));
    assert_eq!(points_where(is_unsafe), points(&recorded["unsafeDisplay"]));
}

#[test]
fn whole_numbers_read_and_refuse_as_ts() {
    let recorded = recorded();
    for case in recorded["wholeNumbers"].as_array().unwrap() {
        let range = WholeRange::new(number(&case[1]), number(&case[2]));
        assert_eq!(
            whole_number_of(text(&case[0]), range),
            case[3].as_u64(),
            "{case}"
        );
    }
    let refused = typed_whole_number("x", WholeRange::new(0, 2_147_483_647), None).unwrap_err();
    assert_refusal(&refused, &recorded["typedRefusal"]);
    assert_eq!(
        [
            integer_refusal("The month", WholeRange::new(1, 12), None),
            integer_refusal(
                "The year",
                WholeRange::new(1, 9999),
                Some("0001 through 9999")
            ),
        ]
        .to_vec(),
        texts(&recorded["integerRefusals"])
    );
    let range = WholeRange::new(1, 2048);
    assert_eq!(
        vec![range.through(), range.to()],
        texts(&recorded["rangeTexts"])
    );
}

#[test]
fn running_text_and_places_are_worded_as_ts() {
    let recorded = recorded();
    for case in recorded["lists"].as_array().unwrap() {
        let items: Vec<u64> = case[0].as_array().unwrap().iter().map(number).collect();
        assert_eq!(list_in_words(&items, text(&case[1])), text(&case[2]));
    }
    for case in recorded["placesNamed"].as_array().unwrap() {
        let places: Vec<usize> = case[1]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| number(p) as usize)
            .collect();
        assert_eq!(places_named(text(&case[0]), &places), text(&case[2]));
    }
    for case in recorded["placeOf"].as_array().unwrap() {
        let places: Option<Vec<usize>> = case[0]
            .as_array()
            .map(|places| places.iter().map(|p| number(p) as usize).collect());
        assert_eq!(
            place_of(places.as_deref(), number(&case[1]) as usize) as u64,
            number(&case[2])
        );
    }
    for case in recorded["numberWords"].as_array().unwrap() {
        assert_eq!(number_word(number(&case[0])), text(&case[1]));
    }
    for case in recorded["capitalized"].as_array().unwrap() {
        assert_eq!(capitalized(text(&case[0])), text(&case[1]));
    }
    for case in recorded["lowerFirst"].as_array().unwrap() {
        assert_eq!(lower_first(text(&case[0])), text(&case[1]));
    }
    for case in recorded["afterPlace"].as_array().unwrap() {
        let worded = after_place(
            text(&case[0]),
            number(&case[1]) as usize,
            text(&case[2]),
            text(&case[3]),
        );
        assert_eq!(worded, text(&case[4]));
    }
}

/// A recorded list of codes, or none where TS gave undefined.
fn units(value: &Value) -> Option<Vec<String>> {
    value.as_array().map(|_| texts(value))
}

#[test]
fn codes_are_read_as_ts_reads_them() {
    let recorded = recorded();
    for case in recorded["codeTokens"].as_array().unwrap() {
        assert_eq!(code_tokens(text(&case[0])), texts(&case[1]), "{case}");
    }
    for case in recorded["compactCode"].as_array().unwrap() {
        assert_eq!(compact_code(text(&case[0])), text(&case[1]));
    }
    for case in recorded["unspacedCode"].as_array().unwrap() {
        assert_eq!(unspaced_code(text(&case[0])), text(&case[1]));
    }
    for case in recorded["hexUnits"].as_array().unwrap() {
        let (written, width) = (text(&case[0]), number(&case[1]) as usize);
        assert_eq!(apart_hex_units(written, width), units(&case[2]), "{case}");
        assert_eq!(joined_hex_units(written, width), units(&case[3]), "{case}");
        assert_eq!(hex_units(written, width, false), units(&case[4]), "{case}");
        assert_eq!(hex_units(written, width, true), units(&case[5]), "{case}");
        assert_eq!(
            complete_hex_units(written, width),
            units(&case[6]),
            "{case}"
        );
    }
    for case in recorded["joinedMarksHint"].as_array().unwrap() {
        assert_eq!(
            with_joined_marks_hint("Refused.", text(&case[0])),
            text(&case[1])
        );
    }
    for case in recorded["fitsPattern"].as_array().unwrap() {
        assert_eq!(
            fits_pattern(text(&case[0]), text(&case[1])),
            case[2].as_bool().unwrap()
        );
    }
    for case in recorded["hexCodePoints"].as_array().unwrap() {
        assert_eq!(hex_code_point(number(&case[0]) as u32), text(&case[1]));
    }
}

#[test]
fn bytes_pieces_and_limits_match_ts() {
    let recorded = recorded();
    for case in recorded["hexOfBytes"].as_array().unwrap() {
        let bytes: Vec<u8> = case[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| number(b) as u8)
            .collect();
        assert_eq!(hex_of_bytes(&bytes), text(&case[1]));
    }
    for case in recorded["bytesOfHex"].as_array().unwrap() {
        let outcome = &case[1];
        match bytes_of_hex(text(&case[0])) {
            Ok(bytes) => {
                let expected: Vec<u8> = outcome["value"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|b| number(b) as u8)
                    .collect();
                assert_eq!(bytes, expected);
            }
            Err(refused) => assert_refusal(&refused, outcome),
        }
    }
    for case in recorded["textPieces"].as_array().unwrap() {
        let outcome = &case[2];
        match text_pieces(text(&case[0]), number(&case[1]) as usize) {
            Ok(pieces) => assert_eq!(pieces, texts(&outcome["value"])),
            Err(refused) => assert_refusal(&refused, outcome),
        }
    }
    let not_utf8 = strict_utf8(&[0x61, 0xff], "The file").unwrap_err();
    assert_refusal(&not_utf8, &recorded["notUtf8"]);
    assert_eq!(limit_name(MEBIBYTE), text(&recorded["limitName"]));
    let too_large = InputTooLarge::new("The file", MEBIBYTE);
    assert_refusal(&too_large, &recorded["inputTooLarge"]);
    for case in recorded["crc32"].as_array().unwrap() {
        assert_eq!(
            u64::from(crc32(text(&case[0]).as_bytes())),
            number(&case[1])
        );
    }
}

#[test]
fn search_plans_and_checks_are_worded_as_ts() {
    let recorded = recorded();
    for case in recorded["counting"].as_array().unwrap() {
        assert_eq!(counting(number(&case[0])), text(&case[1]));
    }
    for case in recorded["durations"].as_array().unwrap() {
        assert_eq!(duration(case[0].as_f64().unwrap()), text(&case[1]));
    }
    for case in recorded["counted"].as_array().unwrap() {
        assert_eq!(counted(number(&case[0]), text(&case[1])), text(&case[2]));
    }
    for case in recorded["plans"].as_array().unwrap() {
        let plan = SearchPlan::new(
            text(&case["size"]).to_owned(),
            number(&case["count"]),
            case["seconds"].as_f64().unwrap(),
            case["limit"].as_u64(),
        );
        assert_eq!(plan.ask(), case["ask"].as_bool().unwrap());
        assert_eq!(plan.tell(), case["tell"].as_bool().unwrap());
        assert_eq!(plan.question(), text(&case["question"]));
        assert_eq!(plan.extent(), text(&case["extent"]));
        assert_eq!(plan.notice(), text(&case["notice"]));
        assert_eq!(plan.time_notice(), text(&case["timeNotice"]));
    }
    assert_eq!(CORRECT_WRITTEN_COPY, text(&recorded["correctWrittenCopy"]));
    let kept = kept_count(Some(0), 20, "maxShown", 1).unwrap_err();
    assert_refusal(&kept, &recorded["keptCount"]);
    let recorded_checks = recorded["selfCheck"].as_array().unwrap();
    let failures = [
        expect_same(&1, &2, "Word lists").unwrap_err(),
        expect_refused(Ok::<(), CheckFailure>(()), "x", "Case 2").unwrap_err(),
        expect_refused(Err::<(), _>(CheckFailure::Mismatch("y")), "x", "Width").unwrap_err(),
    ];
    assert_eq!(failures.len(), recorded_checks.len());
    for (failure, outcome) in failures.iter().zip(recorded_checks) {
        assert_refusal(failure, outcome);
    }
}

#[test]
fn the_public_self_test_vectors_are_the_ts_ones() {
    let recorded = recorded();
    let vectors = &recorded["selfTestVectors"];
    let pairs = [
        ("PUBLIC_MNEMONIC", vectors::PUBLIC_MNEMONIC),
        ("PUBLIC_MNEMONIC_24", vectors::PUBLIC_MNEMONIC_24),
        ("PUBLIC_FINGERPRINT", vectors::PUBLIC_FINGERPRINT),
        ("PUBLIC_UNICODE", vectors::PUBLIC_UNICODE),
        ("MASKED_DATE", vectors::MASKED_DATE),
        ("MASKED_ENGLISH", vectors::MASKED_ENGLISH),
        ("MASKED_NUMBERS", vectors::MASKED_NUMBERS),
        ("ENCODED_FINGERPRINT", vectors::ENCODED_FINGERPRINT),
    ];
    for (name, value) in pairs {
        assert_eq!(text(&vectors[name]), value, "{name}");
    }
    assert_eq!(
        texts(&vectors["PUBLIC_UNICODE_CODES"]),
        vectors::PUBLIC_UNICODE_CODES
    );
    assert_eq!(texts(&vectors["SEEDSHIFT_DATES"]), vectors::SEEDSHIFT_DATES);
    assert_eq!(vectors.as_object().unwrap().len(), pairs.len() + 2);
}
