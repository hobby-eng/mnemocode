//! The shares a person types or pastes to restore or export a phrase (MnemoCode TS 0.1.0's
//! `src/sskr/share-input.ts`, CAP-SSKR-TYPED-SHARES and CAP-SSKR-SHARE-TROUBLE), each kept with the
//! place it was typed at, by which every message names it: one answer split into shares, a share a
//! paste wrapped over lines joined again, a seed phrase typed where a share was asked for told
//! apart, each share read, the set checked, copies used once, and the share without which the others
//! restore named; for an export of fewer shares than the threshold, each share repaired alone.

use std::fmt;

use super::export::{PlacesRefused, ShareExport};
use super::forms::{ShareFormat, ShareTextError, read_share, share_word_list};
use super::joint::{JointAssessment, NoFitKind, Verdict, joint_mark_limit_problem};
use super::marks::{is_marked, mark_problem};
use super::repair::{LISTED_FREE_BITS, repair_candidates};
use super::restore::{
    MarkedElement, RestoreError, SetShare, ShareSet, misfit_message, restore_complete,
};
use super::set::{
    ConflictKind, SetError, SetKey, SetTopology, check_share_count, first_conflict, set_of,
};
use super::share::{Share, ShareInfo};
use crate::bip39::phrase::Phrase;
use crate::forms::Form;
use crate::forms::detection::detect;
use crate::forms::hints::{LineWordHints, WordHints};
use crate::refusal::Refusal;
use crate::secret::SecretText;
use crate::text::space::{trim, without_byte_order_mark};
use crate::text::words::{after_place, places_in_words};

/// Lines one share may take in a paste, as a narrow column of a PDF wraps it.
const MAX_WRAPPED_LINES: usize = 8;
/// What a person types between the shares of one answer.
pub const SHARE_SEPARATOR: &str = ";";
/// The same as a byte, for a paste of several lines.
pub const SHARE_SEPARATOR_BYTE: u8 = b';';

/// Whether `character` separates the shares of one answer: [`SHARE_SEPARATOR`] or a line break.
fn separates_shares(character: char) -> bool {
    character == ';' || character == '\n'
}

/// The hints below shares being typed: the Bytewords of the share being typed, after the shares
/// before it, where it is written in them.
pub fn share_word_hints() -> impl WordHints {
    LineWordHints::new(share_word_list, |line: &str| {
        line.rsplit(separates_shares).next().unwrap_or_default()
    })
}

/// How a host mends a problem of the shares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TroubleKind {
    /// The share is typed again, or left out while others remain.
    Unreadable,
    /// The one share that does not fit is left out or typed again.
    Odd,
    /// More shares are needed.
    Few,
    /// The person chooses which share to change or leave out.
    Refused,
}

/// The condition of a problem, one code for each (AUD-037-API009).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TroubleCode {
    /// A share of another set than most.
    ShareOfAnotherSet,
    /// Shares of different sets, as many each.
    SharesOfDifferentSets,
    /// The same member twice, different.
    MemberGivenTwice,
    /// A group with two thresholds.
    GroupThresholdsConflict,
    /// Too few for the threshold of a set of one group.
    TooFewForThreshold,
    /// Too few complete groups.
    TooFewGroups,
    /// A share that cannot be read, or that no reading of its marks fits.
    ShareUnreadable,
    /// A seed phrase in words typed for a share.
    SeedPhraseInWords,
    /// An encoded seed phrase typed for a share.
    EncodedSeedPhrase,
    /// More marks than a joint repair takes.
    TooManyMarks,
    /// A ? that marks part of an element.
    MalformedMark,
    /// The share without which the others restore a phrase.
    ShareDoesNotFit,
    /// No share.
    ShareCountRefused,
    /// Shares of a set of several groups.
    SeveralGroups,
    /// Marked shares not of one set.
    SharesDoNotFit,
    /// Too much left open.
    TooManyCombinationsOpen,
    /// Shares the restore refuses.
    SharesDoNotRestore,
}

impl TroubleCode {
    /// Its code among the refusals of the shares.
    pub const fn code(self) -> &'static str {
        match self {
            Self::ShareOfAnotherSet => "sskr.share-input.share-of-another-set",
            Self::SharesOfDifferentSets => "sskr.share-input.shares-of-different-sets",
            Self::MemberGivenTwice => "sskr.share-input.member-given-twice",
            Self::GroupThresholdsConflict => "sskr.share-input.group-thresholds-conflict",
            Self::TooFewForThreshold => "sskr.share-input.too-few-for-threshold",
            Self::TooFewGroups => "sskr.share-input.too-few-groups",
            Self::ShareUnreadable => "sskr.share-input.share-unreadable",
            Self::SeedPhraseInWords => "sskr.share-input.seed-phrase-in-words",
            Self::EncodedSeedPhrase => "sskr.share-input.encoded-seed-phrase",
            Self::TooManyMarks => "sskr.share-input.too-many-marks",
            Self::MalformedMark => "sskr.share-input.malformed-mark",
            Self::ShareDoesNotFit => "sskr.share-input.share-does-not-fit",
            Self::ShareCountRefused => "sskr.share-input.share-count-refused",
            Self::SeveralGroups => "sskr.share-input.several-groups",
            Self::SharesDoNotFit => "sskr.share-input.shares-do-not-fit",
            Self::TooManyCombinationsOpen => "sskr.share-input.too-many-combinations-open",
            Self::SharesDoNotRestore => "sskr.share-input.shares-do-not-restore",
        }
    }

    /// The code of a conflict between two shares.
    const fn of_conflict(kind: ConflictKind) -> Self {
        match kind {
            ConflictKind::Set => Self::SharesOfDifferentSets,
            ConflictKind::Member => Self::MemberGivenTwice,
            ConflictKind::Threshold => Self::GroupThresholdsConflict,
        }
    }
}

/// A problem of the shares as typed: how a host mends it, its condition, the place of the share it
/// is about where it is one, and the message, which names the shares by their places. As a
/// refusal, where a host ends instead of mending it, its code is the condition's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareTrouble {
    /// How a host mends it.
    pub kind: TroubleKind,
    /// The condition.
    pub code: TroubleCode,
    /// The place of the share it is about, from 1.
    pub place: Option<usize>,
    /// The problem for the person.
    pub message: String,
}

impl ShareTrouble {
    fn new(kind: TroubleKind, code: TroubleCode, place: Option<usize>, message: String) -> Self {
        Self {
            kind,
            code,
            place,
            message,
        }
    }
}

impl fmt::Display for ShareTrouble {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ShareTrouble {}

impl Refusal for ShareTrouble {
    fn code(&self) -> &'static str {
        self.code.code()
    }
}

/// The refusals of typed shares, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InputError {
    /// More shares than a set has.
    Count(SetError),
    /// An answer without a share.
    NoShare,
    /// No share at the place: the place.
    NotTypedAt(usize),
    /// A seed phrase typed for a share.
    NotShare(ShareTrouble),
}

impl fmt::Display for InputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Count(error) => error.fmt(f),
            Self::NoShare => f.write_str("Type at least one share."),
            Self::NotTypedAt(place) => write!(f, "No share was typed at place {place}."),
            Self::NotShare(trouble) => trouble.fmt(f),
        }
    }
}

impl std::error::Error for InputError {}

impl Refusal for InputError {
    fn code(&self) -> &'static str {
        match self {
            Self::Count(error) => error.code(),
            Self::NoShare => "sskr.share-input.type-at-least-one-share",
            Self::NotTypedAt(_) => "sskr.share-input.no-share-was-typed-at-place",
            Self::NotShare(trouble) => trouble.code(),
        }
    }
}

impl From<SetError> for InputError {
    fn from(error: SetError) -> Self {
        Self::Count(error)
    }
}

/// A share as typed, and its place, by which every message names it.
#[derive(Debug)]
pub struct TypedShare {
    /// Where it was typed, from 1; kept when others are left out.
    pub place: usize,
    /// The share as typed, ? marks included.
    pub text: SecretText,
}

/// A share given at a place, as the copy rule and the checks of a set take it.
#[derive(Clone, Copy, Debug)]
pub struct PlacedShare<'a> {
    /// Its place.
    pub place: usize,
    /// The share.
    pub share: &'a Share,
}

/// A share typed again as an earlier one: left out, and used once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareCopy {
    /// The place of the copy.
    pub place: usize,
    /// The place of the share it copies.
    pub of: usize,
    /// The note, which names both places.
    pub message: String,
}

/// The shares of `shares` without the copies of earlier ones: each once, the first typed.
fn without_copies<'a>(shares: &[PlacedShare<'a>]) -> Vec<PlacedShare<'a>> {
    let mut kept: Vec<PlacedShare<'a>> = Vec::new();
    for share in shares {
        if !kept
            .iter()
            .any(|other| other.share.payload() == share.share.payload())
        {
            kept.push(*share);
        }
    }
    kept
}

/// The metadata of `shares`, in order.
fn infos_of(shares: &[PlacedShare<'_>]) -> Vec<ShareInfo> {
    shares.iter().map(|placed| placed.share.info()).collect()
}

/// Shares of which nothing tells the wrong one, named together.
fn undecided(places: &[usize], conflict: ConflictKind) -> ShareTrouble {
    ShareTrouble::new(
        TroubleKind::Refused,
        TroubleCode::of_conflict(conflict),
        None,
        format!(
            "Shares {} {}, and nothing tells which is right.",
            places_in_words(places),
            conflict.between()
        ),
    )
}

/// The first problem of complete shares that do not all belong together: a share of another set
/// than most named alone; shares of which nothing tells the wrong one named together.
fn set_trouble(shares: &[PlacedShare<'_>]) -> Option<ShareTrouble> {
    let infos = infos_of(shares);
    let mut sets: Vec<(SetKey, Vec<usize>)> = Vec::new();
    for (index, info) in infos.iter().enumerate() {
        match sets.iter_mut().find(|(set, _)| *set == set_of(info)) {
            Some((_, members)) => members.push(index),
            None => sets.push((set_of(info), vec![index])),
        }
    }
    let largest = sets.iter().map(|(_, members)| members.len()).max()?;
    let main: Vec<&Vec<usize>> = sets
        .iter()
        .map(|(_, members)| members)
        .filter(|members| members.len() == largest)
        .collect();
    if main.len() > 1 {
        let places: Vec<usize> = main
            .iter()
            .map(|members| shares[members[0]].place)
            .collect();
        return Some(undecided(&places, ConflictKind::Set));
    }
    let conflict = first_conflict(&infos, main[0][0])?;
    let (earlier, later) = (shares[conflict.with].place, shares[conflict.at].place);
    if conflict.kind == ConflictKind::Set {
        return Some(ShareTrouble::new(
            TroubleKind::Odd,
            TroubleCode::ShareOfAnotherSet,
            Some(later),
            format!("Share {later} is of another set than share {earlier}."),
        ));
    }
    Some(undecided(&[earlier, later], conflict.kind))
}

/// Why complete shares of one set are too few to restore it.
fn few_trouble(shares: &[PlacedShare<'_>]) -> Option<ShareTrouble> {
    let infos = infos_of(shares);
    let first = *infos.first()?;
    if SetTopology::new(&infos).enough() {
        return None;
    }
    if first.group_count == 1 {
        let typed = if shares.len() == 1 {
            "One share is".to_owned()
        } else {
            format!("These {} shares are", shares.len())
        };
        return Some(ShareTrouble::new(
            TroubleKind::Few,
            TroubleCode::TooFewForThreshold,
            None,
            format!(
                "{typed} not enough: this set needs {}.",
                first.member_threshold
            ),
        ));
    }
    Some(ShareTrouble::new(
        TroubleKind::Few,
        TroubleCode::TooFewGroups,
        None,
        format!(
            "These shares are not enough: this set needs {} of its {} groups, each with as many shares as its threshold.",
            first.group_threshold, first.group_count
        ),
    ))
}

/// The share at `place` that its reader refuses.
fn cannot_be_read(place: usize, error: &ShareTextError) -> ShareTrouble {
    ShareTrouble::new(
        TroubleKind::Unreadable,
        TroubleCode::ShareUnreadable,
        Some(place),
        after_place("Share", place, &error.to_string(), " cannot be read: "),
    )
}

/// What `text` is when it is a seed phrase rather than a share: English words of a phrase's
/// length, or codes of another form whose BIP39 checksum holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PhraseKind {
    Words,
    Encoded,
}

fn phrase_kind(text: &str) -> Option<PhraseKind> {
    detect(text).into_iter().find_map(|form| {
        if form == Form::English {
            return Some(PhraseKind::Words);
        }
        let indexes = form.read(text).ok()?;
        let all: Vec<usize> = indexes.iter().map(|&index| usize::from(index)).collect();
        Phrase::of_indexes(&all).ok().map(|_| PhraseKind::Encoded)
    })
}

/// Whether `text` is a share as it stands: one that reads, or one with marked elements.
fn share_or_marked(text: &str) -> bool {
    is_marked(text) || read_share(text).is_ok()
}

/// The share that parts from `start` on make together, and where it ends: parts that cannot be read
/// alone, that read as a share once joined, with spaces between them or without.
fn wrapped_share(parts: &[String], start: usize) -> Option<(String, usize)> {
    let mut lines: Vec<&str> = Vec::new();
    for (end, part) in parts.iter().enumerate().skip(start) {
        if lines.len() == MAX_WRAPPED_LINES || share_or_marked(part) {
            return None;
        }
        lines.push(part);
        if lines.len() < 2 {
            continue;
        }
        for separator in [" ", ""] {
            let text = lines.join(separator);
            if read_share(&text).is_ok() {
                return Some((text, end + 1));
            }
        }
    }
    None
}

/// The parts of an answer with each share a paste wrapped over lines joined again.
fn join_wrapped(parts: &[String]) -> Vec<String> {
    let mut shares = Vec::new();
    let mut start = 0;
    while start < parts.len() {
        match wrapped_share(parts, start) {
            Some((text, end)) => {
                shares.push(text);
                start = end;
            }
            None => {
                shares.push(parts[start].clone());
                start += 1;
            }
        }
    }
    shares
}

/// A complete share as read from its text, with its place and form.
#[derive(Debug)]
struct ReadTyped {
    place: usize,
    share: Share,
    format: ShareFormat,
}

/// What complete shares give: the set restored, or their first problem.
#[derive(Debug)]
pub enum CompleteOutcome {
    /// The set restored, the secret's length, and the places of its shares among those typed.
    Complete {
        /// The set.
        set: ShareSet,
        /// The secret's length in bytes.
        secret_bytes: usize,
        /// The places of the set's shares, copies left out.
        places: Vec<usize>,
    },
    /// The first problem found.
    Trouble(ShareTrouble),
}

/// Each share repaired alone: every one of them, the first that cannot be repaired, or the first
/// that fits several ways, whose variants a host shows and never chooses.
#[derive(Debug)]
pub enum EachRepair {
    /// Every share, repaired where ? marked an element, in the order typed.
    Repaired(Vec<SetShare>),
    /// A share that cannot be repaired: its place and why, with its refusal's code.
    Unreadable {
        /// Its place.
        place: usize,
        /// Why, naming the share by its place.
        message: String,
        /// The code of its repair's refusal.
        code: &'static str,
    },
    /// A share that fits several ways: nothing is saved.
    Variants {
        /// Its place.
        place: usize,
        /// Every way it fits.
        variants: Vec<SetShare>,
        /// Why nothing is saved.
        message: String,
    },
}

/// What an export of a set settles: the shares written, none, or why not these.
#[derive(Debug)]
pub enum CheckedExport {
    /// The shares written again, and any left out.
    Written(ShareExport),
    /// Every share has an element nothing settles: each is left out.
    None(ShareExport),
    /// Shares repaired each alone that are of several sets, or the same member twice.
    Trouble(ShareExport, ShareTrouble),
}

/// The shares typed, each with its place, while one is typed again, left out or joined by more.
#[derive(Debug)]
pub struct ShareInput {
    shares: Vec<TypedShare>,
    next_place: usize,
    decode_entry: String,
}

impl ShareInput {
    /// An empty input; `decode_entry` names where the host reads an encoded seed phrase, which a
    /// seed phrase typed in place of a share is sent to.
    pub fn new(decode_entry: &str) -> Self {
        Self {
            shares: Vec::new(),
            next_place: 1,
            decode_entry: decode_entry.to_owned(),
        }
    }

    /// The parts of a share file or paste, empty lines left out and wrapped shares joined;
    /// unreadable parts stay in place. Refuses more parts than a set has shares.
    pub fn parts_of_text(text: &str) -> Result<Vec<String>, SetError> {
        let parts: Vec<String> = without_byte_order_mark(text)
            .split(separates_shares)
            .map(|part| trim(part).to_owned())
            .filter(|part| !part.is_empty())
            .collect();
        if parts.is_empty() {
            return Ok(parts);
        }
        // Bounds the work below: wrapped or not, the parts make no more shares than a set has.
        check_share_count(parts.len().div_ceil(MAX_WRAPPED_LINES))?;
        let shares = join_wrapped(&parts);
        check_share_count(shares.len())?;
        Ok(shares)
    }

    /// Why complete shares cannot be restored together: shares of no one set and, unless `more`
    /// are still to come, too few for their quorum; copies left out first.
    pub fn complete_set_problem(shares: &[PlacedShare<'_>], more: bool) -> Option<ShareTrouble> {
        let kept = without_copies(shares);
        if kept.is_empty() {
            return None;
        }
        set_trouble(&kept).or_else(|| if more { None } else { few_trouble(&kept) })
    }

    /// The shares of `shares` that copy an earlier one, each with the place of the first and a
    /// note: a copy adds nothing to a restore, so it is left out and used once.
    pub fn copies_of(shares: &[PlacedShare<'_>]) -> Vec<ShareCopy> {
        shares
            .iter()
            .enumerate()
            .filter_map(|(index, share)| {
                let first = shares[..index]
                    .iter()
                    .find(|other| other.share.payload() == share.share.payload())?;
                Some(ShareCopy {
                    place: share.place,
                    of: first.place,
                    message: format!(
                        "Share {} is a copy of share {}: it is used once.",
                        share.place, first.place
                    ),
                })
            })
            .collect()
    }

    /// The shares typed, each with its place.
    pub fn list(&self) -> &[TypedShare] {
        &self.shares
    }

    /// The texts, in the order typed.
    pub fn texts(&self) -> Vec<&str> {
        self.shares
            .iter()
            .map(|share| share.text.as_str())
            .collect()
    }

    /// The place of each share, by its index in [`ShareInput::texts`].
    pub fn places(&self) -> Vec<usize> {
        self.shares.iter().map(|share| share.place).collect()
    }

    /// Whether an element of a share is marked with ?.
    pub fn marked(&self) -> bool {
        self.shares
            .iter()
            .any(|share| is_marked(share.text.as_str()))
    }

    /// Whether a share was typed at `place`, and is not left out.
    pub fn has(&self, place: usize) -> bool {
        self.shares.iter().any(|share| share.place == place)
    }

    /// The line for a seed phrase typed where a share was asked for; `subject` is "This is", "The
    /// file holds" or "Share N is".
    fn not_share(&self, kind: PhraseKind, subject: &str) -> ShareTrouble {
        let (code, message) = match kind {
            PhraseKind::Words => (
                TroubleCode::SeedPhraseInWords,
                format!(
                    "{subject} a seed phrase in words, not a Shamir share: {} reads a masked one.",
                    self.decode_entry
                ),
            ),
            PhraseKind::Encoded => (
                TroubleCode::EncodedSeedPhrase,
                format!(
                    "{subject} an encoded seed phrase, not a Shamir share: {} reads it.",
                    self.decode_entry
                ),
            ),
        };
        ShareTrouble::new(TroubleKind::Unreadable, code, None, message)
    }

    /// The shares in a text, typed, pasted or read from a file ([`ShareInput::parts_of_text`]);
    /// none for a text without one. A seed phrase is refused as one, `subject` naming the text.
    pub fn shares_of_text(&self, text: &str, subject: &str) -> Result<Vec<String>, InputError> {
        let shares = Self::parts_of_text(text)?;
        if shares.is_empty() {
            return Ok(shares);
        }
        // Looked for only when nothing reads as a share: a share in word numbers may have as many
        // numbers as a phrase has words.
        if !shares.iter().any(|share| share_or_marked(share))
            && let Some(kind) = phrase_kind(&shares.join(" "))
        {
            return Err(InputError::NotShare(self.not_share(kind, subject)));
        }
        Ok(shares)
    }

    /// The shares of one answer, at least one, checked to fit in a set: alone, or `adding` them to
    /// those typed.
    pub fn shares_of_answer(&self, answer: &str, adding: bool) -> Result<Vec<String>, InputError> {
        let shares = self.shares_of_text(answer, "This is")?;
        if shares.is_empty() {
            return Err(InputError::NoShare);
        }
        check_share_count(if adding { self.shares.len() } else { 0 } + shares.len())?;
        Ok(shares)
    }

    /// Adds shares after those typed, each at the next place.
    pub fn add<S: AsRef<str>>(&mut self, texts: &[S]) -> Result<(), SetError> {
        if texts.is_empty() {
            return Ok(());
        }
        check_share_count(self.shares.len() + texts.len())?;
        for text in texts {
            self.shares.push(TypedShare {
                place: self.next_place,
                text: SecretText::copy_of("a typed share", text.as_ref()),
            });
            self.next_place += 1;
        }
        Ok(())
    }

    /// Takes `texts` in place of every share typed before, at places from 1.
    pub fn replace_all<S: AsRef<str>>(&mut self, texts: &[S]) -> Result<(), SetError> {
        check_share_count(texts.len())?;
        self.shares.clear();
        self.next_place = 1;
        self.add(texts)
    }

    /// Takes `text` for the share at `place`, which keeps its place; refused where none was typed.
    pub fn replace(&mut self, place: usize, text: &str) -> Result<(), InputError> {
        let share = self
            .shares
            .iter_mut()
            .find(|share| share.place == place)
            .ok_or(InputError::NotTypedAt(place))?;
        share.text = SecretText::copy_of("a typed share", text);
        Ok(())
    }

    /// Leaves out the share at `place`; the others keep their places.
    pub fn leave_out(&mut self, place: usize) {
        self.shares.retain(|share| share.place != place);
    }

    /// Why the share `text`, typed at `place`, cannot be used before the others are looked at: a
    /// share without ? must read; one with ? may hold only as many marks as a joint repair takes.
    pub fn read_problem(&self, place: usize, text: &str) -> Option<ShareTrouble> {
        let unreadable = |code, message| {
            Some(ShareTrouble::new(
                TroubleKind::Unreadable,
                code,
                Some(place),
                message,
            ))
        };
        if is_marked(text) {
            if let Some(limit) = joint_mark_limit_problem(place, text) {
                return unreadable(TroubleCode::TooManyMarks, limit);
            }
            return mark_problem(text).and_then(|problem| {
                unreadable(
                    TroubleCode::MalformedMark,
                    after_place("Share", place, &problem, ": "),
                )
            });
        }
        let error = read_share(text).err()?;
        if let Some(kind) = phrase_kind(text) {
            let mut trouble = self.not_share(kind, &format!("Share {place} is"));
            trouble.place = Some(place);
            return Some(trouble);
        }
        Some(cannot_be_read(place, &error))
    }

    /// The first share typed that cannot be read.
    pub fn first_unreadable(&self) -> Option<ShareTrouble> {
        self.shares
            .iter()
            .find_map(|share| self.read_problem(share.place, share.text.as_str()))
    }

    /// Every complete share read; no share, or the first that cannot be read, is the trouble.
    fn read_all(&self) -> Result<Vec<ReadTyped>, ShareTrouble> {
        if let Err(error) = check_share_count(self.shares.len()) {
            return Err(ShareTrouble::new(
                TroubleKind::Few,
                TroubleCode::ShareCountRefused,
                None,
                error.to_string(),
            ));
        }
        if let Some(trouble) = self.first_unreadable() {
            return Err(trouble);
        }
        // A marked share passes the check above, and is never left out here: it cannot be read.
        self.shares
            .iter()
            .map(|typed| {
                let read = read_share(typed.text.as_str())
                    .map_err(|error| cannot_be_read(typed.place, &error))?;
                Ok(ReadTyped {
                    place: typed.place,
                    share: read.share,
                    format: read.format,
                })
            })
            .collect()
    }

    /// Restores complete shares: each read, copies left out and returned with a note, the set
    /// checked, and its phrase restored, every share checked against it. When they do not agree,
    /// the share without which the others restore a phrase is named: each is left out once.
    /// Refused only where the restore fails otherwise than by the shares not fitting.
    pub fn restore_complete(&mut self) -> Result<(CompleteOutcome, Vec<ShareCopy>), RestoreError> {
        let read = match self.read_all() {
            Ok(read) => read,
            Err(trouble) => return Ok((CompleteOutcome::Trouble(trouble), Vec::new())),
        };
        let placed: Vec<PlacedShare<'_>> = read
            .iter()
            .map(|typed| PlacedShare {
                place: typed.place,
                share: &typed.share,
            })
            .collect();
        let copies = Self::copies_of(&placed);
        let distinct: Vec<&ReadTyped> = read
            .iter()
            .filter(|typed| !copies.iter().any(|copy| copy.place == typed.place))
            .collect();
        for copy in &copies {
            self.leave_out(copy.place);
        }
        let kept: Vec<PlacedShare<'_>> = distinct
            .iter()
            .map(|typed| PlacedShare {
                place: typed.place,
                share: &typed.share,
            })
            .collect();
        if let Some(trouble) = set_trouble(&kept).or_else(|| few_trouble(&kept)) {
            return Ok((CompleteOutcome::Trouble(trouble), copies));
        }
        Ok((Self::restore_checked(&distinct)?, copies))
    }

    /// The set of `read`, checked as a set before; or the share named as the one that is wrong.
    fn restore_checked(read: &[&ReadTyped]) -> Result<CompleteOutcome, RestoreError> {
        let places: Vec<usize> = read.iter().map(|typed| typed.place).collect();
        let shares: Vec<&Share> = read.iter().map(|typed| &typed.share).collect();
        let refusal = match restore_complete(&shares, Some(&places)) {
            Ok(restored) => {
                let set = ShareSet::new(
                    restored.phrase,
                    read.iter()
                        .map(|typed| SetShare {
                            share: typed.share.copy(),
                            format: typed.format,
                            filled: Vec::new(),
                        })
                        .collect(),
                    Vec::new(),
                    &restored.unchecked,
                    restored.digest_checked,
                );
                return Ok(CompleteOutcome::Complete {
                    set,
                    secret_bytes: read[0].share.info().secret_length,
                    places,
                });
            }
            Err(refusal) if refusal.refuses_shares() => refusal,
            Err(other) => return Err(other),
        };
        let mut fits = Vec::new();
        for (index, typed) in read.iter().enumerate() {
            let remaining: Vec<&Share> = shares
                .iter()
                .enumerate()
                .filter(|&(other, _)| other != index)
                .map(|(_, &share)| share)
                .collect();
            let infos: Vec<ShareInfo> = remaining.iter().map(|share| share.info()).collect();
            if remaining.is_empty() || !SetTopology::new(&infos).enough() {
                continue;
            }
            match restore_complete(&remaining, None) {
                Ok(_) => fits.push(typed.place),
                Err(other) if other.refuses_shares() => {}
                Err(other) => return Err(other),
            }
        }
        Ok(CompleteOutcome::Trouble(match fits.as_slice() {
            [place] => ShareTrouble::new(
                TroubleKind::Odd,
                TroubleCode::ShareDoesNotFit,
                Some(*place),
                misfit_message(*place),
            ),
            _ => ShareTrouble::new(
                TroubleKind::Refused,
                TroubleCode::SharesDoNotRestore,
                None,
                refusal.to_string(),
            ),
        }))
    }

    /// The complete shares as one set to write again: no phrase is restored and no quorum needed.
    /// A share that cannot be read, or shares that are not of one set, are refused.
    pub fn rewritten(&self) -> Result<Vec<SetShare>, ShareTrouble> {
        let read = self.read_all()?;
        let placed: Vec<PlacedShare<'_>> = read
            .iter()
            .map(|typed| PlacedShare {
                place: typed.place,
                share: &typed.share,
            })
            .collect();
        if let Some(trouble) = set_trouble(&without_copies(&placed)) {
            return Err(trouble);
        }
        Ok(read
            .into_iter()
            .map(|typed| SetShare {
                share: typed.share,
                format: typed.format,
                filled: Vec::new(),
            })
            .collect())
    }

    /// The shares to write again, named by `places`, in `form` or their own: a share nothing settles
    /// is left out, and shares repaired each alone must still be of one set.
    pub fn checked_export(
        shares: &[SetShare],
        unsettled: &[MarkedElement],
        places: &[usize],
        form: Option<ShareFormat>,
    ) -> Result<CheckedExport, PlacesRefused> {
        let written = ShareExport::of(shares, unsettled, places, form)?;
        if written.shown().is_empty() {
            return Ok(CheckedExport::None(written));
        }
        let placed: Vec<PlacedShare<'_>> = written
            .shown()
            .iter()
            .map(|shown| PlacedShare {
                place: shown.number,
                share: &shown.share,
            })
            .collect();
        match set_trouble(&without_copies(&placed)) {
            Some(trouble) => Ok(CheckedExport::Trouble(written, trouble)),
            None => Ok(CheckedExport::Written(written)),
        }
    }

    /// Repairs each share alone, giving the first that cannot be repaired or fits several ways
    /// instead of guessing.
    pub fn repair_each(&self) -> EachRepair {
        let mut shares = Vec::new();
        for typed in &self.shares {
            match repair_candidates(typed.text.as_str(), LISTED_FREE_BITS) {
                Ok(mut variants) if variants.len() == 1 => shares.push(variants.remove(0)),
                Ok(variants) => {
                    return EachRepair::Variants {
                        place: typed.place,
                        message: format!(
                            "Share {} fits {} ways, so nothing is saved: use another copy of it, or more shares.",
                            typed.place,
                            variants.len()
                        ),
                        variants,
                    };
                }
                Err(error) => {
                    return EachRepair::Unreadable {
                        place: typed.place,
                        message: after_place("Share", typed.place, &error.to_string(), ": "),
                        code: error.code(),
                    };
                }
            }
        }
        EachRepair::Repaired(shares)
    }

    /// The problem an assessment of marked shares names, by its condition; none where they can be
    /// searched, or where the host stopped it, which is no problem of the shares. `places` are
    /// those the assessment was planned with.
    pub fn assessment_trouble(
        assessment: &JointAssessment,
        places: &[usize],
    ) -> Option<ShareTrouble> {
        if assessment.verdict == Verdict::Stopped {
            return None;
        }
        let reason = assessment.reason.clone()?;
        if let Some(unfit) = assessment.unfit {
            return Some(ShareTrouble::new(
                TroubleKind::Unreadable,
                TroubleCode::ShareUnreadable,
                places.get(unfit - 1).copied(),
                reason,
            ));
        }
        Some(match assessment.verdict {
            Verdict::NotEnough => ShareTrouble::new(
                TroubleKind::Few,
                TroubleCode::TooFewForThreshold,
                None,
                reason,
            ),
            Verdict::NoFit(kind) => ShareTrouble::new(
                TroubleKind::Refused,
                match kind {
                    NoFitKind::ShareUnreadable => TroubleCode::ShareUnreadable,
                    NoFitKind::SeveralGroups => TroubleCode::SeveralGroups,
                    NoFitKind::SharesDoNotFit => TroubleCode::SharesDoNotFit,
                },
                None,
                reason,
            ),
            _ => ShareTrouble::new(
                TroubleKind::Refused,
                TroubleCode::TooManyCombinationsOpen,
                None,
                reason,
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::Search;
    use crate::self_check::vectors::PUBLIC_MNEMONIC;
    use crate::sskr::testing::{mark_units, vector};

    const DECODE: &str = "The Decode tab";

    #[test]
    fn a_stopped_assessment_is_no_problem_of_the_shares() {
        let (shares, _) = vector(0);
        let plan = crate::sskr::joint::JointAssessor::new(&shares[..2], None)
            .unwrap()
            .finish();
        assert_eq!(plan.assessment.verdict, Verdict::Stopped);
        assert_eq!(
            ShareInput::assessment_trouble(&plan.assessment, &[1, 2]),
            None
        );
    }

    #[test]
    fn an_answer_is_split_into_shares_and_wrapped_ones_joined() {
        let (shares, _) = vector(0);
        let words = ShareFormat::Words.write(&read_share(&shares[1]).unwrap().share);
        let (first, second) = words.as_str().split_at(words.as_str().len() / 2);
        let answer = format!("{};\n{first}\n{second}\n", shares[0]);
        let input = ShareInput::new(DECODE);
        let parts = input.shares_of_answer(&answer, false).unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(
            read_share(&parts[1]).unwrap().share.payload(),
            read_share(&shares[1]).unwrap().share.payload()
        );
        assert_eq!(
            input.shares_of_answer(" ; ", false).unwrap_err(),
            InputError::NoShare
        );
        let phrase = input
            .shares_of_text(PUBLIC_MNEMONIC, "This is")
            .unwrap_err();
        assert_eq!(phrase.code(), "sskr.share-input.seed-phrase-in-words");
        assert_eq!(
            phrase.to_string(),
            "This is a seed phrase in words, not a Shamir share: The Decode tab reads a masked one."
        );
    }

    #[test]
    fn complete_shares_restore_and_copies_are_used_once() {
        let (shares, phrase) = vector(0);
        let mut input = ShareInput::new(DECODE);
        input
            .add(&[shares[0].clone(), shares[0].clone(), shares[1].clone()])
            .unwrap();
        let (outcome, copies) = input.restore_complete().unwrap();
        assert_eq!(copies.len(), 1);
        assert_eq!(
            copies[0].message,
            "Share 2 is a copy of share 1: it is used once."
        );
        let CompleteOutcome::Complete { set, places, .. } = outcome else {
            panic!("not restored");
        };
        assert_eq!(set.phrase().text().as_str(), phrase);
        assert_eq!(places, vec![1, 3]);
        assert_eq!(input.places(), vec![1, 3]);
    }

    #[test]
    fn trouble_names_the_shares_by_their_places() {
        let (shares, _) = vector(0);
        let (other, _) = vector(1);
        let mut few = ShareInput::new(DECODE);
        few.add(&[shares[0].clone()]).unwrap();
        let CompleteOutcome::Trouble(trouble) = few.restore_complete().unwrap().0 else {
            panic!("restored");
        };
        assert_eq!(trouble.code, TroubleCode::TooFewForThreshold);
        assert!(
            trouble
                .message
                .starts_with("One share is not enough: this set needs")
        );
        let mut unreadable = ShareInput::new(DECODE);
        unreadable
            .add(&["not a share", shares[0].as_str()])
            .unwrap();
        let first = unreadable.first_unreadable().unwrap();
        assert_eq!(
            (first.code, first.place),
            (TroubleCode::ShareUnreadable, Some(1))
        );
        assert!(first.message.starts_with("Share 1 cannot be read: "));
        let mut marked = ShareInput::new(DECODE);
        marked
            .add(&[
                mark_units(&shares[0], ShareFormat::Indexes, &[3]),
                other[1].clone(),
            ])
            .unwrap();
        assert!(marked.marked());
        assert_eq!(marked.first_unreadable(), None);
    }
}
