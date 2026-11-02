//! What the checks before a command catch in a program that changed after it was built: the
//! program runs on public inputs with one known answer of a copy of it changed.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test changes a copy of the program and starts it"
)]

mod common;

use std::fs;
use std::process::{Command, Stdio};

use common::{SHARES, folder};

/// The secret of the official shares of BCR-2020-011: only the engine's cases compare it.
const ENGINE_ANSWER: &[u8] = b"7daa851251002874e1a1995f0897e6b1";

#[test]
fn a_changed_answer_of_the_share_engine_stops_a_share_command_before_it_reads_a_share() {
    let folder = folder("changed-engine-answer");
    let program = env!("CARGO_BIN_EXE_mnemocode");
    let mut build = fs::read(program).expect("the program");
    let at = build
        .windows(ENGINE_ANSWER.len())
        .position(|bytes| bytes == ENGINE_ANSWER)
        .expect("the answer in the program");
    build[at] = b'8';
    let changed = folder.join("changed-mnemocode");
    fs::copy(program, &changed).expect("a copy");
    fs::write(&changed, build).expect("the change");
    let output = Command::new(&changed)
        .args(["sskr-combine", "--share-file", SHARES])
        .current_dir(&folder)
        .stdin(Stdio::null())
        .output()
        .expect("the program runs");
    let errors = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{errors}");
    assert!(
        errors.contains("MnemoCode core self-test failed."),
        "{errors}"
    );
    assert!(output.stdout.is_empty(), "the shares were read");
}
