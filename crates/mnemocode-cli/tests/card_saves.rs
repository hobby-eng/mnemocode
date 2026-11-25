//! The saves of cards that fail, as MnemoCode TS 0.1.0's tests pin them (aud-021-export,
//! aud-026-export), with the outputs made before the seed phrase (CORE-55): off the private screen
//! the failure ends the command before the outputs after it; on it, each output is tried again or
//! skipped while the cards of the one plan stay as they were, and no other name is offered, as no
//! folder is open to one. What was made and stayed unused is removed, or named where the rules on
//! writes keep it. The faults are real ones of the file system, from outside the program, which
//! runs on public inputs.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test closes folders of its own, watches them and drives the program"
)]

mod common;
#[path = "common/terminal.rs"]
mod terminal;

use std::fs::{self, Permissions};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use std::process::{Command, Stdio};

use common::{
    PHRASE, assert_same_cards, assert_same_pictures, folder, full, names, numbered, outputs,
    page_sizes, read,
};
use mnemocode::self_check::vectors::PUBLIC_MNEMONIC;
use terminal::{Session, Setting};

/// Where the private screen asks for the phrase.
const PHRASE_ASKED: &str = " to cancel";
/// What the private screen asks after a save that failed; "1" and "2" choose an answer: no other
/// name is offered for what was made before the seed phrase.
const WHAT_NOW: &str = "What now?";
const TRY_AGAIN: &str = "1";
const SKIP: &str = "2";
/// What ends the private screen once every output was saved or skipped.
const CLEAR_THE_SCREEN: &str = "Press Enter to clear this screen.";
/// The folders of the outputs of a test on a terminal, each closed and opened on its own.
const FOR_PDF: &str = "for-pdf";
const FOR_IMAGES: &str = "for-images";
const FOR_CARDS: &str = "for-cards";
/// The PDF of a test on a terminal.
const PDF: &str = "for-pdf/public.pdf";
/// The folders that the command makes for the images and the card files before the seed phrase,
/// which a test closes so that a save into them fails.
const IMAGES: &str = "for-images/images";
const CARD_FILES: &str = "for-cards/cards";
/// Why a save into a closed folder fails.
const NO_PERMISSION: &str = "there is no permission to write there.";
/// What the private screen says while it draws cards.
const RENDERING: &str = "Rendering the cards";
/// The cards of the public phrase in colors: its eight codes and one decoy.
const CARDS: usize = 9;
/// Those cards as a PDF, as page images and as card files, the last two the same pictures.
const EVERY_OUTPUT: [&str; 14] = [
    "--format",
    "colors",
    "--template",
    "business-it",
    "--page-size",
    "business",
    "--pdf",
    PDF,
    "--images-dir",
    IMAGES,
    "--cards-dir",
    CARD_FILES,
    "--image-format",
    "png",
];
/// A QR image in a folder that a test closes, and what says that it was read back and saved.
const QR_IMAGE: [&str; 4] = ["--format", "unicode", "--qr", "for-pdf/public.png"];
const QR_VERIFIED: &str = "QR code verified.";

/// The program on a pseudo-terminal, tall enough that a result needs no pager before its questions,
/// with `args` in `folder`.
fn screen(folder: &Path, args: &[&str]) -> Session {
    let setting = Setting {
        rows: 60,
        columns: 100,
        term: "xterm-256color",
        folder,
    };
    Session::start_with(&setting, env!("CARGO_BIN_EXE_mnemocode"), args)
}

/// Clears the screen of the result: the exit status of the program, and all it wrote as a person
/// reads it, without the sequences that colour it, its wrapped lines one sentence.
fn finish(mut screen: Session) -> (u32, String) {
    screen.wait_for(CLEAR_THE_SCREEN);
    screen.press("\r");
    ended(screen)
}

/// The exit status of the program, and all it wrote as a person reads it.
fn ended(screen: Session) -> (u32, String) {
    let (status, written) = screen.end();
    let mut parts = written.split('\x1b');
    let mut text = parts.next().unwrap_or_default().to_owned();
    for part in parts {
        // A sequence ends at its first letter.
        let letter = part.find(|character: char| character.is_ascii_alphabetic());
        text.push_str(&part[letter.map_or(part.len(), |at| at + 1)..]);
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    (status, words.join(" "))
}

/// `folder` opened or closed to writes.
fn set_open(folder: &Path, open: bool) {
    let mode = if open { 0o700 } else { 0o500 };
    fs::set_permissions(folder, Permissions::from_mode(mode)).expect("the permissions");
}

/// Whether closing a folder fails a save here: root writes everywhere.
fn a_closed_folder_stops_a_write(folder: &Path) -> bool {
    let closed = folder.join("closed");
    fs::create_dir(&closed).expect("a folder");
    set_open(&closed, false);
    let stopped = fs::create_dir(closed.join("written")).is_err();
    set_open(&closed, true);
    fs::remove_dir_all(&closed).expect("the folder gone");
    stopped
}

/// `encode` of the public phrase on a terminal in `folder`, saving where `saves` say. It waits at
/// the phrase, so that its checks of the outputs passed, while `closed` is closed, and then types
/// it.
fn encode_with_closed_folders(folder: &Path, saves: &[&str], closed: &[&str]) -> Session {
    for place in [FOR_PDF, FOR_IMAGES, FOR_CARDS] {
        fs::create_dir(folder.join(place)).expect("a folder");
    }
    let mut args = vec![
        "encode",
        "--ask-secrets",
        "--mode",
        "direct",
        "--backup-check",
        "no",
    ];
    args.extend_from_slice(saves);
    let mut screen = at_the_phrase(folder, &args);
    for place in closed {
        set_open(&folder.join(place), false);
    }
    screen.press(&format!("{PUBLIC_MNEMONIC}\r"));
    screen
}

/// That `encode`, with `closed` closed, at the question after the failed save of `what`: none for
/// root, whose save no closed folder fails.
fn at_the_failed_save(
    folder: &Path,
    saves: &[&str],
    closed: &[&str],
    what: &str,
) -> Option<Session> {
    if !a_closed_folder_stops_a_write(folder) {
        return None;
    }
    let mut screen = encode_with_closed_folders(folder, saves, closed);
    screen.wait_for(&format!("{what} could not be saved as"));
    screen.wait_for(WHAT_NOW);
    Some(screen)
}

/// What the program wrote, once it ended well, with `closed` opened again: a folder the program
/// made and left empty is gone where no rules on writes keep it, as on macOS.
fn end_and_open(folder: &Path, screen: Session, closed: &[&str]) -> String {
    let (status, written) = finish(screen);
    for place in closed {
        let path = folder.join(place);
        if path.exists() {
            set_open(&path, true);
        }
    }
    assert_eq!(status, 0, "{written}");
    written
}

/// `name` in `folder`, made before the seed phrase: gone, or empty and named in `written` for the
/// person to delete, where the rules on writes keep it.
#[track_caller]
fn gone_or_left_empty(folder: &Path, name: &str, written: &str) {
    let path = folder.join(name);
    if !path.exists() {
        return;
    }
    if path.is_dir() {
        assert_eq!(names(&path), Vec::<String>::new(), "{name}");
    } else {
        assert!(read(folder, name).is_empty(), "{name}");
    }
    assert!(written.contains(&full(folder, name)), "{written}");
    assert!(
        written.contains("made for the files before the seed phrase was read"),
        "{written}"
    );
}

#[test]
fn the_outputs_are_made_before_the_seed_phrase_is_asked() {
    let folder = folder("made-first");
    for place in [FOR_PDF, FOR_IMAGES, FOR_CARDS] {
        fs::create_dir(folder.join(place)).expect("a folder");
    }
    let mut args = vec!["encode", "--ask-secrets", "--mode", "direct"];
    args.extend_from_slice(&EVERY_OUTPUT);
    let mut screen = at_the_phrase(&folder, &args);
    // Made, empty and private, before anything secret is asked.
    let pdf = fs::metadata(folder.join(PDF)).expect("the PDF made");
    assert_eq!((pdf.len(), pdf.mode() & 0o777), (0, 0o600));
    for made in [IMAGES, CARD_FILES] {
        let metadata = fs::metadata(folder.join(made)).expect("the folder made");
        assert!(metadata.is_dir(), "{made}");
        assert_eq!(metadata.mode() & 0o777, 0o700, "{made}");
        assert_eq!(names(&folder.join(made)), Vec::<String>::new());
    }
    // Cancelled at the phrase: what was made is removed, or stays empty and is named.
    screen.press("\x1b");
    let (status, written) = ended(screen);
    assert_eq!(status, 130, "{written}");
    for made in [PDF, IMAGES, CARD_FILES] {
        gone_or_left_empty(&folder, made, &written);
    }
}

#[test]
fn each_output_tries_its_failed_save_again_and_every_file_shows_the_one_plan() {
    let folder = folder("retries");
    if !a_closed_folder_stops_a_write(&folder) {
        return;
    }
    // The PDF reserved before the seed phrase is written through its open file, whatever its
    // folder allows since; the folders of the images and the card files fail while closed.
    let closed = [FOR_PDF, IMAGES, CARD_FILES];
    let mut screen = encode_with_closed_folders(&folder, &EVERY_OUTPUT, &closed);
    for (what, place) in [("The images", IMAGES), ("The card files", CARD_FILES)] {
        screen.wait_for(&format!("{what} could not be saved as"));
        screen.wait_for(WHAT_NOW);
        set_open(&folder.join(place), true);
        screen.press(TRY_AGAIN);
    }
    let written = end_and_open(&folder, screen, &[FOR_PDF]);
    assert_eq!(written.matches(WHAT_NOW).count(), 2, "{written}");
    for notice in [
        format!(
            "The images could not be saved as {}: {NO_PERMISSION}",
            full(&folder, IMAGES)
        ),
        format!(
            "The card files could not be saved as {}: {NO_PERMISSION}",
            full(&folder, CARD_FILES)
        ),
        format!("Saved PDF: {}", full(&folder, PDF)),
        format!("Saved {CARDS} PNG pages to: {}", full(&folder, IMAGES)),
        format!(
            "Saved {CARDS} individual card files to: {}",
            full(&folder, CARD_FILES)
        ),
    ] {
        assert!(written.contains(&notice), "{notice}: {written}");
    }
    assert!(!written.contains("The PDF could not be saved"), "{written}");
    // What says below that a record alone renders no cards, written where cards are.
    assert!(written.contains(RENDERING), "{written}");
    assert_eq!(page_sizes(&read(&folder, PDF)), [(90, 50); CARDS]);
    assert_same_pictures(&folder.join(IMAGES), &folder.join(CARD_FILES), CARDS);
}

#[test]
fn a_skipped_folder_leaves_the_one_plan_to_the_outputs_after_it() {
    let folder = folder("skip");
    let Some(mut screen) = at_the_failed_save(&folder, &EVERY_OUTPUT, &[IMAGES], "The images")
    else {
        return;
    };
    screen.press(SKIP);
    let written = end_and_open(&folder, screen, &[IMAGES]);
    assert!(written.contains("The images were not saved."), "{written}");
    assert!(!written.contains("PNG pages to:"), "{written}");
    assert_eq!(written.matches(WHAT_NOW).count(), 1, "{written}");
    gone_or_left_empty(&folder, IMAGES, &written);
    let cards = folder.join(CARD_FILES);
    assert_eq!(names(&cards), numbered("", CARDS, ".png"));
    assert_eq!(page_sizes(&read(&folder, PDF)), [(90, 50); CARDS]);
}

#[test]
fn a_folder_made_before_the_phrase_offers_no_other_name() {
    let folder = folder("no-other-name");
    let saves = [
        "--format",
        "colors",
        "--template",
        "business-it",
        "--page-size",
        "business",
        "--pdf",
        PDF,
        "--cards-dir",
        CARD_FILES,
    ];
    let Some(mut screen) = at_the_failed_save(&folder, &saves, &[CARD_FILES], "The card files")
    else {
        return;
    };
    set_open(&folder.join(CARD_FILES), true);
    screen.press(TRY_AGAIN);
    let written = end_and_open(&folder, screen, &[]);
    assert!(!written.contains("Another folder name"), "{written}");
    assert!(written.contains("Skip"), "{written}");
    let cards = folder.join(CARD_FILES);
    assert_eq!(names(&cards), numbered("", CARDS, ".pdf"));
    assert_same_cards(&folder.join(PDF), &cards, CARDS);
}

/// `name`, a new folder of a test that holds the folder of [`QR_IMAGE`], and encode on a terminal
/// there, at the question of the seed phrase.
fn at_the_phrase_of_a_qr_image(name: &str) -> (std::path::PathBuf, Session) {
    let folder = folder(name);
    fs::create_dir(folder.join(FOR_PDF)).expect("a folder");
    let mut args = vec![
        "encode",
        "--ask-secrets",
        "--mode",
        "direct",
        "--backup-check",
        "no",
    ];
    args.extend_from_slice(&QR_IMAGE);
    let screen = at_the_phrase(&folder, &args);
    (folder, screen)
}

/// The program on a terminal with `args` in `folder`, at the question of the seed phrase.
fn at_the_phrase(folder: &Path, args: &[&str]) -> Session {
    let mut screen = screen(folder, args);
    screen.wait_for(PHRASE_ASKED);
    screen
}

/// All the program wrote once the public phrase was typed at `screen` and every output saved.
fn given_the_phrase(mut screen: Session) -> String {
    screen.press(&format!("{PUBLIC_MNEMONIC}\r"));
    let (status, written) = finish(screen);
    assert_eq!(status, 0, "{written}");
    written
}

#[test]
fn a_qr_image_is_called_verified_once_it_is_saved() {
    let (folder, screen) = at_the_phrase_of_a_qr_image("qr-saved");
    let written = given_the_phrase(screen);
    // Verified beside the line that names it saved, on the private screen and after it.
    let saved = format!(
        "{QR_VERIFIED} ✓ Saved QR code (unicode): {}",
        full(&folder, "for-pdf/public.png")
    );
    assert!(written.contains(&saved), "{written}");
    assert_eq!(names(&folder.join(FOR_PDF)), ["public.png"]);
    assert!(!read(&folder, "for-pdf/public.png").is_empty());
}

#[test]
fn a_qr_image_whose_reserved_file_was_removed_is_never_called_verified() {
    let (folder, mut screen) = at_the_phrase_of_a_qr_image("qr-removed");
    // Another program removes the file made for the image before the phrase.
    fs::remove_file(folder.join("for-pdf/public.png")).expect("the file made");
    screen.press(&format!("{PUBLIC_MNEMONIC}\r"));
    screen.wait_for("The QR code could not be saved as");
    screen.wait_for(WHAT_NOW);
    screen.press(SKIP);
    let (status, written) = finish(screen);
    assert_eq!(status, 0, "{written}");
    assert!(
        written.contains("was removed or replaced meanwhile"),
        "{written}"
    );
    assert!(written.contains("The QR code was not saved."), "{written}");
    assert!(!written.contains(QR_VERIFIED), "{written}");
    assert_eq!(names(&folder.join(FOR_PDF)), Vec::<String>::new());
}

#[test]
fn a_record_and_a_standalone_qr_image_render_no_cards() {
    let folder = folder("record-screen");
    let args = [
        "encode",
        "--ask-secrets",
        "--mode",
        "direct",
        "--format",
        "unicode",
        "--output",
        "public.txt",
        "--qr",
        "public.png",
        "--backup-check",
        "no",
    ];
    let written = given_the_phrase(at_the_phrase(&folder, &args));
    assert!(!written.contains(RENDERING), "{written}");
    assert_eq!(outputs(&folder), ["public.png", "public.txt"]);
}

/// `args` of encode, whose cards of the tile design only a save can fail, as a full disk fails it:
/// the program runs with no room for a file of more than a few hundred bytes, which the options
/// cannot foresee and which ends a write with an error, its signal being ignored. It ends refused,
/// after it has shown its result, with the words of the file system, which it gives.
#[track_caller]
fn assert_save_fails(folder: &Path, saves: &[&str]) -> String {
    const LITTLE_ROOM: &str = r#"trap '' XFSZ; ulimit -f 1; exec "$0" "$@""#;
    let encode = [
        "encode",
        "--mnemonic-file",
        PHRASE,
        "--mode",
        "direct",
        "--format",
        "colors",
        "--template",
        "material-tile",
    ];
    // The shell passes its environment on to the program.
    let output = common::colour::plain(&mut Command::new("sh"))
        .args(["-c", LITTLE_ROOM, env!("CARGO_BIN_EXE_mnemocode")])
        .args(encode)
        .args(saves)
        .current_dir(folder)
        .stdin(Stdio::null())
        .output()
        .expect("the program runs");
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert_ne!(output.status.code(), Some(0), "{errors}");
    assert!(errors.contains("File too large"), "{errors}");
    // The result is on the screen already: this was the save, not a refusal of the options.
    assert!(!output.stdout.is_empty());
    errors
}

#[test]
fn a_save_that_fails_ends_the_command_before_the_outputs_after_it() {
    let folder = folder("failed-save");
    let saves = [
        "--output",
        "public.txt",
        "--pdf",
        "public.pdf",
        "--images-dir",
        "images",
    ];
    let errors = assert_save_fails(&folder, &saves);
    // The record before it is saved; the PDF, emptied, and the folder of the images after it, made
    // before the phrase, are removed or named; no staging folder stays.
    assert!(!read(&folder, "public.txt").is_empty());
    gone_or_left_empty(&folder, "public.pdf", &errors);
    gone_or_left_empty(&folder, "images", &errors);
    for name in outputs(&folder) {
        assert!(
            ["images", "public.pdf", "public.txt"].contains(&name.as_str()),
            "{name}"
        );
    }
}

#[test]
fn a_folder_that_cannot_be_filled_leaves_no_staging_and_no_files() {
    let folder = folder("failed-folder");
    let errors = assert_save_fails(&folder, &["--images-dir", "images"]);
    gone_or_left_empty(&folder, "images", &errors);
    for name in outputs(&folder) {
        assert_eq!(name, "images");
    }
}
