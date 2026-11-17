//! A folder of Shamir shares kept as files: every cross-stitch pattern's PDF and every QR code
//! image directly in it that holds a share, grouped by the set it belongs to and listed for the
//! person to confirm before a restore takes them. Patterns of whole backups are named apart, and
//! Decode reads one alone. Nothing in the folder is written.

use std::collections::BTreeMap;
use std::path::Path;

use mnemocode::secret::SecretText;
use mnemocode::sskr::forms::read_share;
use mnemocode::sskr::share::Share;
use mnemocode_embroidery::{legend, phrase};

use super::asking::ask_list;
use crate::gate::Stop;
use crate::input::pattern_legend;
use crate::os;
use crate::output::shown_path;
use crate::terminal::{Choice, Explanation, NoticeKind, notice};

/// The most files of a folder that are read.
const MAX_FILES: usize = 256;

/// The hint above a question for shares that takes a folder.
pub(crate) const FOLDER_NOTE: &str = "Shares saved as files, such as cross-stitch patterns or QR code images: give the folder that holds them. If they are in different places, copy them into one folder first.";

/// A share found in a folder.
struct Found {
    /// Its file's name.
    name: String,
    /// The share, as a share's code (ur:sskr/…).
    share: String,
    /// The set it belongs to.
    set: u16,
    /// Its number in the set, from 1.
    member: usize,
    /// How many shares of the set restore the phrase.
    needed: usize,
    /// Whether the phrase that the set holds is masked with Seedshift, where a pattern's legend
    /// says so; a share's code does not.
    masked: Option<bool>,
}

/// What a folder holds.
#[derive(Default)]
struct Folder {
    shares: Vec<Found>,
    /// The patterns of whole backups: each file's name and its legend line.
    whole: Vec<(String, SecretText)>,
    /// Files that hold no share or legend that reads, or that cannot be read.
    other: usize,
    /// Files past the most that are read.
    left_out: usize,
}

/// What one file holds.
enum Held {
    Share(Share, Option<bool>),
    Whole(SecretText),
    Nothing,
}

/// What the text of a file, a legend line or a share's code, holds.
fn held_in(text: &str) -> Held {
    if legend::is_line(text) {
        return match phrase::share_of_legend(text) {
            Ok(Some(read)) => Held::Share(read.share, Some(read.masked)),
            Ok(None) => Held::Whole(SecretText::copy_of("a legend", text)),
            Err(_) => Held::Nothing,
        };
    }
    read_share(text).map_or(Held::Nothing, |read| Held::Share(read.share, None))
}

/// What the file at `path` holds: a pattern's PDF or a QR code image.
fn held_at(path: &Path) -> Held {
    let pdf = path
        .extension()
        .is_some_and(|ending| ending.eq_ignore_ascii_case("pdf"));
    let text = if pdf {
        pattern_legend(path).ok().flatten()
    } else {
        super::given::read_qr_path(path, true).ok()
    };
    text.map_or(Held::Nothing, |text| held_in(text.as_str()))
}

/// Reads every PDF and PNG file directly in `folder`, up to [`MAX_FILES`].
fn scan(folder: &Path) -> Result<Folder, Stop> {
    let mut files = os::files_ending(folder, &["pdf", "png"])
        .map_err(|_| os::FileError::Unreadable("The folder"))?;
    let mut found = Folder {
        left_out: files.len().saturating_sub(MAX_FILES),
        ..Folder::default()
    };
    files.truncate(MAX_FILES);
    for path in files {
        let name = path
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        match held_at(&path) {
            Held::Share(share, masked) => {
                let info = share.info();
                found.shares.push(Found {
                    name,
                    share: share.ur().as_str().to_owned(),
                    set: info.identifier,
                    member: info.member_index + 1,
                    needed: info.member_threshold,
                    masked,
                });
            }
            Held::Whole(line) => found.whole.push((name, line)),
            Held::Nothing => found.other += 1,
        }
    }
    Ok(found)
}

/// The shares of `found` by set, in the order of their sets.
fn sets_of(found: &Folder) -> BTreeMap<u16, Vec<&Found>> {
    let mut sets: BTreeMap<u16, Vec<&Found>> = BTreeMap::new();
    for share in &found.shares {
        sets.entry(share.set).or_default().push(share);
    }
    sets
}

/// The lines that list what `found` in `folder` holds.
fn listed(folder: &Path, found: &Folder, sets: &BTreeMap<u16, Vec<&Found>>) -> Vec<String> {
    let mut lines = vec![format!("In {}:", shown_path(&folder.to_string_lossy()))];
    let several = sets.len() > 1;
    for (place, shares) in sets.values().enumerate() {
        for share in shares {
            let set = if several {
                format!(", set {}", place + 1)
            } else {
                String::new()
            };
            lines.push(format!("  {}: share {}{set}", share.name, share.member));
        }
    }
    for (name, _) in &found.whole {
        lines.push(format!("  {name}: a whole backup, not a share"));
    }
    match found.other {
        0 => {}
        1 => lines.push("1 other file holds no share.".to_owned()),
        other => lines.push(format!("{other} other files hold no share.")),
    }
    if found.left_out > 0 {
        lines.push(format!(
            "Only the first {MAX_FILES} files were read; {} were left out.",
            found.left_out
        ));
    }
    lines
}

/// The shares of the set the person confirms after the list of what `found` in `folder` holds,
/// of one set where it holds several; none where they give another answer. A set whose phrase is
/// masked, or not, where `masked` says otherwise is not offered.
fn confirmed_set(
    folder: &Path,
    found: &Folder,
    masked: Option<bool>,
) -> Result<Option<Vec<String>>, Stop> {
    let sets = sets_of(found);
    let several = sets.len() > 1;
    let mut choices = Vec::new();
    for (place, shares) in sets.values().enumerate() {
        // A copy of a share counts once.
        let mut members: Vec<usize> = shares.iter().map(|share| share.member).collect();
        members.sort_unstable();
        members.dedup();
        let numbers: Vec<String> = members.iter().map(ToString::to_string).collect();
        let needed = shares.first().map_or(0, |share| share.needed);
        let label = if several {
            format!("Set {}: shares {}", place + 1, numbers.join(", "))
        } else {
            format!("Use shares {}", numbers.join(", "))
        };
        let mut choice = Choice::noted(&label, &format!("{needed} needed"), Some(place));
        let set_masked = shares.iter().find_map(|share| share.masked);
        if let (Some(told), Some(set_masked)) = (masked, set_masked)
            && told != set_masked
        {
            choice.enabled = false;
            choice.note = Some(if set_masked {
                "masked with Seedshift: restore it with Seedshift".to_owned()
            } else {
                "not masked: restore it without Seedshift".to_owned()
            });
        }
        choices.push(choice);
    }
    choices.push(Choice::noted(
        "Another answer",
        "another folder, files or shares",
        None,
    ));
    let explanation = Explanation {
        lines: listed(folder, found, &sets),
        more: Vec::new(),
    };
    let chosen = ask_list(
        "Restore from these shares?",
        "Shares",
        &choices,
        Some(&explanation),
    )?;
    Ok(chosen.flatten().and_then(|place| {
        sets.values()
            .nth(place)
            .map(|shares| shares.iter().map(|share| share.share.clone()).collect())
    }))
}

/// The shares in `folder`, as the person confirms them after the list of what was found; none where
/// it holds no share or they give another answer. A set whose phrase is masked, or not, where
/// `masked` says otherwise is not offered.
pub(crate) fn folder_shares(
    folder: &Path,
    masked: Option<bool>,
) -> Result<Option<Vec<String>>, Stop> {
    let found = scan(folder)?;
    if found.shares.is_empty() {
        notice(
            &format!("No share in {}.", shown_path(&folder.to_string_lossy())),
            NoticeKind::Warning,
        );
        return Ok(None);
    }
    confirmed_set(folder, &found, masked)
}

/// What Decode reads of `folder`: the legend of its one pattern of a whole backup, or the shares of
/// the set the person confirms where `asking`, else of its one set, a share to a line, which Decode
/// sends to the restore.
///
/// # Errors
///
/// `cli.pattern-folder.nothing` where it holds neither, and `cli.pattern-folder.several` where it
/// holds patterns of several whole backups and no share.
pub(crate) fn folder_backup(folder: &Path, asking: bool) -> Result<SecretText, Stop> {
    let found = scan(folder)?;
    if found.shares.is_empty() {
        let mut whole = found.whole;
        return match whole.len() {
            0 => Err(FolderError::Nothing.into()),
            1 => Ok(whole.remove(0).1),
            _ => Err(FolderError::Several.into()),
        };
    }
    let sets = sets_of(&found);
    let shares = if asking {
        confirmed_set(folder, &found, None)?.ok_or(Stop::Cancelled)?
    } else if sets.len() == 1 {
        found
            .shares
            .iter()
            .map(|share| share.share.clone())
            .collect()
    } else {
        return Err(FolderError::Sets.into());
    };
    let mut text = String::new();
    for share in shares {
        text.push_str(&share);
        text.push('\n');
    }
    Ok(SecretText::copy_of("the shares of a folder", &text))
}

/// Why a folder gives Decode nothing to read.
#[derive(Debug)]
enum FolderError {
    Nothing,
    Several,
    Sets,
}

impl std::fmt::Display for FolderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Nothing => "The folder holds no cross-stitch pattern or QR code of a backup.",
            Self::Several => {
                "The folder holds patterns of several backups: give the PDF of the one to read."
            }
            Self::Sets => {
                "The folder holds shares of several sets: put the shares of one set in a folder of their own."
            }
        })
    }
}

impl std::error::Error for FolderError {}

impl mnemocode::refusal::Refusal for FolderError {
    fn code(&self) -> &'static str {
        match self {
            Self::Nothing => "cli.pattern-folder.nothing",
            Self::Several => "cli.pattern-folder.several",
            Self::Sets => "cli.pattern-folder.sets",
        }
    }
}
