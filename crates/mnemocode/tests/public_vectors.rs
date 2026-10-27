//! The compiled-in public vectors (`checks::public_vectors`) against vectors/mnemocode-v1.json, the
//! file they are taken from, entry for entry.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use mnemocode::checks::public_vectors::PUBLIC_VECTORS;
use serde_json::Value;

const FILE: &str = include_str!("../../../vectors/mnemocode-v1.json");

#[test]
fn the_table_is_the_file() {
    let file: Value = serde_json::from_str(FILE).unwrap();
    assert_eq!(file["version"], 1);
    let vectors = file["vectors"].as_array().unwrap();
    assert_eq!(vectors.len(), PUBLIC_VECTORS.len());
    for (recorded, compiled) in vectors.iter().zip(&PUBLIC_VECTORS) {
        let text = |key: &str| recorded[key].as_str().map(str::to_owned);
        assert_eq!(text("name").as_deref(), Some(compiled.name));
        assert_eq!(text("mode").as_deref(), Some(compiled.mode.id()));
        assert_eq!(text("sourceMnemonic").as_deref(), Some(compiled.source));
        let dates: Vec<&str> = recorded["dates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|date| date.as_str().unwrap())
            .collect();
        assert_eq!(dates, compiled.dates);
        assert_eq!(text("english").as_deref(), Some(compiled.english));
        assert_eq!(text("indexes").as_deref(), Some(compiled.indexes));
        assert_eq!(text("unicode").as_deref(), Some(compiled.unicode));
        assert_eq!(text("colors").as_deref(), Some(compiled.colors));
        assert_eq!(
            text("colorsUnicode").as_deref(),
            Some(compiled.colors_unicode)
        );
        assert_eq!(
            text("sourceFingerprint").as_deref(),
            compiled.source_fingerprint
        );
        assert_eq!(
            text("encodedFingerprint").as_deref(),
            compiled.encoded_fingerprint
        );
    }
}
