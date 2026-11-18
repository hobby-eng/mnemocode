//! Two bounded navigation regressions against an explicitly supplied native binary.
#![cfg(test)]
#![cfg(unix)]

#[path = "../../../../crates/mnemocode-cli/tests/common/terminal.rs"]
mod terminal;

use std::path::Path;
use terminal::{Session, Setting};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn program() -> String {
    std::env::var("AUD010_CLI").expect("AUD010_CLI names the current native binary")
}

fn start(args: &[&str], folder: &Path) -> Session {
    Session::start_with(
        &Setting {
            rows: 60,
            columns: 100,
            term: "xterm-256color",
            folder,
        },
        &program(),
        args,
    )
}

fn without_sgr(text: &str) -> String {
    regex::Regex::new(r"\x1b\[[0-9;]*m")
        .unwrap()
        .replace_all(text, "")
        .into_owned()
}

#[test]
fn configured_child_remembers_original_seedshift_on_enter() {
    let mut session = start(
        &[
            "encode",
            "--configure",
            "--ask-secrets",
            "--format",
            "unicode",
        ],
        Path::new(env!("CARGO_TARGET_TMPDIR")),
    );
    session.wait_for("Use Seedshift?");
    session.press("2");
    session.wait_for("Enter the dates");
    session.press("\x1b[Z");
    session.wait_for("Use Seedshift?");
    let before = session.written().len();
    session.press("\r");
    session.wait_for("Enter the dates");
    let text = without_sgr(&session.written()[before..]);
    assert!(
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .contains("Seedshift Original Seedshift"),
        "{text}"
    );
    session.press("\x03");
    let (status, _) = session.end();
    assert_eq!(status, 130);
}

#[test]
fn one_wrong_kind_file_in_a_folder_requires_confirmation() {
    let folder = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("aud010-one-qr-{}", std::process::id()));
    std::fs::create_dir(&folder).unwrap();
    let phrase = mnemocode::bip39::phrase::Phrase::parse(PHRASE).unwrap();
    let backup = mnemocode::backup::Backup::encode(
        &phrase,
        &[],
        mnemocode::forms::Form::Unicode,
        mnemocode::modes::Mode::Direct,
    )
    .unwrap();
    let codes = backup.backup.text().unwrap();
    let png = mnemocode::qr::png(codes.as_str()).unwrap();
    std::fs::write(folder.join("public.png"), &*png).unwrap();
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1);
    let args = [
        "decode",
        "--ask-secrets",
        "--input-file",
        folder.to_str().unwrap(),
        "--find",
        "cards",
        "--mode",
        "direct",
        "--format",
        "unicode",
        "--input-kind",
        "codes",
    ];
    for accept in [false, true] {
        let mut session = start(&args, &folder);
        session.wait_for("Which of them should be read?");
        session.wait_for("No printed card was found.");
        assert!(!session.written().contains("abandon"));
        if accept {
            session.press("1");
            session.wait_for("Press Enter to clear this screen.");
            let text = without_sgr(&session.written());
            assert!(
                text.split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .contains(PHRASE),
                "{text}"
            );
            session.press("\r");
        } else {
            session.press("\x1b");
        }
        let (status, text) = session.end();
        assert_eq!(status, if accept { 0 } else { 130 }, "{text}");
        if !accept {
            assert!(!text.contains("abandon"));
        }
    }
}
