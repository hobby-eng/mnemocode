//! What a command reads that may be secret (MnemoCode TS 0.1.0's `text-file.ts`, `ask.ts`): a file
//! or standard input, read whole within the limit of the question it answers into a locked buffer,
//! strict UTF-8; and the questions on the private screen, asked again until their answer can be
//! used, each refusal one warning line that never repeats what was typed. Only the person leaves: Ctrl+C, Escape in
//! a secret question, or the end of the input.

use std::path::PathBuf;

use mnemocode::refusal::Refusal;
use mnemocode::secret::{SecretBytes, SecretText};
use mnemocode::text::space::trim;
use mnemocode::text::utf8::strict_utf8;
use mnemocode::text::widths::text_width;

use crate::os::{self, FileError};
use crate::terminal::{
    self, Channel, Keys, LineOptions, LineOutcome, NoticeKind, error_raw, notice, notice_lines,
    on_private_screen, read_line, remember_warning, step_begin, terminal_available,
};

/// Where a secret can come from without a terminal, as the refusals of a question say it.
pub(crate) const SECRET_SOURCE_ADVICE: &str = "read the secret from a protected local file (--mnemonic-file, --input-file or --share-file) or from standard input (-)";

/// What standard input is called when it is read for a file option given as "-".
const STANDARD_INPUT_NAME: &str = "Text input";

/// Why a question or a file could not give its answer.
#[derive(Debug)]
pub(crate) enum InputError {
    /// No terminal to ask on.
    NoTerminal,
    /// A terminal of the type "dumb", which cannot draw the private screen.
    DumbTerminal,
    /// A file could not be read.
    File(FileError),
    /// A typed path is no local file.
    LocalFileRequired,
    /// The text is not UTF-8.
    NotUtf8(String),
    /// A signal ended the command.
    Signal(os::Signal),
    /// The terminal failed.
    Terminal(String),
}

impl std::fmt::Display for InputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoTerminal => write!(
                f,
                "--ask-secrets needs a terminal on standard input and standard error. Run the command in a terminal, or {SECRET_SOURCE_ADVICE}."
            ),
            Self::DumbTerminal => write!(
                f,
                "--ask-secrets needs a terminal that can clear its screen; this one says TERM=dumb. Run the command in another terminal, set TERM (such as TERM=xterm-256color), or {SECRET_SOURCE_ADVICE}."
            ),
            Self::File(error) => error.fmt(f),
            Self::LocalFileRequired => {
                f.write_str("Use a local text file path or type the text itself.")
            }
            Self::NotUtf8(message) | Self::Terminal(message) => f.write_str(message),
            Self::Signal(_) => f.write_str("Cancelled."),
        }
    }
}

impl std::error::Error for InputError {}

impl Refusal for InputError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoTerminal => "cli.ask.ask-secrets-terminal-on-standard-input-standard-error",
            Self::DumbTerminal => "cli.ask.run-command-another-terminal-set-term-such-as",
            Self::File(error) => error.code(),
            Self::LocalFileRequired => "cli.text-file.local-file-required",
            Self::NotUtf8(_) => "not-utf8",
            Self::Signal(_) => "cli.signal",
            Self::Terminal(_) => "cli.terminal",
        }
    }
}

impl From<FileError> for InputError {
    fn from(error: FileError) -> Self {
        Self::File(error)
    }
}

impl From<terminal::Interrupted> for InputError {
    fn from(interrupted: terminal::Interrupted) -> Self {
        match interrupted {
            terminal::Interrupted::Signal(signal) => Self::Signal(signal),
            terminal::Interrupted::Failed(error) => Self::Terminal(error.to_string()),
        }
    }
}

/// The text of a file option: the file at `path`, or standard input for "-", at most `limit`
/// bytes of strict UTF-8, into a locked buffer; `what` names it in a refusal. A byte order mark and
/// line breaks are kept for the caller's own rule.
pub(crate) fn read_input_text(
    path: &str,
    what: &'static str,
    limit: usize,
) -> Result<SecretText, InputError> {
    let bytes = if path == "-" {
        read_standard_input(limit)?
    } else {
        let resolved = os::resolve(
            &dropped_path(path),
            terminal::environment().current.as_deref(),
        );
        os::read_secret_file(&resolved, limit, what, false)?
    };
    let name = if path == "-" {
        STANDARD_INPUT_NAME
    } else {
        what
    };
    text_of(bytes, name)
}

/// Standard input, read to its end within `limit`.
fn read_standard_input(limit: usize) -> Result<SecretBytes, InputError> {
    struct Standard;
    impl std::io::Read for Standard {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            os::read_input(buffer)
        }
    }
    Ok(os::read_bounded(
        &mut Standard,
        4096,
        limit,
        STANDARD_INPUT_NAME,
    )?)
}

/// `bytes` as strict UTF-8 text, refused naming `what`; the bytes are wiped either way.
fn text_of(bytes: SecretBytes, what: &str) -> Result<SecretText, InputError> {
    if let Err(error) = strict_utf8(&bytes, "The text") {
        let _unused = error;
        return Err(InputError::NotUtf8(mnemocode::text::utf8::not_utf8_text(
            what,
        )));
    }
    SecretText::from_bytes(bytes)
        .map_err(|_| InputError::NotUtf8(mnemocode::text::utf8::not_utf8_text(what)))
}

/// A file dragged into a terminal as its path: the quotes or backslashes a terminal adds removed,
/// and a leading ~ expanded. Backslashes on Windows separate folders and stay as typed.
pub(crate) fn dropped_path(answer: &str) -> PathBuf {
    let text = trim(answer);
    let quoted = ["'", "\""].iter().find_map(|quote| {
        text.strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
            .filter(|_| text.len() >= 2)
            .map(|inner| (*quote, inner))
    });
    let path = match quoted {
        Some(("'", inner)) if cfg!(not(windows)) => inner.replace("'\\''", "'"),
        Some((_, inner)) => inner.to_owned(),
        None if cfg!(windows) => text.to_owned(),
        None => unescape(text),
    };
    let home = terminal::environment().home.clone();
    match (path.as_str(), home) {
        ("~", Some(home)) => home,
        (path, Some(home))
            if path.starts_with("~/") || (cfg!(windows) && path.starts_with("~\\")) =>
        {
            home.join(path.get(2..).unwrap_or_default())
        }
        (path, _) => PathBuf::from(path),
    }
}

/// A shell's backslash escapes undone: each backslash keeps the character after it.
fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars();
    while let Some(character) = characters.next() {
        if character == '\\'
            && let Some(next) = characters.next()
        {
            out.push(next);
            continue;
        }
        out.push(character);
    }
    out
}

/// Refuses a question without a terminal, before the terminal is touched.
pub(crate) fn assert_terminal() -> Result<(), InputError> {
    if terminal_available() {
        return Ok(());
    }
    if terminal::terminals_attached() {
        return Err(InputError::DumbTerminal);
    }
    Err(InputError::NoTerminal)
}

/// What one reading of a question gave.
enum Reading {
    Answer(SecretText),
    Empty,
    Back,
    Unusable(String),
    Ended,
    Cancelled,
}

/// How a question is read.
pub(crate) struct Ask<'h> {
    /// The prompt.
    pub(crate) prompt: String,
    /// What to type, for the line after an empty answer: "Type <what>, or press Ctrl+C to stop."
    pub(crate) what: Option<String>,
    /// The longest answer in bytes (the owner's per-question limits).
    pub(crate) limit: usize,
    /// What a line break inside a paste becomes: a space by default.
    pub(crate) pasted_line_break: Option<u8>,
    /// Hints below the words being typed.
    pub(crate) hints: Option<&'h dyn terminal::Hints>,
    /// Whether the answer shows as it is typed: on the private screen only, for a secret.
    pub(crate) echo: bool,
}

/// Asks once and reads the answer, trimmed.
fn read_answer(ask: &Ask<'_>) -> Result<Reading, InputError> {
    let mut keys = Keys::open();
    let shown = format!("{} ", ask.prompt);
    error_raw(&shown);
    let outcome = read_line(
        &mut keys,
        &LineOptions {
            echo: ask.echo,
            limit: ask.limit,
            escape_goes_back: true,
            prompt_width: text_width(&shown),
            pasted_line_break: ask.pasted_line_break,
            hints: ask.hints,
        },
    );
    // The terminal did not show the Enter key either.
    error_raw("\n");
    Ok(match outcome? {
        LineOutcome::Answer(bytes) => {
            let text =
                SecretText::from_bytes(bytes).map_err(|_| InputError::NotUtf8(String::new()))?;
            let trimmed = trim(&text);
            if trimmed.is_empty() {
                Reading::Empty
            } else {
                Reading::Answer(SecretText::copy_of("an answer", trimmed))
            }
        }
        LineOutcome::Ended => Reading::Ended,
        LineOutcome::Back { .. } => Reading::Back,
        LineOutcome::Cancelled => Reading::Cancelled,
        LineOutcome::Refused(reason) => Reading::Unusable(reason.message()),
    })
}

/// How a question ended without an answer it accepted.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Left {
    /// Escape, at a visible value: back to where it was asked from.
    Back,
    /// Ctrl+C, Escape at a secret, or the end of the input.
    Cancelled,
}

/// The line after an empty answer.
fn type_hint(what: Option<&str>, leave: &str) -> String {
    let what = what.unwrap_or("an answer");
    format!("Type {what}, or press Ctrl+C to {leave}.")
}

/// Asks `ask` until `parse` accepts the answer, each refusal shown as one warning before the
/// question comes again. `secret` questions are cancelled by Escape; visible ones go back.
pub(crate) fn ask_until<T, E: std::fmt::Display>(
    ask: &Ask<'_>,
    secret: bool,
    mut parse: impl FnMut(&str) -> Result<T, E>,
) -> Result<Result<T, Left>, InputError> {
    assert_terminal()?;
    let mut warning: Option<String> = None;
    loop {
        if let Some(text) = &warning {
            remember_warning(text);
        }
        let redrawn = step_begin();
        if let Some(text) = &warning
            && !redrawn
        {
            for line in notice_lines(text, NoticeKind::Warning) {
                terminal::error_line(&line);
            }
        }
        let reading = read_answer(ask)?;
        let leave = if secret { "stop" } else { "go back" };
        match reading {
            Reading::Ended | Reading::Cancelled => return Ok(Err(Left::Cancelled)),
            Reading::Back if secret => return Ok(Err(Left::Cancelled)),
            Reading::Back => return Ok(Err(Left::Back)),
            Reading::Unusable(reason) => warning = Some(reason),
            Reading::Empty => warning = Some(type_hint(ask.what.as_deref(), leave)),
            Reading::Answer(text) => match parse(&text) {
                Ok(accepted) => {
                    terminal::answer_accepted();
                    return Ok(Ok(accepted));
                }
                Err(error) => warning = Some(error.to_string()),
            },
        }
    }
}

/// A secret question as `ask_until` asks it: shown as typed on the private screen only, "(Esc
/// cancels)" after its prompt.
pub(crate) fn secret_ask<'h>(prompt: &str, what: &str, limit: usize) -> Ask<'h> {
    Ask {
        prompt: format!("{prompt} (Esc cancels)"),
        what: Some(what.to_owned()),
        limit,
        pasted_line_break: Some(b' '),
        hints: None,
        echo: on_private_screen(),
    }
}

/// A warning line now, outside the step screens.
pub(crate) fn warn(message: &str) {
    notice(message, NoticeKind::Warning);
}

/// The channel questions are drawn on.
pub(crate) const QUESTIONS: Channel = Channel::Error;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dragged_path_loses_what_the_terminal_added() {
        assert_eq!(
            dropped_path("'/tmp/a b.txt'"),
            PathBuf::from("/tmp/a b.txt")
        );
        assert_eq!(dropped_path("\"/x/y\""), PathBuf::from("/x/y"));
        if cfg!(not(windows)) {
            assert_eq!(dropped_path("/x/a\\ b"), PathBuf::from("/x/a b"));
            assert_eq!(dropped_path("'it'\\''s'"), PathBuf::from("it's"));
        }
    }

    #[test]
    fn an_empty_answer_says_what_to_type() {
        assert_eq!(
            type_hint(Some("the seed phrase"), "stop"),
            "Type the seed phrase, or press Ctrl+C to stop."
        );
    }
}
