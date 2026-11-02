//! The saves of cards that fail, as MnemoCode TS 0.1.0's tests pin them (aud-021-export,
//! aud-026-export): off the private screen the failure ends the command before the outputs after
//! it; on it, each output is tried again, renamed or skipped while the cards of the one plan stay
//! as they were; and a folder that took a destination's name meanwhile is left as it is. The faults
//! are real ones of the file system, from outside the program, which runs on public inputs.

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
use std::thread;
use std::time::{Duration, Instant};

use common::{
    PHRASE, assert_same_cards, assert_same_pictures, folder, names, numbered, outputs, page_sizes,
    read, run,
};
use mnemocode::self_check::vectors::PUBLIC_MNEMONIC;
use terminal::{Session, Setting};

/// How long the program has to come to a question: it draws cards, in a debug build, on a busy
/// machine.
const PATIENCE: Duration = Duration::from_secs(180);
/// Where the private screen asks for the phrase.
const PHRASE_ASKED: &str = "(Esc cancels)";
/// What the private screen asks after a save that failed; "1", "2" and "3" choose an answer.
const WHAT_NOW: &str = "What now?";
const TRY_AGAIN: &str = "1";
const ANOTHER_NAME: &str = "2";
const SKIP: &str = "3";
/// What ends the private screen once every output was saved or skipped.
const CLEAR_THE_SCREEN: &str = "Press Enter to clear this screen.";
/// The folders of the outputs of a test on a terminal, each closed and opened on its own.
const FOR_PDF: &str = "for-pdf";
const FOR_IMAGES: &str = "for-images";
const FOR_CARDS: &str = "for-cards";
/// The PDF of a test on a terminal.
const PDF: &str = "for-pdf/public.pdf";
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
    "for-images/images",
    "--cards-dir",
    "for-cards/cards",
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
    let mut screen = screen(folder, &args);
    screen.wait_for(PHRASE_ASKED);
    for place in closed {
        set_open(&folder.join(place), false);
    }
    screen.press(&format!("{PUBLIC_MNEMONIC}\r"));
    screen
}

/// That `encode`, with `FOR_PDF` closed, at the question after the failed save of `what`: none for
/// root, whose save no closed folder fails.
fn at_the_failed_save(folder: &Path, saves: &[&str], what: &str) -> Option<Session> {
    if !a_closed_folder_stops_a_write(folder) {
        return None;
    }
    let mut screen = encode_with_closed_folders(folder, saves, &[FOR_PDF]);
    screen.wait_for(&format!("{what} could not be saved as"));
    screen.wait_for(WHAT_NOW);
    Some(screen)
}

/// What the program wrote, once it ended well with nothing saved in `FOR_PDF`, opened again.
fn end_with_the_closed_folder_empty(folder: &Path, screen: Session) -> String {
    let (status, written) = finish(screen);
    let closed = folder.join(FOR_PDF);
    set_open(&closed, true);
    assert_eq!(status, 0, "{written}");
    assert_eq!(names(&closed), Vec::<String>::new());
    written
}

#[test]
fn each_output_tries_its_failed_save_again_and_every_file_shows_the_one_plan() {
    let folder = folder("retries");
    if !a_closed_folder_stops_a_write(&folder) {
        return;
    }
    let closed = [FOR_PDF, FOR_IMAGES, FOR_CARDS];
    let mut screen = encode_with_closed_folders(&folder, &EVERY_OUTPUT, &closed);
    for (what, place) in [
        ("The PDF", FOR_PDF),
        ("The images", FOR_IMAGES),
        ("The card files", FOR_CARDS),
    ] {
        screen.wait_for(&format!("{what} could not be saved as"));
        screen.wait_for(WHAT_NOW);
        set_open(&folder.join(place), true);
        screen.press(TRY_AGAIN);
    }
    let (status, written) = finish(screen);
    assert_eq!(status, 0, "{written}");
    assert_eq!(written.matches(WHAT_NOW).count(), 3, "{written}");
    for notice in [
        format!("The PDF could not be saved as {PDF}: {NO_PERMISSION}"),
        format!("The images could not be saved as for-images/images: {NO_PERMISSION}"),
        format!("The card files could not be saved as for-cards/cards: {NO_PERMISSION}"),
        format!("Saved PDF: {PDF}"),
        format!("Saved {CARDS} PNG pages to: for-images/images"),
        format!("Saved {CARDS} individual card files to: for-cards/cards"),
    ] {
        assert!(written.contains(&notice), "{notice}: {written}");
    }
    // What says below that a record alone renders no cards, written where cards are.
    assert!(written.contains(RENDERING), "{written}");
    assert_eq!(page_sizes(&read(&folder, PDF)), [(90, 50); CARDS]);
    assert_same_pictures(
        &folder.join("for-images/images"),
        &folder.join("for-cards/cards"),
        CARDS,
    );
}

#[test]
fn a_skipped_pdf_leaves_the_one_plan_to_the_outputs_after_it() {
    let folder = folder("skip");
    let Some(mut screen) = at_the_failed_save(&folder, &EVERY_OUTPUT, "The PDF") else {
        return;
    };
    screen.press(SKIP);
    let written = end_with_the_closed_folder_empty(&folder, screen);
    assert!(written.contains("The PDF was not saved."), "{written}");
    assert!(!written.contains("Saved PDF:"), "{written}");
    assert_eq!(written.matches(WHAT_NOW).count(), 1, "{written}");
    assert_same_pictures(
        &folder.join("for-images/images"),
        &folder.join("for-cards/cards"),
        CARDS,
    );
}

#[test]
fn a_pdf_saved_under_another_name_shows_the_cards_of_the_one_plan() {
    let folder = folder("renamed");
    let other = "for-cards/other.pdf";
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
        "for-cards/cards",
    ];
    let Some(mut screen) = at_the_failed_save(&folder, &saves, "The PDF") else {
        return;
    };
    screen.press(ANOTHER_NAME);
    screen.wait_for("New name for the PDF:");
    screen.press(&format!("{other}\r"));
    let written = end_with_the_closed_folder_empty(&folder, screen);
    assert!(
        written.contains(&format!("Saved PDF: {other}")),
        "{written}"
    );
    assert_eq!(written.matches("New name for the PDF:").count(), 1);
    assert_eq!(page_sizes(&read(&folder, other)), [(90, 50); CARDS]);
    let cards = folder.join("for-cards/cards");
    assert_eq!(names(&cards), numbered("", CARDS, ".pdf"));
    assert_same_cards(&folder.join(other), &cards, CARDS);
}

#[test]
fn a_qr_image_is_called_verified_only_once_it_is_saved() {
    let folder = folder("qr-saved");
    let Some(mut screen) = at_the_failed_save(&folder, &QR_IMAGE, "The QR code") else {
        return;
    };
    set_open(&folder.join(FOR_PDF), true);
    screen.press(TRY_AGAIN);
    let (status, written) = finish(screen);
    assert_eq!(status, 0, "{written}");
    let (before, after) = written.split_once(WHAT_NOW).expect("the question");
    assert!(!before.contains(QR_VERIFIED), "{written}");
    assert!(after.contains(QR_VERIFIED), "{written}");
    assert_eq!(names(&folder.join(FOR_PDF)), ["public.png"]);
}

#[test]
fn a_qr_image_that_is_skipped_is_never_called_verified() {
    let folder = folder("qr-skipped");
    let Some(mut screen) = at_the_failed_save(&folder, &QR_IMAGE, "The QR code") else {
        return;
    };
    screen.press(SKIP);
    let written = end_with_the_closed_folder_empty(&folder, screen);
    assert!(written.contains("The QR code was not saved."), "{written}");
    assert!(!written.contains(QR_VERIFIED), "{written}");
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
    let mut screen = screen(&folder, &args);
    screen.wait_for(PHRASE_ASKED);
    screen.press(&format!("{PUBLIC_MNEMONIC}\r"));
    let (status, written) = finish(screen);
    assert_eq!(status, 0, "{written}");
    assert!(!written.contains(RENDERING), "{written}");
    assert_eq!(outputs(&folder), ["public.png", "public.txt"]);
}

/// `args` of encode, whose cards of the tile design only a save can fail, as a full disk fails it:
/// the program runs with no room for a file of more than a few hundred bytes, which the options
/// cannot foresee and which ends a write with an error, its signal being ignored. It ends refused,
/// after it has shown its result, with the words of the file system.
#[track_caller]
fn assert_save_fails(folder: &Path, saves: &[&str]) {
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
    let output = Command::new("sh")
        .args(["-c", LITTLE_ROOM, env!("CARGO_BIN_EXE_mnemocode")])
        .args(encode)
        .args(saves)
        .current_dir(folder)
        .stdin(Stdio::null())
        .output()
        .expect("the program runs");
    let errors = String::from_utf8_lossy(&output.stderr);
    assert_ne!(output.status.code(), Some(0), "{errors}");
    assert!(errors.contains("File too large"), "{errors}");
    // The result is on the screen already: this was the save, not a refusal of the options.
    assert!(!output.stdout.is_empty());
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
    assert_save_fails(&folder, &saves);
    // The record before it is saved, and of the PDF no staging folder stays.
    assert_eq!(outputs(&folder), ["public.txt"]);
}

#[test]
fn a_folder_that_cannot_be_filled_leaves_neither_itself_nor_its_staging() {
    let folder = folder("failed-folder");
    assert_save_fails(&folder, &["--images-dir", "images"]);
    assert_eq!(outputs(&folder), Vec::<String>::new());
}

/// Makes the folder `images` in `folder` once the staging folder of the page images is there: the
/// name was free when it was claimed, and is taken when the images are published. With `keep`, a
/// file in it; the inode of the folder.
fn take_the_name_while_staged(folder: &Path, keep: bool) -> u64 {
    let deadline = Instant::now() + PATIENCE;
    while !names(folder)
        .iter()
        .any(|name| name.starts_with(".mnemocode-images-"))
    {
        assert!(Instant::now() < deadline, "no staging folder");
        thread::sleep(Duration::from_millis(1));
    }
    let target = folder.join("images");
    fs::create_dir(&target).expect("the folder");
    if keep {
        fs::write(target.join("keep"), "public fixture").expect("a file");
    }
    fs::metadata(&target).expect("the folder").ino()
}

#[test]
fn a_folder_made_while_the_images_were_staged_stays_as_it_is() {
    let args = [
        "encode",
        "--mnemonic-file",
        PHRASE,
        "--mode",
        "direct",
        "--format",
        "colors",
        "--template",
        "material-tile",
        "--images-dir",
        "images",
    ];
    for (name, keep) in [("staged-empty", false), ("staged-kept", true)] {
        let folder = folder(name);
        let (output, made) = thread::scope(|scope| {
            let made = scope.spawn(|| take_the_name_while_staged(&folder, keep));
            let output = run(&folder, &args);
            (output, made.join().expect("the folder made"))
        });
        let errors = String::from_utf8_lossy(&output.stderr);
        assert_ne!(output.status.code(), Some(0), "{errors}");
        assert!(
            errors.contains(
                "The image folder already exists. Choose a new folder for the exported images."
            ),
            "{errors}"
        );
        // Neither its contents nor the folder itself changed, and no staging folder stays.
        let target = folder.join("images");
        assert_eq!(fs::metadata(&target).expect("the folder").ino(), made);
        let kept = if keep { vec!["keep"] } else { Vec::new() };
        assert_eq!(names(&target), kept);
        assert_eq!(outputs(&folder), ["images"]);
    }
}
