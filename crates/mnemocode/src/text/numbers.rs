//! A whole number in a range, as a person types it in answer to a question (TS
//! `src/core/typed-number.ts`): every question for a number reads it the same way, in the menu, in
//! a command's questions and on a page; an option reads the same range in its own stricter syntax.

use std::fmt;

use crate::refusal::Refusal;

/// The largest whole number JavaScript counts exactly (2^53 - 1): the top of every count TS reads,
/// kept so that a count refused there is refused here too.
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// The whole numbers from `min` through `max`, both included: a rule of the library, such as how
/// many addresses are compared, which each host reads in its own syntax.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WholeRange {
    /// The least whole number of the range, itself included.
    pub min: u64,
    /// The greatest, itself included; [`MAX_SAFE_INTEGER`] for a count.
    pub max: u64,
}

impl WholeRange {
    /// The whole numbers from `min` through `max`.
    pub const fn new(min: u64, max: u64) -> Self {
        Self { min, max }
    }

    /// The whole numbers of `min` or more, as far as TS counts them exactly: a count.
    pub const fn from(min: u64) -> Self {
        Self::new(min, MAX_SAFE_INTEGER)
    }

    /// Whether `value` is in the range and a whole number TS counts exactly.
    pub const fn contains(self, value: u64) -> bool {
        value >= self.min && value <= self.max && value <= MAX_SAFE_INTEGER
    }

    /// A number a page passed, as JavaScript holds every number, admitted when it is a whole
    /// number in the range: finite, without a fraction, not negative, at most
    /// [`MAX_SAFE_INTEGER`], as TS's `inWholeRange` takes it. The binding converts every number it
    /// takes through this, so a refused value is refused alike everywhere.
    pub fn admit(self, value: f64) -> Option<u64> {
        if !value.is_finite()
            || value.fract() != 0.0
            || value < 0.0
            || value > MAX_SAFE_INTEGER as f64
        {
            return None;
        }
        // A whole number from 0 through 2^53 - 1, exact in an f64 and in a u64.
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "checked above: a whole number from 0 through 2^53 - 1"
        )]
        let whole = value as u64;
        self.contains(whole).then_some(whole)
    }

    /// The range in words: "1 through 2048", as a refusal names it.
    pub fn through(self) -> String {
        self.text("through")
    }

    /// The range in words: "1 to 2048", as a question and the help name it.
    pub fn to(self) -> String {
        self.text("to")
    }

    fn text(self, word: &str) -> String {
        format!("{} {word} {}", self.min, self.max)
    }
}

/// Whether `text` is decimal digits only, at least one: no sign, point, exponent or white space
/// inside, leading zeros allowed. The one rule of a whole number as written (TS `DECIMAL_DIGITS`).
pub fn is_decimal_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

/// `text` as a whole number in `range` when it is decimal digits, leading zeros allowed; none
/// otherwise, also for a number too large to read.
pub fn whole_number_of(text: &str, range: WholeRange) -> Option<u64> {
    if !is_decimal_digits(text) {
        return None;
    }
    let digits = text.trim_start_matches('0');
    // More digits than any u64 has means far above every range.
    let value = if digits.is_empty() {
        0
    } else {
        digits.parse::<u64>().ok()?
    };
    range.contains(value).then_some(value)
}

/// The refusal of a value that is no whole number of `range`: "`subject` must be an integer from
/// 1 through 12." `written` names the range where it is written otherwise, such as 0001 for a year.
pub fn integer_refusal(subject: &str, range: WholeRange, written: Option<&str>) -> String {
    let range_text = written.map_or_else(|| range.through(), str::to_owned);
    format!("{subject} must be an integer from {range_text}.")
}

/// A typed whole number that is not in its range.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypedNumberRefused {
    message: String,
}

impl fmt::Display for TypedNumberRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TypedNumberRefused {}

impl Refusal for TypedNumberRefused {
    fn code(&self) -> &'static str {
        "core.typed-number.typed-whole-number-refused"
    }
}

/// A typed whole number in `range`; otherwise refused with `refusal`, by default the one that names
/// the range: "Type a number from 0 through 2147483647."
pub fn typed_whole_number(
    answer: &str,
    range: WholeRange,
    refusal: Option<&str>,
) -> Result<u64, TypedNumberRefused> {
    whole_number_of(answer, range).ok_or_else(|| TypedNumberRefused {
        message: refusal.map_or_else(
            || format!("Type a number from {}.", range.through()),
            str::to_owned,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_numbers_are_read_with_leading_zeros_in_range() {
        let range = WholeRange::new(1, 2048);
        assert_eq!(whole_number_of("0007", range), Some(7));
        assert_eq!(whole_number_of("2048", range), Some(2048));
        assert_eq!(whole_number_of("2049", range), None);
        assert_eq!(whole_number_of("0", range), None);
        for refused in ["", "+1", "1.0", " 1", "1e3", "\u{0661}"] {
            assert_eq!(whole_number_of(refused, range), None, "{refused:?}");
        }
        assert_eq!(whole_number_of(&"9".repeat(40), WholeRange::from(0)), None);
        assert_eq!(whole_number_of("000", WholeRange::from(0)), Some(0));
    }

    #[test]
    fn a_count_stops_where_javascript_counts_exactly() {
        let count = WholeRange::from(1);
        assert_eq!(
            whole_number_of("9007199254740991", count),
            Some(MAX_SAFE_INTEGER)
        );
        assert_eq!(whole_number_of("9007199254740992", count), None);
    }

    #[test]
    fn a_number_from_javascript_is_admitted_only_whole_and_in_range() {
        let range = WholeRange::new(1, 20);
        assert_eq!(range.admit(20.0), Some(20));
        for refused in [0.0, 21.0, 2.5, -1.0, f64::NAN, f64::INFINITY, -0.5] {
            assert_eq!(range.admit(refused), None, "{refused}");
        }
        let count = WholeRange::from(0);
        assert_eq!(count.admit(9_007_199_254_740_991.0), Some(MAX_SAFE_INTEGER));
        assert_eq!(count.admit(9_007_199_254_740_992.0), None);
        assert!(!WholeRange::new(0, u64::MAX).contains(MAX_SAFE_INTEGER + 1));
    }

    #[test]
    fn a_refused_number_names_its_range() {
        let range = WholeRange::new(0, 2_147_483_647);
        let refused = typed_whole_number("x", range, None).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "Type a number from 0 through 2147483647."
        );
        assert_eq!(
            refused.code(),
            "core.typed-number.typed-whole-number-refused"
        );
        let own = typed_whole_number("", range, Some("Type the account.")).unwrap_err();
        assert_eq!(own.to_string(), "Type the account.");
        assert_eq!(
            integer_refusal("The month", WholeRange::new(1, 12), None),
            "The month must be an integer from 1 through 12."
        );
        assert_eq!(
            integer_refusal(
                "The year",
                WholeRange::new(1, 9999),
                Some("0001 through 9999")
            ),
            "The year must be an integer from 0001 through 9999."
        );
        assert_eq!(WholeRange::new(1, 2048).to(), "1 to 2048");
    }
}
