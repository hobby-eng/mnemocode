//! Files: a read stays within its limit and lands in a locked buffer; every result is published as
//! a new private file or folder that never replaces anything. A file is staged beside its
//! destination, then hard-linked to its name, which fails where the name exists; without hard
//! links, an empty private file reserves the name first. Staging folders are recorded so that an
//! exit after a signal removes them ([`remove_left`]).

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
    /// The regular file grew or shrank after its size was admitted.
    Changed(&'static str),
    /// The file named is a folder, a device or a pipe.
    NotRegular(&'static str),
    /// The file named, which holds no text, is a folder, a device or a pipe.
    NotAFile(&'static str),
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
            Self::Changed(what) => write!(
                f,
                "{what} changed size while being read. Choose a stable file copy and try again."
            ),
            Self::NotRegular(what) => write!(f, "{what} must be a regular text file."),
            Self::NotAFile(what) => write!(f, "{what} must be a regular file."),
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
            Self::Changed(_) => "cli.bounded-read.file-changed",
            Self::NotRegular(_) => "cli.bounded-read.regular-file-required",
            Self::NotAFile(_) => "cli.bounded-read.not-a-file",
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

/// `path` with its links resolved, which must exist.
pub(crate) fn real_path(path: &Path) -> io::Result<PathBuf> {
    fs::canonicalize(path)
}

/// What a look at a file to read says of it, a link followed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FileLook {
    /// Nothing there: no such name, or a name under a file.
    Nothing,
    /// A folder.
    Folder,
    /// Something else that is no ordinary file.
    NoFile,
    /// An ordinary file: its size, and whether this program may read it.
    File { bytes: u64, readable: bool },
}

/// What is at `path`, without reading it; any other failure leaves that unknown.
pub(crate) fn look_at_file(path: &Path) -> io::Result<FileLook> {
    let found = match fs::metadata(path) {
        Ok(found) => found,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(FileLook::Nothing);
        }
        Err(error) => return Err(error),
    };
    Ok(if found.is_dir() {
        FileLook::Folder
    } else if !found.is_file() {
        FileLook::NoFile
    } else {
        FileLook::File {
            bytes: found.len(),
            readable: fs::File::open(path).is_ok(),
        }
    })
}

/// The ordinary files directly in `folder` whose names end in .pdf, in any case, sorted by name:
/// its subfolders and links are left out.
pub(crate) fn pdf_files(folder: &Path) -> io::Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let pdf = entry
            .path()
            .extension()
            .is_some_and(|ending| ending.eq_ignore_ascii_case("pdf"));
        if pdf && entry.file_type()?.is_file() {
            found.push(entry.path());
        }
    }
    found.sort();
    Ok(found)
}

/// Whether this program may make a file in `folder`, its protections counted: tried with a private
/// folder that is removed at once, as a look at the permissions would not see them.
pub(crate) fn may_write(folder: &Path) -> bool {
    make_staging(&folder.join(".mnemocode-check-"))
        .is_ok_and(|staging| remove_staging(&staging, false).is_ok())
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

/// The regular file at `path`, which holds no secret, such as the picture of a pattern, read whole:
/// never more than `limit` bytes, refused as [`read_secret_file`] refuses; nothing of it is locked,
/// so that it takes none of the lock budget that the secrets need.
pub(crate) fn read_public_file(
    path: &Path,
    limit: usize,
    what: &'static str,
) -> Result<Vec<u8>, FileError> {
    let file = open_regular(path, what)?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| FileError::Unreadable(what))?;
    if bytes.len() > limit {
        return Err(FileError::TooLarge(InputTooLarge::new(what, limit)));
    }
    Ok(bytes)
}

/// The regular file at `path` that holds a secret too large to lock, such as a pattern's PDF: read
/// whole into a buffer of its size, never more than `limit` bytes, never locked and wiped when
/// dropped, as such a file is written ([`SecretBytes::large`]).
pub(crate) fn read_large_secret_file(
    path: &Path,
    limit: usize,
    what: &'static str,
) -> Result<SecretBytes, FileError> {
    let file = open_regular(path, what)?;
    let size = file
        .metadata()
        .map_err(|_| FileError::Unreadable(what))?
        .len();
    let size = usize::try_from(size)
        .ok()
        .filter(|n| *n <= limit)
        .ok_or_else(|| FileError::TooLarge(InputTooLarge::new(what, limit)))?;
    read_fixed_large(file, size, what)
}

fn read_fixed_large(
    mut reader: impl Read,
    size: usize,
    what: &'static str,
) -> Result<SecretBytes, FileError> {
    // A changing file must not double the admitted allocation before the next
    // budget check. Read only into this fixed owner, then probe EOF on the stack.
    let mut held = SecretBytes::large(what, vec![0; size]);
    reader.read_exact(&mut held).map_err(|error| {
        if error.kind() == io::ErrorKind::UnexpectedEof {
            FileError::Changed(what)
        } else {
            FileError::Unreadable(what)
        }
    })?;
    let mut extra = zeroize::Zeroizing::new([0_u8; 1]);
    let count = loop {
        match reader.read(&mut *extra) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => break result.map_err(|_| FileError::Unreadable(what))?,
        }
    };
    // Even the sentinel may be a secret byte when a file grows.
    if count != 0 {
        return Err(FileError::Changed(what));
    }
    Ok(held)
}

/// Whether the regular file at `path` begins with `prefix`; reads no more than `prefix`'s length.
pub(crate) fn file_starts_with(path: &Path, prefix: &[u8]) -> bool {
    let Ok(file) = open_regular(path, "The file") else {
        return false;
    };
    let mut start = Vec::with_capacity(prefix.len());
    file.take(prefix.len() as u64)
        .read_to_end(&mut start)
        .is_ok_and(|_| start == prefix)
}

/// The regular file at `path`, opened to read without waiting on a pipe; `what` names it in a
/// refusal of something else at the path.
fn open_regular(path: &Path, what: &'static str) -> Result<File, FileError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    // Windows opens no folder: what lies at the path then names the refusal, as Unix's open does.
    let file = options.open(path).map_err(|_| match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() => FileError::NotAFile(what),
        _ => FileError::Unreadable(what),
    })?;
    let metadata = file.metadata().map_err(|_| FileError::Unreadable(what))?;
    if !metadata.is_file() {
        return Err(FileError::NotAFile(what));
    }
    Ok(file)
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
            // An ending signal is seen before the next read.
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
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

/// The system's temporary folder.
pub(crate) fn temporary_folder() -> PathBuf {
    std::env::temp_dir()
}

/// What `work` gives in a new private folder of the system's temporary folder, named from `prefix`
/// and removed afterwards; one that cannot be removed stays recorded for [`remove_left`].
pub(crate) fn in_temporary_folder<T>(prefix: &str, work: impl FnOnce(&Path) -> T) -> io::Result<T> {
    let folder = make_staging(&temporary_folder().join(prefix))?;
    let result = work(&folder);
    let _recorded = remove_staging(&folder, false);
    Ok(result)
}

/// A new folder that only its owner may open where the file system keeps Unix permissions.
pub(crate) fn private_folder(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().mode(0o700).create(path)
    }
    #[cfg(not(unix))]
    fs::DirBuilder::new().create(path)
}

/// A new file at `path` that only its owner may read; fails where something is there already.
fn private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Writes `bytes` as a new file at `path` that only its owner may read; fails where something is
/// there already.
pub(crate) fn new_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    private_file(path)?.write_all(bytes)
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
    publish_written_file(path, |mut file| Ok(file.write_all(bytes)?))
}

/// Stops a save once an ending signal has come: the command ends with it (main), and nothing more
/// is drawn or published.
pub(crate) fn stop_if_signalled() -> Result<(), FileError> {
    if super::signals::pending_signal().is_some() {
        return Err(FileError::System(io::ErrorKind::Interrupted.into()));
    }
    Ok(())
}

/// Publishes the new private file at `path` that `write` fills, as a file too large for memory is
/// written: it fills the staged copy, and nothing is at `path` unless it succeeds.
pub(crate) fn publish_written_file(
    path: &Path,
    write: impl FnOnce(File) -> Result<(), FileError>,
) -> Result<(), FileError> {
    publish_staged_file(path, |temporary| {
        write(private_file(temporary)?)?;
        Ok(true)
    })
    .map(|_| ())
}

/// One publication and cleanup path for ordinary and authenticated file writers.
fn publish_staged_file(
    path: &Path,
    fill: impl FnOnce(&Path) -> Result<bool, FileError>,
) -> Result<bool, FileError> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let staging = make_staging(&parent.join(".mnemocode-export-"))?;
    let temporary = staging.join("document");
    let checked = fill(&temporary);
    let proceed = match checked {
        Ok(proceed) => proceed,
        Err(failure) => return Err(after_failed_staging(&staging, failure)),
    };
    if !proceed {
        remove_staging(&staging, false)?;
        return Ok(false);
    }
    let published = stop_if_signalled().and_then(|()| match fs::hard_link(&temporary, path) {
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
    remove_staging(&staging, false)
        .map(|()| true)
        .map_err(|_| FileError::LeftStagingCopy {
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
    publish_folder_if(target, prefix, taken, |path| {
        write(path).map(|value| (value, true))
    })
}

/// The shared publication/cleanup path also admits an expected cancellation.
fn publish_folder_if<T>(
    target: &Path,
    prefix: &str,
    taken: &str,
    write: impl FnOnce(&Path) -> Result<(T, bool), FileError>,
) -> Result<T, FileError> {
    let parent = target.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let staging = make_staging(&parent.join(prefix))?;
    let mut reservation = None;
    let result = write(&staging).and_then(|(result, proceed)| {
        if !proceed {
            remove_staging(&staging, false)?;
            return Ok(result);
        }
        stop_if_signalled()?;
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
    fn large_file_reads_never_grow_the_admitted_buffer() {
        let stable = read_fixed_large(&b"abc"[..], 3, "The public file").unwrap();
        assert_eq!(&*stable, b"abc");
        assert_eq!(stable.reserved_bytes(), 3);
        assert!(matches!(
            read_fixed_large(&b"abcd"[..], 3, "The public file"),
            Err(FileError::Changed(_))
        ));
        assert!(matches!(
            read_fixed_large(&b"ab"[..], 3, "The public file"),
            Err(FileError::Changed(_))
        ));
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
