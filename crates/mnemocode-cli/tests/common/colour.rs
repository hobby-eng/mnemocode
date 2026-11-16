//! The inherited settings that choose the program's colours, removed from every program a test
//! starts, so that a test, not the shell that runs it, decides whether colour is expected.

use std::process::{Command, Stdio};

/// The settings `os/env.rs` reads for the colour rule. TERM is set by each terminal test.
// deliberate copy: a test crate cannot import the program's `COLOUR_SETTINGS` in `os/env.rs`; a
// unit test there checks that this list is written exactly as that one.
pub(crate) const SETTINGS: [&str; 3] = ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"];

/// `command` without the inherited colour settings.
pub(crate) fn plain(command: &mut Command) -> &mut Command {
    for name in SETTINGS {
        command.env_remove(name);
    }
    command
}

/// What `command`, run plainly with nothing on standard input, writes to standard error and
/// standard output when it fails as a refusal must: exit code 1 and `expected` in its errors.
#[allow(dead_code, reason = "each test file takes what it needs")]
pub(crate) fn refused(command: &mut Command, expected: &str) -> (String, Vec<u8>) {
    let output = plain(command)
        .stdin(Stdio::null())
        .output()
        .expect("the program runs");
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert_eq!(output.status.code(), Some(1), "{errors}");
    assert!(errors.contains(expected), "{errors}");
    (errors, output.stdout)
}
