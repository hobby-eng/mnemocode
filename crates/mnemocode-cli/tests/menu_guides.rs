//! The menu at a real terminal, by the routes a person takes: each task's help link, and what
//! stays answered when a person goes back.

#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the shared pseudo-terminal harness starts the CLI and times its answers"
)]

#[path = "common/terminal.rs"]
mod terminal;

use terminal::Session;

const PROGRAM: &str = env!("CARGO_BIN_EXE_mnemocode");
const README: &str = "https://github.com/hobby-eng/mnemocode#";
const MAIN_QUESTION: &str = "Choose an action";

#[test]
fn each_task_links_its_own_guide_and_back_restores_the_menu() {
    for (digit, anchor, question) in [
        ("1", "1-encode", "Which form should the seed phrase take?"),
        ("2", "2-re-encode", "Where is the encoded seed phrase?"),
        ("3", "3-decode", "Where is the encoded seed phrase?"),
        (
            "4",
            "4-split-into-shares",
            "Use Seedshift before splitting?",
        ),
        ("5", "5-restore-from-shares", "Was Seedshift used"),
        ("6", "6-recovery", "What is forgotten?"),
        ("7", "7-preview-cards", "Which card design"),
        ("8", "8-word-lookup", "What do you want to look up?"),
    ] {
        let mut session = Session::start(PROGRAM, &[]);
        session.wait_for(MAIN_QUESTION);
        session.press(digit);
        session.wait_for(question);
        let linked = session.written().contains(&format!("{README}{anchor}"));
        if !linked {
            session.press("\x03");
            let (_, written) = session.end();
            assert!(linked, "menu entry {digit} has no task guide: {written}");
            continue;
        }
        session.press("\x1b");
        session.wait_for(&format!("{README}menu"));
        session.wait_for(MAIN_QUESTION);
        session.press("q");
        let (status, written) = session.end();
        assert_eq!(status, 0, "menu entry {digit}: {written}");
    }
}

#[test]
fn recovery_choices_link_the_specific_kind_of_missing_material() {
    for (digit, anchor) in [
        ("1", "forgotten-word-recovery"),
        ("2", "codes-that-cannot-be-read"),
        ("3", "date-recovery-helper"),
        ("4", "damaged-shares"),
    ] {
        let mut session = Session::start(PROGRAM, &[]);
        session.wait_for(MAIN_QUESTION);
        session.press("6");
        session.wait_for("What is forgotten?");
        session.press(digit);
        session.wait_for(&format!("{README}{anchor}"));
        session.press("\x03");
        let (status, written) = session.end();
        assert_eq!(status, 130, "recovery entry {digit}: {written}");
    }
}

// AUD-009-UI001: back from the seed phrase to where the result is saved, the places ticked there
// are still ticked, not the defaults.
#[test]
fn the_places_ticked_for_saving_stay_ticked_when_coming_back() {
    let mut session = terminal::at_where_a_color_backup_is_saved(PROGRAM);
    // The record file ticked, the printable cards, ticked by default, left out.
    session.press("1");
    session.press("2");
    session.press("\r");
    session.wait_for("Enter the folder for the files");
    session.press("\r");
    session.wait_for("Add a QR code?");
    session.press("1");
    session.wait_for("Enter the seed phrase");
    session.press("\x1b[Z");
    session.wait_for("Where should the result be saved?");
    session.wait_for("[x] A record file");
    session.wait_for("[ ] Printable cards");
    session.press("\x1b");
    session.wait_for(MAIN_QUESTION);
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
}

// AUD-008-FUN004: the word count said for printed cards does not cut the codes typed after them.
// Cards of a public 24-word phrase read as 12 words fail the checksum; its 24 codes typed instead
// are read whole.
#[test]
fn codes_typed_after_cards_are_read_whole() {
    let folder = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("menu-cards-retry");
    let _absent = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).expect("a folder");
    let phrase = format!("{} art\n", ["abandon"; 23].join(" "));
    std::fs::write(folder.join("phrase.txt"), phrase).expect("a phrase");
    let made = std::process::Command::new(PROGRAM)
        .current_dir(&folder)
        .args([
            "encode",
            "--mnemonic-file",
            "phrase.txt",
            "--mode",
            "direct",
        ])
        .args(["--format", "unicode", "--pdf", "cards.pdf"])
        .output()
        .expect("the cards");
    assert!(made.status.success(), "{made:?}");
    let mut session = Session::start(PROGRAM, &[]);
    // A window of today's usual size, where a result shows at once, not by pages.
    session.resize(60, 100);
    session.wait_for(MAIN_QUESTION);
    session.press("3");
    session.wait_for("Where is the encoded seed phrase?");
    session.press("6");
    session.wait_for("Enter the folder of the cards");
    session.press(&format!("{}\r", folder.join("cards.pdf").display()));
    session.wait_for("How many words does the seed phrase have?");
    session.press("1");
    session.wait_for("Was Seedshift used when it was encoded?");
    session.press("1");
    session.wait_for("BIP39 checksum invalid");
    session.wait_for("What now?");
    session.press("1");
    session.wait_for("Enter the encoded seed phrase");
    session.wait_for_answer_keys();
    session.press(&format!("{}6027\r", "7684".repeat(23)));
    session.wait_for("24. art");
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    session.wait_for(MAIN_QUESTION);
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
}
