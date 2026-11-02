//! The driver of every long search (CAP-CLI-LONG-SEARCH-CONTROL, ADR 0005): the host times a
//! search's public pace sample, steps it, and reads Ctrl+C as a key between the steps, so that a
//! person stops it at once and whatever they type meanwhile is dropped and wiped.

use std::fmt;

use mnemocode::search::{Progress, Search, Step};

use crate::gate::Stop;
use crate::os;
use crate::terminal::{Choice, Chosen, Keys, ListQuestion, choose, key, seconds_of};

/// How long a step takes before the keys and the signals are looked at, so that a person stops a
/// search at once, whatever one candidate costs; the work of a step follows it.
const STEP_SECONDS: f64 = 0.02;
/// The most candidates of a step.
const MOST_STEP_WORK: u32 = 1 << 16;

/// A search longer than allowed, which nothing can ask about.
#[derive(Debug)]
pub(crate) struct SearchNotAllowed {
    /// What it takes.
    pub(crate) extent: String,
    /// The options that allow it, each with the count it needs.
    pub(crate) allowances: Vec<(&'static str, u64)>,
    pub(crate) code: &'static str,
}

impl fmt::Display for SearchNotAllowed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let options: Vec<String> = self
            .allowances
            .iter()
            .map(|(option, count)| format!("--{option} {count}"))
            .collect();
        write!(
            f,
            "{} Allow it with {}.",
            self.extent,
            options.join(" and ")
        )
    }
}

impl std::error::Error for SearchNotAllowed {}

impl mnemocode::refusal::Refusal for SearchNotAllowed {
    fn code(&self) -> &'static str {
        self.code
    }
}

/// What the answer No to a long search does: its note, and what Escape does, said in the hint.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Refusal<'a> {
    pub(crate) note: &'a str,
    pub(crate) quit: &'a str,
}

/// Asks whether a search longer than its limit starts; keys typed before never answer it.
pub(crate) fn ask_to_search(question: &str, no: Refusal<'_>) -> Result<bool, Stop> {
    let asked = ListQuestion {
        question,
        label: "Search",
        quit: no.quit,
        explanation: None,
    };
    let choices = [
        Choice::noted("Yes", "Ctrl+C stops it", true),
        Choice::noted("No", no.note, false),
    ];
    match choose(&asked, None, &choices)? {
        Chosen::One(start) => Ok(start),
        Chosen::Back => Ok(false),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// The seconds each part of the pace sample of `search` takes here.
pub(crate) fn timed_parts<S: Search>(search: &S) -> Result<Vec<f64>, S::Error> {
    (0..search.size().pace_parts)
        .map(|part| seconds_of(|| search.pace_sample(part)))
        .collect()
}

/// Steps `search` to its end, `told` after every `every` candidates and at the end; Ctrl+C or a
/// signal stops it.
pub(crate) fn run_search<S>(
    search: &mut S,
    every: u32,
    mut told: impl FnMut(Progress),
) -> Result<(), Stop>
where
    S: Search,
    S::Error: 'static,
{
    let mut keys = Keys::open();
    let mut left = every;
    let mut size = 1;
    loop {
        let work = left.min(size);
        let mut stepped = None;
        let seconds = seconds_of(|| {
            stepped = Some(search.step(work)?);
            Ok::<_, S::Error>(())
        })?;
        let Some(step) = stepped else {
            return Ok(());
        };
        if seconds < STEP_SECONDS {
            size = size.saturating_mul(2).min(MOST_STEP_WORK);
        } else {
            size = (size / 2).max(1);
        }
        left -= work;
        if left == 0 || matches!(step, Step::Done(_)) {
            told(step.progress());
            left = every;
        }
        if matches!(step, Step::Done(_)) {
            return Ok(());
        }
        if let Some(signal) = os::pending_signal() {
            return Err(Stop::Signal(signal));
        }
        keys.suspend_if_asked();
        while keys.is_raw() && keys.more_within(0) {
            match keys.next()? {
                Some(key::CTRL_C | key::CTRL_BACKSLASH) => return Err(Stop::Cancelled),
                Some(key::CTRL_Z) => keys.suspend(),
                _ => {}
            }
        }
    }
}
