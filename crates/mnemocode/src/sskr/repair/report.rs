//! What a repair of shares with unreadable elements tells the person (MnemoCode TS 0.1.0's
//! `src/sskr/repair-report.ts`, CAP-SSKR-REPAIR-REPORT), as lines of data with their texts: before
//! the search, what the shares settle together, what is open and how long it takes here, what
//! would help, and the question or notice for the search, with the date search that follows for a
//! Seedshift phrase; after it, what the repair filled in, share by share. Its lines hold what a
//! repair filled in, so that they are redacted from `Debug`. The host measures the
//! pace of its digest checks from the joint search's public pace sample and maps each kind of line
//! to its own style.

use std::fmt;

use super::super::joint::{JointAssessment, Verdict};
use super::super::restore::{MarkedElement, SetShare, ShareSet};
use crate::refusal::Refusal;
use crate::search::plan::{CORRECT_WRITTEN_COPY, asks_first, counted, duration, grouped_digits};
use crate::text::words::place_of;

/// The refusal when the search of marked shares found no phrase.
pub const NO_PHRASE_FITS: &str = "No phrase fits these shares: a ? may stand at a wrong place, or an element without ? be misread.";
/// Elements named as help after the assessment.
const NAMED_HELPS: usize = 3;
/// Wrong phrases expected by chance from which the assessment mentions them.
const NOTABLE_FALSE: f64 = 0.01;
/// More places than any double has after its point.
const EVERY_FRACTION_DIGIT: usize = 1100;
/// The README section on damaged shares.
pub const REPAIR_ANCHOR: &str = "damaged-shares";
/// The heading before what a repair filled in.
pub const FILLED_HEADING: &str = "Filled in where ? stood:";
/// The note on guesses.
pub const GUESSES_NOTE: &str =
    "The phrase does not depend on the guesses, and nothing settles them: do not copy them.";

/// One line of a report.
#[derive(Clone, PartialEq, Eq)]
pub enum ReportLine {
    /// A status: what it is of, ending in a colon; the status; whether it is good news.
    Status {
        /// What the status is of.
        label: &'static str,
        /// The status itself.
        value: String,
        /// Whether it is good news.
        good: bool,
    },
    /// A hint that can be passed over.
    Hint(String),
    /// A notice.
    Notice(String),
    /// A warning.
    Warning(String),
    /// A pointer to the README section with this anchor.
    More(&'static str),
}

/// Redacted: a line may name what a repair filled in.
impl fmt::Debug for ReportLine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a report line")
    }
}

/// What a repair filled in at one marked element.
#[derive(Clone, PartialEq, Eq)]
pub struct RepairedElement {
    /// Its position in its share, from 1.
    pub position: usize,
    /// What the repair put there, in the share's form.
    pub value: String,
    /// Nothing settles it: the phrase does not depend on it.
    pub guess: bool,
}

/// Redacted: it holds an element of a share.
impl fmt::Debug for RepairedElement {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a repaired element")
    }
}

/// What a repair filled in in one share, named by its place among those typed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareRepairs {
    /// The share's place, from 1.
    pub share: usize,
    /// Each element filled in, in order.
    pub elements: Vec<RepairedElement>,
}

impl ShareRepairs {
    /// What was filled in of the share, as one line, each guess marked.
    pub fn line(&self) -> String {
        let elements: Vec<String> = self
            .elements
            .iter()
            .map(|element| {
                format!(
                    "element {} is {}{}",
                    element.position,
                    element.value,
                    if element.guess { " (a guess)" } else { "" }
                )
            })
            .collect();
        format!("Share {}: {}.", self.share, elements.join(", "))
    }
}

/// A date search after the share search, for each phrase it finds: its size and pace.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DateWork {
    /// The date combinations the search of one phrase tries.
    pub combinations: u64,
    /// Seconds one combination takes here.
    pub seconds_each: f64,
}

/// Seconds the date search of `phrases` phrases takes.
fn date_seconds(work: DateWork, phrases: f64) -> f64 {
    work.combinations as f64 * work.seconds_each * phrases
}

/// " for each of the 3 phrases" where there are several.
fn for_each_phrase(phrases: u64) -> String {
    if phrases > 1 {
        format!(" for each of the {phrases} phrases")
    } else {
        String::new()
    }
}

/// A count as the messages write it: in JavaScript's digits, the shortest that give the number
/// back, which past 2^53 end in zeros, as they do in Rust's.
fn count(value: f64) -> String {
    grouped_digits(&value.to_string())
}

/// `value`, above 0, with two significant digits, as JavaScript's toPrecision(2) writes it: its
/// exact digits rounded, a tie up.
fn two_digits(value: f64) -> String {
    if value <= 0.0 {
        return "0.0".to_owned();
    }
    let exact = format!("{value:.EVERY_FRACTION_DIGIT$}");
    let (whole, fraction) = exact.split_once('.').unwrap_or((&exact, ""));
    let digits: Vec<u32> = whole
        .chars()
        .chain(fraction.chars())
        .filter_map(|digit| digit.to_digit(10))
        .collect();
    let first = digits.iter().position(|&digit| digit != 0).unwrap_or(0);
    let mut exponent = whole.len() as i32 - 1 - first as i32;
    let at = |place: usize| digits.get(place).copied().unwrap_or(0);
    let mut kept = at(first) * 10 + at(first + 1) + u32::from(at(first + 2) >= 5);
    if kept == 100 {
        kept = 10;
        exponent += 1;
    }
    let (tens, ones) = (kept / 10, kept % 10);
    match exponent {
        1 => kept.to_string(),
        0 => format!("{tens}.{ones}"),
        -6..0 => format!("0.{}{kept}", "0".repeat((-exponent - 1) as usize)),
        _ => {
            let sign = if exponent < 0 { '-' } else { '+' };
            format!("{tens}.{ones}e{sign}{}", exponent.abs())
        }
    }
}

/// A pace that a report cannot tell a time with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PaceRefused;

impl fmt::Display for PaceRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("A repair report needs a positive pace.")
    }
}

impl std::error::Error for PaceRefused {}

impl Refusal for PaceRefused {
    fn code(&self) -> &'static str {
        "sskr.repair-report.repair-report-positive-pace"
    }
}

/// The report of a repair: the assessment, the pace of this machine and the place of each share.
#[derive(Clone, Debug)]
pub struct RepairReport {
    assessment: JointAssessment,
    tries_per_second: f64,
    places: Option<Vec<usize>>,
}

impl RepairReport {
    /// The report of `assessment` at `tries_per_second` digest checks a second here, measured by
    /// the host from the search's pace sample, each share named by its place in `places`; refused
    /// for a pace that is not more than 0.
    pub fn new(
        assessment: JointAssessment,
        tries_per_second: f64,
        places: Option<&[usize]>,
    ) -> Result<Self, PaceRefused> {
        if tries_per_second.is_nan() || tries_per_second <= 0.0 {
            return Err(PaceRefused);
        }
        Ok(Self {
            assessment,
            tries_per_second,
            places: places.map(<[usize]>::to_vec),
        })
    }

    /// The assessment.
    pub const fn assessment(&self) -> &JointAssessment {
        &self.assessment
    }

    /// The notice before the date search of `phrases` phrases restored from complete shares.
    pub fn date_search_notice(work: DateWork, phrases: u64) -> String {
        format!(
            "The search tries {}{}: {}.",
            counted(work.combinations, "date combination"),
            for_each_phrase(phrases),
            duration(date_seconds(work, phrases as f64))
        )
    }

    /// Whether such a date search is asked for first.
    pub fn date_search_needs_question(work: DateWork, phrases: u64, limit: Option<u64>) -> bool {
        asks_first(
            work.combinations.saturating_mul(phrases),
            date_seconds(work, phrases as f64),
            limit,
        )
    }

    /// The question before such a date search.
    pub fn date_search_question(work: DateWork, phrases: u64) -> String {
        format!(
            "Search {}{}, {}?",
            counted(work.combinations, "date combination"),
            for_each_phrase(phrases),
            duration(date_seconds(work, phrases as f64))
        )
    }

    /// What a repair filled in where ? marked an element, share by share; an element nothing
    /// settles is a guess. Each share is named by its place in `places`.
    pub fn repairs(set: &ShareSet, places: Option<&[usize]>) -> Vec<ShareRepairs> {
        Self::repairs_of(set.shares(), set.unsettled(), places)
    }

    /// The repairs of `shares`, of which `unsettled` are guesses, as [`RepairReport::repairs`]
    /// tells those of a set.
    pub fn repairs_of(
        shares: &[SetShare],
        unsettled: &[MarkedElement],
        places: Option<&[usize]>,
    ) -> Vec<ShareRepairs> {
        shares
            .iter()
            .enumerate()
            .filter(|(_, share)| share.repaired())
            .map(|(index, share)| ShareRepairs {
                share: place_of(places, index + 1),
                elements: share
                    .filled
                    .iter()
                    .map(|element| RepairedElement {
                        position: element.position,
                        value: element.value.as_str().to_owned(),
                        guess: unsettled.iter().any(|unsettled| {
                            unsettled.share == index + 1 && unsettled.position == element.position
                        }),
                    })
                    .collect(),
            })
            .collect()
    }

    /// The repairs as lines, one warning for each share, then the notes.
    pub fn repair_lines(set: &ShareSet, places: Option<&[usize]>) -> Vec<ReportLine> {
        Self::repair_lines_of(set.shares(), set.unsettled(), places)
    }

    /// The repairs of `shares` as lines, as [`RepairReport::repair_lines`] tells those of a set.
    pub fn repair_lines_of(
        shares: &[SetShare],
        unsettled: &[MarkedElement],
        places: Option<&[usize]>,
    ) -> Vec<ReportLine> {
        let mut lines: Vec<ReportLine> = Self::repairs_of(shares, unsettled, places)
            .into_iter()
            .map(|repairs| ReportLine::Warning(repairs.line()))
            .collect();
        lines.extend(Self::notes_of(shares, unsettled));
        lines
    }

    /// The notes after what a repair filled in: guesses, and correcting the written copy.
    pub fn notes_of(shares: &[SetShare], unsettled: &[MarkedElement]) -> Vec<ReportLine> {
        let mut lines = Vec::new();
        if !unsettled.is_empty() {
            lines.push(ReportLine::Warning(GUESSES_NOTE.to_owned()));
        }
        if shares.iter().any(SetShare::repaired) {
            lines.push(ReportLine::Notice(CORRECT_WRITTEN_COPY.to_owned()));
        }
        lines
    }

    /// Digest checks of the search.
    pub const fn combinations(&self) -> f64 {
        self.assessment.combinations
    }

    /// Seconds the search takes here, with `dates` searched for each phrase it finds.
    pub fn seconds(&self, dates: Option<DateWork>) -> f64 {
        let phrases = 1.0 + self.assessment.expected_false;
        self.combinations() / self.tries_per_second
            + dates.map_or(0.0, |work| date_seconds(work, phrases))
    }

    /// Whether the search is asked for first: more checks than `limit`, or more date combinations
    /// than `date_limit`; without either, longer than the question's hours here.
    pub fn needs_question(
        &self,
        limit: Option<u64>,
        dates: Option<DateWork>,
        date_limit: Option<u64>,
    ) -> bool {
        if limit.is_none() && date_limit.is_none() {
            return asks_first(0, self.seconds(dates), None);
        }
        let shares = limit.is_some_and(|limit| self.combinations() > limit as f64);
        let dated =
            matches!((date_limit, dates), (Some(limit), Some(work)) if work.combinations > limit);
        shares || dated
    }

    /// What the search tries, as its question and notice name it.
    fn search_size(&self, dates: Option<DateWork>) -> String {
        match dates {
            None => format!("{} combinations", count(self.combinations())),
            Some(work) => format!(
                "{} share combination{}, then {} for each phrase found",
                count(self.combinations()),
                if self.combinations() == 1.0 { "" } else { "s" },
                counted(work.combinations, "date combination")
            ),
        }
    }

    /// The question before a search that needs one.
    pub fn search_question(&self, dates: Option<DateWork>) -> String {
        format!(
            "Search {}, {}?",
            self.search_size(dates),
            duration(self.seconds(dates))
        )
    }

    /// What the search takes, for a host that names the limit allowing it instead of asking.
    pub fn search_extent(&self, dates: Option<DateWork>) -> String {
        format!(
            "The search takes {} checks, {}.",
            count(self.combinations()),
            duration(self.seconds(dates))
        )
    }

    /// The notice before a search that goes ahead without a question.
    pub fn search_notice(&self, dates: Option<DateWork>) -> String {
        format!(
            "The search tries {}: {}.",
            self.search_size(dates),
            duration(self.seconds(dates))
        )
    }

    /// What the shares settle together, what is open and what would help; none for a refusal.
    pub fn lines(&self) -> Vec<ReportLine> {
        let assessment = &self.assessment;
        if assessment.verdict == Verdict::Determined {
            return vec![ReportLine::Status {
                label: "Marked elements:",
                value: "settled by the shares together".to_owned(),
                good: true,
            }];
        }
        // A refusal counts no combination, also one of shares of which too many ways can be read.
        if assessment.combinations == 0.0 {
            return Vec::new();
        }
        let mut lines = vec![ReportLine::Status {
            label: "Open combinations:",
            value: format!(
                "{} (2^{}), {}",
                count(assessment.combinations),
                assessment.combinations.log2().ceil(),
                duration(self.seconds(None))
            ),
            good: false,
        }];
        for help in assessment.helps.iter().take(NAMED_HELPS) {
            lines.push(ReportLine::Hint(format!(
                "Reading element {} of share {} would leave 2^{}.",
                help.element.position,
                place_of(self.places.as_deref(), help.element.share),
                help.open_bits
            )));
        }
        if assessment.more_shares > 0 {
            lines.push(ReportLine::Hint(format!(
                "{} more {} without marks would settle everything.",
                assessment.more_shares,
                if assessment.more_shares == 1 {
                    "share"
                } else {
                    "shares"
                }
            )));
        }
        if assessment.expected_false >= NOTABLE_FALSE {
            lines.push(ReportLine::Warning(format!(
                "About {} wrong phrases may pass by chance; every phrase found is listed.",
                two_digits(assessment.expected_false)
            )));
        }
        lines.push(ReportLine::More(REPAIR_ANCHOR));
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_as_javascript_writes_them() {
        assert_eq!(two_digits(0.015_6), "0.016");
        assert_eq!(two_digits(256.0), "2.6e+2");
        assert_eq!(two_digits(15.9), "16");
        assert_eq!(two_digits(1.0), "1.0");
        assert_eq!(two_digits(9.96), "10");
        assert_eq!(two_digits(999.0), "1.0e+3");
        assert_eq!(count(2_f64.powi(40)), "1,099,511,627,776");
        assert_eq!(count(2_f64.powi(56)), "72,057,594,037,927,940");
    }

    #[test]
    fn two_digits_are_written_as_javascript_writes_them() {
        for (value, written) in [
            (0.0, "0.0"),
            (0.125, "0.13"),
            (0.135, "0.14"),
            (9.96, "10"),
            (0.0996, "0.10"),
            (1.5, "1.5"),
            (15.0, "15"),
            (99.5, "1.0e+2"),
            (123.0, "1.2e+2"),
            (0.000_001_234, "0.0000012"),
            (0.000_000_12, "1.2e-7"),
        ] {
            assert_eq!(two_digits(value), written, "{value}");
        }
    }

    #[test]
    fn a_report_needs_a_positive_pace() {
        let assessment = JointAssessment {
            shares: Vec::new(),
            secret_bytes: None,
            threshold: None,
            branches: 0,
            open_bits: 0,
            combinations: 0.0,
            expected_false: 0.0,
            more_shares: 0,
            helps: Vec::new(),
            unfit: None,
            verdict: Verdict::NotEnough,
            reason: None,
        };
        assert!(RepairReport::new(assessment.clone(), 1.0, None).is_ok());
        for pace in [0.0, -1.0, f64::NAN] {
            let refused = RepairReport::new(assessment.clone(), pace, None).unwrap_err();
            assert_eq!(
                refused.to_string(),
                "A repair report needs a positive pace."
            );
            assert_eq!(
                refused.code(),
                "sskr.repair-report.repair-report-positive-pace"
            );
        }
    }

    #[test]
    fn report_lines_name_no_element_in_debug() {
        let line = ReportLine::Warning("share 1 holds a word".to_owned());
        assert!(!format!("{line:?}").contains("word"));
        let element = RepairedElement {
            position: 1,
            value: "word".to_owned(),
            guess: false,
        };
        assert!(!format!("{element:?}").contains("word"));
    }
}
