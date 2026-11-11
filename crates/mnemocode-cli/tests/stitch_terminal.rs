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
/// Clears the result screen, quits the menu and gives all that the run wrote, which must end well.
fn cleared_and_quit(mut session: Session) -> String {
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    session.wait_for("What do you want to do?");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    written
}

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
    session.wait_for("Use Seedshift?");
    session.press("1");
    session.wait_for("DD-MM-YYYY, separated by spaces):");
    session.wait_for(" to cancel");
    session.press("23-09-2026 22-09-2026 21-09-2026 20-09-2026 19-09-2026\r");
    session.wait_for("Picture file name");
    session.press(&format!("{}\r", picture.display()));
    // Aida 14 first, then the sizes, each with the stitches that the picture of 240 by 160 pixels
    // takes in it inside the print margin, A4 turned to hold it larger; a width in centimetres
    // within the picture's own.
    session.wait_for("Which fabric?");
    session.press("\r");
    session.wait_for("How large, on Aida 14?");
    session.wait_for("A4, 21 x 29.7 cm");
    session.wait_for("152 x 101 stitches, 27.6 x 18.3 cm");
    session.press("6");
    session.wait_for("Width in centimetres");
    session.wait_for(" (7.3 to 43.5): ");
    session.press("5\r");
    session.wait_for("Type a number of centimetres from 7.3 to 43.5.");
    session.press("21.9\r");
    session.wait_for("PDF file name");
    // The pattern may not be saved over its own picture: the name is asked again.
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("Another file of this task has this name");
    session.press(&format!("{}\r", pdf.display()));

    // Dates were already entered; only the phrase remains, with checksum retry.
    session.wait_for(" to cancel");
    session.press(&format!("{}\r", PHRASE.replace("about", "abandon")));
    session.wait_for("These words fail the BIP39 checksum");
    session.press(&format!("{PHRASE}\r"));
    // The phrase length is now known: five dates cannot mask twelve words.
    session.wait_for("Too many dates for this seed phrase");
    session.wait_for("up to 4, DD-MM-YYYY");
    session.wait_for(" to cancel");
    session.press("23-09-2026\r");
    let written = cleared_and_quit(session);
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
    session.wait_for("no PNG, JPEG or WebP");
    session.press("1");
    session.wait_for("Picture file name");
    session.press(&format!("{}\r", picture.display()));
    // The gradient is 240 pixels across, fewer than 300 stitches.
    session.wait_for("narrower than the pattern");
    // Another size is offered as the menu offers it, the sheets first.
    session.press("2");
    session.wait_for("How large, on Aida 14?");
    session.wait_for("A6, 10.5 x 14.8 cm");
    session.press("1");
    session.wait_for(" to cancel");
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
    session.wait_for(" to cancel");
    session.press(&format!("{PHRASE}\r"));
    session.wait_for(" to cancel");
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
    session.wait_for(" to cancel");
    session.press(&format!("{mistyped}\r"));
    session.wait_for(" to cancel");
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

#[test]
fn the_menu_s_decode_reads_the_phrase_from_a_pattern_s_pdf() {
    let picture = file("gradient-decode.png");
    fs::write(&picture, mnemocode_embroidery::sample::gradient_png()).expect("a picture");
    let (phrase, dates, pdf) = (
        file("decode-phrase.txt"),
        file("decode-dates.txt"),
        file("decode-pattern.pdf"),
    );
    fs::write(&phrase, format!("{PHRASE}\n")).expect("a file");
    fs::write(&dates, "23-09-2026\n").expect("a file");
    let _absent = fs::remove_file(&pdf);
    let made = terminal::colour::plain(&mut std::process::Command::new(PROGRAM))
        .args(["stitch", "--mnemonic-file"])
        .arg(&phrase)
        .arg("--dates-file")
        .arg(&dates)
        .arg("--picture")
        .arg(&picture)
        .args(["--stitches-across", "120", "--pdf"])
        .arg(&pdf)
        .output()
        .expect("the program runs");
    assert!(made.status.success(), "{made:?}");
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("3");
    session.wait_for("In a cross-stitch pattern");
    session.press("4");
    session.wait_for("PDF file name");
    session.press(&format!("{}\r", pdf.display()));
    // The legend says the phrase is masked: the dates are asked, and the words come back.
    session.wait_for("up to 4, DD-MM-YYYY");
    session.press("23-09-2026\r");
    session.wait_for("abandon");
    cleared_and_quit(session);
}
