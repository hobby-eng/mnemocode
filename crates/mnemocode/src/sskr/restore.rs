//! The restore of shares (MnemoCode TS 0.1.0's `src/sskr/complete-shares.ts` and `share-set.ts`,
//! CAP-SSKR-RESTORE-COMPLETE, CAP-SSKR-RESTORED-SET-FACTS and CAP-SSKR-COMBINE-LIBRARY): the
//! phrase complete shares restore, every share given checked against it, and the facts of the set
//! that restored it. The engine uses only the first members of a group and the first groups that
//! meet the threshold, so each surplus member and group is used once in place of one of those and
//! must give the same secret (AUD-008-FUN001).

use std::fmt;

use super::engine::combine;
use super::forms::{ReadShare, ShareFormat};
use super::set::{MIN_DIGEST_THRESHOLD, SetError, SetTopology, check_set, member_of, read_set};
use super::share::{Share, ShareInfo};
use crate::bip32::ExtendedKey;
use crate::bip39::phrase::Phrase;
use crate::bip39::sizes::word_count_of_entropy;
use crate::forms::Form;
use crate::refusal::Refusal;
use crate::search::plan::counted;
use crate::secret::{SecretBytes, SecretText, equal_bytes};
use crate::text::words::place_of;

/// Choices of groups tried as the reference: about a second of restores for the largest sets.
const MAX_REFERENCE_TRIES: usize = 1 << 10;

/// What is said of shares that keep no digest of the secret.
const NO_DIGEST_NOTE: &str = "No SSKR digest checked this phrase: the groups that restored it take one share each. A changed share would give another phrase.";

/// The refusals of a restore, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RestoreError {
    /// Shares that are not one set, or do not read.
    Set(SetError),
    /// Shares that restore no secret.
    NoSecret,
    /// No secret in the first choices of groups.
    TooManyFailing,
    /// A secret of no BIP39 phrase's length.
    NotEntropy,
    /// The members of a group, by their places, that give another secret.
    GroupMisfit(Vec<usize>),
    /// A surplus share, by its place, that gives another secret.
    ShareMisfit(usize),
    /// Shares that disagree where no digest tells which is wrong.
    UncheckedDisagreement,
    /// A share's secret of no BIP39 length.
    NoBip39Length,
}

/// The refusal of the share at `place` without which the others restore one phrase.
pub fn misfit_message(place: usize) -> String {
    format!(
        "Share {place} does not fit with the others: with it they give another phrase or none. Leave it out, or check it."
    )
}

impl fmt::Display for RestoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Set(error) => error.fmt(f),
            Self::NoSecret => f.write_str(
                "These shares do not restore a secret: check them, and that all belong to one set.",
            ),
            Self::TooManyFailing => f.write_str(
                "Too many combinations of these groups fail to restore a secret: leave out the groups you doubt, or check them.",
            ),
            Self::NotEntropy => f.write_str("Recovered SSKR secret is not BIP39 entropy."),
            Self::GroupMisfit(places) => {
                let numbers = places
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                if places.len() == 1 {
                    write!(
                        f,
                        "Share {numbers} of another group does not fit with the others: leave it out, or check it."
                    )
                } else {
                    write!(
                        f,
                        "Shares {numbers} of another group do not fit with the others: leave them out, or check them."
                    )
                }
            }
            Self::ShareMisfit(place) => f.write_str(&misfit_message(*place)),
            Self::UncheckedDisagreement => f.write_str(
                "These shares give different secrets, and none of them can be checked on its own: MnemoCode cannot tell which is wrong. Check each of them.",
            ),
            Self::NoBip39Length => f.write_str("A share's secret has no BIP39 length."),
        }
    }
}

impl std::error::Error for RestoreError {}

impl Refusal for RestoreError {
    fn code(&self) -> &'static str {
        match self {
            Self::Set(error) => error.code(),
            Self::NoSecret => "sskr.complete-shares.no-secret",
            Self::TooManyFailing => "sskr.complete-shares.too-many-failing",
            Self::NotEntropy => "sskr.complete-shares.recovered-sskr-secret-not-bip39-entropy",
            Self::GroupMisfit(_) => "sskr.complete-shares.group-does-not-fit",
            Self::ShareMisfit(_) => "sskr.complete-shares.share-does-not-fit",
            Self::UncheckedDisagreement => "sskr.complete-shares.unchecked-disagreement",
            Self::NoBip39Length => "sskr.share-set.share-s-secret-no-bip39-length",
        }
    }
}

impl RestoreError {
    /// Whether it refuses the shares given, as a set's own result: no secret, a group or a share
    /// that does not fit, or shares that disagree where no digest tells.
    pub const fn refuses_shares(&self) -> bool {
        matches!(
            self,
            Self::NoSecret
                | Self::GroupMisfit(_)
                | Self::ShareMisfit(_)
                | Self::UncheckedDisagreement
        )
    }
}

impl From<SetError> for RestoreError {
    fn from(error: SetError) -> Self {
        Self::Set(error)
    }
}

/// The refusals of a combine of shares that may hold marks, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CombineError {
    /// Complete shares refused.
    Restore(RestoreError),
    /// Marked shares refused before an assessment.
    Joint(super::joint::JointError),
    /// Too few shares: why.
    MoreSharesNeeded(String),
    /// Shares that do not fit, by the condition: why.
    NoFit(super::joint::NoFitKind, String),
    /// Too much left open: why.
    TooManyOpen(String),
    /// No phrase fits.
    NoPhraseFits,
    /// More than one phrase fits.
    SeveralPhrases,
    /// No digest checked the phrase, where only the phrase is given.
    NoDigest,
    /// A share or a repaired element went unchecked, where only the phrase is given.
    Unchecked,
}

impl fmt::Display for CombineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Restore(error) => error.fmt(f),
            Self::Joint(error) => error.fmt(f),
            Self::MoreSharesNeeded(reason)
            | Self::NoFit(_, reason)
            | Self::TooManyOpen(reason) => f.write_str(reason),
            Self::NoPhraseFits => f.write_str(super::repair::report::NO_PHRASE_FITS),
            Self::SeveralPhrases => f.write_str(
                "More than one phrase fits these shares: read more of the marked elements, or add a share.",
            ),
            Self::NoDigest => f.write_str(
                "No SSKR digest checks the phrase of these shares: each group that restores it takes one share. Use ShareSet::combine, whose result says so, or restore on the command line.",
            ),
            Self::Unchecked => f.write_str(
                "Some shares or repaired elements could not be checked. Use ShareSet::combine to inspect them, or restore on the command line.",
            ),
        }
    }
}

impl std::error::Error for CombineError {}

impl Refusal for CombineError {
    fn code(&self) -> &'static str {
        use super::joint::NoFitKind;
        match self {
            Self::Restore(error) => error.code(),
            Self::Joint(error) => error.code(),
            Self::MoreSharesNeeded(_) => "sskr.share-set.more-shares-needed",
            Self::NoFit(NoFitKind::ShareUnreadable, _) => "sskr.share-set.share-unreadable",
            Self::NoFit(NoFitKind::SeveralGroups, _) => "sskr.share-set.several-groups",
            Self::NoFit(NoFitKind::SharesDoNotFit, _) => "sskr.share-set.shares-do-not-fit",
            Self::TooManyOpen(_) => "sskr.share-set.too-many-combinations-open",
            Self::NoPhraseFits => "sskr.share-set.no-phrase-fits",
            Self::SeveralPhrases => "sskr.share-set.more-than-one-phrase-fits-shares-read-more",
            Self::NoDigest => "sskr.shares.no-digest-checked-phrase",
            Self::Unchecked => "sskr.shares.some-shares-repaired-elements-could-not-checked-use",
        }
    }
}

/// Digest checks a combine makes on its own: well under a second.
const MAX_LIBRARY_TRIES: f64 = 65_536.0;

/// What a combine says of more combinations than it tries.
const TOO_MANY_OPEN: &str =
    "Too many combinations are open: read more of the marked elements, or add a share.";

/// The refusal of a plan of marked shares a combine does not search; none for one it searches.
fn combine_refusal(assessment: &super::joint::JointAssessment) -> Option<CombineError> {
    use super::joint::Verdict;
    // First: past a combine's own limit, the assessment's reason would name its larger limit.
    if assessment.combinations > MAX_LIBRARY_TRIES {
        return Some(CombineError::TooManyOpen(TOO_MANY_OPEN.to_owned()));
    }
    let reason = assessment.reason.clone()?;
    Some(match assessment.verdict {
        Verdict::NotEnough => CombineError::MoreSharesNeeded(reason),
        Verdict::NoFit(kind) => CombineError::NoFit(kind, reason),
        _ => CombineError::TooManyOpen(reason),
    })
}

/// Whether an SSKR digest checks a secret restored under `group_threshold` from complete groups of
/// `member_thresholds`: the groups' digest checks any choice of 2 or more; with 1, a group checks
/// itself when its member threshold is 2 or more (AUD-037-API004).
pub fn digest_checks(group_threshold: usize, member_thresholds: &[usize]) -> bool {
    group_threshold >= MIN_DIGEST_THRESHOLD
        || member_thresholds
            .iter()
            .any(|&threshold| threshold >= MIN_DIGEST_THRESHOLD)
}

/// Every choice of `count` of `0..items`, in order: [0, 1], [0, 2], …, [1, 2], …
fn choices(items: usize, count: usize) -> impl Iterator<Item = Vec<usize>> {
    let mut next = (count <= items).then(|| (0..count).collect::<Vec<_>>());
    std::iter::from_fn(move || {
        let current = next.take()?;
        let mut following = current.clone();
        let mut place = count;
        while place > 0 {
            place -= 1;
            if following[place] < items - count + place {
                following[place] += 1;
                for later in place + 1..count {
                    following[later] = following[later - 1] + 1;
                }
                next = Some(following);
                break;
            }
        }
        Some(current)
    })
}

/// The groups whose secret every other share is compared with, by their places in the complete
/// groups, that secret, and whether a digest checked it.
struct Reference {
    groups: Vec<usize>,
    entropy: SecretBytes,
    checked: bool,
}

/// The phrase that complete shares restore, with what checked it.
#[derive(Debug)]
pub struct CompleteRestore {
    /// The phrase.
    pub phrase: Phrase,
    /// The indexes, from 0, of the shares that took no part in the check.
    pub unchecked: Vec<usize>,
    /// Whether an SSKR digest checked the phrase.
    pub digest_checked: bool,
}

/// The shares of a set and its topology, which a restore asks.
struct Restorer<'a> {
    shares: &'a [&'a Share],
    topology: SetTopology,
    complete: Vec<Vec<usize>>,
}

impl Restorer<'_> {
    /// The first members of `group`, as many as its threshold.
    fn first_members(&self, group: usize) -> &[usize] {
        let members = &self.complete[group];
        &members[..self.topology.threshold_of(members).min(members.len())]
    }

    /// The secret the engine restores from `members`, or none where it refuses them.
    fn recover(&self, members: &[usize]) -> Option<SecretBytes> {
        let payloads: Vec<&[u8]> = members
            .iter()
            .map(|&member| self.shares[member].payload())
            .collect();
        combine(&payloads).ok()
    }

    /// The secret the first members of `groups` restore.
    fn recover_groups(&self, groups: &[usize]) -> Option<SecretBytes> {
        let members: Vec<usize> = groups
            .iter()
            .flat_map(|&group| self.first_members(group).iter().copied())
            .collect();
        self.recover(&members)
    }

    /// The first choice of groups, in order, that a digest checks and that restores. When no group
    /// can be checked, the first is taken, unchecked.
    fn reference(&self, group_threshold: usize) -> Result<Reference, RestoreError> {
        let thresholds: Vec<usize> = self
            .complete
            .iter()
            .map(|group| self.topology.threshold_of(group))
            .collect();
        if !digest_checks(group_threshold, &thresholds) {
            let entropy = self.recover_groups(&[0]).ok_or(RestoreError::NoSecret)?;
            return Ok(Reference {
                groups: vec![0],
                entropy,
                checked: false,
            });
        }
        let candidates: Box<dyn Iterator<Item = Vec<usize>>> =
            if group_threshold >= MIN_DIGEST_THRESHOLD {
                Box::new(choices(self.complete.len(), group_threshold))
            } else {
                Box::new(
                    (0..self.complete.len())
                        .filter(|&group| thresholds[group] >= MIN_DIGEST_THRESHOLD)
                        .map(|group| vec![group]),
                )
            };
        for (tries, groups) in candidates.enumerate() {
            if tries == MAX_REFERENCE_TRIES {
                return Err(RestoreError::TooManyFailing);
            }
            if let Some(entropy) = self.recover_groups(&groups) {
                return Ok(Reference {
                    groups,
                    entropy,
                    checked: true,
                });
            }
        }
        // A group of member threshold 1 may still restore, unchecked: no share is named.
        Err(RestoreError::NoSecret)
    }

    /// Whether `members` of `group`, in place of the group's own or of the last group used, give
    /// the reference's secret.
    fn agrees(&self, reference: &Reference, group: usize, members: &[usize]) -> bool {
        let used = &reference.groups;
        let at = used
            .iter()
            .position(|&other| other == group)
            .unwrap_or(used.len() - 1);
        let set: Vec<usize> = used
            .iter()
            .enumerate()
            .flat_map(|(index, &other)| {
                if index == at {
                    members.to_vec()
                } else {
                    self.first_members(other).to_vec()
                }
            })
            .collect();
        self.recover(&set)
            .is_some_and(|again| equal_bytes(&again, &reference.entropy))
    }
}

/// Restores the phrase from complete `shares` and checks that every share agrees with it: each
/// surplus member, and each surplus group, used once in place of one of the reference's. The
/// shares of a group with fewer members than its threshold take no part: they are returned, from
/// 0. A refusal names a share by its place in `places`, by its index; by its index from 1 without
/// them. Refuses shares that are not one set or too few ([`check_set`]), no secret, a secret of no
/// phrase's length, and a group or surplus share that gives another secret, or, where no digest
/// checked the reference, either of them.
pub fn restore_complete(
    shares: &[&Share],
    places: Option<&[usize]>,
) -> Result<CompleteRestore, RestoreError> {
    let infos: Vec<ShareInfo> = shares.iter().map(|share| share.info()).collect();
    check_set(&infos, true)?;
    let topology = SetTopology::new(&infos);
    let complete = topology
        .complete()
        .into_iter()
        .map(<[usize]>::to_vec)
        .collect();
    let restorer = Restorer {
        shares,
        topology,
        complete,
    };
    let reference = restorer.reference(infos[0].group_threshold)?;
    let phrase = Phrase::of_entropy(&reference.entropy).map_err(|_| RestoreError::NotEntropy)?;
    let named = |refusal: RestoreError| {
        if reference.checked {
            refusal
        } else {
            RestoreError::UncheckedDisagreement
        }
    };
    for group in 0..restorer.complete.len() {
        let first = restorer.first_members(group);
        if !reference.groups.contains(&group) && !restorer.agrees(&reference, group, first) {
            let places = first
                .iter()
                .map(|&member| place_of(places, member + 1))
                .collect();
            return Err(named(RestoreError::GroupMisfit(places)));
        }
        for &member in &restorer.complete[group][first.len()..] {
            let window = super::set::surplus_window(first, member);
            if !restorer.agrees(&reference, group, &window) {
                return Err(named(RestoreError::ShareMisfit(place_of(
                    places,
                    member + 1,
                ))));
            }
        }
    }
    Ok(CompleteRestore {
        phrase,
        unchecked: restorer.topology.incomplete(),
        digest_checked: reference.checked,
    })
}

/// A marked element: its share and place, both from 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarkedElement {
    /// The share, from 1 in the order given.
    pub share: usize,
    /// The element's place among the share's elements, from 1.
    pub position: usize,
}

/// A marked element as a repair filled it in.
#[derive(Debug)]
pub struct FilledElement {
    /// The element's place among the share's elements, from 1.
    pub position: usize,
    /// The element, written in the share's form: part of the secret.
    pub value: SecretText,
}

/// A share as read or repaired: the share, the form it was typed in, and what a repair filled.
#[derive(Debug)]
pub struct SetShare {
    /// The share.
    pub share: Share,
    /// The form it was typed in, which a repair keeps.
    pub format: ShareFormat,
    /// The marked elements as filled in, in order; none for a share typed whole.
    pub filled: Vec<FilledElement>,
}

impl SetShare {
    /// Whether a repair filled in any element.
    pub fn repaired(&self) -> bool {
        !self.filled.is_empty()
    }
}

impl From<ReadShare> for SetShare {
    fn from(read: ReadShare) -> Self {
        Self {
            share: read.share,
            format: read.format,
            filled: Vec::new(),
        }
    }
}

/// A group of the shares given: its index in the set from 0, its threshold, and its shares from 1.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareGroup {
    /// The group's index in the set, from 0.
    pub index: usize,
    /// The members that restore it.
    pub threshold: usize,
    /// Its shares among those given, from 1, in the order given.
    pub members: Vec<usize>,
}

/// The backup that was split, in the form its shares were written in.
#[derive(Debug)]
pub struct SetBackup {
    /// The form of the first share, as a backup takes it.
    pub form: Form,
    /// The backup in that form: secret.
    pub text: SecretText,
}

/// The phrase a set of shares restores, with every share as read or repaired, its groups and
/// what could not be checked. It exists only once restored and checked.
#[derive(Debug)]
pub struct ShareSet {
    phrase: Phrase,
    shares: Vec<SetShare>,
    unsettled: Vec<MarkedElement>,
    /// Shares, from 1, of a group with fewer than its threshold.
    unchecked: Vec<usize>,
    digest_checked: bool,
    infos: Vec<ShareInfo>,
}

impl ShareSet {
    /// The set of `phrase` and `shares`, with what a repair left unsettled and the shares, from 0,
    /// that took no part; a digest is said to check it only where the shares can be checked.
    pub(crate) fn new(
        phrase: Phrase,
        shares: Vec<SetShare>,
        unsettled: Vec<MarkedElement>,
        unchecked: &[usize],
        digest_checked: bool,
    ) -> Self {
        let infos: Vec<ShareInfo> = shares.iter().map(|share| share.share.info()).collect();
        let digest_checked = digest_checked && digest_checks_shares(&infos);
        Self {
            phrase,
            shares,
            unsettled,
            unchecked: unchecked.iter().map(|index| index + 1).collect(),
            digest_checked,
            infos,
        }
    }

    /// The set a joint repair's candidate restores.
    pub(crate) fn of_candidate(candidate: super::joint::solve::Candidate) -> Self {
        Self::new(
            candidate.phrase,
            candidate.shares,
            candidate.unsettled,
            &candidate.unchecked,
            candidate.digest_checked,
        )
    }

    /// One phrase from two candidates of it, such as a share all marked read with two member
    /// numbers: the shares of this one are kept, the elements in which the two differ are
    /// unsettled, and what either left unchecked stays unchecked.
    pub(crate) fn merged(self, other: Self) -> Self {
        let mut unsettled: Vec<MarkedElement> = self.unsettled.clone();
        unsettled.extend(other.unsettled.iter().copied());
        for (index, (share, second)) in self.shares.iter().zip(&other.shares).enumerate() {
            if share.share.payload() == second.share.payload() {
                continue;
            }
            for element in &share.filled {
                let same = share.format == second.format
                    && second.filled.iter().any(|filled| {
                        filled.position == element.position
                            && filled.value.as_str() == element.value.as_str()
                    });
                if !same {
                    unsettled.push(MarkedElement {
                        share: index + 1,
                        position: element.position,
                    });
                }
            }
        }
        unsettled.sort_by_key(|element| (element.share, element.position));
        unsettled.dedup();
        let mut unchecked = self.unchecked.clone();
        unchecked.extend(other.unchecked.iter().copied());
        unchecked.sort_unstable();
        unchecked.dedup();
        Self {
            unsettled,
            unchecked,
            digest_checked: self.digest_checked && other.digest_checked,
            ..self
        }
    }

    /// Restores complete shares, each in any form, and checks every share given against the phrase
    /// ([`restore_complete`]); a share is refused by its place in `places`.
    pub fn restore<S: AsRef<str>>(
        texts: &[S],
        places: Option<&[usize]>,
    ) -> Result<Self, RestoreError> {
        let read = read_set(texts, true)?;
        let shares: Vec<&Share> = read.iter().map(|read| &read.share).collect();
        let restored = restore_complete(&shares, places)?;
        Ok(Self::new(
            restored.phrase,
            read.into_iter().map(SetShare::from).collect(),
            Vec::new(),
            &restored.unchecked,
            restored.digest_checked,
        ))
    }

    /// Restores the one phrase `texts` hold, in any form, with elements marked with ? where
    /// unreadable: complete shares as [`ShareSet::restore`] does, marked ones assessed and searched
    /// together (the joint repair). A repair that needs a long search, or that more than one phrase
    /// passes, is refused; a host that shows the assessment and asks first plans the joint repair
    /// itself. A refusal names a share by its place in `places`.
    pub fn combine<S: AsRef<str>>(
        texts: &[S],
        places: Option<&[usize]>,
    ) -> Result<Self, CombineError> {
        if !texts
            .iter()
            .any(|text| super::marks::is_marked(text.as_ref()))
        {
            return Self::restore(texts, places).map_err(CombineError::Restore);
        }
        let plan = super::joint::plan_joint_repair(texts, places).map_err(CombineError::Joint)?;
        if let Some(refusal) = combine_refusal(&plan.assessment) {
            return Err(refusal);
        }
        let mut sets = match plan.search() {
            Some(search) => search.run().map_err(CombineError::Joint)?.sets,
            None => Vec::new(),
        };
        match sets.len() {
            0 => Err(CombineError::NoPhraseFits),
            1 => Ok(sets.remove(0)),
            _ => Err(CombineError::SeveralPhrases),
        }
    }

    /// The phrase alone, when every share and repaired element was checked and a digest checked
    /// the phrase; refused otherwise, and as [`ShareSet::combine`] refuses.
    pub fn combine_phrase<S: AsRef<str>>(texts: &[S]) -> Result<Phrase, CombineError> {
        let set = Self::combine(texts, None)?;
        if !set.digest_checked() {
            return Err(CombineError::NoDigest);
        }
        if !set.checked() {
            return Err(CombineError::Unchecked);
        }
        Ok(set.phrase)
    }

    /// Words of the phrase whose secret has `secret_bytes` bytes; refused for no BIP39 length.
    pub fn word_count_of(secret_bytes: usize) -> Result<usize, RestoreError> {
        word_count_of_entropy(secret_bytes).ok_or(RestoreError::NoBip39Length)
    }

    /// Why the phrases restored, `sets` of them, are not the wallet given: their own phrases, or,
    /// after a search of `date_combinations`, the phrases those dates unmask.
    pub fn wallet_mismatch(sets: u64, date_combinations: Option<u64>) -> String {
        match (date_combinations, sets) {
            (None, 1) => {
                "The phrase that these shares restore does not match the wallet given.".to_owned()
            }
            (None, _) => {
                format!(
                    "None of the {sets} phrases that fit these shares matches the wallet given."
                )
            }
            (Some(dates), 1) => format!(
                "None of the {} gives the wallet given.",
                counted(dates, "date combination")
            ),
            (Some(dates), _) => format!(
                "None of the {} gives the wallet given, with any of the {sets} phrases that fit these shares.",
                counted(dates, "date combination")
            ),
        }
    }

    /// The phrase the shares hold: for a Seedshift backup, the masked phrase.
    pub fn phrase(&self) -> &Phrase {
        &self.phrase
    }

    /// Every share, in the order given, as read or repaired.
    pub fn shares(&self) -> &[SetShare] {
        &self.shares
    }

    /// Elements the phrase does not depend on and nothing settles: their values are a guess.
    pub fn unsettled(&self) -> &[MarkedElement] {
        &self.unsettled
    }

    /// Shares, from 1, of a group with fewer than its threshold: they took no part.
    pub fn unchecked(&self) -> &[usize] {
        &self.unchecked
    }

    /// The warning for the shares that took no part, each named by its place in `places`, and for
    /// a phrase no digest checked; none when every share took part and a digest checked it.
    pub fn unchecked_note(&self, places: Option<&[usize]>) -> Option<String> {
        let named: Vec<String> = self
            .unchecked
            .iter()
            .map(|&share| place_of(places, share).to_string())
            .collect();
        let mut notes = Vec::new();
        if !named.is_empty() {
            notes.push(format!(
                "Share {}: too few shares of its group to take part; not checked.",
                named.join(", ")
            ));
        }
        if !self.digest_checked {
            notes.push(NO_DIGEST_NOTE.to_owned());
        }
        (!notes.is_empty()).then(|| notes.join(" "))
    }

    /// Whether an SSKR digest checked the secret (AUD-037-API004).
    pub fn digest_checked(&self) -> bool {
        self.digest_checked
    }

    /// Whether every share took part, every element is settled, and a digest checked the phrase.
    pub fn checked(&self) -> bool {
        self.unchecked.is_empty() && self.unsettled.is_empty() && self.digest_checked
    }

    /// Groups of the set that restore the phrase.
    pub fn group_threshold(&self) -> usize {
        self.infos[0].group_threshold
    }

    /// Groups of the set, given or not.
    pub fn group_count(&self) -> usize {
        self.infos[0].group_count
    }

    /// The groups of the shares given, in the order they first come.
    pub fn groups(&self) -> Vec<ShareGroup> {
        let topology = SetTopology::new(&self.infos);
        topology
            .groups()
            .iter()
            .map(|members| ShareGroup {
                index: self.infos[members[0]].group_index,
                threshold: topology.threshold_of(members),
                members: members.iter().map(|member| member + 1).collect(),
            })
            .collect()
    }

    /// Bytes of the secret the shares hold.
    pub fn secret_bytes(&self) -> usize {
        self.infos[0].secret_length
    }

    /// Words of the phrase the shares hold.
    pub fn word_count(&self) -> usize {
        self.phrase.len()
    }

    /// The backup that was split, in the form of its first share, which the dates turn into
    /// `original`; none when the shares hold that phrase itself.
    pub fn backup(&self, original: &Phrase) -> Option<SetBackup> {
        let held = self.phrase.text();
        if held.as_str() == original.text().as_str() {
            return None;
        }
        let form = self.shares[0].format.mirrored();
        let indexes: Vec<u16> = (0..self.phrase.len())
            .map(|place| u16::try_from(self.phrase.index(place).unwrap_or(0)).unwrap_or(0))
            .collect();
        let text = form.codes(&indexes).ok()?;
        Some(SetBackup {
            form,
            text: SecretText::copy_of("a backup", &text),
        })
    }

    /// The master fingerprint of the phrase the shares hold, with an empty BIP39 passphrase: for a
    /// Seedshift backup the encoded fingerprint, compared before any date is typed.
    pub fn fingerprint(&self) -> Option<[u8; 4]> {
        ExtendedKey::of_phrase(&self.phrase, "")
            .and_then(|key| key.fingerprint())
            .ok()
    }
}

/// Whether a digest can check what the shares of `infos` restore, each member counted once by its
/// first share: copies of one share are one member (AUD-037-API004).
fn digest_checks_shares(infos: &[ShareInfo]) -> bool {
    let mut members: Vec<ShareInfo> = Vec::new();
    for info in infos {
        if !members
            .iter()
            .any(|other| member_of(other) == member_of(info))
        {
            members.push(*info);
        }
    }
    let topology = SetTopology::new(&members);
    let thresholds: Vec<usize> = topology
        .complete()
        .iter()
        .map(|group| topology.threshold_of(group))
        .collect();
    infos
        .first()
        .is_some_and(|info| digest_checks(info.group_threshold, &thresholds))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sskr::engine::{Group, split_seeded};
    use crate::sskr::text::compact_ur;

    const ENTROPY: [u8; 16] = [0x7f; 16];

    fn urs(threshold: usize, count: usize) -> Vec<String> {
        let shares = split_seeded(&ENTROPY, 1, &[Group { threshold, count }], &[3; 32]).unwrap();
        shares
            .iter()
            .map(|payload| compact_ur(payload).as_str().to_owned())
            .collect()
    }

    #[test]
    fn choices_come_in_order() {
        assert_eq!(
            choices(4, 2).collect::<Vec<_>>(),
            vec![
                vec![0, 1],
                vec![0, 2],
                vec![0, 3],
                vec![1, 2],
                vec![1, 3],
                vec![2, 3]
            ]
        );
        assert_eq!(choices(2, 3).count(), 0);
    }

    #[test]
    fn every_share_is_checked_against_the_phrase() {
        let shares = urs(2, 3);
        let set = ShareSet::restore(&shares, None).unwrap();
        assert_eq!(set.phrase().entropy().unwrap().as_ref(), &ENTROPY);
        assert!(set.checked());
        assert_eq!(set.groups()[0].members, vec![1, 2, 3]);
        assert_eq!(set.word_count(), 12);
        // A surplus share of another split is named by its place.
        let mut wrong = shares.clone();
        let other = split_seeded(
            &[0x11; 16],
            1,
            &[Group {
                threshold: 2,
                count: 3,
            }],
            &[3; 32],
        )
        .unwrap();
        wrong[2] = compact_ur(&other[2]).as_str().to_owned();
        assert_eq!(
            ShareSet::restore(&wrong, Some(&[4, 5, 6])).unwrap_err(),
            RestoreError::ShareMisfit(6)
        );
        assert_eq!(
            ShareSet::restore(&shares[..1], None).unwrap_err(),
            RestoreError::Set(SetError::NotEnough)
        );
    }

    #[test]
    fn the_digest_picks_among_variants_when_marked_shares_combine() {
        use crate::sskr::forms::ShareFormat;
        use crate::sskr::testing::{join_units, share_units, vector};
        let (shares, phrase) = vector(4);
        for format in [
            ShareFormat::Indexes,
            ShareFormat::Unicode,
            ShareFormat::Colors,
            ShareFormat::ColorsUnicode,
        ] {
            let colors = matches!(format, ShareFormat::Colors | ShareFormat::ColorsUnicode);
            let places: &[usize] = if colors { &[3, 6] } else { &[2, 8, 14] };
            let mut first = share_units(&shares[0], format);
            let mut second = share_units(&shares[1], format);
            for &place in places {
                first[place] = "?".to_owned();
                second[place] = "?".to_owned();
            }
            let typed = if colors {
                vec![join_units(&first, format), shares[1].clone()]
            } else {
                vec![join_units(&first, format), join_units(&second, format)]
            };
            let restored = ShareSet::combine_phrase(&typed).unwrap();
            assert_eq!(restored.text().as_str(), phrase, "{format:?}");
        }
        let alone = [crate::sskr::testing::mark_units(
            &shares[0],
            ShareFormat::Indexes,
            &[4],
        )];
        assert_eq!(
            ShareSet::combine(&alone, None).unwrap_err().code(),
            "sskr.share-set.more-shares-needed"
        );
    }
}
