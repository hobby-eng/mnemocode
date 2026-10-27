//! The recovery pack (CAP-PHRASE-FORMATS-RECOVERY-GUIDE, -RECOVERY-PACK): the manual recovery
//! guide and the numbered dictionaries as named files, which the front ends save or show. The
//! guide is MnemoCode TS's docs/MANUAL_RECOVERY.md, bundled here so that a page offers it too.

use crate::bip39::table::{Format, text};

/// The manual recovery guide, a Markdown document.
pub const MANUAL_RECOVERY: &str = include_str!("../assets/MANUAL_RECOVERY.md");
/// The guide's file name in a pack.
pub const MANUAL_RECOVERY_FILE: &str = "manual-recovery.md";

/// The files of the recovery pack, each with its name: every numbered dictionary, then the guide.
pub fn files() -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = Format::ALL
        .into_iter()
        .map(|format| {
            (
                format!("bip39-{}.txt", format.name()),
                text(Some(format)).into_bytes(),
            )
        })
        .collect();
    files.push((
        MANUAL_RECOVERY_FILE.to_owned(),
        MANUAL_RECOVERY.as_bytes().to_vec(),
    ));
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pack_holds_every_dictionary_and_the_guide() {
        let names: Vec<String> = files().into_iter().map(|(name, _)| name).collect();
        assert_eq!(
            names,
            [
                "bip39-english.txt",
                "bip39-chinese.txt",
                "bip39-unicode.txt",
                "bip39-mapping.txt",
                "manual-recovery.md"
            ]
        );
        assert!(MANUAL_RECOVERY.starts_with('#'));
    }
}
