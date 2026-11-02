//! The largest exports, 16 shares of a 24-word phrase in Unicode codes, each of 34 cards, which a
//! command saves under its memory cap (`os::protect`). The program sets the cap itself, so that a
//! save past it ends in an allocation that fails, not in a refusal. They take minutes each here and
//! run at release, as the replays do (RUST-08).

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

mod common;

use common::{LONG_PHRASE, folder, names, outputs, page_sizes, read, saved};

const SPLIT: [&str; 9] = [
    "sskr-split",
    "--mnemonic-file",
    LONG_PHRASE,
    "--threshold",
    "2",
    "--shares",
    "16",
    "--format",
    "unicode",
];

/// Saves the cards of 16 shares with the options `more` in a folder of `name`.
fn split_with(name: &str, more: &[&str]) -> std::path::PathBuf {
    let folder = folder(name);
    let args: Vec<&str> = SPLIT.iter().chain(more).copied().collect();
    saved(&folder, &args);
    folder
}

#[test]
#[ignore = "a PDF of 16 sheets, a minute in a debug build: it runs at release"]
fn the_sheets_of_sixteen_shares_are_saved_as_one_pdf() {
    let folder = split_with("sixteen-pdf", &["--pdf", "shares.pdf"]);
    assert_eq!(page_sizes(&read(&folder, "shares.pdf")).len(), 16);
}

#[test]
#[ignore = "a PDF of 337 MB, the largest of the designs, minutes in a debug build: it runs at release"]
fn the_sheets_of_sixteen_shares_are_saved_in_the_design_that_takes_the_most_room() {
    let folder = split_with(
        "sixteen-estate-pdf",
        &["--template", "business-estate", "--pdf", "shares.pdf"],
    );
    assert_eq!(page_sizes(&read(&folder, "shares.pdf")).len(), 16);
}

#[test]
#[ignore = "a PDF of 544 cards, a minute in a debug build: it runs at release"]
fn the_cards_of_sixteen_shares_are_saved_as_one_pdf() {
    let folder = split_with(
        "sixteen-cards-pdf",
        &["--page-size", "business", "--pdf", "shares.pdf"],
    );
    assert_eq!(page_sizes(&read(&folder, "shares.pdf")).len(), 544);
}

#[test]
#[ignore = "544 page images, minutes in a debug build: it runs at release"]
fn the_cards_of_sixteen_shares_are_saved_as_page_images() {
    let folder = split_with(
        "sixteen-cards-images",
        &[
            "--page-size",
            "business",
            "--images-dir",
            "images",
            "--image-format",
            "jpg",
        ],
    );
    assert_eq!(names(&folder.join("images")).len(), 544);
    assert!(outputs(&folder).iter().all(|name| !name.starts_with('.')));
}
