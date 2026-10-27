//! Files, as MnemoCode TS 0.1.0 handles them (`src/cli/bounded-read.ts`,
//! `src/export/private-file.ts`, `src/export/temporary-folders.ts`): a read never takes more than
//! its limit and lands in a locked buffer, and every result is published as a new private file or
//! folder that never replaces anything. A file is written in full into a private staging folder
//! beside its destination, then linked to its final name, which fails where the name exists; a
//! file system without hard links reserves the name with an empty private file first, which the
//! finished file then replaces in one rename. A folder is filled in a staging folder, then its
//! final name is made, and the files are moved in. Staging folders, and an output folder being
//! filled, are recorded until their owner removes them, so that an exit at once after a signal
//! removes those left ([`remove_left`]).

#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "files are opened, read, written and removed here, in the os module, and nowhere else"
)]

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use mnemocode::random::Random;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretBytes;
use mnemocode::text::display::safe_display;
use mnemocode::text::limits::InputTooLarge;

use super::random::SystemRandom;

/// Why a file could not be read or a result could not be published.
#[derive(Debug)]
pub(crate) enum FileError {
    /// The file named, at the start of a sentence, is missing or cannot be read.
    Unreadable(&'static str),
    /// The file named is a folder, a device or a pipe.
    NotRegular(&'static str),
    /// The file is longer than its limit.
    TooLarge(InputTooLarge),
    /// Something is at a new file's or folder's name already, said by the caller's message.
    Taken(String),
    /// A new folder's path is blank.
    BlankPath,
    /// The file system refused, in its own words.
    System(io::Error),
    /// The result was saved, but its staging folder, which may hold a copy, stayed.
    LeftStagingCopy {
        /// The result saved.
        saved: PathBuf,
        /// The staging folder that stayed.
        staging: PathBuf,
    },
    /// The save failed, and its staging folder, which may hold a copy, stayed too.
    FailedSaveLeftCopy {
        /// The staging folder that stayed.
        staging: PathBuf,
        /// Why the save failed.
        cause: Box<FileError>,
    },
    /// The save failed, and the name it reserved stayed.
    FailedSaveLeftReservation {
        /// The reserved file or folder that stayed.
        reservation: PathBuf,
        /// Why the save failed.
        cause: Box<FileError>,
    },
    /// A step of the save that is not the file system's failed, in its own words.
    Step(Box<dyn Refusal + Send + Sync>),
}

/// A path for a message: control characters replaced (CAP-CLI-SAFE-DISPLAY-TEXT).
fn shown(path: &Path) -> String {
    safe_display(&path.to_string_lossy())
}

impl fmt::Display for FileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(what) => write!(
                f,
                "{what} could not be read. Check that the file exists and is readable."
            ),
            Self::NotRegular(what) => write!(f, "{what} must be a regular text file."),
            Self::TooLarge(error) => error.fmt(f),
            Self::Taken(message) => f.write_str(message),
            Self::BlankPath => f.write_str("A new folder needs a path; an empty one is refused."),
            Self::System(error) => error.fmt(f),
            Self::LeftStagingCopy { saved, staging } => write!(
                f,
                "Saved {}, but its private staging folder {}, which may still hold a copy of it, could not be removed: delete it.",
                shown(saved),
                shown(staging)
            ),
            Self::FailedSaveLeftCopy { staging, cause } => write!(
                f,
                "The save failed ({}), and its private staging folder {}, which may hold a copy, could not be removed: delete it.",
                clause(cause),
                shown(staging)
            ),
            Self::FailedSaveLeftReservation { reservation, cause } => write!(
                f,
                "The save failed ({}), and {}, reserved for it, could not be removed: delete it.",
                clause(cause),
                shown(reservation)
            ),
            Self::Step(error) => error.fmt(f),
        }
    }
}

/// A failure's message as a clause inside another: without its final full stop, its first letter
/// lowered.
fn clause(error: &FileError) -> String {
    let text = error.to_string();
    let text = text.strip_suffix('.').unwrap_or(&text);
    mnemocode::text::words::lower_first(text)
}

impl std::error::Error for FileError {}

impl Refusal for FileError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unreadable(_) => "cli.bounded-read.file-unreadable",
            Self::NotRegular(_) => "cli.bounded-read.regular-file-required",
            Self::TooLarge(error) => error.code(),
            Self::Taken(_) => "export.private-file.absent-path-refused",
            Self::BlankPath => "export.private-file.new-folder-path-empty-one-refused",
            Self::System(_) => "cli.file-system",
            Self::LeftStagingCopy { .. } => "left-staging-copy",
            Self::FailedSaveLeftCopy { .. } => "failed-save-left-staging-copy",
            Self::FailedSaveLeftReservation { .. } => "failed-save-left-reservation",
            Self::Step(error) => error.code(),
        }
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        Self::System(error)
    }
}

/// `path` made absolute against `current` and its `.` and `..` removed by their names, as
/// Node.js's `path.resolve` does; links are not followed.
pub(crate) fn resolve(path: &Path, current: Option<&Path>) -> PathBuf {
    let joined = match current {
        Some(current) if path.is_relative() => current.join(path),
        _ => path.to_path_buf(),
    };
    let mut resolved = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if resolved.parent().is_some() {
                    resolved.pop();
                }
            }
            other => resolved.push(other),
        }
    }
    resolved
}

/// What is at a path: nothing, a folder, or something else; a link is not followed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Entry {
    /// Nothing.
    None,
    /// A folder.
    Folder,
    /// A file, a link or anything else.
    Other,
}

/// What is at `path`; a failure to look, other than nothing there, is the file system's own.
pub(crate) fn entry_at(path: &Path) -> io::Result<Entry> {
    match fs::symlink_metadata(path) {
        Ok(found) if found.is_dir() => Ok(Entry::Folder),
        Ok(_) => Ok(Entry::Other),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Entry::None),
        Err(error) => Err(error),
    }
}

/// Makes `folder` with every missing folder above it, as the preflight does for each output's
/// parent before any secret (ARCHITECTURE.md §5).
pub(crate) fn make_folders(folder: &Path) -> io::Result<()> {
    fs::create_dir_all(folder)
}

/// The file at `path`, read whole into a locked buffer, never more than `limit` bytes: one more is
/// refused as too large, naming `what`. A missing or unreadable file is refused as unreadable;
/// with `regular_only`, a folder, a device or a pipe is refused without waiting for a writer.
pub(crate) fn read_secret_file(
    path: &Path,
    limit: usize,
    what: &'static str,
    regular_only: bool,
) -> Result<SecretBytes, FileError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    if regular_only {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = options
        .open(path)
        .map_err(|_| FileError::Unreadable(what))?;
    let metadata = file.metadata().map_err(|_| FileError::Unreadable(what))?;
    if regular_only && !metadata.is_file() {
        return Err(FileError::NotRegular(what));
    }
    let capacity = usize::try_from(metadata.len()).unwrap_or(limit).min(limit) + 1;
    read_bounded(&mut file, capacity, limit, what)
}

/// What `reader` gives to its end, into a locked buffer of `capacity` bytes that grows to at most
/// `limit` + 1 by copying into a larger locked one: one byte past `limit` is refused as too large.
pub(crate) fn read_bounded(
    reader: &mut impl Read,
    capacity: usize,
    limit: usize,
    what: &'static str,
) -> Result<SecretBytes, FileError> {
    let mut held = SecretBytes::zeroed(what, capacity.clamp(1, limit + 1));
    let mut length = 0;
    loop {
        // An ending signal stops the read, and the command ends with it (main): seen before each
        // read, so also one that came between reads or before the first.
        if super::signals::pending_signal().is_some() {
            return Err(FileError::Unreadable(what));
        }
        if length == held.len() {
            if length > limit {
                return Err(FileError::TooLarge(InputTooLarge::new(what, limit)));
            }
            let mut larger = SecretBytes::zeroed(what, (length * 2).clamp(1, limit + 1));
            if let (Some(target), Some(source)) = (larger.get_mut(..length), held.get(..length)) {
                target.copy_from_slice(source);
            }
            held = larger;
        }
        let Some(space) = held.get_mut(length..) else {
            break;
        };
        match reader.read(space) {
            Ok(0) => break,
            Ok(count) => length += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                // A request to stop stops the process, and the read goes on once it continues; an
                // ending signal is seen before the next read.
                if super::signals::suspend_requested() {
                    super::signals::suspend_now();
                }
            }
            Err(_) => return Err(FileError::Unreadable(what)),
        }
        if length > limit {
            return Err(FileError::TooLarge(InputTooLarge::new(what, limit)));
        }
    }
    let mut exact = SecretBytes::zeroed(what, length);
    if let Some(source) = held.get(..length) {
        exact.copy_from_slice(source);
    }
    Ok(exact)
}

/// The staging folders not yet removed, and the output folders being filled with the identity
/// each was made with; an exit at once removes them ([`remove_left`]).
static TEMPORARY: Mutex<Vec<(PathBuf, Option<Identity>)>> = Mutex::new(Vec::new());

/// What tells a folder from another one made at its path since: its device and inode on Unix,
/// its creation time on Windows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Identity(u64, u64);

fn identity_of(path: &Path) -> Option<Identity> {
    let metadata = fs::symlink_metadata(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(Identity(metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    {
        let created = metadata.created().ok()?;
        let since = created.duration_since(std::time::UNIX_EPOCH).ok()?;
        Some(Identity(since.as_secs(), u64::from(since.subsec_nanos())))
    }
}

fn note(path: &Path, identity: Option<Identity>) {
    if let Ok(mut temporary) = TEMPORARY.lock() {
        temporary.push((path.to_path_buf(), identity));
    }
}

fn forget(path: &Path) {
    if let Ok(mut temporary) = TEMPORARY.lock() {
        temporary.retain(|(noted, _)| noted != path);
    }
}

/// Removes at once every staging folder that its owner has not removed, and every output folder
/// still being filled while it is still the one made, for a process about to end; returns those
/// that could not be removed, which may still hold a private copy.
pub(crate) fn remove_left() -> Vec<PathBuf> {
    let Ok(mut temporary) = TEMPORARY.lock() else {
        return Vec::new();
    };
    let mut left = Vec::new();
    for (folder, made) in temporary.drain(..) {
        let still = made.is_none_or(|made| identity_of(&folder) == Some(made));
        if still && fs::remove_dir_all(&folder).is_err() && folder.exists() {
            left.push(folder);
        }
    }
    left
}

/// The characters of a staging folder's random suffix.
const SUFFIX: &[u8; 36] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// A new private staging folder whose name is `prefix` and six random characters, recorded until
/// [`remove_staging`].
fn make_staging(prefix: &Path) -> io::Result<PathBuf> {
    let mut random = SystemRandom;
    loop {
        let mut name = prefix.as_os_str().to_owned();
        for _ in 0..6 {
            let index = random
                .below(36)
                .map_err(|error| io::Error::other(error.to_string()))?;
            let at = usize::try_from(index).unwrap_or(0);
            name.push(char::from(SUFFIX.get(at).copied().unwrap_or(b'x')).to_string());
        }
        let folder = PathBuf::from(name);
        match private_folder(&folder) {
            Ok(()) => {
                note(&folder, None);
                return Ok(folder);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
}

/// Removes the staging `folder` with all it holds, or only when it is `empty`; one that cannot be
/// removed stays recorded.
fn remove_staging(folder: &Path, empty: bool) -> io::Result<()> {
    if empty {
        fs::remove_dir(folder)?;
    } else {
        fs::remove_dir_all(folder)?;
    }
    forget(folder);
    Ok(())
}

/// A new folder that only its owner may open where the file system keeps Unix permissions.
fn private_folder(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().mode(0o700).create(path)
    }
    #[cfg(not(unix))]
    fs::DirBuilder::new().create(path)
}

/// Writes `bytes` as a new file at `path` that only its owner may read; fails where something is
/// there already.
pub(crate) fn new_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file: File = options.open(path)?;
    file.write_all(bytes)
}

/// Removes `staging` after a save failed with `failure`; where it stays, the failure says so.
fn after_failed_staging(staging: &Path, failure: FileError) -> FileError {
    match remove_staging(staging, false) {
        Ok(()) => failure,
        Err(_) => FileError::FailedSaveLeftCopy {
            staging: staging.to_path_buf(),
            cause: Box::new(failure),
        },
    }
}

/// Whether a link failed because the file system has no hard links, such as FAT and exFAT.
fn no_hard_links(error: &io::Error) -> bool {
    #[cfg(unix)]
    let codes = [libc::EPERM, libc::ENOTSUP, libc::EOPNOTSUPP, libc::ENOSYS];
    // ERROR_INVALID_FUNCTION and ERROR_NOT_SUPPORTED.
    #[cfg(windows)]
    let codes = [1, 50];
    error
        .raw_os_error()
        .is_some_and(|code| codes.contains(&code))
}

/// Publishes `bytes` as a new private file at `path`, never replacing anything (the module's top).
pub(crate) fn publish_new_file(path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let staging = make_staging(&parent.join(".mnemocode-export-"))?;
    let temporary = staging.join("document");
    let published = new_private_file(&temporary, bytes)
        .map_err(FileError::from)
        .and_then(|()| match fs::hard_link(&temporary, path) {
            Ok(()) => Ok(()),
            Err(error) if no_hard_links(&error) => {
                new_private_file(path, &[])?;
                fs::rename(&temporary, path).map_err(|renamed| {
                    // The reservation was made just above with create_new: this program's own.
                    match fs::remove_file(path) {
                        Ok(()) => FileError::System(renamed),
                        Err(_) => FileError::FailedSaveLeftReservation {
                            reservation: path.to_path_buf(),
                            cause: Box::new(FileError::System(renamed)),
                        },
                    }
                })
            }
            Err(error) => Err(FileError::System(error)),
        });
    if let Err(failure) = published {
        return Err(after_failed_staging(&staging, failure));
    }
    remove_staging(&staging, false).map_err(|_| FileError::LeftStagingCopy {
        saved: path.to_path_buf(),
        staging,
    })
}

/// A new folder of an export, claimed before anything secret is read and published afterwards
/// under the same name.
#[derive(Debug)]
pub(crate) struct Folder {
    target: PathBuf,
    taken: String,
}

impl Folder {
    /// Claims `path`, resolved: refused with `taken` when something is there already, and when it
    /// is blank.
    pub(crate) fn claim(
        path: &Path,
        current: Option<&Path>,
        taken: String,
    ) -> Result<Self, FileError> {
        if path.as_os_str().to_string_lossy().trim().is_empty() {
            return Err(FileError::BlankPath);
        }
        let target = resolve(path, current);
        if entry_at(&target)? != Entry::None {
            return Err(FileError::Taken(taken));
        }
        Ok(Self { target, taken })
    }

    /// The folder's resolved path.
    pub(crate) fn path(&self) -> &Path {
        &self.target
    }

    /// Has `write` fill a private staging folder named from `prefix`, then publishes it.
    pub(crate) fn publish<T>(
        &self,
        prefix: &str,
        write: impl FnOnce(&Path) -> Result<T, FileError>,
    ) -> Result<T, FileError> {
        publish_new_folder(&self.target, prefix, &self.taken, write)
    }
}

/// Publishes a new private folder at `target`: `write` fills a staging folder beside it, made with
/// `prefix`; the final name is made once the contents are complete, refused with `taken` where
/// something took it meanwhile, and the files are moved in. On failure the staging folder and the
/// unchanged reservation are removed; one that stays is named.
pub(crate) fn publish_new_folder<T>(
    target: &Path,
    prefix: &str,
    taken: &str,
    write: impl FnOnce(&Path) -> Result<T, FileError>,
) -> Result<T, FileError> {
    let parent = target.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let staging = make_staging(&parent.join(prefix))?;
    let mut reservation = None;
    let result = write(&staging).and_then(|result| {
        match private_folder(target) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                return Err(FileError::Taken(taken.to_owned()));
            }
            Err(error) => return Err(error.into()),
        }
        let made = identity_of(target);
        note(target, made);
        reservation = Some(made);
        for entry in fs::read_dir(&staging)? {
            let name = entry?.file_name();
            fs::rename(staging.join(&name), target.join(&name))?;
        }
        // Every file was moved: a staging folder that is not empty fails the export.
        remove_staging(&staging, true)?;
        forget(target);
        Ok(result)
    });
    let Err(failure) = result else {
        return result;
    };
    let failure = after_failed_staging(&staging, failure);
    let Some(made) = reservation else {
        return Err(failure);
    };
    forget(target);
    let still_own = made.is_none_or(|made| identity_of(target) == Some(made));
    if !still_own || fs::remove_dir_all(target).is_ok() {
        return Err(failure);
    }
    Err(FileError::FailedSaveLeftReservation {
        reservation: target.to_path_buf(),
        cause: Box::new(failure),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_resolve_by_their_names() {
        let current = Path::new("/home/someone/work");
        assert_eq!(
            resolve(Path::new("../cards/./a.pdf"), Some(current)),
            PathBuf::from("/home/someone/cards/a.pdf")
        );
        assert_eq!(
            resolve(Path::new("/../x"), Some(current)),
            PathBuf::from("/x")
        );
    }

    #[test]
    fn a_read_never_takes_more_than_its_limit() {
        let mut short = &b"abc"[..];
        let read = read_bounded(&mut short, 1, 8, "The file");
        assert!(read.is_ok_and(|bytes| bytes.as_ref() == b"abc"));
        let mut long = &b"abcdefghij"[..];
        let refused = read_bounded(&mut long, 2, 8, "The file");
        assert!(matches!(refused, Err(FileError::TooLarge(_))));
        let mut exact = &b"abcdefgh"[..];
        assert!(read_bounded(&mut exact, 8, 8, "The file").is_ok_and(|bytes| bytes.len() == 8));
    }

    #[test]
    fn the_failures_of_a_save_name_what_stayed() {
        let failure = FileError::FailedSaveLeftCopy {
            staging: PathBuf::from("/out/.mnemocode-export-abc123"),
            cause: Box::new(FileError::Taken(
                "Something is at /out/a.pdf already.".to_owned(),
            )),
        };
        assert_eq!(
            failure.to_string(),
            "The save failed (something is at /out/a.pdf already), and its private staging \
             folder /out/.mnemocode-export-abc123, which may hold a copy, could not be removed: \
             delete it."
        );
        assert_eq!(failure.code(), "failed-save-left-staging-copy");
    }
}
