//! What a command makes before the seed phrase so that its saves need no right to change the
//! folders they lie in (CORE-55): files reserved by name and held open, new folders of outputs, and
//! the new folder of a task's files. A save writes into what was made for it; what stays unused is
//! removed when the command ends, or named where the rules on writes keep it.

#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "files are made, written and removed here, in the os module, and nowhere else"
)]

use std::fs::{self, File};
use std::io::{self, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use super::files::{FileError, Identity, identity_of, private_file, private_folder};

/// What was made for an output or a task.
#[derive(Debug)]
enum Made {
    /// A file reserved by name, empty and open for writing.
    File(File),
    /// A new folder of an output; for QR images, the PDF they go with.
    Folder { beside: Option<PathBuf> },
    /// The new folder of a task's files, made in the folder that was chosen.
    Task { chosen: PathBuf },
}

/// One thing made, with the identity it was made with and whether a save used it.
#[derive(Debug)]
struct Prepared {
    path: PathBuf,
    made: Made,
    identity: Option<Identity>,
    used: bool,
}

/// Everything made before the seed phrase in this process.
static PREPARED: Mutex<Vec<Prepared>> = Mutex::new(Vec::new());

/// The record; a poisoned lock holds what was made, which stays usable.
fn prepared() -> MutexGuard<'static, Vec<Prepared>> {
    PREPARED.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The most numbered names tried for a task's folder.
const MOST_NUMBERED: usize = 999;

fn record(path: &Path, made: Made) {
    prepared().push(Prepared {
        path: path.to_path_buf(),
        identity: identity_of(path),
        made,
        used: false,
    });
}

/// Reserves the new file `path`: made empty and private, and held open, so that its save writes
/// into it when no folder is open to writing. Fails where something is there.
pub(crate) fn reserve_file(path: &Path) -> Result<(), FileError> {
    let file = private_file(path)?;
    record(path, Made::File(file));
    Ok(())
}

/// Makes the new private folder `path` of an output; `beside` names the PDF whose QR images it
/// holds, where it holds them. Fails where something is there.
pub(crate) fn prepare_folder(path: &Path, beside: Option<&Path>) -> Result<(), FileError> {
    private_folder(path)?;
    record(
        path,
        Made::Folder {
            beside: beside.map(Path::to_path_buf),
        },
    );
    Ok(())
}

/// The new folder of the files of a task saved in `chosen`: `name`, or its first numbered name that
/// nothing takes, made now and private; the one made for `chosen` already, where there is one.
pub(crate) fn task_folder(chosen: &Path, name: &str) -> Result<PathBuf, FileError> {
    if let Some(made) = task_folder_in(chosen) {
        return Ok(made);
    }
    for number in 0..=MOST_NUMBERED {
        let folder = if number == 0 {
            chosen.join(name)
        } else {
            chosen.join(format!("{name}-{number}"))
        };
        match private_folder(&folder) {
            Ok(()) => {
                record(
                    &folder,
                    Made::Task {
                        chosen: chosen.to_path_buf(),
                    },
                );
                return Ok(folder);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    Err(FileError::Taken(format!(
        "Every name from {name} to {name}-{MOST_NUMBERED} is taken in that folder; choose another folder."
    )))
}

/// The folder made for the files of a task saved in `chosen`, where one was made.
pub(crate) fn task_folder_in(chosen: &Path) -> Option<PathBuf> {
    prepared().iter().find_map(|entry| match &entry.made {
        Made::Task { chosen: made_in } if made_in == chosen => Some(entry.path.clone()),
        _ => None,
    })
}

/// Whether `path` is a file reserved for a save that has not written it yet.
pub(crate) fn is_reserved(path: &Path) -> bool {
    prepared()
        .iter()
        .any(|entry| entry.path == path && !entry.used && matches!(entry.made, Made::File(_)))
}

/// Whether `path` is a new folder made for an output that no save has filled yet.
pub(crate) fn is_prepared_folder(path: &Path) -> bool {
    prepared()
        .iter()
        .any(|entry| entry.path == path && !entry.used && matches!(entry.made, Made::Folder { .. }))
}

/// The folder made for the QR images that go with the PDF `pdf`, where one was made.
pub(crate) fn qr_folder_of(pdf: &Path) -> Option<PathBuf> {
    prepared().iter().find_map(|entry| match &entry.made {
        Made::Folder {
            beside: Some(sheet),
        } if sheet == pdf => Some(entry.path.clone()),
        _ => None,
    })
}

/// The file reserved at `path`, emptied and rewound for a save to write into; none where no file
/// is reserved there. A reservation that another program removed or replaced since is refused, as
/// what is written into it would be at no name.
pub(super) fn reserved_file(path: &Path) -> Result<Option<File>, FileError> {
    let list = prepared();
    let Some(entry) = list
        .iter()
        .find(|entry| entry.path == path && !entry.used && matches!(entry.made, Made::File(_)))
    else {
        return Ok(None);
    };
    let Made::File(file) = &entry.made else {
        return Ok(None);
    };
    if identity_of(path) != entry.identity {
        return Err(FileError::ReservationGone);
    }
    let mut copy = file.try_clone()?;
    copy.set_len(0)?;
    copy.seek(SeekFrom::Start(0))?;
    Ok(Some(copy))
}

/// Whether the file reserved at `path` is still the one made, as checked again once it is written.
pub(super) fn still_reserved(path: &Path) -> bool {
    prepared()
        .iter()
        .find(|entry| entry.path == path)
        .is_some_and(|entry| identity_of(path) == entry.identity)
}

/// Records whether the save of `path` used what was made for it; a reserved file whose save failed
/// is emptied again.
pub(super) fn mark_saved(path: &Path, saved: bool) {
    let mut list = prepared();
    let Some(entry) = list.iter_mut().find(|entry| entry.path == path) else {
        return;
    };
    if saved {
        entry.used = true;
    } else if let Made::File(file) = &entry.made {
        // Emptied, so that no part of a result stays at the name; a failure to empty it is the
        // save's failure already.
        let _emptied = file.set_len(0);
    }
}

/// Whether a file is reserved and still held, for the report of the rules on writes.
#[cfg(target_os = "linux")]
pub(crate) fn holds_reservations() -> bool {
    prepared()
        .iter()
        .any(|entry| matches!(entry.made, Made::File(_)))
}

/// Whether the folder `path` holds nothing.
fn holds_nothing(path: &Path) -> bool {
    fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
}

/// What stays of what was made before the seed phrase, which the rules on writes keep.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Left {
    /// A reserved file that no save wrote, empty.
    EmptyFile(PathBuf),
    /// A folder that no save filled, empty.
    EmptyFolder(PathBuf),
    /// An output's folder that a failed save left part of its files in, which is never removed:
    /// it may hold what a person wants to look at.
    PartlyFilled(PathBuf),
}

/// Removes what was made before the seed phrase and stayed unused, for a command about to end: a
/// file reserved and not written, a folder that holds nothing. Returns what stays. Something that
/// another program put at the name since is left alone.
pub(crate) fn remove_unused() -> Vec<Left> {
    remove_unused_within(|_| true)
}

/// [`remove_unused`] for what was made at a path that `within` takes; the rest stays recorded.
fn remove_unused_within(within: impl Fn(&Path) -> bool) -> Vec<Left> {
    let taken: Vec<Prepared> = {
        let mut list = prepared();
        let (taken, kept) = std::mem::take(&mut *list)
            .into_iter()
            .partition(|entry| within(&entry.path));
        *list = kept;
        taken
    };
    let mut left = Vec::new();
    for entry in taken {
        if identity_of(&entry.path) != entry.identity {
            continue;
        }
        match entry.made {
            Made::File(file) if !entry.used => {
                drop(file);
                if fs::remove_file(&entry.path).is_err() && entry.path.exists() {
                    left.push(Left::EmptyFile(entry.path));
                }
            }
            Made::Folder { .. } | Made::Task { .. } if holds_nothing(&entry.path) => {
                if fs::remove_dir(&entry.path).is_err() && entry.path.exists() {
                    left.push(Left::EmptyFolder(entry.path));
                }
            }
            Made::Folder { .. } if !entry.used => left.push(Left::PartlyFilled(entry.path)),
            _ => {}
        }
    }
    left
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reserved_file_is_written_once_and_an_unused_one_removed() {
        crate::os::in_temporary_folder("mnemocode-reserved-", |folder| {
            let kept = folder.join("notes.txt");
            let unused = folder.join("cards.pdf");
            reserve_file(&kept).unwrap();
            reserve_file(&unused).unwrap();
            // A name that is taken cannot be reserved again, by this program or another.
            assert!(reserve_file(&kept).is_err());
            assert!(is_reserved(&kept) && is_reserved(&unused));
            let mut file = reserved_file(&kept).unwrap().unwrap();
            std::io::Write::write_all(&mut file, b"public test record").unwrap();
            mark_saved(&kept, true);
            assert!(!is_reserved(&kept));
            assert_eq!(
                remove_unused_within(|path| path.starts_with(folder)),
                Vec::new()
            );
            assert_eq!(fs::read(&kept).unwrap(), b"public test record");
            assert!(!unused.exists());
        })
        .unwrap();
    }

    #[test]
    fn a_task_folder_is_made_once_for_its_folder_and_numbered_where_taken() {
        crate::os::in_temporary_folder("mnemocode-task-", |folder| {
            fs::create_dir(folder.join("design-files")).unwrap();
            let made = task_folder(folder, "design-files").unwrap();
            assert_eq!(made, folder.join("design-files-1"));
            assert_eq!(task_folder(folder, "design-files").unwrap(), made);
            assert_eq!(task_folder_in(folder), Some(made.clone()));
            // Empty at the end, it is removed; the folder that was there before stays.
            assert_eq!(
                remove_unused_within(|path| path.starts_with(folder)),
                Vec::new()
            );
            assert!(!made.exists());
            assert!(folder.join("design-files").is_dir());
        })
        .unwrap();
    }
}
