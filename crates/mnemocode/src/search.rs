//! Searches that the host steps (ADR 0005, CAP-RECOVERY-SEARCH-TURNS): the date, word and
//! marked-code searches, the joint share search and share unmasking keep their place as state and
//! check at most the work the host gives each step, so that the command line can stop one on
//! Ctrl+C and a page can run one from its own turns or a worker. A stop is no failure (CORE-22): the
//! outcome says it is partial. The library reads no clock: the host times each part of a search's
//! public pace sample before the person consents, and [`plan`] turns those times into the question.

pub mod plan;

use std::fmt;

use crate::refusal::{Refusal, RefusalKind};
use crate::text::numbers::WholeRange;

/// How far a search has come, as every search tells it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Progress {
    /// Tries made so far: date combinations, candidates, or digest checks of shares.
    pub checked: u64,
    /// Tries in all, where the search knows them.
    pub total: Option<u64>,
    /// What passed the search's own check so far: a BIP39 checksum, a digest or the wallet check.
    pub found: u64,
}

/// What one step left: the search goes on, or it has tried everything.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// There is more to try; the progress so far.
    Running(Progress),
    /// Every candidate was tried; the final progress.
    Done(Progress),
}

impl Step {
    /// The progress the step reports.
    pub fn progress(self) -> Progress {
        match self {
            Self::Running(progress) | Self::Done(progress) => progress,
        }
    }
}

/// The size of a search before it starts: what it tries and how many parts its pace sample has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchSize {
    /// The combinations it tries, counted against the person's limit.
    pub candidates: u64,
    /// How many parts of public work the host times before the person consents.
    pub pace_parts: u8,
}

/// A search that the host steps.
pub trait Search {
    /// What the search gives at the end; partial unless its last step was [`Step::Done`].
    type Outcome;
    /// The search's refusals.
    type Error: Refusal;

    /// What the search tries, known before it starts.
    fn size(&self) -> SearchSize;

    /// Runs part `part` of the TS pace sample, on public data only, for the host to time before
    /// the person consents; no secret candidate is checked here.
    fn pace_sample(&self, part: u8) -> Result<(), Self::Error>;

    /// Checks at most `work` candidates, then returns.
    fn step(&mut self, work: u32) -> Result<Step, Self::Error>;

    /// The outcome so far.
    fn finish(self) -> Self::Outcome;
}

/// A count that a host passes to a search that is not a whole number of its least value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CountRefused {
    name: &'static str,
    minimum: u64,
}

impl fmt::Display for CountRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} must be a whole number of {} or more.",
            self.name, self.minimum
        )
    }
}

impl std::error::Error for CountRefused {}

impl Refusal for CountRefused {
    fn code(&self) -> &'static str {
        "core.search-turns.whole-number-more"
    }

    fn kind(&self) -> RefusalKind {
        RefusalKind::Range
    }
}

/// A count that a run keeps, such as the matches it shows: `fallback` without one; refused, naming
/// `name`, unless it is a whole number of `minimum` or more, as far as TS counts exactly.
pub fn kept_count(
    count: Option<u64>,
    fallback: u64,
    name: &'static str,
    minimum: u64,
) -> Result<u64, CountRefused> {
    match count {
        None => Ok(fallback),
        Some(count) if WholeRange::from(minimum).contains(count) => Ok(count),
        Some(_) => Err(CountRefused { name, minimum }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_count_is_kept_from_its_least_value() {
        assert_eq!(kept_count(None, 20, "maxShown", 1), Ok(20));
        assert_eq!(kept_count(Some(1), 20, "maxShown", 1), Ok(1));
        let refused = kept_count(Some(0), 20, "maxShown", 1).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "maxShown must be a whole number of 1 or more."
        );
        assert_eq!(refused.code(), "core.search-turns.whole-number-more");
        assert!(kept_count(Some(1 << 53), 0, "keep", 0).is_err());
    }

    #[test]
    fn a_step_reports_its_progress() {
        let progress = Progress {
            checked: 3,
            total: Some(10),
            found: 1,
        };
        assert_eq!(Step::Running(progress).progress(), progress);
        assert_eq!(Step::Done(progress).progress().checked, 3);
    }
}
