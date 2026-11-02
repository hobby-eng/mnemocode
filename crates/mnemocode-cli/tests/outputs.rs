//! Where the commands save and what they read, against MnemoCode TS 0.1.0 run side by side: the
//! outputs apart from each other and from the inputs by where they really lie, a taken name
//! numbered before that is checked, the limit of each text input, and a standard output that nobody
//! reads. The program runs on public inputs, in a folder of each test's own.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test writes the public inputs of a command to the folder that it runs in"
)]

mod common;

use std::fs;
use std::process::{Command, Stdio};

use common::{DATES, PHRASE, assert_refused, folder, outputs, run, saved};
#[cfg(unix)]
use common::{names, read};

/// A backup that saves its record, with `more` options.
fn encode<'a>(more: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec![
        "encode",
        "--mnemonic-file",
        PHRASE,
        "--mode",
        "direct",
        "--format",
        "3",
    ];
    args.extend_from_slice(more);
    args
}

#[test]
fn a_number_given_to_a_taken_name_is_checked_against_the_other_outputs() {
    let folder = folder("numbered-into-output");
    fs::write(folder.join("a.txt"), "taken").expect("a file");
    assert_refused(
        &folder,
        &encode(&["--output", "a.txt", "--qr", "a-1.txt"]),
        "The output record file and QR output file must use separate, non-overlapping paths.",
    );
    fs::create_dir(folder.join("c")).expect("a folder");
    assert_refused(
        &folder,
        &[
            "preview",
            "--template",
            "1",
            "--cards-dir",
            "c",
            "--images-dir",
            "c-1",
        ],
        "must use separate, non-overlapping paths.",
    );
}

#[test]
fn an_output_named_like_its_own_input_is_refused_and_not_numbered() {
    let folder = folder("own-input");
    assert_refused(
        &folder,
        &encode(&["--output", PHRASE]),
        "The output record file must not overlap the mnemonic file.",
    );
}

#[cfg(unix)]
#[test]
fn outputs_and_inputs_overlap_by_where_they_lie_through_a_link() {
    use std::os::unix::fs::symlink;
    let folder = folder("through-a-link");
    fs::create_dir_all(folder.join("real/sub")).expect("a folder");
    symlink("real", folder.join("link")).expect("a link");
    assert_refused(
        &folder,
        &encode(&["--output", "real/sub/a.txt", "--qr", "link/sub/a.txt"]),
        "The output record file and QR output file must use separate, non-overlapping paths.",
    );
    symlink(PHRASE, folder.join("phrase-link.txt")).expect("a link");
    assert_refused(
        &folder,
        &[
            "encode",
            "--mnemonic-file",
            "phrase-link.txt",
            "--mode",
            "direct",
            "--format",
            "3",
            "--output",
            PHRASE,
        ],
        "The output record file must not overlap the mnemonic file.",
    );
}

#[cfg(unix)]
#[test]
fn a_link_to_a_folder_is_a_folder_for_an_output() {
    use std::os::unix::fs::symlink;
    let folder = folder("link-to-folder");
    fs::create_dir(folder.join("real")).expect("a folder");
    symlink("real", folder.join("link")).expect("a link");
    saved(&folder, &encode(&["--output", "link/record.txt"]));
    saved(
        &folder,
        &["preview", "--template", "1", "--cards-dir", "link/new"],
    );
    assert_eq!(names(&folder.join("real")), ["new", "record.txt"]);
}

#[test]
fn a_missing_input_is_named_before_a_save_can_start() {
    let folder = folder("missing-input");
    assert_refused(
        &folder,
        &[
            "encode",
            "--mnemonic-file",
            "no-such-phrase.txt",
            "--mode",
            "direct",
            "--format",
            "3",
            "--output",
            "record.txt",
        ],
        "The mnemonic file could not be read. Check that the file exists and is readable.",
    );
}

#[test]
fn a_folder_takes_a_name_that_only_looks_like_a_document() {
    let folder = folder("folder-names");
    saved(
        &folder,
        &["preview", "--template", "8", "--images-dir", ".pdf"],
    );
    assert!(folder.join(".pdf").is_dir());
    fs::write(folder.join("taken.pdf"), "taken").expect("a file");
    let said = saved(
        &folder,
        &["preview", "--template", "1", "--cards-dir", "taken.pdf"],
    );
    assert!(folder.join("taken.pdf-1").is_dir(), "{said}");
    assert_refused(
        &folder,
        &["preview", "--template", "1", "--cards-dir", "cards.pdf"],
        "A new folder needs a name without .pdf",
    );
}

#[cfg(unix)]
#[test]
fn a_file_option_reads_the_file_it_names() {
    let folder = folder("named-file");
    let phrase = read(&folder, PHRASE);
    fs::write(folder.join("a\\b.txt"), phrase).expect("a file");
    let other = "legal winner thank year wave sausage worth useful legal winner thank yellow\n";
    fs::write(folder.join("ab.txt"), other).expect("a file");
    let output = run(
        &folder,
        &[
            "encode",
            "--mnemonic-file",
            "a\\b.txt",
            "--mode",
            "direct",
            "--format",
            "3",
        ],
    );
    let errors = String::from_utf8_lossy(&output.stderr);
    assert!(errors.contains("73c5da0a"), "{errors}");
}

#[test]
fn the_image_beside_a_sheet_is_named_as_a_path_is_written() {
    let folder = folder("qr-name");
    let said = saved(&folder, &encode(&["--pdf", "./c.pdf", "--card-qr"]));
    assert!(
        said.contains("Saved the QR code of the sheet as an image: c-qr.png"),
        "{said}"
    );
    assert_eq!(outputs(&folder), ["c-qr.png", "c.pdf"]);
}

#[test]
fn a_standard_output_that_nobody_reads_ends_a_command_as_done() {
    let folder = folder("closed-output");
    for args in [
        vec!["--version"],
        vec!["preview", "--list"],
        vec!["table", "--index", "1"],
    ] {
        let (reader, writer) = std::io::pipe().expect("a pipe");
        drop(reader);
        let output = Command::new(env!("CARGO_BIN_EXE_mnemocode"))
            .args(&args)
            .current_dir(&folder)
            .stdin(Stdio::null())
            .stdout(writer)
            .stderr(Stdio::piped())
            .output()
            .expect("the program runs");
        assert_eq!(output.status.code(), Some(0), "{args:?}");
        assert!(output.stderr.is_empty(), "{args:?}");
    }
}

#[test]
fn a_pattern_longer_than_a_phrase_is_searched() {
    let folder = folder("long-pattern");
    let places = ["abandon|ability|absorb|abstract"; 6].join(" ");
    let rest = "abandon ".repeat(17);
    fs::write(folder.join("pattern.txt"), format!("{places} {rest}art\n")).expect("a file");
    let output = run(
        &folder,
        &[
            "recover-word",
            "--mnemonic-file",
            "pattern.txt",
            "--master-fingerprint",
            "5436d724",
        ],
    );
    let errors = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(0), "{errors}");
    assert!(errors.contains("Matched 1 of 14"), "{errors}");
}

/// Expects `option` with a file of `limit` bytes past its limit, and no further, to be refused.
#[track_caller]
fn assert_limit(args: &[&str], option: &str, limit: usize, refusal: &str) {
    let folder = folder(&format!("limit{option}"));
    fs::write(folder.join("big.txt"), "a".repeat(limit + 1)).expect("a file");
    let mut given = args.to_vec();
    given.extend([option, "big.txt"]);
    assert_refused(&folder, &given, refusal);
    fs::write(folder.join("big.txt"), "a".repeat(limit)).expect("a file");
    let output = run(&folder, &given);
    let errors = String::from_utf8_lossy(&output.stderr);
    assert!(!errors.contains("safety limit"), "{option}: {errors}");
}

#[test]
fn each_text_file_is_refused_one_byte_past_its_limit_and_not_at_it() {
    assert_limit(
        &["encode", "--mode", "direct", "--format", "3"],
        "--mnemonic-file",
        256,
        "The mnemonic file exceeds the 256 bytes safety limit.",
    );
    assert_limit(
        &["recover-word"],
        "--mnemonic-file",
        32 * 1024,
        "The mnemonic file exceeds the 32 KiB safety limit.",
    );
    assert_limit(
        &["decode", "--mode", "seedshift", "--input-file", DATES],
        "--dates-file",
        128,
        "The dates file exceeds the 128 bytes safety limit.",
    );
    assert_limit(
        &["recover-word", "--mnemonic-file", PHRASE],
        "--wif-file",
        64,
        "The WIF file exceeds the 64 bytes safety limit.",
    );
    assert_limit(
        &[
            "recover-word",
            "--mnemonic-file",
            PHRASE,
            "--master-fingerprint",
            "73c5da0a",
        ],
        "--bip39-passphrase-file",
        4096,
        "The BIP39 passphrase file exceeds the 4 KiB safety limit.",
    );
    assert_limit(
        &["sskr-combine"],
        "--share-file",
        64 * 1024,
        "exceeds the 64 KiB safety limit.",
    );
}

#[test]
fn of_several_wrong_card_options_the_one_ts_names_first_is_named() {
    let folder = folder("card-order");
    let cards = |more: &[&'static str]| {
        let mut args = vec![
            "encode",
            "--mnemonic-file",
            PHRASE,
            "--mode",
            "direct",
            "--format",
            "5",
        ];
        args.extend_from_slice(more);
        args
    };
    let name_refusal = "Card name must use Latin letters only";
    let unknown = "The card template is unknown or incompatible.";
    for (args, refusal) in [
        (
            cards(&["--cards-dir", "c", "--page-size", "a7", "--template", "99"]),
            unknown,
        ),
        (
            cards(&["--cards-dir", "c", "--orientation", "x", "--template", "99"]),
            unknown,
        ),
        (
            cards(&["--pdf", "o.pdf", "--card-name", "Иван", "--template", "99"]),
            name_refusal,
        ),
        (
            cards(&[
                "--pdf",
                "o.pdf",
                "--card-name",
                "Иван",
                "--orientation",
                "x",
            ]),
            name_refusal,
        ),
    ] {
        assert_refused(&folder, &args, refusal);
    }
}
