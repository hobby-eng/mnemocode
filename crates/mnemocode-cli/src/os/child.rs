//! A command of the start menu in a process of its own, the same executable (N-FRESH-PROCESS): the
//! protections of a command are set before its first thread and read back before its first secret.
//! Its arguments hold no secret, and it reads and writes the terminal itself.

#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the one program that this one runs, itself, in the os module and nowhere else"
)]

use std::io;
use std::process::{Command, ExitStatus};

/// What a shell reports for a process that a signal stopped: 128 plus the signal's number.
const SIGNAL_EXIT_BASE: i32 = 128;
/// The exit code of a cancelled command.
const CANCELLED: i32 = 130;

/// How a command in its own process ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CommandEnd {
    /// Its exit code, as a shell would report it.
    pub(crate) code: i32,
    /// Whether the system ended it, where it could clean up nothing: its terminal is as it left it.
    pub(crate) killed: bool,
}

/// Runs this program again with `arguments`.
pub(crate) fn run_own_process(arguments: &[String]) -> io::Result<CommandEnd> {
    let program = std::env::current_exe()?;
    Command::new(program)
        .args(arguments)
        .status()
        .map(command_end)
}

/// How the command of `status` ended.
#[cfg(unix)]
fn command_end(status: ExitStatus) -> CommandEnd {
    use std::os::unix::process::ExitStatusExt as _;
    status.signal().map_or_else(
        || CommandEnd {
            code: status.code().unwrap_or(0),
            killed: false,
        },
        |signal| CommandEnd {
            code: SIGNAL_EXIT_BASE + signal,
            killed: true,
        },
    )
}

/// How the command of `status` ended: a crash's status is an NTSTATUS, negative as an `i32`.
#[cfg(windows)]
fn command_end(status: ExitStatus) -> CommandEnd {
    let code = status.code().unwrap_or(SIGNAL_EXIT_BASE + 1);
    CommandEnd {
        code,
        killed: code < 0,
    }
}

impl CommandEnd {
    /// Whether it ended in a way that the person did not ask for.
    pub(crate) const fn stopped(self) -> bool {
        self.killed || (self.code > SIGNAL_EXIT_BASE && self.code != CANCELLED)
    }

    /// The signal or status that ended it, by the name a person may look up.
    pub(crate) fn reason(self) -> String {
        let number = self.code - SIGNAL_EXIT_BASE;
        name_of_signal(number).map_or_else(|| format!("signal {number}"), str::to_owned)
    }
}

/// The reason in the system's words that a command could not be started, by its code where the
/// system has one that a person may look up.
pub(crate) fn start_failure(error: &io::Error) -> String {
    error
        .raw_os_error()
        .and_then(name_of_error)
        .map_or_else(|| error.to_string(), str::to_owned)
}

/// The name of the system error `number`.
#[cfg(unix)]
fn name_of_error(number: i32) -> Option<&'static str> {
    [
        (libc::EACCES, "EACCES"),
        (libc::EAGAIN, "EAGAIN"),
        (libc::EMFILE, "EMFILE"),
        (libc::ENOENT, "ENOENT"),
        (libc::ENOEXEC, "ENOEXEC"),
        (libc::ENOMEM, "ENOMEM"),
        (libc::EPERM, "EPERM"),
        (libc::ETXTBSY, "ETXTBSY"),
    ]
    .into_iter()
    .find(|(error, _)| *error == number)
    .map(|(_, name)| name)
}

/// Windows's errors have their own words.
#[cfg(windows)]
const fn name_of_error(_number: i32) -> Option<&'static str> {
    None
}

/// The name of the signal `number`, where the system has signals.
#[cfg(unix)]
fn name_of_signal(number: i32) -> Option<&'static str> {
    [
        (libc::SIGABRT, "SIGABRT"),
        (libc::SIGALRM, "SIGALRM"),
        (libc::SIGBUS, "SIGBUS"),
        (libc::SIGFPE, "SIGFPE"),
        (libc::SIGHUP, "SIGHUP"),
        (libc::SIGILL, "SIGILL"),
        (libc::SIGINT, "SIGINT"),
        (libc::SIGIO, "SIGIO"),
        (libc::SIGKILL, "SIGKILL"),
        (libc::SIGPIPE, "SIGPIPE"),
        (libc::SIGPROF, "SIGPROF"),
        (libc::SIGQUIT, "SIGQUIT"),
        (libc::SIGSEGV, "SIGSEGV"),
        (libc::SIGSYS, "SIGSYS"),
        (libc::SIGTERM, "SIGTERM"),
        (libc::SIGTRAP, "SIGTRAP"),
        (libc::SIGUSR1, "SIGUSR1"),
        (libc::SIGUSR2, "SIGUSR2"),
        (libc::SIGVTALRM, "SIGVTALRM"),
        (libc::SIGXCPU, "SIGXCPU"),
        (libc::SIGXFSZ, "SIGXFSZ"),
    ]
    .into_iter()
    .find(|(signal, _)| *signal == number)
    .map(|(_, name)| name)
}

/// Windows has no signals.
#[cfg(windows)]
const fn name_of_signal(_number: i32) -> Option<&'static str> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_that_cleaned_up_after_a_signal_is_stopped_but_not_killed() {
        let terminated = CommandEnd {
            code: 143,
            killed: false,
        };
        assert!(terminated.stopped());
        let cancelled = CommandEnd {
            code: 130,
            killed: false,
        };
        assert!(!cancelled.stopped());
        let done = CommandEnd {
            code: 1,
            killed: false,
        };
        assert!(!done.stopped());
    }

    #[cfg(unix)]
    #[test]
    fn every_signal_of_a_command_goes_by_its_name() {
        let named = |number: i32| {
            CommandEnd {
                code: SIGNAL_EXIT_BASE + number,
                killed: true,
            }
            .reason()
        };
        assert_eq!(named(libc::SIGTERM), "SIGTERM");
        assert_eq!(named(libc::SIGALRM), "SIGALRM");
        assert_eq!(named(libc::SIGSYS), "SIGSYS");
        assert_eq!(named(99), "signal 99");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_start_goes_by_the_code_of_the_system() {
        let refused = io::Error::from_raw_os_error(libc::EACCES);
        assert_eq!(start_failure(&refused), "EACCES");
    }
}
