//! The files and folders that the questions name for saving (MnemoCode TS 0.1.0's
//! `cli/output-questions.ts`): a new file or folder to write, checked at once where it can be
//! written, each claimed for one task of an entry so that a second task cannot take its place.

use std::fmt;
use std::sync::{Mutex, MutexGuard, PoisonError};

use mnemocode::refusal::Refusal;

use super::given::PATH_LIMIT;
use super::resolved;
use crate::gate::Stop;
use crate::input::dropped_path;
use crate::os::{self, FileLook};
use crate::output::{OutputError, check_new_file, check_new_folder, paths_overlap};
use crate::terminal::{Chosen, LineQuestion, ask_line};

/// What the limits of a file are named in.
const MEBIBYTE: usize = 1024 * 1024;

/// Why a typed name cannot be used.
#[derive(Debug)]
pub(crate) enum NameError {
    Taken,
    Dash,
    Blank,
    Option,
    Output(OutputError),
    NoSuchFile,
    CannotLook,
    Folder,
    NoFile,
    MayNotRead,
    TooLarge(usize),
}

impl fmt::Display for NameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Taken => {
                "Another file of this task has this name or this folder; choose another one."
            }
            Self::Dash => "- is no file name here; type the name of a file.",
            Self::Blank => {
                "That name is blank; type a name, or press Enter alone for the one shown."
            }
            Self::Option => {
                "A name that starts with - would be read as an option; type ./ before it."
            }
            Self::NoSuchFile => "There is no such file; check its name and its folder.",
            Self::CannotLook => {
                "MnemoCode cannot look at that file; check that it may read the file and its folders."
            }
            Self::Folder => "That is a folder; type the name of a file in it.",
            Self::NoFile => "That is no ordinary file; type the name of the file.",
            Self::MayNotRead => "MnemoCode may not read that file.",
            Self::TooLarge(limit) => {
                return write!(
                    f,
                    "That file is larger than {} MiB; it cannot be the one.",
                    limit / MEBIBYTE
                );
            }
            Self::Output(error) => return error.fmt(f),
        })
    }
}

impl std::error::Error for NameError {}

impl Refusal for NameError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoSuchFile => "cli.output-questions.there-no-such-file-check-name-folder",
            Self::CannotLook => "cli.output-questions.file-cannot-be-looked-at",
            Self::Folder => "cli.output-questions.folder-type-name-file",
            Self::NoFile => "cli.output-questions.no-ordinary-file-type-name-file",
            Self::MayNotRead => "cli.output-questions.mnemo-code-may-not-read-file",
            Self::TooLarge(_) => "cli.output-questions.file-larger-than-cannot-one",
            Self::Taken => "cli.output-questions.another-file-task-name-folder-choose-another-one",
            Self::Dash => "cli.output-questions.dash-path-refused",
            Self::Blank => "cli.output-questions.blank-path-refused",
            Self::Option => "cli.output-questions.name-starts-would-read-as-option-type-before",
            Self::Output(error) => error.code(),
        }
    }
}

/// The files and folders that the answers of the entry being asked name for saving: one record for
/// the process, as the numbered names are.
static CLAIMED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The record; a poisoned lock holds names, which stay usable.
fn claimed() -> MutexGuard<'static, Vec<String>> {
    CLAIMED.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Forgets the files and folders that an earlier entry, or an earlier backup, claimed.
pub(crate) fn forget_claimed() {
    claimed().clear();
}

/// Claims `path`, a file that the task reads, so that no file it saves is given its name, which the
/// command would refuse.
pub(crate) fn claim_read(path: &str) {
    claimed().push(path.to_owned());
}

/// A typed file or folder name as the file system knows it. A name that the command line would read
/// as something else is refused: - stands for standard input or output there, and a name that starts
/// with - for an option. So is a blank one: as a path it would be the current folder.
fn typed_path(answer: &str) -> Result<String, NameError> {
    let path = dropped_path(answer).to_string_lossy().into_owned();
    if path == "-" {
        return Err(NameError::Dash);
    }
    if path.trim().is_empty() {
        return Err(NameError::Blank);
    }
    if path.starts_with('-') {
        return Err(NameError::Option);
    }
    Ok(path)
}

/// A file to read, checked without reading it: it exists, is a file and may be read, and it is no
/// larger than the command reads. What is in it only the command can tell.
pub(crate) fn input_file(answer: &str, limit: usize) -> Result<String, NameError> {
    let path = typed_path(answer)?;
    match os::look_at_file(&resolved(&path)) {
        Ok(FileLook::Nothing) => Err(NameError::NoSuchFile),
        Err(_) => Err(NameError::CannotLook),
        Ok(FileLook::Folder) => Err(NameError::Folder),
        Ok(FileLook::NoFile) => Err(NameError::NoFile),
        Ok(FileLook::File {
            readable: false, ..
        }) => Err(NameError::MayNotRead),
        Ok(FileLook::File { bytes, .. }) if bytes > limit as u64 => Err(NameError::TooLarge(limit)),
        Ok(FileLook::File { .. }) => Ok(path),
    }
}

/// Asks with `check` for a name, `fallback` by default, claimed once it passes; none when the person
/// goes back with Escape.
fn ask_claimed(
    question: &str,
    label: &str,
    fallback: &str,
    check: impl Fn(&str) -> Result<(), OutputError>,
) -> Result<Option<String>, Stop> {
    let how = LineQuestion {
        fallback: Some(fallback),
        limit: PATH_LIMIT,
        ..LineQuestion::default()
    };
    let answer = ask_line(question, label, how, |answer: &str| {
        let path = typed_path(answer)?;
        // Checked first, as it says the most: the command would refuse the pair.
        if claimed()
            .iter()
            .any(|earlier| paths_overlap(earlier, &path))
        {
            return Err(NameError::Taken);
        }
        check(&path).map_err(NameError::Output)?;
        claimed().push(path.clone());
        Ok(path)
    })?;
    match answer {
        Chosen::One(path) => Ok(Some(path)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// Asks for the name of a file to save, `fallback` by default, until it can be used: its folder
/// exists and may be written, and the name is no folder. A file of that name may exist: the command
/// saves under the next numbered name. None when the person goes back with Escape.
pub(crate) fn ask_output_file(question: &str, fallback: &str) -> Result<Option<String>, Stop> {
    ask_claimed(question, "File", fallback, |path| {
        check_new_file(path, true)
    })
}

/// Asks for the name of a new folder to save into, `fallback` by default, until it can be used.
pub(crate) fn ask_new_folder(fallback: &str) -> Result<Option<String>, Stop> {
    ask_claimed(
        "Name of the new folder",
        "Folder",
        fallback,
        check_new_folder,
    )
}
