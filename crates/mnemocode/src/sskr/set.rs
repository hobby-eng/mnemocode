//! The facts of a set of shares (MnemoCode TS 0.1.0's `src/sskr/set-topology.ts` and the set check
//! of `transport.ts`, CAP-SSKR-SET-CHECK and CAP-SSKR-SET-CHOICE): which set and member a share is,
//! the groups with their thresholds, which groups are complete and whether they are enough, the
//! first two shares that cannot both be right, and the check of a set before the engine sees it.

use std::fmt;

use super::forms::{ReadShare, ShareTextError, read_share};
use super::share::{MAX_GROUP_MEMBERS, MAX_GROUPS, ShareInfo};
use crate::refusal::Refusal;

/// The shares of one set at most: every member of every group.
pub const MAX_SET_SHARES: usize = MAX_GROUPS * MAX_GROUP_MEMBERS;

/// The least threshold whose shares keep a digest beside the secret: with 1 the secret is copied
/// into every share and nothing checks it.
pub const MIN_DIGEST_THRESHOLD: usize = 2;

/// What two shares that cannot both be right are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictKind {
    /// Of another set than the reference.
    Set,
    /// The same member twice.
    Member,
    /// Two thresholds for one group.
    Threshold,
}

impl ConflictKind {
    /// The refusal that names no share.
    pub const fn refusal(self) -> &'static str {
        match self {
            Self::Set => "SSKR shares belong to different sets.",
            Self::Member => "The same SSKR member was supplied more than once.",
            Self::Threshold => "Conflicting SSKR group thresholds.",
        }
    }

    /// What two or more shares named by their places are: "Shares 1 and 2 are of different sets".
    pub const fn between(self) -> &'static str {
        match self {
            Self::Set => "are of different sets",
            Self::Member => "are the same member of the set but differ",
            Self::Threshold => "give their group different thresholds",
        }
    }
}

/// Two shares that cannot both be right, by their indexes from 0 in the order given.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetConflict {
    /// What they are.
    pub kind: ConflictKind,
    /// The share that conflicts.
    pub at: usize,
    /// The share it conflicts with: the reference for a set, an earlier share otherwise.
    pub with: usize,
}

/// The refusals of a set, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SetError {
    /// No share, or more than a set has.
    Count,
    /// A share that does not read.
    Read(ShareTextError),
    /// Two shares that cannot both be right.
    Conflict(ConflictKind),
    /// Too few shares for the set's threshold.
    NotEnough,
}

impl fmt::Display for SetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Count => write!(f, "Provide between 1 and {MAX_SET_SHARES} SSKR shares."),
            Self::Read(error) => error.fmt(f),
            Self::Conflict(kind) => f.write_str(kind.refusal()),
            Self::NotEnough => {
                f.write_str("Not enough SSKR shares to meet the recorded threshold.")
            }
        }
    }
}

impl std::error::Error for SetError {}

impl Refusal for SetError {
    fn code(&self) -> &'static str {
        match self {
            Self::Count => "sskr.transport.assert-share-count-refused",
            Self::Read(error) => error.code(),
            Self::Conflict(ConflictKind::Set) => "sskr.transport.shares-of-different-sets",
            Self::Conflict(ConflictKind::Member) => "sskr.transport.member-given-twice",
            Self::Conflict(ConflictKind::Threshold) => "sskr.transport.group-thresholds-conflict",
            Self::NotEnough => "sskr.transport.not-enough-sskr-shares-meet-recorded-threshold",
        }
    }
}

/// Refuses a count of shares that is no whole set's: none, or more than every member of every
/// group. Checked before any share is read or searched.
pub fn check_share_count(count: usize) -> Result<(), SetError> {
    if (1..=MAX_SET_SHARES).contains(&count) {
        Ok(())
    } else {
        Err(SetError::Count)
    }
}

/// Whether `threshold` of `count` is a quorum that a recorded group can have: from 1, no more than
/// there are, and at most a group's members.
pub const fn is_recorded_quorum(threshold: usize, count: usize) -> bool {
    threshold >= 1 && count >= threshold && count <= MAX_GROUP_MEMBERS
}

/// What the shares of one set agree on: identifier, group threshold and count, secret length.
pub(crate) type SetKey = (u16, usize, usize, usize);

/// The [`SetKey`] of a share.
pub(crate) const fn set_of(info: &ShareInfo) -> SetKey {
    (
        info.identifier,
        info.group_threshold,
        info.group_count,
        info.secret_length,
    )
}

/// One member of a set, which no two different shares may be.
pub const fn member_of(info: &ShareInfo) -> (usize, usize) {
    (info.group_index, info.member_index)
}

/// The first share, in order, that conflicts with one before it: of another set than the share at
/// `reference`, the same member as an earlier share, or another threshold for its group than an
/// earlier share's. None when there is none.
pub fn first_conflict(infos: &[ShareInfo], reference: usize) -> Option<SetConflict> {
    let set = set_of(infos.get(reference)?);
    for (at, info) in infos.iter().enumerate() {
        if set_of(info) != set {
            return Some(SetConflict {
                kind: ConflictKind::Set,
                at,
                with: reference,
            });
        }
        let earlier = &infos[..at];
        if let Some(with) = earlier
            .iter()
            .position(|other| member_of(other) == member_of(info))
        {
            return Some(SetConflict {
                kind: ConflictKind::Member,
                at,
                with,
            });
        }
        if let Some(with) = earlier
            .iter()
            .position(|other| other.group_index == info.group_index)
            .filter(|&first| infos[first].member_threshold != info.member_threshold)
        {
            return Some(SetConflict {
                kind: ConflictKind::Threshold,
                at,
                with,
            });
        }
    }
    None
}

/// The groups of the shares of one set, by their indexes in the list given, made once.
#[derive(Clone, Debug)]
pub struct SetTopology {
    infos: Vec<ShareInfo>,
    /// The shares of each group, in the order the groups first come.
    groups: Vec<Vec<usize>>,
}

impl SetTopology {
    /// The topology of `infos`, the shares of one set without conflicts ([`first_conflict`]).
    pub fn new(infos: &[ShareInfo]) -> Self {
        let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
        for (index, info) in infos.iter().enumerate() {
            match groups
                .iter_mut()
                .find(|(group, _)| *group == info.group_index)
            {
                Some((_, members)) => members.push(index),
                None => groups.push((info.group_index, vec![index])),
            }
        }
        Self {
            infos: infos.to_vec(),
            groups: groups.into_iter().map(|(_, members)| members).collect(),
        }
    }

    /// The shares of each group, by index, in the order the groups first come.
    pub fn groups(&self) -> &[Vec<usize>] {
        &self.groups
    }

    /// The member threshold of `group`, which every share of it carries.
    pub fn threshold_of(&self, group: &[usize]) -> usize {
        group
            .first()
            .and_then(|&first| self.infos.get(first))
            .map_or(1, |info| info.member_threshold)
    }

    /// The groups with at least as many members as their threshold.
    pub fn complete(&self) -> Vec<&[usize]> {
        self.groups
            .iter()
            .map(Vec::as_slice)
            .filter(|group| group.len() >= self.threshold_of(group))
            .collect()
    }

    /// The shares of groups with fewer members than their threshold, which take no part, in order.
    pub fn incomplete(&self) -> Vec<usize> {
        let mut shares: Vec<usize> = self
            .groups
            .iter()
            .filter(|group| group.len() < self.threshold_of(group))
            .flatten()
            .copied()
            .collect();
        shares.sort_unstable();
        shares
    }

    /// Whether the complete groups are as many as the set's group threshold.
    pub fn enough(&self) -> bool {
        self.infos
            .first()
            .is_some_and(|info| self.complete().len() >= info.group_threshold)
    }
}

/// The members that check a surplus `member` of a group: those that restored the secret (`base`, as
/// many as the threshold) with `member` in place of the last.
pub fn surplus_window(base: &[usize], member: usize) -> Vec<usize> {
    let mut window = base[..base.len().saturating_sub(1)].to_vec();
    window.push(member);
    window
}

/// Refuses the metadata of shares that are not one set: a count that is no set's, two shares that
/// cannot both be right, and, with `require_quorum`, too few for the set's threshold.
pub fn check_set(infos: &[ShareInfo], require_quorum: bool) -> Result<(), SetError> {
    check_share_count(infos.len())?;
    if let Some(conflict) = first_conflict(infos, 0) {
        return Err(SetError::Conflict(conflict.kind));
    }
    if require_quorum && !SetTopology::new(infos).enough() {
        return Err(SetError::NotEnough);
    }
    Ok(())
}

/// The shares of one set, each read in any form, checked together before the engine sees them
/// ([`check_set`]); refused for a count that is no set's before any is read, and for a share that
/// does not read.
pub fn read_set<S: AsRef<str>>(
    texts: &[S],
    require_quorum: bool,
) -> Result<Vec<ReadShare>, SetError> {
    check_share_count(texts.len())?;
    let shares = texts
        .iter()
        .map(|text| read_share(text.as_ref()).map_err(SetError::Read))
        .collect::<Result<Vec<_>, _>>()?;
    let infos: Vec<ShareInfo> = shares.iter().map(|read| read.share.info()).collect();
    check_set(&infos, require_quorum)?;
    Ok(shares)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(group: usize, member: usize, threshold: usize) -> ShareInfo {
        ShareInfo {
            identifier: 7,
            group_threshold: 1,
            group_count: 2,
            group_index: group,
            member_threshold: threshold,
            member_index: member,
            secret_length: 16,
        }
    }

    #[test]
    fn conflicts_are_found_in_order() {
        let mut other = info(0, 1, 2);
        other.identifier = 8;
        let conflict = first_conflict(&[info(0, 0, 2), other], 0).unwrap();
        assert_eq!(
            (conflict.kind, conflict.at, conflict.with),
            (ConflictKind::Set, 1, 0)
        );
        let twice = first_conflict(&[info(0, 0, 2), info(0, 1, 2), info(0, 1, 2)], 0).unwrap();
        assert_eq!(
            (twice.kind, twice.at, twice.with),
            (ConflictKind::Member, 2, 1)
        );
        let thresholds = first_conflict(&[info(0, 0, 2), info(0, 1, 3)], 0).unwrap();
        assert_eq!(thresholds.kind, ConflictKind::Threshold);
        assert_eq!(first_conflict(&[info(0, 0, 2), info(1, 0, 1)], 0), None);
    }

    #[test]
    fn the_topology_tells_complete_groups_and_quorum() {
        let infos = [info(1, 0, 1), info(0, 0, 2), info(1, 1, 1)];
        let topology = SetTopology::new(&infos);
        assert_eq!(topology.groups(), &[vec![0, 2], vec![1]]);
        assert_eq!(topology.complete(), vec![&[0, 2][..]]);
        assert_eq!(topology.incomplete(), vec![1]);
        assert!(topology.enough());
        assert_eq!(surplus_window(&[0, 2], 5), vec![0, 5]);
        assert_eq!(check_set(&[info(0, 0, 2)], true), Err(SetError::NotEnough));
        assert_eq!(check_set(&[], true), Err(SetError::Count));
        assert_eq!(
            SetError::Count.to_string(),
            "Provide between 1 and 256 SSKR shares."
        );
    }
}
