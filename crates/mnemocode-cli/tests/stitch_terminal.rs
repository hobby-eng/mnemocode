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
    session.wait_for("Choose an action");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    written
}

/// A file of the test's own folder, for `name`.
fn file(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(name)
}

/// A new folder of the test `name` with a picture of smooth shades: the folder and the picture.
fn folder_with_picture(name: &str) -> (PathBuf, PathBuf) {
    let folder = file(name);
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    let picture = folder.join("picture.png");
    fs::write(&picture, mnemocode_embroidery::sample::gradient_png()).expect("a picture");
    (folder, picture)
}

/// The menu at its first question of Embroidery, whether Seedshift is used.
fn at_embroidery() -> Session {
    let mut session = Session::start(PROGRAM, &[]);
    // A window of today's usual size, where a result shows at once, not by pages.
    session.resize(60, 100);
    session.wait_for("Choose an action");
    session.press("1");
    session.wait_for("Which form should the seed phrase take?");
    session.press("6");
    session.wait_for("Use Seedshift?");
    session
}

/// The menu's Decode at the question for a cross-stitch pattern's PDF or folder.
fn at_decode_of_patterns() -> Session {
    let mut session = Session::start(PROGRAM, &[]);
    // A window of today's usual size, where a result shows at once, not by pages.
    session.resize(60, 100);
    session.wait_for("Choose an action");
    session.press("3");
    session.wait_for("In a cross-stitch pattern");
    session.press("5");
    session
}

/// The files of the task saved in `folder`, the QR code answered `qr`, the public phrase then
/// typed.
fn saved_in(session: &mut Session, folder: &Path, qr: &str) {
    session.wait_for("Enter the folder for the files");
    session.press(&format!("{}\r", folder.display()));
    session.wait_for("Add a QR code?");
    session.press(qr);
    session.wait_for("Enter the seed phrase");
    session.wait_for_answer_keys();
    session.press(&format!("{PHRASE}\r"));
}

/// The menu's Embroidery up to the size of the pattern: the questions of every new backup,
/// MnemoCode Seedshift with `dates`, then the pattern's own, the `picture` and Aida 14.
fn at_the_pattern_size(picture: &Path, dates: &str) -> Session {
    let mut session = at_embroidery();
    session.wait_for("only they turn it back");
    session.press("1");
    session.wait_for("DD-MM-YYYY, separated by spaces):");
    session.wait_for(" back · ");
    session.press(&format!("{dates}\r"));
    session.wait_for("Enter the picture's file name");
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("Which fabric?");
    session.press("\r");
    session.wait_for("How large, on Aida 14?");
    session
}

#[test]
fn the_menu_makes_a_cross_stitch_pattern_with_the_secrets_on_the_private_screen() {
    // The picture bears the pattern's usual name: the pattern takes the next numbered one rather
    // than be saved over its own picture.
    let folder = file("menu-stitch");
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    let picture = folder.join("cross-stitch-pattern.pdf");
    fs::write(&picture, mnemocode_embroidery::sample::gradient_png()).expect("a picture");
    let pdf = folder.join("cross-stitch-pattern_1.pdf");
    // Aida 14 first, then the sizes, each with the stitches that the picture of 240 by 160 pixels
    // takes in it inside the print margin, A4 turned to hold it larger; a width in centimetres
    // within the picture's own.
    let mut session = at_the_pattern_size(
        &picture,
        "23-09-2026 22-09-2026 21-09-2026 20-09-2026 19-09-2026",
    );
    session.wait_for("A4, 21 x 29.7 cm");
    session.wait_for("152 x 101 stitches, 27.6 x 18.3 cm");
    session.press("6");
    session.wait_for("Enter the width in centimetres");
    session.wait_for(" (7.3 to 43.7): ");
    session.press("5\r");
    session.wait_for("Type a number of centimetres from 7.3 to 43.7.");
    session.press("21.9\r");
    // Back in the common block: shares, the copies on the screen, the sheet for heirs, and last
    // where it is saved, the folder of the task's files asked once for the pattern's PDF.
    session.wait_for("Split it into Shamir shares?");
    session.wait_for("2 of 3");
    session.press("1");
    session.wait_for("Instructions for your heirs?");
    session.press("1");
    session.wait_for("Where should the result be saved?");
    session.wait_for("the legend line, which Decode reads back");
    session.press("\r");
    session.wait_for("Enter the folder for the files");
    session.press(&format!("{}\r", folder.display()));
    session.wait_for("Add a QR code?");
    session.press("1");

    // Dates were already entered; only the phrase remains, with checksum retry.
    session.wait_for("Enter the seed phrase");
    session.wait_for_answer_keys();
    session.press(&format!("{}\r", PHRASE.replace("about", "abandon")));
    session.wait_for("These words fail the BIP39 checksum");
    session.press(&format!("{PHRASE}\r"));
    // The phrase length is now known: five dates cannot mask twelve words.
    session.wait_for("Too many dates for this seed phrase");
    session.wait_for("up to 4, DD-MM-YYYY");
    session.wait_for_answer_keys();
    session.press("23-09-2026\r");
    // The phrase after Seedshift, then the legend and the files saved, on one screen.
    session.wait_for("Seed phrase after Seedshift");
    session.wait_for("Saved files");
    let written = cleared_and_quit(session);
    let saved = fs::read(&pdf).expect("the pattern");
    assert!(saved.starts_with(b"%PDF-"));
    let outside = written.rsplit(LEAVE_PRIVATE_SCREEN).next().expect("a part");
    assert!(!outside.contains("abandon"), "{outside}");
    assert!(!outside.contains("23-09-2026"), "{outside}");
}

// Shares in the menu's embroidery: the same block of questions, a set chosen, and one pattern a
// share saved in a new folder of the task's folder, with their legend lines in one text file.
#[test]
fn the_menu_makes_a_pattern_a_share() {
    let (folder, picture) = folder_with_picture("menu-stitch-shares");
    let mut session = at_the_pattern_size(&picture, "23-09-2026");
    session.press("1");
    session.wait_for("Split it into Shamir shares?");
    session.press("2");
    session.wait_for("Instructions for your heirs?");
    session.press("1");
    session.wait_for("Where should the shares be saved?");
    session.wait_for("every share's legend line, one to a line");
    // The PDF patterns are ticked already; the text file of the legends too.
    session.press("2");
    session.press("\r");
    // A QR code of each legend with hidden data: a scanner sees a contact card MnemoCode invents.
    saved_in(&mut session, &folder, "3");
    // The phrase after Seedshift first, then its shares, all on one screen of a usual window.
    session.wait_for("Seed phrase after Seedshift");
    session.wait_for("That phrase split into Shamir shares");
    session.wait_for("Share 1 of 3");
    let written = cleared_and_quit(session);
    for place in 1..=3 {
        let pattern = folder.join(format!("cross-stitch-patterns/share-{place}-pattern.pdf"));
        assert!(fs::read(&pattern).expect("a pattern").starts_with(b"%PDF-"));
    }
    let legends = fs::read_to_string(folder.join("cross-stitch-legend.txt")).expect("legends");
    assert_eq!(legends.lines().count(), 3, "{legends}");
    for place in 1..=3 {
        let image = folder.join(format!("cross-stitch-legend-qr/share-{place}-qr.png"));
        assert!(fs::read(&image).expect("a QR code").starts_with(b"\x89PNG"));
    }
    let outside = written.rsplit(LEAVE_PRIVATE_SCREEN).next().expect("a part");
    assert!(!outside.contains("abandon"), "{outside}");
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
    session.wait_for("Enter the picture's file name");
    session.press(&format!("{}\r", picture.display()));
    // The gradient is 240 pixels across, fewer than 300 stitches.
    session.wait_for("narrower than the pattern");
    // Another size is offered as the menu offers it, the sheets first.
    session.press("2");
    session.wait_for("How large, on Aida 14?");
    session.wait_for("A6, 10.5 x 14.8 cm");
    session.press("1");
    session.wait_for_answer_keys();
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
    session.wait_for_answer_keys();
    session.press(&format!("{PHRASE}\r"));
    session.wait_for_answer_keys();
    session.press("23-09-2026\r");
    session.wait_for("too few colours");
    session.press("1");
    session.wait_for("Enter the picture's file name");
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
    // A window of today's usual size, where a result shows at once, not by pages.
    session.resize(60, 100);
    session.wait_for_answer_keys();
    session.press(&format!("{mistyped}\r"));
    session.wait_for("Was Seedshift used when it was encoded?");
    session.press("2");
    session.wait_for_answer_keys();
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
    let mut session = at_decode_of_patterns();
    session.wait_for("Enter the folder of the patterns, or one pattern's PDF");
    session.press(&format!("{}\r", pdf.display()));
    // The legend does not say whether Seedshift was used: it is asked, then the dates.
    session.wait_for("Found cross-stitch backup");
    session.wait_for("Was Seedshift used when it was encoded?");
    session.press("2");
    session.wait_for("up to 4, DD-MM-YYYY");
    session.press("23-09-2026\r");
    session.wait_for("abandon");
    cleared_and_quit(session);
}

// Restore from shares takes the folder of the patterns: the one set it holds is taken and named,
// the other file counted, and with the dates the shares give the phrase back.
#[test]
fn a_folder_of_share_patterns_restores_the_phrase() {
    let folder = file("restore-from-folder");
    share_patterns(&folder);
    // A copy of a pattern and a file that is no pattern change nothing.
    fs::copy(
        folder.join("patterns/share-2-pattern.pdf"),
        folder.join("patterns/copy.pdf"),
    )
    .expect("a copy");
    fs::write(folder.join("patterns/notes.pdf"), "%PDF-1.4 nothing").expect("a file");
    let mut session = restore_from_folder(
        "2",
        "Enter the Shamir shares, or the path of a file or folder",
        &folder.join("patterns"),
    );
    session.wait_for("Found cross-stitch shares: 3 shares, 2 needed");
    session.wait_for("1 other file holds");
    session.wait_for("Enter the dates that mask the seed phrase");
    session.wait_for_answer_keys();
    session.press("23-09-2026\r");
    session.wait_for(PHRASE);
    let written = cleared_and_quit(session);
    let outside = written.rsplit(LEAVE_PRIVATE_SCREEN).next().expect("a part");
    assert!(!outside.contains("abandon"), "{outside}");
}

// In the menu's tasks Shift+Tab goes back a step, past steps that asked nothing, and Escape leaves
// for the main menu; the keys are named under each question.
#[test]
fn shift_tab_goes_back_a_step_and_escape_to_the_menu() {
    const SHIFT_TAB: &str = "\x1b[Z";
    let (_, picture) = folder_with_picture("menu-steps");
    let mut session = at_embroidery();
    session.wait_for(" back · ");
    session.press("1");
    session.wait_for("DD-MM-YYYY, separated by spaces):");
    session.wait_for(" back · ");
    session.press(SHIFT_TAB);
    // Without Seedshift no dates are asked, and going back passes them.
    session.wait_for("Use Seedshift?");
    session.press("3");
    session.wait_for("Enter the picture's file name");
    session.press(SHIFT_TAB);
    session.wait_for("Use Seedshift?");
    session.press("1");
    session.wait_for("DD-MM-YYYY, separated by spaces):");
    session.press("23-09-2026\r");
    session.wait_for("Enter the picture's file name");
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("Which fabric?");
    session.press(SHIFT_TAB);
    session.wait_for("Enter the picture's file name");
    session.press("\x1b");
    session.wait_for("Choose an action");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
}

/// The patterns of a 2 of 3 split of the public phrase, masked with 23-09-2026, in the folder
/// `patterns` of `folder`.
fn share_patterns(folder: &Path) {
    let _absent = fs::remove_dir_all(folder);
    fs::create_dir_all(folder).expect("a folder");
    fs::write(
        folder.join("picture.png"),
        mnemocode_embroidery::sample::gradient_png(),
    )
    .expect("a picture");
    fs::write(folder.join("phrase.txt"), format!("{PHRASE}\n")).expect("a phrase");
    fs::write(folder.join("dates.txt"), "23-09-2026\n").expect("the dates");
    let made = std::process::Command::new(PROGRAM)
        .current_dir(folder)
        .args([
            "stitch",
            "--mnemonic-file",
            "phrase.txt",
            "--dates-file",
            "dates.txt",
            "--picture",
            "picture.png",
            "--threshold",
            "2",
            "--shares",
            "3",
            "--pdf-dir",
            "patterns",
        ])
        .output()
        .expect("the patterns");
    assert!(made.status.success(), "{made:?}");
}

// Decode takes the folder of the patterns too: it names the set of shares in it and sends them to
// the restore, which asks about Seedshift and the dates and gives the phrase back.
#[test]
fn decode_reads_a_folder_of_share_patterns() {
    let folder = file("decode-folder");
    share_patterns(&folder);
    let mut session = at_decode_of_patterns();
    session.wait_for("Enter the folder of the patterns, or one pattern's PDF");
    session.press(&format!("{}\r", folder.join("patterns").display()));
    session.wait_for("Found cross-stitch shares: 3 shares, 2 needed");
    session.wait_for("Was Seedshift used before it was split?");
    session.press("2");
    session.wait_for("Enter the dates that mask the seed phrase");
    session.wait_for_answer_keys();
    session.press("23-09-2026\r");
    session.wait_for(PHRASE);
    cleared_and_quit(session);
}

// Restore from shares takes a folder of the QR code images of standard shares as well.
#[test]
fn a_folder_of_share_qr_codes_restores_the_phrase() {
    let folder = file("restore-from-qr-folder");
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    fs::write(folder.join("phrase.txt"), format!("{PHRASE}\n")).expect("a phrase");
    let made = std::process::Command::new(PROGRAM)
        .current_dir(&folder)
        .args([
            "sskr-split",
            "--mnemonic-file",
            "phrase.txt",
            "--threshold",
            "2",
            "--shares",
            "3",
            "--qr-dir",
            "qr",
        ])
        .output()
        .expect("the shares");
    assert!(made.status.success(), "{made:?}");
    let mut session = restore_from_folder(
        "1",
        "Enter the Shamir shares, or the path of a file or folder",
        &folder.join("qr"),
    );
    session.wait_for("Found QR codes of Shamir shares: 3 shares, 2 needed");
    session.wait_for(PHRASE);
    cleared_and_quit(session);
}

// An answer changed after Shift+Tab is the one taken: the pattern is made without Seedshift once
// that is chosen again, with no dates asked and no phrase after Seedshift shown.
#[test]
fn an_answer_changed_after_shift_tab_replaces_the_old_one() {
    const SHIFT_TAB: &str = "\x1b[Z";
    let (folder, picture) = folder_with_picture("menu-changed");
    let mut session = at_the_pattern_size(&picture, "23-09-2026");
    // Back from the size to the fabric, the picture, the dates and Seedshift.
    for asked in [
        "Which fabric?",
        "Enter the picture's file name",
        "DD-MM-YYYY",
        "Use Seedshift?",
    ] {
        session.press(SHIFT_TAB);
        session.wait_for(asked);
    }
    session.press("3");
    session.wait_for("Enter the picture's file name");
    session.press(&format!("{}\r", picture.display()));
    session.wait_for("Which fabric?");
    session.press("\r");
    session.wait_for("How large, on Aida 14?");
    session.press("1");
    session.wait_for("Split it into Shamir shares?");
    session.press("1");
    session.wait_for("Instructions for your heirs?");
    session.press("1");
    session.wait_for("Where should the result be saved?");
    session.press("\r");
    saved_in(&mut session, &folder, "1");
    session.wait_for("Saved files");
    let written = cleared_and_quit(session);
    let result = written
        .rsplit("Making the pattern")
        .next()
        .expect("the result");
    assert!(!result.contains("Seed phrase after Seedshift"), "{result}");
    assert!(!result.contains("with your dates"), "{result}");
    assert!(folder.join("cross-stitch-pattern.pdf").is_file());
}

/// The menu's Restore from shares, answered `seedshift` about Seedshift, and given `folder` once
/// `asked` shows.
fn restore_from_folder(seedshift: &str, asked: &str, folder: &Path) -> Session {
    let mut session = Session::start(PROGRAM, &[]);
    // A window of today's usual size, where a result shows at once, not by pages.
    session.resize(60, 100);
    session.wait_for("Choose an action");
    session.press("5");
    session.wait_for("Was Seedshift used before it was split?");
    session.press(seedshift);
    session.wait_for(asked);
    session.wait_for_answer_keys();
    session.press(&format!("{}\r", folder.display()));
    session
}
