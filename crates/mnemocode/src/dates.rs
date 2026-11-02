//! Dates as Seedshift takes them (MnemoCode TS 0.1.0's `core/dates.ts`, CAP-PHRASE-FORMATS-DATES,
//! -DATE-PATTERNS, -SHIFT-SCHEDULE): a date of the Gregorian calendar from 0001 through 9999,
//! written DD-MM-YYYY or YYYY-MM-DD, a year always with its four digits; the shifts of a phrase's
//! words, three words to a date (its year, its month, its day) in calendar order, repeated; and the
//! patterns of a date search, ? for a forgotten digit, values of a part joined by |, or a lone ?
//! for a whole date, counted without listing their dates.

pub mod answer;

use std::collections::BTreeSet;
use std::fmt;

use crate::refusal::Refusal;
use crate::search::{CountRefused, kept_count};
use crate::secret::SecretBytes;
use crate::text::numbers::{WholeRange, integer_refusal};
use crate::text::space::trim;

/// A date of the calendar, checked: a year from 1 through 9999, a month from 1 through 12 and a day
/// its month has.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    year: u16,
    month: u8,
    day: u8,
}

/// Redacted: a date is part of the secret.
impl fmt::Debug for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a date")
    }
}

/// Dates kept as a secret (ARCHITECTURE.md §6): in a locked buffer, four bytes a date, wiped when
/// dropped and redacted when printed.
pub struct Dates(SecretBytes);

impl Dates {
    /// `dates`, held.
    pub fn new(dates: &[Date]) -> Self {
        let mut bytes = SecretBytes::zeroed("dates", dates.len() * 4);
        for (held, date) in bytes.as_chunks_mut::<4>().0.iter_mut().zip(dates) {
            held[..2].copy_from_slice(&date.year.to_be_bytes());
            held[2] = date.month;
            held[3] = date.day;
        }
        Self(bytes)
    }

    /// How many.
    pub fn len(&self) -> usize {
        self.0.len() / 4
    }

    /// Whether there are none.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The dates, in their order.
    pub fn iter(&self) -> impl Iterator<Item = Date> + '_ {
        self.0.as_chunks::<4>().0.iter().map(|held| Date {
            year: u16::from_be_bytes([held[0], held[1]]),
            month: held[2],
            day: held[3],
        })
    }
}

impl Clone for Dates {
    fn clone(&self) -> Self {
        Self(SecretBytes::copy_of("dates", &self.0))
    }
}

impl fmt::Debug for Dates {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "dates")
    }
}

/// The shift of each word, kept as a secret like the dates it comes from: two bytes a shift in a
/// locked buffer.
pub struct Shifts(SecretBytes);

impl Shifts {
    /// `shifts`, held.
    pub fn new(shifts: &[u16]) -> Self {
        let mut bytes = SecretBytes::zeroed("shifts", shifts.len() * 2);
        for (held, shift) in bytes.as_chunks_mut::<2>().0.iter_mut().zip(shifts) {
            held.copy_from_slice(&shift.to_be_bytes());
        }
        Self(bytes)
    }

    /// How many.
    pub fn len(&self) -> usize {
        self.0.len() / 2
    }

    /// Whether there are none.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The shifts, in word order.
    pub fn iter(&self) -> impl Iterator<Item = u16> + '_ {
        self.0
            .as_chunks::<2>()
            .0
            .iter()
            .map(|held| u16::from_be_bytes(*held))
    }
}

impl Clone for Shifts {
    fn clone(&self) -> Self {
        Self(SecretBytes::copy_of("shifts", &self.0))
    }
}

impl fmt::Debug for Shifts {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "shifts")
    }
}

/// The values each part of a date takes.
const YEARS: WholeRange = WholeRange::new(1, 9999);
const MONTHS: WholeRange = WholeRange::new(1, 12);
const DAYS: WholeRange = WholeRange::new(1, 31);
/// Seedshift shifts three words with each date: by its year, its month and its day.
const WORDS_PER_DATE: usize = 3;
/// How a date is written, as the questions and refusals name it.
pub const DATE_FORMAT_TEXT: &str = "DD-MM-YYYY";
/// A date of which nothing is remembered, typed in its place.
pub const WHOLE_DATE: &str = "?";
/// The longest search of one key's combinations a count follows exactly (Number.MAX_SAFE_INTEGER).
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// The refusals of dates, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DatesError {
    /// A month that is not 1 to 12, asked for its days.
    NoMonth,
    /// A year out of range.
    YearOutOfRange,
    /// A month out of range.
    MonthOutOfRange,
    /// A day its month does not have.
    DayOutsideMonth,
    /// A date in another layout.
    Layout,
    /// A date pattern part with no value a date can have; the part's name.
    PatternCannotMatchValid(&'static str),
    /// Pattern parts that give no calendar date together.
    PatternCannotMatchDate,
    /// A pattern with the key of an earlier one that allows other dates.
    KeyConflict,
    /// No date given where one is needed.
    NoDate,
    /// More dates than the phrase takes; the phrase's word count.
    TooManyDates(usize),
    /// A pattern in another layout.
    PatternLayout,
    /// A pattern with nothing forgotten.
    NothingForgotten,
    /// A count's limit that is no whole number.
    Count(CountRefused),
}

impl fmt::Display for DatesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoMonth => f.write_str("There is no such calendar month."),
            Self::YearOutOfRange => f.write_str(&integer_refusal(
                "A date year",
                YEARS,
                Some("0001 through 9999"),
            )),
            Self::MonthOutOfRange => f.write_str(&integer_refusal("A date month", MONTHS, None)),
            Self::DayOutsideMonth => f.write_str("The day is outside the selected calendar month."),
            Self::Layout => write!(
                f,
                "Use {DATE_FORMAT_TEXT} with a four-digit year, for example 23-09-2026."
            ),
            Self::PatternCannotMatchValid(part) => {
                write!(f, "The date pattern cannot match a valid {part}.")
            }
            Self::PatternCannotMatchDate => {
                f.write_str("The date pattern cannot match a real calendar date.")
            }
            Self::KeyConflict => {
                f.write_str("A date pattern has the key of an earlier one that allows other dates.")
            }
            Self::NoDate => f.write_str("Type at least one date."),
            Self::TooManyDates(words) => f.write_str(&too_many_dates_message(*words)),
            Self::PatternLayout => write!(
                f,
                "Use {DATE_FORMAT_TEXT} with ? for each forgotten digit, values joined by | such as 05|15, or a lone ? for a whole date."
            ),
            Self::NothingForgotten => {
                f.write_str("A recovery pattern must contain a ? digit, or values joined by |.")
            }
            Self::Count(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for DatesError {}

impl Refusal for DatesError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoMonth => "core.dates.there-no-month",
            Self::YearOutOfRange => "core.dates.year-out-of-range",
            Self::MonthOutOfRange => "core.dates.month-out-of-range",
            Self::DayOutsideMonth => "core.dates.day-outside-selected-calendar-month",
            Self::Layout => "core.dates.use-four-digit-year-example-23-09-2026",
            Self::PatternCannotMatchValid(_) => "core.dates.date-pattern-cannot-match-valid",
            Self::PatternCannotMatchDate => {
                "core.dates.date-pattern-cannot-match-real-calendar-date"
            }
            Self::KeyConflict => "core.dates.key-conflict",
            Self::NoDate => "core.dates.no-date",
            Self::TooManyDates(_) => "core.dates.derive-shifts-refused",
            Self::PatternLayout => "core.dates.use-each-forgotten-digit-values-joined-by-such",
            Self::NothingForgotten => "core.dates.recovery-pattern-contain-digit-values-joined-by",
            Self::Count(error) => error.code(),
        }
    }

    fn kind(&self) -> crate::refusal::RefusalKind {
        match self {
            Self::Count(error) => error.kind(),
            _ => crate::refusal::RefusalKind::Error,
        }
    }
}

/// The most dates a phrase of `word_count` words takes: one for every three words.
pub const fn maximum_dates(word_count: usize) -> usize {
    word_count / WORDS_PER_DATE
}

/// The refusal of more dates than a phrase of `word_count` words takes.
pub fn too_many_dates_message(word_count: usize) -> String {
    format!(
        "{word_count}-word phrases support at most {} dates.",
        maximum_dates(word_count)
    )
}

/// Whether `year` is a leap year of the Gregorian calendar.
pub const fn is_leap_year(year: u16) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

/// The days of `month` of `year`; refused for a month that is not 1 to 12.
pub fn days_in_month(year: u16, month: u8) -> Result<u8, DatesError> {
    match month {
        2 => Ok(if is_leap_year(year) { 29 } else { 28 }),
        4 | 6 | 9 | 11 => Ok(30),
        1..=12 => Ok(31),
        _ => Err(DatesError::NoMonth),
    }
}

impl Date {
    /// The date of `year`, `month` and `day`, refused where the calendar does not have it.
    pub fn new(year: u64, month: u64, day: u64) -> Result<Self, DatesError> {
        let year = u16::try_from(year)
            .ok()
            .filter(|year| YEARS.contains(u64::from(*year)))
            .ok_or(DatesError::YearOutOfRange)?;
        let month = u8::try_from(month)
            .ok()
            .filter(|month| MONTHS.contains(u64::from(*month)))
            .ok_or(DatesError::MonthOutOfRange)?;
        let day = u8::try_from(day)
            .ok()
            .filter(|day| DAYS.contains(u64::from(*day)))
            .ok_or(DatesError::DayOutsideMonth)?;
        if day > days_in_month(year, month)? {
            return Err(DatesError::DayOutsideMonth);
        }
        Ok(Self { year, month, day })
    }

    /// The year, 1 through 9999.
    pub const fn year(self) -> u16 {
        self.year
    }

    /// The month, 1 through 12.
    pub const fn month(self) -> u8 {
        self.month
    }

    /// The day of the month, from 1.
    pub const fn day(self) -> u8 {
        self.day
    }
}

impl fmt::Display for Date {
    /// DD-MM-YYYY, with leading zeros.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02}-{:02}-{:04}", self.day, self.month, self.year)
    }
}

/// The three parts of `text` split at "-", read by `read` with each part's width, in the order
/// DD-MM-YYYY, then YYYY-MM-DD: (year, month, day), or none.
fn read_parts<T>(text: &str, read: impl Fn(&str, usize) -> Option<T>) -> Option<(T, T, T)> {
    let parts: Vec<&str> = text.split('-').collect();
    let [first, second, third] = parts.as_slice() else {
        return None;
    };
    if let (Some(day), Some(month), Some(year)) = (read(first, 2), read(second, 2), read(third, 4))
    {
        return Some((year, month, day));
    }
    if let (Some(year), Some(month), Some(day)) = (read(first, 4), read(second, 2), read(third, 2))
    {
        return Some((year, month, day));
    }
    None
}

/// The date that `value` writes, trimmed by the one rule; refused in another layout or where the
/// calendar does not have it.
pub fn parse_date(value: &str) -> Result<Date, DatesError> {
    let digits = |part: &str, width: usize| {
        (part.len() == width && part.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| part.parse::<u64>().ok())
            .flatten()
    };
    let (year, month, day) = read_parts(trim(value), digits).ok_or(DatesError::Layout)?;
    Date::new(year, month, day)
}

/// The shifts of the words of a phrase of `word_count` words that `dates` give: each date's year,
/// month and day in calendar order, repeated to the phrase's length. Refused without a date and
/// with more than the phrase takes.
pub fn derive_shifts(dates: &[Date], word_count: usize) -> Result<Vec<u16>, DatesError> {
    if dates.is_empty() {
        return Err(DatesError::NoDate);
    }
    if dates.len() > maximum_dates(word_count) {
        return Err(DatesError::TooManyDates(word_count));
    }
    let mut sorted = dates.to_vec();
    sorted.sort_unstable();
    let sequence: Vec<u16> = sorted
        .iter()
        .flat_map(|date| [date.year, u16::from(date.month), u16::from(date.day)])
        .collect();
    Ok(sequence.iter().copied().cycle().take(word_count).collect())
}

/// Whether a typed date is one to search: a ? for a forgotten digit, values joined by |, or a lone
/// ? for a whole date.
pub fn is_date_pattern(value: &str) -> bool {
    let text = trim(value);
    text == WHOLE_DATE || text.contains(['?', '|'])
}

/// The dates a pattern allows: each part's values, each once, ascending, and a key that names it
/// in one canonical way, year first, such as 2025-??-05|15.
#[derive(Clone, PartialEq, Eq)]
pub struct DatePattern {
    key: String,
    years: Vec<u16>,
    months: Vec<u8>,
    days: Vec<u8>,
}

/// Redacted: a date pattern is part of the secret.
impl fmt::Debug for DatePattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a date pattern")
    }
}

impl DatePattern {
    /// A pattern of the given values, held to the rules of a parsed one: each part a value a date
    /// can have, each once and ascending, and at least one real date.
    pub fn new(key: &str, years: &[u16], months: &[u8], days: &[u8]) -> Result<Self, DatesError> {
        let years = owned_part(years.iter().map(|&year| u64::from(year)), YEARS, "year")?;
        let months = owned_part(
            months.iter().map(|&month| u64::from(month)),
            MONTHS,
            "month",
        )?;
        let days = owned_part(days.iter().map(|&day| u64::from(day)), DAYS, "day")?;
        let pattern = Self {
            key: key.to_owned(),
            years: years
                .into_iter()
                .filter_map(|year| u16::try_from(year).ok())
                .collect(),
            months: months
                .into_iter()
                .filter_map(|month| u8::try_from(month).ok())
                .collect(),
            days: days
                .into_iter()
                .filter_map(|day| u8::try_from(day).ok())
                .collect(),
        };
        if pattern.count() == 0 {
            return Err(DatesError::PatternCannotMatchDate);
        }
        Ok(pattern)
    }

    /// Its key.
    pub fn key(&self) -> &str {
        &self.key
    }

    /// Its days, ascending.
    pub fn days(&self) -> &[u8] {
        &self.days
    }

    /// Whether its parts take `year`, `month` and `day`.
    pub fn allows(&self, year: u16, month: u8, day: u8) -> bool {
        self.years.binary_search(&year).is_ok()
            && self.months.binary_search(&month).is_ok()
            && self.days.binary_search(&day).is_ok()
    }

    /// Whether it allows the same dates as `other`.
    fn same_dates(&self, other: &Self) -> bool {
        self.years == other.years && self.months == other.months && self.days == other.days
    }

    /// How many dates it allows, counted by month: a month has the same days in every year but
    /// February.
    pub fn count(&self) -> u64 {
        let days_up_to = |last: u8| self.days.iter().filter(|&&day| day <= last).count() as u64;
        let years = self.years.len() as u64;
        let leap = self
            .years
            .iter()
            .filter(|&&year| is_leap_year(year))
            .count() as u64;
        self.months
            .iter()
            .map(|&month| {
                if month == 2 {
                    leap * days_up_to(29) + (years - leap) * days_up_to(28)
                } else {
                    let last = days_in_month(2001, month).unwrap_or(31);
                    years * days_up_to(last)
                }
            })
            .sum()
    }

    /// Its dates in calendar order.
    pub fn dates(&self) -> impl Iterator<Item = Date> + '_ {
        self.years.iter().flat_map(move |&year| {
            self.months.iter().flat_map(move |&month| {
                let last = days_in_month(year, month).unwrap_or(0);
                self.days
                    .iter()
                    .filter(move |&&day| day <= last)
                    .map(move |&day| Date { year, month, day })
            })
        })
    }
}

/// The values of one part of a pattern, each once and ascending; refused when none can be a date.
fn owned_part(
    values: impl Iterator<Item = u64>,
    range: WholeRange,
    name: &'static str,
) -> Result<Vec<u64>, DatesError> {
    let set: BTreeSet<u64> = values.collect();
    if set.is_empty() || !set.iter().all(|&value| range.contains(value)) {
        return Err(DatesError::PatternCannotMatchValid(name));
    }
    Ok(set.into_iter().collect())
}

/// The masks of one part: its values joined by |, each with ? for a forgotten digit, each once; a
/// lone ? is the whole part.
fn part_masks(part: &str, width: usize) -> Option<Vec<String>> {
    let mut masks: Vec<String> = Vec::new();
    for mask in part.split('|') {
        let mask = if mask == "?" {
            "?".repeat(width)
        } else {
            mask.to_owned()
        };
        let form = mask.len() == width
            && mask
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'?');
        if !form {
            return None;
        }
        if !masks.contains(&mask) {
            masks.push(mask);
        }
    }
    Some(masks)
}

/// The numbers a mask writes: 10^(its ?) of them.
fn mask_values(mask: &str) -> Vec<u64> {
    let mut values = vec![0_u64];
    for byte in mask.bytes() {
        let digits: Vec<u64> = if byte == b'?' {
            (0..10).collect()
        } else {
            vec![u64::from(byte - b'0')]
        };
        values = values
            .iter()
            .flat_map(|value| digits.iter().map(move |digit| value * 10 + digit))
            .collect();
    }
    values
}

/// The values of `range` that one of `masks` writes, each once, ascending.
fn matching(masks: &[String], range: WholeRange) -> Vec<u64> {
    let set: BTreeSet<u64> = masks
        .iter()
        .flat_map(|mask| mask_values(mask))
        .filter(|&value| range.contains(value))
        .collect();
    set.into_iter().collect()
}

/// The dates `value` stands for, DD-MM-YYYY with ? for a forgotten digit, values joined by |, or ?
/// for a whole date; refused in another layout, with nothing forgotten, or where no date fits.
pub fn parse_date_pattern(value: &str) -> Result<DatePattern, DatesError> {
    let typed = trim(value);
    let text = if typed == WHOLE_DATE {
        "??-??-????"
    } else {
        typed
    };
    let (years, months, days) = read_parts(text, part_masks).ok_or(DatesError::PatternLayout)?;
    if !is_date_pattern(typed) {
        return Err(DatesError::NothingForgotten);
    }
    let key_of = |masks: &[String]| {
        let set: BTreeSet<&String> = masks.iter().collect();
        set.into_iter().cloned().collect::<Vec<_>>().join("|")
    };
    let key = format!("{}-{}-{}", key_of(&years), key_of(&months), key_of(&days));
    let narrow = |values: Vec<u64>| values;
    let years: Vec<u16> = narrow(matching(&years, YEARS))
        .into_iter()
        .filter_map(|v| u16::try_from(v).ok())
        .collect();
    let months: Vec<u8> = narrow(matching(&months, MONTHS))
        .into_iter()
        .filter_map(|v| u8::try_from(v).ok())
        .collect();
    let days: Vec<u8> = narrow(matching(&days, DAYS))
        .into_iter()
        .filter_map(|v| u8::try_from(v).ok())
        .collect();
    DatePattern::new(&key, &years, &months, &days)
}

/// Refuses patterns where a key stands for patterns that allow other dates.
pub fn check_keys(patterns: &[DatePattern]) -> Result<(), DatesError> {
    for (index, pattern) in patterns.iter().enumerate() {
        let earlier = patterns[..index]
            .iter()
            .find(|other| other.key == pattern.key);
        if earlier.is_some_and(|earlier| !earlier.same_dates(pattern)) {
            return Err(DatesError::KeyConflict);
        }
    }
    Ok(())
}

/// How many combinations of dates `patterns` give together, the dates of one key taken in
/// ascending order only, counted no further than `stop_after` (by default 2^53 − 1): a count above
/// it gives `stop_after` + 1.
pub fn combination_count(
    patterns: &[DatePattern],
    stop_after: Option<u64>,
) -> Result<u64, DatesError> {
    let stop =
        kept_count(stop_after, MAX_SAFE_INTEGER, "stopAfter", 0).map_err(DatesError::Count)?;
    check_keys(patterns)?;
    let mut groups: Vec<(&DatePattern, u64)> = Vec::new();
    for pattern in patterns {
        match groups
            .iter_mut()
            .find(|(known, _)| known.key == pattern.key)
        {
            Some((_, count)) => *count += 1,
            None => groups.push((pattern, 1)),
        }
    }
    let mut total: u128 = 1;
    for (pattern, count) in groups {
        let candidates = u128::from(pattern.count());
        if candidates == 0 {
            return Ok(0);
        }
        // Combinations with repetition: (candidates + count - 1) choose count.
        let mut combinations: u128 = 1;
        for index in 1..=u128::from(count) {
            combinations = combinations.saturating_mul(candidates + index - 1) / index;
        }
        total = total.saturating_mul(combinations);
        if total > u128::from(stop) {
            return Ok(stop + 1);
        }
    }
    Ok(u64::try_from(total).unwrap_or(u64::MAX))
}

/// For each pattern, the place of the last earlier one with its key: the dates of one key are
/// taken in ascending order only.
pub fn same_key_predecessors(patterns: &[DatePattern]) -> Vec<Option<usize>> {
    patterns
        .iter()
        .enumerate()
        .map(|(index, pattern)| {
            patterns[..index]
                .iter()
                .rposition(|other| other.key == pattern.key)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_read_in_both_orders_with_four_digit_years() {
        assert_eq!(
            parse_date(" 23-09-2026 ").map(|date| date.to_string()),
            Ok("23-09-2026".to_owned())
        );
        assert_eq!(parse_date("2026-09-23"), parse_date("23-09-2026"));
        assert_eq!(parse_date("23-09-26"), Err(DatesError::Layout));
        assert_eq!(parse_date("29-02-2025"), Err(DatesError::DayOutsideMonth));
        assert_eq!(parse_date("29-02-2024").map(Date::day), Ok(29));
        assert_eq!(parse_date("01-13-2025"), Err(DatesError::MonthOutOfRange));
        assert_eq!(
            DatesError::YearOutOfRange.to_string(),
            "A date year must be an integer from 0001 through 9999."
        );
    }

    #[test]
    fn shifts_follow_the_dates_in_calendar_order() {
        let late = Date::new(2026, 9, 23).unwrap();
        let early = Date::new(2001, 1, 2).unwrap();
        assert_eq!(
            derive_shifts(&[late, early], 12).unwrap(),
            vec![2001, 1, 2, 2026, 9, 23, 2001, 1, 2, 2026, 9, 23]
        );
        assert_eq!(derive_shifts(&[], 12), Err(DatesError::NoDate));
        assert_eq!(
            derive_shifts(&[early; 5], 12),
            Err(DatesError::TooManyDates(12))
        );
    }

    #[test]
    fn patterns_count_without_listing_their_dates() {
        let whole = parse_date_pattern("?").unwrap();
        assert_eq!(whole.key(), "????-??-??");
        let days_in_years: u64 = (1..=9999)
            .map(|year| if is_leap_year(year) { 366 } else { 365 })
            .sum();
        assert_eq!(whole.count(), days_in_years);
        let pattern = parse_date_pattern("05|15-0?-2025").unwrap();
        assert_eq!(pattern.count(), 18);
        assert_eq!(pattern.dates().count(), 18);
        assert_eq!(
            parse_date_pattern("05-09-2025"),
            Err(DatesError::NothingForgotten)
        );
        assert_eq!(
            combination_count(&[pattern.clone(), pattern], None),
            Ok(171)
        );
    }
}
