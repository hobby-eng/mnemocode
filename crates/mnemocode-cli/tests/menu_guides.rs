//! Task help links at a real terminal, with the same public menu routes as a person uses.

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
const MAIN_QUESTION: &str = "What do you want to do?";

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
