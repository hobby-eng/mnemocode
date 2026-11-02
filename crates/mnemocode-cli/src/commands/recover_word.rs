//! `mnemocode recover-word` (MnemoCode TS 0.1.0's `cli/recover-word-command.ts`,
//! CAP-RECOVERY-WORD-SEARCH-RUN, CAP-RECOVERY-LEGACY-LAST-WORDS): finds forgotten or missing words
//! of a seed phrase, or the checksum-valid last words of an exact legacy Seedshift phrase; each
//! candidate is compared with the wallet and shown. From the command line a problem ends the
//! command. With --ask-secrets, on the private screen, the phrase is checked as soon as it is typed,
//! before the list's passphrase is asked, and asked again; a search without a usable result, or with
//! more candidates than the window holds as one row each, offers what to change, keeping the list,
//! its protection and its passphrase. Candidates that the window does not hold are offered a wallet
//! check on the private screen also when a file gave the words, and, where no list was given, a list
//! for the Discovery Scanner.

use std::fmt;

use mnemocode::bip39::phrase::{Phrase, legacy_valid_last_words};
use mnemocode::bip39::sizes::entropy_bytes;
use mnemocode::bip39::table::english;
use mnemocode::candidates::format::{
    ListError, MAX_CANDIDATE_RECORDS, TOO_MANY_FOR_LIST, candidate_list_holds,
    check_list_passphrase,
};
use mnemocode::forms::hints::BIP39;
use mnemocode::recovery::places::{NARROW_WORD_SEARCH, WordSearch};
use mnemocode::recovery::reading::BackupReading;
use mnemocode::recovery::word_search::{
    MAX_SHOWN_CANDIDATES, ShownCandidate, WordCandidateSearch, WordLimits, WordSearchOutcome,
    unshown_candidates_notice,
};
use mnemocode::refusal::Refusal;
use mnemocode::search::Search;
use mnemocode::search::plan::counting;
use mnemocode::secret::{SecretBytes, SecretText};
use mnemocode::wallet::evidence::{Place, WalletMatch};

use super::asking::{AfterFailure, WHAT_NOW, after_failure, secret_until};
use super::candidates_file::{CandidatesFile, ask_candidate_list, stop_without_list_answer};
use super::found::{candidate_label, candidate_lines, matched_at, matched_on_terminal};
use super::given::{PATTERN_LIMIT, PHRASE_SECRET_OPTIONS, text_input};
use super::searching::run_search;
use super::wallet_options::{AskedEvidence, GivenWallet, given_wallet, wallet_option_given};
use super::wallet_question::{
    WalletAnswer, ask_wallet_evidence, change_wallet_answer, check_wallet_answer,
};
use crate::args::{self, Parsed, assert_asked_not_given, is_on};
use crate::gate::Stop;
use crate::input::{Ask, secret_ask};
use crate::output::{preflight, warn_of_cloud_copies};
use crate::terminal::result::{ResultNote, note_lines, print, print_note, result_header};
use crate::terminal::{
    CLOSING_ROWS, Channel, Choice, ListQuestion, NoticeKind, ProgressLine, SEARCH_PROGRESS_SECONDS,
    can_redraw, leave_result, list_rows, notice, on_private_screen, output_rows, result_lines,
    rows, rows_of, step_begin, terminal_available,
};

/// The options `recover-word` takes.
pub(crate) const OPTIONS: [&str; 25] = [
    "mnemonic",
    "mnemonic-file",
    "legacy-valid-last-word",
    "missing-word",
    "ask-secrets",
    "candidates-file",
    "candidates-key",
    "candidates-key-file",
    "candidates-passphrase-file",
    "plaintext-candidates",
    "bitcoin-address",
    "coin-address",
    "master-xpub",
    "account-xpub",
    "compressed-public-key",
    "master-fingerprint",
    "wif-file",
    "coin",
    "network",
    "account",
    "branch",
    "index",
    "bitcoin-profile",
    "scan-gap",
    "bip39-passphrase-file",
];

/// The title of the result.
const TITLE: &str = "Missing word recovery";
/// Combinations between two looks at the progress.
const PROGRESS_EVERY: u32 = 4096;
/// Why codes cannot be searched where the words of a seed phrase are, and where they can.
const CODES_NOT_WORDS: &str = "These are the codes of an encoded seed phrase, not its words: Decode numbers, codes or colors back into a seed phrase reads them, with ? for each unread code.";

/// A column of the candidates: its heading in the rows for a script, its label on a terminal.
type Column = (&'static str, &'static str);

const POSITION: Column = ("position", "Position");
const WORD: Column = ("word", "Word");
const WORD_NUMBER: Column = ("word-index", "Word number");
const CHECKSUM_BITS: Column = ("checksum-bits", "Checksum bits");
const LEGACY_TAIL: Column = ("legacy-tail", "Old word's data");
const WORDS: Column = ("words", "Words");
const WALLET: Column = ("evidence", "Wallet");
const PHRASE: Column = ("mnemonic", "Phrase");

/// The refusals of the command.
#[derive(Debug)]
enum RecoverWordError {
    /// Codes where words are searched.
    CodesNotWords,
    /// Two kinds of search asked for.
    LegacyAndMissing,
    /// A candidate list of replacements, which are no wallets.
    LegacyList,
}

impl fmt::Display for RecoverWordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::CodesNotWords => CODES_NOT_WORDS,
            Self::LegacyAndMissing => {
                "--legacy-valid-last-word and --missing-word cannot be combined."
            }
            Self::LegacyList => {
                "--legacy-valid-last-word lists replacements, not wallets: no candidate list."
            }
        })
    }
}

impl std::error::Error for RecoverWordError {}

impl Refusal for RecoverWordError {
    fn code(&self) -> &'static str {
        match self {
            Self::CodesNotWords => "cli.recover-word-command.codes-not-words",
            Self::LegacyAndMissing => {
                "cli.recover-word-command.legacy-valid-last-word-missing-word-cannot-combined"
            }
            Self::LegacyList => {
                "cli.recover-word-command.legacy-valid-last-word-lists-replacements-not-wallets"
            }
        }
    }
}

/// A shown candidate: its values in the columns of its kind of search, its phrase, its number from
/// 1, and what the wallet check said.
struct Row {
    columns: Vec<String>,
    phrase: SecretText,
    number: u64,
    answer: Option<WalletMatch>,
}

impl Row {
    /// Its values, then what the wallet check said, where there was one, and the phrase: a match
    /// in a person's words on a terminal, with its path for a script.
    fn fields(&self, wallet: &GivenWallet, terminal: bool) -> Vec<String> {
        let mut fields = self.columns.clone();
        if let Some(answer) = &self.answer {
            let path = answer.path.as_deref();
            fields.push(match (answer.matched, terminal) {
                (false, _) => "not matched".to_owned(),
                (true, true) => matched_on_terminal(path, wallet.fingerprint),
                (true, false) => matched_at(path),
            });
        }
        fields.push(self.phrase.as_str().to_owned());
        fields
    }
}

/// What a search found, in the terms of the table that shows it.
struct Found {
    /// The facts of the heading that name what was searched.
    facts: Vec<(&'static str, String)>,
    /// The columns of the kind of search.
    columns: Vec<Column>,
    /// The note that says what the candidates are.
    about: &'static str,
    /// What the wallet was compared with, where it is not the phrase typed.
    compared_with: Option<&'static str>,
    rows: Vec<Row>,
    /// The entropy of every candidate for a list, record N for candidate N, with its length.
    entropies: Option<(SecretBytes, usize)>,
    count: u64,
    matched: u64,
    warning: Option<&'static str>,
}

/// The word at `index`, and its number from 1.
fn word_columns(index: u16) -> [String; 2] {
    let index = usize::from(index);
    [english()[index].to_owned(), (index + 1).to_string()]
}

/// The candidates of a legacy last word: a short fixed list, each compared with the wallet.
fn legacy_replacements(text: &str, wallet: &GivenWallet) -> Result<Found, Stop> {
    let replacements = legacy_valid_last_words(text)?;
    let preserving = replacements
        .iter()
        .find(|candidate| candidate.preserves_entropy);
    let position = replacements.first().map_or(0, |first| first.phrase.len());
    let (mut rows, mut matched, mut warning) = (Vec::new(), 0, None);
    for (place, candidate) in replacements.iter().enumerate() {
        let phrase = &candidate.phrase;
        let answer = wallet
            .check
            .as_ref()
            .map(|check| check.check(phrase))
            .transpose()?;
        matched += u64::from(answer.as_ref().is_some_and(|answer| answer.matched));
        warning = warning.or(answer.as_ref().and_then(|answer| answer.warning));
        let [word, number] = word_columns(candidate.index as u16);
        let kept = if candidate.preserves_entropy {
            "preserved"
        } else {
            "alternative"
        };
        rows.push(Row {
            columns: vec![word, number, last_word_bits(phrase), kept.to_owned()],
            phrase: phrase.text(),
            number: place as u64 + 1,
            answer,
        });
    }
    Ok(Found {
        facts: vec![
            ("Mode", "Legacy final-word replacement".to_owned()),
            ("Position", position.to_string()),
            (
                "Entropy-preserving replacement",
                preserving.map_or("unavailable".to_owned(), |candidate| {
                    english()[candidate.index].to_owned()
                }),
            ),
        ],
        columns: vec![WORD, WORD_NUMBER, CHECKSUM_BITS, LEGACY_TAIL],
        about: "All checksum-valid last words; the candidate marked preserved keeps the old word's data.",
        compared_with: Some(
            "Evidence was compared with the replacements, not with the original legacy phrases.",
        ),
        count: rows.len() as u64,
        rows,
        entropies: None,
        matched,
        warning,
    })
}

/// The checksum bits of the last word of `phrase`.
fn last_word_bits(phrase: &Phrase) -> String {
    let indexes: Vec<u16> = (0..phrase.len())
        .filter_map(|place| phrase.index(place))
        .map(|index| index as u16)
        .collect();
    mnemocode::recovery::places::last_word_checksum_bits(&indexes)
}

/// The columns and facts of a search with the places `unknown`, and the values of a candidate.
fn row_of(shown: &ShownCandidate, unknown: &[usize]) -> Result<Row, Stop> {
    let words = shown.candidate.words();
    let columns = match unknown {
        [] => {
            let place = shown.places.first().copied().unwrap_or(0);
            let mut columns = vec![(place + 1).to_string()];
            columns.extend(word_columns(words[place]));
            columns
        }
        [place] => {
            let mut columns = word_columns(words[*place]).to_vec();
            columns.push(shown.candidate.checksum_bits());
            columns
        }
        places => {
            let named: Vec<String> = places
                .iter()
                .map(|place| format!("{}:{}", place + 1, english()[usize::from(words[*place])]))
                .collect();
            vec![named.join(" ")]
        }
    };
    Ok(Row {
        columns,
        phrase: shown.candidate.phrase()?.text(),
        number: shown.candidate.number(),
        answer: shown.answer.clone(),
    })
}

/// How the phrase is read: the options that say what it holds.
#[derive(Clone, Copy)]
struct PhraseRules {
    legacy: bool,
    missing: bool,
}

/// What a phrase asks for: the replacements of a legacy last word, or a search of words.
struct PhraseSearch {
    /// The phrase as typed.
    text: SecretText,
    rules: PhraseRules,
}

/// The words of `text` as a search of `rules`, refused as the kind of search refuses them.
fn word_search(text: &str, rules: PhraseRules) -> Result<WordSearch, Stop> {
    Ok(if rules.missing {
        WordSearch::missing_word(text)?
    } else {
        WordSearch::unknown_words(text)?
    })
}

/// Reads the phrase and refuses one that cannot be searched, before any further question: words
/// that are no BIP39 words, a wrong count, a search of more than 2^24 combinations, and one that
/// surely finds more candidates than a list holds (`listed`). The messages name only places.
fn parse_phrase(text: &str, rules: PhraseRules, listed: bool) -> Result<PhraseSearch, Stop> {
    let read = || -> Result<(), Stop> {
        if rules.legacy {
            legacy_valid_last_words(text)?;
            return Ok(());
        }
        // The same rules that the run keeps; nothing is searched yet.
        let search =
            WordCandidateSearch::new(word_search(text, rules)?, None, WordLimits::default())?;
        let expected = search.expected();
        if listed && expected.exact && !candidate_list_holds(expected.count) {
            return Err(ListError::TooManyForList(NARROW_WORD_SEARCH.to_owned()).into());
        }
        Ok(())
    };
    read().map_err(|error| {
        // Codes typed here are read by Decode, which finds those marked with ?.
        if BackupReading::is_codes(text) {
            RecoverWordError::CodesNotWords.into()
        } else {
            error
        }
    })?;
    Ok(PhraseSearch {
        text: SecretText::copy_of("a seed phrase", text),
        rules,
    })
}

/// The search of words, run with its progress, Ctrl+C stopping it.
fn searched(mut search: WordCandidateSearch) -> Result<WordSearchOutcome, Stop> {
    let mut line = ProgressLine::new(SEARCH_PROGRESS_SECONDS);
    let ran = run_search(&mut search, PROGRESS_EVERY, |progress| {
        line.show_every(|| format!("{} candidates so far.", counting(progress.checked)));
    });
    line.end();
    ran?;
    Ok(search.finish())
}

/// A search of words: forgotten words at their places, or a missing word at any place. A list keeps
/// the entropy of every candidate, so that record N is candidate N; past the most that a list holds
/// the search stops.
fn words_search(phrase: &PhraseSearch, listing: bool, wallet: &GivenWallet) -> Result<Found, Stop> {
    let limits = WordLimits {
        keep: listing.then_some(MAX_CANDIDATE_RECORDS as u64),
        stop_when_full: listing,
        ..WordLimits::default()
    };
    let places = word_search(&phrase.text, phrase.rules)?;
    let length = entropy_bytes(places.word_count());
    let search = WordCandidateSearch::new(places, wallet.check.clone(), limits)?;
    let unknown = search.unknown_places();
    let combinations = ("Combinations", counting(search.combinations()));
    let (facts, columns) = match unknown.as_slice() {
        [] => (
            vec![("Missing word", "at any position".to_owned()), combinations],
            vec![POSITION, WORD, WORD_NUMBER],
        ),
        [place] => (
            vec![("Position", (place + 1).to_string()), combinations],
            vec![WORD, WORD_NUMBER, CHECKSUM_BITS],
        ),
        places => {
            let positions: Vec<String> =
                places.iter().map(|place| (place + 1).to_string()).collect();
            (
                vec![("Positions", positions.join(", ")), combinations],
                vec![WORDS],
            )
        }
    };
    let outcome = searched(search)?;
    let rows = outcome
        .shown
        .iter()
        .map(|shown| row_of(shown, &unknown))
        .collect::<Result<_, _>>()?;
    Ok(Found {
        facts,
        columns,
        about: "Every combination was checked; only those with a valid BIP39 checksum are candidates.",
        compared_with: None,
        rows,
        entropies: listing.then_some((outcome.entropies, length)),
        count: outcome.count,
        matched: outcome.matched,
        warning: outcome.warning,
    })
}

/// The columns of the candidates after their number: those of the search, the wallet's, the phrase.
fn columns_of(found: &Found, checked: bool) -> Vec<Column> {
    let mut columns = found.columns.clone();
    if checked {
        columns.push(WALLET);
    }
    columns.push(PHRASE);
    columns
}

/// `rows` as a table for a script: a heading, then one row of tab-separated fields each.
fn table_rows(rows: &[&Row], found: &Found, wallet: &GivenWallet) -> Vec<String> {
    let mut headings = vec!["candidate"];
    headings.extend(
        columns_of(found, wallet.check.is_some())
            .iter()
            .map(|column| column.0),
    );
    let mut lines = vec![headings.join("\t")];
    for row in rows {
        let mut fields = vec![row.number.to_string()];
        fields.extend(row.fields(wallet, false));
        lines.push(fields.join("\t"));
    }
    lines
}

/// `rows` as they are printed: on a terminal each candidate as a part of the result, for a file, a
/// pipe or TERM=dumb the rows of a table.
fn candidate_rows(rows: &[&Row], found: &Found, wallet: &GivenWallet) -> Vec<String> {
    if !can_redraw(Channel::Output) {
        return table_rows(rows, found, wallet);
    }
    let columns = columns_of(found, wallet.check.is_some());
    let mut lines = Vec::new();
    for row in rows {
        let fields = row.fields(wallet, true);
        let facts: Vec<(&str, String)> = columns
            .iter()
            .zip(fields)
            .map(|(column, field)| (column.1, field))
            .collect();
        lines.extend(candidate_lines(&candidate_label(row.number), &facts));
    }
    lines
}

/// The notes after the candidates: what they are, and what a valid checksum or the wallet says.
fn notes_after_table(found: &Found, wallet: &GivenWallet) -> Vec<ResultNote> {
    let mut notes = vec![ResultNote::Notice(found.about.to_owned(), NoticeKind::Info)];
    let Some(label) = &wallet.label else {
        notes.push(ResultNote::Lasting(
            "A valid checksum does not prove the wallet: compare an address.".to_owned(),
        ));
        notes.push(ResultNote::More("exact-local-recovery-checks"));
        return notes;
    };
    let kind = if found.matched == 0 {
        NoticeKind::Warning
    } else {
        NoticeKind::Success
    };
    notes.push(ResultNote::Notice(
        format!(
            "Matched {} of {} candidates against the requested {label} locally.",
            found.matched,
            counting(found.count)
        ),
        kind,
    ));
    notes.extend(
        found
            .warning
            .map(|text| ResultNote::Lasting(text.to_owned())),
    );
    notes.extend(
        found
            .compared_with
            .map(|text| ResultNote::Lasting(text.to_owned())),
    );
    notes
}

/// Whether `lines` fit on the private screen with `beside` rows around them, which keeps no
/// scrollback; output elsewhere always fits.
fn fit_private_screen(lines: &[String], beside: usize) -> bool {
    if !on_private_screen() || !can_redraw(Channel::Output) {
        return true;
    }
    lines.iter().map(|line| output_rows(line)).sum::<usize>() + beside <= rows()
}

/// What comes after a search on the private screen.
enum Next {
    Done,
    /// The phrase is typed again; the list, its protection and its passphrase are kept.
    Phrase,
    /// The same phrase is searched again with this wallet; `listed` false leaves the list out.
    Wallet {
        evidence: Option<AskedEvidence>,
        listed: bool,
    },
    /// The same phrase is searched again for the list that the options name.
    List(Vec<String>),
}

/// What is chosen after a search.
#[derive(Clone, Copy)]
enum Chosen {
    Done,
    Phrase,
    Wallet { listed: bool },
    List,
}

/// How the wallet is asked after a search.
#[derive(Clone, Copy)]
struct WalletAsked<'a> {
    /// Whether "It cannot" is offered.
    optional: bool,
    place: &'a Place,
}

/// Asks what comes next after a search; a choice of the wallet asks for it at once, and a choice of
/// a list its file and encryption; Escape there asks the first question again.
fn ask_next(choices: &[Choice<Chosen>], wallet: WalletAsked<'_>) -> Result<Next, Stop> {
    loop {
        match after_failure(WHAT_NOW, choices, AfterFailure::default())? {
            Chosen::Done => return Ok(Next::Done),
            Chosen::Phrase => return Ok(Next::Phrase),
            Chosen::List => {
                if let Some(options) = ask_candidate_list()? {
                    return Ok(Next::List(options));
                }
            }
            Chosen::Wallet { listed } => {
                match ask_wallet_evidence(wallet.optional, None, wallet.place)? {
                    WalletAnswer::Back => {}
                    WalletAnswer::None => {
                        return Ok(Next::Wallet {
                            evidence: None,
                            listed,
                        });
                    }
                    WalletAnswer::Wallet(evidence) => {
                        return Ok(Next::Wallet {
                            evidence: Some(evidence),
                            listed,
                        });
                    }
                }
            }
        }
    }
}

/// The answer that asks for the words again.
fn words_again() -> Choice<Chosen> {
    Choice::new("Type the words again", Chosen::Phrase)
}

/// That answer where more letters of the words would narrow the search.
fn more_letters() -> Choice<Chosen> {
    Choice::noted("Type the words again", "with more letters", Chosen::Phrase)
}

/// Where the candidates go, and whether a list may be offered after the search.
struct SearchContext<'a> {
    target: &'a mut Option<CandidatesFile>,
    offers_list: bool,
    wallet: &'a GivenWallet,
    asked: bool,
}

/// The line that names a saved list: up to three rows for a file name of some 80 characters.
const SAVED_LIST_ROWS: usize = 3;

/// Saves what `found` holds for a list, if there is one.
fn save_found(found: &mut Found, context: &mut SearchContext<'_>) -> Result<(), Stop> {
    let (Some(target), Some((entropies, length))) = (&mut *context.target, found.entropies.take())
    else {
        return Ok(());
    };
    target.save_entropies(entropies, length, context.wallet.passphrase())
}

/// No candidate fits: says so, and asks again where the words were typed.
fn show_no_candidate(
    facts: &[(&'static str, String)],
    context: &mut SearchContext<'_>,
) -> Result<Next, Stop> {
    result_header(TITLE, facts, Channel::Output);
    notice(
        "No valid phrase fits these words: check them, their order and the ? places.",
        NoticeKind::Warning,
    );
    let next = if context.asked {
        ask_next(
            &[words_again(), Choice::new("Stop", Chosen::Done)],
            WalletAsked {
                optional: false,
                place: &context.wallet.place,
            },
        )?
    } else {
        Next::Done
    };
    if matches!(next, Next::Done)
        && let Some(target) = context.target.as_ref()
    {
        target.save_nothing();
    }
    Ok(next)
}

/// The candidates to print, and whether they are all of them. Every candidate is shown when the list
/// is short: when its rows for a script, one line each, fit on the private screen with what is
/// printed around them, the `beside` rows. On a terminal, where each candidate is a part of its own,
/// the screen then shows them by pages. A longer list shows only those that match the wallet, each
/// with its number among all of them.
fn candidates_to_print<'a>(
    found: &'a Found,
    wallet: &GivenWallet,
    beside: usize,
) -> (Vec<&'a Row>, bool) {
    let all: Vec<&Row> = found.rows.iter().collect();
    if found.count <= MAX_SHOWN_CANDIDATES
        && fit_private_screen(&table_rows(&all, found, wallet), beside)
    {
        return (all, true);
    }
    let matched = all
        .into_iter()
        .filter(|row| row.answer.as_ref().is_some_and(|answer| answer.matched))
        .collect();
    (matched, false)
}

/// What comes after candidates too many to show, on the private screen also for words read from a
/// file, which are not typed again.
fn ask_after_unshown(found: &Found, context: &SearchContext<'_>) -> Result<Next, Stop> {
    let mut choices = vec![check_wallet_answer(
        Chosen::Wallet { listed: true },
        "only those that match are shown",
    )];
    if context.offers_list && candidate_list_holds(found.count) {
        choices.push(Choice::noted(
            "Save them for the Discovery Scanner",
            "an encrypted list",
            Chosen::List,
        ));
    }
    if context.asked {
        choices.push(more_letters());
    }
    choices.push(Choice::new("Done", Chosen::Done));
    ask_next(
        &choices,
        WalletAsked {
            optional: false,
            place: &context.wallet.place,
        },
    )
}

/// Shows what a search found, as a result, under which the question that follows is asked, if
/// anything.
fn show(found: &mut Found, context: &mut SearchContext<'_>) -> Result<Next, Stop> {
    let wallet = context.wallet;
    let mut facts = found.facts.clone();
    facts.push(("Checksum-valid candidates", counting(found.count)));
    if found.count == 0 {
        return show_no_candidate(&facts, context);
    }
    let listing = context.target.is_some();
    let checked = wallet.check.is_some();
    if checked {
        facts.push(("Evidence matches", found.matched.to_string()));
    }
    // When none matched the wallet, the person is asked first and the list is saved only when they
    // are done: words typed again give other candidates and another wallet the same ones, so the
    // list is saved once, for the last words.
    let saved_later = context.asked && checked && found.matched == 0;
    let notes = notes_after_table(found, wallet);
    let done = if listing {
        Choice::noted("Done", "saves the list", Chosen::Done)
    } else {
        Choice::new("Done", Chosen::Done)
    };
    let later_choices = vec![
        words_again(),
        change_wallet_answer(Chosen::Wallet { listed: true }),
        done,
    ];
    let later_asked = ListQuestion {
        question: WHAT_NOW,
        label: "Next",
        quit: "stops",
        explanation: None,
    };
    let note_rows: Vec<String> = notes.iter().flat_map(note_lines).collect();
    let beside = rows_of(&result_lines(Channel::Output, TITLE, &facts))
        + rows_of(&note_rows)
        + if listing && !saved_later {
            SAVED_LIST_ROWS
        } else {
            0
        }
        + if saved_later {
            list_rows(&later_asked, &later_choices)
        } else {
            CLOSING_ROWS
        };
    let (listed, every_row) = candidates_to_print(found, wallet, beside);
    result_header(TITLE, &facts, Channel::Output);
    if !listed.is_empty() {
        print(Channel::Output, &candidate_rows(&listed, found, wallet));
    }
    let too_many_to_show = !every_row && !checked && !listing;
    if listing {
        if !saved_later {
            save_found(found, context)?;
        }
    } else if too_many_to_show {
        let advice = candidate_list_holds(found.count)
            .then_some("save them with --candidates-file for the Discovery Scanner");
        notice(
            &unshown_candidates_notice(found.count, advice),
            NoticeKind::Warning,
        );
    }
    notes.iter().for_each(print_note);
    if too_many_to_show && on_private_screen() {
        return ask_after_unshown(found, context);
    }
    if !saved_later {
        return Ok(Next::Done);
    }
    let next = ask_next(
        &later_choices,
        WalletAsked {
            optional: true,
            place: &wallet.place,
        },
    )?;
    if matches!(next, Next::Done) {
        save_found(found, context)?;
    }
    Ok(next)
}

/// Searches the candidates of `phrase`, shows them, saves the list, and asks what comes next.
fn search_and_show(phrase: &PhraseSearch, mut context: SearchContext<'_>) -> Result<Next, Stop> {
    // The search is a step of its own: its screen shows the title and the search, then the result,
    // no longer the words typed (CORE-39).
    step_begin();
    let found = if phrase.rules.legacy {
        legacy_replacements(&phrase.text, context.wallet)
    } else {
        words_search(phrase, context.target.is_some(), context.wallet)
    };
    let mut found = match found {
        Ok(found) => found,
        Err(Stop::Refused(refusal)) if refusal.code() == TOO_MANY_FOR_LIST && context.asked => {
            notice(&refusal.to_string(), NoticeKind::Warning);
            let next = ask_next(
                &[
                    more_letters(),
                    check_wallet_answer(Chosen::Wallet { listed: false }, "without a list"),
                    stop_without_list_answer(Chosen::Done),
                ],
                WalletAsked {
                    optional: false,
                    place: &context.wallet.place,
                },
            )?;
            if !matches!(next, Next::Phrase)
                && let Some(target) = context.target.as_ref()
            {
                target.discard();
            }
            return Ok(next);
        }
        Err(stop) => return Err(stop),
    };
    show(&mut found, &mut context)
}

/// Whether recover-word may offer a candidate list after a search, on its private screen: where no
/// --candidates-file names one, not for a legacy last word, whose replacements are no wallets, and
/// not where a wallet given with an option stays, as it does without --ask-secrets. The command then
/// keeps the right to write files.
pub(crate) fn offers_candidate_list(parsed: &Parsed) -> bool {
    terminal_available()
        && !is_on(parsed, "legacy-valid-last-word")
        && !parsed.contains_key("candidates-file")
        && (is_on(parsed, "ask-secrets") || !wallet_option_given(parsed))
}

/// The candidate list that the answers `options` name, its name numbered where it is taken, as the
/// command line numbers it before it runs, with a warning where a cloud service would keep a copy.
fn list_of(mut options: Vec<String>) -> Result<Option<CandidatesFile>, Stop> {
    // A passphrase chosen for the list is asked on this private screen.
    options.push("--ask-secrets".to_owned());
    let mut parsed = args::parse_arguments(&options)?;
    preflight(&mut parsed)?;
    warn_of_cloud_copies(&parsed);
    CandidatesFile::of(&parsed)
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let rules = PhraseRules {
        legacy: is_on(parsed, "legacy-valid-last-word"),
        missing: is_on(parsed, "missing-word"),
    };
    if rules.legacy && rules.missing {
        return Err(RecoverWordError::LegacyAndMissing.into());
    }
    let mut target = CandidatesFile::of(parsed)?;
    // The replacements are stored phrases, not wallets: the Scanner would search the wrong ones.
    if rules.legacy && target.is_some() {
        return Err(RecoverWordError::LegacyList.into());
    }
    let mut wallet = given_wallet(parsed)?;
    // A list chosen after a search holds the BIP39 passphrase too; it is offered only where it can.
    let offers_list =
        offers_candidate_list(parsed) && check_list_passphrase(wallet.passphrase()).is_ok();
    let asked = is_on(parsed, "ask-secrets");
    if target.is_some() {
        CandidatesFile::check_listable(wallet.passphrase())?;
    }
    if asked {
        assert_asked_not_given(parsed, &PHRASE_SECRET_OPTIONS)?;
    }
    let prompt = if rules.legacy {
        "Exact legacy Seedshift phrase (old final word), or text file path:"
    } else if rules.missing {
        "The words you have, in order, or text file path:"
    } else {
        "Seed phrase or text file path, ? for each forgotten word:"
    };
    let read = |listed: bool| -> Result<PhraseSearch, Stop> {
        if !asked {
            let text = text_input(
                parsed,
                "mnemonic",
                ("the mnemonic", "The mnemonic file", "in a file"),
                PATTERN_LIMIT,
            )?;
            return parse_phrase(&text, rules, listed);
        }
        let ask = Ask {
            text_file: Some("The seed phrase file"),
            hints: Some(&*BIP39),
            ..secret_ask(prompt, "the words", PATTERN_LIMIT)
        };
        secret_until(&ask, |text: &str| {
            parse_phrase(text, rules, listed).map_err(|stop| stop.message())
        })
    };
    let mut phrase = read(target.is_some())?;
    // Only once the phrase can be searched: a list passphrase typed for nothing is lost work.
    if let Some(target) = &mut target {
        target.prepare(wallet.passphrase())?;
    }
    loop {
        let next = search_and_show(
            &phrase,
            SearchContext {
                target: &mut target,
                offers_list,
                wallet: &wallet,
                asked,
            },
        )?;
        if matches!(next, Next::Done) {
            return Ok(());
        }
        // The result was read: what comes next has a page of its own (CORE-39).
        leave_result();
        match next {
            Next::Done => {}
            Next::Phrase => phrase = read(target.is_some())?,
            Next::List(options) => {
                target = list_of(options)?;
                if let Some(target) = &mut target {
                    target.prepare(wallet.passphrase())?;
                }
            }
            Next::Wallet { evidence, listed } => {
                wallet.set_evidence(evidence);
                if !listed {
                    target = None;
                }
            }
        }
    }
}
