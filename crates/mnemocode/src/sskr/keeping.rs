//! What saved shares are kept with (MnemoCode TS 0.1.0's `src/export/sskr-keeping-text.ts`,
//! CAP-CARDS-SHARE-KEEPING-NOTE): how many of the shares restore what, and where each share is in
//! what was saved. Text only, so share files get it without the cards crate.

use std::fmt;

use super::set::{ConflictKind, first_conflict};
use super::share::{Share, ShareInfo};
use crate::modes::phrase_words;
use crate::refusal::Refusal;
use crate::search::plan::counted;

/// How the cards or records of the shares were saved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Packaging {
    /// One file holds every share.
    File,
    /// One folder holds every share.
    Folder,
    /// One file for each share.
    Files,
    /// One folder of separate cards for each share.
    Folders,
    /// Numbered page images for each share.
    Pages,
}

impl Packaging {
    /// Every packaging, as the refusal of an unknown one lists them.
    pub const ALL: [Self; 5] = [
        Self::File,
        Self::Folder,
        Self::Files,
        Self::Folders,
        Self::Pages,
    ];

    /// Its name.
    pub const fn name(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Folder => "folder",
            Self::Files => "files",
            Self::Folders => "folders",
            Self::Pages => "pages",
        }
    }

    /// The packaging `name` names; refused with the list of them.
    pub fn named(name: &str) -> Result<Self, KeepingError> {
        Self::ALL
            .into_iter()
            .find(|packaging| packaging.name() == name)
            .ok_or(KeepingError::Packaging)
    }

    /// Where each share is in what was saved.
    const fn layout(self) -> &'static str {
        match self {
            Self::File => "the file holds every share",
            Self::Folder => "the folder holds every share",
            Self::Files => "each file is one share",
            Self::Folders => "each folder is one share and needs all its cards",
            Self::Pages => "the numbered pages of each share belong together",
        }
    }
}

/// The refusals of a keeping note, word for word as TS 0.1.0 writes them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeepingError {
    /// No share.
    NoShares,
    /// Shares of no one set.
    Conflict(ConflictKind),
    /// A packaging not named.
    Packaging,
}

impl fmt::Display for KeepingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoShares => f.write_str("There are no shares to keep."),
            Self::Conflict(kind) => {
                write!(f, "{} Only the shares of one set are kept.", kind.refusal())
            }
            Self::Packaging => write!(
                f,
                "Name how the shares were saved, as one of: {}.",
                Packaging::ALL.map(Packaging::name).join(", ")
            ),
        }
    }
}

impl std::error::Error for KeepingError {}

impl Refusal for KeepingError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoShares => "export.sskr-keeping-text.there-no-shares-keep",
            Self::Conflict(ConflictKind::Set) => {
                "export.sskr-keeping-text.shares-of-different-sets"
            }
            Self::Conflict(ConflictKind::Member) => "export.sskr-keeping-text.member-given-twice",
            Self::Conflict(ConflictKind::Threshold) => {
                "export.sskr-keeping-text.group-thresholds-conflict"
            }
            Self::Packaging => "export.sskr-keeping-text.packaging-unknown",
        }
    }
}

/// How many of `count` shares of a group of `threshold` restore it, for `goal`.
fn single_group_quorum(count: usize, threshold: usize, goal: &str, noun: &str) -> String {
    if count < threshold {
        return format!("These shares are fewer than the {threshold} needed {goal}");
    }
    if threshold == 1 {
        return format!("Any single share is enough {goal}");
    }
    if threshold == count {
        return format!("All {} are needed {goal}", counted(count as u64, noun));
    }
    format!(
        "Any {threshold} of the {} are enough {goal}",
        counted(count as u64, noun)
    )
}

/// How many of `shares`, of one set, restore the phrase, an exact copy counted once; shares of no
/// one set refused.
fn quorum(shares: &[Share], masked: bool) -> Result<String, KeepingError> {
    let goal = if masked {
        format!(
            "to restore {}, which the owner's dates turn back into {}",
            phrase_words::MASKED,
            phrase_words::ORIGINAL
        )
    } else {
        "for recovery".to_owned()
    };
    let mut kept: Vec<&Share> = Vec::new();
    for share in shares {
        if !kept.iter().any(|other| other.payload() == share.payload()) {
            kept.push(share);
        }
    }
    let infos: Vec<ShareInfo> = kept.iter().map(|share| share.info()).collect();
    if let Some(conflict) = first_conflict(&infos, 0) {
        return Err(KeepingError::Conflict(conflict.kind));
    }
    let info = infos[0];
    if info.group_count > 1 {
        return Ok(format!(
            "These shares belong to {} groups, each needing enough of its own {goal}",
            info.group_count
        ));
    }
    let repeated = infos.len() < shares.len();
    let noun = if repeated { "distinct share" } else { "share" };
    let text = single_group_quorum(infos.len(), info.member_threshold, &goal, noun);
    Ok(if repeated {
        format!("{text}; repeated copies count as one share")
    } else {
        text
    })
}

/// How the shares saved as `packaging` are kept: how many restore what, the phrase before the
/// split `masked` by a Seedshift or not, and where each share is. Refuses no share, and shares of
/// no one set.
pub fn share_keeping_note(
    shares: &[Share],
    packaging: Packaging,
    masked: bool,
) -> Result<String, KeepingError> {
    if shares.is_empty() {
        return Err(KeepingError::NoShares);
    }
    Ok(format!(
        "{}; {}. Store the shares apart.",
        quorum(shares, masked)?,
        packaging.layout()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sskr::forms::read_share;
    use crate::sskr::testing::vector;

    #[test]
    fn the_note_says_the_quorum_and_where_each_share_is() {
        let (urs, _) = vector(0);
        let shares: Vec<Share> = urs.iter().map(|ur| read_share(ur).unwrap().share).collect();
        let threshold = shares[0].info().member_threshold;
        assert_eq!(
            share_keeping_note(&shares, Packaging::Files, false).unwrap(),
            format!(
                "Any {threshold} of the 3 shares are enough for recovery; each file is one share. Store the shares apart."
            )
        );
        let repeated = [shares[0].copy(), shares[0].copy()];
        assert!(
            share_keeping_note(&repeated, Packaging::File, true)
                .unwrap()
                .starts_with(&format!("These shares are fewer than the {threshold} needed to restore the masked phrase (decoy)"))
        );
        assert_eq!(
            share_keeping_note(&[], Packaging::File, false).unwrap_err(),
            KeepingError::NoShares
        );
    }
}
