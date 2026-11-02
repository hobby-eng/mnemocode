//! The signals that end or suspend a command (`N-SIGNALS`, ARCHITECTURE.md §5): their handlers
//! only set a flag, without SA_RESTART, so that the main thread's terminal read returns with EINTR
//! and the main thread itself restores the terminal, leaves the private screen and removes the
//! staging folders, which is not async-signal-safe, then exits with 128 + the signal (130 and
//! "Cancelled." for SIGINT and SIGQUIT). SIGTSTP has its default, which stops the process at once,
//! unless raw mode is on: there it sets its own flag, and the main thread restores the terminal and
//! stops ([`suspend_now`]). On Windows the console handler sets the same flag and, for a closed
//! console, waits up to the system's 5 s for the cleanup.

#![allow(
    unsafe_code,
    reason = "signal handlers and the console handler are installed through system calls that Rust \
              offers only through unsafe foreign functions (RUST-07: the CLI's os module only)"
)]

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

/// A signal that ends the command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Signal {
    /// SIGINT, or Ctrl+C or Ctrl+Break on Windows.
    Interrupt,
    /// SIGQUIT (Ctrl+\ outside raw mode).
    Quit,
    /// SIGTERM, or Windows's shutdown and logoff.
    Terminate,
    /// SIGHUP, or a closed console window.
    Hangup,
}

impl Signal {
    /// The exit status of a command that this signal ended: 128 + the signal's number, 130 for
    /// SIGINT and SIGQUIT alike (TS for SIGINT, mhfe for SIGQUIT).
    pub(crate) const fn exit_status(self) -> u8 {
        match self {
            Self::Interrupt | Self::Quit => 130,
            Self::Terminate => 143,
            Self::Hangup => 129,
        }
    }

    /// Whether the person cancelled ("Cancelled."), rather than the system ending the command.
    pub(crate) const fn is_cancel(self) -> bool {
        matches!(self, Self::Interrupt | Self::Quit)
    }

    const fn index(self) -> u8 {
        match self {
            Self::Interrupt => 1,
            Self::Quit => 2,
            Self::Terminate => 3,
            Self::Hangup => 4,
        }
    }

    const fn of_index(index: u8) -> Option<Self> {
        match index {
            1 => Some(Self::Interrupt),
            2 => Some(Self::Quit),
            3 => Some(Self::Terminate),
            4 => Some(Self::Hangup),
            _ => None,
        }
    }
}

/// The first ending signal received, as [`Signal::index`]; 0 for none.
static PENDING: AtomicU8 = AtomicU8::new(0);
/// Whether SIGTSTP arrived and the command has not stopped for it yet.
static SUSPEND: AtomicBool = AtomicBool::new(false);
/// Whether the main thread finished its cleanup, for Windows's closed console.
static CLEANED: AtomicBool = AtomicBool::new(false);

/// Records `signal`, keeping the first.
fn record(signal: Signal) {
    // A failed exchange means an earlier signal is kept.
    let _first = PENDING.compare_exchange(0, signal.index(), Ordering::SeqCst, Ordering::SeqCst);
}

/// The ending signal received, if any.
pub(crate) fn pending_signal() -> Option<Signal> {
    Signal::of_index(PENDING.load(Ordering::SeqCst))
}

/// Records a Ctrl+C read among keys that nothing else will read.
pub(crate) fn cancel() {
    record(Signal::Interrupt);
}

/// Forgets a Ctrl+C that was meant for a command, which has ended: it cancels nothing here. An
/// ending signal stays.
pub(crate) fn forget_cancel() {
    if pending_signal().is_some_and(Signal::is_cancel) {
        PENDING.store(0, Ordering::SeqCst);
    }
}

/// Says that the cleanup after a signal is done, so that a waiting console handler lets Windows
/// close the console.
pub(crate) fn cleanup_done() {
    CLEANED.store(true, Ordering::SeqCst);
}

#[cfg(unix)]
mod system {
    use super::{Ordering, SUSPEND, Signal, record};

    extern "C" fn on_signal(number: libc::c_int) {
        match number {
            libc::SIGINT => record(Signal::Interrupt),
            libc::SIGQUIT => record(Signal::Quit),
            libc::SIGTERM => record(Signal::Terminate),
            libc::SIGHUP => record(Signal::Hangup),
            libc::SIGTSTP => SUSPEND.store(true, Ordering::SeqCst),
            _ => {}
        }
    }

    /// Sets `handler` for `signal` without SA_RESTART; whether it reads back as set.
    fn install(signal: libc::c_int, handler: libc::sighandler_t) -> bool {
        // SAFETY: a zeroed sigaction is a valid empty one; sigaction reads the first structure and
        // writes the second during the call only.
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = handler;
            libc::sigemptyset(&raw mut action.sa_mask);
            let mut current: libc::sigaction = std::mem::zeroed();
            libc::sigaction(signal, &raw const action, std::ptr::null_mut()) == 0
                && libc::sigaction(signal, std::ptr::null(), &raw mut current) == 0
                && current.sa_sigaction == handler
        }
    }

    fn handler() -> libc::sighandler_t {
        on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t
    }

    /// The handlers of SIGINT, SIGQUIT, SIGTERM and SIGHUP; whether all read back.
    pub(super) fn handle_signals() -> bool {
        [libc::SIGINT, libc::SIGQUIT, libc::SIGTERM, libc::SIGHUP]
            .into_iter()
            // Every handler is installed, whether or not an earlier one was refused.
            .filter(|&signal| !install(signal, handler()))
            .count()
            == 0
    }

    /// Gives SIGTSTP its default, or the handler that raw mode needs: nothing but raw mode has a
    /// terminal to restore before the process stops.
    pub(super) fn suspend_by_default(default: bool) {
        install(
            libc::SIGTSTP,
            if default { libc::SIG_DFL } else { handler() },
        );
    }

    /// Stops the process group as SIGTSTP's default would, so that a shell sees its job stopped
    /// whatever the pipe it stands in, and takes the handler again once continued.
    pub(super) fn stop() {
        install(libc::SIGTSTP, libc::SIG_DFL);
        // SAFETY: kill takes a process group, 0 for this one, and a signal number; the process
        // stops until SIGCONT.
        unsafe { libc::kill(0, libc::SIGTSTP) };
        install(libc::SIGTSTP, handler());
    }
}

#[cfg(windows)]
mod system {
    use super::{CLEANED, Ordering, Signal, record};
    use windows_sys::Win32::System::Console::{
        CTRL_BREAK_EVENT, CTRL_C_EVENT, CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT,
        SetConsoleCtrlHandler,
    };
    use windows_sys::Win32::System::Threading::Sleep;
    use windows_sys::core::BOOL;

    /// The system's time for a handler of a closed console, in milliseconds, less a margin.
    const CLOSE_WAIT_MS: u32 = 4_500;
    const STEP_MS: u32 = 50;

    unsafe extern "system" fn on_event(event: u32) -> BOOL {
        match event {
            CTRL_C_EVENT | CTRL_BREAK_EVENT => {
                record(Signal::Interrupt);
                1
            }
            CTRL_CLOSE_EVENT | CTRL_LOGOFF_EVENT | CTRL_SHUTDOWN_EVENT => {
                record(if event == CTRL_CLOSE_EVENT {
                    Signal::Hangup
                } else {
                    Signal::Terminate
                });
                let mut waited = 0;
                while !CLEANED.load(Ordering::SeqCst) && waited < CLOSE_WAIT_MS {
                    // SAFETY: Sleep takes a duration only.
                    unsafe { Sleep(STEP_MS) };
                    waited += STEP_MS;
                }
                1
            }
            _ => 0,
        }
    }

    /// The console handler; whether Windows took it.
    pub(super) fn handle_signals() -> bool {
        // SAFETY: the handler is a function of the program that lives for its whole run.
        unsafe { SetConsoleCtrlHandler(Some(on_event), 1) != 0 }
    }

    /// Windows has no stop signal.
    pub(super) fn stop() {}

    /// Windows has no stop signal.
    pub(super) fn suspend_by_default(_default: bool) {}
}

/// Installs the handlers; whether every one reads back as set.
pub(crate) fn handle_signals() -> bool {
    system::handle_signals()
}

/// Gives SIGTSTP its default, or, while raw mode is on, the handler.
pub(super) fn suspend_by_default(default: bool) {
    system::suspend_by_default(default);
}

/// Whether SIGTSTP asked the command to stop; the caller restores the terminal first, then calls
/// [`suspend_now`], and takes the terminal again once it returns.
pub(crate) fn suspend_requested() -> bool {
    SUSPEND.load(Ordering::SeqCst)
}

/// Stops the process until it is continued (Unix), then clears the request.
pub(crate) fn suspend_now() {
    SUSPEND.store(false, Ordering::SeqCst);
    system::stop();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_signal_has_its_shell_status() {
        assert_eq!(Signal::Interrupt.exit_status(), 130);
        assert_eq!(Signal::Quit.exit_status(), 130);
        assert_eq!(Signal::Terminate.exit_status(), 143);
        assert_eq!(Signal::Hangup.exit_status(), 129);
        assert!(Signal::Quit.is_cancel() && !Signal::Hangup.is_cancel());
        for signal in [
            Signal::Interrupt,
            Signal::Quit,
            Signal::Terminate,
            Signal::Hangup,
        ] {
            assert_eq!(Signal::of_index(signal.index()), Some(signal));
        }
    }
}
