//! Where a command saves (MnemoCode TS 0.1.0's `output-paths.ts`, `cloud-folders.ts`), checked
//! before any secret is asked or read: every output path usable, the outputs apart from each other
//! and from the inputs, a taken name numbered ("record-1.txt"; reported once saved), a new
//! folder's name without a document's ending, and each output's parent folder made where it is
//! missing (ARCHITECTURE.md §5: the preflight makes it, so that Landlock can rule it before the
//! secret). The folders it gives are the command's needs (os::Needs). A cloud service that copies
//! an output's folder is warned of.

use std::ffi::OsString;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use mnemocode::refusal::Refusal;

use crate::args::{FILE_OUTPUTS, FOLDER_OUTPUTS, Given, Parsed, option_label, value, values};
use crate::os::{self, Entry, FileError, FileLook, Needs};
use crate::terminal::{self, lasting_warning, printable, warning_with_more};

/// The most numbered copies of one name.
const MAX_COPY_NUMBER: usize = 999;
/// The endings of the documents a command writes, which a new folder's name may not take.
const DOCUMENT_EXTENSIONS: [&str; 4] = ["pdf", "png", "jpg", "jpeg"];
/// The file inputs, which no output may overlap.
pub(crate) const FILE_INPUTS: [&str; 12] = [
    "mnemonic-file",
    "input-file",
    "share-file",
    "dates-file",
    "old-dates-file",
    "last-word-file",
    "share-qr",
    "candidates-key-file",
    "candidates-passphrase-file",
    "bip39-passphrase-file",
    "wif-file",
    "qr-file",
];

/// Why the outputs cannot be used.
#[derive(Debug)]
pub(crate) enum OutputError {
    /// An output given as "-" or blank.
    Unusable(&'static str),
    /// Every numbered name is taken.
    TooManyCopies(String),
    /// A new folder's name ends as a document does.
    FolderEnding(String),
    /// A folder cannot be made there.
    FolderUnwritable,
    /// A file stands where a folder should.
    FileForFolder,
    /// A folder stands where a file should.
    FolderForFile,
    /// Two outputs overlap.
    Overlapping(&'static str, &'static str),
    /// An output overlaps an input.
    OverlapsInput(&'static str, &'static str),
    /// The file system refused.
    File(FileError),
    /// A file output given as "-" or blank.
    NoFilePath,
    /// A file that must be new exists.
    FileExists,
    /// A file's folder is missing or may not be written.
    FileFolderUnwritable,
    /// A new name outside the folders that the rules on writes leave open: those folders.
    OutsideRuled(String),
    /// An output's place that cannot be told.
    NotResolved,
    /// An input that cannot be read, by its option's label.
    UnreadableInput(&'static str),
    /// A file's folder is a file.
    FileFolderIsAFile,
}

impl std::fmt::Display for OutputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unusable(label) => write!(
                f,
                "The {label} needs a path; - and empty paths are not accepted. Results always appear in the terminal."
            ),
            Self::TooManyCopies(path) => {
                write!(
                    f,
                    "{path} has too many numbered copies already. Choose another name."
                )
            }
            Self::FolderEnding(ending) => write!(
                f,
                "A new folder needs a name without .{ending}, which is the ending of a file; choose another name."
            ),
            Self::FolderUnwritable => f.write_str(
                "MnemoCode may not make a folder there; choose a folder you can write to.",
            ),
            Self::FileForFolder => f.write_str(
                "A file stands where a folder of this name should be; choose another name.",
            ),
            Self::FolderForFile => f.write_str(
                "A folder has this name; give the file another name, or a name inside that folder.",
            ),
            Self::Overlapping(left, right) => {
                write!(
                    f,
                    "The {left} and {right} must use separate, non-overlapping paths."
                )
            }
            Self::OverlapsInput(output, input) => {
                write!(f, "The {output} must not overlap the {input}.")
            }
            Self::File(error) => error.fmt(f),
            Self::NoFilePath => f.write_str(
                "File export requires a file path; - and empty paths are not accepted. Results always appear in the terminal.",
            ),
            Self::FileExists => {
                f.write_str("The output file already exists. Choose a new path.")
            }
            Self::FileFolderUnwritable => f.write_str(
                "The folder containing the output file must already exist and be writable.",
            ),
            Self::OutsideRuled(folders) => write!(
                f,
                "MnemoCode may save only in the folders ruled before the secret was asked: {folders}."
            ),
            Self::NotResolved => f.write_str("The output path could not be resolved safely."),
            Self::UnreadableInput(label) => write!(
                f,
                "The {label} could not be read. Check that the file exists and is readable."
            ),
            Self::FileFolderIsAFile => {
                f.write_str("The folder containing the output file is not a directory.")
            }
        }
    }
}

impl std::error::Error for OutputError {}

impl Refusal for OutputError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unusable(_) => {
                "cli.output-paths.path-empty-paths-not-accepted-results-always-appear"
            }
            Self::TooManyCopies(_) => {
                "cli.output-paths.too-many-numbered-copies-already-choose-another-name"
            }
            Self::FolderEnding(_) => {
                "cli.output-paths.new-folder-name-without-which-ending-file-choose"
            }
            Self::FolderUnwritable => "cli.output-paths.folder-unwritable",
            Self::FileForFolder => {
                "cli.output-paths.file-stands-where-folder-name-should-choose-another"
            }
            Self::FolderForFile => {
                "cli.output-paths.folder-name-give-file-another-name-name-inside"
            }
            Self::Overlapping(..) => "cli.output-paths.use-separate-non-overlapping-paths",
            Self::OverlapsInput(..) => "cli.output-paths.not-overlap",
            Self::File(error) => error.code(),
            Self::NoFilePath => "cli.output-paths.file-export-requires-file-path-empty-paths-not",
            Self::FileExists => "cli.output-paths.output-file-already-exists-choose-new-path",
            Self::FileFolderUnwritable => "cli.output-paths.folder-unwritable-file",
            Self::OutsideRuled(_) => "cli.output-paths.outside-ruled-folders",
            Self::NotResolved => "cli.output-paths.output-path-could-not-resolved-safely",
            Self::UnreadableInput(label) => FileError::Unreadable(label).code(),
            Self::FileFolderIsAFile => "cli.output-paths.folder-file",
        }
    }
}

impl From<FileError> for OutputError {
    fn from(error: FileError) -> Self {
        Self::File(error)
    }
}

/// Whether `path` is no output path: blank, or "-".
fn unusable(path: &str) -> bool {
    path.trim().is_empty() || path == "-"
}

/// `path` of an option, made absolute against the folder the program started in.
pub(crate) fn resolved(path: &str) -> PathBuf {
    os::resolve(Path::new(path), terminal::environment().current.as_deref())
}

/// Whether `child` is `parent` or lies inside it, by their resolved names.
fn within(parent: &Path, child: &Path) -> bool {
    child.starts_with(parent)
}

/// `path` with `-number` before its ending (none for a folder): "cards-2.pdf".
fn numbered_name(path: &str, number: usize, folder: bool) -> String {
    let trimmed = path.trim_end_matches(['/', std::path::MAIN_SEPARATOR]);
    let name_start = trimmed
        .rfind(['/', std::path::MAIN_SEPARATOR])
        .map_or(0, |at| at + 1);
    let ending = if folder {
        None
    } else {
        trimmed[name_start..]
            .rfind('.')
            .filter(|&at| at > 0)
            .map(|at| name_start + at)
    };
    match ending {
        Some(at) => format!("{}-{number}{}", &trimmed[..at], &trimmed[at..]),
        None => format!("{trimmed}-{number}"),
    }
}

/// `path`, or where something is there its first numbered name that nothing takes.
pub(crate) fn first_free_name(path: &str) -> Result<String, OutputError> {
    if os::entry_at(&resolved(path)).map_err(FileError::from)? == Entry::None {
        return Ok(path.to_owned());
    }
    first_free_numbered(path, false)
}

/// The first numbered name of `path` that nothing takes.
fn first_free_numbered(path: &str, folder: bool) -> Result<String, OutputError> {
    for number in 1..=MAX_COPY_NUMBER {
        let free = numbered_name(path, number, folder);
        if os::entry_at(&resolved(&free)).map_err(FileError::from)? == Entry::None {
            return Ok(free);
        }
    }
    Err(OutputError::TooManyCopies(printable(path)))
}

/// The outputs of a run that were numbered, the name used and the name given: one record for the
/// process, as a result that is not saved after all drops out of it wherever it is decided.
static RENAMED: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// The record of numbered names; a poisoned lock holds names, which stay usable.
fn renamed() -> MutexGuard<'static, Vec<(String, String)>> {
    RENAMED.lock().unwrap_or_else(PoisonError::into_inner)
}

/// For a result at `path` that was not saved after all: its numbered name is not reported.
pub(crate) fn discard_renamed(path: &str) {
    renamed().retain(|(used, _)| used != path);
}

/// Says, once each is saved, which taken names were numbered.
pub(crate) fn report_renamed() {
    for (used, given) in renamed().drain(..) {
        lasting_warning(&format!(
            "{} already exists: saved as {} instead.",
            printable(&given),
            printable(&used)
        ));
    }
}

/// Refuses the output `key` given as no path.
pub(crate) fn check_usable(key: &str, path: &str) -> Result<(), OutputError> {
    if unusable(path) {
        return Err(OutputError::Unusable(option_label(key)));
    }
    Ok(())
}

/// Refuses a new name outside the folders that the rules on writes leave open, naming them: the
/// system would refuse the save, whatever else may be said of the folder.
pub(crate) fn check_ruled(path: &str) -> Result<(), OutputError> {
    let Some(ruled) = os::ruled_folders() else {
        return Ok(());
    };
    let target = resolved(path);
    if ruled.iter().any(|folder| target.starts_with(folder)) {
        return Ok(());
    }
    let names: Vec<String> = ruled
        .iter()
        .map(|folder| terminal::printable(&folder.to_string_lossy()))
        .collect();
    Err(OutputError::OutsideRuled(names.join(", ")))
}

/// The nearest of `folder` and the folders above it that exists, its links resolved, and the names
/// below it that do not exist yet, from the top; none when one cannot be looked at.
fn nearest_existing(folder: &Path) -> Option<(PathBuf, Vec<OsString>)> {
    let mut missing = Vec::new();
    let mut ancestor = folder;
    loop {
        match os::real_path(ancestor) {
            Ok(real) => {
                missing.reverse();
                return Some((real, missing));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(ancestor.file_name()?.to_owned());
                ancestor = ancestor.parent()?;
            }
            Err(_) => return None,
        }
    }
}

/// Where the output `path` lands, the links of the folders that exist resolved.
fn effective_output_path(path: &str) -> Result<PathBuf, OutputError> {
    let absolute = resolved(path);
    let parent = absolute.parent().unwrap_or(&absolute);
    let (mut real, missing) = nearest_existing(parent).ok_or(OutputError::NotResolved)?;
    real.extend(missing);
    real.extend(absolute.file_name());
    Ok(real)
}

/// Refuses outputs that overlap each other or an input, or an input that cannot be read, by where
/// they lie, their links resolved (validateOutputPaths).
pub(crate) fn validate_output_paths(parsed: &Parsed) -> Result<(), OutputError> {
    let outputs = outputs_of(parsed);
    for (key, path) in &outputs {
        check_usable(key, path)?;
    }
    let effective: Vec<(&'static str, PathBuf)> = outputs
        .iter()
        .map(|(key, path)| Ok((*key, effective_output_path(path)?)))
        .collect::<Result<_, OutputError>>()?;
    for (index, (left_key, left)) in effective.iter().enumerate() {
        for (right_key, right) in effective.iter().skip(index + 1) {
            if overlap(left, right) {
                return Err(OutputError::Overlapping(
                    option_label(left_key),
                    option_label(right_key),
                ));
            }
        }
        for key in FILE_INPUTS {
            for source in values(parsed, key) {
                if source == "-" {
                    continue;
                }
                let input = os::real_path(&resolved(source))
                    .map_err(|_| OutputError::UnreadableInput(option_label(key)))?;
                if overlap(left, &input) {
                    return Err(OutputError::OverlapsInput(
                        option_label(left_key),
                        option_label(key),
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Whether `left` and `right` are one place, or one lies in the other.
fn overlap(left: &Path, right: &Path) -> bool {
    within(left, right) || within(right, left)
}

/// The outputs that `parsed` names, each with its option.
fn outputs_of(parsed: &Parsed) -> Vec<(&'static str, String)> {
    FILE_OUTPUTS
        .iter()
        .chain(FOLDER_OUTPUTS.iter())
        .filter_map(|key| value(parsed, key).map(|path| (*key, path.to_owned())))
        .collect()
}

/// Gives each output whose name is taken its first free numbered name, in `parsed` (RenamedOutputs.
/// settle). A folder given for a file, and an input of the command itself, are left for the checks
/// that refuse them: a result named like its own input is a mistake, not a copy.
fn settle(parsed: &mut Parsed) -> Result<(), OutputError> {
    let real_or_resolved = |path: &str| {
        let absolute = resolved(path);
        os::real_path(&absolute).unwrap_or(absolute)
    };
    let inputs: Vec<PathBuf> = FILE_INPUTS
        .iter()
        .flat_map(|key| values(parsed, key))
        .filter(|source| *source != "-")
        .map(real_or_resolved)
        .collect();
    for (key, path) in outputs_of(parsed) {
        if unusable(&path) {
            continue;
        }
        let folder = FOLDER_OUTPUTS.contains(&key);
        let taken = os::entry_at(&resolved(&path)).map_err(FileError::from)?;
        if taken == Entry::None
            || (taken == Entry::Folder && !folder)
            || inputs.contains(&real_or_resolved(&path))
        {
            continue;
        }
        let free = first_free_numbered(&path, folder)?;
        renamed().push((free.clone(), path));
        parsed.insert(key.to_owned(), Given::One(free));
    }
    Ok(())
}

/// The preflight of a command's outputs, before any secret: a taken name numbered in `parsed`,
/// refusals as above, each missing parent folder made, and the folders the command writes beneath,
/// for the protections.
pub(crate) fn preflight(parsed: &mut Parsed) -> Result<Needs, OutputError> {
    settle(parsed)?;
    validate_output_paths(parsed)?;
    let mut needs = Needs::default();
    for (key, path) in outputs_of(parsed) {
        let folder = FOLDER_OUTPUTS.contains(&key);
        if folder {
            check_folder_name(&path)?;
        }
        let target = resolved(&path);
        if !folder && os::entry_at(&target).map_err(FileError::from)? == Entry::Folder {
            return Err(OutputError::FolderForFile);
        }
        let parent = target.parent().map(Path::to_path_buf).unwrap_or_default();
        make_parent(&parent)?;
        if !os::may_write(&parent) {
            return Err(if folder {
                OutputError::FolderUnwritable
            } else {
                OutputError::FileFolderUnwritable
            });
        }
        if !needs.folders.contains(&parent) {
            needs.folders.push(parent);
        }
    }
    Ok(needs)
}

/// Refuses a new file's name that cannot be saved: an unusable name, something there already, a
/// file for its folder, a folder that may not be written. Only looks; the save decides.
pub(crate) fn check_new_file(path: &str, may_exist: bool) -> Result<(), OutputError> {
    if unusable(path) {
        return Err(OutputError::NoFilePath);
    }
    let target = resolved(path);
    let taken = os::entry_at(&target).map_err(|error| {
        // A name under a file, or a folder that cannot be looked into.
        if error.kind() == io::ErrorKind::NotADirectory {
            OutputError::FileFolderIsAFile
        } else {
            OutputError::FileFolderUnwritable
        }
    })?;
    if taken != Entry::None && !may_exist {
        return Err(OutputError::FileExists);
    }
    if taken == Entry::Folder {
        return Err(OutputError::FolderForFile);
    }
    let parent = target.parent().unwrap_or(Path::new("."));
    match os::look_at_file(parent) {
        Ok(FileLook::Folder) if os::may_write(parent) => Ok(()),
        Ok(FileLook::File { .. } | FileLook::NoFile) => Err(OutputError::FileFolderIsAFile),
        _ => Err(OutputError::FileFolderUnwritable),
    }
}

/// Refuses a new folder's name that cannot be made: one that ends as a document does, a file on the
/// way, a folder above it that may not be written. The folders of its path that do not exist yet
/// are made with it, so the nearest that exists is checked.
pub(crate) fn check_new_folder(path: &str) -> Result<(), OutputError> {
    check_folder_name(path)?;
    let target = resolved(path);
    let parent = target.parent().unwrap_or(&target);
    let (existing, _) = nearest_existing(parent).ok_or(OutputError::FolderUnwritable)?;
    if os::entry_at(&existing).map_err(FileError::from)? == Entry::Other {
        return Err(OutputError::FileForFolder);
    }
    if os::may_write(&existing) {
        Ok(())
    } else {
        Err(OutputError::FolderUnwritable)
    }
}

/// Whether `left` and `right` are one place, or one lies in the other, by their resolved names.
pub(crate) fn paths_overlap(left: &str, right: &str) -> bool {
    overlap(&resolved(left), &resolved(right))
}

/// Warns of one output that a cloud service copies, as a name chosen after a failed save is.
pub(crate) fn warn_of_cloud_copy(path: &str) {
    if let Some(service) = cloud_service_of(&resolved(path)) {
        let message = format!(
            "{} keeps a copy of {}",
            printable(&service),
            printable(path)
        );
        warning_with_more(&message, "cloud-folders");
    }
}

/// Refuses a new folder's name that ends as a document does.
fn check_folder_name(path: &str) -> Result<(), OutputError> {
    let trimmed = path.trim_end_matches(['/', std::path::MAIN_SEPARATOR]);
    let name = Path::new(trimmed)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    // As Node's extname: a leading dot starts a name, it ends none.
    if let Some(ending) = Path::new(&name).extension() {
        let ending = ending.to_string_lossy().to_lowercase();
        if DOCUMENT_EXTENSIONS.contains(&ending.as_str()) {
            return Err(OutputError::FolderEnding(ending));
        }
    }
    Ok(())
}

/// Makes `folder` with every missing folder above it; refused where a file stands on the way or
/// the system refuses.
fn make_parent(folder: &Path) -> Result<(), OutputError> {
    let (existing, _) = nearest_existing(folder).ok_or(OutputError::FolderUnwritable)?;
    if os::entry_at(&existing).map_err(FileError::from)? == Entry::Other {
        return Err(OutputError::FileForFolder);
    }
    os::make_folders(folder).map_err(|_| OutputError::FolderUnwritable)
}

/// The cloud service that synchronises `path`, by the names services give their folders.
pub(crate) fn cloud_service_of(path: &Path) -> Option<String> {
    let environment = terminal::environment();
    if environment
        .onedrive
        .iter()
        .any(|folder| within(folder, path))
    {
        return Some("OneDrive".to_owned());
    }
    if let Some(home) = &environment.home {
        let storage = home.join("Library").join("CloudStorage");
        if let Ok(rest) = path.strip_prefix(&storage)
            && let Some(Component::Normal(provider)) = rest.components().next()
        {
            let provider = provider.to_string_lossy();
            return Some(known_service(&provider).map_or_else(
                || provider.split('-').next().unwrap_or_default().to_owned(),
                str::to_owned,
            ));
        }
    }
    // The folders above the file or new folder; its own name says nothing.
    let parents: Vec<String> = path
        .parent()
        .into_iter()
        .flat_map(Path::components)
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    parents
        .iter()
        .find_map(|folder| known_service(folder).map(str::to_owned))
}

/// The service a folder's name belongs to, compared without case.
fn known_service(folder: &str) -> Option<&'static str> {
    let name = folder.to_lowercase();
    let parenthesised = |prefix: &str| {
        name.strip_prefix(prefix)
            .is_some_and(|rest| rest.is_empty() || (rest.starts_with(" (") && rest.ends_with(')')))
    };
    if parenthesised("dropbox") {
        return Some("Dropbox");
    }
    if name == "onedrive" || name.starts_with("onedrive - ") {
        return Some("OneDrive");
    }
    if name == "google drive" || name == "my drive" || name.starts_with("googledrive-") {
        return Some("Google Drive");
    }
    if ["icloud drive", "mobile documents", "com~apple~clouddocs"].contains(&name.as_str())
        || name.starts_with("icloud~")
    {
        return Some("iCloud Drive");
    }
    if name == "yandex.disk" || name == "yandexdisk" {
        return Some("Yandex Disk");
    }
    if name == "nextcloud" || name == "owncloud" {
        return Some("Nextcloud");
    }
    if name == "mega" || name == "megasync" {
        return Some("MEGA");
    }
    if name == "pcloud drive" || name == "pclouddrive" {
        return Some("pCloud");
    }
    None
}

/// Warns, with a link to the README, of each output that a cloud service copies.
pub(crate) fn warn_of_cloud_copies(parsed: &Parsed) {
    for key in FILE_OUTPUTS.iter().chain(FOLDER_OUTPUTS.iter()) {
        if let Some(path) = value(parsed, key) {
            warn_of_cloud_copy(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_taken_name_is_numbered_before_its_ending() {
        assert_eq!(numbered_name("out/cards.pdf", 2, false), "out/cards-2.pdf");
        assert_eq!(numbered_name("out/cards/", 1, true), "out/cards-1");
        assert_eq!(numbered_name(".hidden", 3, false), ".hidden-3");
    }

    #[test]
    fn cloud_folders_are_told_by_their_names() {
        assert_eq!(known_service("Dropbox (Personal)"), Some("Dropbox"));
        assert_eq!(known_service("OneDrive - Company"), Some("OneDrive"));
        assert_eq!(known_service("Documents"), None);
        assert_eq!(
            cloud_service_of(Path::new("/home/a/Dropbox/x/record.txt")).as_deref(),
            Some("Dropbox")
        );
    }

    #[test]
    fn a_folder_name_with_a_document_ending_is_refused() {
        assert!(
            matches!(check_folder_name("cards.pdf/"), Err(OutputError::FolderEnding(ending)) if ending == "pdf")
        );
        assert!(check_folder_name("cards").is_ok());
    }

    #[test]
    fn a_folder_named_as_an_output_file_is_refused_before_anything_is_made() {
        // The crate's own source folder: it exists, and nothing is written when it is refused.
        let folder = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut parsed = Parsed::new();
        parsed.insert("output".to_owned(), Given::One(folder.to_owned()));
        let refusal = preflight(&mut parsed).err();
        assert!(matches!(refusal, Some(OutputError::FolderForFile)));
        assert_eq!(
            refusal.map(|refusal| refusal.to_string()).as_deref(),
            Some(
                "A folder has this name; give the file another name, or a name inside that folder."
            )
        );
    }
}
