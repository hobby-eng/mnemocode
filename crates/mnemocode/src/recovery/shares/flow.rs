//! The restore of shares in one go that the host steps (MnemoCode TS 0.1.0's `ShareRestore.restore`
//! of `sskr/share-restore.ts`, CAP-SSKR-RESTORE-STEPS): complete shares checked as a set, marked ones
//! repaired together, then unmasked with the dates, searched where a date holds ?, and compared with
//! the wallet if one is given.

use std::rc::Rc;

use super::unmasking::{ShareUnmasking, UnmaskSearch, Unmasked, UnmaskedPhrase};
use super::{
    CompleteShares, MarkedShares, SearchLimits, ShareFlowError, SharesRead, assessed,
    complete_search_decision, marked_search_decision, read_shares, several_sets_note,
};
use crate::bip39::phrase::Phrase;
use crate::dates::answer::DatesAnswer;
use crate::modes::Mode;
use crate::recovery::date_search::{MatchLimits, wallet_reason};
use crate::recovery::wallet_check::WalletCheck;
use crate::search::{Progress, Search, SearchSize, Step};
use crate::sskr::joint::{JointAssessor, JointSearch};
use crate::sskr::repair::report::{
    DateWork, NO_PHRASE_FITS, RepairReport, ReportLine, ShareRepairs,
};
use crate::sskr::restore::{SetBackup, ShareSet};
use crate::sskr::typed::{ShareInput, TroubleKind};

/// What a restore asks of a [`RestoreFlow`].
#[derive(Debug)]
pub struct ShareRestoreRequest {
    /// The shares as typed.
    pub input: ShareInput,
    /// The mode that the phrase was split in.
    pub mode: Mode,
    /// The dates of a Seedshift phrase, which may hold ?; none without Seedshift.
    pub dates: Option<Rc<DatesAnswer>>,
    /// Compares each phrase with the wallet; without it every phrase is kept.
    pub wallet: Option<Rc<WalletCheck>>,
    /// Matches of each date search kept for a candidate list; none by default.
    pub keep: Option<u64>,
    /// How far a search goes without the person's yes.
    pub limits: SearchLimits,
    /// Whether the person said yes to the long search that a question announced.
    pub confirmed: bool,
}

/// A phrase that shares restored, the phrase they hold, and what a repair filled in.
#[derive(Debug)]
pub struct RestoredPhrase {
    /// The seed phrase and how it was unmasked.
    pub unmasked: UnmaskedPhrase,
    /// What a repair filled in where ? marked an element, share by share.
    pub repairs: Vec<ShareRepairs>,
    /// The masked backup in its shares' form; none when the shares hold the original itself.
    pub backup: Option<SetBackup>,
}

/// The seed phrases that the sets of a restore give, with their sets.
#[derive(Debug)]
pub struct PhrasesFound {
    /// The phrases kept: all of them, or the wallet's.
    pub phrases: Vec<RestoredPhrase>,
    /// The sets of the phrases, each once, in their order.
    pub sets: Vec<Rc<ShareSet>>,
    /// The phrases that the sets give in all, beyond those listed.
    pub matches: u64,
    /// Every phrase for a candidate list, in its order, also the date matches beyond those shown.
    pub listed: Vec<Phrase>,
}

/// What the sets of a restore give as seed phrases.
#[derive(Debug)]
pub enum RestoredPhrases {
    /// The phrases found.
    Phrases(PhrasesFound),
    /// The dates are more than a set's phrase takes: why, for the person.
    Dates(String),
    /// No phrase is the wallet's: why, for the person.
    Mismatch(String),
    /// The host stopped the date search: no phrase is told.
    Stopped,
}

/// What a restore of shares ends with.
#[derive(Debug)]
pub enum ShareRestoreOutcome {
    /// A trouble to say, which names any share by its place, after the lines of the report.
    Trouble {
        /// The trouble.
        message: String,
        /// The lines of the report.
        lines: Vec<ReportLine>,
    },
    /// A search that waits for the person's yes: the host asks, and on a yes runs the flow again.
    Question {
        /// What to ask.
        question: String,
        /// The lines of the report.
        lines: Vec<ReportLine>,
    },
    /// The host stopped the search: nothing is told.
    Stopped {
        /// The lines of the report said before the stop.
        lines: Vec<ReportLine>,
    },
    /// Too few shares to restore a phrase.
    Few {
        /// Why, such as how many the set needs.
        message: String,
        /// The lines of the report.
        lines: Vec<ReportLine>,
    },
    /// The phrases found, each with its notes.
    Phrases {
        /// The phrases.
        found: PhrasesFound,
        /// The place of each share among those typed, from 1, by its index in a set.
        places: Vec<usize>,
        /// The lines of the report, said before the phrases.
        lines: Vec<ReportLine>,
        /// The notes said with the phrases.
        notes: Vec<String>,
    },
}

/// What the wallet check said of the matches of `phrases`: each warning once, however many phrases
/// it matched, in their order.
pub fn match_warnings(phrases: &[RestoredPhrase]) -> Vec<&'static str> {
    let mut warnings = Vec::new();
    for warning in phrases.iter().filter_map(|phrase| phrase.unmasked.warning) {
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }
    warnings
}

/// The sets of `phrases`, each once, in their order.
fn sets_of(phrases: &[UnmaskedPhrase]) -> Vec<Rc<ShareSet>> {
    let mut sets: Vec<Rc<ShareSet>> = Vec::new();
    for phrase in phrases {
        if !sets.iter().any(|set| Rc::ptr_eq(set, &phrase.set)) {
            sets.push(Rc::clone(&phrase.set));
        }
    }
    sets
}

/// The seed phrases of what `unmasked` gave of `sets`, each with the phrase its shares hold, what a
/// repair filled in, its shares named by `places`, and the backup in the form of its shares; or why
/// the dates do not fit, or why none is the wallet's.
pub fn phrases_of(
    unmasked: Unmasked,
    sets: usize,
    searched_combinations: Option<u64>,
    places: &[usize],
) -> RestoredPhrases {
    let (phrases, listed, matches) = match unmasked {
        Unmasked::Dates(message) => return RestoredPhrases::Dates(message),
        Unmasked::Stopped => return RestoredPhrases::Stopped,
        Unmasked::Phrases {
            phrases,
            listed,
            matches,
        } => (phrases, listed, matches),
    };
    if phrases.is_empty() {
        return RestoredPhrases::Mismatch(ShareSet::wallet_mismatch(
            sets as u64,
            searched_combinations,
        ));
    }
    let found_sets = sets_of(&phrases);
    let phrases = phrases
        .into_iter()
        .map(|unmasked| RestoredPhrase {
            backup: unmasked.set.backup(&unmasked.phrase),
            repairs: RepairReport::repairs(&unmasked.set, Some(places)),
            unmasked,
        })
        .collect();
    RestoredPhrases::Phrases(PhrasesFound {
        phrases,
        sets: found_sets,
        matches,
        listed,
    })
}

/// Where a flow stands.
#[derive(Debug)]
enum Phase {
    /// The request, read by [`RestoreFlow::begin`].
    Waiting(Box<ShareInput>),
    /// The assessment of marked shares.
    Assessing {
        assessor: Box<JointAssessor>,
        places: Vec<usize>,
        tries_per_second: f64,
        work: Option<DateWork>,
    },
    /// The search of marked shares.
    Shares {
        search: Box<JointSearch>,
        places: Vec<usize>,
        lines: Vec<ReportLine>,
        notice: Vec<String>,
    },
    /// The unmasking of the sets found.
    Unmasking {
        search: Box<UnmaskSearch>,
        sets: usize,
        places: Vec<usize>,
        lines: Vec<ReportLine>,
        notes: Vec<String>,
    },
    /// The end, with what it gives.
    Ended(Box<ShareRestoreOutcome>),
}

/// The phrases that shares restore, as sskr-combine restores them. A long search waits for the
/// person's yes; several sets that fit are all given, with a note that the wallet tells them apart.
#[derive(Debug)]
pub struct RestoreFlow {
    phase: Phase,
    unmasking: ShareUnmasking,
    wallet_given: bool,
    needs_wallet: bool,
    mode: Mode,
    limits: SearchLimits,
    confirmed: bool,
    dates: Option<Rc<DatesAnswer>>,
}

impl RestoreFlow {
    /// The flow of `request`; refuses the mode, the dates and `keep` first.
    pub fn new(request: ShareRestoreRequest) -> Result<Self, ShareFlowError> {
        let limits = MatchLimits {
            max_shown: None,
            keep: request.keep,
        };
        let unmasking = ShareUnmasking::new(
            request.mode,
            request.dates.clone(),
            request.wallet.clone(),
            limits,
        )?;
        Ok(Self {
            needs_wallet: unmasking.needs_wallet(),
            phase: Phase::Waiting(Box::new(request.input)),
            unmasking,
            wallet_given: request.wallet.is_some(),
            mode: request.mode,
            limits: request.limits,
            confirmed: request.confirmed,
            dates: request.dates,
        })
    }

    /// The phase, taken out to go on with what it holds.
    fn taken(&mut self) -> Phase {
        let idle = Phase::Ended(Box::new(ShareRestoreOutcome::Stopped { lines: Vec::new() }));
        std::mem::replace(&mut self.phase, idle)
    }

    /// The trouble of a read, or the question of a long search, that ends the flow.
    fn ended(&mut self, outcome: ShareRestoreOutcome) {
        self.phase = Phase::Ended(Box::new(outcome));
    }

    /// Reads the shares and settles the search: the outcome ends here where they are too few or a
    /// long search waits for the person's yes. `tries_per_second` is the pace of a joint search,
    /// and `date_seconds` what the host timed of the date search's sample, none without one.
    pub fn begin(
        &mut self,
        tries_per_second: f64,
        date_seconds: &[f64],
    ) -> Result<(), ShareFlowError> {
        if self.needs_wallet && !self.wallet_given {
            self.ended(ShareRestoreOutcome::Trouble {
                message: wallet_reason(Some(self.mode)).to_owned(),
                lines: Vec::new(),
            });
            return Ok(());
        }
        let work = self.unmasking.date_work(date_seconds)?;
        let Phase::Waiting(input) = &mut self.phase else {
            return Ok(());
        };
        if input.marked() && input.first_unreadable().is_none() {
            let places = input.places();
            let assessor = JointAssessor::new(&input.texts(), Some(&places))?;
            self.phase = Phase::Assessing {
                assessor: Box::new(assessor),
                places,
                tries_per_second,
                work,
            };
            return Ok(());
        }
        let read = read_shares(input)?;
        self.go_on(read, work)
    }

    /// Goes on with what the shares gave.
    fn go_on(&mut self, read: SharesRead, work: Option<DateWork>) -> Result<(), ShareFlowError> {
        match read {
            SharesRead::Trouble { trouble, lines } => {
                let few = trouble.kind == TroubleKind::Few;
                self.ended(if few {
                    ShareRestoreOutcome::Few {
                        message: trouble.message,
                        lines,
                    }
                } else {
                    ShareRestoreOutcome::Trouble {
                        message: trouble.message,
                        lines,
                    }
                });
            }
            SharesRead::Complete(complete) => self.begin_complete(complete, work),
            SharesRead::Marked(marked) => return self.begin_marked(marked, work),
        }
        Ok(())
    }

    /// The word count's refusal of the dates, for a phrase of `word_count` words.
    fn too_many_dates(&self, word_count: Option<usize>) -> Option<String> {
        self.dates.as_ref()?.too_many_for(word_count)
    }

    /// Goes on with complete shares.
    fn begin_complete(&mut self, complete: CompleteShares, work: Option<DateWork>) {
        let CompleteShares {
            set,
            places,
            lines,
            unchecked,
            ..
        } = complete;
        if let Some(message) = self.too_many_dates(Some(set.word_count())) {
            return self.ended(ShareRestoreOutcome::Trouble { message, lines });
        }
        let decision = complete_search_decision(work, self.limits);
        if let Some(question) = decision.question.filter(|_| !self.confirmed) {
            return self.ended(ShareRestoreOutcome::Question { question, lines });
        }
        let mut notes: Vec<String> = unchecked.into_iter().collect();
        notes.extend(decision.notice);
        self.phase = Phase::Unmasking {
            search: Box::new(self.unmasking.unmask(vec![Rc::new(set)])),
            sets: 1,
            places,
            lines,
            notes,
        };
    }

    /// Goes on with marked shares.
    fn begin_marked(
        &mut self,
        marked: MarkedShares,
        work: Option<DateWork>,
    ) -> Result<(), ShareFlowError> {
        let word_count = marked.word_count()?;
        if let Some(message) = self.too_many_dates(word_count) {
            let lines = marked.lines;
            self.ended(ShareRestoreOutcome::Trouble { message, lines });
            return Ok(());
        }
        let decision = marked_search_decision(&marked, work, self.limits);
        if let Some(question) = decision.question.filter(|_| !self.confirmed) {
            let lines = marked.lines;
            self.ended(ShareRestoreOutcome::Question { question, lines });
            return Ok(());
        }
        let MarkedShares {
            plan,
            places,
            lines,
            ..
        } = marked;
        match plan.search() {
            Some(search) => {
                self.phase = Phase::Shares {
                    search: Box::new(search),
                    places,
                    lines,
                    notice: decision.notice.into_iter().collect(),
                };
            }
            None => self.ended(ShareRestoreOutcome::Trouble {
                message: NO_PHRASE_FITS.to_owned(),
                lines,
            }),
        }
        Ok(())
    }

    /// What the assessment planned: on to the search.
    fn take_assessment(&mut self, phase: Phase) -> Result<(), ShareFlowError> {
        let Phase::Assessing {
            assessor,
            places,
            tries_per_second,
            work,
        } = phase
        else {
            return Ok(());
        };
        let read = assessed((*assessor).finish(), places, tries_per_second)?;
        self.go_on(read, work)
    }

    /// The sets a search of marked shares found: on to their unmasking.
    fn take_sets(&mut self, phase: Phase) {
        let Phase::Shares {
            search,
            places,
            lines,
            notice,
        } = phase
        else {
            return;
        };
        let found = (*search).finish();
        if found.sets.is_empty() {
            return self.ended(ShareRestoreOutcome::Trouble {
                message: NO_PHRASE_FITS.to_owned(),
                lines,
            });
        }
        let mut notes: Vec<String> = found
            .sets
            .iter()
            .filter_map(|set| set.unchecked_note(Some(&places)))
            .collect();
        notes.extend(notice);
        let sets: Vec<Rc<ShareSet>> = found.sets.into_iter().map(Rc::new).collect();
        self.phase = Phase::Unmasking {
            sets: sets.len(),
            search: Box::new(self.unmasking.unmask(sets)),
            places,
            lines,
            notes,
        };
    }

    /// The phrases that the unmasking gave: the end.
    fn take_phrases(&mut self, phase: Phase) {
        let Phase::Unmasking {
            search,
            sets,
            places,
            lines,
            mut notes,
        } = phase
        else {
            return;
        };
        let searched = self.unmasking.searched_combinations();
        let restored = phrases_of((*search).finish(), sets, searched, &places);
        self.ended(match restored {
            RestoredPhrases::Stopped => ShareRestoreOutcome::Stopped { lines },
            RestoredPhrases::Dates(message) | RestoredPhrases::Mismatch(message) => {
                ShareRestoreOutcome::Trouble { message, lines }
            }
            RestoredPhrases::Phrases(found) => {
                if found.sets.len() > 1 && !self.wallet_given {
                    notes.push(several_sets_note(found.sets.len()));
                }
                ShareRestoreOutcome::Phrases {
                    found,
                    places,
                    lines,
                    notes,
                }
            }
        });
    }
}

impl Search for RestoreFlow {
    type Outcome = ShareRestoreOutcome;
    type Error = ShareFlowError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: match &self.phase {
                Phase::Shares { search, .. } => search.size().candidates,
                Phase::Unmasking { search, .. } => search.size().candidates,
                Phase::Waiting(_) | Phase::Assessing { .. } | Phase::Ended(_) => 0,
            },
            pace_parts: self.unmasking.pace_parts() + 1,
        }
    }

    /// Part 0 is the joint search's digest checks; the others are the date search's.
    fn pace_sample(&self, part: u8) -> Result<(), ShareFlowError> {
        if part == 0 {
            crate::sskr::joint::pace_sample();
            return Ok(());
        }
        self.unmasking.pace_sample(part - 1)
    }

    fn step(&mut self, work: u32) -> Result<Step, ShareFlowError> {
        match &mut self.phase {
            Phase::Waiting(_) | Phase::Ended(_) => Ok(Step::Done(Progress::default())),
            Phase::Assessing { assessor, .. } => {
                let step = assessor.step(work)?;
                if matches!(step, Step::Done(_)) {
                    let phase = self.taken();
                    self.take_assessment(phase)?;
                    return Ok(Step::Running(step.progress()));
                }
                Ok(step)
            }
            Phase::Shares { search, .. } => {
                let step = search.step(work)?;
                if matches!(step, Step::Done(_)) {
                    let phase = self.taken();
                    self.take_sets(phase);
                    return Ok(Step::Running(step.progress()));
                }
                Ok(step)
            }
            Phase::Unmasking { search, .. } => {
                let step = search.step(work)?;
                if matches!(step, Step::Done(_)) {
                    let phase = self.taken();
                    self.take_phrases(phase);
                }
                Ok(step)
            }
        }
    }

    fn finish(self) -> ShareRestoreOutcome {
        match self.phase {
            Phase::Ended(outcome) => *outcome,
            Phase::Waiting(_) | Phase::Assessing { .. } => {
                ShareRestoreOutcome::Stopped { lines: Vec::new() }
            }
            Phase::Shares { lines, .. } | Phase::Unmasking { lines, .. } => {
                ShareRestoreOutcome::Stopped { lines }
            }
        }
    }
}
