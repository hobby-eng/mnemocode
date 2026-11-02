//! The command line at a terminal (the `pty` gate, docs/design/architect/GATES.md): a
//! pseudo-terminal drives the program as a person does, on the public test phrase only.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test runs the program, times it and writes public inputs to a folder of its own"
)]

#[path = "common/terminal.rs"]
mod terminal;

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use mnemocode::self_check::vectors::PUBLIC_UNICODE_CODES;
use terminal::{Session, Setting};

const PROGRAM: &str = env!("CARGO_BIN_EXE_mnemocode");
const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ENTER_PRIVATE_SCREEN: &str = "\x1b[?1049h";
const LEAVE_PRIVATE_SCREEN: &str = "\x1b[?1049l";
/// A file of the test's own folder, for `name`.
fn file(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(name)
}

/// `decode --ask-secrets` at its first question.
fn at_the_first_question() -> Session {
    let mut session = Session::start(PROGRAM, &["decode", "--ask-secrets"]);
    session.wait_for("(Esc cancels)");
    session
}

#[test]
fn a_secret_command_runs_on_the_private_screen_and_clears_it() {
    let mut session = Session::start(
        PROGRAM,
        &[
            "encode",
            "--ask-secrets",
            "--mode",
            "direct",
            "--format",
            "unicode",
        ],
    );
    session.wait_for(ENTER_PRIVATE_SCREEN);
    session.wait_for("(Esc cancels)");
    session.press(&format!("{PHRASE}\r"));
    session.wait_for("Check the backup now?");
    session.press("2");
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    let left = written
        .rfind(LEAVE_PRIVATE_SCREEN)
        .expect("left the screen");
    assert!(written[left..].contains("The screen with the result was cleared."));
    assert!(!written[left..].contains("abandon"));
}

#[test]
fn a_result_sent_to_a_file_stays_off_the_screen() {
    let out = file("result.txt");
    let _absent = fs::remove_file(&out);
    let line = format!(
        "exec '{PROGRAM}' encode --ask-secrets --mode direct --format unicode --backup-check no > '{}'",
        out.display()
    );
    let mut session = Session::start("/bin/sh", &["-c", &line]);
    session.wait_for("(Esc cancels)");
    session.press(&format!("{PHRASE}\r"));
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    assert!(!written.contains("7684"), "{written}");
    let saved = fs::read_to_string(&out).expect("the output");
    assert!(saved.contains("7684"), "{saved}");
}

#[test]
fn ctrl_c_cancels_and_leaves_the_private_screen() {
    let mut session = at_the_first_question();
    session.press("\x03");
    let (status, written) = session.end();
    assert_eq!(status, 130, "{written}");
    assert!(written.contains(LEAVE_PRIVATE_SCREEN), "{written}");
    assert!(written.contains("Cancelled."), "{written}");
}

#[test]
fn each_signal_ends_with_its_shell_status() {
    for (signal, expected) in [("INT", 130), ("QUIT", 130), ("TERM", 143), ("HUP", 129)] {
        let session = at_the_first_question();
        session.signal(signal);
        let (status, written) = session.end();
        assert_eq!(status, expected, "{signal}: {written}");
        assert!(
            written.contains(LEAVE_PRIVATE_SCREEN),
            "{signal}: {written}"
        );
    }
}

#[test]
fn a_stopped_command_goes_on_where_it_was() {
    let mut session = at_the_first_question();
    session.signal("TSTP");
    thread::sleep(Duration::from_millis(200));
    session.signal("CONT");
    session.press("\x03");
    let (status, written) = session.end();
    assert_eq!(status, 130, "{written}");
}

#[test]
fn keys_typed_ahead_answer_nothing() {
    let mut session = Session::start(PROGRAM, &["decode", "--ask-secrets"]);
    session.press("typed ahead\r");
    session.wait_for("(Esc cancels)");
    let screen = session.from;
    session.press("\x03");
    let (status, written) = session.end();
    assert_eq!(status, 130, "{written}");
    assert!(!written[screen..].contains("typed ahead"), "{written}");
}

#[test]
fn what_does_not_fit_is_shown_by_pages() {
    let shares = file("marked-shares.txt");
    let first = "1289 1955 1971 ? 1916 1373 1409 443 364 1511 219 537 945 1539 1030 1247 609 1655 1661 543 1665";
    let second = "1867 166 26 1886 920 572 1724 100 1966 612 795 29 1422 661 1840 1553 1660 1876 1908 1623 1409";
    fs::write(&shares, format!("{first};{second}")).expect("the shares");
    let mut session = Session::start(PROGRAM, &["sskr-export", "--ask-secrets"]);
    session.wait_for("(Esc cancels)");
    session.press(&format!("{}\r", shares.display()));
    session.wait_for("Page 1/2");
    session.press("\x1b[B");
    session.wait_for("Page 2/2");
    session.press("\r");
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
}

#[test]
fn a_wrong_answer_in_any_script_is_asked_again() {
    for wrong in ["файл", "файл.txt", "的的的 的", "file:файл"] {
        let mut session = at_the_first_question();
        session.press(&format!("{wrong}\r"));
        session.wait_for("(Esc cancels)");
        session.press("\x03");
        let (status, written) = session.end();
        assert_eq!(status, 130, "{wrong}: {written}");
    }
}

#[test]
fn sigterm_during_a_save_leaves_no_staging_folder() {
    let folder = file("terminated");
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    let phrase = file("terminated-phrase.txt");
    fs::write(&phrase, PHRASE).expect("the phrase");
    let phrase = phrase.to_string_lossy().into_owned();
    let pdf = folder.join("cards.pdf").to_string_lossy().into_owned();
    let images = folder.join("images").to_string_lossy().into_owned();
    let mut session = Session::start(
        PROGRAM,
        &[
            "encode",
            "--mnemonic-file",
            &phrase,
            "--mode",
            "direct",
            "--format",
            "colors",
            "--pdf",
            &pdf,
            "--images-dir",
            &images,
        ],
    );
    session.wait_for("Saved PDF");
    session.signal("TERM");
    let (status, written) = session.end();
    assert_eq!(status, 143, "{written}");
    let left: Vec<String> = fs::read_dir(&folder)
        .expect("the folder")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .filter(|name| name.starts_with('.'))
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[test]
fn the_menu_runs_a_lookup_and_offers_another() {
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("8");
    session.wait_for("What do you want to look up?");
    session.press("1");
    session.wait_for("Word: ");
    session.press("abandon\r");
    session.wait_for("mnemocode table --word abandon");
    session.wait_for("Press Enter for another lookup");
    session.press("\x1b");
    session.wait_for("What do you want to do?");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
}

#[test]
fn the_menu_leaves_a_secret_to_the_private_screen_of_its_command() {
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("3");
    session.wait_for("Where is the encoded seed phrase?");
    session.press("1");
    session.wait_for("How many words");
    session.press("1");
    session.wait_for("Was Seedshift used");
    session.press("1");
    session.wait_for("mnemocode decode --ask-secrets --mode direct");
    session.wait_for("(Esc cancels)");
    session.press(&format!("{PHRASE}\r"));
    session.wait_for("Press Enter to clear this screen.");
    session.press("\r");
    session.wait_for("What do you want to do?");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    let outside = written.rsplit(LEAVE_PRIVATE_SCREEN).next().expect("a part");
    assert!(!outside.contains("abandon"), "{outside}");
}

#[test]
fn a_cancelled_command_comes_back_to_the_menu() {
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("5");
    session.wait_for("Was Seedshift used");
    session.press("1");
    session.wait_for("(Esc cancels)");
    session.press("\x03");
    session.wait_for("What do you want to do?");
    session.press("q");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
}

#[test]
fn a_damaged_build_stops_before_any_question() {
    let mut build = fs::read(PROGRAM).expect("the program");
    let word_list = b"youthzebrazoo";
    let at = build
        .windows(word_list.len())
        .position(|bytes| bytes == word_list)
        .expect("the word list in the program");
    build[at] = b'e';
    let damaged = file("damaged-mnemocode");
    let _absent = fs::remove_file(&damaged);
    fs::copy(PROGRAM, &damaged).expect("a copy");
    fs::write(&damaged, build).expect("the damage");
    let program = damaged.to_string_lossy().into_owned();
    let session = Session::start(&program, &["encode", "--ask-secrets"]);
    let (status, written) = session.end();
    assert_eq!(status, 1, "{written}");
    assert!(
        written.contains("MnemoCode core self-test failed."),
        "{written}"
    );
    assert!(!written.contains(ENTER_PRIVATE_SCREEN), "{written}");
}

/// `args` at a terminal that says TERM=dumb.
fn on_a_dumb_terminal(args: &[&str]) -> (u32, String) {
    let setting = Setting {
        rows: 24,
        columns: 80,
        term: "dumb",
        folder: Path::new(env!("CARGO_TARGET_TMPDIR")),
    };
    Session::start_with(&setting, PROGRAM, args).end()
}

#[test]
fn a_secret_result_is_refused_at_a_terminal_that_says_dumb() {
    let phrase = file("dumb-phrase.txt");
    fs::write(&phrase, PHRASE).expect("a file");
    let phrase = phrase.to_string_lossy();
    let (status, written) = on_a_dumb_terminal(&[
        "encode",
        "--mnemonic-file",
        &phrase,
        "--mode",
        "direct",
        "--format",
        "3",
    ]);
    assert_eq!(status, 1, "{written}");
    assert!(
        written.contains("cannot show it on a private screen"),
        "{written}"
    );
    assert!(!written.contains("7684"), "{written}");
}

#[test]
fn a_secret_result_of_ask_secrets_is_refused_where_no_question_is_asked() {
    let record = file("dumb-asked-record.txt");
    fs::write(&record, PUBLIC_UNICODE_CODES.join(" ")).expect("a file");
    let record = record.to_string_lossy();
    let (status, written) = on_a_dumb_terminal(&[
        "decode",
        "--ask-secrets",
        "--input-file",
        &record,
        "--mode",
        "direct",
    ]);
    assert_eq!(status, 1, "{written}");
    assert!(
        written.contains("--ask-secrets needs a terminal that can clear its screen"),
        "{written}"
    );
    assert!(!written.contains("abandon"), "{written}");
}

#[test]
fn a_line_of_a_result_stays_off_a_terminal_that_has_no_private_screen() {
    let (phrase, out) = (file("error-phrase.txt"), file("error-result.txt"));
    fs::write(&phrase, PHRASE).expect("a file");
    let _absent = fs::remove_file(&out);
    let line = format!(
        "exec {PROGRAM} encode --mnemonic-file {} --mode direct --format 5 --cards </dev/null >{}",
        phrase.display(),
        out.display()
    );
    let (status, written) = Session::start("/bin/sh", &["-c", &line]).end();
    assert_eq!(status, 0, "{written}");
    assert!(!written.contains("#000064"), "{written}");
    let saved = fs::read_to_string(&out).expect("the result");
    assert_eq!(saved.matches("#000064").count(), 2, "{saved}");
    assert!(!saved.contains('\u{1b}'), "{saved}");
}

#[test]
fn re_encode_needs_its_terminal_before_its_first_question() {
    let (status, written) = on_a_dumb_terminal(&["re-encode", "--ask-secrets"]);
    assert_eq!(status, 1, "{written}");
    assert!(
        written.contains("--ask-secrets needs a terminal that can clear its screen"),
        "{written}"
    );
    assert!(!written.contains("Which form"), "{written}");
}

#[test]
fn re_encode_checks_what_is_given_before_its_first_question() {
    for (given, refusal) in [
        (
            vec!["--master-fingerprint", "zz"],
            "A master fingerprint must be eight hexadecimal characters.",
        ),
        (vec!["--old-mode", "nope"], "The old backup:"),
        (
            vec!["--bip39-passphrase-file", "no-such-file.txt"],
            "The BIP39 passphrase file could not be read.",
        ),
    ] {
        let mut args = vec!["re-encode", "--ask-secrets"];
        args.extend(given);
        let (status, written) = Session::start(PROGRAM, &args).end();
        assert_eq!(status, 1, "{written}");
        assert!(written.contains(refusal), "{written}");
        assert!(!written.contains("Which form"), "{written}");
    }
}

/// `re-encode --ask-secrets` at its second question, a form chosen.
fn at_the_second_question_of_a_new_backup() -> Session {
    let mut session = Session::start(PROGRAM, &["re-encode", "--ask-secrets"]);
    session.wait_for("Which form should the seed phrase take?");
    session.press("3");
    session.wait_for("Use Seedshift?");
    session
}

#[test]
fn escape_in_a_new_backup_goes_back_to_its_first_question_and_cancels_there() {
    let mut session = at_the_second_question_of_a_new_backup();
    session.press("\x1b");
    session.wait_for("Which form should the seed phrase take?");
    session.press("\x1b");
    let (status, written) = session.end();
    assert_eq!(status, 130, "{written}");
}

#[test]
fn the_old_backup_is_not_asked_under_the_heading_of_the_new_one() {
    let mut session = at_the_second_question_of_a_new_backup();
    session.press("2");
    session.wait_for("Split it into Shamir shares?");
    session.press("1");
    session.wait_for("Where should the result go?");
    session.press("1");
    session.wait_for("Instructions for your heirs?");
    session.press("1");
    session.wait_for("Encoded seed phrase, record or text file path:");
    let written = session.written();
    let last_page = written.rsplit("\x1b[2J").next().expect("a page");
    assert!(!last_page.contains("New backup"), "{last_page}");
    session.press("\x03");
    session.end();
}

#[test]
fn a_detail_of_a_card_is_taken_as_it_is_typed() {
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("1");
    session.wait_for("Which form should the seed phrase take?");
    session.press("5");
    session.wait_for("Use Seedshift?");
    session.press("2");
    session.wait_for("Split it into Shamir shares?");
    session.press("1");
    session.wait_for("Where should the result go?");
    session.press("3");
    session.wait_for("Which kind of file?");
    session.press("1");
    session.wait_for("How should the cards be laid out?");
    session.press("4");
    session.wait_for("Name of the new folder");
    session.press("\r");
    session.wait_for("Which card design?");
    session.press("5");
    session.wait_for("Type your own details for the cards?");
    session.press("2");
    session.wait_for("Name, in Latin letters");
    session.press("Alice Example\r");
    session.wait_for("Alice Example");
    session.wait_for("Role");
    session.press("\x03");
    let (_, written) = session.end();
    assert!(
        !written.contains("no valid answer is that long"),
        "{written}"
    );
}

#[test]
fn an_ending_signal_stops_a_save_before_it_is_published() {
    let folder = file("stopped-preview");
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    let mut program = std::process::Command::new(PROGRAM)
        .args(["preview", "--all", "--pdf", "cancel.pdf"])
        .current_dir(&folder)
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("the program runs");
    // Well inside the drawing of thirteen designs.
    thread::sleep(Duration::from_millis(500));
    let sent = std::process::Command::new("kill")
        .args(["-s", "INT", &program.id().to_string()])
        .status()
        .expect("kill runs");
    assert!(sent.success());
    let status = program.wait().expect("the program ends");
    assert_eq!(status.code(), Some(130));
    let left: Vec<_> = fs::read_dir(&folder).expect("a folder").collect();
    assert!(left.is_empty(), "{left:?}");
}

#[test]
fn a_question_refuses_one_byte_past_its_limit_and_takes_an_answer_at_it() {
    for (args, question, limit) in [
        (
            vec!["decode", "--ask-secrets", "--mode", "direct"],
            "Encoded seed phrase, record or text file path:",
            64 * 1024,
        ),
        (
            vec!["recover-word", "--ask-secrets"],
            "? for each forgotten word:",
            32 * 1024,
        ),
    ] {
        let mut past = Session::start(PROGRAM, &args);
        past.wait_for(question);
        past.press(&"a".repeat(limit + 1));
        past.wait_for(&format!("An answer is longer than {limit} bytes"));
        past.press("\x03");
        past.end();
        let mut at = Session::start(PROGRAM, &args);
        at.wait_for(question);
        at.press(&"a".repeat(limit));
        at.press("\r");
        // Asked again, for what the answer is and not for its length.
        at.wait_for(question);
        let written = at.written();
        assert!(
            !written.contains("no valid answer is that long"),
            "{written}"
        );
        at.press("\x03");
        at.end();
    }
}

#[test]
fn the_rest_of_a_paste_reaches_no_shell_when_a_prompt_ends_the_program() {
    let (phrase, left) = (file("paste-phrase.txt"), file("paste-left.txt"));
    fs::write(&phrase, PHRASE).expect("a file");
    let _absent = fs::remove_file(&left);
    let line = format!(
        "{PROGRAM} decode --mnemonic-file {} --input-file {} --mode direct; \
         stty -icanon min 0 time 5; dd of={} bs=1 count=4096 2>/dev/null; echo finished",
        phrase.display(),
        phrase.display(),
        left.display()
    );
    let line = line.replace(&format!("--mnemonic-file {} ", phrase.display()), "");
    let mut session = Session::start("/bin/sh", &["-c", &line]);
    session.wait_for("Press Enter to clear this screen.");
    session.press(&format!("\r{}", "abandon ".repeat(60)));
    session.wait_for("finished");
    let (status, written) = session.end();
    assert_eq!(status, 0, "{written}");
    let left = fs::read(&left).expect("what the shell would read");
    assert!(left.is_empty(), "{}", String::from_utf8_lossy(&left));
}

#[test]
fn ctrl_c_typed_with_an_answer_still_cancels() {
    let mut session = Session::start(PROGRAM, &[]);
    session.wait_for("What do you want to do?");
    session.press("8\x03");
    let (status, written) = session.end();
    assert_eq!(status, 130, "{written}");
    assert!(written.contains("Cancelled."), "{written}");
}

/// Whether the program of `session` catches the stop signal, by the system's view of it.
#[cfg(target_os = "linux")]
fn catches_a_stop(session: &Session) -> bool {
    let status = fs::read_to_string(format!("/proc/{}/status", session.process()));
    let caught = status
        .expect("its status")
        .lines()
        .find_map(|line| line.strip_prefix("SigCgt:\t").map(str::to_owned))
        .expect("the signals it catches");
    let caught = u64::from_str_radix(&caught, 16).expect("a mask");
    caught & (1 << (libc::SIGTSTP - 1)) != 0
}

#[cfg(target_os = "linux")]
#[test]
fn a_stop_is_left_to_the_system_unless_raw_mode_has_a_terminal_to_restore() {
    let mut question = at_the_first_question();
    assert!(catches_a_stop(&question));
    question.press("\x03");
    question.end();
    let working = Session::start(PROGRAM, &["self-test"]);
    // The first row of the report is written when the checks are done: the process is at work.
    thread::sleep(Duration::from_millis(100));
    let caught = catches_a_stop(&working);
    working.signal("KILL");
    assert!(!caught);
}

/// `encode --sskr` on a terminal of `rows` and 60 columns at the pages of its result.
fn at_the_pages_of_shares(rows: u16) -> Session {
    let setting = Setting {
        rows,
        columns: 60,
        term: "xterm-256color",
        folder: Path::new(env!("CARGO_TARGET_TMPDIR")),
    };
    let args = [
        "encode",
        "--sskr",
        "--ask-secrets",
        "--mode",
        "direct",
        "--threshold",
        "3",
        "--shares",
        "5",
    ];
    let mut session = Session::start_with(&setting, PROGRAM, &args);
    session.wait_for("(Esc cancels)");
    session.press(&format!("{PHRASE}\r"));
    session
}

#[test]
fn the_pages_of_a_result_are_drawn_again_at_a_new_size_without_a_key() {
    let mut session = at_the_pages_of_shares(12);
    session.wait_for("Page 1/");
    session.resize(9, 40);
    session.wait_for("Page 1/13");
    session.press("\x03");
    session.end();
}

#[test]
fn the_questions_under_an_encoded_result_keep_its_beginning() {
    let setting = Setting {
        rows: 24,
        columns: 80,
        term: "xterm-256color",
        folder: Path::new(env!("CARGO_TARGET_TMPDIR")),
    };
    let args = [
        "encode",
        "--ask-secrets",
        "--mode",
        "direct",
        "--format",
        "unicode",
    ];
    let mut session = Session::start_with(&setting, PROGRAM, &args);
    session.wait_for("(Esc cancels)");
    let phrase = format!("{}art", "abandon ".repeat(23));
    session.press(&format!("{phrase}\r"));
    session.wait_for("Page 1/");
    session.press("\r");
    session.wait_for("Check the backup now?");
    let written = session.written();
    let page = written
        .rsplit("\x1b[2J")
        .next()
        .expect("the page under the pages");
    assert!(page.contains("Encoded result"), "{page}");
    session.press("\x03");
    session.end();
}
