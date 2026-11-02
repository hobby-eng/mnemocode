//! The private screen (MnemoCode TS 0.1.0's `private-screen.ts`, `private-steps.ts`,
//! `private-summary.ts`): a command that handles a secret runs on the terminal's alternate screen,
//! each step on a screen of its own under the command's title, with the context and the warnings
//! that still hold drawn again (CORE-39); after the result, Enter clears it, and the main screen
//! keeps only a summary of what was saved and the warnings that still hold. Ctrl+C and a signal
//! leave it first, so that the error or "Cancelled." shows on the main screen.

use std::sync::Mutex;

use super::choice::wait_for_enter;
use super::keys::Interrupted;
use super::page::{close_page, open_page};
use super::{
    CLEAR_SCREEN, Channel, Chosen, ENTER_ALTERNATE_SCREEN, LEAVE_ALTERNATE_SCREEN, NoticeKind,
    error_line, error_raw, fact_line, heading_line, hint, more_line, notice_lines,
    terminal_available,
};

/// How long a step's context stays: until the next question ends, until the page ends (a result
/// clears the screen), or until the command ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lifetime {
    Question,
    Page,
    Command,
}

/// One line of the summary left on the main screen.
#[derive(Clone, Debug)]
struct SummaryLine {
    kind: NoticeKind,
    text: String,
    more: Option<String>,
}

/// The step screens of the one command on the private screen.
#[derive(Debug, Default)]
struct Steps {
    title: String,
    startup_warnings: Vec<String>,
    context: Vec<(Vec<String>, Lifetime)>,
    begun: bool,
    warnings: Vec<String>,
    warnings_drawn: bool,
    showing_result: bool,
    /// Whether the questions under the result keep its first rows above them, not its last.
    from_start: bool,
    drawing_context: bool,
    summary: Vec<SummaryLine>,
}

static STEPS: Mutex<Option<Steps>> = Mutex::new(None);

fn with_steps<T>(work: impl FnOnce(&mut Option<Steps>) -> T) -> T {
    let mut guard = STEPS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    work(&mut guard)
}

/// Whether the private screen is shown now, so that a secret typed there may be shown too.
pub(crate) fn on_private_screen() -> bool {
    with_steps(|steps| steps.is_some())
}

/// Adds a line to the summary of the private screen, once; nothing without one.
pub(super) fn add_summary(kind: NoticeKind, text: &str, more: Option<&str>) {
    with_steps(|steps| {
        if let Some(steps) = steps
            && !steps.summary.iter().any(|line| line.text == text)
        {
            steps.summary.push(SummaryLine {
                kind,
                text: text.to_owned(),
                more: more.map(str::to_owned),
            });
        }
    });
}

/// Draws `lines` that the coming steps need beside them; on the private screen they are drawn
/// again on every step screen until `lifetime` ends, elsewhere once.
pub(crate) fn keep_context(lines: Vec<String>, lifetime: Lifetime) {
    for line in &lines {
        error_line(line);
    }
    with_steps(|steps| {
        if let Some(steps) = steps {
            steps.context.push((lines, lifetime));
        }
    });
}

/// Retains a warning for the step screens: one given before the first step is drawn on every
/// step; a later one with the others of its step on the next step screen.
pub(crate) fn remember_warning(warning: &str) {
    with_steps(|steps| {
        let Some(steps) = steps else {
            return;
        };
        if steps.drawing_context {
            return;
        }
        if !steps.begun {
            if !steps.startup_warnings.iter().any(|kept| kept == warning) {
                steps.startup_warnings.push(warning.to_owned());
            }
            return;
        }
        if steps.warnings_drawn {
            steps.warnings.clear();
            steps.warnings_drawn = false;
        }
        if !steps.warnings.iter().any(|kept| kept == warning) {
            steps.warnings.push(warning.to_owned());
        }
    });
}

/// Draws a new step screen on the private screen: the title, the kept context, then the retained
/// warnings. Whether one was drawn: nothing elsewhere or under a shown result.
pub(crate) fn step_begin() -> bool {
    let drawing = with_steps(|steps| {
        let steps = steps.as_mut()?;
        if steps.showing_result {
            return None;
        }
        steps.begun = true;
        let mut lines = vec![
            CLEAR_SCREEN.to_owned(),
            format!("{}\n", heading_line(Channel::Error, &steps.title)),
        ];
        for (context, _) in &steps.context {
            lines.extend(context.iter().cloned());
        }
        let mut shown: Vec<&String> = Vec::new();
        for warning in steps.startup_warnings.iter().chain(&steps.warnings) {
            if !shown.contains(&warning) {
                shown.push(warning);
            }
        }
        for warning in shown {
            lines.extend(notice_lines(warning, NoticeKind::Warning));
        }
        steps.warnings_drawn = !steps.warnings.is_empty();
        Some(lines)
    });
    let Some(lines) = drawing else {
        return false;
    };
    let mut lines = lines.into_iter();
    if let Some(clear) = lines.next() {
        error_raw(&clear);
    }
    for line in lines {
        error_line(&line);
    }
    true
}

/// A typed answer was accepted: the warnings of its step and the context kept for its question
/// end; the startup warnings remain.
pub(crate) fn answer_accepted() {
    with_steps(|steps| {
        if let Some(steps) = steps {
            steps.warnings.clear();
            steps.warnings_drawn = false;
            steps
                .context
                .retain(|(_, lifetime)| *lifetime != Lifetime::Question);
        }
    });
}

/// The warnings of the last step end: no later step screen shows them.
pub(crate) fn end_warnings() {
    with_steps(|steps| {
        if let Some(steps) = steps {
            steps.warnings.clear();
            steps.warnings_drawn = false;
        }
    });
}

/// Whether a result shows, which the questions after it are drawn under.
pub(crate) fn showing_result() -> bool {
    with_steps(|steps| steps.as_ref().is_some_and(|steps| steps.showing_result))
}

/// An answer under a result led to another step, which starts a new page: the result, its warnings
/// and the contexts of the page end. Without a result shown nothing changes.
pub(crate) fn leave_result() {
    with_steps(|steps| {
        if let Some(steps) = steps
            && steps.showing_result
        {
            steps.showing_result = false;
            steps.from_start = false;
            steps.warnings.clear();
            steps.warnings_drawn = false;
            steps
                .context
                .retain(|(_, lifetime)| *lifetime == Lifetime::Command);
        }
    });
}

/// A question ended, answered or left with Escape: the context kept for it ends.
pub(crate) fn question_ended() {
    with_steps(|steps| {
        if let Some(steps) = steps {
            steps
                .context
                .retain(|(_, lifetime)| *lifetime != Lifetime::Question);
        }
    });
}

/// A result shows, which the questions after it are drawn under.
pub(crate) fn show_result() {
    with_steps(|steps| {
        if let Some(steps) = steps {
            steps.begun = true;
            steps.showing_result = true;
        }
    });
}

/// The result shown stays from its start above the questions after it, as an encoded backup does:
/// what it is comes first.
pub(crate) fn keep_result_from_start() {
    with_steps(|steps| {
        if let Some(steps) = steps {
            steps.from_start = true;
        }
    });
}

/// Whether the result shown stays from its start.
pub(super) fn result_stays_from_start() -> bool {
    with_steps(|steps| steps.as_ref().is_some_and(|steps| steps.from_start))
}

/// Clears the private screen before a result, so that it stands alone (CORE-39); whether it was.
pub(crate) fn clear_private_screen() -> bool {
    let cleared = with_steps(|steps| {
        let Some(steps) = steps else {
            return false;
        };
        steps.begun = true;
        steps.showing_result = false;
        steps.from_start = false;
        steps.warnings.clear();
        steps.warnings_drawn = false;
        steps
            .context
            .retain(|(_, lifetime)| *lifetime == Lifetime::Command);
        true
    });
    if cleared {
        error_raw(CLEAR_SCREEN);
    }
    cleared
}

/// Shows on the private screen what protects this process now: "Protection" and its summary.
pub(crate) fn show_protection(summary: &str) {
    if !on_private_screen() {
        return;
    }
    let line = format!(
        "{}\n",
        fact_line(Channel::Error, "Protection", summary, ANSWER_LABEL_WIDTH)
    );
    keep_context(vec![line], Lifetime::Question);
}

/// The label column of the answers and facts of the questions (terminal-choice.ts).
pub(crate) const ANSWER_LABEL_WIDTH: usize = 11;
/// What the private screen asks before it is cleared, after a blank line.
const CLEAR_PROMPT: &str = "Press Enter to clear this screen.";
/// The rows of that prompt and of the blank line above it.
pub(crate) const CLOSING_ROWS: usize = 2;
/// The last line of the summary of a command whose result was read and cleared.
const CLEARED: &str = "The screen with the result was cleared.";

/// The private screen of one command while this lives: entered where a person answers and reads
/// at a terminal, left on drop, with the summary on the main screen.
pub(crate) struct PrivateScreen {
    active: bool,
    cleared: bool,
}

impl PrivateScreen {
    /// Enters the private screen titled `title` where a terminal can show it; otherwise nothing.
    pub(crate) fn enter(title: &str) -> Self {
        if !terminal_available() {
            return Self {
                active: false,
                cleared: false,
            };
        }
        error_raw(ENTER_ALTERNATE_SCREEN);
        open_page();
        with_steps(|steps| {
            *steps = Some(Steps {
                title: title.to_owned(),
                ..Steps::default()
            });
        });
        Self {
            active: true,
            cleared: false,
        }
    }

    /// Whether the private screen is shown.
    pub(crate) fn is_active(&self) -> bool {
        self.active
    }

    /// After a result: waits for Enter, then the screen is left as cleared. Ctrl+C gives
    /// `Ok(false)`.
    pub(crate) fn wait_to_clear(&mut self) -> Result<bool, Interrupted> {
        if !self.active {
            return Ok(true);
        }
        error_raw("\n");
        if matches!(wait_for_enter(CLEAR_PROMPT)?, Chosen::Cancelled) {
            return Ok(false);
        }
        self.cleared = true;
        Ok(true)
    }

    /// Leaves the private screen, printing the summary on the main screen; done once.
    pub(crate) fn leave(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        close_page();
        let steps = with_steps(Option::take);
        error_raw(LEAVE_ALTERNATE_SCREEN);
        let Some(steps) = steps else {
            return;
        };
        if steps.summary.is_empty() && !self.cleared {
            return;
        }
        error_line(&format!("\n{}", heading_line(Channel::Error, &steps.title)));
        for line in &steps.summary {
            for shown in notice_lines(&line.text, line.kind) {
                error_line(&shown);
            }
            if let Some(anchor) = &line.more {
                error_line(&more_line(anchor));
            }
        }
        if self.cleared {
            hint(CLEARED);
        }
    }
}

impl Drop for PrivateScreen {
    fn drop(&mut self) {
        self.leave();
    }
}
