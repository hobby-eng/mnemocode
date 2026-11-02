//! Saving a result that is on the screen already (MnemoCode TS 0.1.0's `cli/save-retry.ts` and
//! `output-saving.ts`), through one path for every command: on the private screen a failure, a full
//! disk or a folder taken meanwhile, keeps the result: one line says why, in plain words for the
//! usual errors of a file system, another names each file or folder that the failed save left
//! behind to delete, and the person tries again, gives another name, which is checked first and,
//! once the result is saved there, warned of when a cloud service copies its folder, or skips that
//! result. Elsewhere the failure ends the command, as every failure there does.

use std::io;
use std::path::Path;

use mnemocode::text::words::lower_first;

use super::asking::{AfterFailure, WHAT_NOW, after_failure, value_until};
use super::given::PATH_LIMIT;
use crate::args::{FOLDER_OUTPUTS, Given, Parsed, value};
use crate::gate::Stop;
use crate::input::dropped_path;
use crate::os::{FileError, Folder, pending_signal};
use crate::output::{
    OutputError, check_new_file, check_new_folder, check_ruled, check_usable, discard_renamed,
    validate_output_paths, warn_of_cloud_copy,
};
use crate::terminal::{
    self, Choice, NoticeKind, clear_private_screen, end_warnings, lasting_warning, notice,
    on_private_screen, printable, showing_result,
};

/// What a result is called in the sentences about it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ResultName {
    /// What it is, at the start of a sentence: "The record", "The PDF", "The card files".
    pub(crate) what: &'static str,
    /// Whether `what` names more than one thing, as "The card files" does.
    pub(crate) plural: bool,
}

impl ResultName {
    /// One thing named `what`.
    pub(crate) const fn one(what: &'static str) -> Self {
        Self {
            what,
            plural: false,
        }
    }
}

/// Plain words for the errors of a file system that a save may meet.
fn plain_failure(error: &io::Error) -> Option<&'static str> {
    use io::ErrorKind::{
        AlreadyExists, NotADirectory, NotFound, PermissionDenied, QuotaExceeded,
        ReadOnlyFilesystem, StorageFull,
    };
    /// EIO, the same number on every system that has it.
    const INPUT_OUTPUT_ERROR: i32 = 5;
    match error.kind() {
        AlreadyExists => Some("a file or folder of that name appeared meanwhile"),
        StorageFull => Some("the disk is full"),
        QuotaExceeded => Some("the disk quota is used up"),
        PermissionDenied => Some("there is no permission to write there"),
        ReadOnlyFilesystem => Some("the disk can only be read"),
        NotFound | NotADirectory => Some("the folder is gone"),
        _ if error.raw_os_error() == Some(INPUT_OUTPUT_ERROR) => Some("the disk reported an error"),
        _ => None,
    }
}

/// Why a save failed, in one line that names the file but nothing it holds.
fn save_failure(what: &str, path: &str, error: &FileError) -> String {
    let known = match error {
        FileError::System(error) => plain_failure(error).map(str::to_owned),
        _ => None,
    };
    let reason = known.unwrap_or_else(|| {
        let described = printable(&error.to_string());
        lower_first(described.strip_suffix('.').unwrap_or(&described))
    });
    format!(
        "{what} could not be saved as {}: {reason}.",
        printable(path)
    )
}

/// What a failed save left behind for the person to delete, one line each, and the failure that
/// made the save fail.
fn left_behind(folder: bool, error: FileError) -> (FileError, Vec<String>) {
    let mut notices = Vec::new();
    let mut failure = error;
    if let FileError::FailedSaveLeftReservation { reservation, cause } = failure {
        let reservation = printable(&reservation.to_string_lossy());
        notices.push(if folder {
            format!(
                "The new folder {reservation}, which may hold some of its files, could not be removed: delete it."
            )
        } else {
            format!(
                "The empty file {reservation}, made to reserve its name, could not be removed: delete it."
            )
        });
        failure = *cause;
    }
    if let FileError::FailedSaveLeftCopy { staging, cause } = failure {
        notices.push(format!(
            "Its private staging folder {}, which may hold a copy, could not be removed: delete it.",
            printable(&staging.to_string_lossy())
        ));
        failure = *cause;
    }
    (failure, notices)
}

/// Runs `write`, the save of one result. A file saved in full whose private staging copy could not
/// be removed is saved: the person is told so and to delete the copy, and the save is not tried
/// again. Every save of the command line goes through it.
pub(crate) fn write_saved(write: impl FnOnce() -> Result<(), FileError>) -> Result<(), FileError> {
    match write() {
        Err(error @ FileError::LeftStagingCopy { .. }) => {
            lasting_warning(&printable(&error.to_string()));
            Ok(())
        }
        other => other,
    }
}

/// Ends the step of a failed save once the person tries again or skips the result (CORE-39): why it
/// failed no longer holds. Where "What now?" had a screen of its own, not one under a result shown
/// already, a new page starts, so that what follows is not drawn under the failure.
fn end_failed_step(under_result: bool) {
    if under_result {
        end_warnings();
    } else {
        clear_private_screen();
    }
}

/// What refuses a new folder of the option `key` where something is there.
pub(crate) const fn folder_taken(key: &str) -> &'static str {
    match key.as_bytes() {
        b"cards-dir" => {
            "The card folder already exists. Choose a new folder to avoid mixing separate card collections."
        }
        b"images-dir" => {
            "The image folder already exists. Choose a new folder for the exported images."
        }
        b"word-lists-dir" => "Choose a new folder for the word-list set.",
        _ => "Choose a new folder for the share QR images.",
    }
}

/// What is chosen after a failed save.
#[derive(Clone, Copy)]
enum AfterFailedSave {
    Again,
    Other,
    Skip,
}

/// Refuses another name for the output `key` unless it is a new file whose folder can be written,
/// or a new folder of its kind, and no other output of the command overlaps it.
fn check_output_name(parsed: &Parsed, key: &str, path: &str) -> Result<(), OutputError> {
    check_usable(key, path)?;
    check_ruled(path)?;
    if FOLDER_OUTPUTS.contains(&key) {
        Folder::claim(
            Path::new(path),
            terminal::environment().current.as_deref(),
            folder_taken(key).to_owned(),
        )
        .map_err(OutputError::File)?;
        check_new_folder(path)?;
    } else {
        check_new_file(path, false)?;
    }
    let mut with_it = parsed.clone();
    with_it.insert(key.to_owned(), Given::One(path.to_owned()));
    validate_output_paths(&with_it)
}

/// Saves the output that the option `key` names, which is on the screen already: a failure keeps it
/// and offers to try again, another name or to skip it, which the messages say of it by `name`.
/// `write` saves it at a path, never over anything that exists there. A name used instead of the one
/// given is kept in `parsed`, so that the next new name is checked against it. None when the option
/// is not given or the output was skipped.
pub(crate) fn save_output(
    parsed: &mut Parsed,
    key: &str,
    name: ResultName,
    mut write: impl FnMut(&str) -> Result<(), FileError>,
) -> Result<Option<String>, Stop> {
    let Some(given) = value(parsed, key).map(str::to_owned) else {
        return Ok(None);
    };
    let folder = FOLDER_OUTPUTS.contains(&key);
    let mut path = given.clone();
    let mut under_result = showing_result();
    let mut try_write = true;
    loop {
        if try_write {
            match write_saved(|| write(&path)) {
                Ok(()) => {
                    // A name chosen after a failure is not the numbered one the options were given.
                    if path != given {
                        discard_renamed(&given);
                        warn_of_cloud_copy(&path);
                        parsed.insert(key.to_owned(), Given::One(path.clone()));
                    }
                    return Ok(Some(path));
                }
                // An ending signal ends the command too, with nothing left to ask.
                Err(error) if !on_private_screen() || pending_signal().is_some() => {
                    return Err(error.into());
                }
                Err(error) => {
                    // Why it failed, which another try may mend, then what it left behind to
                    // delete, which holds after the command.
                    let (failure, notices) = left_behind(folder, error);
                    under_result = showing_result();
                    notice(
                        &save_failure(name.what, &path, &failure),
                        NoticeKind::Warning,
                    );
                    notices.iter().for_each(|text| lasting_warning(text));
                }
            }
        }
        let another = format!("Another {} name", if folder { "folder" } else { "file" });
        let next = after_failure(
            WHAT_NOW,
            &[
                Choice::new("Try again", AfterFailedSave::Again),
                Choice::new(&another, AfterFailedSave::Other),
                Choice::noted("Skip", "it is not saved", AfterFailedSave::Skip),
            ],
            AfterFailure {
                escape: "skips it",
                ..AfterFailure::default()
            },
        )?;
        try_write = true;
        match next {
            AfterFailedSave::Skip => {
                end_failed_step(under_result);
                discard_renamed(&given);
                let verb = if name.plural { "were" } else { "was" };
                lasting_warning(&format!("{} {verb} not saved.", name.what));
                return Ok(None);
            }
            AfterFailedSave::Again => {}
            AfterFailedSave::Other => {
                let checked = &*parsed;
                let other = value_until(
                    &format!("New name for {}:", lower_first(name.what)),
                    if folder {
                        "the name of a new folder"
                    } else {
                        "the name of a new file"
                    },
                    PATH_LIMIT,
                    None,
                    |answer: &str| {
                        let typed = dropped_path(answer).to_string_lossy().into_owned();
                        check_output_name(checked, key, &typed).map(|()| typed)
                    },
                )?;
                match other {
                    Some(other) => path = other,
                    None => try_write = false,
                }
            }
        }
        // Tried again: a new failure says why on its own.
        if try_write {
            end_failed_step(under_result);
        }
    }
}
