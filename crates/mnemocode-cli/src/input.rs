//! What a command reads that may be secret: a file or standard input, read whole into a locked
//! buffer within the question's limit, strict UTF-8; and the private-screen questions, asked again
//! until the answer can be used, each refusal one warning line that never repeats what was typed.
//! Only the person leaves: Ctrl+C, Escape in a secret question, or the end of the input.

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
    /// A path, typed or given in an option, that names a network share.
    LocalFileRequired,
    /// The text is not UTF-8.
    NotUtf8(String),
    /// A signal ended the command.
    Signal,
    /// The terminal failed.
    Terminal(String),
    /// A PDF that keeps no legend line, such as one another program rewrote.
    PdfWithoutLegend,
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
                f.write_str("Use a file on this computer: a network path (//host or \\\\host) is refused.")
            }
            Self::NotUtf8(message) | Self::Terminal(message) => f.write_str(message),
            Self::Signal => f.write_str("Cancelled."),
            Self::PdfWithoutLegend => f.write_str(
                "This PDF keeps no legend that MnemoCode can read, as when another program saved it again: type the rows of its floss key instead.",
            ),
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
            Self::PdfWithoutLegend => "cli.input.pdf-without-legend",
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
        let resolved = local_resolved(Path::new(path))?;
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
    let resolved = local_resolved(path)?;
    text_of(
        os::read_secret_file(&resolved, limit, what, regular_only)?,
        what,
    )
}

pub(crate) use mnemocode_embroidery::chart::MAX_PATTERN_PDF_BYTES;

/// The legend line of the pattern PDF at `path`, or none where the file is no PDF.
///
/// # Errors
///
/// The file's refusals, and [`InputError::PdfWithoutLegend`] for a PDF that keeps no legend.
pub(crate) fn pattern_legend(path: &Path) -> Result<Option<SecretText>, InputError> {
    let resolved = local_resolved(path)?;
    if !os::file_starts_with(&resolved, b"%PDF-") {
        return Ok(None);
    }
    let pdf = os::read_large_secret_file(&resolved, MAX_PATTERN_PDF_BYTES, "The pattern's PDF")?;
    mnemocode_embroidery::chart::legend_of_pdf(&pdf)
        .map(Some)
        .ok_or(InputError::PdfWithoutLegend)
}

/// Refuses, without reading it, a file at `path` that the program cannot read, as the read would.
pub(crate) fn check_readable(path: &Path, what: &'static str) -> Result<(), InputError> {
    let resolved = local_resolved(path)?;
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
    let resolved = local_resolved(path)?;
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
    let resolved = local_resolved(path)?;
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
    // The answer may be the secret itself. Normalize inside a locked owner until
    // classification proves that an ordinary filesystem path is needed.
    let text = dropped_text(answer);
    if let Some(link) = file_link(&text) {
        return local_file_of(link).and_then(local_path).map(Some);
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
    let home = text.as_str() == "~" && terminal::environment().home.is_some();
    let named = text.contains(['/', '\\']) || extension || quoted || home;
    named.then(|| local_path(expanded_path(&text))).transpose()
}

/// `path` made absolute against the folder the program started in; a network path refused as at
/// a question, so that options and answers read only local files alike (AUD-007-DOC005).
fn local_resolved(path: &Path) -> Result<PathBuf, InputError> {
    let local = local_path(path.to_path_buf())?;
    Ok(os::resolve(
        &local,
        terminal::environment().current.as_deref(),
    ))
}

/// Check the final path after home expansion or URI decoding as well as typed separators.
fn local_path(path: PathBuf) -> Result<PathBuf, InputError> {
    if network_path(&path.to_string_lossy()) {
        return Err(InputError::LocalFileRequired);
    }
    Ok(path)
}

/// Whether `text` names a network share as Windows reads it: two separators of either kind first,
/// as in `//host`, `\\host` or `/\host`, but not the local `\\?\C:\…` or `\\.\…` forms; those and
/// `\??\` name a share only through `UNC\`.
fn network_path(text: &str) -> bool {
    let separator = |byte: u8| byte == b'/' || byte == b'\\';
    let bytes = text.as_bytes();
    let unc_after = |at: usize| {
        text.get(at..at + 3)
            .is_some_and(|word| word.eq_ignore_ascii_case("UNC"))
            && bytes.get(at + 3).copied().is_some_and(separator)
    };
    if text.starts_with("\\??\\") {
        return unc_after(4);
    }
    let [first, second, rest @ ..] = bytes else {
        return false;
    };
    if !separator(*first) || !separator(*second) {
        return false;
    }
    match rest {
        [b'?' | b'.', next, ..] if separator(*next) => unc_after(4),
        _ => true,
    }
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
    let resolved = local_resolved(&path)?;
    text_of(os::read_secret_file(&resolved, limit, what, true)?, what)
}

/// The legend line of the pattern's PDF that `answer` names as a path, where `pattern_pdf` lets an
/// answer name one; none for any other answer.
fn pattern_answer(answer: &str, pattern_pdf: bool) -> Result<Option<SecretText>, InputError> {
    if !pattern_pdf {
        return Ok(None);
    }
    match path_of_answer(answer)? {
        Some(path) => pattern_legend(&path),
        None => Ok(None),
    }
}

/// The local folder that `answer` names as a path, made absolute; none for any other answer.
pub(crate) fn folder_answer(answer: &str) -> Option<PathBuf> {
    let path = path_of_answer(answer).ok().flatten()?;
    let resolved = local_resolved(&path).ok()?;
    matches!(os::look_at_file(&resolved), Ok(os::FileLook::Folder)).then_some(resolved)
}

/// A file dragged into a terminal as its path: the quotes or backslashes a terminal adds removed,
/// and a leading ~ expanded. Backslashes on Windows separate folders and stay as typed.
pub(crate) fn dropped_path(answer: &str) -> PathBuf {
    expanded_path(&dropped_text(answer))
}

fn expanded_path(path: &str) -> PathBuf {
    let home = terminal::environment().home.as_ref();
    match (path, home) {
        ("~", Some(home)) => home.clone(),
        (path, Some(home))
            if path.starts_with("~/") || (cfg!(windows) && path.starts_with("~\\")) =>
        {
            home.join(path.get(2..).unwrap_or_default())
        }
        (path, _) => PathBuf::from(path),
    }
}

/// Remove terminal quoting without ever copying an unclassified answer into a String.
#[expect(
    clippy::expect_used,
    reason = "unquoting and unescaping never add UTF-8 bytes beyond the reserved input length"
)]
fn dropped_text(answer: &str) -> SecretText {
    let text = trim(answer);
    let quoted = ["'", "\""].iter().find_map(|quote| {
        text.strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
            .filter(|_| text.len() >= 2)
            .map(|inner| (*quote, inner))
    });
    SecretText::build("an unclassified answer", text.len(), |out| {
        match quoted {
            Some(("'", inner)) if cfg!(not(windows)) => {
                let mut parts = inner.split("'\\''");
                if let Some(first) = parts.next() {
                    out.push_str(first)?;
                }
                for part in parts {
                    out.push('\'')?;
                    out.push_str(part)?;
                }
            }
            Some((_, inner)) => out.push_str(inner)?,
            None if cfg!(windows) => out.push_str(text)?,
            None => {
                let mut characters = text.chars();
                while let Some(character) = characters.next() {
                    let character = if character == '\\' {
                        characters.next().unwrap_or(character)
                    } else {
                        character
                    };
                    out.push(character)?;
                }
            }
        }
        Ok::<_, mnemocode::secret::CapacityExceeded>(())
    })
    .expect("unquoting fits within the original byte length")
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
    /// Keep a confirmation below its first entry on the same private screen.
    pub(crate) continue_screen: bool,
    /// The prompt.
    pub(crate) prompt: String,
    /// What to type, for the line after an empty answer: "Type <what>, or press Ctrl+C to stop."
    pub(crate) what: Option<String>,
    /// The longest answer in bytes, the question's own limit.
    pub(crate) limit: usize,
    /// What a line break inside a paste becomes: a space by default.
    pub(crate) pasted_line_break: Option<u8>,
    /// Hints below the words being typed.
    pub(crate) hints: Option<&'h dyn terminal::Hints>,
    /// Whether the answer shows as it is typed: on the private screen only, for a secret.
    pub(crate) echo: bool,
    /// Accept a local text file path too; this name, never the path, appears in file refusals.
    pub(crate) text_file: Option<&'static str>,
    /// Take a pattern's PDF at such a path as the legend line it keeps.
    pub(crate) pattern_pdf: bool,
    /// Pass the path of a local folder on as it is typed, for the caller to read.
    pub(crate) folders: bool,
    /// A line above the prompt that says what the answer may be.
    pub(crate) note: Option<String>,
    /// The answer that Enter alone gives, which the prompt names.
    pub(crate) fallback: Option<String>,
}

/// Asks once and reads the answer, trimmed.
fn read_answer(ask: &Ask<'_>, secret: bool) -> Result<Reading, InputError> {
    let mut keys = Keys::open();
    let hints = terminal::InputHints::new(ask.hints, secret);
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
            hints: Some(&hints),
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
        let redrawn = !ask.continue_screen && step_begin();
        if let Some(text) = &warning
            && !redrawn
        {
            for line in notice_lines(text, NoticeKind::Warning) {
                terminal::error_line(&line);
            }
        }
        if let Some(note) = &ask.note {
            for line in notice_lines(note, NoticeKind::Info) {
                terminal::error_line(&line);
            }
        }
        let reading = read_answer(ask, secret)?;
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
                    Some(_) if ask.folders && folder_answer(&text).is_some() => Ok(text),
                    Some(name) => match pattern_answer(&text, ask.pattern_pdf) {
                        Ok(Some(line)) => Ok(line),
                        Ok(None) => answered_text(&text, name, ask.limit),
                        Err(refused) => Err(refused),
                    },
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

/// A secret question, shown as typed on the private screen only.
pub(crate) fn secret_ask<'h>(prompt: &str, what: &str, limit: usize) -> Ask<'h> {
    Ask {
        continue_screen: false,
        prompt: prompt.to_owned(),
        what: Some(what.to_owned()),
        limit,
        pasted_line_break: Some(b' '),
        hints: None,
        echo: on_private_screen(),
        text_file: None,
        pattern_pdf: false,
        folders: false,
        note: None,
        fallback: None,
    }
}

/// A question for a visible value that is no secret.
pub(crate) fn value_ask<'h>(prompt: &str, what: &str, limit: usize) -> Ask<'h> {
    Ask {
        pasted_line_break: None,
        echo: true,
        ..secret_ask(prompt, what, limit)
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
    fn inline_secrets_stay_in_protected_storage_until_path_classification() {
        for answer in [
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            "MNC1:direct:indexes:1 1 1 1 1 1 1 1 1 1 1 4",
            "ur:sskr/public-fixture",
            "a public message without a file suffix",
        ] {
            let protected = dropped_text(answer);
            assert_eq!(protected.as_str(), answer);
            assert_eq!(
                format!("{protected:?}"),
                "[an unclassified answer: redacted]"
            );
            if mnemocode::secret::probe_lock(4096) {
                assert!(protected.is_locked());
            }
            assert!(path_of_answer(answer).unwrap().is_none());
            assert_eq!(
                answered_text(answer, "The public fixture", 4096)
                    .unwrap()
                    .as_str(),
                answer
            );
        }
        assert_eq!(
            path_of_answer("'backup file.txt'").unwrap(),
            Some(PathBuf::from("backup file.txt"))
        );
        assert!(path_of_answer("one\ntwo.txt").unwrap().is_none());
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
        assert!(path_of_answer("file:////example.invalid/x.txt").is_err());
        assert!(local_path(PathBuf::from("//example.invalid/home/backup.txt")).is_err());
        assert!(local_path(PathBuf::from(r"\\example.invalid\home\backup.txt")).is_err());
    }

    // AUD-007-DOC005: every form Windows reads as a share, and none of its local long forms.
    #[test]
    fn network_paths_are_told_from_local_long_forms() {
        for share in [
            "//host/share/a.txt",
            r"\\host\share\a.txt",
            r"/\host\share\a.txt",
            r"\/host/share/a.txt",
            r"\\?\UNC\host\share\a.txt",
            r"//./unc/host/share/a.txt",
            r"\??\UNC\host\share\a.txt",
        ] {
            assert!(network_path(share), "{share}");
        }
        for local in [
            r"\\?\C:\backup\a.txt",
            r"\\.\C:\backup\a.txt",
            r"\??\C:\a.txt",
            r"C:\backup\a.txt",
            "/home/a.txt",
            r"\backup\a.txt",
            "a.txt",
            "/",
        ] {
            assert!(!network_path(local), "{local}");
        }
    }

    // AUD-007-DOC005: a file option names a network path as a typed answer does, and is refused.
    #[test]
    fn an_option_naming_a_network_path_is_refused_as_an_answer_is() {
        for path in [
            "//example.invalid/share/backup.txt",
            r"\\example.invalid\share\backup.txt",
        ] {
            assert!(matches!(
                read_input_text(path, "The backup file", 64),
                Err(InputError::LocalFileRequired)
            ));
            assert!(matches!(
                read_qr_bytes(Path::new(path), false),
                Err(InputError::LocalFileRequired)
            ));
            assert!(matches!(
                read_picture(Path::new(path)),
                Err(InputError::LocalFileRequired)
            ));
        }
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
