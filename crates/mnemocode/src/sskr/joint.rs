//! The repair of the shares of one set together (MnemoCode TS 0.1.0's `src/sskr/joint-repair.ts`,
//! CAP-SSKR-JOINT-ASSESS and CAP-SSKR-JOINT-SEARCH), each with elements marked with ? where they are
//! unreadable. Each share alone gives an affine space of solutions over the bits of its marks;
//! across shares the identifier and thresholds are equal, each share has its member number, and
//! every share beyond the threshold lies on their polynomial, all linear over GF(2). What is still
//! open is decided by bc-shamir's 32-bit digest: each candidate is checked with HMAC-SHA256, and
//! each that passes is restored by the engine. Every phrase that passes is reported; none is
//! chosen. Only sets of one group are repaired, which is all that MnemoCode writes. The host steps
//! the search and the assessment before it (ADR 0005).

mod assess;
pub(crate) mod solve;

use std::fmt;

pub use self::assess::{JointAssessor, plan_joint_repair};
pub use self::solve::ElementHelp;
use self::solve::{Branch, DIGEST_BITS, digest_fits};
use super::forms::ShareFormat;
use super::marks::{exceeds_marks, mark_limit, mark_problem};
use super::restore::{RestoreError, ShareSet};
use super::set::SetError;
use crate::bip39::sizes::{WORD_COUNTS, entropy_bytes};
use crate::refusal::Refusal;
use crate::search::{Progress, Search, SearchSize, Step};
use crate::secret::SecretBytes;
use crate::text::codes::with_joined_marks_hint;
use crate::text::words::after_place;

/// Marked elements on one share: the other shares settle most of them.
pub const MAX_JOINT_MARKED_ELEMENTS: usize = 64;
/// Combinations a search may try, 2^40 in all: they take weeks, and leave about 2^8 phrases that
/// pass by chance.
pub const MAX_SEARCH_BITS: u32 = 40;
/// Combinations of words that the partly read Unicode codes of all the shares are tried in.
const CODE_TRIALS: usize = super::marks::MAX_PARTIAL_UNIT_CANDIDATES;
/// The work all of those may do together for the choices of thresholds and member numbers.
const TRIAL_WORK: u64 = 1 << 19;
/// The digest checks on zero bytes of the pace sample.
const PACE_TRIES: usize = 10_000;
/// The longest secret, whose pace holds for every phrase.
const LONGEST_SECRET: usize = entropy_bytes(WORD_COUNTS[WORD_COUNTS.len() - 1]);
/// Why an assessment that the host stopped plans nothing.
const STOPPED_REASON: &str = "The assessment was stopped.";
/// The fewest seconds a pace sample is taken to last.
const LEAST_SAMPLE_SECONDS: f64 = 1e-6;

/// The refusals of a joint repair, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JointError {
    /// A count of shares that is no set's.
    Count(SetError),
    /// A share with more marks than a joint repair takes: why, by its place.
    MarkLimit(String),
    /// A share whose marks fit too many ways: why, by its place.
    Readings(String),
    /// What the restore of a candidate refuses, other than the shares not fitting.
    Restore(RestoreError),
}

impl fmt::Display for JointError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Count(error) => error.fmt(f),
            Self::MarkLimit(text) | Self::Readings(text) => f.write_str(text),
            Self::Restore(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for JointError {}

impl Refusal for JointError {
    fn code(&self) -> &'static str {
        match self {
            Self::Count(error) => error.code(),
            Self::MarkLimit(_) => "sskr.joint-repair.plan-joint-repair-refused",
            Self::Readings(_) => "sskr.joint-repair.readings-refused",
            Self::Restore(error) => error.code(),
        }
    }
}

/// Why the share at `place`, from 1, holds more marks than a joint repair takes.
pub fn joint_mark_limit_problem(place: usize, text: &str) -> Option<String> {
    exceeds_marks(text, MAX_JOINT_MARKED_ELEMENTS).then(|| {
        after_place(
            "Share",
            place,
            &format!("{}.", mark_limit(MAX_JOINT_MARKED_ELEMENTS)),
            ": ",
        )
    })
}

/// What one share is on its own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareAssessment {
    /// Marked elements as typed: a lone ? or a code read in part counts once.
    pub marks: usize,
    /// The forms some reading of it fits, each once.
    pub forms: Vec<ShareFormat>,
    /// Bits still open when it is solved alone, the fewest over its readings.
    pub open_alone: usize,
}

/// Which condition refuses shares that do not fit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoFitKind {
    /// A share no reading fits.
    ShareUnreadable,
    /// Shares of a set of several groups.
    SeveralGroups,
    /// Shares that are not of one set as read.
    SharesDoNotFit,
}

impl NoFitKind {
    /// Its code, as a host words it.
    pub const fn name(self) -> &'static str {
        match self {
            Self::ShareUnreadable => "share-unreadable",
            Self::SeveralGroups => "several-groups",
            Self::SharesDoNotFit => "shares-do-not-fit",
        }
    }
}

/// What the assessment allows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// No bit is open: the search checks one candidate per way to read the shares.
    Determined,
    /// The digest decides among the combinations.
    Search,
    /// Too much is open to search, or too many forms, ways or member numbers fit.
    TooUncertain,
    /// The shares do not fit.
    NoFit(NoFitKind),
    /// Too few shares.
    NotEnough,
    /// The host stopped the assessment: nothing is planned.
    Stopped,
}

/// What the shares are together, before any search.
#[derive(Clone, Debug, PartialEq)]
pub struct JointAssessment {
    /// Each share on its own.
    pub shares: Vec<ShareAssessment>,
    /// The secret's length in bytes, where every way agrees.
    pub secret_bytes: Option<usize>,
    /// The set's member threshold, where every way agrees.
    pub threshold: Option<usize>,
    /// Ways to read the shares that fit every equation.
    pub branches: usize,
    /// Bits only the digest can decide, the most over the ways.
    pub open_bits: usize,
    /// Digest checks of the search.
    pub combinations: f64,
    /// Phrases expected to pass the digest by chance.
    pub expected_false: f64,
    /// More shares without marks that would settle every open bit.
    pub more_shares: usize,
    /// Elements whose reading would leave fewer bits open, best first.
    pub helps: Vec<ElementHelp>,
    /// The share, from 1, no reading fits.
    pub unfit: Option<usize>,
    /// What it allows.
    pub verdict: Verdict,
    /// Why nothing is searched, in English; none where a search is allowed.
    pub reason: Option<String>,
}

/// The plan of an assessment: what was assessed and, where it allows one, its search.
#[derive(Debug)]
pub struct JointPlan {
    /// What the shares were assessed as.
    pub assessment: JointAssessment,
    branches: Vec<Branch>,
}

impl JointPlan {
    /// The search of the plan; none where its verdict refuses one.
    pub fn search(self) -> Option<JointSearch> {
        matches!(
            self.assessment.verdict,
            Verdict::Determined | Verdict::Search
        )
        .then(|| JointSearch::new(self.branches))
    }
}

/// A plan that refuses with `verdict`, as `reason` says.
fn refusal(
    shares: Vec<ShareAssessment>,
    verdict: Verdict,
    reason: String,
    unfit: Option<usize>,
) -> JointPlan {
    JointPlan {
        assessment: JointAssessment {
            shares,
            secret_bytes: None,
            threshold: None,
            branches: 0,
            open_bits: 0,
            combinations: 0.0,
            expected_false: 0.0,
            more_shares: 0,
            helps: Vec::new(),
            unfit,
            verdict,
            reason: Some(reason),
        },
        branches: Vec::new(),
    }
}

/// The refusal of a share no reading fits, named "Share `name`".
fn unreadable_share_message(name: usize, marks: usize, text: &str) -> String {
    if let Some(problem) = mark_problem(text) {
        return after_place("Share", name, &problem, ": ");
    }
    if marks == 0 {
        format!("Share {name} cannot be read as a share: check each of its elements.")
    } else {
        with_joined_marks_hint(
            &format!(
                "Share {name} cannot be read as a share: check the elements marked with ?, and the others."
            ),
            text,
        )
    }
}

/// The combinations a search of `branches` tries.
fn combinations_of(branches: &[Branch]) -> f64 {
    branches
        .iter()
        .map(|branch| 2_f64.powi(branch.open_bits() as i32))
        .sum()
}

/// The value of a field when every branch agrees on it.
fn agreed(branches: &[Branch], field: fn(&Branch) -> usize) -> Option<usize> {
    let first = field(branches.first()?);
    branches
        .iter()
        .all(|branch| field(branch) == first)
        .then_some(first)
}

/// The assessment of `branches` and the plan of their search, with what would `helps`.
fn plan_of(
    shares: Vec<ShareAssessment>,
    branches: Vec<Branch>,
    helps: Vec<ElementHelp>,
) -> JointPlan {
    let open_bits = branches.iter().map(Branch::open_bits).max().unwrap_or(0);
    let combinations = combinations_of(&branches);
    let too_open = combinations > 2_f64.powi(MAX_SEARCH_BITS as i32);
    let marks: Vec<usize> = shares.iter().map(|share| share.marks).collect();
    let assessment = JointAssessment {
        secret_bytes: agreed(&branches, Branch::secret_bytes),
        threshold: agreed(&branches, Branch::threshold),
        branches: branches.len(),
        open_bits,
        combinations,
        expected_false: (combinations - 1.0) / 2_f64.powi(DIGEST_BITS as i32),
        more_shares: branches
            .iter()
            .map(|branch| branch.shares_to_settle(&marks))
            .max()
            .unwrap_or(0),
        helps,
        unfit: None,
        verdict: if too_open {
            Verdict::TooUncertain
        } else if open_bits == 0 {
            Verdict::Determined
        } else {
            Verdict::Search
        },
        reason: too_open.then(|| {
            format!(
                "About 2^{} combinations stay open; at most 2^{MAX_SEARCH_BITS} can be searched.",
                combinations.log2().ceil()
            )
        }),
        shares,
    };
    JointPlan {
        assessment,
        branches: if too_open { Vec::new() } else { branches },
    }
}

/// The digest checks on zero bytes that a host times before a search is planned, whatever its
/// shares: a report tells the time of a search that it refuses too.
pub fn pace_sample() {
    let sample = [0_u8; 2 * LONGEST_SECRET];
    for _ in 0..PACE_TRIES {
        std::hint::black_box(digest_fits(&sample, LONGEST_SECRET));
    }
}

/// Digest checks a second in this host, from the `seconds` that [`pace_sample`] took.
pub fn tries_per_second(seconds: f64) -> f64 {
    PACE_TRIES as f64 / seconds.max(LEAST_SAMPLE_SECONDS)
}

/// The (S, D) of the first candidate of `branch`, none past the last branch.
fn first_candidate(branch: Option<&Branch>) -> SecretBytes {
    SecretBytes::copy_of(
        "a secret and its digest",
        branch.map_or(&[][..], |branch| branch.first_secret_and_digest()),
    )
}

/// What a search of marked shares gives: every distinct set that passed, possibly none, and
/// whether it was stopped before the end.
#[derive(Debug)]
pub struct RepairSearch {
    /// One set for each distinct phrase, in the order found.
    pub sets: Vec<ShareSet>,
    /// The host stopped it: the sets are only those found before.
    pub stopped: bool,
}

/// The search of a plan, which the host steps: every open combination of every branch tried
/// against the digest in Gray code order, each candidate that passes read and restored.
#[derive(Debug)]
pub struct JointSearch {
    branches: Vec<Branch>,
    branch: usize,
    step: u64,
    /// The (S, D) of the candidate at hand.
    current: SecretBytes,
    found: Vec<ShareSet>,
    checked: u64,
    total: u64,
    done: bool,
}

impl JointSearch {
    fn new(branches: Vec<Branch>) -> Self {
        let total = combinations_of(&branches) as u64;
        let current = first_candidate(branches.first());
        Self {
            branches,
            branch: 0,
            step: 0,
            current,
            found: Vec::new(),
            checked: 0,
            total,
            done: false,
        }
    }

    fn progress(&self) -> Progress {
        Progress {
            checked: self.checked,
            total: Some(self.total),
            found: self.found.len() as u64,
        }
    }

    /// Adds a phrase found, merged with an earlier candidate of the same phrase.
    fn add(&mut self, set: ShareSet) {
        match self
            .found
            .iter()
            .position(|known| known.phrase().text().as_str() == set.phrase().text().as_str())
        {
            Some(at) => {
                let known = self.found.remove(at);
                self.found.insert(at, known.merged(set));
            }
            None => self.found.push(set),
        }
    }

    /// Runs the whole search at once, as a library call without a host's turns does.
    pub fn run(mut self) -> Result<RepairSearch, JointError> {
        while let Step::Running(_) = self.step(u32::MAX)? {}
        Ok(self.finish())
    }
}

impl Search for JointSearch {
    type Outcome = RepairSearch;
    type Error = JointError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: self.total,
            pace_parts: 1,
        }
    }

    fn pace_sample(&self, _part: u8) -> Result<(), JointError> {
        pace_sample();
        Ok(())
    }

    fn step(&mut self, work: u32) -> Result<Step, JointError> {
        for _ in 0..work {
            let Some(branch) = self.branches.get(self.branch) else {
                self.done = true;
                return Ok(Step::Done(self.progress()));
            };
            let combinations = 1_u64 << branch.open_bits();
            if self.step > 0 {
                let delta = branch.visible_delta(self.step.trailing_zeros() as usize);
                for (byte, change) in self.current.iter_mut().zip(delta) {
                    *byte ^= change;
                }
            }
            // Told after the search has moved on: a failure leaves it at its next candidate.
            let confirmed = if digest_fits(&self.current, branch.secret_bytes()) {
                branch.confirm(&branch.point_at(self.step))
            } else {
                Ok(None)
            };
            self.checked += 1;
            self.step += 1;
            if self.step == combinations {
                self.branch += 1;
                self.step = 0;
                self.current = first_candidate(self.branches.get(self.branch));
            }
            if let Some(candidate) = confirmed.map_err(JointError::Restore)? {
                self.add(ShareSet::of_candidate(candidate));
            }
        }
        if self.branch >= self.branches.len() {
            self.done = true;
            return Ok(Step::Done(self.progress()));
        }
        Ok(Step::Running(self.progress()))
    }

    fn finish(self) -> RepairSearch {
        RepairSearch {
            sets: self.found,
            stopped: !self.done,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bip39::phrase::Phrase;
    use crate::self_check::vectors::PUBLIC_MNEMONIC;
    use crate::sskr::split::split;
    use crate::sskr::testing::{
        Counting, mark_same_digits, mark_units, payload, share_units, vector,
    };

    /// The sets the plan of `typed` finds, searched at once.
    fn found(typed: &[String]) -> Vec<ShareSet> {
        plan_joint_repair(typed, None)
            .unwrap()
            .search()
            .unwrap()
            .run()
            .unwrap()
            .sets
    }

    /// Two shares of three each missing two elements.
    fn marked_pair() -> Vec<String> {
        let (shares, _) = vector(0);
        shares[..2]
            .iter()
            .enumerate()
            .map(|(index, share)| mark_units(share, ShareFormat::Words, &[index + 6, index + 7]))
            .collect()
    }

    fn phrases(sets: &[ShareSet]) -> Vec<String> {
        sets.iter()
            .map(|set| set.phrase().text().as_str().to_owned())
            .collect()
    }

    #[test]
    fn a_search_prints_no_candidate() {
        let search = plan_joint_repair(&marked_pair(), None)
            .unwrap()
            .search()
            .unwrap();
        let printed = format!("{search:?}");
        assert!(printed.contains("current: "));
        assert!(printed.contains("redacted"));
        // A byte list of the candidate would hold commas; a redacted owner holds none.
        let current = printed.split("current: ").nth(1).unwrap();
        assert!(!current.split(", found").next().unwrap().contains(','));
    }

    #[test]
    fn a_stop_ends_an_assessment_with_nothing_planned() {
        let typed = marked_pair();
        let plan = JointAssessor::new(&typed, None).unwrap().finish();
        assert_eq!(plan.assessment.verdict, Verdict::Stopped);
        assert_eq!(
            plan.assessment.reason.as_deref(),
            Some("The assessment was stopped.")
        );
        assert!(plan.assessment.shares.is_empty());
        assert!(plan.search().is_none());

        let mut assessor = JointAssessor::new(&typed, None).unwrap();
        assert!(
            matches!(assessor.step(3).unwrap(), Step::Running(progress) if progress.checked == 3)
        );
        let plan = assessor.finish();
        assert_eq!(plan.assessment.verdict, Verdict::Stopped);
        assert_eq!(plan.assessment.shares.len(), 2);
    }

    #[test]
    fn a_pace_is_taken_from_the_seconds_of_its_sample() {
        assert!((tries_per_second(1.0) - PACE_TRIES as f64).abs() < 1e-9);
        assert!((tries_per_second(0.0) - PACE_TRIES as f64 * 1e6).abs() < 1.0);
        pace_sample();
    }

    #[test]
    fn two_shares_of_three_each_missing_two_elements_restore_in_every_form() {
        for index in 0..5 {
            let (shares, phrase) = vector(index);
            for format in ShareFormat::ALL {
                let typed: Vec<String> = shares
                    .iter()
                    .enumerate()
                    .map(|(at, share)| mark_units(share, format, &[2 + at, 7 + at]))
                    .collect();
                let plan = plan_joint_repair(&typed, None).unwrap();
                assert_eq!(
                    plan.assessment.verdict,
                    Verdict::Determined,
                    "{index} {format:?}"
                );
                let sets = plan.search().unwrap().run().unwrap().sets;
                assert_eq!(phrases(&sets), vec![phrase.clone()]);
                for (read, share) in sets[0].shares().iter().zip(&shares) {
                    assert_eq!(read.share.payload(), payload(share));
                    assert_eq!(read.format, format);
                }
                assert!(sets[0].unsettled().is_empty());
            }
        }
    }

    #[test]
    fn shares_together_settle_what_none_settles_alone() {
        let (shares, phrase) = vector(0);
        let typed: Vec<String> = shares
            .iter()
            .enumerate()
            .map(|(at, share)| {
                let places: Vec<usize> = [1, 4, 6, 9, 12, 15].iter().map(|p| p + at).collect();
                mark_units(share, ShareFormat::Indexes, &places)
            })
            .collect();
        let plan = plan_joint_repair(&typed, None).unwrap();
        assert!(
            plan.assessment
                .shares
                .iter()
                .all(|share| share.open_alone > 0)
        );
        assert_eq!(plan.assessment.open_bits, 0);
        assert_eq!(
            phrases(&plan.search().unwrap().run().unwrap().sets),
            vec![phrase]
        );
    }

    #[test]
    fn a_share_is_rebuilt_from_the_others_or_left_unsettled() {
        let (shares, phrase) = vector(1);
        let length = share_units(&shares[2], ShareFormat::Indexes).len();
        let secret: Vec<usize> = (11..length).collect();
        let typed = vec![
            shares[0].clone(),
            shares[1].clone(),
            mark_units(&shares[2], ShareFormat::Indexes, &secret),
        ];
        let sets = found(&typed);
        assert_eq!(sets[0].shares()[2].share.payload(), payload(&shares[2]));
        assert!(sets[0].unsettled().is_empty());
        let all: Vec<usize> = (0..length).collect();
        let wholly = vec![
            shares[0].clone(),
            shares[1].clone(),
            mark_units(&shares[2], ShareFormat::Indexes, &all),
        ];
        let sets = found(&wholly);
        assert_eq!(phrases(&sets), vec![phrase]);
        assert!(!sets[0].unsettled().is_empty());
        assert!(sets[0].unsettled().iter().all(|element| element.share == 3));
    }

    #[test]
    fn two_damaged_copies_of_one_share_combine() {
        let (shares, phrase) = vector(0);
        let typed = vec![
            mark_units(&shares[0], ShareFormat::Colors, &[2, 3, 4]),
            mark_units(&shares[0], ShareFormat::Colors, &[5, 6, 7]),
            mark_units(&shares[1], ShareFormat::Colors, &[8]),
        ];
        let sets = found(&typed);
        assert_eq!(phrases(&sets), vec![phrase]);
        assert_eq!(sets[0].shares()[1].share.payload(), payload(&shares[0]));
    }

    #[test]
    fn a_three_of_five_set_names_what_would_help() {
        let phrase = Phrase::parse(PUBLIC_MNEMONIC).unwrap();
        let shares: Vec<String> = split(&phrase, 3, 5, &mut Counting(3))
            .unwrap()
            .iter()
            .map(|share| share.ur().as_str().to_owned())
            .collect();
        let all: Vec<String> = shares
            .iter()
            .enumerate()
            .map(|(at, share)| mark_units(share, ShareFormat::Indexes, &[2 + at, 9 + at]))
            .collect();
        let plan = plan_joint_repair(&all, None).unwrap();
        assert_eq!(plan.assessment.threshold, Some(3));
        assert_eq!(plan.assessment.verdict, Verdict::Determined);
        let three = vec![
            shares[0].clone(),
            shares[1].clone(),
            mark_units(&shares[2], ShareFormat::Indexes, &[10, 13, 16, 19]),
        ];
        let open = plan_joint_repair(&three, None).unwrap();
        assert!(open.assessment.open_bits > 0);
        assert_eq!(open.assessment.verdict, Verdict::Search);
        assert_eq!(open.assessment.more_shares, 1);
        assert!(!open.assessment.helps.is_empty());
        assert!(
            phrases(&open.search().unwrap().run().unwrap().sets)
                .contains(&PUBLIC_MNEMONIC.to_owned())
        );
    }

    #[test]
    fn missing_and_foreign_shares_are_told_apart() {
        let (shares, _) = vector(0);
        let one =
            plan_joint_repair(&[mark_units(&shares[0], ShareFormat::Indexes, &[4])], None).unwrap();
        assert_eq!(one.assessment.verdict, Verdict::NotEnough);
        assert!(one.search().is_none());
        let twice = plan_joint_repair(
            &[
                mark_units(&shares[0], ShareFormat::Indexes, &[4]),
                shares[0].clone(),
            ],
            None,
        )
        .unwrap();
        assert!(twice.assessment.reason.unwrap().contains("more than once"));
        let (foreign, _) = vector(1);
        let mixed = plan_joint_repair(
            &[
                mark_units(&shares[0], ShareFormat::Indexes, &[4]),
                foreign[1].clone(),
            ],
            None,
        )
        .unwrap();
        assert!(matches!(mixed.assessment.verdict, Verdict::NoFit(_)));
        let unreadable = plan_joint_repair(
            &[
                "not a share at all".to_owned(),
                mark_units(&shares[1], ShareFormat::Colors, &[5]),
            ],
            None,
        )
        .unwrap();
        assert_eq!(
            unreadable.assessment.verdict,
            Verdict::NoFit(NoFitKind::ShareUnreadable)
        );
        assert_eq!(unreadable.assessment.unfit, Some(1));
    }

    #[test]
    fn digits_read_settle_colors_and_codes_on_both_shares() {
        let (shares, phrase) = vector(0);
        let colors = vec![
            mark_same_digits(&shares[0], ShareFormat::Colors, &[4, 5, 6], &[4, 5]),
            mark_same_digits(&shares[1], ShareFormat::Colors, &[6, 7], &[3, 4, 5]),
        ];
        let plan = plan_joint_repair(&colors, None).unwrap();
        assert_eq!(plan.assessment.open_bits, 0);
        assert_eq!(
            phrases(&plan.search().unwrap().run().unwrap().sets),
            vec![phrase.clone()]
        );
        let codes = vec![
            mark_same_digits(&shares[0], ShareFormat::Unicode, &[4, 7, 9, 12, 15], &[3]),
            mark_same_digits(&shares[1], ShareFormat::Unicode, &[5, 8, 10, 13], &[2]),
        ];
        let plan = plan_joint_repair(&codes, None).unwrap();
        assert_eq!(plan.assessment.verdict, Verdict::Determined);
        let sets = plan.search().unwrap().run().unwrap().sets;
        assert_eq!(phrases(&sets), vec![phrase]);
        assert_eq!(
            sets[0].shares()[0]
                .filled
                .iter()
                .map(|element| element.position)
                .collect::<Vec<_>>(),
            vec![5, 8, 10, 13, 16]
        );
    }
}
