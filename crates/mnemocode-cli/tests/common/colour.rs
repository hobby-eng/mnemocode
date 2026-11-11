//! The inherited settings that choose the program's colours, removed from every program a test
//! starts, so that a test, not the shell that runs it, decides whether colour is expected.

use std::process::Command;

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
