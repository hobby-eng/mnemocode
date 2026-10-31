//! The assessment of marked shares, a piece at a time (MnemoCode TS 0.1.0's `planJointRepair` of
//! `src/sskr/joint-repair.ts`, CAP-SSKR-JOINT-ASSESS): each share read, every combination of their
//! readings solved, partly read codes tried word by word where that shortens the search, and what
//! would help found. It can take a while for many marks, so the host steps it (ADR 0005), where TS
//! takes its turns.

use std::rc::Rc;

use super::solve::{
    Branch, ElementHelp, LabelWalk, MAX_BRANCHES, SolvedWays, WorkBudget, helpful_elements_of,
    several_groups, widest_branch,
};
use super::{
    CODE_TRIALS, JointError, JointPlan, NoFitKind, STOPPED_REASON, ShareAssessment, TRIAL_WORK,
    Verdict, combinations_of, joint_mark_limit_problem, plan_of, refusal, solve,
    unreadable_share_message,
};
use crate::bip39::sizes::word_count_of_entropy;
use crate::search::{Progress, Search, SearchSize, Step};
use crate::secret::SecretText;
use crate::sskr::forms::ShareFormat;
use crate::sskr::marks::{AmbiguousMarks, mark_count};
use crate::sskr::repair::places_within;
use crate::sskr::repair::reading::{MarkedReading, ReadingSpace, every_pick};
use crate::sskr::set::check_share_count;
use crate::sskr::share::SHARE_METADATA_BYTES;
use crate::text::space::trim;
use crate::text::words::{after_place, place_of};

/// What solving every combination of the shares' readings gives.
#[derive(Debug, Default)]
struct Solved {
    ways: SolvedWays,
    /// Some length of the secret is one every share can be read in.
    same_length: bool,
    /// Why the shares cannot be assessed: too many forms, ways or member numbers fit.
    refused: Option<String>,
}

/// Every combination of one reading of each share, for each secret length every share can be read
/// in, solved a piece at a time, the ways gathered.
#[derive(Debug)]
struct ReadingsWalk {
    spaces_of: Vec<Vec<Rc<ReadingSpace>>>,
    /// The lengths still to solve, the next last.
    lengths: Vec<usize>,
    /// The readings of this length still to solve, the next last.
    readings: Vec<Vec<Rc<ReadingSpace>>>,
    secret_bytes: usize,
    labels: Option<LabelWalk>,
    budget: Option<WorkBudget>,
    solved: Solved,
}

impl ReadingsWalk {
    fn new(spaces_of: Vec<Vec<Rc<ReadingSpace>>>, budget: Option<WorkBudget>) -> Self {
        let mut lengths: Vec<usize> = Vec::new();
        for space in &spaces_of[0] {
            let length = space.reading().structure().payload_length();
            if !lengths.contains(&length) {
                lengths.push(length);
            }
        }
        lengths.reverse();
        Self {
            spaces_of,
            lengths,
            readings: Vec::new(),
            secret_bytes: 0,
            labels: None,
            budget,
            solved: Solved::default(),
        }
    }

    /// Takes the readings of the secret length that `payload_length` gives, if every share can be
    /// read in it.
    fn take_length(&mut self, payload_length: usize) {
        let secret_bytes = payload_length - SHARE_METADATA_BYTES;
        if word_count_of_entropy(secret_bytes).is_none() {
            return;
        }
        let choices: Vec<Vec<Rc<ReadingSpace>>> = self
            .spaces_of
            .iter()
            .map(|spaces| {
                spaces
                    .iter()
                    .filter(|space| space.reading().structure().payload_length() == payload_length)
                    .cloned()
                    .collect()
            })
            .collect();
        if choices.iter().any(Vec::is_empty) {
            return;
        }
        self.solved.same_length = true;
        let Some(mut readings) = every_pick(&choices, MAX_BRANCHES) else {
            self.solved.refused = Some("Too many forms fit these shares; mark fewer.".to_owned());
            return;
        };
        // The fewest forms first: a share all marked is then taken in the form of the others.
        let forms_in = |spaces: &Vec<Rc<ReadingSpace>>| {
            let mut forms: Vec<ShareFormat> = Vec::new();
            for space in spaces {
                if !forms.contains(&space.reading().format()) {
                    forms.push(space.reading().format());
                }
            }
            forms.len()
        };
        readings.sort_by_key(forms_in);
        readings.reverse();
        self.readings = readings;
        self.secret_bytes = secret_bytes;
    }

    /// Takes in the ways of a reading.
    fn take_ways(&mut self, ways: SolvedWays) {
        if ways.too_many {
            self.solved.refused = Some(
                "The member numbers of these shares cannot be told; read more of their first elements."
                    .to_owned(),
            );
            return;
        }
        self.solved.ways = std::mem::take(&mut self.solved.ways).with(ways);
        if self.solved.ways.branches.len() > MAX_BRANCHES {
            self.solved.refused = Some("Too many ways fit these shares; mark fewer.".to_owned());
        }
    }

    /// Solves the next piece; whether any is left.
    fn step(&mut self) -> bool {
        if self.solved.refused.is_some() {
            return false;
        }
        if let Some(labels) = &mut self.labels {
            if !labels.step()
                && let Some(labels) = self.labels.take()
            {
                self.take_ways(labels.finish());
            }
            return true;
        }
        if let Some(spaces) = self.readings.pop() {
            let joint = solve::Joint::new(spaces, self.secret_bytes);
            self.labels = Some(LabelWalk::new(joint, self.budget.as_mut()));
            return true;
        }
        match self.lengths.pop() {
            Some(length) => {
                self.take_length(length);
                true
            }
            None => false,
        }
    }
}

/// The spaces of `readings`, each solved; those that no values fit are left out.
fn spaces_from(readings: Vec<MarkedReading>) -> Vec<Rc<ReadingSpace>> {
    readings
        .iter()
        .filter_map(MarkedReading::space)
        .map(Rc::new)
        .collect()
}

/// The shares' partly read Unicode codes to try word by word, by share and place: the codes that
/// reach the metadata first, then those with the fewest words, within [`CODE_TRIALS`] combinations;
/// none when no code is read in part or nothing can shorten a search of `before` combinations.
fn codes_to_try(spaces_of: &[Vec<Rc<ReadingSpace>>], before: f64) -> Option<Vec<(usize, usize)>> {
    if before <= 1.0 {
        return None;
    }
    let mut units: Vec<(bool, usize, usize, usize)> = Vec::new();
    for (share, spaces) in spaces_of.iter().enumerate() {
        let Some(space) = spaces
            .iter()
            .find(|space| !space.reading().candidate_counts().is_empty())
        else {
            continue;
        };
        let reading = space.reading();
        for (place, count) in reading.candidate_counts() {
            units.push((reading.reaches_metadata(place), count, share, place));
        }
    }
    units.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let counted: Vec<(usize, usize)> = units
        .iter()
        .enumerate()
        .map(|(index, unit)| (index, unit.1))
        .collect();
    let chosen: Vec<(usize, usize)> = places_within(&counted, CODE_TRIALS)
        .iter()
        .map(|&(index, _)| (units[index].2, units[index].3))
        .collect();
    (!chosen.is_empty()).then_some(chosen)
}

/// The readings of `share` with the codes of `chosen` tried word by word.
fn expanded_share(
    spaces: &[Rc<ReadingSpace>],
    share: usize,
    chosen: &[(usize, usize)],
) -> Vec<Rc<ReadingSpace>> {
    let places: Vec<usize> = chosen
        .iter()
        .filter(|&&(of, _)| of == share)
        .map(|&(_, place)| place)
        .collect();
    spaces
        .iter()
        .flat_map(|space| spaces_from(space.reading().choices_at(&places)))
        .collect()
}

/// The search of `branches` found: what would help comes next.
const fn helping(branches: Vec<Branch>) -> Stage {
    Stage::Helping {
        branches,
        share: 0,
        helps: Vec::new(),
    }
}

/// Where an assessment stands.
#[derive(Debug)]
enum Stage {
    /// Reading the shares, one by one.
    Reading,
    /// Solving their readings.
    Solving(ReadingsWalk),
    /// Reading each share with its partly read codes tried word by word.
    Expanding {
        chosen: Vec<(usize, usize)>,
        expanded: Vec<Vec<Rc<ReadingSpace>>>,
        before: f64,
        kept: Kept,
    },
    /// Solving those readings, to better what is `kept`.
    Refining {
        walk: Box<ReadingsWalk>,
        before: f64,
        kept: Kept,
    },
    /// Finding what would help, a share at a time.
    Helping {
        branches: Vec<Branch>,
        share: usize,
        helps: Vec<ElementHelp>,
    },
    /// The plan.
    Ended(JointPlan),
}

/// What an assessment gives where trying partly read codes word by word does not better it.
#[derive(Debug)]
enum Kept {
    /// The ways solved.
    Branches(Vec<Branch>),
    /// The reason it cannot be assessed.
    Refused(String),
}

/// The assessment of shares as typed, with ? for each unreadable element, a piece at a time: it can
/// take a while for many marks, so the host steps it and can stop it, as it does a search, and a
/// stop plans nothing.
#[derive(Debug)]
pub struct JointAssessor {
    texts: Vec<SecretText>,
    places: Option<Vec<usize>>,
    spaces_of: Vec<Vec<Rc<ReadingSpace>>>,
    shares: Vec<ShareAssessment>,
    stage: Stage,
    steps: u64,
}

impl JointAssessor {
    /// The assessment of `records`. A refusal names a share by its place in `places`, by its index
    /// from 1 without them. Refuses a count of shares that is no set's, and a share with more marks
    /// than a joint repair takes; a step refuses one whose marks fit too many ways.
    pub fn new<S: AsRef<str>>(records: &[S], places: Option<&[usize]>) -> Result<Self, JointError> {
        check_share_count(records.len()).map_err(JointError::Count)?;
        let texts: Vec<SecretText> = records
            .iter()
            .map(|record| SecretText::copy_of("a share", trim(record.as_ref())))
            .collect();
        for (index, text) in texts.iter().enumerate() {
            if let Some(problem) =
                joint_mark_limit_problem(place_of(places, index + 1), text.as_str())
            {
                return Err(JointError::MarkLimit(problem));
            }
        }
        Ok(Self {
            texts,
            places: places.map(<[usize]>::to_vec),
            spaces_of: Vec::new(),
            shares: Vec::new(),
            stage: Stage::Reading,
            steps: 0,
        })
    }

    /// The place of the share at `index`, from 1.
    fn place(&self, index: usize) -> usize {
        place_of(self.places.as_deref(), index)
    }

    /// Reads the next share; with the last one, what they are is told, and their solving begins.
    fn read_next(&mut self) -> Result<Stage, JointError> {
        let index = self.spaces_of.len();
        let text = self.texts[index].as_str();
        let readings = MarkedReading::of(text).map_err(|AmbiguousMarks| {
            JointError::Readings(after_place(
                "Share",
                self.place(index + 1),
                &AmbiguousMarks.to_string(),
                ": ",
            ))
        })?;
        self.spaces_of.push(spaces_from(readings));
        if self.spaces_of.len() < self.texts.len() {
            return Ok(Stage::Reading);
        }
        self.shares = self
            .spaces_of
            .iter()
            .zip(&self.texts)
            .map(|(spaces, text)| {
                let mut forms = Vec::new();
                for space in spaces {
                    if !forms.contains(&space.reading().format()) {
                        forms.push(space.reading().format());
                    }
                }
                ShareAssessment {
                    marks: mark_count(text.as_str()),
                    forms,
                    open_alone: spaces
                        .iter()
                        .map(|space| space.basis().len())
                        .min()
                        .unwrap_or(0),
                }
            })
            .collect();
        let shares = std::mem::take(&mut self.shares);
        if let Some(unfit) = self.spaces_of.iter().position(Vec::is_empty) {
            let message = unreadable_share_message(
                self.place(unfit + 1),
                shares[unfit].marks,
                self.texts[unfit].as_str(),
            );
            return Ok(Stage::Ended(refusal(
                shares,
                Verdict::NoFit(NoFitKind::ShareUnreadable),
                message,
                Some(unfit + 1),
            )));
        }
        if self.spaces_of.iter().any(|spaces| several_groups(spaces)) {
            return Ok(Stage::Ended(refusal(
                shares,
                Verdict::NoFit(NoFitKind::SeveralGroups),
                "These shares belong to a set of several groups; only sets of one group are repaired."
                    .to_owned(),
                None,
            )));
        }
        self.shares = shares;
        Ok(Stage::Solving(ReadingsWalk::new(
            self.spaces_of.clone(),
            None,
        )))
    }

    /// What every reading solved gives.
    fn after_solving(&mut self, solved: Solved) -> Stage {
        let shares = std::mem::take(&mut self.shares);
        if let Some(reason) = solved.refused {
            // The digits read of partly read codes may tell what the codes unknown as a whole
            // cannot.
            return match codes_to_try(&self.spaces_of, f64::INFINITY) {
                Some(chosen) => {
                    self.shares = shares;
                    Stage::Expanding {
                        chosen,
                        expanded: Vec::new(),
                        before: f64::INFINITY,
                        kept: Kept::Refused(reason),
                    }
                }
                None => Stage::Ended(refusal(shares, Verdict::TooUncertain, reason, None)),
            };
        }
        if !solved.same_length {
            return Stage::Ended(refusal(
                shares,
                Verdict::NoFit(NoFitKind::SharesDoNotFit),
                "These shares are of different lengths: not of one set.".to_owned(),
                None,
            ));
        }
        if solved.ways.branches.is_empty() {
            if !solved.ways.needs_more {
                return Stage::Ended(refusal(
                    shares,
                    Verdict::NoFit(NoFitKind::SharesDoNotFit),
                    "These shares do not fit together: check the marks, and that all belong to one set."
                        .to_owned(),
                    None,
                ));
            }
            let reason = if solved.ways.duplicates {
                "The same share is given more than once: the threshold of this set needs more shares."
            } else {
                "Too few shares: the threshold of this set needs more of them."
            };
            return Stage::Ended(refusal(shares, Verdict::NotEnough, reason.to_owned(), None));
        }
        let before = combinations_of(&solved.ways.branches);
        self.shares = shares;
        match codes_to_try(&self.spaces_of, before) {
            Some(chosen) => Stage::Expanding {
                chosen,
                expanded: Vec::new(),
                before,
                kept: Kept::Branches(solved.ways.branches),
            },
            None => helping(solved.ways.branches),
        }
    }

    /// Reads the next share word by word; with the last one, their solving begins.
    fn expand_next(
        &mut self,
        chosen: Vec<(usize, usize)>,
        mut expanded: Vec<Vec<Rc<ReadingSpace>>>,
        before: f64,
        kept: Kept,
    ) -> Stage {
        let share = expanded.len();
        expanded.push(expanded_share(&self.spaces_of[share], share, &chosen));
        if expanded.len() < self.spaces_of.len() {
            return Stage::Expanding {
                chosen,
                expanded,
                before,
                kept,
            };
        }
        if expanded.iter().any(Vec::is_empty) {
            return self.keeping(kept);
        }
        Stage::Refining {
            walk: Box::new(ReadingsWalk::new(
                expanded,
                Some(WorkBudget { left: TRIAL_WORK }),
            )),
            before,
            kept,
        }
    }

    /// What is `kept` where nothing better was found.
    fn keeping(&mut self, kept: Kept) -> Stage {
        match kept {
            Kept::Branches(branches) => helping(branches),
            Kept::Refused(reason) => Stage::Ended(refusal(
                std::mem::take(&mut self.shares),
                Verdict::TooUncertain,
                reason,
                None,
            )),
        }
    }

    /// What would help in one more share of `branches`; with the last one, the plan.
    fn help_next(
        &mut self,
        branches: Vec<Branch>,
        share: usize,
        mut helps: Vec<ElementHelp>,
    ) -> Stage {
        let shares = widest_branch(&branches).map_or(0, |widest| {
            if widest.open_bits() == 0 {
                return 0;
            }
            helps.extend(helpful_elements_of(widest, share));
            widest.spaces().len()
        });
        if share + 1 < shares {
            return Stage::Helping {
                branches,
                share: share + 1,
                helps,
            };
        }
        helps.sort_by_key(|help| help.open_bits);
        Stage::Ended(plan_of(std::mem::take(&mut self.shares), branches, helps))
    }

    /// What trying partly read codes word by word gives, better than what is `kept` or not.
    fn after_refining(&mut self, solved: Solved, before: f64, kept: Kept) -> Stage {
        let shorter = solved.refused.is_none()
            && !solved.ways.branches.is_empty()
            && combinations_of(&solved.ways.branches) < before;
        if shorter {
            helping(solved.ways.branches)
        } else {
            self.keeping(kept)
        }
    }

    /// Does the next piece of the assessment.
    fn advance(&mut self) -> Result<(), JointError> {
        let stage = std::mem::replace(&mut self.stage, Stage::Reading);
        self.stage = match stage {
            Stage::Reading => self.read_next()?,
            Stage::Solving(mut walk) => {
                if walk.step() {
                    Stage::Solving(walk)
                } else {
                    self.after_solving(walk.solved)
                }
            }
            Stage::Expanding {
                chosen,
                expanded,
                before,
                kept,
            } => self.expand_next(chosen, expanded, before, kept),
            Stage::Refining {
                mut walk,
                before,
                kept,
            } => {
                if walk.step() {
                    Stage::Refining { walk, before, kept }
                } else {
                    self.after_refining(walk.solved, before, kept)
                }
            }
            Stage::Helping {
                branches,
                share,
                helps,
            } => self.help_next(branches, share, helps),
            ended @ Stage::Ended(_) => ended,
        };
        Ok(())
    }

    /// The progress so far: the pieces done, of no known number.
    fn progress(&self) -> Progress {
        Progress {
            checked: self.steps,
            ..Progress::default()
        }
    }
}

impl Search for JointAssessor {
    type Outcome = JointPlan;
    type Error = JointError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: 0,
            pace_parts: 0,
        }
    }

    fn pace_sample(&self, _part: u8) -> Result<(), JointError> {
        Ok(())
    }

    fn step(&mut self, work: u32) -> Result<Step, JointError> {
        for _ in 0..work {
            if matches!(self.stage, Stage::Ended(_)) {
                break;
            }
            self.advance()?;
            self.steps += 1;
        }
        Ok(if matches!(self.stage, Stage::Ended(_)) {
            Step::Done(self.progress())
        } else {
            Step::Running(self.progress())
        })
    }

    fn finish(self) -> JointPlan {
        match self.stage {
            Stage::Ended(plan) => plan,
            _ => refusal(
                self.shares,
                Verdict::Stopped,
                STOPPED_REASON.to_owned(),
                None,
            ),
        }
    }
}

/// Assesses the shares as typed at once, and plans the search that finds every phrase they can
/// restore, where the assessment allows one; [`JointAssessor`] says what it refuses.
pub fn plan_joint_repair<S: AsRef<str>>(
    records: &[S],
    places: Option<&[usize]>,
) -> Result<JointPlan, JointError> {
    let mut assessor = JointAssessor::new(records, places)?;
    assessor.step(u32::MAX)?;
    Ok(assessor.finish())
}
