//! The commands of the command line: each with the options it takes and whether it handles a
//! secret, which decides whether it runs behind the gate on its private screen (gate.rs). Each
//! command's module translates its options into library calls and their results into output.

pub(crate) mod encode;
pub(crate) mod given;
pub(crate) mod table;

use crate::args::{self, Parsed};
use crate::gate::Stop;

/// What the command line must know of a command before it runs it.
pub(crate) struct Command {
    /// Its name.
    pub(crate) name: &'static str,
    /// The options it takes.
    pub(crate) options: &'static [&'static str],
    /// Whether it takes or shows a secret: it then runs behind the gate, on the private screen.
    pub(crate) secret: bool,
    /// What runs it.
    pub(crate) run: fn(&Parsed) -> Result<(), Stop>,
}

/// Every command, in the order the help lists them.
pub(crate) const COMMANDS: [Command; 2] = [
    Command {
        name: "encode",
        options: &encode::OPTIONS,
        secret: true,
        run: encode::run,
    },
    Command {
        name: "table",
        options: &table::OPTIONS,
        secret: false,
        run: table::run,
    },
];

/// The command named `name`.
pub(crate) fn named(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.name == name)
}

/// Checks `parsed` against `command`'s options and its file sources.
pub(crate) fn check_options(command: &Command, parsed: &Parsed) -> Result<(), Stop> {
    args::assert_allowed(parsed, command.name, command.options)?;
    args::assert_private_file_sources(parsed)?;
    Ok(())
}
