//! `mnemocode recover-date` (MnemoCode TS 0.1.0's `cli/recover-date-command.ts`,
//! CAP-RECOVERY-DATE-SEARCH): finds the forgotten digits of the dates of a Seedshift backup. From
//! the command line every input is given, and one that cannot be used ends the command. With
//! --ask-secrets, on the private screen, each answer is checked as soon as it is given and asked
//! again, and a search without a usable result offers what to change; the other answers are kept.

use std::fmt;
use std::rc::Rc;

use mnemocode::backup::Backup;
use mnemocode::candidates::format::{LIST_KEEP, ListError, candidate_list_holds};
use mnemocode::dates::answer::{AnswerError, DatesAnswer};
use mnemocode::modes::Mode;
use mnemocode::recovery::date_search::{DateSearchOutcome, NARROW_DATE_SEARCH, wallet_needed};
use mnemocode::refusal::Refusal;

use super::backup_questions::{
    BackupQuestion, ask_encoded_codes, show_encoded_fingerprint, typed_after_file,
};
use super::candidates_file::CandidatesFile;
use super::date_search::{
    AfterDateSearch, AfterSearch, DateRequest, ask_after_date_search, ask_dates, date_match_notes,
    max_candidates_of, max_results_of, progress_every_of, recovery_dates_prompt,
    report_date_matches, search_dates, wallet_explanation,
};
use super::decode::encoded_fingerprint_of;
use super::given::{
    assert_asked_encoded_input, backup_from_options, date_input_text, given_form, transform_mode,
};
use super::wallet_options::{GivenWallet, given_wallet};
use super::wallet_question::{WalletAnswer, ask_wallet_evidence};
use crate::args::{Parsed, is_on, value};
use crate::gate::Stop;
use crate::terminal::{NoticeKind, leave_result, notice};

/// The options `recover-date` takes.
pub(crate) const OPTIONS: [&str; 32] = [
    "mode",
    "input",
    "input-file",
    "qr-file",
    "date",
    "dates-file",
    "format",
    "words",
    "max-results",
    "max-candidates",
    "progress-every",
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

/// The refusals of the command.
#[derive(Debug)]
enum RecoverDateError {
    /// A mode in which every date gives a phrase, with no wallet to tell them apart.
    NoEvidence,
    /// A mode that masks nothing.
    SeedshiftOnly,
    /// No dates.
    NoDates,
}

impl fmt::Display for RecoverDateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NoEvidence => {
                "This recovery mode can produce checksum-valid candidates for every date. Provide a master fingerprint, address, public key, extended public key, or WIF to identify the intended wallet."
            }
            Self::SeedshiftOnly => {
                "Date recovery is available only when a Seedshift mode is selected."
            }
            Self::NoDates => "Provide dates, including at least one pattern containing ? digits.",
        })
    }
}

impl std::error::Error for RecoverDateError {}

impl Refusal for RecoverDateError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoEvidence => {
                "cli.recover-date-command.recovery-mode-can-produce-checksum-valid-candidates-every"
            }
            Self::SeedshiftOnly => "cli.recover-date-command.seedshift-mode-only",
            Self::NoDates => {
                "cli.recover-date-command.provide-dates-including-at-least-one-pattern-containing"
            }
        }
    }
}

/// Refuses a mode that gives a valid phrase for every date without a wallet to tell them apart.
fn check_evidence(mode: Mode, wallet: &GivenWallet) -> Result<(), RecoverDateError> {
    if wallet_needed(mode) && wallet.check.is_none() {
        return Err(RecoverDateError::NoEvidence);
    }
    Ok(())
}

/// The options of the command, read and checked before any question.
struct Settings {
    max_results: u64,
    progress_every: u64,
    /// The combinations searched without asking (--max-candidates); without it, twelve hours.
    max_candidates: Option<u64>,
    target: Option<CandidatesFile>,
    /// The wallet given with the options, if any, where a wallet asked on the private screen is
    /// looked for, and the owner of the BIP39 passphrase.
    wallet: GivenWallet,
}

impl Settings {
    /// Reads and checks every option before the first question, so that no answer is lost to an
    /// option that cannot be used.
    fn of(parsed: &Parsed) -> Result<Self, Stop> {
        let max_results = max_results_of(parsed)?;
        let progress_every = progress_every_of(parsed)?;
        let max_candidates = max_candidates_of(parsed)?;
        let target = CandidatesFile::of(parsed)?;
        // A record may name another mode or format; the reading settles that.
        let named_mode = value(parsed, "mode").is_some();
        if named_mode && !transform_mode(parsed, None)?.masked() {
            return Err(RecoverDateError::SeedshiftOnly.into());
        }
        given_form(parsed)?;
        let wallet = given_wallet(parsed)?;
        if !is_on(parsed, "ask-secrets") && named_mode {
            // From the command line nothing can be asked later; a record names its own mode.
            check_evidence(transform_mode(parsed, None)?, &wallet)?;
        }
        if target.is_some() {
            CandidatesFile::check_listable(wallet.passphrase())?;
        }
        Ok(Self {
            max_results,
            progress_every,
            max_candidates,
            target,
            wallet,
        })
    }

    /// The search of the command; none when the person chose not to make a longer one.
    fn search(
        &self,
        backup: &Backup,
        dates: &Rc<DatesAnswer>,
        mode: Mode,
    ) -> Result<Option<DateSearchOutcome>, Stop> {
        search_dates(DateRequest {
            indexes: backup.indexes(),
            dates: Rc::clone(dates),
            mode,
            wallet: &self.wallet,
            max_results: self.max_results,
            max_candidates: self.max_candidates,
            progress_every: self.progress_every,
            keep: self.target.is_some().then_some(LIST_KEEP as u64),
        })
    }

    /// Saves every match as a candidate list.
    fn save_list(&mut self, result: &DateSearchOutcome) -> Result<(), Stop> {
        match &mut self.target {
            Some(target) => target.save_phrases(&result.kept, self.wallet.passphrase()),
            None => Ok(()),
        }
    }

    /// Settles what the list needs before a search.
    fn prepare_list(&mut self) -> Result<(), Stop> {
        match &mut self.target {
            Some(target) => target.prepare(self.wallet.passphrase()),
            None => Ok(()),
        }
    }
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let mut settings = Settings::of(parsed)?;
    if is_on(parsed, "ask-secrets") {
        return recover_with_questions(parsed, &mut settings);
    }
    recover_from_options(parsed, &mut settings)
}

/// Every input from the options; a problem ends the command.
fn recover_from_options(parsed: &Parsed, settings: &mut Settings) -> Result<(), Stop> {
    let backup = backup_from_options(parsed, true, |_| Ok(()))?;
    let mode = backup.mode();
    if !mode.masked() {
        return Err(RecoverDateError::SeedshiftOnly.into());
    }
    check_evidence(mode, &settings.wallet)?;
    let typed = date_input_text(parsed)?;
    if typed.is_empty() {
        return Err(RecoverDateError::NoDates.into());
    }
    let dates = DatesAnswer::parse(&typed, Some(backup.words()), true)?;
    dates.check_incomplete()?;
    settings.prepare_list()?;
    let Some(result) = settings.search(&backup, &Rc::new(dates), mode)? else {
        // Asked on the private screen whether to make a longer search, the person said no.
        if let Some(target) = &settings.target {
            target.discard();
        }
        return Err(Stop::Cancelled);
    };
    report_date_matches(&result, mode, &settings.wallet, settings.max_results);
    if result.match_count == 0 {
        if let Some(target) = &settings.target {
            target.save_nothing();
        }
        return Ok(());
    }
    if settings.target.is_some() {
        if !candidate_list_holds(result.match_count) {
            return Err(ListError::TooManyForList(NARROW_DATE_SEARCH.to_owned()).into());
        }
        settings.save_list(&result)?;
    }
    date_match_notes(&settings.wallet, result.warning);
    Ok(())
}

/// What is asked next on the private screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Backup,
    Dates,
    Wallet,
    Search,
    Done,
}

/// Asks for the dates with ? until they can be used.
fn ask_recovery_dates(backup: &Backup) -> Result<DatesAnswer, Stop> {
    let word_count = Some(backup.words());
    ask_dates(
        word_count,
        true,
        Some(recovery_dates_prompt(word_count)),
        |dates: &DatesAnswer| -> Result<(), AnswerError> { dates.check_incomplete() },
    )
}

/// The answers of a recovery on the private screen, asked in this order, each checked at once: the
/// encoded seed phrase and what can be checked before the dates, after which its encoded fingerprint
/// is shown, as decode shows it, so that a mistyped code shows before a long search; the dates, the
/// wallet when the mode needs it and no option gave it, then the search. After a search without a
/// usable result the person chooses what to change; every other answer is kept.
fn recover_with_questions(parsed: &Parsed, settings: &mut Settings) -> Result<(), Stop> {
    assert_asked_encoded_input(parsed)?;
    let mut backup_parsed = parsed.clone();
    let mut backup: Option<Backup> = None;
    // The mode that a record header named, for codes typed after it without one.
    let mut record_mode = None;
    let mut dates: Option<Rc<DatesAnswer>> = None;
    // Whether the list was saved, and how many matched the last search, for a list that was not.
    let mut listed = false;
    let mut last_matches = 0;
    let mut step = Step::Backup;
    while step != Step::Done {
        // An answer under a result led here: this step is not drawn under it (CORE-39).
        leave_result();
        let current = backup.as_ref();
        step = match (step, current) {
            (Step::Backup, _) | (_, None) => {
                let (read, named) = ask_encoded_codes(BackupQuestion {
                    parsed: &backup_parsed,
                    seedshift_only: true,
                    record_mode,
                    marks: false,
                    shares: false,
                    input_kind: None,
                })?;
                record_mode = named.or(record_mode);
                show_encoded_fingerprint(encoded_fingerprint_of(&read)?.as_deref());
                // Dates kept from before still count if the new phrase takes as many.
                let keeps = dates
                    .as_ref()
                    .is_some_and(|dates| dates.fits_phrase(read.words()));
                backup = Some(read);
                if keeps { Step::Wallet } else { Step::Dates }
            }
            (Step::Dates, Some(current)) => {
                dates = Some(Rc::new(ask_recovery_dates(current)?));
                Step::Wallet
            }
            (Step::Wallet, Some(current)) => {
                let mode = current.mode();
                if settings.wallet.check.is_some() || !wallet_needed(mode) {
                    Step::Search
                } else {
                    let explanation = wallet_explanation(Some(mode), None);
                    let place = &settings.wallet.place;
                    match ask_wallet_evidence(false, Some(&explanation), place)? {
                        WalletAnswer::Back => Step::Dates,
                        WalletAnswer::None => Step::Search,
                        WalletAnswer::Wallet(evidence) => {
                            settings.wallet.set_evidence(Some(evidence));
                            Step::Search
                        }
                    }
                }
            }
            (Step::Search, Some(current)) => {
                let Some(answer) = dates.as_ref() else {
                    step = Step::Dates;
                    continue;
                };
                let mode = current.mode();
                settings.prepare_list()?;
                let Some(result) = settings.search(current, answer, mode)? else {
                    // A longer search that the person did not want: the dates are typed again.
                    step = Step::Dates;
                    continue;
                };
                report_date_matches(&result, mode, &settings.wallet, settings.max_results);
                let listing = settings.target.is_some();
                let listable = !listing || candidate_list_holds(result.match_count);
                last_matches = result.match_count;
                if result.match_count > 0 && listable {
                    settings.save_list(&result)?;
                    listed = true;
                    date_match_notes(&settings.wallet, result.warning);
                } else if !listable {
                    let refusal = ListError::TooManyForList(NARROW_DATE_SEARCH.to_owned());
                    notice(&refusal.to_string(), NoticeKind::Warning);
                }
                let question = AfterSearch {
                    mode,
                    max_results: settings.max_results,
                    parsed: &backup_parsed,
                    explanation: wallet_explanation(Some(mode), None),
                    listing,
                };
                match ask_after_date_search(&result, &settings.wallet, &question)? {
                    AfterDateSearch::Dates => Step::Dates,
                    AfterDateSearch::Backup => {
                        // The same file would give the same phrase: it is typed this time, and its
                        // mode asked again unless --mode or a record named it.
                        backup_parsed = typed_after_file(parsed);
                        Step::Backup
                    }
                    AfterDateSearch::Done => Step::Done,
                    AfterDateSearch::Search(evidence) => {
                        settings.wallet.set_evidence(evidence);
                        Step::Search
                    }
                }
            }
            (Step::Done, _) => Step::Done,
        };
    }
    let Some(target) = &settings.target else {
        return Ok(());
    };
    if !listed {
        if last_matches == 0 {
            target.save_nothing();
        } else {
            target.discard();
        }
    }
    Ok(())
}
