//! Everything MnemoCode shows on a terminal, in the one style of the bip_tools command-line tools
//! (MnemoCode TS 0.1.0's `src/cli/terminal.ts` and `terminal-style.ts`, as `mhfe`): the sixteen
//! standard colours only, cyan for headings, grey for labels and secondary text, a green ✓, a
//! yellow ! and a red ✗; running text wrapped to 78 columns. Output that does not go to a terminal,
//! or to TERM=dumb, carries no colour and keeps its plain form for scripts. Questions, progress and
//! messages go to standard error; results to standard output.

mod answer;
mod hints;
mod keys;
mod line;
mod private;
mod progress;
pub(crate) mod result;

use std::sync::{Mutex, OnceLock};

use mnemocode::text::display::safe_display;
use mnemocode::text::widths::text_width;

use crate::os::{self, Environment, Stream};

pub(crate) use answer::Hints;
pub(crate) use keys::{Interrupted, Key, Keys};
pub(crate) use line::{LineOptions, LineOutcome, read_line};
pub(crate) use private::{
    PrivateScreen, answer_accepted, clear_private_screen, keep_context, on_private_screen,
    remember_warning, show_protection, show_result, step_begin,
};

/// SGR codes of the shared palette. Bright black is the grey of most schemes; "dim" is too faint
/// in some.
pub(crate) mod style {
    /// Headings.
    pub(crate) const HEADING: &str = "1;36";
    /// Options and names to type.
    pub(crate) const ACCENT: &str = "36";
    /// What matters most.
    pub(crate) const STRONG: &str = "1";
    /// Labels and secondary text.
    pub(crate) const MUTED: &str = "90";
    /// A success's mark.
    pub(crate) const GOOD: &str = "1;32";
    /// A warning.
    pub(crate) const WARNING: &str = "1;33";
    /// An error's mark.
    pub(crate) const BAD: &str = "1;31";
}

/// The SGR sequence that ends a painted run.
const SGR_RESET: &str = "\x1b[0m";
/// Longest line of running text, so that messages read well in an 80-column terminal.
pub(crate) const TEXT_WIDTH: usize = 78;
/// A notice's mark ("✓" or "!") and the space after it, before each of its lines.
const NOTICE_MARK_WIDTH: usize = 2;
/// The mark of an error on a terminal, as in `mhfe`.
const ERROR_MARK: &str = "✗ Error:";
/// The indent of a fact's label.
const FACT_INDENT: usize = 2;
/// The space between the column of a fact's label and its value.
const FACT_GAP: usize = 1;
/// The narrowest label column of a result, so that short labels line up as in `mhfe`.
const MIN_LABEL_WIDTH: usize = 10;

/// Clears the screen and moves to its top left (VT100). Written raw: NO_COLOR removes colours,
/// not these.
pub(crate) const CLEAR_SCREEN: &str = "\x1b[2J\x1b[H";
/// Clears from the cursor to the end of the screen.
pub(crate) const ERASE_BELOW: &str = "\x1b[J";
/// Switches to the alternate screen, clears it and moves to its top left.
pub(crate) const ENTER_ALTERNATE_SCREEN: &str = "\x1b[?1049h\x1b[2J\x1b[H";
/// Clears the alternate screen, then returns to the main screen; the clear comes first, so that
/// the words also vanish where there is no alternate screen.
pub(crate) const LEAVE_ALTERNATE_SCREEN: &str = "\x1b[2J\x1b[H\x1b[?1049l";
/// The README on GitHub, which a message at run time links to instead of explaining.
pub(crate) const README_URL: &str = "https://github.com/hobby-eng/mnemocode";

/// Moves the cursor up `lines` lines; nothing for none.
pub(crate) fn cursor_up(lines: usize) -> String {
    if lines > 0 {
        format!("\x1b[{lines}A")
    } else {
        String::new()
    }
}

/// Moves the cursor down `lines` lines; nothing for none.
pub(crate) fn cursor_down(lines: usize) -> String {
    if lines > 0 {
        format!("\x1b[{lines}B")
    } else {
        String::new()
    }
}

/// Moves the cursor right `columns` columns; nothing for none.
pub(crate) fn cursor_right(columns: usize) -> String {
    if columns > 0 {
        format!("\x1b[{columns}C")
    } else {
        String::new()
    }
}

/// What the terminal is, read once at start: the environment's colour rule and which streams are
/// terminals.
#[derive(Debug)]
struct Context {
    environment: Environment,
    input: bool,
    output: bool,
    error: bool,
}

static CONTEXT: OnceLock<Context> = OnceLock::new();

/// Reads the environment and the streams once; `main` calls it at start.
pub(crate) fn init(environment: Environment) {
    os::prepare();
    let _first = CONTEXT.set(Context {
        environment,
        input: os::is_terminal(Stream::Input),
        output: os::is_terminal(Stream::Output),
        error: os::is_terminal(Stream::Error),
    });
}

fn context() -> &'static Context {
    CONTEXT.get_or_init(|| Context {
        environment: Environment::default(),
        input: false,
        output: false,
        error: false,
    })
}

/// The environment read at start.
pub(crate) fn environment() -> &'static Environment {
    &context().environment
}

/// A stream that a result or a message is written to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Channel {
    /// Standard output.
    Output,
    /// Standard error.
    Error,
}

/// Whether `channel` is a terminal that can move its cursor and rewrite a line: a terminal that is
/// not "dumb". Colour and a progress line that rewrites itself both ask it.
pub(crate) fn can_redraw(channel: Channel) -> bool {
    let context = context();
    let tty = match channel {
        Channel::Output => context.output,
        Channel::Error => context.error,
    };
    tty && !context.environment.dumb_terminal
}

/// Whether `channel` gets colour, as the Rust tools decide it: NO_COLOR turns it off,
/// CLICOLOR_FORCE turns it on, and otherwise only a terminal that is not "dumb" and has not set
/// CLICOLOR=0 gets it.
pub(crate) fn gets_color(channel: Channel) -> bool {
    let environment = &context().environment;
    if environment.no_color {
        return false;
    }
    if environment.force_color {
        return true;
    }
    can_redraw(channel) && !environment.clicolor_off
}

/// Whether questions can be asked: keys are read from a terminal on standard input and drawn on one
/// on standard error, which is not TERM=dumb.
pub(crate) fn terminal_available() -> bool {
    terminals_attached() && !context().environment.dumb_terminal
}

/// Whether standard input and standard error are terminals, whatever their type.
pub(crate) fn terminals_attached() -> bool {
    let context = context();
    context.input && context.error
}

/// `text` in the style `code` when `channel` gets colour, otherwise unchanged.
pub(crate) fn paint(channel: Channel, code: &str, text: &str) -> String {
    if gets_color(channel) {
        format!("\x1b[{code}m{text}{SGR_RESET}")
    } else {
        text.to_owned()
    }
}

/// Outside text for display only: control characters become U+FFFD.
pub(crate) fn printable(text: &str) -> String {
    safe_display(text)
}

/// The cells that `text` shows on a terminal: its colour codes take none.
pub(crate) fn shown_width(text: &str) -> usize {
    let mut width = 0;
    let mut rest = text;
    while let Some(at) = rest.find("\x1b[") {
        width += text_width(rest.get(..at).unwrap_or_default());
        let after = rest.get(at + 2..).unwrap_or_default();
        let end = after.find('m').map_or(after.len(), |end| end + 1);
        rest = after.get(end..).unwrap_or_default();
    }
    width + text_width(rest)
}

/// Breaks `text` into lines of at most `width` cells at spaces; colour codes take no room, and a
/// word longer than `width` keeps a line of its own.
pub(crate) fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut length = 0;
    for word in text.split(' ').filter(|word| !word.is_empty()) {
        let size = shown_width(word);
        if !line.is_empty() && length + 1 + size > width {
            lines.push(std::mem::take(&mut line));
        }
        if line.is_empty() {
            length = size;
        } else {
            length += 1 + size;
            line.push(' ');
        }
        line.push_str(word);
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// `text` wrapped to TEXT_WIDTH beside `mark`, which is `indent` cells wide with its space: the
/// mark before the first line, as many spaces before the others, each line in `style`. A text that
/// fits stays as it is, its spaces included, and a text without words still gets its mark.
pub(crate) fn beside_mark(
    mark: &str,
    indent: usize,
    text: &str,
    style: &dyn Fn(&str) -> String,
) -> Vec<String> {
    let width = TEXT_WIDTH.saturating_sub(indent);
    let mut lines = if shown_width(text) <= width {
        vec![text.to_owned()]
    } else {
        wrap_text(text, width)
    };
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let lead = if index == 0 {
                mark.to_owned()
            } else {
                " ".repeat(indent)
            };
            format!("{lead}{}", style(line))
        })
        .collect()
}

/// "MnemoCode · <title>": the heading of a result, a self-test or the menu.
pub(crate) fn heading_line(channel: Channel, title: &str) -> String {
    format!(
        "{} {} {}",
        paint(channel, style::HEADING, "MnemoCode"),
        paint(channel, style::MUTED, "·"),
        paint(channel, style::STRONG, title)
    )
}

/// A fact under a heading: its grey label in a column `width` wide, then its value, wrapped to
/// TEXT_WIDTH under its own column; several lines joined by line breaks.
pub(crate) fn fact_line(channel: Channel, label: &str, value: &str, width: usize) -> String {
    let label_width = text_width(label);
    let padded = format!("{label}{}", " ".repeat(width.saturating_sub(label_width)));
    let mark = format!(
        "{}{}{}",
        " ".repeat(FACT_INDENT),
        paint(channel, style::MUTED, &padded),
        " ".repeat(FACT_GAP)
    );
    // A label longer than its column pushes the value on.
    let indent = FACT_INDENT + width.max(label_width) + FACT_GAP;
    beside_mark(&mark, indent, value, &|line| line.to_owned()).join("\n")
}

/// The lines of a result: its heading after a blank line, then its facts as grey labels with their
/// values, like the summary of `mhfe`.
pub(crate) fn result_lines(channel: Channel, title: &str, rows: &[(&str, String)]) -> Vec<String> {
    let width = rows
        .iter()
        .map(|(label, _)| text_width(label))
        .fold(MIN_LABEL_WIDTH, usize::max);
    let mut lines = vec![format!("\n{}", heading_line(channel, title))];
    lines.extend(
        rows.iter()
            .map(|(label, value)| fact_line(channel, label, value, width)),
    );
    lines
}

/// What a notice says: news, a success after a green ✓, or a warning after a yellow !.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NoticeKind {
    /// News, grey.
    Info,
    /// A success after a green ✓.
    Success,
    /// A warning after a yellow !.
    Warning,
}

/// Running text as `channel` shows it: on a terminal wrapped to TEXT_WIDTH; for a file, a pipe or
/// TERM=dumb as it is, on one line.
fn running_lines(channel: Channel, text: &str) -> Vec<String> {
    if can_redraw(channel) {
        wrap_text(text, TEXT_WIDTH)
    } else {
        vec![text.to_owned()]
    }
}

/// Advice that can be read and passed over: wrapped on a terminal, grey wherever the stream gets
/// colour.
pub(crate) fn hint_lines(channel: Channel, message: &str) -> Vec<String> {
    running_lines(channel, message)
        .iter()
        .map(|line| paint(channel, style::MUTED, line))
        .collect()
}

/// A success or a warning after its mark, a warning in yellow, wrapped beside the mark.
pub(crate) fn marked_lines(channel: Channel, message: &str, warning: bool) -> Vec<String> {
    let (mark, code) = if warning {
        ("!", style::WARNING)
    } else {
        ("✓", style::GOOD)
    };
    let painted = move |line: &str| {
        if warning {
            paint(channel, code, line)
        } else {
            line.to_owned()
        }
    };
    beside_mark(
        &format!("{} ", paint(channel, code, mark)),
        NOTICE_MARK_WIDTH,
        message,
        &painted,
    )
}

/// The lines of a notice: for a file, a pipe or TERM=dumb the message as it is, news grey and a
/// warning yellow where CLICOLOR_FORCE gives colour; on a terminal news as a hint, a success or a
/// warning after its mark.
pub(crate) fn notice_lines(message: &str, kind: NoticeKind) -> Vec<String> {
    let channel = Channel::Error;
    match kind {
        NoticeKind::Info => hint_lines(channel, message),
        _ if can_redraw(channel) => marked_lines(channel, message, kind == NoticeKind::Warning),
        NoticeKind::Warning => vec![paint(channel, style::WARNING, message)],
        NoticeKind::Success => vec![message.to_owned()],
    }
}

/// A checked fact after a green ✓ (a yellow ! when not `good`), its value in bold.
pub(crate) fn status_line(label: &str, value: &str, good: bool) -> String {
    let channel = Channel::Error;
    let (mark, code) = if good {
        ("✓", style::GOOD)
    } else {
        ("!", style::WARNING)
    };
    // Each word of the value in bold, so that no line carries the bold over to the next.
    let bold: Vec<String> = value
        .split(' ')
        .map(|word| {
            if word.is_empty() {
                String::new()
            } else {
                paint(channel, style::STRONG, word)
            }
        })
        .collect();
    let text = format!("{label} {}", bold.join(" "));
    beside_mark(
        &format!("{} ", paint(channel, code, mark)),
        NOTICE_MARK_WIDTH,
        &text,
        &|line| line.to_owned(),
    )
    .join("\n")
}

/// An error after "✗ Error:" on a terminal, wrapped beside the mark; or after "mnemocode:" on one
/// line for a file, a pipe or TERM=dumb. The mark is red wherever the stream gets colour.
pub(crate) fn failure_line(message: &str) -> String {
    let channel = Channel::Error;
    let text = printable(message);
    if !can_redraw(channel) {
        return format!("{} {text}", paint(channel, style::BAD, "mnemocode:"));
    }
    beside_mark(
        &format!("{} ", paint(channel, style::BAD, ERROR_MARK)),
        ERROR_MARK.chars().count() + 1,
        &text,
        &|line| line.to_owned(),
    )
    .join("\n")
}

/// Writes `text` and a line break to standard error; a failure to write there has nowhere to go.
pub(crate) fn error_line(text: &str) {
    let mut bytes = String::with_capacity(text.len() + 1);
    bytes.push_str(text);
    bytes.push('\n');
    let _ignored = os::write_error(bytes.as_bytes());
}

/// Writes `text` to standard error as it is.
pub(crate) fn error_raw(text: &str) {
    let _ignored = os::write_error(text.as_bytes());
}

/// Writes `text` and a line break to standard output: a result, which a script reads.
pub(crate) fn output_line(text: &str) -> std::io::Result<()> {
    let mut bytes = String::with_capacity(text.len() + 1);
    bytes.push_str(text);
    bytes.push('\n');
    os::write_output(bytes.as_bytes())
}

/// Advice that can be read and passed over: grey, wrapped.
pub(crate) fn hint(message: &str) {
    for line in hint_lines(Channel::Error, message) {
        error_line(&line);
    }
}

/// A notice on standard error; a warning is remembered for the step screens.
pub(crate) fn notice(message: &str, kind: NoticeKind) {
    if kind == NoticeKind::Warning {
        remember_warning(message);
    }
    for line in notice_lines(message, kind) {
        error_line(&line);
    }
}

/// A result saved, after a green ✓; after a private screen it stays in the summary.
pub(crate) fn saved(message: &str) {
    private::add_summary(NoticeKind::Success, message, None);
    notice(message, NoticeKind::Success);
}

/// A warning that still holds once the command has ended; after a private screen it stays in the
/// summary, so it never holds a secret.
pub(crate) fn lasting_warning(message: &str) {
    private::add_summary(NoticeKind::Warning, message, None);
    notice(message, NoticeKind::Warning);
}

/// A checked fact after its mark (status_line), on standard error.
pub(crate) fn status(label: &str, value: &str, good: bool) {
    error_line(&status_line(label, value, good));
}

/// The address of a README section, by its heading's anchor.
pub(crate) fn readme_link(anchor: &str) -> String {
    format!("{README_URL}#{anchor}")
}

/// The grey "More:" line that points to the README section explaining the message above it; not
/// wrapped, so that a link stays whole.
pub(crate) fn more_line(anchor: &str) -> String {
    paint(
        Channel::Error,
        style::MUTED,
        &format!("More: {}", readme_link(anchor)),
    )
}

/// A warning and the README section that explains it, kept on every later step screen of the
/// command and in the summary, so it is given only about what holds for the rest of the command.
pub(crate) fn warning_with_more(message: &str, anchor: &str) {
    private::add_summary(NoticeKind::Warning, message, Some(anchor));
    let mut lines = notice_lines(message, NoticeKind::Warning);
    lines.push(more_line(anchor));
    keep_context(lines, private::Lifetime::Command);
}

/// An error after a red "✗ Error:", as `mhfe` writes it.
pub(crate) fn failure(message: &str) {
    error_line(&failure_line(message));
}

/// What a stopped command says, and its exit status: "Cancelled.", 130.
pub(crate) const CANCELLED_MESSAGE: &str = "Cancelled.";

/// Says that the command was cancelled.
pub(crate) fn cancelled() {
    hint(CANCELLED_MESSAGE);
}

/// The redraw request after a continue (SIGCONT after SIGTSTP): the alternate screen was left and
/// its content is gone, so the next step draws itself again.
static REDRAW: Mutex<bool> = Mutex::new(false);

/// Asks the next step screen to draw itself again.
pub(crate) fn request_redraw() {
    if let Ok(mut redraw) = REDRAW.lock() {
        *redraw = true;
    }
}

/// Whether a redraw was asked since the last call.
pub(crate) fn take_redraw() -> bool {
    REDRAW
        .lock()
        .map(|mut redraw| std::mem::take(&mut *redraw))
        .unwrap_or(false)
}

/// The terminal's width for wrapping a visible answer: 80 when it does not say.
pub(crate) fn columns() -> usize {
    os::terminal_size().map_or(80, |(columns, _)| usize::from(columns))
}

/// The terminal's height: a VT100's 24 rows when it does not say.
pub(crate) fn rows() -> usize {
    os::terminal_size().map_or(24, |(_, rows)| usize::from(rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_wraps_at_spaces_and_a_long_word_keeps_its_line() {
        assert_eq!(wrap_text("one two three", 7), vec!["one two", "three"]);
        assert_eq!(wrap_text("abcdefghij x", 4), vec!["abcdefghij", "x"]);
        assert_eq!(wrap_text("  ", 4), Vec::<String>::new());
    }

    #[test]
    fn colour_codes_take_no_room() {
        assert_eq!(shown_width("\x1b[1;36mMnemoCode\x1b[0m"), 9);
        assert_eq!(shown_width("的在"), 4);
    }

    #[test]
    fn a_mark_leads_the_first_line_and_spaces_the_others() {
        let text = "word ".repeat(30);
        let lines = beside_mark("! ", 2, text.trim_end(), &|line| line.to_owned());
        assert!(lines.first().is_some_and(|line| line.starts_with("! word")));
        assert!(lines.get(1).is_some_and(|line| line.starts_with("  word")));
        assert!(lines.iter().all(|line| shown_width(line) <= TEXT_WIDTH));
        assert_eq!(
            beside_mark("! ", 2, "", &|line| line.to_owned()),
            vec!["! "]
        );
    }
}
