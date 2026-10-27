//! Candidate lists against vectors/candidates-v1.json (TS 0.1.0's own): every list written byte for
//! byte as TS writes it and read back, every damaged list refused for its reason, and Padmé's
//! lengths.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use mnemocode::candidates::format::{CandidateList, padme_length};
use mnemocode::secret::SecretBytes;
use mnemocode::text::hex::{bytes_of_hex, hex_of_bytes};
use serde_json::Value;

const FILE: &str = include_str!("../../../vectors/candidates-v1.json");

fn vectors() -> Value {
    serde_json::from_str(FILE).unwrap()
}

#[test]
fn every_list_is_written_and_read_as_ts_does() {
    let file = vectors();
    for list in file["lists"].as_array().unwrap() {
        let records = list["records"].as_array().unwrap();
        let entropy: Vec<u8> = records
            .iter()
            .flat_map(|record| bytes_of_hex(record["entropy"].as_str().unwrap()).unwrap())
            .collect();
        let length = entropy.len() / records.len();
        let own: Vec<Option<&str>> = records
            .iter()
            .map(|record| record["passphrase"].as_str())
            .collect();
        let own = if own.iter().any(Option::is_some) {
            own
        } else {
            Vec::new()
        };
        let built = CandidateList::new(
            SecretBytes::copy_of("test entropies", &entropy),
            length,
            list["passphrase"].as_str(),
            &own,
        )
        .unwrap();
        let name = list["name"].as_str().unwrap();
        assert_eq!(
            hex_of_bytes(&built.encode()),
            list["bytes"].as_str().unwrap(),
            "{name}"
        );
        let read =
            CandidateList::decode(&bytes_of_hex(list["bytes"].as_str().unwrap()).unwrap()).unwrap();
        for (place, record) in records.iter().enumerate() {
            let (phrase, passphrase) = read.candidate(place).unwrap();
            assert_eq!(
                phrase.text().as_str(),
                record["phrase"].as_str().unwrap(),
                "{name}"
            );
            let expected = record["passphrase"]
                .as_str()
                .or_else(|| list["passphrase"].as_str())
                .unwrap_or("");
            assert_eq!(passphrase, expected, "{name}");
        }
    }
}

#[test]
fn every_damaged_list_is_refused_for_its_reason() {
    let file = vectors();
    for list in file["invalidLists"].as_array().unwrap() {
        let refusal =
            CandidateList::decode(&bytes_of_hex(list["bytes"].as_str().unwrap()).unwrap())
                .unwrap_err();
        let reason = list["refusal"].as_str().unwrap();
        assert!(
            refusal.to_string().contains(reason),
            "{}: {refusal}",
            list["name"]
        );
    }
}

#[test]
fn padme_lengths_are_ts_s() {
    for case in vectors()["padme"].as_array().unwrap() {
        let length = usize::try_from(case["length"].as_u64().unwrap()).unwrap();
        assert_eq!(
            padme_length(length) as u64,
            case["padded"].as_u64().unwrap(),
            "{length}"
        );
    }
}
