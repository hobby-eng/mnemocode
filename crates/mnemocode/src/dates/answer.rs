//! The dates of one answer (MnemoCode TS 0.1.0's `DatesAnswer` of `core/date-search.ts`,
//! CAP-RECOVERY-DATES-ANSWER): the complete dates and, where the dates are searched, the patterns
//! with ? or | for what is forgotten, each named by its place among the dates typed when it is
//! refused. Held to the limits before a date is read: a lone ? stands for every year from 0001 to
//! 9999, and reading thousands of them took minutes and gigabytes in TS before a limit refused them.

use std::fmt;

use super::{DatePattern, DatesError, check_keys, combination_count, is_date_pattern};
use super::{Dates, maximum_dates, parse_date, parse_date_pattern, too_many_dates_message};
use crate::refusal::Refusal;
use crate::search::plan::counting;
use crate::text::space::is_ecmascript_space;
use crate::text::words::after_place;

/// Dates with ? that one search takes.
pub const MAX_INCOMPLETE_DATES: usize = 3;
/// Date combinations that no search exceeds.
pub const HARD_MAX_COMBINATIONS: u64 = 1 << 31;
/// The words of the longest phrase, whose dates bound an answer typed without a phrase.
const LONGEST_WORD_COUNT: usize = 24;

/// The refusals of an answer of dates, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnswerError {
    /// Nothing typed.
    NoDate,
    /// More dates than a phrase of so many words takes.
    TooManyDates(usize),
    /// More dates with ? than one search takes.
    TooManyIncomplete,
    /// Patterns of more combinations than any search takes.
    TooManyCombinations,
    /// A ? or | where the dates are not searched.
    PatternsNotAllowed,
    /// A date or pattern refused, at its place, counted from 1.
    AtPlace(usize, DatesError),
    /// A pattern with the key of an earlier one that allows other dates, at its place.
    KeyConflict(usize),
}

impl fmt::Display for AnswerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoDate => DatesError::NoDate.fmt(f),
            Self::TooManyDates(words) => f.write_str(&too_many_dates_message(*words)),
            Self::TooManyIncomplete => write!(
                f,
                "Date recovery supports at most {MAX_INCOMPLETE_DATES} incomplete dates."
            ),
            Self::TooManyCombinations => write!(
                f,
                "The date patterns produce more than {} combinations, which exceeds the safety limit. Narrow at least one pattern.",
                counting(HARD_MAX_COMBINATIONS)
            ),
            Self::PatternsNotAllowed => f.write_str(
                "? and | stand for what is forgotten only where MnemoCode can search dates; type every date in full.",
            ),
            Self::AtPlace(place, error) => {
                f.write_str(&after_place("Date", *place, &error.to_string(), ": "))
            }
            Self::KeyConflict(place) => f.write_str(&after_place(
                "Date",
                *place,
                &DatesError::KeyConflict.to_string(),
                ": ",
            )),
        }
    }
}

impl std::error::Error for AnswerError {}

impl Refusal for AnswerError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoDate => "core.date-search.no-date",
            Self::TooManyDates(_) => "core.date-search.too-many-dates",
            Self::TooManyIncomplete => {
                "core.date-search.date-recovery-supports-at-most-incomplete-dates"
            }
            Self::TooManyCombinations => {
                "core.date-search.date-patterns-produce-more-than-combinations-which-exceeds"
            }
            Self::PatternsNotAllowed => {
                "core.date-search.stand-what-forgotten-only-where-mnemo-code-can"
            }
            Self::AtPlace(..) => "core.date-search.at-place-refused",
            Self::KeyConflict(_) => "core.date-search.assert-keys-fit-refused",
        }
    }
}

/// Refuses more dates than a phrase of `words` words takes, and more with ? than a search takes.
fn check_counts(dates: usize, incomplete: usize, words: usize) -> Result<(), AnswerError> {
    if dates > maximum_dates(words) {
        return Err(AnswerError::TooManyDates(words));
    }
    if incomplete > MAX_INCOMPLETE_DATES {
        return Err(AnswerError::TooManyIncomplete);
    }
    Ok(())
}

/// The dates of one answer: the complete ones in the order typed, and the patterns with the places
/// they were typed at.
pub struct DatesAnswer {
    known: Dates,
    patterns: Vec<DatePattern>,
    incomplete_places: Vec<usize>,
    combinations: u64,
}

/// Redacted: it holds the dates, which are part of the secret.
impl std::fmt::Debug for DatesAnswer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        crate::secret::redacted(f, "a dates answer")
    }
}

impl DatesAnswer {
    /// The dates typed in `line`, apart at white space, commas or semicolons, for a phrase of
    /// `word_count` words where it is known; with `patterns`, the ones with ? or | are patterns to
    /// search, refused otherwise.
    pub fn parse(
        line: &str,
        word_count: Option<usize>,
        patterns: bool,
    ) -> Result<Self, AnswerError> {
        let typed: Vec<&str> = line
            .split(|character: char| {
                is_ecmascript_space(character) || matches!(character, ',' | ';')
            })
            .filter(|text| !text.is_empty())
            .collect();
        if typed.is_empty() {
            return Err(AnswerError::NoDate);
        }
        // A phrase's length: 12 to 24 words, three to a date (dates use nothing of bip39).
        let words = word_count
            .filter(|words| words % 3 == 0 && (12..=LONGEST_WORD_COUNT).contains(words))
            .unwrap_or(LONGEST_WORD_COUNT);
        let forgotten = if patterns {
            typed.iter().filter(|text| is_date_pattern(text)).count()
        } else {
            0
        };
        check_counts(typed.len(), forgotten, words)?;
        let mut known = Vec::new();
        let mut found = Vec::new();
        let mut incomplete_places = Vec::new();
        for (index, text) in typed.into_iter().enumerate() {
            let place = index + 1;
            if is_date_pattern(text) {
                if !patterns {
                    return Err(AnswerError::PatternsNotAllowed);
                }
                found.push(
                    parse_date_pattern(text).map_err(|error| AnswerError::AtPlace(place, error))?,
                );
                incomplete_places.push(place);
            } else {
                known.push(parse_date(text).map_err(|error| AnswerError::AtPlace(place, error))?);
            }
        }
        if let Some(index) = (0..found.len()).find(|&index| check_keys(&found[..=index]).is_err()) {
            return Err(AnswerError::KeyConflict(incomplete_places[index]));
        }
        let combinations = combination_count(&found, Some(HARD_MAX_COMBINATIONS))
            .map_err(|_| AnswerError::TooManyCombinations)?;
        if combinations > HARD_MAX_COMBINATIONS {
            return Err(AnswerError::TooManyCombinations);
        }
        Ok(Self {
            known: Dates::new(&known),
            patterns: found,
            incomplete_places,
            combinations,
        })
    }

    /// The complete dates, in the order typed.
    pub const fn known(&self) -> &Dates {
        &self.known
    }

    /// The patterns, in the order typed.
    pub fn patterns(&self) -> &[DatePattern] {
        &self.patterns
    }

    /// The places of the patterns among the dates typed, counted from 1.
    pub fn incomplete_places(&self) -> &[usize] {
        &self.incomplete_places
    }

    /// How many date combinations the patterns give: 1 without patterns.
    pub const fn combinations(&self) -> u64 {
        self.combinations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::Date;

    #[test]
    fn complete_dates_are_read_in_order() {
        let answer =
            DatesAnswer::parse(" 23-09-2026, 1951-11-07;08-08-1988 ", Some(12), false).unwrap();
        assert_eq!(answer.known().len(), 3);
        assert_eq!(
            answer.known().iter().nth(1),
            Some(Date::new(1951, 11, 7).unwrap())
        );
        assert_eq!(answer.combinations(), 1);
    }

    #[test]
    fn refusals_name_the_place() {
        assert_eq!(
            DatesAnswer::parse(" , ", None, false).unwrap_err(),
            AnswerError::NoDate
        );
        assert_eq!(
            DatesAnswer::parse("23-09-2026 ??-09-2026", None, false).unwrap_err(),
            AnswerError::PatternsNotAllowed
        );
        let refused = DatesAnswer::parse("23-09-2026 31-02-2026", None, false).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "Date 2: the day is outside the selected calendar month."
        );
        assert_eq!(refused.code(), "core.date-search.at-place-refused");
        assert_eq!(
            DatesAnswer::parse(&"01-01-2000 ".repeat(5), Some(12), false).unwrap_err(),
            AnswerError::TooManyDates(12)
        );
        assert_eq!(
            DatesAnswer::parse("? ? ? ?", None, true).unwrap_err(),
            AnswerError::TooManyIncomplete
        );
    }

    #[test]
    fn patterns_are_counted() {
        let answer = DatesAnswer::parse("23-09-2026 2?-09-2026", None, true).unwrap();
        assert_eq!(answer.incomplete_places(), [2]);
        assert_eq!(answer.combinations(), 10);
    }
}
