//! The share unmasking row (MnemoCode TS 0.1.0's `sskr/share-unmasking-self-test.ts`): the phrase
//! that a restored set holds, the masked phrase of the published Seedshift vector, unmasked with its
//! whole date, searched where a digit of it is forgotten with the wallet deciding, and refused with
//! more dates than it takes; and shares of that masked phrase with unread colors repaired together
//! and then unmasked with the forgotten digit. TS passes a set of the phrase alone; here the sets
//! are restored from shares of it. It answers later, so it runs only in the full self-test. Public
//! data only.

use std::rc::Rc;

use super::recovery::{public_wallet, ran, with_marks};
use super::{Row, ok};
use crate::bip39::phrase::Phrase;
use crate::dates::answer::DatesAnswer;
use crate::modes::Mode;
use crate::recovery::date_search::MatchLimits;
use crate::recovery::shares::unmasking::{ShareUnmasking, Unmasked};
use crate::self_check::vectors::{MASKED_DATE, MASKED_ENGLISH, PUBLIC_MNEMONIC};
use crate::self_check::{CheckFailure, Tier, expect_same};
use crate::sskr::forms::ShareFormat;
use crate::sskr::joint::plan_joint_repair;
use crate::sskr::restore::ShareSet;
use crate::sskr::split::split;

/// The share unmasking row, in the full self-test.
pub(super) const ROW: Row = Row::new(
    "Share unmasking",
    "whole dates, a forgotten digit, refusal; marked shares",
    share_unmasking,
);

/// The masked phrase's shares restored, or with a color unread on each repaired together: the sets
/// they restore.
fn masked_sets(marked: bool) -> Result<Vec<Rc<ShareSet>>, CheckFailure> {
    let phrase = ok(Phrase::parse(MASKED_ENGLISH))?;
    let mut seed = super::sskr::FixedSeed(super::sskr::TEST_SEED);
    let shares = ok(split(&phrase, 2, 3, &mut seed))?;
    if !marked {
        let urs: Vec<String> = shares
            .iter()
            .take(2)
            .map(|share| share.ur().as_str().to_owned())
            .collect();
        return Ok(vec![Rc::new(ok(ShareSet::restore(&urs, None))?)]);
    }
    // The second color of the first share, the fifth of the second: no color twice.
    let typed: Vec<String> = shares
        .iter()
        .take(2)
        .zip([2, 5])
        .map(|(share, place)| with_marks(ShareFormat::Colors.write(share).as_str(), &[place]))
        .collect();
    let plan = ok(plan_joint_repair(&typed, None))?;
    let search = plan
        .search()
        .ok_or(CheckFailure::Mismatch("Marked shares of the masked phrase"))?;
    let sets = ok(search.run())?.sets;
    Ok(sets.into_iter().map(Rc::new).collect())
}

/// The phrases that `unmasking` gives of `sets`, joined, or the line that refused them.
fn unmasked(unmasking: &ShareUnmasking, sets: Vec<Rc<ShareSet>>) -> Result<String, CheckFailure> {
    Ok(match ran(unmasking.unmask(sets))? {
        Unmasked::Dates(message) => message,
        Unmasked::Stopped => "stopped".to_owned(),
        Unmasked::Phrases { phrases, .. } => {
            let told: Vec<String> = phrases
                .iter()
                .map(
                    |found| match found.dates.as_ref().filter(|dates| !dates.is_empty()) {
                        Some(dates) => {
                            format!("{} at {}", found.phrase.text().as_str(), dates.as_str())
                        }
                        None => found.phrase.text().as_str().to_owned(),
                    },
                )
                .collect();
            told.join("; ")
        }
    })
}

/// The share unmasking row: the set's own phrase without Seedshift, the public phrase from the
/// masked one with the whole date, the search of a forgotten digit that the wallet decides, five
/// dates refused for a phrase of twelve words, and marked shares repaired and then unmasked.
fn share_unmasking(tier: Tier) -> Result<(), CheckFailure> {
    const FIVE_DATES: &str = "01-01-2001 02-01-2001 03-01-2001 04-01-2001 05-01-2001";
    const LIMITS: MatchLimits = MatchLimits {
        max_shown: None,
        keep: None,
    };
    if tier == Tier::Startup {
        return Ok(());
    }
    let sets = masked_sets(false)?;
    let plain = ok(ShareUnmasking::new(Mode::Direct, None, None, LIMITS))?;
    expect_same(
        unmasked(&plain, sets.clone())?.as_str(),
        MASKED_ENGLISH,
        "Shares without Seedshift",
    )?;
    let whole = Rc::new(ok(DatesAnswer::parse(MASKED_DATE, None, false))?);
    let with_date = ok(ShareUnmasking::new(
        Mode::Seedshift,
        Some(whole),
        None,
        LIMITS,
    ))?;
    expect_same(
        unmasked(&with_date, sets.clone())?.as_str(),
        PUBLIC_MNEMONIC,
        "Shares unmasked with their date",
    )?;
    // The masked phrase's date with its last digit forgotten, which the wallet tells.
    let forgotten = Rc::new(ok(DatesAnswer::parse("23-09-202?", None, true))?);
    let forgotten_digit = ok(ShareUnmasking::new(
        Mode::Seedshift,
        Some(forgotten),
        Some(Rc::new(public_wallet()?)),
        LIMITS,
    ))?;
    let at_date = format!("{PUBLIC_MNEMONIC} at {MASKED_DATE}");
    expect_same(
        unmasked(&forgotten_digit, sets.clone())?.as_str(),
        at_date.as_str(),
        "Shares unmasked with a forgotten digit",
    )?;
    let five = Rc::new(ok(DatesAnswer::parse(FIVE_DATES, None, false))?);
    let too_many = ok(ShareUnmasking::new(
        Mode::Seedshift,
        Some(five),
        None,
        LIMITS,
    ))?;
    expect_same(
        unmasked(&too_many, sets)?.as_str(),
        "12-word phrases support at most 4 dates.",
        "Shares unmasked with five dates",
    )?;
    let marked = masked_sets(true)?;
    expect_same(
        &marked.len(),
        &1,
        "Marked shares of the masked phrase: phrases",
    )?;
    expect_same(
        unmasked(&forgotten_digit, marked)?.as_str(),
        at_date.as_str(),
        "Marked shares unmasked with a forgotten digit",
    )
}
