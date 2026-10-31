//! What a host says of a search before it starts (TS `src/core/search-plan.ts`,
//! CAP-RECOVERY-SEARCH-PLAN): its size, about how long it takes here, whether it is asked for
//! first, and whether its time is said; and what it says once a search filled in what could not be
//! read. Every search plans through it, so every question and notice reads alike; a host adds only
//! its own words, such as the option that allows a longer search.

/// A search expected to take longer than this many hours on the host's computer is asked for first.
pub const QUESTION_HOURS: u64 = 12;
/// Seconds in a minute.
pub const SECONDS_PER_MINUTE: u64 = 60;
/// Seconds in an hour.
pub const SECONDS_PER_HOUR: u64 = 60 * SECONDS_PER_MINUTE;
/// Seconds in a day.
pub const SECONDS_PER_DAY: u64 = 24 * SECONDS_PER_HOUR;
/// [`QUESTION_HOURS`] in seconds.
pub const QUESTION_SECONDS: u64 = QUESTION_HOURS * SECONDS_PER_HOUR;
/// A search expected to take at least a minute has its time said before it starts.
pub const TELL_SECONDS: u64 = SECONDS_PER_MINUTE;

/// What to do once a search filled in what could not be read, codes or the elements of shares.
pub const CORRECT_WRITTEN_COPY: &str =
    "Correct the written copy; then check the wallet that comes back.";

/// How a notice before a search ends.
const PROGRESS_SHOWN: &str = "progress is shown";

/// The units that a length of time is said in, the largest first.
const TIME_UNITS: [(&str, u64); 4] = [
    ("day", SECONDS_PER_DAY),
    ("hour", SECONDS_PER_HOUR),
    ("minute", SECONDS_PER_MINUTE),
    ("second", 1),
];

/// Whether a search of `count` combinations, about `seconds` long here, is asked for first: when it
/// tries more than `limit`, the person's own limit, or without one takes longer than
/// [`QUESTION_SECONDS`].
pub fn asks_first(count: u64, seconds: f64, limit: Option<u64>) -> bool {
    match limit {
        Some(limit) => count > limit,
        None => seconds > QUESTION_SECONDS as f64,
    }
}

/// A number as the messages write it, in en-US grouping: 65,536.
pub fn counting(value: u64) -> String {
    grouped_digits(&value.to_string())
}

/// The decimal `digits` of a whole number in en-US grouping, a comma before each three.
pub fn grouped_digits(digits: &str) -> String {
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (at, digit) in digits.chars().enumerate() {
        if at > 0 && (digits.len() - at).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

/// A length of time in words: "about 3 minutes", or "under a second". Rounded in the largest unit
/// it reaches, half up, as JavaScript's Math.round.
pub fn duration(seconds: f64) -> String {
    let Some((name, size)) = TIME_UNITS.iter().find(|(_, size)| seconds >= *size as f64) else {
        return "under a second".to_owned();
    };
    let rounded = (seconds / *size as f64 + 0.5).floor();
    let plural = if rounded == 1.0 { "" } else { "s" };
    format!(
        "about {} {name}{plural}",
        grouped_digits(&rounded.to_string())
    )
}

/// `value` and `noun`, in the plural unless the value is 1: "1 share combination".
pub fn counted(value: u64, noun: &str) -> String {
    let plural = if value == 1 { "" } else { "s" };
    format!("{} {noun}{plural}", counting(value))
}

/// The plan of one search: its question, notice and refusal built from the same size and time,
/// so whether it is asked and whether its time is said always follow from them.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchPlan {
    size: String,
    count: u64,
    seconds: f64,
    ask: bool,
    tell: bool,
}

impl SearchPlan {
    /// The plan of `count` combinations about `seconds` long, with the person's `limit`, if any.
    pub fn new(size: String, count: u64, seconds: f64, limit: Option<u64>) -> Self {
        let ask = asks_first(count, seconds, limit);
        Self {
            size,
            count,
            seconds,
            ask,
            tell: !ask && seconds >= TELL_SECONDS as f64,
        }
    }

    /// What is searched, such as "128 candidates" or "10 date combinations".
    pub fn size(&self) -> &str {
        &self.size
    }

    /// The combinations tried, counted against the person's limit.
    pub fn count(&self) -> u64 {
        self.count
    }

    /// About how long it takes in this host, in seconds.
    pub fn seconds(&self) -> f64 {
        self.seconds
    }

    /// Whether it is asked for first: over the person's limit, or without one too long.
    pub fn ask(&self) -> bool {
        self.ask
    }

    /// Whether its time is said before it starts, when it is not asked for.
    pub fn tell(&self) -> bool {
        self.tell
    }

    /// ", about 3 minutes", or nothing under a second.
    fn time(&self) -> String {
        if self.seconds >= 1.0 {
            format!(", {}", duration(self.seconds))
        } else {
            String::new()
        }
    }

    /// The question before a search that is asked for: "Search 10 date combinations, about 9 hours?"
    pub fn question(&self) -> String {
        format!("Search {}{}?", self.size, self.time())
    }

    /// What the search tries, for a refusal where nothing can be asked.
    pub fn extent(&self) -> String {
        format!("The search tries {}{}.", self.size, self.time())
    }

    /// The notice before a search whose time is said.
    pub fn notice(&self) -> String {
        format!(
            "The search tries {}{}; {PROGRESS_SHOWN}.",
            self.size,
            self.time()
        )
    }

    /// The notice of the time alone, for a host that has said the size before: "It takes about 3
    /// minutes; progress is shown."
    pub fn time_notice(&self) -> String {
        format!("It takes {}; {PROGRESS_SHOWN}.", duration(self.seconds))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_grouped_as_en_us_writes_them() {
        assert_eq!(counting(0), "0");
        assert_eq!(counting(999), "999");
        assert_eq!(counting(65_536), "65,536");
        assert_eq!(counting(2_147_483_648), "2,147,483,648");
        assert_eq!(counted(1, "share combination"), "1 share combination");
        assert_eq!(counted(2, "candidate"), "2 candidates");
    }

    #[test]
    fn a_duration_is_rounded_in_its_largest_unit() {
        assert_eq!(duration(0.4), "under a second");
        assert_eq!(duration(1.0), "about 1 second");
        assert_eq!(duration(59.6), "about 60 seconds");
        assert_eq!(duration(150.0), "about 3 minutes");
        assert_eq!(duration(90.0), "about 2 minutes");
        assert_eq!(duration(32_400.0), "about 9 hours");
        assert_eq!(duration(3.0 * 86_400.0), "about 3 days");
    }

    #[test]
    fn a_search_is_asked_for_over_the_limit_or_twelve_hours() {
        assert!(asks_first(11, 1.0, Some(10)));
        assert!(!asks_first(10, 1e9, Some(10)));
        assert!(asks_first(1, 43_201.0, None));
        assert!(!asks_first(1, 43_200.0, None));
        let asked = SearchPlan::new("10 date combinations".to_owned(), 10, 32_400.0, Some(5));
        assert_eq!(
            asked.question(),
            "Search 10 date combinations, about 9 hours?"
        );
        assert!(asked.ask() && !asked.tell());
        let told = SearchPlan::new("128 candidates".to_owned(), 128, 180.0, None);
        assert!(told.tell());
        assert_eq!(
            told.notice(),
            "The search tries 128 candidates, about 3 minutes; progress is shown."
        );
        assert_eq!(
            told.time_notice(),
            "It takes about 3 minutes; progress is shown."
        );
        let quick = SearchPlan::new("4 candidates".to_owned(), 4, 0.2, None);
        assert_eq!(quick.extent(), "The search tries 4 candidates.");
        assert!(!quick.tell());
    }
}
