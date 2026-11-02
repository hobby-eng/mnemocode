//! Decode's search for codes marked with ?, on the private screen (MnemoCode TS 0.1.0's
//! `cli/missing-codes-search.ts`): it asks how the right codes are told, with Decode's options
//! answering the first way asked (the encoded fingerprint, the wallet or the list, and the limit of
//! a long search), shows the search's progress on one line, and what it found. Every rule of the
//! search is the library's `MissingCodesSearch`; this module only asks, composes the wallet check
//! and shows.

use std::rc::Rc;

use mnemocode::dates::Dates;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::recovery::marked::MissingCodes;
use mnemocode::recovery::marked_search::{
    LIST_OVERFLOW, MissingCodesFound, MissingCodesResult, MissingCodesRow, MissingCodesSearch, Way,
    WaySearch, found_among_others, texts,
};
use mnemocode::recovery::wallet_check::WalletCheck;
use mnemocode::search::plan::counting;
use mnemocode::search::{Progress, Search};
use mnemocode::text::words::lower_first;
use mnemocode::wallet::evidence::parse_master_fingerprint;

use super::asking::{AfterFailure, WHAT_NOW, after_failure, value_until};
use super::backup_questions::CODES_AGAIN_LABEL;
use super::date_search::ask_dates;
use super::found::{candidate_label, candidate_lines};
use super::given::PATH_LIMIT;
use super::searching::{Refusal, ask_to_search, run_search, timed_parts};
use super::wallet_options::GivenWallet;
use super::wallet_question::{WalletAnswer, ask_wallet_evidence};
use crate::gate::Stop;
use crate::terminal::result::{print, result_header};
use crate::terminal::{
    Channel, Choice, Chosen, ListQuestion, NoticeKind, ProgressLine, can_redraw, choose, hint,
    lasting_warning, notice, on_private_screen, status, step_begin,
};

/// Seconds between two progress updates of a long search.
const PROGRESS_SECONDS: u64 = 2;
/// Candidates between two looks at the progress.
const PROGRESS_EVERY: u32 = 64;

/// What the search of marked codes gave the decode that asked for it.
#[derive(Debug)]
pub(crate) enum MissingOutcome {
    /// The one set of codes that fits, to be decoded as complete codes are, with its dates.
    Found(Box<MissingCodesFound>),
    /// The phrases were shown already, as a list.
    Shown,
    /// The codes are to be typed again.
    Again,
}

/// What Decode's options answer in the search of marked codes, and where a wallet is looked for.
#[derive(Clone, Copy, Debug)]
pub(crate) struct MissingCodesAnswers<'a> {
    /// The wallet of the options, which answers "The wallet", with the BIP39 passphrase and where
    /// one asked here is looked for.
    pub(crate) wallet: &'a GivenWallet,
    /// --encoded-fingerprint, which answers "Encoded fingerprint".
    pub(crate) encoded_fingerprint: Option<&'a str>,
    /// --list-candidates, which answers "List every candidate".
    pub(crate) list: bool,
    /// --max-candidates: the combinations of codes and dates tried without asking.
    pub(crate) max_candidates: Option<u64>,
}

/// What a way that was searched gave.
enum WayOutcome {
    Outcome(MissingOutcome),
    /// The list held more than it can: the way is asked again, without the list.
    Overflowed,
    /// Another way is asked for.
    AskAgain,
}

/// The option that names `way` ahead in `answers`, as a refusal of it says; none where none does,
/// and the way is asked for.
const fn given_by(way: Way, answers: &MissingCodesAnswers<'_>) -> Option<&'static str> {
    match way {
        Way::Encoded if answers.encoded_fingerprint.is_some() => Some("--encoded-fingerprint"),
        Way::Wallet if answers.wallet.check.is_some() => Some("The wallet option"),
        Way::List if answers.list => Some("--list-candidates"),
        Way::Encoded | Way::Wallet | Way::List => None,
    }
}

/// The first way, in the library's order, that the options answer and that fits the codes; one that
/// does not fit is said, and the next is taken. None asks for it.
fn given_way(
    search: &MissingCodesSearch,
    answers: &MissingCodesAnswers<'_>,
) -> Result<Option<Way>, Stop> {
    for way in Way::ALL {
        let Some(option) = given_by(way, answers) else {
            continue;
        };
        let Some(refusal) = search.why_not(way)? else {
            return Ok(Some(way));
        };
        notice(
            &format!("{option}: {}", lower_first(&refusal)),
            NoticeKind::Warning,
        );
    }
    Ok(None)
}

/// Says what the search filled in, the codes whole with those found, so that the written copy can
/// be corrected, and what the wallet check said of its match; the decode shows it again with its
/// result.
pub(crate) fn report_found(codes: &MissingCodes, found: &MissingCodesFound) -> Result<(), Stop> {
    let label = format!("{} found:", MissingCodesSearch::places_text(codes));
    status(&label, &found.backup.text()?, true);
    if let Some(dates) = &found.found_dates {
        status("Dates found:", dates.as_str(), true);
    }
    // A fingerprint is only a filter (AUD-037-SEC004).
    if let Some(warning) = found.warning {
        lasting_warning(warning);
    }
    // Other codes with other dates give the same phrase: those found need not be those written.
    match found.others {
        Some(others) => lasting_warning(&found_among_others(others)),
        None => hint(texts::CORRECT),
    }
    Ok(())
}

/// Whether `way` is searched: at once, with the notice of its time, if any, or, when the plan asks
/// for it, only when the person chooses it, whose question said its time. None for the answer No.
fn started(way: &WaySearch, limit: Option<u64>) -> Result<Option<Option<String>>, Stop> {
    let plan = way.plan(&timed_parts(way)?, limit)?;
    if !plan.ask() {
        return Ok(Some(plan.tell().then(|| plan.notice())));
    }
    let no = Refusal {
        note: "choose another way",
        quit: "goes back",
    };
    Ok(ask_to_search(&plan.question(), no)?.then_some(None))
}

/// Runs `way` on a step screen of its own, with `told` first, if any, and its progress on one line;
/// a search that Ctrl+C stopped cancels the command.
fn ran(mut way: WaySearch, told: Option<&str>) -> Result<MissingCodesResult, Stop> {
    // The search is a step of its own: its screen no longer shows the question before it (CORE-39).
    step_begin();
    if let Some(told) = told {
        notice(told, NoticeKind::Info);
    }
    let mut line = ProgressLine::new(PROGRESS_SECONDS);
    let done = run_search(&mut way, PROGRESS_EVERY, |progress: Progress| {
        line.show_every(|| {
            format!(
                "Checked {} of about {}; {} found.",
                counting(progress.checked),
                counting(progress.total.unwrap_or(progress.checked)),
                progress.found
            )
        });
    });
    line.end();
    done?;
    Ok(way.finish())
}

/// Asks how the right codes are told and searches them, until one set is found, the candidates are
/// listed, or the person types the codes again. The options in `answers` answer the first way and
/// its value; once that way finds nothing, the person chooses.
pub(crate) fn search_missing_codes(
    codes: &MissingCodes,
    answers: MissingCodesAnswers<'_>,
) -> Result<MissingOutcome, Stop> {
    let search = MissingCodesSearch::new(codes.clone());
    notice(&search.unreadable()?, NoticeKind::Warning);
    if search.many()? {
        hint(texts::MANY);
    }
    // A way that held more than it can, the list, is not offered again for these codes
    // (AUD-037-FUN002).
    let mut closed = Vec::new();
    let mut given = given_way(&search, &answers)?;
    loop {
        let named = given.take();
        let Some(way) = named.map_or_else(|| ask_way(&search, &closed), |way| Ok(Some(way)))?
        else {
            return Ok(MissingOutcome::Again);
        };
        let by_option = named == Some(way);
        let outcome = match way {
            Way::Encoded => by_encoded_fingerprint(&search, &answers, by_option)?,
            Way::Wallet => by_wallet(&search, &answers, by_option)?,
            Way::List => listed(&search)?,
        };
        match outcome {
            WayOutcome::Outcome(outcome) => return Ok(outcome),
            WayOutcome::Overflowed => closed.push(way),
            WayOutcome::AskAgain => {}
        }
    }
}

/// Asks how the right codes are told, of the ways not `closed`; none types the codes again.
fn ask_way(search: &MissingCodesSearch, closed: &[Way]) -> Result<Option<Way>, Stop> {
    let choices: Vec<Choice<Way>> = search
        .ways()?
        .into_iter()
        .filter(|choice| !closed.contains(&choice.way))
        .map(|choice| Choice::noted(choice.label, choice.note, choice.way))
        .collect();
    let asked = ListQuestion {
        question: texts::QUESTION,
        label: "Codes",
        quit: "types the codes again",
        explanation: None,
    };
    match choose(&asked, None, &choices)? {
        Chosen::One(way) => Ok(Some(way)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// The codes whose own fingerprint is the encoded one that Encode showed, --encoded-fingerprint
/// when `given`.
fn by_encoded_fingerprint(
    search: &MissingCodesSearch,
    answers: &MissingCodesAnswers<'_>,
    given: bool,
) -> Result<WayOutcome, Stop> {
    let given = answers.encoded_fingerprint.filter(|_| given);
    let fingerprint = match given {
        Some(fingerprint) => Some(fingerprint.to_owned()),
        None => value_until(
            "Encoded fingerprint of these codes, such as 1a2b3c4d:",
            "the eight characters of the fingerprint",
            PATH_LIMIT,
            None,
            |text: &str| parse_master_fingerprint(text).map(|_| text.trim().to_owned()),
        )?,
    };
    let Some(fingerprint) = fingerprint else {
        return Ok(WayOutcome::AskAgain);
    };
    let way = search.by_encoded_fingerprint(&fingerprint)?;
    searched(search, way, answers.max_candidates)
}

/// The dates of the masked codes, with ? for a forgotten digit where `patterns`.
fn code_dates(search: &MissingCodesSearch, patterns: bool) -> Result<Option<DatesAnswer>, Stop> {
    if !search.needs_dates() {
        return Ok(None);
    }
    let word_count = Some(search.codes().word_count());
    Ok(Some(ask_dates(word_count, patterns, None, |_| Ok(()))?))
}

/// The codes whose phrase, with the dates, matches the wallet, the one of the options when `given`.
/// Dates with ? are searched with the codes.
fn by_wallet(
    search: &MissingCodesSearch,
    answers: &MissingCodesAnswers<'_>,
    given: bool,
) -> Result<WayOutcome, Stop> {
    let dates = code_dates(search, true)?;
    let wallet = answers.wallet;
    let check = match wallet.check.as_ref().filter(|_| given) {
        Some(check) => Rc::clone(check),
        None => match ask_wallet_evidence(false, None, &wallet.place)? {
            WalletAnswer::Wallet(asked) => {
                Rc::new(WalletCheck::new(asked.evidence, wallet.passphrase()))
            }
            WalletAnswer::None | WalletAnswer::Back => return Ok(WayOutcome::AskAgain),
        },
    };
    let way = search.by_wallet(check, dates.map(Rc::new))?;
    searched(search, way, answers.max_candidates)
}

/// Searches `way` once the person allows it and tells its outcome; after the answer No, another way
/// is asked for.
fn searched(
    search: &MissingCodesSearch,
    way: WaySearch,
    limit: Option<u64>,
) -> Result<WayOutcome, Stop> {
    let Some(told) = started(&way, limit)? else {
        return Ok(WayOutcome::AskAgain);
    };
    outcome_of(search, ran(way, told.as_deref())?)
}

/// The candidates of a listed search: on the private screen a result, then each candidate as a
/// part of its own with its facts as grey labels (CORE-36), which the page shows by pages when they
/// do not fit; elsewhere one row each, for a script.
fn show_candidates(rows: &[MissingCodesRow]) {
    if on_private_screen() && can_redraw(Channel::Output) {
        let found = [("Found", rows.len().to_string())];
        result_header("Candidates", &found, Channel::Output);
    }
    for (index, row) in rows.iter().enumerate() {
        let number = index as u64 + 1;
        let (codes, phrase) = (row.codes.as_str(), row.phrase.text());
        let lines = if on_private_screen() && can_redraw(Channel::Output) {
            candidate_lines(
                &candidate_label(number),
                &[
                    ("Codes", codes.to_owned()),
                    ("Phrase", phrase.as_str().to_owned()),
                    ("Fingerprint", row.fingerprint.clone()),
                ],
            )
        } else {
            vec![format!(
                "{number}\t{codes}\t{}\t{}",
                phrase.as_str(),
                row.fingerprint
            )]
        };
        print(Channel::Output, &lines);
    }
}

/// Every candidate with its phrase and fingerprint, for the person to compare. More of them than a
/// list holds, which the estimate allowed, are said, and the way is asked again (AUD-037-UI003).
fn listed(search: &MissingCodesSearch) -> Result<WayOutcome, Stop> {
    let dates = code_dates(search, false)?;
    let known = dates
        .as_ref()
        .map_or_else(|| Dates::new(&[]), |answer| answer.known().clone());
    let way = search.listed(&known)?;
    let result = match ran(way, None) {
        Err(Stop::Refused(refusal)) if refusal.code() == LIST_OVERFLOW => {
            notice(&refusal.to_string(), NoticeKind::Warning);
            return Ok(WayOutcome::Overflowed);
        }
        other => other?,
    };
    if let MissingCodesResult::List(rows) = &result {
        show_candidates(rows);
    }
    hint(texts::LIST);
    Ok(WayOutcome::Outcome(MissingOutcome::Shown))
}

/// What is chosen after several sets fit.
#[derive(Clone, Copy)]
enum AfterSeveral {
    Wallet,
    Again,
}

/// The one set of codes found, reported; none says why and asks again; several, which a fingerprint
/// leaves only by chance, are told by the wallet or the codes are typed again.
fn outcome_of(search: &MissingCodesSearch, result: MissingCodesResult) -> Result<WayOutcome, Stop> {
    match result {
        MissingCodesResult::Found(found) => {
            report_found(search.codes(), &found)?;
            Ok(WayOutcome::Outcome(MissingOutcome::Found(found)))
        }
        MissingCodesResult::None(message) => {
            notice(message, NoticeKind::Warning);
            Ok(WayOutcome::AskAgain)
        }
        MissingCodesResult::Several { message, .. } => {
            notice(&message, NoticeKind::Warning);
            let next = after_failure(
                WHAT_NOW,
                &[
                    Choice::new("Tell them by the wallet", AfterSeveral::Wallet),
                    Choice::new(CODES_AGAIN_LABEL, AfterSeveral::Again),
                ],
                AfterFailure {
                    escape: "types the codes again",
                    ..AfterFailure::default()
                },
            )?;
            Ok(match next {
                AfterSeveral::Wallet => WayOutcome::AskAgain,
                AfterSeveral::Again => WayOutcome::Outcome(MissingOutcome::Again),
            })
        }
        MissingCodesResult::List(_) | MissingCodesResult::Stopped => {
            Ok(WayOutcome::Outcome(MissingOutcome::Shown))
        }
    }
}
