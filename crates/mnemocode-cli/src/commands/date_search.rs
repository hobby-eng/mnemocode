//! The search of the forgotten digits of dates as the commands ask for, run and show it (MnemoCode
//! TS 0.1.0's `cli/date-search.ts`): the dates asked until they can be used; a search asked for
//! first where it is long, after saying how large it is, with its progress on one line; the
//! matches, on a terminal each a part of the result, for a script one row each; and what is asked
//! after a search whose result cannot be used.

use std::rc::Rc;

use mnemocode::dates::DATE_FORMAT_TEXT;
use mnemocode::dates::answer::{AnswerError, DatesAnswer, MAX_INCOMPLETE_DATES};
use mnemocode::modes::Mode;
use mnemocode::modes::phrase_words::ORIGINAL;
use mnemocode::modes::seedshift::Indexes;
use mnemocode::recovery::date_search::{
    DateMatch, DateSearch, DateSearchOutcome, MAX_SHOWN_MATCHES, MatchLimits, wallet_needed,
    wallet_reason,
};
use mnemocode::search::Search;
use mnemocode::search::plan::counted;
use mnemocode::text::numbers::WholeRange;

use super::asking::{AfterFailure, WHAT_NOW, after_failure, secret_until};
use super::backup_questions::{TYPE_ENCODED_AGAIN_LABEL, TYPE_ENCODED_LABEL, from_file};
use super::candidates_file::stop_without_list_answer;
use super::found::{candidate_lines, matched_at, matched_on_terminal};
use super::given::{PATH_LIMIT, dates_prompt, most_dates};
use super::searching::{
    Refusal as SearchRefusal, SearchNotAllowed, ask_to_search, run_search, timed_parts,
};
use super::wallet_options::{AskedEvidence, GivenWallet};
use super::wallet_question::{
    WalletAnswer, ask_wallet_evidence, change_wallet_answer, check_wallet_answer,
};
use crate::args::{Parsed, integer_option, value};
use crate::gate::Stop;
use crate::input::secret_ask;
use crate::terminal::result::{ResultNote, note_lines, print, print_note, result_header};
use crate::terminal::{
    CLOSING_ROWS, Channel, Choice, Explanation, NoticeKind, ProgressLine, TEXT_WIDTH, can_redraw,
    notice, on_private_screen, readme_link, result_lines, rows, rows_of, step_begin, wrap_text,
};

/// Date combinations between two progress lines, by default.
pub(crate) const PROGRESS_EVERY: u64 = 1000;
/// The most a count of an option takes.
const LARGEST_COUNT: u64 = (1 << 53) - 1;
/// The counts of --max-results and --progress-every.
const COUNT_RANGE: WholeRange = WholeRange::new(1, LARGEST_COUNT);

/// --max-candidates: how many combinations a search may try without asking.
pub(crate) fn max_candidates_of(parsed: &Parsed) -> Result<Option<u64>, Stop> {
    if value(parsed, "max-candidates").is_none() {
        return Ok(None);
    }
    let range = WholeRange::new(1, mnemocode::dates::answer::HARD_MAX_COMBINATIONS);
    Ok(Some(integer_option(
        parsed,
        "max-candidates",
        range,
        None,
        None,
    )?))
}

/// --max-results: the most matches shown.
pub(crate) fn max_results_of(parsed: &Parsed) -> Result<u64, Stop> {
    Ok(integer_option(
        parsed,
        "max-results",
        COUNT_RANGE,
        Some(MAX_SHOWN_MATCHES),
        None,
    )?)
}

/// --progress-every: the combinations between two progress lines.
pub(crate) fn progress_every_of(parsed: &Parsed) -> Result<u64, Stop> {
    Ok(integer_option(
        parsed,
        "progress-every",
        COUNT_RANGE,
        Some(PROGRESS_EVERY),
        None,
    )?)
}

/// The answer No to a long date search, which asks for the dates again.
pub(crate) const DATES_AGAIN: SearchRefusal<'static> = SearchRefusal {
    note: "type the dates again",
    quit: "types the dates again",
};
/// The answer that types the dates again, after a phrase or a part that does not fit.
pub(crate) const DATES_AGAIN_LABEL: &str = "Type the dates again";
/// The answer that changes the dates, after a search or phrases that none of them fits.
pub(crate) const CHANGE_DATES_LABEL: &str = "Change the dates";

/// The numbers of the most dates a search leaves incomplete, as a sentence says them.
const NUMBER_WORDS: [&str; 5] = ["zero", "one", "two", "three", "four"];

/// The question for dates that may hold ?, as recover-date asks it.
pub(crate) fn recovery_dates_prompt(word_count: Option<usize>) -> String {
    format!(
        "Dates with ? for what is forgotten ({}one to {} of them incomplete):",
        most_dates(word_count),
        NUMBER_WORDS[MAX_INCOMPLETE_DATES]
    )
}

/// The question for dates: with ? where `patterns` allows it, otherwise as Encode asks.
fn dates_question(word_count: Option<usize>, patterns: bool) -> String {
    if patterns {
        format!(
            "Dates ({}{DATE_FORMAT_TEXT}, ? for what is forgotten, separated by spaces):",
            most_dates(word_count)
        )
    } else {
        dates_prompt(word_count)
    }
}

/// Asks for the dates on the private screen until they can be used; `prompt` by default the
/// question of [`dates_question`], and `check` a rule of the command on top.
pub(crate) fn ask_dates(
    word_count: Option<usize>,
    patterns: bool,
    prompt: Option<String>,
    check: impl Fn(&DatesAnswer) -> Result<(), AnswerError>,
) -> Result<DatesAnswer, Stop> {
    let prompt = prompt.unwrap_or_else(|| dates_question(word_count, patterns));
    let ask = secret_ask(&prompt, "the dates", PATH_LIMIT);
    secret_until(&ask, |line: &str| {
        let answer = DatesAnswer::parse(line, word_count, patterns)?;
        check(&answer)?;
        Ok::<_, AnswerError>(answer)
    })
}

/// Why the wallet is asked for before a date search in `mode`, shown with the question: the
/// library's reason, the command's own `extra`, and where to read more.
pub(crate) fn wallet_explanation(mode: Option<Mode>, extra: Option<String>) -> Explanation {
    let mut lines = vec![wallet_reason(mode).to_owned()];
    lines.extend(extra);
    Explanation {
        lines,
        more: vec![readme_link("date-recovery-helper")],
    }
}

/// What a search of the commands is given.
pub(crate) struct DateRequest<'a> {
    pub(crate) indexes: &'a [u16],
    pub(crate) dates: Rc<DatesAnswer>,
    pub(crate) mode: Mode,
    pub(crate) wallet: &'a GivenWallet,
    pub(crate) max_results: u64,
    pub(crate) max_candidates: Option<u64>,
    pub(crate) progress_every: u64,
    /// How many matches are kept for a candidate list.
    pub(crate) keep: Option<u64>,
}

/// Runs the search for the forgotten digits, after saying how large it is, with its progress. One
/// longer than allowed is asked for first on the private screen, and needs --max-candidates
/// elsewhere. None when the person chose not to search.
pub(crate) fn search_dates(request: DateRequest<'_>) -> Result<Option<DateSearchOutcome>, Stop> {
    let mut search = DateSearch::new(
        Indexes::new(request.indexes.to_vec()),
        request.dates,
        request.mode,
        request.wallet.check.clone(),
        MatchLimits {
            max_shown: Some(request.max_results),
            keep: request.keep,
        },
    )?;
    let pace = search.pace(&timed_parts(&search)?);
    let plan = search.plan(pace, request.max_candidates)?;
    if plan.ask() {
        if !on_private_screen() {
            return Err(SearchNotAllowed {
                extent: plan.extent(),
                allowances: vec![("max-candidates", plan.count())],
                code: "cli.date-search.search-dates-refused",
            }
            .into());
        }
        if !ask_to_search(&plan.question(), DATES_AGAIN)? {
            return Ok(None);
        }
    }
    // The search is a step of its own: its screen shows the title and the search (CORE-39).
    step_begin();
    notice(
        &format!("Recovery search contains {}.", plan.size()),
        NoticeKind::Info,
    );
    if plan.tell() {
        notice(&plan.time_notice(), NoticeKind::Info);
    }
    with_date_progress(&mut search, request.progress_every)?;
    Ok(Some(search.finish()))
}

/// Steps `search` with the line of a date search's progress, shown every `every` combinations.
pub(crate) fn with_date_progress<S>(search: &mut S, every: u64) -> Result<(), Stop>
where
    S: Search,
    S::Error: 'static,
{
    let mut line = ProgressLine::new(0);
    let every = u32::try_from(every).unwrap_or(u32::MAX);
    let ran = run_search(search, every, |progress| {
        let noun = if progress.matched == 1 {
            "match"
        } else {
            "matches"
        };
        line.show(&format!(
            "Checked {}/{} date combinations; found {} {noun}.",
            progress.checked,
            progress.total.unwrap_or(progress.checked),
            progress.matched
        ));
    });
    line.end();
    ran
}

/// The shown matches as they are printed: on a terminal each a part of the result, for a script
/// one row of tab-separated fields each.
fn match_lines(matches: &[DateMatch], wallet: &GivenWallet) -> Vec<String> {
    if !can_redraw(Channel::Output) {
        return matches
            .iter()
            .map(|found| {
                let (dates, phrase) = (found.dates.as_str(), found.phrase.text());
                match &found.evidence {
                    None => format!("{dates}\t{}", phrase.as_str()),
                    Some(path) => {
                        format!("{dates}\t{}\t{}", phrase.as_str(), matched_at(Some(path)))
                    }
                }
            })
            .collect();
    }
    let mut lines = Vec::new();
    for (index, found) in matches.iter().enumerate() {
        let mut facts = vec![("Dates", found.dates.as_str().to_owned())];
        if let Some(path) = &found.evidence {
            let said = matched_on_terminal(Some(path), wallet.fingerprint);
            facts.push(("Wallet", said));
        }
        facts.push(("Phrase", found.phrase.text().as_str().to_owned()));
        lines.extend(candidate_lines(&format!("Match {}", index + 1), &facts));
    }
    lines
}

/// The title of the heading of the matches.
const MATCHES_TITLE: &str = "Date recovery";

/// The facts under that heading.
fn match_facts(result: &DateSearchOutcome, mode: Mode) -> [(&'static str, String); 3] {
    [
        ("Phrases", format!("{ORIGINAL}, for each set of dates")),
        ("Mode", mode.id().to_owned()),
        ("Matches", result.match_count.to_string()),
    ]
}

/// Shows the result: the heading with the mode and the number of matches, then each shown match;
/// with a wallet that none of the checksum-valid candidates matched, it says so.
pub(crate) fn report_date_matches(
    result: &DateSearchOutcome,
    mode: Mode,
    wallet: &GivenWallet,
    max_results: u64,
) {
    let layout = result_header(MATCHES_TITLE, &match_facts(result, mode), Channel::Output);
    if result.match_count == 0 {
        let sentence = match &wallet.label {
            Some(label) if result.checksum_valid > 0 => format!(
                "None of the {} matched the requested {label}.",
                counted(result.checksum_valid, "checksum-valid candidate")
            ),
            _ => "No candidate with a valid BIP39 checksum was found.".to_owned(),
        };
        // Running text wraps at a terminal (CORE-36); a file or a pipe keeps it on one line.
        if layout {
            print(Channel::Output, &wrap_text(&sentence, TEXT_WIDTH));
        } else {
            print(Channel::Output, &[sentence]);
        }
        return;
    }
    print(Channel::Output, &match_lines(&result.shown, wallet));
    if result.match_count > max_results {
        notice(
            &format!(
                "Displayed {max_results} of {} checksum-valid candidates.",
                result.match_count
            ),
            NoticeKind::Info,
        );
    }
}

/// The notes after shown matches: what a valid checksum proves, or what the wallet check did, with
/// the warning that the check gave with its matches.
fn date_notes(wallet: &GivenWallet, warning: Option<&str>) -> Vec<ResultNote> {
    match &wallet.label {
        None => vec![
            ResultNote::Notice(
                "A valid checksum does not prove the date: compare an address.".to_owned(),
                NoticeKind::Info,
            ),
            ResultNote::More("exact-local-recovery-checks"),
        ],
        Some(label) => {
            let mut notes = vec![ResultNote::Notice(
                format!("Each displayed candidate matched the requested {label} locally."),
                NoticeKind::Info,
            )];
            notes.extend(warning.map(|text| ResultNote::Lasting(text.to_owned())));
            notes
        }
    }
}

/// Writes the notes after shown matches.
pub(crate) fn date_match_notes(wallet: &GivenWallet, warning: Option<&str>) {
    date_notes(wallet, warning).iter().for_each(print_note);
}

/// The lines of those notes, for a check of the room on the screen.
fn date_note_lines(wallet: &GivenWallet, warning: Option<&str>) -> Vec<String> {
    date_notes(wallet, warning)
        .iter()
        .flat_map(note_lines)
        .collect()
}

/// The choice that asks for the encoded seed phrase once more; after a file, it is typed.
pub(crate) fn backup_choice<T>(parsed: &Parsed, value: T) -> Choice<T> {
    if from_file(parsed) {
        Choice::noted(TYPE_ENCODED_LABEL, "instead of the file", value)
    } else {
        Choice::new(TYPE_ENCODED_AGAIN_LABEL, value)
    }
}

/// The choice that asks for the dates again, after a phrase that cannot be the right one.
pub(crate) fn dates_again_choice<T>(value: T) -> Choice<T> {
    Choice::new(DATES_AGAIN_LABEL, value)
}

/// What comes after a date search: a step of the command, or a search with another wallet.
#[derive(Debug)]
pub(crate) enum AfterDateSearch {
    Dates,
    Backup,
    Done,
    /// The same search, with what the person said of the wallet.
    Search(Option<AskedEvidence>),
}

/// What the question after a date search needs from its command.
pub(crate) struct AfterSearch<'a> {
    pub(crate) mode: Mode,
    pub(crate) max_results: u64,
    /// The options the codes were read with.
    pub(crate) parsed: &'a Parsed,
    pub(crate) explanation: Explanation,
    /// Whether a candidate list is written, which holds every match up to its limit.
    pub(crate) listing: bool,
}

/// What the person may choose after a search.
#[derive(Clone, Copy)]
enum AfterChoice {
    Dates,
    Backup,
    Done,
    Wallet,
    ChangeWallet,
}

/// The question itself, with the answers that fit the result.
fn after_search_choice(
    result: &DateSearchOutcome,
    wallet: &GivenWallet,
    question: &AfterSearch<'_>,
) -> Result<AfterChoice, Stop> {
    let done = Choice::new("Stop", AfterChoice::Done);
    let dates = Choice::new(CHANGE_DATES_LABEL, AfterChoice::Dates);
    let check = check_wallet_answer(AfterChoice::Wallet, "only those that match");
    if result.match_count == 0 {
        let mut choices = vec![dates];
        if wallet.check.is_some() {
            choices.push(change_wallet_answer(AfterChoice::ChangeWallet));
        }
        choices.push(backup_choice(question.parsed, AfterChoice::Backup));
        choices.push(done);
        return after_failure(WHAT_NOW, &choices, AfterFailure::default());
    }
    if question.listing && !mnemocode::candidates::format::candidate_list_holds(result.match_count)
    {
        return after_failure(
            WHAT_NOW,
            &[
                Choice::noted(
                    "Give the wallet",
                    "its fingerprint or an address",
                    AfterChoice::Wallet,
                ),
                dates,
                stop_without_list_answer(AfterChoice::Done),
            ],
            AfterFailure::default(),
        );
    }
    // A list holds every match already; with a wallet, every match is one the wallet confirmed.
    if question.listing || wallet.check.is_some() {
        return Ok(AfterChoice::Done);
    }
    let narrower = Choice::noted(
        CHANGE_DATES_LABEL,
        "fewer ? give fewer candidates",
        AfterChoice::Dates,
    );
    let finished = Choice::new("Done", AfterChoice::Done);
    if result.match_count > question.max_results {
        return after_failure(
            &format!("Not every candidate is shown. {WHAT_NOW}"),
            &[check, narrower, finished],
            AfterFailure::default(),
        );
    }
    // The private screen keeps no scrollback: matches above its top could not be read.
    if !matches_fit_screen(result, question.mode, wallet) {
        return after_failure(
            &format!("Not every candidate fits on the screen. {WHAT_NOW}"),
            &[check, narrower, finished],
            AfterFailure::default(),
        );
    }
    Ok(AfterChoice::Done)
}

/// Whether the matches shown fit on the private screen with the lines around them.
fn matches_fit_screen(result: &DateSearchOutcome, mode: Mode, wallet: &GivenWallet) -> bool {
    if !on_private_screen() || !can_redraw(Channel::Output) {
        return true;
    }
    let facts = match_facts(result, mode);
    let beside = rows_of(&result_lines(Channel::Output, MATCHES_TITLE, &facts))
        + rows_of(&date_note_lines(wallet, result.warning))
        + CLOSING_ROWS;
    rows_of(&match_lines(&result.shown, wallet)) + beside <= rows()
}

/// Asks what to change after a date search whose result cannot be used; a wallet asked for here is
/// asked at once, and Escape there asks this again.
pub(crate) fn ask_after_date_search(
    result: &DateSearchOutcome,
    wallet: &GivenWallet,
    question: &AfterSearch<'_>,
) -> Result<AfterDateSearch, Stop> {
    loop {
        let change = match after_search_choice(result, wallet, question)? {
            AfterChoice::Dates => return Ok(AfterDateSearch::Dates),
            AfterChoice::Backup => return Ok(AfterDateSearch::Backup),
            AfterChoice::Done => return Ok(AfterDateSearch::Done),
            AfterChoice::Wallet => false,
            AfterChoice::ChangeWallet => true,
        };
        // "It cannot" only where it changes the search: in place of a wallet that matched none.
        let optional = change && !wallet_needed(question.mode);
        match ask_wallet_evidence(optional, Some(&question.explanation), &wallet.place)? {
            WalletAnswer::Back => {}
            WalletAnswer::Wallet(evidence) => return Ok(AfterDateSearch::Search(Some(evidence))),
            WalletAnswer::None => return Ok(AfterDateSearch::Search(None)),
        }
    }
}
