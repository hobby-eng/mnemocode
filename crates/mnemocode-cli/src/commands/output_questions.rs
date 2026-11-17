//! The files and folders that a task saves: every one in one folder, asked once, the first time
//! something is saved, the folder MnemoCode started in by default. Each takes its usual name, or
//! the next numbered one, and is claimed for the task so that no second file takes its place.

use std::fmt;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use mnemocode::refusal::Refusal;

use super::given::PATH_LIMIT;
use super::resolved;
use crate::gate::Stop;
use crate::input::dropped_path;
use crate::os::{self, FileLook};
use crate::output::{OutputError, check_new_file, check_new_folder, numbered_name, paths_overlap};
use crate::terminal::{self, Chosen, LineQuestion, ask_line};

/// What the limits of a file are named in.
const MEBIBYTE: usize = 1024 * 1024;

/// Why a typed name cannot be used.
#[derive(Debug)]
pub(crate) enum NameError {
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
    /// The folder for the files does not exist.
    NoSuchFolder,
    /// The folder for the files is a file.
    NotAFolder,
    /// The folder for the files may not be written.
    FolderUnwritable,
}

impl fmt::Display for NameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
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
            Self::NoSuchFolder => "There is no such folder; type the name of one that exists.",
            Self::NotAFolder => "That is no folder; type the name of a folder.",
            Self::FolderUnwritable => "MnemoCode may not write in that folder; choose another one.",
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
            Self::Dash => "cli.output-questions.dash-path-refused",
            Self::Blank => "cli.output-questions.blank-path-refused",
            Self::Option => "cli.output-questions.name-starts-would-read-as-option-type-before",
            Self::NoSuchFolder => "cli.output-questions.no-such-folder",
            Self::NotAFolder => "cli.output-questions.not-a-folder",
            Self::FolderUnwritable => "cli.output-questions.folder-unwritable",
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

/// The folder that every file of the task goes to, once it is asked.
static FOLDER: Mutex<Option<String>> = Mutex::new(None);

/// The folder; a poisoned lock holds a name, which stays usable.
fn chosen_folder() -> MutexGuard<'static, Option<String>> {
    FOLDER.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Forgets the files and folders that an earlier entry, or an earlier backup, claimed, and the
/// folder it saved in.
pub(crate) fn forget_claimed() {
    claimed().clear();
    chosen_folder().take();
}

/// What the task has claimed at a step of its questions, to go back to.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Claims {
    names: usize,
    folder: bool,
}

/// What the task has claimed now.
pub(crate) fn claims_now() -> Claims {
    Claims {
        names: claimed().len(),
        folder: chosen_folder().is_some(),
    }
}

/// Gives back what the task claimed after `at`: the names, and the folder where it was asked
/// since, so that a step asked again finds them free.
pub(crate) fn claims_back_to(at: Claims) {
    claimed().truncate(at.names);
    if !at.folder {
        chosen_folder().take();
    }
}

/// Whether the folder of the task's files was asked already.
pub(crate) fn folder_chosen() -> bool {
    chosen_folder().is_some()
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

/// What the question of the folder says above it.
const SAVED_HERE: &str = "Every file of this task is saved in this folder. Files already in it are never replaced: a new file whose name is taken gets a number at the end, such as cross-stitch-pattern_1.pdf.";

/// The folder that every file of the task goes to: asked once, the folder MnemoCode started in by
/// default; none when the person goes back.
fn task_folder() -> Result<Option<String>, Stop> {
    if let Some(folder) = chosen_folder().clone() {
        return Ok(Some(folder));
    }
    let here = terminal::environment().current.as_ref().map_or_else(
        || ".".to_owned(),
        |path| path.to_string_lossy().into_owned(),
    );
    let how = LineQuestion {
        fallback: Some(&here),
        what: Some("the name of a folder that exists"),
        note: Some(SAVED_HERE),
        limit: PATH_LIMIT,
        ..LineQuestion::default()
    };
    let answer = ask_line("Folder for the files", "Folder", how, |answer: &str| {
        let path = typed_path(answer)?;
        let folder = resolved(&path);
        match os::look_at_file(&folder) {
            Ok(FileLook::Folder) if os::may_write(&folder) => Ok(path),
            Ok(FileLook::Folder) => Err(NameError::FolderUnwritable),
            Ok(FileLook::Nothing) => Err(NameError::NoSuchFolder),
            _ => Err(NameError::NotAFolder),
        }
    })?;
    match answer {
        Chosen::One(folder) => {
            *chosen_folder() = Some(folder.clone());
            Ok(Some(folder))
        }
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// `name` in the task's folder, or its first numbered name that no other file of the task takes,
/// claimed once `check` passes it; none when the person goes back from the folder's question.
fn claimed_in_folder(
    name: &str,
    folder: bool,
    check: impl Fn(&str) -> Result<(), OutputError>,
) -> Result<Option<String>, Stop> {
    let Some(place) = task_folder()? else {
        return Ok(None);
    };
    let first = Path::new(&place).join(name).to_string_lossy().into_owned();
    let mut number = 0;
    loop {
        let path = if number == 0 {
            first.clone()
        } else {
            numbered_name(&first, number, folder)
        };
        if !claimed()
            .iter()
            .any(|earlier| paths_overlap(earlier, &path))
        {
            match check(&path) {
                Ok(()) => {
                    claimed().push(path.clone());
                    return Ok(Some(path));
                }
                Err(error) if number >= MAX_NUMBERED => return Err(NameError::Output(error).into()),
                // A name that cannot be used there, such as a folder of that name: the next one.
                Err(_) => {}
            }
        }
        number += 1;
    }
}

/// The most numbered names tried for one file before its refusal is said.
const MAX_NUMBERED: usize = 99;

/// A file to save, `name` in the task's folder. A file of that name may exist: the command saves
/// under the next numbered name. None when the person goes back.
pub(crate) fn output_file(name: &str) -> Result<Option<String>, Stop> {
    claimed_in_folder(name, false, |path| check_new_file(path, true))
}

/// A new folder to save into, `name` in the task's folder; the command numbers it where one is
/// there already. None when the person goes back.
pub(crate) fn new_folder(name: &str) -> Result<Option<String>, Stop> {
    claimed_in_folder(name, true, check_new_folder)
}
