//! The word search row (MnemoCode TS 0.1.0's `core/candidates-self-test.ts`): the candidates of
//! several marked places, a prefix with * and words joined by |, in their fixed order and with
//! their entropy; the searches refused; a word missing at an unknown place; and a search run with
//! the wallet. Public data only.

use std::rc::Rc;

use super::recovery::{public_wallet, ran};
use super::{Row, ok};
use crate::recovery::places::WordSearch;
use crate::recovery::wallet_check::WalletCheck;
use crate::recovery::word_search::{WordCandidateSearch, WordLimits, WordSearchError};
use crate::self_check::vectors::PUBLIC_MNEMONIC;
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};
use crate::text::hex::hex_of_bytes;

/// The word search row.
pub(super) const ROW: Row = Row::new(
    "Word search",
    "several words, prefixes, choices, missing word; wallet",
    word_search,
);

/// Which search a text asks for.
#[derive(Clone, Copy)]
enum WordKind {
    Unknown,
    Missing,
}

/// One search and what it finds: candidate N is the same in every host.
struct WordCase {
    text: String,
    kind: WordKind,
    combinations: u64,
    count: u64,
    /// Candidates by their number, from 1: the phrase, and for some the entropy.
    candidates: Vec<(usize, String, Option<&'static str>)>,
}

/// The first `count` words of the public phrase, "abandon" each, for a count up to eleven.
fn public_words(count: usize) -> String {
    let words: Vec<&str> = PUBLIC_MNEMONIC.split(' ').take(count).collect();
    words.join(" ")
}

/// A prefix and words joined by |, with the entropy of each candidate.
fn prefix_and_choice() -> WordCase {
    let nine = public_words(9);
    WordCase {
        text: format!("abandon ab* {nine} zoo|zone|about|abandon"),
        kind: WordKind::Unknown,
        combinations: 40,
        count: 3,
        candidates: vec![
            (
                1,
                PUBLIC_MNEMONIC.to_owned(),
                Some("00000000000000000000000000000000"),
            ),
            (
                2,
                format!("abandon ability {nine} about"),
                Some("00000400000000000000000000000000"),
            ),
            (
                3,
                format!("abandon above {nine} about"),
                Some("00001000000000000000000000000000"),
            ),
        ],
    }
}

/// A word forgotten in the middle.
fn word_in_the_middle() -> WordCase {
    let phrase = |word: &str| {
        format!("legal winner thank year {word} sausage worth useful legal winner thank yellow")
    };
    WordCase {
        text: phrase("?"),
        kind: WordKind::Unknown,
        combinations: 2_048,
        count: 130,
        candidates: vec![
            (1, phrase("act"), None),
            (2, phrase("actor"), None),
            (130, phrase("winter"), None),
        ],
    }
}

/// A word missing among repeated words.
fn missing_among_repeated() -> WordCase {
    let ten = public_words(10);
    WordCase {
        text: format!("{ten} about"),
        kind: WordKind::Missing,
        combinations: 24_576,
        count: 1_497,
        candidates: vec![
            (1, PUBLIC_MNEMONIC.to_owned(), None),
            (2, format!("abstract {ten} about"), None),
            (1_497, format!("{ten} about zoo"), None),
        ],
    }
}

/// BIP39's vector of entropy 8080…80 in 24 words, with its 10th word left out.
fn missing_of_24() -> WordCase {
    const LETTER: &str = "letter advice cage absurd amount doctor acoustic avoid";
    const AFTER_GAP: &str = "letter cage absurd amount doctor acoustic avoid";
    const LETTER_SHORT: &str = "letter advice cage absurd amount doctor acoustic";
    let middle = format!("{LETTER} {AFTER_GAP} {LETTER_SHORT} bless");
    WordCase {
        text: middle.clone(),
        kind: WordKind::Missing,
        combinations: 49_152,
        count: 186,
        candidates: vec![
            (1, format!("base {middle}"), None),
            (2, format!("dream {middle}"), None),
            (186, format!("{middle} unable"), None),
        ],
    }
}

/// The search of `text`, as `kind` reads it.
fn word_search_of(
    text: &str,
    kind: WordKind,
    wallet: Option<Rc<WalletCheck>>,
    limits: WordLimits,
) -> Result<WordCandidateSearch, WordSearchError> {
    let search = match kind {
        WordKind::Unknown => WordSearch::unknown_words(text),
        WordKind::Missing => WordSearch::missing_word(text),
    };
    WordCandidateSearch::new(search.map_err(WordSearchError::Place)?, wallet, limits)
}

/// The combinations, the candidate count and the numbered candidates of `case`.
fn check_words(case: &WordCase) -> Result<(), CheckFailure> {
    let limits = WordLimits {
        max_shown: Some(case.count),
        keep: Some(case.count),
        stop_when_full: false,
    };
    let search = ok(word_search_of(&case.text, case.kind, None, limits))?;
    expect_same(
        &search.combinations(),
        &case.combinations,
        "Word search combinations",
    )?;
    let outcome = ran(search)?;
    expect_same(&outcome.count, &case.count, "Word search candidate count")?;
    for (number, phrase, entropy) in &case.candidates {
        let shown = outcome
            .shown
            .get(number - 1)
            .ok_or(CheckFailure::Mismatch("Word search candidate"))?;
        let found = ok(shown.candidate.phrase())?;
        expect_same(
            found.text().as_str(),
            phrase.as_str(),
            "Word search candidate",
        )?;
        if let Some(entropy) = entropy {
            let held = outcome
                .entropies
                .chunks(entropy.len() / 2)
                .nth(number - 1)
                .map(hex_of_bytes);
            expect_same(&held.as_deref(), &Some(*entropy), "Word search entropy")?;
        }
    }
    Ok(())
}

/// The word search row.
fn word_search(tier: Tier) -> Result<(), CheckFailure> {
    check_words(&prefix_and_choice())?;
    check_words(&word_in_the_middle())?;
    let ten = public_words(10);
    let refused = [
        (
            format!("{} zzz", public_words(11)),
            "core.candidates.unknown-english-bip39-word-at",
        ),
        (
            PUBLIC_MNEMONIC.to_owned(),
            "core.candidates.mark-each-forgotten-word-prefix-b",
        ),
        (
            format!("xyz* {ten} ?"),
            "core.candidates.no-bip39-word-starts-letters-at",
        ),
        // 2^33 combinations, beyond the 2^24 of one search.
        (
            format!("? ? ? {}", public_words(9)),
            "core.candidates.search-more-than-combinations",
        ),
    ];
    for (text, code) in &refused {
        expect_refused(
            word_search_of(text, WordKind::Unknown, None, WordLimits::default()),
            code,
            "A refused word search",
        )?;
    }
    if tier == Tier::Startup {
        return Ok(());
    }
    check_words(&missing_among_repeated())?;
    check_words(&missing_of_24())?;
    let case = prefix_and_choice();
    let limits = WordLimits {
        max_shown: None,
        keep: Some(case.count),
        stop_when_full: false,
    };
    let wallet = Some(Rc::new(public_wallet()?));
    let outcome = ran(ok(word_search_of(&case.text, case.kind, wallet, limits))?)?;
    expect_same(&outcome.count, &case.count, "Word search run count")?;
    expect_same(&outcome.matched, &1, "Word search wallet matches")?;
    expect_same(
        &outcome
            .shown
            .first()
            .and_then(|shown| shown.answer.as_ref())
            .map(|answer| answer.matched),
        &Some(true),
        "Word search match of the public phrase",
    )?;
    let wanted: Vec<&str> = case.candidates.iter().filter_map(|each| each.2).collect();
    expect_same(
        &hex_of_bytes(&outcome.entropies),
        &wanted.concat(),
        "Word search entropies for a list",
    )
}
