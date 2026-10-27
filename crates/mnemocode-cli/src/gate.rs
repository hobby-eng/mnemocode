//! The gate before a command's first secret (CAP-CLI-SECRET-GATE, protections.md decision 1): the
//! protections are restricted for the command's needs and read back, a secret is refused only while
//! core dumps are not off or a tracer is attached, and everything else the system refused is
//! reported, never assumed. On a terminal the command then runs on its private screen, which shows
//! the protection first and the warnings about where the secret could leak: unencrypted swap, a
//! memory lock refused, a cloud service that copies an output.

use std::fmt;

use mnemocode::refusal::Refusal;

use crate::args::Parsed;
use crate::os::{Needs, Protection, Signal, unprotected_swap};
use crate::output::{Renamed, warn_of_cloud_copies};
use crate::terminal::{PrivateScreen, show_protection, warning_with_more};

/// How a command ended other than done: refused, cancelled by the person, or ended by a signal.
#[derive(Debug)]
pub(crate) enum Stop {
    /// A refusal, whose message is shown after "✗ Error:"; exit status 1.
    Refused(Box<dyn Refusal>),
    /// Ctrl+C at a question, Escape at a secret, or the end of the input: "Cancelled.", 130.
    Cancelled,
    /// An ending signal: 128 + the signal (130 and "Cancelled." for SIGINT and SIGQUIT).
    Signal(Signal),
}

impl<E: Refusal + 'static> From<E> for Stop {
    fn from(error: E) -> Self {
        Self::Refused(Box::new(error))
    }
}

/// A secret refused because a protection did not read back.
#[derive(Debug)]
pub(crate) struct Unprotected(pub(crate) String);

impl fmt::Display for Unprotected {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Unprotected {}

impl Refusal for Unprotected {
    fn code(&self) -> &'static str {
        "cli.protection.mnemo-code-could-not-switch-off-core-dumps"
    }
}

/// A secret result refused on a terminal that cannot show a private screen (`N-PRIVATE-SCREEN`).
#[derive(Debug)]
pub(crate) struct NoPrivateScreen;

impl fmt::Display for NoPrivateScreen {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            "This command shows a secret, and this terminal cannot show it on a private screen that is cleared afterwards. Save the result to a file instead, or run the command in another terminal.",
        )
    }
}

impl std::error::Error for NoPrivateScreen {}

impl Refusal for NoPrivateScreen {
    fn code(&self) -> &'static str {
        "cli.protection.private-screen-required"
    }
}

/// The lock warning, given once where a secret's pages could not be locked.
const LOCK_WARNING: &str = "The system did not lock all of this memory: a secret may reach swap";

/// Runs `body`, a command that takes or shows a secret, behind the gate: `needs` restricts the
/// protections, then a secret is refused or the private screen titled `title` opens, and `body`
/// runs on it; `shows_secret` for a command whose result is secret, refused on a terminal without
/// a private screen. The numbered outputs are reported once it is done.
pub(crate) fn run_secret(
    protection: &mut Protection,
    needs: &Needs,
    parsed: &Parsed,
    renamed: &mut Renamed,
    title: &str,
    shows_secret: bool,
    body: impl FnOnce(&mut PrivateScreen) -> Result<(), Stop>,
) -> Result<(), Stop> {
    protection.restrict(needs);
    if let Some(reason) = protection.refusal() {
        return Err(Unprotected(reason).into());
    }
    let mut screen = PrivateScreen::enter(title);
    let output_terminal = crate::terminal::can_redraw(crate::terminal::Channel::Output);
    if shows_secret && !screen.is_active() && output_terminal {
        return Err(NoPrivateScreen.into());
    }
    show_protection(&protection.summary());
    if let Some(swap) = unprotected_swap() {
        warning_with_more(&swap, "unencrypted-swap");
    }
    warn_of_cloud_copies(parsed);
    body(&mut screen)?;
    if mnemocode::secret::any_lock_refused() {
        warning_with_more(LOCK_WARNING, "memory-lock");
    }
    renamed.report();
    if !screen
        .wait_to_clear()
        .map_err(|interrupted| match interrupted {
            crate::terminal::Interrupted::Signal(signal) => Stop::Signal(signal),
            crate::terminal::Interrupted::Failed(_) => Stop::Cancelled,
        })?
    {
        return Err(Stop::Cancelled);
    }
    screen.leave();
    Ok(())
}
