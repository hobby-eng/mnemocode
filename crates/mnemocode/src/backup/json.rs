//! A result as JSON (MnemoCode TS 0.1.0's `formatEncoded` with `json`,
//! CAP-PHRASE-FORMATS-JSON-OUTPUT): the dates, the shifts and the codes in English words, word
//! numbers and Unicode codes, every form written from the indexes, as `JSON.stringify` with an
//! indent of two writes it. Every value is ASCII digits, letters, hyphens or spaces, which JSON
//! takes without escapes, so no JSON writer is needed.

use crate::forms::{Form, FormError};
use crate::modes::seedshift::Masked;

/// `items` as a JSON array of one value a line, at the depth of a key of the top object.
fn array(items: impl Iterator<Item = String>) -> String {
    let items: Vec<String> = items.collect();
    if items.is_empty() {
        return "[]".to_owned();
    }
    format!("[\n    {}\n  ]", items.join(",\n    "))
}

/// The JSON of `result`; refused for indexes that are no phrase, as every form refuses them.
pub fn json(result: &Masked) -> Result<String, FormError> {
    let indexes = result.shifted.as_slice();
    let english = Form::English.codes(indexes)?;
    let unicode = Form::Unicode.codes(indexes)?;
    let quoted = |text: &str| format!("\"{text}\"");
    let fields = [
        ("algorithm", quoted("Seedshift-compatible date shift")),
        (
            "dates",
            array(result.dates.iter().map(|date| quoted(&date.to_string()))),
        ),
        (
            "shifts",
            array(result.shifts.iter().map(|shift| shift.to_string())),
        ),
        ("english", array(english.split(' ').map(quoted))),
        (
            "indexes",
            array(
                indexes
                    .iter()
                    .map(|&index| (u32::from(index) + 1).to_string()),
            ),
        ),
        ("unicodeCodePoints", quoted(&unicode)),
    ];
    let body: Vec<String> = fields
        .iter()
        .map(|(key, value)| format!("  \"{key}\": {value}"))
        .collect();
    Ok(format!("{{\n{}\n}}", body.join(",\n")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bip39::phrase::Phrase;
    use crate::modes::Mode;

    #[test]
    fn json_writes_every_form_from_the_indexes() {
        let phrase = Phrase::parse(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        )
        .unwrap();
        let direct = Mode::Direct.encode(&phrase, &[]).unwrap();
        let text = json(&direct).unwrap();
        assert!(text.starts_with("{\n  \"algorithm\": \"Seedshift-compatible date shift\",\n  \"dates\": [],\n  \"shifts\": [\n    0,\n"));
        assert!(text.ends_with("    \"about\"\n  ],\n  \"indexes\": [\n    1,\n    1,\n    1,\n    1,\n    1,\n    1,\n    1,\n    1,\n    1,\n    1,\n    1,\n    4\n  ],\n  \"unicodeCodePoints\": \"768476847684768476847684768476847684768476845728\"\n}"));
    }
}
