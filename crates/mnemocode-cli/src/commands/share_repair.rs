//! The command-line side of shares typed to restore or export a seed phrase (MnemoCode TS 0.1.0's
//! `cli/share-repair.ts`): the questions for the shares, a share typed again or left out, the lines
//! of a repair's assessment and report, and the question before a long search and its progress. On
//! the private screen a share that cannot be used is typed again, or left out, while the others are
//! kept; elsewhere the problem ends the command. What the shares are, and what is wrong with them,
//! the library decides.

use std::fmt;
use std::path::Path;

use mnemocode::recovery::shares::{
    MarkedShares, SearchLimits, SharesRead, assessed, marked_search_decision, read_shares,
};
use mnemocode::refusal::Refusal;
use mnemocode::search::Search;
use mnemocode::search::plan::counting;
use mnemocode::secret::SecretText;
use mnemocode::sskr::joint::{
    JointAssessor, MAX_REPAIR_COMBINATIONS, pace_sample, tries_per_second,
};
use mnemocode::sskr::marks::is_marked;
use mnemocode::sskr::repair::report::{
    DateWork, FILLED_HEADING, RepairReport, ReportLine, ShareRepairs,
};
use mnemocode::sskr::restore::{MarkedElement, SetShare, ShareSet};
use mnemocode::sskr::typed::{
    SHARE_SEPARATOR, SHARE_SEPARATOR_BYTE, ShareInput, ShareTrouble, TroubleKind, share_word_hints,
};

use super::asking::{
    AfterFailure, WHAT_NOW, after_failure, or_back_or_cancel, secret_until, value_until,
};
use super::given::{DECODE_ENTRY, PATH_LIMIT, SHARE_SET_LIMIT, read_qr_path};
use super::searching::{Refusal as SearchRefusal, SearchNotAllowed, ask_to_search, run_search};
use crate::args::{Parsed, assert_asked_not_given, integer_option, is_on, values};
use crate::gate::Stop;
use crate::input::{Ask, dropped_path, read_input_path, read_input_text, secret_ask};
use crate::terminal::{
    Channel, Choice, Chosen, ListQuestion, NoticeKind, ProgressLine, SEARCH_PROGRESS_SECONDS,
    TEXT_WIDTH, can_redraw, choose, error_line, hint, more_line, notice, on_private_screen, paint,
    printable, seconds_of, status, step_begin, style,
};

/// The options that give shares, each of which may be repeated, and which --ask-secrets asks for
/// on the private screen instead.
pub(crate) const SHARE_SOURCE_OPTIONS: [&str; 3] = ["share", "share-file", "share-qr"];
/// What a refusal of a file of shares names it by.
const SHARE_FILE: &str = "The share file";
/// A share's combinations between two looks at the progress.
const PROGRESS_EVERY: u32 = 4096;
/// Indent of the rows of repaired elements, under the text after the "!" of their heading.
const REPAIR_INDENT: &str = "    ";
/// Spaces between the share and its elements, and between two elements.
const REPAIR_GAP: &str = "   ";

/// The refusals of the shares as they are given.
#[derive(Debug)]
enum ShareSourceError {
    StandardInputOnce,
    NoShare,
}

impl fmt::Display for ShareSourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::StandardInputOnce => "Standard input can only be read once.",
            Self::NoShare => {
                "Provide at least one complete share in a text file, in a QR image, or through --ask-secrets. Additional share sources may be repeated."
            }
        })
    }
}

impl std::error::Error for ShareSourceError {}

impl Refusal for ShareSourceError {
    fn code(&self) -> &'static str {
        match self {
            Self::StandardInputOnce => "cli.sskr-restore-command.standard-input-can-only-read-once",
            Self::NoShare => "cli.sskr-restore-command.provide-at-least-one-complete-share-as-text",
        }
    }
}

/// How shares are typed in one answer, which every question for shares says.
fn separator_hint() -> String {
    format!("separate shares with {SHARE_SEPARATOR}")
}

/// How shares are typed in one answer, with the marks of what cannot be read.
pub(crate) fn share_answer_hint() -> String {
    format!("{}, ? for each unreadable code or digit", separator_hint())
}

/// A share that another command's question took, such as Decode's, and where it came from.
#[derive(Debug)]
pub(crate) struct FirstShare {
    pub(crate) text: SecretText,
    /// Read from a QR code image: the next share is offered from one as well.
    pub(crate) from_qr: bool,
}

/// Prints the lines of a report, each in the style of its kind.
pub(crate) fn print_lines(lines: &[ReportLine]) {
    for line in lines {
        match line {
            ReportLine::Status { label, value, good } => status(label, value, *good),
            ReportLine::More(anchor) => error_line(&more_line(anchor)),
            ReportLine::Hint(text) => hint(text),
            ReportLine::Warning(text) => notice(text, NoticeKind::Warning),
            ReportLine::Notice(text) => notice(text, NoticeKind::Info),
        }
    }
}

/// How a question for shares is asked.
fn share_ask<'h>(prompt: &str, what: &str, hints: &'h dyn crate::terminal::Hints) -> Ask<'h> {
    Ask {
        text_file: Some(SHARE_FILE),
        hints: Some(hints),
        pasted_line_break: Some(SHARE_SEPARATOR_BYTE),
        ..secret_ask(prompt, what, SHARE_SET_LIMIT)
    }
}

/// The shares typed, kept in memory while one of them is typed again, left out or joined by more,
/// each with the place it was typed at. A share that cannot be read is typed again at once, alone,
/// or left out.
#[derive(Debug)]
pub(crate) struct TypedShares {
    /// The shares and their places, and every check of them; a seed phrase typed in place of a
    /// share is sent to the menu's entry that decodes it.
    pub(crate) input: ShareInput,
    /// Whether the last share came from a QR code image, so that the next is offered from one too.
    from_qr: bool,
}

impl TypedShares {
    /// No shares yet.
    fn new() -> Self {
        Self {
            input: ShareInput::new(DECODE_ENTRY),
            from_qr: false,
        }
    }

    /// The shares after `first`, one given where another question asked (Decode): it is checked as
    /// a typed share is, shown when it came from a QR code image, and the others are asked for when
    /// the restore finds it too few.
    pub(crate) fn starting_with(first: &FirstShare) -> Result<Self, Stop> {
        let mut shares = Self::new();
        let parts = shares.input.shares_of_answer(first.text.as_str(), false)?;
        shares.input.add(&parts)?;
        if first.from_qr {
            shares.from_qr = true;
            shares.show_read();
        }
        shares.retype_unreadable()?;
        Ok(shares)
    }

    /// The shares of the options, the files and the QR images.
    fn given(parsed: &Parsed) -> Result<Self, Stop> {
        let files = values(parsed, "share-file");
        if files.iter().filter(|path| **path == "-").count() > 1 {
            return Err(ShareSourceError::StandardInputOnce.into());
        }
        let mut shares = Self::new();
        shares.input.add(&values(parsed, "share"))?;
        for path in files {
            let text = if path == "-" {
                read_input_text(path, "The text input", SHARE_SET_LIMIT)?
            } else {
                read_input_path(Path::new(path), SHARE_FILE, SHARE_SET_LIMIT, false)?
            };
            let parts = shares.input.shares_of_text(&text, "The file holds")?;
            shares.input.add(&parts)?;
        }
        for path in values(parsed, "share-qr") {
            shares
                .input
                .add(&[read_qr_path(Path::new(path), false)?.as_str()])?;
        }
        if shares.input.list().is_empty() {
            return Err(ShareSourceError::NoShare.into());
        }
        Ok(shares)
    }

    /// Asks on the private screen or reads the options.
    pub(crate) fn read(parsed: &Parsed) -> Result<Self, Stop> {
        if !is_on(parsed, "ask-secrets") {
            return Self::given(parsed);
        }
        assert_asked_not_given(parsed, &SHARE_SOURCE_OPTIONS)?;
        let mut shares = Self::new();
        shares.ask_all()?;
        Ok(shares)
    }

    /// The place of each share, in the order typed.
    pub(crate) fn places(&self) -> Vec<usize> {
        self.input.places()
    }

    /// Asks for every share in one answer, in place of any typed before.
    fn ask_all(&mut self) -> Result<(), Stop> {
        let hints = share_word_hints();
        let prompt = format!("Shamir shares or text file path ({}):", share_answer_hint());
        let ask = share_ask(&prompt, "the shares or their text file path", &hints);
        let input = &self.input;
        let texts = secret_until(&ask, |answer: &str| input.shares_of_answer(answer, false))?;
        self.from_qr = false;
        self.input.replace_all(&texts)?;
        self.retype_unreadable()
    }

    /// Asks for more shares, which are added after those given. After a share read from a QR code
    /// image, such as the one Decode read, the next may be read from one too, or typed.
    pub(crate) fn ask_more(&mut self) -> Result<(), Stop> {
        let texts = if self.from_qr {
            self.ask_next_share()?
        } else {
            self.type_more()?
        };
        self.input.add(&texts)?;
        self.show_read();
        self.retype_unreadable()
    }

    /// More shares, typed in one answer.
    fn type_more(&mut self) -> Result<Vec<String>, Stop> {
        self.from_qr = false;
        let hints = share_word_hints();
        let prompt = format!("More shares or text file path ({}):", separator_hint());
        let ask = share_ask(&prompt, "the shares to add", &hints);
        let input = &self.input;
        secret_until(&ask, |answer: &str| input.shares_of_answer(answer, true))
    }

    /// The next share read from a QR code image, or more shares typed, as the person chooses;
    /// Escape at the file name chooses again.
    fn ask_next_share(&mut self) -> Result<Vec<String>, Stop> {
        loop {
            if !self.ask_source()? {
                return self.type_more();
            }
            let input = &self.input;
            let texts = value_until(
                "QR code file name:",
                "the name of the QR code image of a share",
                PATH_LIMIT,
                None,
                |answer: &str| -> Result<Vec<String>, String> {
                    let text =
                        read_qr_path(&dropped_path(answer), true).map_err(|stop| stop.message())?;
                    input
                        .shares_of_answer(text.as_str(), true)
                        .map_err(|error| error.to_string())
                },
            )?;
            if let Some(texts) = texts {
                return Ok(texts);
            }
        }
    }

    /// Whether the next share is read from another QR code image; Escape types it.
    fn ask_source(&self) -> Result<bool, Stop> {
        let note = format!("separated by {SHARE_SEPARATOR}, ? for each unreadable code");
        let choices = [
            Choice::noted("Read another QR code image", "the PNG of one share", true),
            // Shorter than the question's own hint, so that the note fits its list.
            Choice::noted("Type the shares", &note, false),
        ];
        let asked = ListQuestion {
            question: "The next share?",
            label: "Shares",
            quit: "types them",
            explanation: None,
        };
        match choose(&asked, None, &choices)? {
            Chosen::One(read) => Ok(read),
            Chosen::Back => Ok(false),
            Chosen::Cancelled => Err(Stop::Cancelled),
        }
    }

    /// Shows the share just read from a QR code image as text, under its place.
    fn show_read(&self) {
        if !self.from_qr {
            return;
        }
        if let Some(share) = self.input.list().last() {
            // An image may hold any text: it is shown without its control characters.
            status(
                &format!("Share {}, from its QR code:", share.place),
                &printable(share.text.as_str()),
                true,
            );
        }
    }

    /// Asks for the share at `place` again until it can be read. After `warning`, and after an
    /// answer that still cannot be read, the share may be left out instead while others remain, so
    /// that a part that is no share, such as a heading pasted with the shares, does not have to be
    /// replaced.
    pub(crate) fn retype(&mut self, place: usize, warning: Option<String>) -> Result<(), Stop> {
        let mut problem = warning;
        loop {
            if let Some(text) = problem.take() {
                notice(&text, NoticeKind::Warning);
                if self.input.list().len() > 1 && self.ask_leave_out(place)? {
                    return Ok(());
                }
            }
            let hints = share_word_hints();
            let prompt = format!("Share {place} again, or its text file path:");
            let what = format!("share {place} or its text file path");
            let ask = Ask {
                pasted_line_break: None,
                ..share_ask(&prompt, &what, &hints)
            };
            let input = &self.input;
            let text = secret_until(&ask, |answer: &str| -> Result<String, String> {
                let mut parts = input
                    .shares_of_answer(answer, false)
                    .map_err(|error| error.to_string())?;
                if parts.len() != 1 {
                    return Err(
                        "Give one share here, or a text file containing just that share."
                            .to_owned(),
                    );
                }
                Ok(parts.remove(0))
            })?;
            problem = self
                .input
                .read_problem(place, &text)
                .map(|trouble| trouble.message);
            if problem.is_none() {
                self.input.replace(place, &text)?;
                return Ok(());
            }
        }
    }

    /// Asks whether the share at `place` is left out or typed again, after a warning about it, and
    /// leaves it out if so. Escape types it again, which loses nothing.
    fn ask_leave_out(&mut self, place: usize) -> Result<bool, Stop> {
        let out = after_failure(
            WHAT_NOW,
            &[
                Choice::noted(
                    &format!("Leave share {place} out"),
                    "the others are kept",
                    true,
                ),
                Choice::new(&format!("Type share {place} again"), false),
            ],
            AfterFailure {
                escape: "types it again",
                ..AfterFailure::default()
            },
        )?;
        if out {
            self.input.leave_out(place);
        }
        Ok(out)
    }

    /// Asks which share, unless only one was typed; none when the person goes back.
    fn chosen_place(&self) -> Result<Option<usize>, Stop> {
        let list = self.input.list();
        if let [only] = list {
            return Ok(Some(only.place));
        }
        let choices: Vec<Choice<usize>> = list
            .iter()
            .map(|share| {
                let label = format!("Share {}", share.place);
                if is_marked(share.text.as_str()) {
                    Choice::noted(&label, "with ?", share.place)
                } else {
                    Choice::new(&label, share.place)
                }
            })
            .collect();
        let asked = ListQuestion {
            question: "Which share?",
            label: "Share",
            quit: "goes back",
            explanation: None,
        };
        match choose(&asked, None, &choices)? {
            Chosen::One(place) => Ok(Some(place)),
            Chosen::Back => Ok(None),
            Chosen::Cancelled => Err(Stop::Cancelled),
        }
    }

    /// Each share that cannot be read is typed again, with why, until it can be, or left out.
    fn retype_unreadable(&mut self) -> Result<(), Stop> {
        for place in self.places() {
            let problem = self
                .input
                .list()
                .iter()
                .find(|share| share.place == place)
                .and_then(|share| self.input.read_problem(place, share.text.as_str()));
            if let Some(problem) = problem {
                self.retype(place, Some(problem.message))?;
            }
        }
        Ok(())
    }
}

/// What the shares as typed give, or their first problem: complete shares are read and checked as
/// a set, copies left out with a note, and restored; shares with ? are assessed together, during
/// which Ctrl+C is read as a key, and the assessment is shown. No combination is searched yet.
pub(crate) fn assess_shares(shares: &mut TypedShares) -> Result<SharesRead, Stop> {
    let input = &mut shares.input;
    let read = if input.marked() {
        if let Some(trouble) = input.first_unreadable() {
            return Ok(SharesRead::Trouble {
                trouble,
                lines: Vec::new(),
            });
        }
        let tries = tries_per_second(seconds_of(|| {
            pace_sample();
            Ok::<_, Stop>(())
        })?);
        let places = input.places();
        let mut assessor = JointAssessor::new(&input.texts(), Some(&places))?;
        run_search(&mut assessor, PROGRESS_EVERY, |_| {})?;
        assessed(assessor.finish(), places, tries)?
    } else {
        read_shares(input)?
    };
    print_lines(match &read {
        SharesRead::Trouble { lines, .. } => lines,
        SharesRead::Complete(complete) => &complete.lines,
        SharesRead::Marked(marked) => &marked.lines,
    });
    Ok(read)
}

/// What can be done about shares that restore nothing, or nothing that is wanted.
#[derive(Clone, Copy)]
enum ShareFix {
    One,
    Out,
    All,
    More,
}

/// The answer that asks for more shares after those typed, with `value`.
pub(crate) fn add_more_shares<T>(value: T) -> Choice<T> {
    Choice::new("Add more shares", value)
}

/// Asks which share to change after a refusal that names none or several, or a search without a
/// result: one share typed again, one left out (while others remain), every share typed again, more
/// shares, or Stop, which cancels. `question` by default "What now?"; with `back`, Escape goes back
/// (`Ok(false)`), for a question reached from another; otherwise Escape is Stop. Escape at the list
/// of shares asks again.
pub(crate) fn ask_share_fix(
    shares: &mut TypedShares,
    question: Option<&str>,
    back: bool,
) -> Result<bool, Stop> {
    let question = question.unwrap_or(WHAT_NOW);
    loop {
        let mut choices = vec![Choice::noted(
            "Type one share again",
            "the others are kept",
            ShareFix::One,
        )];
        if shares.input.list().len() > 1 {
            choices.push(Choice::noted(
                "Leave a share out",
                "the others are kept",
                ShareFix::Out,
            ));
        }
        choices.push(Choice::new("Type every share again", ShareFix::All));
        choices.push(add_more_shares(ShareFix::More));
        let Some(fix) = or_back_or_cancel(question, &choices, back)? else {
            return Ok(false);
        };
        match fix {
            ShareFix::All => shares.ask_all()?,
            ShareFix::More => shares.ask_more()?,
            ShareFix::One | ShareFix::Out => {
                // Escape at the list of shares asks this question again.
                let Some(place) = shares.chosen_place()? else {
                    continue;
                };
                match fix {
                    ShareFix::Out => shares.input.leave_out(place),
                    _ => shares.retype(place, None)?,
                }
            }
        }
        return Ok(true);
    }
}

/// Mends a problem of the shares on the private screen, after one warning line; elsewhere the
/// problem ends the command, refused with the code of its condition. Too few asks for more shares.
pub(crate) fn mend_shares(
    shares: &mut TypedShares,
    trouble: ShareTrouble,
    interactive: bool,
) -> Result<(), Stop> {
    if !interactive {
        return Err(trouble.into());
    }
    if trouble.kind == TroubleKind::Unreadable {
        let place = trouble.place.unwrap_or(1);
        return shares.retype(place, Some(trouble.message));
    }
    notice(&trouble.message, NoticeKind::Warning);
    match (trouble.kind, trouble.place) {
        (TroubleKind::Few, _) => shares.ask_more(),
        (TroubleKind::Refused, _) | (_, None) => ask_share_fix(shares, None, false).map(|_| ()),
        (_, Some(place)) => {
            if shares.ask_leave_out(place)? {
                Ok(())
            } else {
                shares.retype(place, None)
            }
        }
    }
}

// Shares with unreadable elements.

/// The combinations that --max-tries allows without a question, read before any secret is asked;
/// none without it, when a search of up to twelve hours goes ahead.
pub(crate) fn search_limit(parsed: &Parsed) -> Result<Option<u64>, Stop> {
    if !parsed.contains_key("max-tries") {
        return Ok(None);
    }
    let range = mnemocode::text::numbers::WholeRange::new(1, MAX_REPAIR_COMBINATIONS);
    Ok(Some(integer_option(
        parsed,
        "max-tries",
        range,
        None,
        None,
    )?))
}

/// Runs the search of marked shares, after asking on the private screen when it is longer than
/// `limits` allow; elsewhere a longer search needs --max-tries. With `dates`, the date search that
/// follows for each phrase found is counted in the time, and named in the question. Every set
/// found, possibly none; none at all when the person chose not to search.
pub(crate) fn search_share_repair(
    marked: MarkedShares,
    limits: SearchLimits,
    dates: Option<DateWork>,
) -> Result<Option<Vec<ShareSet>>, Stop> {
    let decision = marked_search_decision(&marked, dates, limits);
    if let Some(question) = &decision.question {
        if !on_private_screen() {
            let report = &marked.report;
            let mut allowances = vec![("max-tries", report.combinations() as u64)];
            allowances.extend(dates.map(|work| ("max-candidates", work.combinations)));
            return Err(SearchNotAllowed {
                extent: report.search_extent(dates),
                allowances,
                code: "cli.share-repair.search-share-repair-refused",
            }
            .into());
        }
        // Keys typed during the assessment do not answer this.
        let no = SearchRefusal {
            note: "change the shares",
            quit: "changes the shares",
        };
        if !ask_to_search(question, no)? {
            return Ok(None);
        }
    }
    // The search is a step of its own: its screen shows the title and the search, no longer the
    // shares typed or the question answered before it (CORE-39). A question said its time already.
    step_begin();
    if decision.question.is_none()
        && let Some(told) = &decision.notice
    {
        notice(told, NoticeKind::Info);
    }
    let Some(mut search) = marked.plan.search() else {
        return Ok(Some(Vec::new()));
    };
    let mut line = ProgressLine::new(SEARCH_PROGRESS_SECONDS);
    let ran = run_search(&mut search, PROGRESS_EVERY, |progress| {
        let total = progress.total.unwrap_or(progress.checked);
        // The end is said by the result, not by a last line of progress.
        if progress.checked == total {
            return;
        }
        line.show_every(|| {
            format!(
                "Checked {}%: {} of {}; {} found.",
                u128::from(progress.checked) * 100 / u128::from(total.max(1)),
                counting(progress.checked),
                counting(total),
                progress.found
            )
        });
    });
    line.end();
    ran?;
    Ok(Some(search.finish().sets))
}

/// The rows of the repairs: the share in grey, then each element's position in grey and what was
/// filled in bold, a guess with a yellow "?", the elements of one share wrapped under each other
/// within the width of running text.
fn repair_rows(repairs: &[ShareRepairs]) -> Vec<String> {
    let channel = Channel::Error;
    let label = |share: usize| format!("Share {share}");
    let elements = || repairs.iter().flat_map(|repair| &repair.elements);
    let label_width = repairs
        .iter()
        .map(|r| label(r.share).len())
        .max()
        .unwrap_or(0);
    let position_width = elements()
        .map(|e| e.position.to_string().len())
        .max()
        .unwrap_or(0);
    let value_width = elements()
        .map(|e| e.value.chars().count())
        .max()
        .unwrap_or(0);
    // A position, a space, the value and the room for the "?" of a guess.
    let cell_width = position_width + 1 + value_width + 1;
    let room = TEXT_WIDTH.saturating_sub(REPAIR_INDENT.len() + label_width);
    let per_row = (room / (REPAIR_GAP.len() + cell_width)).max(1);
    let mut rows = Vec::new();
    for repair in repairs {
        let cells: Vec<String> = repair
            .elements
            .iter()
            .map(|element| {
                let position = paint(
                    channel,
                    style::MUTED,
                    &format!("{:>position_width$}", element.position),
                );
                let mark = if element.guess {
                    paint(channel, style::WARNING, "?")
                } else {
                    " ".to_owned()
                };
                let pad = " ".repeat(value_width - element.value.chars().count());
                format!(
                    "{position} {}{mark}{pad}",
                    paint(channel, style::STRONG, &element.value)
                )
            })
            .collect();
        for (index, row) in cells.chunks(per_row).enumerate() {
            let name = if index == 0 {
                label(repair.share)
            } else {
                String::new()
            };
            let name = paint(channel, style::MUTED, &format!("{name:<label_width$}"));
            let line = format!("{REPAIR_INDENT}{name}{REPAIR_GAP}{}", row.join(REPAIR_GAP));
            rows.push(line.trim_end().to_owned());
        }
    }
    rows
}

/// Says, share by share, what a repair filled in where ? marked an element, each share named by its
/// place in `places`, by its index in the set.
pub(crate) fn report_repairs(
    shares: &[SetShare],
    unsettled: &[MarkedElement],
    places: Option<&[usize]>,
) {
    let repairs = RepairReport::repairs_of(shares, unsettled, places);
    if repairs.is_empty() || !can_redraw(Channel::Error) {
        print_lines(&RepairReport::repair_lines_of(shares, unsettled, places));
        return;
    }
    // On a terminal as a table, a row for each share, so that each element is found at a glance.
    notice(FILLED_HEADING, NoticeKind::Warning);
    repair_rows(&repairs).iter().for_each(|row| error_line(row));
    // The notes after the repairs, as the library tells them for every host.
    print_lines(&RepairReport::notes_of(shares, unsettled));
}
