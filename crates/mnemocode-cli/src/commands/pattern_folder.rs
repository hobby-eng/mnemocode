//! A folder of cross-stitch patterns read as Shamir shares: every PDF directly in it whose legend
//! holds a share, grouped by the set it belongs to and listed for the person to confirm before a
//! restore takes them. Nothing in the folder is written.

use std::collections::BTreeMap;
use std::path::Path;

use mnemocode_embroidery::phrase;

use super::asking::ask_list;
use crate::gate::Stop;
use crate::input::pattern_legend;
use crate::os;
use crate::output::shown_path;
use crate::terminal::{Choice, Explanation, NoticeKind, notice};

/// The most PDF files of a folder that are read.
const MAX_FILES: usize = 256;

/// The hint above a question for shares that takes a folder.
pub(crate) const FOLDER_NOTE: &str = "Patterns of shares: give the folder that holds their PDFs. If they are in different places, copy them into one folder first.";

/// A pattern of a share found in a folder.
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
    /// Whether the phrase that the set holds is masked with Seedshift.
    masked: bool,
}

/// What a folder holds of patterns.
#[derive(Default)]
struct Folder {
    shares: Vec<Found>,
    /// The names of patterns of whole backups, which Decode reads.
    whole: Vec<String>,
    /// PDF files that hold no legend that reads, or that cannot be read.
    other: usize,
    /// PDF files past the most that are read.
    left_out: usize,
}

/// Reads every PDF directly in `folder`, up to [`MAX_FILES`].
fn scan(folder: &Path) -> Result<Folder, Stop> {
    let mut files = os::pdf_files(folder).map_err(|_| os::FileError::Unreadable("The folder"))?;
    let mut found = Folder {
        left_out: files.len().saturating_sub(MAX_FILES),
        ..Folder::default()
    };
    files.truncate(MAX_FILES);
    for path in files {
        let name = path
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        let Ok(Some(line)) = pattern_legend(&path) else {
            found.other += 1;
            continue;
        };
        match phrase::share_of_legend(line.as_str()) {
            Ok(Some(read)) => {
                let info = read.share.info();
                found.shares.push(Found {
                    name,
                    share: read.share.ur().as_str().to_owned(),
                    set: info.identifier,
                    member: info.member_index + 1,
                    needed: info.member_threshold,
                    masked: read.masked,
                });
            }
            Ok(None) => found.whole.push(name),
            Err(_) => found.other += 1,
        }
    }
    Ok(found)
}

/// The shares of the patterns in `folder`, as the person confirms them after the list of what was
/// found, of one set where it holds several; none where they give another answer. A set whose
/// phrase is masked, or not, where `masked` says otherwise is not offered.
pub(crate) fn folder_shares(
    folder: &Path,
    masked: Option<bool>,
) -> Result<Option<Vec<String>>, Stop> {
    let found = scan(folder)?;
    let mut sets: BTreeMap<u16, Vec<&Found>> = BTreeMap::new();
    for share in &found.shares {
        sets.entry(share.set).or_default().push(share);
    }
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
    for name in &found.whole {
        lines.push(format!(
            "  {name}: a whole backup, not a share; Decode reads it"
        ));
    }
    match found.other {
        0 => {}
        1 => lines.push("1 other PDF file holds no legend that reads.".to_owned()),
        other => lines.push(format!(
            "{other} other PDF files hold no legend that reads."
        )),
    }
    if found.left_out > 0 {
        lines.push(format!(
            "Only the first {MAX_FILES} PDF files were read; {} were left out.",
            found.left_out
        ));
    }
    if sets.is_empty() {
        notice(
            &format!(
                "No pattern of a share in {}.",
                shown_path(&folder.to_string_lossy())
            ),
            NoticeKind::Warning,
        );
        return Ok(None);
    }
    let mut choices = Vec::new();
    for (place, shares) in sets.values().enumerate() {
        // A copy of a pattern counts once.
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
        let set_masked = shares.first().is_some_and(|share| share.masked);
        if masked.is_some_and(|told| told != set_masked) {
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
        lines,
        more: Vec::new(),
    };
    let chosen = ask_list(
        "Restore from these patterns?",
        "Patterns",
        &choices,
        Some(&explanation),
    )?;
    Ok(chosen.flatten().and_then(|place| {
        sets.values()
            .nth(place)
            .map(|shares| shares.iter().map(|share| share.share.clone()).collect())
    }))
}
