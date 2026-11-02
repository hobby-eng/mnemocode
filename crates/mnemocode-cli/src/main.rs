//! The `mnemocode` executable: the command line and the start menu over the `mnemocode` and
//! `mnemocode-cards` libraries. It translates input and output only; the process protections,
//! the terminal and the files live in its `os` module (docs/design/architect/ARCHITECTURE.md §5).
//!
//! The order of a run: core dumps off and the memory cap first (os::Protection::start), the signal
//! handlers, the environment and the terminal, then the arguments: a flag that would carry a
//! secret refused before anything is parsed, then the command, whose outputs are checked and whose
//! folders are made before its protections are restricted and its first secret is asked (gate).

mod args;
mod commands;
mod gate;
mod input;
mod menu;
mod os;
mod output;
mod terminal;

use std::process::ExitCode;

use crate::commands::{Run, VERSION, help, self_test};
use crate::gate::Stop;
use crate::os::{Environment, Needs, Protection};

/// Every block the program frees is wiped first, the copies dependencies make of a secret included.
#[global_allocator]
static ALLOCATOR: mnemocode::secret::ZeroingAllocator = mnemocode::secret::ZeroingAllocator;

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

/// Why a terminal that says TERM=dumb gets the help instead of the menu.
const TOO_DUMB_FOR_THE_MENU: &str =
    "The menu needs a terminal that can clear its screen; this one says TERM=dumb.";

/// The flags that ask for help.
const HELP_FLAGS: [&str; 2] = ["-h", "--help"];

/// The refusals of `help`.
#[derive(Debug)]
enum HelpError {
    OneName,
    NoSuchName(String),
}

impl std::fmt::Display for HelpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OneName => f.write_str("The help command takes one command or topic name."),
            Self::NoSuchName(names) => {
                write!(
                    f,
                    "There is no such command or topic. Choose one of: {names}."
                )
            }
        }
    }
}

impl std::error::Error for HelpError {}

impl mnemocode::refusal::Refusal for HelpError {
    fn code(&self) -> &'static str {
        match self {
            Self::OneName => "cli.command-line.help-command-takes-one-command-topic-name",
            Self::NoSuchName(_) => "cli.command-line.there-no-command-topic-choose-one",
        }
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
        // Started at a terminal, as by a double-click, MnemoCode shows its menu; a script or a pipe
        // gets the help. A terminal that says TERM=dumb cannot draw the menu.
        if terminal::terminal_available() {
            return menu::run(protection);
        }
        if terminal::terminals_attached() {
            terminal::hint(TOO_DUMB_FOR_THE_MENU);
        }
        help::print_usage();
        return Ok(());
    };
    let is_help = |argument: &str| HELP_FLAGS.contains(&argument);
    if is_help(command) {
        help::print_usage();
        return Ok(());
    }
    if command == "help" {
        if rest.len() > 1 {
            return Err(HelpError::OneName.into());
        }
        let Some(name) = rest.first() else {
            help::print_usage();
            return Ok(());
        };
        // `help --help` is the help of help.
        let name = if is_help(name) { "help" } else { name.as_str() };
        if !help::print_named_help(name) {
            return Err(HelpError::NoSuchName(help::help_names()).into());
        }
        return Ok(());
    }
    if VERSION_FLAGS.contains(&command.as_str()) || command == "version" {
        // `version --help`, as `-V --help`: the help of version.
        if let [only] = rest
            && is_help(only)
        {
            help::print_named_help("version");
            return Ok(());
        }
        if !rest.is_empty() {
            return Err(VersionArguments.into());
        }
        terminal::result_line(&format!("mnemocode {VERSION}"));
        return Ok(());
    }
    let page = help::page_of(command).ok_or(NoSuchCommand)?;
    // Help still accepts half-typed non-secret options; forbidden material flags are refused first.
    if rest.iter().any(|argument| is_help(argument)) {
        let detailed = rest.iter().any(|argument| argument == "--help");
        help::print_command_help(command, page, detailed);
        return Ok(());
    }
    let command = commands::named(command).ok_or(NoSuchCommand)?;
    let mut parsed = args::parse_arguments(rest)?;
    commands::check_options(command, &parsed)?;
    if let Run::SelfTest(run) = command.run {
        protection.restrict(&Needs {
            folders: vec![os::temporary_folder()],
            ..Needs::default()
        });
        return run(protection);
    }
    // Before anything secret is read: the outputs checked, their folders made, the rest given up.
    let mut needs = output::preflight(&mut parsed)?;
    needs.answers_name_folders = command.asks_outputs.is_some_and(|asks| asks(&parsed));
    protection.restrict(&needs);
    self_test::assert_core()?;
    let body = |protection: &mut Protection| match command.run {
        Run::Options(run) => run(&parsed),
        Run::Ruling(run) => run(&parsed, protection),
        Run::SelfTest(run) => run(protection),
    };
    if command.secret {
        return gate::run_secret(protection, &parsed, command.name, true, body);
    }
    body(protection)?;
    output::report_renamed();
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
    let mut status = match ended {
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
    // A result that standard output did not take ends a command that would have succeeded. A
    // closed pipe, such as `| head`, is the reader's choice: the command ends as done.
    if let (0, Some(error)) = (status, terminal::output_failure())
        && error.kind() != std::io::ErrorKind::BrokenPipe
    {
        terminal::failure(&output::OutputError::ResultNotWritten(error.to_string()).to_string());
        status = 1;
    }
    for folder in left {
        terminal::notice(
            &format!(
                "A private temporary folder, which may hold a copy of the export, could not be removed: {}. Delete it.",
                terminal::printable(&folder.to_string_lossy())
            ),
            terminal::NoticeKind::Warning,
        );
    }
    os::restore();
    os::cleanup_done();
    ExitCode::from(status)
}
