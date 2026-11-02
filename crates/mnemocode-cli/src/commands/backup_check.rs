//! After Encode shows its result on the private screen, the person may check the backup they have
//! written down (MnemoCode TS 0.1.0's `cli/backup-check.ts`): they type it again, with the dates,
//! and MnemoCode says whether it restores the same seed phrase. Most losses come from a backup
//! written wrongly, not from theft. The check is offered, never required, and shows nothing of the
//! seed phrase. The screen is cleared before it, so that the backup is typed from the paper rather
//! than copied from the screen. The rules and their lines are the library's; this module asks and
//! shows. A part that can be read but is not the one of the result is named, and the person chooses
//! to type only that part again, to see the result again, or to stop; the other parts are kept.

use std::fmt;

use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::{Date, Dates};
use mnemocode::forms::hints::{LineWordHints, codes_list};
use mnemocode::modes::Mode;
use mnemocode::recovery::backup_check::shares::{
    KeptShares, RestoredShares, ShareBackupCheck, ShareCheckError, ShareOriginal,
};
use mnemocode::recovery::backup_check::{
    BackupFinding, BackupPart, EncodedBackupCheck, EncodedOriginal, NextFinding, PartChecks,
    RESTORES_MESSAGE, next_finding,
};
use mnemocode::refusal::Refusal;
use mnemocode::sskr::typed::share_word_hints;

use mnemocode::sskr::typed::SHARE_SEPARATOR_BYTE;

use super::asking::{AfterFailure, WHAT_NOW, after_failure, secret_until};
use super::backup_questions::CODES_AGAIN_LABEL;
use super::date_search::{DATES_AGAIN_LABEL, ask_dates};
use super::given::{DECODE_ENTRY, PHRASE_LIMIT, SHARE_SET_LIMIT};
use super::share_repair::share_answer_hint;
use crate::args::{Parsed, choice_option, is_on};
use crate::gate::Stop;
use crate::input::{Ask, secret_ask};
use crate::terminal::{
    Choice, Chosen, ListQuestion, NoticeKind, choose, clear_private_screen, error_line, notice,
    on_private_screen, terminal_available,
};

/// The refusals of --backup-check.
#[derive(Debug)]
enum BackupCheckError {
    NeedsPrivateScreen,
    NothingToCheck,
}

impl fmt::Display for BackupCheckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NeedsPrivateScreen => {
                "--backup-check answers a question of the private screen after the result, which needs a terminal."
            }
            Self::NothingToCheck => {
                "--backup-check has nothing to check: a record with a replaced last word cannot be checked."
            }
        })
    }
}

impl std::error::Error for BackupCheckError {}

impl Refusal for BackupCheckError {
    fn code(&self) -> &'static str {
        match self {
            Self::NeedsPrivateScreen => {
                "cli.backup-check.backup-check-answers-question-private-screen"
            }
            Self::NothingToCheck => {
                "cli.backup-check.backup-check-nothing-check-record-replaced-last-word"
            }
        }
    }
}

/// --backup-check, checked before any secret is asked: whether to check, none to ask it. It answers
/// a question of the private screen; without that screen it is refused (CORE-41).
pub(crate) fn backup_check_answer(parsed: &Parsed) -> Result<Option<bool>, Stop> {
    let Some(given) = choice_option(parsed, "backup-check", &["yes", "no"])? else {
        return Ok(None);
    };
    if !terminal_available() {
        return Err(BackupCheckError::NeedsPrivateScreen.into());
    }
    if is_on(parsed, "legacy-valid-last-word") {
        return Err(BackupCheckError::NothingToCheck.into());
    }
    Ok(Some(given == "yes"))
}

/// What the person chose after a part that does not fit.
#[derive(Clone, Copy)]
enum AfterMismatch {
    Again,
    Show,
    Stop,
}

/// Says what does not fit, in one line, and asks what to do.
fn after_mismatch(found: &BackupFinding) -> Result<AfterMismatch, Stop> {
    notice(&found.message, NoticeKind::Warning);
    let again = match found.part {
        BackupPart::Codes => CODES_AGAIN_LABEL,
        BackupPart::Dates => DATES_AGAIN_LABEL,
        BackupPart::Shares => "Type the shares again",
    };
    after_failure(
        WHAT_NOW,
        &[
            Choice::new(again, AfterMismatch::Again),
            Choice::new("Show the result again", AfterMismatch::Show),
            Choice::new("Stop checking", AfterMismatch::Stop),
        ],
        AfterFailure::default(),
    )
}

/// One check of a backup in the library's order: what was written down, asked with `ask`, then the
/// dates, each compared at once and typed again, as the person chooses after a mismatch, until they
/// fit; what still fits is kept. Whether the result is to be shown again.
fn run_check<C: PartChecks>(
    steps: &C,
    mut ask: impl FnMut() -> Result<C::Written, Stop>,
) -> Result<bool, Stop>
where
    <C as PartChecks>::Written: fmt::Debug,
{
    let mut written: Option<C::Written> = None;
    let mut dates: Option<Dates> = None;
    loop {
        let typed = match written.take() {
            Some(typed) => typed,
            None => ask()?,
        };
        let mut found = next_finding(steps, &typed, dates.as_ref())?;
        if found == NextFinding::Dates {
            let answer = ask_dates(Some(steps.word_count()), false, None, |_| Ok(()))?;
            let known = answer.known().clone();
            found = next_finding(steps, &typed, Some(&known))?;
            dates = Some(known);
        }
        let NextFinding::Found(found) = found else {
            notice(RESTORES_MESSAGE, NoticeKind::Success);
            return Ok(false);
        };
        match after_mismatch(&found)? {
            AfterMismatch::Show => return Ok(true),
            AfterMismatch::Stop => return Ok(false),
            AfterMismatch::Again if found.part == BackupPart::Dates => {
                dates = None;
                written = Some(typed);
            }
            AfterMismatch::Again => {}
        }
    }
}

/// Asks whether to check the backup now; Escape answers No.
fn ask_to_check(what: &str, dated: bool) -> Result<bool, Stop> {
    error_line("");
    let dates = if dated { ", and the dates" } else { "" };
    let note = format!("type {what} you wrote down{dates}");
    let asked = ListQuestion {
        question: "Check the backup now?",
        label: "Check",
        // Escape answers No: there is no earlier question to go back to.
        quit: "skips the check",
        explanation: None,
    };
    let choices = [Choice::noted("Yes", &note, true), Choice::new("No", false)];
    // Only a key pressed for this question answers it, not an Enter typed during a long save.
    match choose(&asked, None, &choices)? {
        Chosen::One(wanted) => Ok(wanted),
        Chosen::Back => Ok(false),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// Offers the check on the private screen, and repeats it as long as the person wants. `check` runs
/// one check; `show` puts the result on the screen again; `answer` answers the first question.
fn offer_check(
    (what, dated): (&str, bool),
    mut check: impl FnMut() -> Result<bool, Stop>,
    show: &mut dyn FnMut() -> Result<(), Stop>,
    answer: Option<bool>,
) -> Result<(), Stop> {
    let mut given = answer;
    loop {
        let wanted = match given.take() {
            Some(wanted) => wanted,
            None => ask_to_check(what, dated)?,
        };
        if !wanted {
            return Ok(());
        }
        clear_private_screen();
        if !check()? {
            return Ok(());
        }
        clear_private_screen();
        show()?;
    }
}

/// The check after an encoded seed phrase; not for a legacy record with a replaced last word.
pub(crate) fn offer_encoded_check(
    original: EncodedOriginal,
    show: &mut dyn FnMut() -> Result<(), Stop>,
    answer: Option<bool>,
) -> Result<(), Stop> {
    if !on_private_screen() || !EncodedBackupCheck::supports(original.mode) {
        return Ok(());
    }
    let check = EncodedBackupCheck::new(original)?;
    let hints = LineWordHints::new(codes_list, |line| line);
    let ask = Ask {
        hints: Some(&hints),
        ..secret_ask(
            "Your backup, as written down:",
            "the backup you wrote down",
            PHRASE_LIMIT,
        )
    };
    offer_check(
        ("the backup", check.dated()),
        || {
            run_check(&check, || {
                secret_until(&ask, |typed: &str| check.read_codes(typed))
            })
        },
        show,
        answer,
    )
}

/// Asks for the shares until each can be read: a share that cannot be read is named and typed again
/// alone, and the others are kept. `problem`, shown first, is why the last ones did not do.
fn ask_shares(check: &ShareBackupCheck, problem: Option<&str>) -> Result<Vec<String>, Stop> {
    if let Some(problem) = problem {
        notice(problem, NoticeKind::Warning);
    }
    let hints = share_word_hints();
    let prompt = format!(
        "{} shares as written down ({}):",
        check.threshold(),
        share_answer_hint()
    );
    let ask = Ask {
        hints: Some(&hints),
        pasted_line_break: Some(SHARE_SEPARATOR_BYTE),
        ..secret_ask(&prompt, "the shares", SHARE_SET_LIMIT)
    };
    let mut shares: Vec<String> = secret_until(&ask, |answer: &str| check.shares_of(answer))?;
    loop {
        let unreadable = shares.iter().enumerate().find_map(|(index, share)| {
            check
                .share_problem(index + 1, share)
                .map(|trouble| (index, trouble))
        });
        let Some((index, trouble)) = unreadable else {
            return Ok(shares);
        };
        notice(&trouble.message, NoticeKind::Warning);
        let place = index + 1;
        let prompt = format!("Share {place} as written down:");
        let what = format!("share {place}");
        let ask = Ask {
            hints: Some(&hints),
            ..secret_ask(&prompt, &what, SHARE_SET_LIMIT)
        };
        shares[index] = secret_until(&ask, |answer: &str| {
            check
                .share_problem(place, answer)
                .map_or_else(|| Ok(answer.to_owned()), |trouble| Err(trouble.message))
        })?;
    }
}

/// The shares typed again and restored: exact copies are left out once, with a note each, as
/// sskr-combine does. Shares that cannot be restored are typed again.
fn ask_restored_shares(check: &ShareBackupCheck) -> Result<RestoredShares, Stop> {
    let mut problem = None;
    loop {
        let shares = ask_shares(check, problem.as_deref())?;
        let kept = KeptShares::of(&shares);
        for note in kept.notes() {
            notice(note, NoticeKind::Info);
        }
        match check.restore(&kept) {
            Ok(restored) => return Ok(restored),
            // Only shares that cannot be restored are typed again (AUD-037-API002).
            Err(error @ ShareCheckError::Mode(_)) => return Err(error.into()),
            Err(error) => problem = Some(error.to_string()),
        }
    }
}

/// The check after Shamir shares: enough of them typed again, with the dates. With the `dates` of
/// the result, a wrong date is named by its place before anything is restored with it.
pub(crate) fn offer_share_check(
    original: &Phrase,
    (mode, threshold): (Mode, usize),
    show: &mut dyn FnMut() -> Result<(), Stop>,
    answer: Option<bool>,
    dates: &[Date],
) -> Result<(), Stop> {
    if !on_private_screen() {
        return Ok(());
    }
    let check = ShareBackupCheck::new(
        ShareOriginal {
            phrase: original.copy(),
            mode,
            threshold,
            dates: Some(Dates::new(dates)),
        },
        DECODE_ENTRY,
    )?;
    offer_check(
        (&format!("{threshold} shares"), check.dated()),
        || run_check(&check, || ask_restored_shares(&check)),
        show,
        answer,
    )
}
