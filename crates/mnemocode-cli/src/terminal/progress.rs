//! The progress line of a long search (MnemoCode TS 0.1.0's `ProgressLine`): on a terminal each
//! update replaces the one before, so that the screen keeps one line however long the search runs;
//! in a file, a pipe or TERM=dumb each update is a line of its own.

#![expect(
    clippy::disallowed_methods,
    reason = "the line is rewritten at most once per interval, and a search's pace measured, on the system's clock; the library reads none"
)]

use std::time::{Duration, Instant};

use super::{Channel, can_redraw, columns, error_raw, hint, paint, style};

/// Seconds between two progress lines of a long search: a line that changes less often stays
/// readable.
pub(crate) const SEARCH_PROGRESS_SECONDS: u64 = 10;
/// Returns to the start of the line and erases it.
const REWRITE_LINE: &str = "\r\x1b[2K";

/// The seconds `work` takes on the system's clock.
pub(crate) fn seconds_of<E>(work: impl FnOnce() -> Result<(), E>) -> Result<f64, E> {
    let started = Instant::now();
    work()?;
    Ok(started.elapsed().as_secs_f64())
}

/// The progress line of one search.
#[derive(Debug)]
pub(crate) struct ProgressLine {
    open: bool,
    interval: Duration,
    shown_at: Instant,
}

impl ProgressLine {
    /// A line that [`ProgressLine::show_every`] rewrites at most once every `interval_seconds`,
    /// counted from now.
    pub(crate) fn new(interval_seconds: u64) -> Self {
        Self {
            open: false,
            interval: Duration::from_secs(interval_seconds),
            shown_at: Instant::now(),
        }
    }

    /// Shows the line that `message` makes, unless the last was shown less than the interval ago;
    /// the message is made only when it is shown.
    pub(crate) fn show_every(&mut self, message: impl FnOnce() -> String) {
        if self.shown_at.elapsed() < self.interval {
            return;
        }
        self.shown_at = Instant::now();
        self.show(&message());
    }

    /// Shows `message` now.
    pub(crate) fn show(&mut self, message: &str) {
        if !can_redraw(Channel::Error) {
            hint(message);
            return;
        }
        // A line longer than the window would wrap, and only its last row would be rewritten.
        let width = columns();
        let text: String = if width > 1 && message.chars().count() >= width {
            message.chars().take(width - 1).collect()
        } else {
            message.to_owned()
        };
        error_raw(&format!(
            "{REWRITE_LINE}{}",
            paint(Channel::Error, style::MUTED, &text)
        ));
        self.open = true;
    }

    /// Closes the line after the search.
    pub(crate) fn end(&mut self) {
        if self.open {
            error_raw("\n");
        }
        self.open = false;
    }
}
