//! The rows of Shamir shares (MnemoCode TS 0.1.0's `src/sskr/known-answers.ts`,
//! `repair-self-test.ts`, `split-self-test.ts` and `share-restore-self-test.ts`): SSKR integrity,
//! the official BCR-2020-011 vector and a set of the longest secret restored, shares made with a
//! public test-only seed restored by every two, the forms and the refusals of a set; Share repair,
//! marked elements filled in from one share and from shares together; and Share split and restore,
//! the published phrase and a masked backup split and restored. No published vector gives the
//! shares of a seeded split, so none is compared with them (CORE-27). Public data only.

use super::{Row, hint_text, ok};
use crate::bip39::phrase::Phrase;
use crate::dates::parse_date;
use crate::forms::hints::WordHints;
use crate::modes::Mode;
use crate::random::{Random, RandomError};
use crate::self_check::vectors::{
    FIRST_SHARE_COLORS as FIRST_COLORS, FIRST_SHARE_UNICODE as FIRST_UNICODE, LONG_SHARES,
    OFFICIAL_SHARES,
};
use crate::self_check::vectors::{MASKED_DATE, MASKED_ENGLISH, PUBLIC_MNEMONIC};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};
use crate::sskr::engine::{Group, combine, split_seeded};
use crate::sskr::forms::{ShareFormat, read_share};
use crate::sskr::joint::plan_joint_repair;
use crate::sskr::repair::read_repairable_share;
use crate::sskr::restore::ShareSet;
use crate::sskr::set::read_set;
use crate::sskr::share::Share;
use crate::sskr::split::{split, split_backup};
use crate::sskr::text::standard_bytewords;
use crate::sskr::typed::{CompleteOutcome, ShareInput, TroubleKind, share_word_hints};
use crate::text::hex::{bytes_of_hex, hex_of_bytes};

/// The secret that the official shares restore.
pub(crate) const OFFICIAL_ENTROPY: &str = "7daa851251002874e1a1995f0897e6b1";
/// Its first share in colors, word numbers and Unicode codes, computed independently, and its
/// published Bytewords.
const FIRST_NUMBERS: &str =
    "527 288 1158 1328 5 1544 734 1605 1692 1812 710 1654 2045 598 582 241 365 1779 1467 551 897";
const FIRST_BYTEWORDS: &str = "tuna next keep gyro gear runs body acid able film nail barn cost aqua epic veto quad fern jump buzz epic slot frog apex taxi grim fern twin leaf";
/// A set of one group, two of three, from the entropy 000102…0f (vectors/sskr-v1.json,
/// "bip39-128-2-of-3"), the colors of its first two shares and the phrase of its entropy.
pub(crate) const SET_SHARES: [&str; 3] = [
    "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf",
    "ur:sskr/goemjzaeadadflihpkmhspcheycndschfhcmkelyvaveiesolrls",
    "ur:sskr/goemjzaeadaockjsrlamsebalrbysbjngeeysnplutlywdfytpwe",
];
pub(super) const SET_COLORS: [&str; 2] = [
    "#8B0C06 #B0D4F5 #0CF800 #FA41D6 #37B8CA #1F9121 #DB206C #4FD8A1 #1BF322 #750000",
    "#64C984 #835170 #897D85 #7FC452 #853144 #E8135A #C542B2 #158738 #F19A47 #D30000",
];
pub(crate) const SET_ENTROPY: &str = "000102030405060708090a0b0c0d0e0f";
pub(super) const SET_PHRASE: &str =
    "abandon amount liar amount expire adjust cage candy arch gather drum buyer";
/// The public test-only seed of the engine's regression vector, and another, never randomness.
pub(crate) const TEST_SEED: &str =
    "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0";
const OTHER_TEST_SEED: &str = "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100";
pub(crate) const LONG_ENTROPY: &str =
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

/// The SSKR integrity row.
pub(super) const INTEGRITY: Row = Row::new(
    "SSKR integrity",
    "official and 32-byte recovery, created shares restored, transport and refusals",
    integrity,
);

/// The share repair row.
pub(super) const REPAIR: Row = Row::new(
    "Share repair",
    "whole and digit marks, refusals; shares together",
    repair,
);

/// The share split and restore row, in the full self-test.
pub(super) const SPLIT: Row = Row::new(
    "Share split and restore",
    "published split, masked backup, marked restore; refusals",
    split_and_restore,
);

/// A public test-only seed in place of randomness.
pub(super) struct FixedSeed(pub(super) &'static str);

impl Random for FixedSeed {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        let seed = bytes_of_hex(self.0).map_err(|_| RandomError::Unavailable)?;
        for (byte, value) in bytes.iter_mut().zip(seed.iter().cycle()) {
            *byte = *value;
        }
        Ok(())
    }
}

/// The share of `text`, which a known answer holds.
fn share(text: &str) -> Result<Share, CheckFailure> {
    Ok(ok(read_share(text))?.share)
}

/// The secret the engine restores from `payloads`, as hexadecimal digits.
fn restored(payloads: &[&[u8]]) -> Result<String, CheckFailure> {
    Ok(hex_of_bytes(&ok(combine(payloads))?))
}

/// The payloads of `texts`.
fn payloads(texts: &[&str]) -> Result<Vec<Vec<u8>>, CheckFailure> {
    texts
        .iter()
        .map(|text| Ok(share(text)?.payload().to_vec()))
        .collect()
}

/// Every two of `items`, each pair once, in order.
fn pairs<T: Copy>(items: &[T]) -> Vec<[T; 2]> {
    items
        .iter()
        .enumerate()
        .flat_map(|(place, &first)| {
            items[place + 1..]
                .iter()
                .map(move |&second| [first, second])
        })
        .collect()
}

/// The forms of a share, a set and its refusals: no engine is used.
fn transport() -> Result<(), CheckFailure> {
    let first = share(OFFICIAL_SHARES[0])?;
    expect_same(
        standard_bytewords(first.payload()).as_str(),
        FIRST_BYTEWORDS,
        "SSKR published Bytewords",
    )?;
    expect_same(
        share(&FIRST_BYTEWORDS.replace(' ', ""))?.payload(),
        first.payload(),
        "SSKR Bytewords run together",
    )?;
    expect_same(
        &ok(read_set(&OFFICIAL_SHARES, true))?.len(),
        &5,
        "SSKR official grouped quorum",
    )?;
    let not_enough = "sskr.transport.not-enough-sskr-shares-meet-recorded-threshold";
    expect_refused(
        read_set(&OFFICIAL_SHARES[..2], true),
        not_enough,
        "SSKR one complete group",
    )?;
    expect_refused(
        read_set(&OFFICIAL_SHARES[..4], true),
        not_enough,
        "SSKR underfilled second group",
    )?;
    let mut twice = OFFICIAL_SHARES.to_vec();
    twice.push(OFFICIAL_SHARES[0]);
    expect_refused(
        read_set(&twice, true),
        "sskr.transport.member-given-twice",
        "SSKR duplicate member",
    )?;
    expect_refused(
        read_set(&[OFFICIAL_SHARES[0], SET_SHARES[0]], true),
        "sskr.transport.shares-of-different-sets",
        "SSKR mixed sets",
    )?;
    // ae is a valid pair, but in place of the published checksum's last pair it damages it.
    let damaged = format!("{}ae", &OFFICIAL_SHARES[0][..OFFICIAL_SHARES[0].len() - 2]);
    expect_refused(
        read_share(&damaged),
        "sskr.transport.sskr-transport-checksum-does-not-match",
        "SSKR damaged transport checksum",
    )
}

/// The engine's refusal of a combination of `payloads`.
fn expect_engine_refuses(payloads: &[&[u8]], name: &'static str) -> Result<(), CheckFailure> {
    expect_refused(combine(payloads), "sskr.engine.combine", name)
}

/// Every case at both tiers, since no share command and no page asks the engine for known answers
/// of its own, as TS does before a split or a restore (CORE-27).
fn integrity(_: Tier) -> Result<(), CheckFailure> {
    transport()?;
    let first = share(OFFICIAL_SHARES[0])?;
    expect_same(
        ShareFormat::Colors.write(&first).as_str(),
        FIRST_COLORS,
        "SSKR color known answer",
    )?;
    for text in OFFICIAL_SHARES {
        let official = share(text)?;
        let colors = ShareFormat::Colors.write(&official);
        expect_same(
            share(colors.as_str())?.payload(),
            official.payload(),
            "SSKR color round trip",
        )?;
    }
    let official = payloads(&OFFICIAL_SHARES)?;
    let all: Vec<&[u8]> = official.iter().map(Vec::as_slice).collect();
    expect_same(restored(&all)?.as_str(), OFFICIAL_ENTROPY, "SSKR recovery")?;
    let long = payloads(&LONG_SHARES)?;
    let both: Vec<&[u8]> = long.iter().map(Vec::as_slice).collect();
    expect_same(
        restored(&both)?.as_str(),
        LONG_ENTROPY,
        "SSKR 32-byte recovery",
    )?;
    let secret = ok(bytes_of_hex(SET_ENTROPY))?;
    let group = [Group {
        threshold: 2,
        count: 3,
    }];
    let created = ok(split_seeded(
        &secret,
        1,
        &group,
        &ok(bytes_of_hex(TEST_SEED))?,
    ))?;
    expect_same(&created.len(), &3, "SSKR creation share count")?;
    let made: Vec<&[u8]> = created.iter().map(|share| &share[..]).collect();
    for pair in pairs(&made) {
        expect_same(restored(&pair)?.as_str(), SET_ENTROPY, "SSKR creation")?;
    }
    let reseeded = ok(split_seeded(
        &secret,
        1,
        &group,
        &ok(bytes_of_hex(OTHER_TEST_SEED))?,
    ))?;
    expect_same(
        &reseeded
            .iter()
            .any(|again| made.iter().any(|share| *share == &again[..])),
        &false,
        "SSKR creation with another seed",
    )?;
    expect_engine_refuses(&all[..4], "SSKR engine incomplete quorum")?;
    let mut changed = official[0].clone();
    // Inside the value of this fixed official share, past its metadata.
    changed[7] ^= 1;
    let mut damaged: Vec<&[u8]> = vec![&changed];
    damaged.extend_from_slice(&all[1..]);
    expect_engine_refuses(&damaged, "SSKR engine damaged value")?;
    // Group 1 of a set of one group: the share reader refuses it, so the engine is asked directly.
    let impossible: Vec<Vec<u8>> = payloads(&SET_SHARES[..2])?
        .into_iter()
        .map(|mut payload| {
            payload[3] = (payload[3] & 0x0f) | 0x10;
            payload
        })
        .collect();
    let grouped: Vec<&[u8]> = impossible.iter().map(Vec::as_slice).collect();
    expect_engine_refuses(&grouped, "SSKR engine impossible group index")
}

/// The Word hints row's cases of a share being typed, in Bytewords and in colors.
pub(super) fn share_hints() -> Result<(), CheckFailure> {
    let hints = share_word_hints();
    for (line, expected, name) in [
        (
            "tuna acid; ta",
            "words taco task taxi",
            "Bytewords of a share",
        ),
        (
            "q",
            "count 2 Bytewords begin with this letter",
            "Count of Bytewords",
        ),
        // Run together they are read four letters at a time, the last begun one being typed.
        ("tuna acid tunaac", "words acid", "Bytewords run together"),
        ("#1A2B3C AB", "nothing", "Share in colors"),
    ] {
        expect_same(hint_text(&hints.hint(line)).as_str(), expected, name)?;
    }
    Ok(())
}

/// `text` with the element written `element` marked as `mark`.
fn marked(text: &str, element: &str, mark: &str) -> String {
    text.replacen(element, mark, 1)
}

/// Checks that `text` is repaired into `ur`, its marked elements filled in as `filled` says.
fn check_repair(
    text: &str,
    ur: &str,
    filled: &str,
    name: &'static str,
) -> Result<(), CheckFailure> {
    let repaired = ok(read_repairable_share(text))?;
    expect_same(repaired.share.payload(), share(ur)?.payload(), name)?;
    let elements: Vec<String> = repaired
        .filled
        .iter()
        .map(|element| format!("{}:{}", element.position, element.value.as_str()))
        .collect();
    expect_same(elements.join(" ").as_str(), filled, name)
}

/// The quick cases: one share repaired from whole and digit marks, and marks refused.
fn repair_startup() -> Result<(), CheckFailure> {
    check_repair(
        &format!("{} #000000", marked(SET_COLORS[0], "#1F9121", "?")),
        SET_SHARES[0],
        "6:#1F9121",
        "Marked share before a trailing decoy",
    )?;
    check_repair(
        &marked(&marked(FIRST_COLORS, "#EE44D3", "?"), "#E75FF8", "#E7?FF?"),
        OFFICIAL_SHARES[0],
        "4:#EE44D3 6:#E75FF8",
        "Colors with a whole color and two digits marked",
    )?;
    check_repair(
        &marked(&marked(FIRST_UNICODE, "7642", "7?42"), "77FD", "?"),
        OFFICIAL_SHARES[0],
        "6:7642 12:77FD",
        "Unicode codes with a digit and a whole code marked",
    )?;
    // A digit of the low code of the second color and the first digit of the high code of the
    // sixth, written apart: each color is filled in as its two codes.
    let codes = ShareFormat::ColorsUnicode.write(&share(OFFICIAL_SHARES[0])?);
    let digits: Vec<String> = codes
        .as_str()
        .as_bytes()
        .chunks(4)
        .enumerate()
        .map(|(place, code)| {
            let code = String::from_utf8_lossy(code);
            match place {
                3 => format!("{}?{}", &code[..2], &code[3..]),
                10 => format!("?{}", &code[1..]),
                _ => code.into_owned(),
            }
        })
        .collect();
    check_repair(
        &digits.join(" "),
        OFFICIAL_SHARES[0],
        // #42D1F0 and #E75FF8 as Color Unicode, computed apart from the code under test.
        "2:E2ACE5F0 6:E941E6F8",
        "Color Unicode codes with two digits marked",
    )?;
    expect_refused(
        read_repairable_share(&marked(
            &marked(FIRST_COLORS, "#42D1F0", "?"),
            "#0981D6",
            "#0981D7",
        )),
        "sskr.repair.no-share-fits-marks",
        "A marked share with an unmarked error",
    )?;
    let seven: Vec<&str> = FIRST_COLORS
        .split(' ')
        .enumerate()
        .map(|(place, color)| if place < 7 { "?" } else { color })
        .collect();
    expect_refused(
        read_repairable_share(&seven.join(" ")),
        "sskr.repair.each-at-place",
        "A share with seven marks",
    )?;
    expect_refused(
        read_repairable_share(&marked(FIRST_NUMBERS, "288", "2?8")),
        "sskr.repair.repair-candidates-refused",
        "A ? for a digit of a word number",
    )
}

fn repair(tier: Tier) -> Result<(), CheckFailure> {
    repair_startup()?;
    if tier == Tier::Startup {
        return Ok(());
    }
    let records = [
        marked(&marked(SET_COLORS[0], "#0CF800", "?"), "#4FD8A1", "?"),
        marked(SET_COLORS[1], "#E8135A", "#E81?5A"),
    ];
    let plan = ok(plan_joint_repair(&records, None))?;
    let found = match plan.search() {
        Some(search) => ok(search.run())?.sets,
        None => Vec::new(),
    };
    expect_same(&found.len(), &1, "Shares repaired together: phrases")?;
    expect_same(
        found[0].phrase().text().as_str(),
        SET_PHRASE,
        "Shares repaired together: phrase",
    )?;
    for (repaired, ur) in found[0].shares().iter().zip(SET_SHARES) {
        expect_same(
            repaired.share.payload(),
            share(ur)?.payload(),
            "Shares repaired together: shares",
        )?;
    }
    let unread = vec!["?"; SET_COLORS[0].split(' ').count()].join(" ");
    let set = ok(ShareSet::combine(
        &[SET_SHARES[1], SET_SHARES[2], unread.as_str()],
        None,
    ))?;
    expect_same(
        set.phrase().text().as_str(),
        SET_PHRASE,
        "A share of which nothing was read: phrase",
    )?;
    expect_same(
        set.shares()[2].share.payload(),
        share(SET_SHARES[0])?.payload(),
        "A share of which nothing was read: share",
    )?;
    let wrong = marked(&marked(SET_COLORS[0], "#0CF800", "?"), "#1F9121", "#1F9122");
    expect_refused(
        ShareSet::combine(&[wrong.as_str(), SET_COLORS[1]], None),
        "sskr.share-set.share-unreadable",
        "Shares with an unmarked error",
    )
}

fn split_and_restore(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    let phrase = ok(Phrase::parse(SET_PHRASE))?;
    let shares = ok(split(&phrase, 2, 3, &mut FixedSeed(TEST_SEED)))?;
    let urs: Vec<String> = shares
        .iter()
        .map(|share| share.ur().as_str().to_owned())
        .collect();
    let texts: Vec<&str> = urs.iter().map(String::as_str).collect();
    for pair in pairs(&texts) {
        let set = ok(ShareSet::restore(&pair, None))?;
        expect_same(
            set.phrase().text().as_str(),
            SET_PHRASE,
            "Split restored by every two shares",
        )?;
    }
    let reseeded = ok(split(&phrase, 2, 3, &mut FixedSeed(OTHER_TEST_SEED)))?;
    expect_same(
        &reseeded.iter().any(|again| {
            shares
                .iter()
                .any(|share| share.payload() == again.payload())
        }),
        &false,
        "Split with another seed",
    )?;
    let public = ok(Phrase::parse(PUBLIC_MNEMONIC))?;
    let date = ok(parse_date(MASKED_DATE))?;
    let backup = ok(split_backup(
        &public,
        Mode::Seedshift,
        &[date],
        2,
        3,
        &mut FixedSeed(TEST_SEED),
    ))?;
    expect_same(
        backup.held.text().as_str(),
        MASKED_ENGLISH,
        "Split of a masked backup: the phrase held",
    )?;
    let held: Vec<String> = backup.shares[1..]
        .iter()
        .map(|share| share.ur().as_str().to_owned())
        .collect();
    let set = ok(ShareSet::restore(&held, None))?;
    expect_same(
        set.phrase().text().as_str(),
        MASKED_ENGLISH,
        "Split of a masked backup restored",
    )?;
    expect_refused(
        split(&public, 1, 3, &mut FixedSeed(TEST_SEED)),
        "sskr.split.split-threshold-from-number-shares-at-most-shares",
        "A split with a threshold of 1",
    )?;
    // Shares as typed: the second as colors, its sixth unread, repaired and restored.
    let second = marked(SET_COLORS[1], "#E8135A", "?");
    let set = ok(ShareSet::combine(&[SET_SHARES[0], second.as_str()], None))?;
    expect_same(
        set.phrase().text().as_str(),
        SET_PHRASE,
        "Shares restored: phrase",
    )?;
    let mut one = ShareInput::new("Decode");
    ok(one.add(&[SET_SHARES[0]]))?;
    let outcome = ok(one.restore_complete())?.0;
    expect_same(
        &matches!(outcome, CompleteOutcome::Trouble(ref trouble) if trouble.kind == TroubleKind::Few),
        &true,
        "One share of two",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::self_check::Check;
    use crate::sskr::testing::vectors;

    #[test]
    fn the_compiled_vectors_are_the_published_ones() {
        let vectors = vectors();
        let official = &vectors["official"];
        let shares: Vec<&str> = official["shares"]
            .as_array()
            .unwrap()
            .iter()
            .map(|share| share.as_str().unwrap())
            .collect();
        // A quorum of the published shares: two of the first group and three of the second.
        assert!(OFFICIAL_SHARES.iter().all(|ur| shares.contains(ur)));
        assert_eq!(official["entropy"].as_str().unwrap(), OFFICIAL_ENTROPY);
        let set = &vectors["deterministic"][0];
        assert_eq!(set["testOnlySeed"].as_str().unwrap(), TEST_SEED);
        assert_eq!(set["entropy"].as_str().unwrap(), SET_ENTROPY);
        for (index, ur) in SET_SHARES.iter().enumerate() {
            assert_eq!(set["shares"][index].as_str().unwrap(), *ur);
        }
        let long = &vectors["deterministic"][4];
        assert_eq!(long["entropy"].as_str().unwrap(), LONG_ENTROPY);
        for (index, ur) in LONG_SHARES.iter().enumerate() {
            assert_eq!(long["shares"][index].as_str().unwrap(), *ur);
        }
    }

    #[test]
    fn every_row_passes_in_full() {
        for row in [INTEGRITY, REPAIR, SPLIT] {
            row.run(Tier::Full).unwrap();
            row.run(Tier::Startup).unwrap();
        }
    }
}
