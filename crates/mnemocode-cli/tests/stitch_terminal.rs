//! SeedStitch at a terminal (the `pty` gate, docs/design/architect/GATES.md): the menu's Embroidery,
//! a picture that cannot be used asked again before and after the phrase, and a typed legend
//! decoded, a pseudo-terminal driving the program as a person does, on the public test phrase only.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test runs the program and writes public inputs to a folder of its own"
)]

#[path = "common/terminal.rs"]
mod terminal;

use std::fs;
use std::path::{Path, PathBuf};

use terminal::Session;

const PROGRAM: &str = env!("CARGO_BIN_EXE_mnemocode");
const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const LEAVE_PRIVATE_SCREEN: &str = "\x1b[?1049l";
/// A file of the test's own folder, for `name`.
fn file(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(name)
}

#[test]
fn the_menu_makes_a_cross_stitch_pattern_with_the_secrets_on_the_private_screen() {
    let picture = file("gradient.png");
    fs::write(&picture, mnemocode_embroidery::sample::gradient_png()).expect("a picture");
    let pdf = file("menu-pattern.pdf");
    let _absent = fs::remove_file(&pdf);
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("1");
    session.wait_for("Which form should the seed phrase take?");
    session.press("6");
    session.wait_for("Picture file name");
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("How many stitches across?");
    session.press("39\r");
    session.wait_for("Type a number from 40 through 500.");
    session.press("120\r");
    session.wait_for("PDF file name");
    // The pattern may not be saved over its own picture: the name is asked again.
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("Another file of this task has this name");
    session.press(&format!("{}\r", pdf.display()));
    session.wait_for("--stitches-across 120 --pdf");
    // The phrase, then the dates, each on the private screen.
    session.wait_for("(Esc cancels)");
    session.press(&format!("{PHRASE}\r"));
    session.wait_for("(Esc cancels)");
    session.press("23-09-2026\r");
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    session.wait_for("What do you want to do?");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    let saved = fs::read(&pdf).expect("the pattern");
    assert!(saved.starts_with(b"%PDF-"));
    let outside = written.rsplit(LEAVE_PRIVATE_SCREEN).next().expect("a part");
    assert!(!outside.contains("abandon"), "{outside}");
    assert!(!outside.contains("23-09-2026"), "{outside}");
}

#[test]
fn a_picture_that_cannot_be_used_is_asked_again_before_the_phrase() {
    let picture = file("asked-again.png");
    fs::write(&picture, mnemocode_embroidery::sample::gradient_png()).expect("a picture");
    let text = file("not-a-picture.txt");
    fs::write(&text, "no picture").expect("a file");
    let pdf = file("asked-again.pdf");
    let path = |path: &Path| path.to_str().expect("a path").to_owned();
    let (text, pdf) = (path(&text), path(&pdf));
    let mut session = Session::start(
        PROGRAM,
        &[
            "stitch",
            "--ask-secrets",
            "--picture",
            &text,
            "--stitches-across",
            "300",
            "--pdf",
            &pdf,
        ],
    );
    session.wait_for("no PNG or JPEG");
    session.press("1");
    session.wait_for("Picture file name");
    session.press(&format!("{}\r", picture.display()));
    // The gradient is 240 pixels across, fewer than 300 stitches.
    session.wait_for("narrower than the pattern");
    session.press("2");
    session.wait_for("Stitches across");
    session.press("120\r");
    session.wait_for("(Esc cancels)");
    session.press("\x03");
    let (status, written) = session.end();
    assert_eq!(status, 130, "{written}");
}

#[test]
fn a_picture_too_flat_for_the_phrase_is_changed_and_the_phrase_kept() {
    let flat = file("flat.png");
    fs::write(&flat, mnemocode_embroidery::sample::two_colours_png()).expect("a picture");
    let picture = file("after-flat.png");
    fs::write(&picture, mnemocode_embroidery::sample::gradient_png()).expect("a picture");
    let pdf = file("after-flat.pdf");
    let _absent = fs::remove_file(&pdf);
    let path = |path: &Path| path.to_str().expect("a path").to_owned();
    let (flat, pdf_path) = (path(&flat), path(&pdf));
    let mut session = Session::start(
        PROGRAM,
        &[
            "stitch",
            "--ask-secrets",
            "--picture",
            &flat,
            "--pdf",
            &pdf_path,
        ],
    );
    session.wait_for("(Esc cancels)");
    session.press(&format!("{PHRASE}\r"));
    session.wait_for("(Esc cancels)");
    session.press("23-09-2026\r");
    session.wait_for("too few colours");
    session.press("1");
    session.wait_for("Picture file name");
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    assert!(fs::read(&pdf).expect("the pattern").starts_with(b"%PDF-"));
}

#[test]
fn a_typed_legend_is_decoded_and_its_corrected_row_stays_in_the_summary() {
    // docs/SEEDSTITCH.md's example with two digits of its first row swapped.
    let mistyped = mnemocode_embroidery::legend::EXAMPLE.replacen("28:1725", "28:1752", 1);
    let mut session = Session::start(PROGRAM, &["decode", "--ask-secrets"]);
    session.wait_for("(Esc cancels)");
    session.press(&format!("{mistyped}\r"));
    session.wait_for("(Esc cancels)");
    session.press("23-09-2026\r");
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    let outside = written.rsplit(LEAVE_PRIVATE_SCREEN).next().expect("a part");
    assert!(
        outside.contains("Row 1 of the legend did not fit"),
        "{outside}"
    );
    assert!(!outside.contains("28:17"), "{outside}");
}
