//! The dates row (MnemoCode TS 0.1.0's `core/date-search-self-test.ts`): how many dates a typed
//! pattern stands for, the patterns refused, the search of the published Seedshift vector over the
//! digit it forgot, each effective shift tried once, and the search that the wallet decides. Public
//! data only.

use std::rc::Rc;

use super::recovery::{masked_indexes, public_wallet, ran};
use super::{Row, ok};
use crate::dates::answer::DatesAnswer;
use crate::modes::Mode;
use crate::modes::seedshift::Indexes;
use crate::recovery::date_search::{DateSearch, MatchLimits};
use crate::self_check::vectors::{MASKED_DATE, PUBLIC_MNEMONIC, PUBLIC_MNEMONIC_24};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};

/// The dates row.
pub(super) const ROW: Row = Row::new(
    "Dates",
    "? and | patterns, whole dates, refusals; wallet search",
    dates,
);

/// The masked phrase's date with its last digit forgotten.
const FORGOTTEN_LAST_DIGIT: &str = "23-09-202?";
/// The masked phrase's date, and the same date 2,048 years later, a whole turn of the list of
/// 2,048 words: the same shift.
const YEAR_AND_2048_LATER: &str = "23-09-2026|4074";
/// Eight dates, the most that 24 words take, with the day of the latest forgotten: that day moves
/// only the last word, and Seedshift adds it to the last 3 bits of entropy alone, so days 01 and 09
/// give the same phrase.
const LATEST_DAY_FORGOTTEN: &str =
    "01-01-2001 01-01-2002 01-01-2003 01-01-2004 01-01-2005 01-01-2006 01-01-2007 0?-12-2030";
/// The public 24-word phrase masked with Seedshift and those dates, the latest 09-12-2030, as word
/// numbers counted from 1, computed independently with Python's hashlib.
const LATEST_DAY_MASKED: [u16; 24] = [
    2002, 2, 2, 2003, 2, 2, 2004, 2, 2, 2005, 2, 2, 2006, 2, 2, 2007, 2, 2, 2008, 2, 2, 2031, 13,
    304,
];
/// The most phrases a search here shows.
const MOST_SHOWN: u64 = 16;
/// Typed dates and the combinations they stand for, counted independently with Python's datetime.
const QUICK_COMBINATIONS: [(&str, u64); 5] = [
    (FORGOTTEN_LAST_DIGIT, 10),
    ("?-09-2026", 30),
    ("05|15-09-2026", 2),
    ("23-09-202? 23-09-202?", 55),
    ("10-07-1963 23-09-202?", 10),
];
/// Patterns that take some milliseconds each to read, in the full self-test only.
const SLOW_COMBINATIONS: [(&str, u64); 4] = [
    ("2?-0?-19??", 8_924),
    ("29-02-????", 2_424),
    ("?-?-200? ?-?-200?", 6_674_031),
    ("?", 3_652_059),
];
/// Typed dates that must be refused, and why.
const REFUSED_DATES: [(&str, &str); 6] = [
    ("23-09-26", "core.date-search.at-place-refused"),
    ("31-02-202?", "core.date-search.at-place-refused"),
    ("32-0?-2026", "core.date-search.at-place-refused"),
    ("23-1?-202", "core.date-search.at-place-refused"),
    (
        "?-?-200? ?-?-200? ?-?-200?",
        "core.date-search.date-patterns-produce-more-than-combinations-which-exceeds",
    ),
    (
        "01-01-2001 02-01-2001 03-01-2001 04-01-2001 05-01-2001",
        "core.date-search.too-many-dates",
    ),
];

/// The combinations of each of `patterns`, as a dates answer counts them.
fn check_combinations(patterns: &[(&str, u64)]) -> Result<(), CheckFailure> {
    for (typed, combinations) in patterns {
        let dates = ok(DatesAnswer::parse(typed, Some(12), true))?;
        expect_same(
            &dates.combinations(),
            combinations,
            "Date pattern combinations",
        )?;
    }
    Ok(())
}

/// What a search of the dates `typed` finds in `indexes`: its combinations, its phrases and the
/// dates that give `wanted`, each effective shift tried once.
fn searched(
    indexes: &[u16],
    typed: &str,
    word_count: usize,
    wanted: &str,
) -> Result<(u64, u64, String), CheckFailure> {
    let dates = ok(DatesAnswer::parse(typed, Some(word_count), true))?;
    let limits = MatchLimits {
        max_shown: Some(MOST_SHOWN),
        keep: None,
    };
    let search = ok(DateSearch::new(
        Indexes::new(indexes.to_vec()),
        Rc::new(dates),
        Mode::Seedshift,
        None,
        limits,
    ))?;
    let outcome = ran(search)?;
    let found: Vec<&str> = outcome
        .shown
        .iter()
        .filter(|shown| shown.phrase.text().as_str() == wanted)
        .map(|shown| shown.dates.as_str())
        .collect();
    Ok((outcome.combinations, outcome.match_count, found.join(" ")))
}

/// The dates row: the quick known answers, and in the full self-test the slow patterns and the
/// search that the wallet decides.
fn dates(tier: Tier) -> Result<(), CheckFailure> {
    check_combinations(&QUICK_COMBINATIONS)?;
    for (typed, code) in REFUSED_DATES {
        expect_refused(
            DatesAnswer::parse(typed, Some(12), true),
            code,
            "A date pattern",
        )?;
    }
    expect_refused(
        DatesAnswer::parse(FORGOTTEN_LAST_DIGIT, Some(12), false),
        "core.date-search.stand-what-forgotten-only-where-mnemo-code-can",
        "A forgotten digit where dates are not searched",
    )?;
    ok(ok(DatesAnswer::parse(FORGOTTEN_LAST_DIGIT, Some(12), true))?.check_incomplete())?;
    expect_refused(
        ok(DatesAnswer::parse(MASKED_DATE, Some(12), true))?.check_incomplete(),
        "core.date-search.at-least-one-date-contain-forgotten-digit-represented",
        "Standalone date recovery with no incomplete date",
    )?;
    let (combinations, _, found) =
        searched(&masked_indexes(), FORGOTTEN_LAST_DIGIT, 12, PUBLIC_MNEMONIC)?;
    expect_same(&combinations, &10, "Date search combinations")?;
    expect_same(
        found.as_str(),
        MASKED_DATE,
        "Date search of the Seedshift vector",
    )?;
    let years = searched(&masked_indexes(), YEAR_AND_2048_LATER, 12, PUBLIC_MNEMONIC)?;
    expect_same(
        &(years.0, years.1, years.2.as_str()),
        &(2, 1, MASKED_DATE),
        "Date search of a year and 2,048 years later",
    )?;
    let masked: Vec<u16> = LATEST_DAY_MASKED.iter().map(|number| number - 1).collect();
    let latest = searched(&masked, LATEST_DAY_FORGOTTEN, 24, PUBLIC_MNEMONIC_24)?;
    // 01-12-2030 is tried before 09-12-2030 and gives the same phrase.
    expect_same(
        &(latest.0, latest.1, latest.2.as_str()),
        &(9, 8, "01-12-2030"),
        "Date search of the latest day",
    )?;
    if tier == Tier::Startup {
        return Ok(());
    }
    check_combinations(&SLOW_COMBINATIONS)?;
    let search = ok(DateSearch::new(
        Indexes::new(masked_indexes()),
        Rc::new(ok(DatesAnswer::parse(
            FORGOTTEN_LAST_DIGIT,
            Some(12),
            true,
        ))?),
        Mode::Seedshift,
        Some(Rc::new(public_wallet()?)),
        MatchLimits {
            max_shown: None,
            keep: None,
        },
    ))?;
    let outcome = ran(search)?;
    expect_same(&outcome.combinations, &10, "Date search combinations")?;
    // Seedshift gives a valid phrase for every date: only the wallet tells them apart.
    expect_same(
        &outcome.checksum_valid,
        &10,
        "Date search checksum-valid phrases",
    )?;
    expect_same(&outcome.match_count, &1, "Date search wallet matches")?;
    let shown = outcome
        .shown
        .first()
        .ok_or(CheckFailure::Mismatch("Date search wallet matches"))?;
    expect_same(shown.dates.as_str(), MASKED_DATE, "Date search dates")?;
    expect_same(
        shown.phrase.text().as_str(),
        PUBLIC_MNEMONIC,
        "Date search phrase",
    )
}
