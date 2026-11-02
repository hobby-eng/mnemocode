//! The command line against MnemoCode TS 0.1.0 (RUST-14, CORE-33): every command that the TS
//! repository's `scripts/rust-parity/transcripts.mjs` ran on public inputs, run again, standard
//! output, standard error and the exit status the same byte for byte.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test writes its public inputs to a folder of its own and runs the program there"
)]

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/transcripts-v1.json");

/// What TS's help says that differs here, each by a decision of PLAN.md's "Parity with TS 0.1.0":
/// images need no other program, a missing folder is made, each text input has its own limit, and
/// re-encode asks the new backup first.
const WRITTEN_IN: [(&str, &str); 15] = [
    (
        "Needs the Poppler program pdftocairo; PDF files do not. Pages are\n          drawn at 300 dpi. If pdftocairo is missing, MnemoCode says so before\n          it asks for a secret.",
        "Pages are drawn at 300 dpi.",
    ),
    (
        "The file is written into a folder that already exists.",
        "A folder of its path that is missing is made.",
    ),
    (
        "With --ask-secrets the codes are asked first, then at once their dates, then the\nphrase is shown to confirm; only then, unless options give it, the new backup is\nasked, with the questions of Encode in the menu. A backup of the original\nSeedshift with a valid last word keeps nothing of the original last word: give\nit, as you remember it.",
        "With --ask-secrets the new backup is asked first, with the questions of Encode\nin the menu, unless options give it; then the codes, then at once their dates,\nthen the phrase is shown to confirm. A backup of the original Seedshift with a\nvalid last word keeps nothing of the original last word: give it, as you\nremember it.",
    ),
    (
        "(else --ask-secrets asks for it once the phrase is confirmed):",
        "(else --ask-secrets asks for it first):",
    ),
    (
        "Text input may be up to 1 MiB.",
        "The file may be up to 256 bytes.",
    ),
    (
        "Read dates from a local UTF-8 file; - reads standard input.\n",
        "Read dates from a local UTF-8 file; - reads standard input.\n\n          The file may be up to 128 bytes.\n",
    ),
    (
        "Read dates with ? for forgotten digits from a file or -.\n",
        "Read dates with ? for forgotten digits from a file or -.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "Read the old backup's dates from a file or -.\n",
        "Read the old backup's dates from a file or -.\n\n          The file may be up to 128 bytes.\n",
    ),
    (
        "Read the encoded record from a file; - reads standard input.\n",
        "Read the encoded record from a file; - reads standard input.\n\n          The file may be up to 64 KiB.\n",
    ),
    (
        "A private key in WIF form, read from a protected local file.\n",
        "A private key in WIF form, read from a protected local file.\n\n          The file may be up to 64 bytes.\n",
    ),
    (
        "The BIP39 passphrase of the wallet, if it has one; the file is secret.\n",
        "The BIP39 passphrase of the wallet, if it has one; the file is secret.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "A file of shares, one per line or with ; between them; may be\n          repeated.\n",
        "A file of shares, one per line or with ; between them; may be\n          repeated.\n\n          Each file may be up to 64 KiB.\n",
    ),
    (
        "Encrypt the list with a passphrase of 12 characters or more, read from\n          a file.\n",
        "Encrypt the list with a passphrase of 12 characters or more, read from\n          a file.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "The same key, read from a text file.\n",
        "The same key, read from a text file.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "Read the original final word for seedshift-legacy-valid from a file or\n          -.\n",
        "Read the original final word for seedshift-legacy-valid from a file or\n          -.\n\n          The file may be up to 256 bytes.\n",
    ),
];

/// What TS wrote for `args`, with this program's version in place of TS's own and the differences
/// written in; recover-word's phrase may be a pattern, which has a limit of its own.
fn expected(args: &[&str], text: &str) -> String {
    let version = env!("CARGO_PKG_VERSION");
    let mut text = text
        .replace("MnemoCode 0.1.0", &format!("MnemoCode {version}"))
        .replace("mnemocode 0.1.0", &format!("mnemocode {version}"));
    if args.contains(&"recover-word") {
        text = text.replace(
            "Text input may be up to 1 MiB.",
            "The file may be up to 32 KiB.",
        );
    }
    for (recorded, written) in WRITTEN_IN {
        text = text.replace(recorded, written);
    }
    text
}

#[test]
fn every_command_writes_what_ts_writes() {
    let recorded: Value = serde_json::from_str(RECORDED).expect("the recorded file is JSON");
    let folder = Path::new(env!("CARGO_TARGET_TMPDIR")).join("transcripts");
    // The commands that save need their names free, as they were for TS, on every run.
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    for (name, text) in recorded["files"].as_object().expect("the files") {
        let text = text.as_str().expect("a text");
        fs::write(folder.join(name), text).expect("a file");
    }
    for entry in recorded["commands"].as_array().expect("the commands") {
        let args: Vec<&str> = entry["args"]
            .as_array()
            .expect("the arguments")
            .iter()
            .map(|argument| argument.as_str().expect("an argument"))
            .collect();
        let output = Command::new(env!("CARGO_BIN_EXE_mnemocode"))
            .args(&args)
            .current_dir(&folder)
            .stdin(Stdio::null())
            .output()
            .expect("the program runs");
        let name = args.join(" ");
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            expected(&args, entry["stdout"].as_str().expect("standard output")),
            "{name}"
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stderr),
            entry["stderr"].as_str().expect("standard error"),
            "{name}"
        );
        assert_eq!(
            output.status.code().map(i64::from),
            entry["status"].as_i64(),
            "{name}"
        );
    }
}
