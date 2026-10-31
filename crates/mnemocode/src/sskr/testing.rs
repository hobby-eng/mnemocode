//! Public shares written, cut into units and marked as the TS tests do (`test/helpers/shares.ts`),
//! for the tests of the repair.

use serde_json::Value;

use super::forms::{ShareFormat, read_share};
use super::text::UR_PREFIX;

const VECTORS: &str = include_str!("../../../../vectors/sskr-v1.json");

pub(crate) fn vectors() -> Value {
    serde_json::from_str(VECTORS).unwrap()
}

/// The first share of the deterministic vector `index`, and of the official set.
pub(crate) fn share(index: Option<usize>) -> String {
    let vectors = vectors();
    let set = index.map_or(&vectors["official"], |index| {
        &vectors["deterministic"][index]
    });
    set["shares"][0].as_str().unwrap().to_owned()
}

/// The payload of `ur`.
pub(crate) fn payload(ur: &str) -> Vec<u8> {
    read_share(ur).unwrap().share.payload().to_vec()
}

/// The units of `ur` written in `format`, as TS's test helper cuts them.
pub(crate) fn share_units(ur: &str, format: ShareFormat) -> Vec<String> {
    let text = format.write(&read_share(ur).unwrap().share);
    let text = text.as_str();
    match format {
        ShareFormat::Ur => text.as_bytes()[UR_PREFIX.len()..]
            .chunks(2)
            .map(|pair| String::from_utf8(pair.to_vec()).unwrap())
            .collect(),
        ShareFormat::ColorsUnicode => text
            .as_bytes()
            .chunks(4)
            .map(|code| String::from_utf8(code.to_vec()).unwrap())
            .collect(),
        _ => text.split(' ').map(str::to_owned).collect(),
    }
}

/// `units` joined as `format` writes them.
pub(crate) fn join_units(units: &[String], format: ShareFormat) -> String {
    match format {
        ShareFormat::Ur => format!("{UR_PREFIX}{}", units.concat()),
        ShareFormat::ColorsUnicode => units.concat(),
        _ => units.join(" "),
    }
}

/// `ur` in `format` with the units at `places` marked with ?.
pub(crate) fn mark_units(ur: &str, format: ShareFormat, places: &[usize]) -> String {
    let mut units = share_units(ur, format);
    for &place in places {
        units[place] = "?".to_owned();
    }
    join_units(&units, format)
}

/// `ur` in `format` with ? at the digits `marks` lists for each place, after any #.
pub(crate) fn mark_digits(ur: &str, format: ShareFormat, marks: &[(usize, &[usize])]) -> String {
    let mut units = share_units(ur, format);
    for &(place, digits) in marks {
        let unit = &units[place];
        let prefix = if unit.starts_with('#') { "#" } else { "" };
        let mut symbols: Vec<char> = unit[prefix.len()..].chars().collect();
        for &digit in digits {
            symbols[digit] = '?';
        }
        units[place] = format!("{prefix}{}", symbols.iter().collect::<String>());
    }
    join_units(&units, format)
}

/// `ur` in `format` with ? at the same `digits` of each element at `places`.
pub(crate) fn mark_same_digits(
    ur: &str,
    format: ShareFormat,
    places: &[usize],
    digits: &[usize],
) -> String {
    let marks: Vec<(usize, &[usize])> = places.iter().map(|&place| (place, digits)).collect();
    mark_digits(ur, format, &marks)
}

/// The shares of the deterministic vector `index`, and the phrase of its entropy.
pub(crate) fn vector(index: usize) -> (Vec<String>, String) {
    let set = &vectors()["deterministic"][index];
    let shares = set["shares"]
        .as_array()
        .unwrap()
        .iter()
        .map(|share| share.as_str().unwrap().to_owned())
        .collect();
    let entropy = crate::text::hex::bytes_of_hex(set["entropy"].as_str().unwrap()).unwrap();
    let phrase = crate::bip39::phrase::Phrase::of_entropy(&entropy).unwrap();
    (shares, phrase.text().as_str().to_owned())
}

/// Counting bytes: a public seed for the tests' splits.
pub(crate) struct Counting(pub u8);

impl crate::random::Random for Counting {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), crate::random::RandomError> {
        for byte in bytes {
            self.0 = self.0.wrapping_add(1);
            *byte = self.0;
        }
        Ok(())
    }
}
