//! What a command reads that may be secret (MnemoCode TS 0.1.0's `text-file.ts`, `ask.ts`): a file
//! or standard input, read whole within the limit of the question it answers into a locked buffer,
//! strict UTF-8; and the questions on the private screen, asked again until their answer can be
//! used, each refusal one warning line that never repeats what was typed. Only the person leaves: Ctrl+C, Escape in
//! a secret question, or the end of the input.

use std::path::{Path, PathBuf};

use mnemocode::qr::admission::MAX_PNG_BYTES;
use mnemocode::refusal::Refusal;
use mnemocode::secret::{SecretBytes, SecretText};
use mnemocode::text::space::trim;
use mnemocode::text::utf8::strict_utf8;
use mnemocode::text::widths::text_width;

use crate::os::{self, FileError};
use crate::terminal::{
    self, Keys, LineOptions, LineOutcome, NoticeKind, error_raw, notice_lines, on_private_screen,
    read_line, remember_warning, step_begin, terminal_available, type_hint, write_prompt,
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
    Signal,
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
            Self::Signal => f.write_str("Cancelled."),
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
            Self::Signal => "cli.signal",
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
            terminal::Interrupted::Signal(_) => Self::Signal,
            terminal::Interrupted::Failed(error) => Self::Terminal(error.to_string()),
        }
    }
}

/// The scheme of a link to a file.
const FILE_SCHEME: &str = "file:";

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
        let resolved = os::resolve(Path::new(path), terminal::environment().current.as_deref());
        os::read_secret_file(&resolved, limit, what, false)?
    };
    let name = if path == "-" {
        STANDARD_INPUT_NAME
    } else {
        what
    };
    text_of(bytes, name)
}

/// The text of a local file at `path`, at most `limit` bytes of strict UTF-8. A name typed at a
/// question is read `regular_only`: a pipe without a writer would hold the question and Ctrl+C
/// (AUD-039-API002), where an option may name a pipe that a script writes.
pub(crate) fn read_input_path(
    path: &Path,
    what: &'static str,
    limit: usize,
    regular_only: bool,
) -> Result<SecretText, InputError> {
    let resolved = os::resolve(path, terminal::environment().current.as_deref());
    text_of(
        os::read_secret_file(&resolved, limit, what, regular_only)?,
        what,
    )
}

/// Refuses, without reading it, a file at `path` that the program cannot read, as the read would.
pub(crate) fn check_readable(path: &Path, what: &'static str) -> Result<(), InputError> {
    let resolved = os::resolve(path, terminal::environment().current.as_deref());
    match os::look_at_file(&resolved) {
        Ok(
            os::FileLook::Nothing
            | os::FileLook::File {
                readable: false, ..
            },
        )
        | Err(_) => Err(os::FileError::Unreadable(what).into()),
        Ok(_) => Ok(()),
    }
}

/// The bytes of the PNG file of a QR code at `path`, for the library's strict reader; a name
/// typed at a question is read `regular_only`, as by [`read_input_path`].
pub(crate) fn read_qr_bytes(path: &Path, regular_only: bool) -> Result<SecretBytes, InputError> {
    let resolved = os::resolve(path, terminal::environment().current.as_deref());
    Ok(os::read_secret_file(
        &resolved,
        MAX_PNG_BYTES,
        "The QR PNG input",
        regular_only,
    )?)
}

/// The picture of a pattern at `path`, a regular file of at most
/// [`mnemocode_embroidery::picture::MAX_FILE_BYTES`]; no secret, so read without a lock.
pub(crate) fn read_picture(path: &Path) -> Result<Vec<u8>, InputError> {
    let resolved = os::resolve(path, terminal::environment().current.as_deref());
    Ok(os::read_public_file(
        &resolved,
        mnemocode_embroidery::picture::MAX_FILE_BYTES,
        "The picture",
    )?)
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

/// What follows the scheme of a file: link, in any case.
fn file_link(text: &str) -> Option<&str> {
    let scheme = text.get(..FILE_SCHEME.len())?;
    scheme
        .eq_ignore_ascii_case(FILE_SCHEME)
        .then(|| text.get(FILE_SCHEME.len()..))
        .flatten()
}

/// The path of a file: link, as a URL reads it: without a host, or with this computer's name.
fn local_file_of(link: &str) -> Result<PathBuf, InputError> {
    let path = match link.strip_prefix("//") {
        Some(rest) => {
            let (host, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
            if !host.is_empty() && !host.eq_ignore_ascii_case("localhost") {
                return Err(InputError::LocalFileRequired);
            }
            path.to_owned()
        }
        None if link.starts_with('/') => link.to_owned(),
        None => format!("/{link}"),
    };
    let decoded = percent_decoded(&path);
    // A drive's path follows the slash of the URL: file:///C:/backup.txt.
    let drive = cfg!(windows) && decoded.as_bytes().get(2) == Some(&b':');
    Ok(PathBuf::from(if drive {
        decoded.trim_start_matches('/').to_owned()
    } else {
        decoded
    }))
}

/// The path an answer names: one with a separator, an extension or enclosing quotes; ./ names a
/// bare filename. A URI other than a local file's is text, ur:sskr/ among them.
fn path_of_answer(answer: &str) -> Result<Option<PathBuf>, InputError> {
    if answer.contains(['\r', '\n']) {
        return Ok(None);
    }
    let path = dropped_path(answer);
    let text = path.to_string_lossy();
    if let Some(link) = file_link(&text) {
        return local_file_of(link).map(Some);
    }
    let scheme = text.split_once(':').is_some_and(|(scheme, _)| {
        let mut letters = scheme.chars();
        letters
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
            && letters.all(|letter| letter.is_ascii_alphanumeric() || "+.-".contains(letter))
    });
    let drive = text.as_bytes().get(1) == Some(&b':')
        && matches!(text.as_bytes().get(2), Some(b'/' | b'\\'));
    if scheme && !drive {
        return Ok(None);
    }
    if text.starts_with("//") || text.starts_with("\\\\") {
        return Err(InputError::LocalFileRequired);
    }
    let extension = text
        .rsplit_once('.')
        .is_some_and(|(_, end)| !end.is_empty() && !end.contains(char::is_whitespace));
    let quoted = {
        let trimmed = trim(answer);
        trimmed.len() >= 2
            && ["'", "\""]
                .iter()
                .any(|quote| trimmed.starts_with(quote) && trimmed.ends_with(quote))
    };
    let named = text.contains(['/', '\\']) || extension || quoted;
    Ok(named.then_some(path))
}

/// `text` with its %XX escapes undone.
fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let escape = (bytes[at] == b'%')
            .then(|| text.get(at + 1..at + 3))
            .flatten()
            .and_then(|digits| u8::from_str_radix(digits, 16).ok());
        match escape {
            Some(byte) => {
                out.push(byte);
                at += 3;
            }
            None => {
                out.push(bytes[at]);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The text of one private answer: inline text, or one local regular UTF-8 file within `limit`.
/// File contents are never read as another path, and never printed here; a refusal holds no input.
pub(crate) fn answered_text(
    answer: &str,
    what: &'static str,
    limit: usize,
) -> Result<SecretText, InputError> {
    let Some(path) = path_of_answer(answer)? else {
        return Ok(SecretText::copy_of("an answer", answer));
    };
    let resolved = os::resolve(&path, terminal::environment().current.as_deref());
    text_of(os::read_secret_file(&resolved, limit, what, true)?, what)
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
    /// Accept a local text file path too; this name, never the path, appears in file refusals.
    pub(crate) text_file: Option<&'static str>,
    /// The answer that Enter alone gives, which the prompt names.
    pub(crate) fallback: Option<String>,
}

/// Asks once and reads the answer, trimmed.
fn read_answer(ask: &Ask<'_>) -> Result<Reading, InputError> {
    let mut keys = Keys::open();
    let shown = format!("{} ", ask.prompt);
    write_prompt(&shown);
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
        LineOutcome::Refused { reason, .. } => Reading::Unusable(reason.message()),
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
            Reading::Empty => match ask.fallback.as_deref().map(&mut parse) {
                Some(Ok(accepted)) => {
                    terminal::answer_accepted();
                    return Ok(Ok(accepted));
                }
                Some(Err(error)) => warning = Some(error.to_string()),
                None => warning = Some(type_hint(ask.what.as_deref(), leave)),
            },
            Reading::Answer(text) => {
                let read = match ask.text_file {
                    Some(name) => answered_text(&text, name, ask.limit),
                    None => Ok(text),
                };
                match read.map(|text| parse(&text).map_err(|error| error.to_string())) {
                    Ok(Ok(accepted)) => {
                        terminal::answer_accepted();
                        return Ok(Ok(accepted));
                    }
                    Ok(Err(reason)) => warning = Some(reason),
                    Err(error) => warning = Some(error.to_string()),
                }
            }
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
        text_file: None,
        fallback: None,
    }
}

/// A question for a visible value that is no secret.
pub(crate) fn value_ask<'h>(prompt: &str, what: &str, limit: usize) -> Ask<'h> {
    Ask {
        prompt: prompt.to_owned(),
        what: Some(what.to_owned()),
        limit,
        pasted_line_break: None,
        hints: None,
        echo: true,
        text_file: None,
        fallback: None,
    }
}

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
    fn a_file_link_is_read_as_a_url_reads_it() {
        let path = |answer: &str| path_of_answer(answer).ok().flatten();
        assert_eq!(path("file:/x/a.txt"), Some(PathBuf::from("/x/a.txt")));
        assert_eq!(
            path("FILE:///x/a%20b.txt"),
            Some(PathBuf::from("/x/a b.txt"))
        );
        assert_eq!(
            path("file://localhost/x.txt"),
            Some(PathBuf::from("/x.txt"))
        );
        assert!(path_of_answer("file://example.invalid/x.txt").is_err());
    }

    #[test]
    fn an_answer_of_other_scripts_is_cut_nowhere() {
        for answer in ["файл", "файл.txt", "的的的 的", "fil\u{e9}", "file:\u{e9}"] {
            let _read = path_of_answer(answer);
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
