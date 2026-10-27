//! The `mnemocode` executable: the command line and the start menu over the `mnemocode` and
//! `mnemocode-cards` libraries. It translates input and output only; the process protections,
//! the terminal and the files live in its `os` module (docs/design/architect/ARCHITECTURE.md §5).
//!
//! The order of a run: core dumps off and the memory cap first (os::Protection::start), the signal
//! handlers, the environment and the terminal, then the arguments: a flag that would carry a
//! secret refused before anything is parsed, then the command, whose outputs are checked and whose
//! folders are made before its protections are restricted and its first secret is asked (gate).

#![expect(
    dead_code,
    reason = "the parts of the terminal, the files and the protections that later commands use arrive with the command line (increment 2) before those commands; this goes once every command is in (increment 9)"
)]

mod args;
mod commands;
mod gate;
mod input;
mod os;
mod output;
mod terminal;

use std::process::ExitCode;

use crate::gate::Stop;
use crate::os::{Environment, Protection};

/// Every block the program frees is wiped first, the copies dependencies make of a secret included.
#[global_allocator]
static ALLOCATOR: mnemocode::secret::ZeroingAllocator = mnemocode::secret::ZeroingAllocator;

/// The version, as `mnemocode --version` prints it.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The flags that ask for the version.
const VERSION_FLAGS: [&str; 2] = ["-V", "--version"];

/// A command name that names no command.
#[derive(Debug)]
struct NoSuchCommand;

impl std::fmt::Display for NoSuchCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("There is no such command. Run mnemocode --help to see the commands.")
    }
}

impl std::error::Error for NoSuchCommand {}

impl mnemocode::refusal::Refusal for NoSuchCommand {
    fn code(&self) -> &'static str {
        "cli.command-line.there-no-command-run-mnemocode-help-see-commands"
    }
}

/// Extra arguments after `version`.
#[derive(Debug)]
struct VersionArguments;

impl std::fmt::Display for VersionArguments {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("The version command does not accept additional arguments.")
    }
}

impl std::error::Error for VersionArguments {}

impl mnemocode::refusal::Refusal for VersionArguments {
    fn code(&self) -> &'static str {
        "cli.command-line.version-command-does-not-accept-additional-arguments"
    }
}

/// Runs one command line, the arguments after `mnemocode`.
fn run_command_line(argv: &[String], protection: &mut Protection) -> Result<(), Stop> {
    args::assert_safe_material_argv(argv)?;
    let Some((command, rest)) = argv.split_first() else {
        return Err(NoSuchCommand.into());
    };
    if VERSION_FLAGS.contains(&command.as_str()) || command == "version" {
        if !rest.is_empty() {
            return Err(VersionArguments.into());
        }
        terminal::output_line(&format!("mnemocode {VERSION}")).map_err(|_| Stop::Cancelled)?;
        return Ok(());
    }
    let command = commands::named(command).ok_or(NoSuchCommand)?;
    let mut parsed = args::parse_arguments(rest)?;
    commands::check_options(command, &parsed)?;
    // Before anything secret is read: the outputs checked, their folders made, the rest given up.
    let (needs, mut renamed) = output::preflight(&mut parsed)?;
    if command.secret {
        let title = command.name;
        return gate::run_secret(
            protection,
            &needs,
            &parsed,
            &mut renamed,
            title,
            true,
            |_| (command.run)(&parsed),
        );
    }
    protection.restrict(&needs);
    (command.run)(&parsed)?;
    renamed.report();
    Ok(())
}

fn main() -> ExitCode {
    let mut protection = Protection::start();
    os::handle_signals();
    terminal::init(Environment::read());
    let argv: Vec<String> = os::arguments()
        .into_iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();
    // An ending signal that arrived during the command ends it so, whatever it returned: a read
    // it interrupted reports nothing of its own.
    let ended = match (
        run_command_line(&argv, &mut protection),
        os::pending_signal(),
    ) {
        (Err(Stop::Signal(signal)), _) | (_, Some(signal)) => Err(Stop::Signal(signal)),
        (ended, None) => ended,
    };
    let left = os::remove_left();
    let status = match ended {
        Ok(()) => 0,
        Err(Stop::Refused(refusal)) => {
            terminal::failure(&refusal.to_string());
            1
        }
        Err(Stop::Cancelled) => {
            terminal::cancelled();
            130
        }
        Err(Stop::Signal(signal)) => {
            if signal.is_cancel() {
                terminal::cancelled();
            }
            signal.exit_status()
        }
    };
    for folder in left {
        terminal::notice(
            &format!(
                "A private temporary folder, which may hold a copy of the export, could not be removed: {}. Delete it.",
                terminal::printable(&folder.to_string_lossy())
            ),
            terminal::NoticeKind::Warning,
        );
    }
    os::cleanup_done();
    ExitCode::from(status)
}
