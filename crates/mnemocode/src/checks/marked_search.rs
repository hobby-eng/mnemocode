//! The marked codes search row (MnemoCode TS 0.1.0's `core/missing-codes-search-self-test.ts`): the
//! public phrase masked with a public date, a digit of two of its codes unread, found by its encoded
//! fingerprint, by the wallet with a digit of the date forgotten as well, and listed, and a list
//! refused where the phrases of one set of codes are more than it holds. It answers later, so it
//! runs only in the full self-test. Public data only.

use std::rc::Rc;

use super::recovery::{public_wallet, ran};
use super::{Row, ok};
use crate::dates::answer::DatesAnswer;
use crate::dates::{Dates, parse_date};
use crate::forms::Form;
use crate::modes::Mode;
use crate::recovery::marked::MissingCodes;
use crate::recovery::marked_search::{
    MissingCodesFound, MissingCodesResult, MissingCodesSearch, WaySearch,
};
use crate::self_check::vectors::{
    ENCODED_FINGERPRINT, MASKED_DATE, MASKED_NUMBERS, PUBLIC_FINGERPRINT, PUBLIC_MNEMONIC,
};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};

/// The marked codes search row, in the full self-test.
pub(super) const ROW: Row = Row::new(
    "Marked codes search",
    "encoded fingerprint, wallet with a date, list; refusal",
    marked_codes_search,
);

/// The last digit of codes 2 and 3 unread: a hundred combinations, few of them candidates.
const MARKED: &str = "2027 1? 2? 2027 10 24 2027 10 24 2027 10 377";
/// Every candidate of [`MARKED`] with [`MASKED_DATE`], in the order of the codes, each with the
/// phrase the date unmasks and its master fingerprint, computed independently with Python.
const LISTED: [(&str, &str, &str); 5] = [
    (MASKED_NUMBERS, PUBLIC_MNEMONIC, PUBLIC_FINGERPRINT),
    (
        "2027 11 22 2027 10 24 2027 10 24 2027 10 377",
        "abandon ability zone abandon abandon abandon abandon abandon abandon abandon abandon account",
        "1822ff36",
    ),
    (
        "2027 11 25 2027 10 24 2027 10 24 2027 10 377",
        "abandon ability ability abandon abandon abandon abandon abandon abandon abandon abandon absorb",
        "388b80e6",
    ),
    (
        "2027 14 24 2027 10 24 2027 10 24 2027 10 377",
        "abandon above abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        "04681bb7",
    ),
    (
        "2027 17 26 2027 10 24 2027 10 24 2027 10 377",
        "abandon abstract able abandon abandon abandon abandon abandon abandon abandon abandon accident",
        "dc9764be",
    ),
];
/// The last digit of code 3 unread, and a digit of the date forgotten.
const ONE_MARKED: &str = "2027 10 2? 2027 10 24 2027 10 24 2027 10 377";
/// Twelve words in the Original Seedshift with a valid last word, the last digit of code 4 unread:
/// each set of codes gives 128 phrases, more than a list holds.
const LEGACY_VALID_MARKED: &str = "1 1 1 1? 1 1 1 1 1 1 1 1";

/// What `search` found, which must be one set of codes.
fn found_by(search: WaySearch, name: &'static str) -> Result<MissingCodesFound, CheckFailure> {
    match ran(search)? {
        MissingCodesResult::Found(found) => Ok(*found),
        _ => Err(CheckFailure::Mismatch(name)),
    }
}

/// The ways of the search of codes marked with ?, each with its known answer, and a refusal.
fn marked_codes_search(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    let day = Dates::new(&[ok(parse_date(MASKED_DATE))?]);
    let search = MissingCodesSearch::new(ok(MissingCodes::read(
        MARKED,
        Form::Indexes,
        Mode::Seedshift,
    ))?);
    let by_encoded = ok(search.by_encoded_fingerprint(ENCODED_FINGERPRINT))?;
    let found = found_by(by_encoded, "Marked codes by the encoded fingerprint")?;
    expect_same(
        ok(found.backup.text())?.as_str(),
        MASKED_NUMBERS,
        "Marked codes found by the encoded fingerprint",
    )?;
    let MissingCodesResult::List(rows) = ran(ok(search.listed(&day))?)? else {
        return Err(CheckFailure::Mismatch("Marked codes listed"));
    };
    let listed: Vec<String> = rows
        .iter()
        .map(|row| {
            format!(
                "{} | {} | {}",
                row.codes.as_str(),
                row.phrase.text().as_str(),
                row.fingerprint
            )
        })
        .collect();
    let wanted: Vec<String> = LISTED
        .iter()
        .map(|(codes, phrase, fingerprint)| format!("{codes} | {phrase} | {fingerprint}"))
        .collect();
    expect_same(&listed, &wanted, "Marked codes listed: rows")?;
    let search = MissingCodesSearch::new(ok(MissingCodes::read(
        ONE_MARKED,
        Form::Indexes,
        Mode::Seedshift,
    ))?);
    let dates = ok(DatesAnswer::parse("2?-09-2026", Some(12), true))?;
    let way = ok(search.by_wallet(Rc::new(public_wallet()?), Some(Rc::new(dates))))?;
    let found = found_by(way, "Marked codes and a date by the wallet")?;
    expect_same(
        ok(found.backup.text())?.as_str(),
        MASKED_NUMBERS,
        "Marked codes found by the wallet",
    )?;
    expect_same(
        &found.found_dates.as_ref().map(|dates| dates.as_str()),
        &Some(MASKED_DATE),
        "Date found with the marked codes",
    )?;
    let too_many = MissingCodesSearch::new(ok(MissingCodes::read(
        LEGACY_VALID_MARKED,
        Form::Indexes,
        Mode::SeedshiftLegacyValid,
    ))?);
    expect_refused(
        too_many.listed(&day),
        "core.missing-codes-search.operation-refused",
        "A list of more phrases than it holds",
    )
}
