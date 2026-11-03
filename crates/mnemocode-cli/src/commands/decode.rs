//! `mnemocode decode` (MnemoCode TS 0.1.0's `cli/decode-command.ts`): an encoded seed phrase turned
//! back into the words. From the command line every input is given, and one that cannot be used
//! ends the command. With --ask-secrets, on the private screen, each answer is checked as soon as
//! it is given and asked again, and the other answers are kept. Once the codes are checked, the
//! fingerprint of the encoded phrase is shown before the dates are asked, so that a mistyped code
//! shows before any date is typed. A date may hold ? for each forgotten digit: the dates are then
//! searched as recover-date searches them, with the wallet, which is optional where the checksum
//! alone leaves only some of the dates. Options answer the questions that are no secret: the
//! wallet, the encoded fingerprint, whether to list the candidates, the limits, and what a text
//! that may be a Shamir share is read as.

use std::fmt;
use std::rc::Rc;

use mnemocode::backup::Backup;
use mnemocode::bip32::fingerprint_hex;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::Date;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::forms::Form;
use mnemocode::modes::phrase_words::{ORIGINAL, ORIGINAL_FINGERPRINT};
use mnemocode::modes::seedshift::Unmasked;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::recovery::date_search::{wallet_needed, wallet_reason};
use mnemocode::recovery::marked::MissingCodes;
use mnemocode::recovery::marked_search::MissingCodesFound;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode::wallet::evidence::parse_master_fingerprint;

use super::asking::{AfterFailure, WHAT_NOW, after_failure};
use super::backup_questions::{
    BackupQuestion, ReadBackup, ask_encoded_backup, input_kind_of, show_encoded_fingerprint,
    typed_after_file,
};
use super::date_search::{
    AfterDateSearch, AfterSearch, DateRequest, PROGRESS_EVERY, ask_after_date_search, ask_dates,
    backup_choice, date_match_notes, dates_again_choice, max_candidates_of, max_results_of,
    report_date_matches, search_dates, wallet_explanation,
};
use super::encode::fingerprint_of;
use super::found::{candidate_label, report_checksum, show_original_phrase};
use super::given::{
    assert_asked_encoded_input, assert_one_encoded_source, backup_from_options, dates, given_form,
    transform_mode,
};
use super::marked_search::{
    MissingCodesAnswers, MissingOutcome, report_found, search_missing_codes,
};
use super::share_repair::{FirstShare, search_limit};
use super::sskr_combine::{self, Restored};
use super::wallet_options::{GivenWallet, WALLET_EVIDENCE_OPTIONS, given_wallet};
use super::wallet_question::{WalletAnswer, ask_wallet_evidence};
use crate::args::{Parsed, is_on, value};
use crate::gate::Stop;
use crate::terminal::result::{FINGERPRINT_NOTE, print, print_part, print_phrase, result_header};
use crate::terminal::{
    Channel, Choice, Explanation, NoticeKind, TEXT_WIDTH, can_redraw, clear_private_screen,
    fact_line, hint_lines, leave_result, notice, on_private_screen, wrap_text,
};

/// The options that answer questions of the private screen only, besides the wallet's: from the
/// command line nothing would use them.
const SCREEN_ANSWERS: [&str; 6] = [
    "encoded-fingerprint",
    "list-candidates",
    "max-candidates",
    "max-results",
    "max-tries",
    "input-kind",
];

/// The options `decode` takes.
pub(crate) const OPTIONS: [&str; 29] = [
    "ask-secrets",
    "mode",
    "input",
    "input-file",
    "qr-file",
    "date",
    "dates-file",
    "format",
    "words",
    "encoded-fingerprint",
    "list-candidates",
    "max-candidates",
    "max-results",
    "max-tries",
    "input-kind",
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
    "scan-gap",
    "bip39-passphrase-file",
];

/// The refusals of the command's options.
#[derive(Debug)]
enum DecodeError {
    /// An answer of a question that nothing asks from the command line.
    ScreenAnswer(String),
    /// --list-candidates beside a wallet.
    ListWithWallet,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ScreenAnswer(key) => write!(
                f,
                "--{key} answers a question of decode --ask-secrets, where the dates or the codes may hold ?."
            ),
            Self::ListWithWallet => {
                f.write_str("--list-candidates lists the candidates instead of a wallet check.")
            }
        }
    }
}

impl std::error::Error for DecodeError {}

impl Refusal for DecodeError {
    fn code(&self) -> &'static str {
        match self {
            Self::ScreenAnswer(_) => {
                "cli.decode-command.answers-question-decode-ask-secrets-where-dates-codes"
            }
            Self::ListWithWallet => {
                "cli.decode-command.list-candidates-lists-candidates-instead-wallet-check"
            }
        }
    }
}

/// The words `result` holds, and its phrase where its checksum is valid.
pub(crate) fn words_of(result: &Unmasked) -> Result<(SecretText, Option<Phrase>), Stop> {
    let words = Form::English.codes(result.recovered.as_slice())?;
    let phrase = if result.checksum_valid {
        Some(Phrase::parse(words.as_str())?)
    } else {
        None
    };
    Ok((words, phrase))
}

/// The recovered phrase, its checksum and, when the checksum is valid, its fingerprint: on a
/// terminal apart, each under its label; for a file or a pipe the phrase on one line.
pub(crate) fn show_recovered(
    result: &Unmasked,
    mode: Mode,
    form: Form,
    channel: Channel,
) -> Result<(), Stop> {
    let (words, phrase) = words_of(result)?;
    let facts = [
        ("Mode", mode.id().to_owned()),
        ("Input format", form.name().to_owned()),
        ("Words", result.recovered.as_slice().len().to_string()),
    ];
    if result_header("Recovered result", &facts, channel) {
        return show_original_phrase(words.as_str(), phrase.as_ref(), channel);
    }
    print(channel, &[words.as_str().to_owned()]);
    report_checksum(phrase.as_ref())
}

/// Where the checksum failed, the phrases of fewer words that the first codes give with a valid
/// checksum, each by its fingerprint, never by its words: codes typed from printed cards end with
/// decoys, which --words leaves out.
fn report_shorter_phrases(backup: &Backup, dates: &[Date]) -> Result<(), Stop> {
    let shorter = backup.shorter_phrases(dates)?;
    let Some((first, _)) = shorter.first() else {
        return Ok(());
    };
    let mut listed = Vec::new();
    for (words, result) in &shorter {
        let (_, phrase) = words_of(result)?;
        let fingerprint = phrase.as_ref().map_or(Ok(String::new()), fingerprint_of)?;
        listed.push(format!("{words} words, fingerprint {fingerprint}"));
    }
    notice(
        &format!(
            "The first codes give a phrase with a valid checksum: {}. Printed cards end with codes that belong to nothing; give the number of words of the phrase (--words {first}).",
            listed.join("; ")
        ),
        NoticeKind::Warning,
    );
    Ok(())
}

/// The candidates on the private screen, as a result is shown (CORE-36): its heading, the summary
/// and what the fingerprints are, wrapped, then each candidate numbered for writing down.
fn show_candidate_parts(candidates: &[(String, String)], summary: &str, mode: Mode, form: Form) {
    let count = candidates.len();
    let facts = [
        ("Mode", mode.id().to_owned()),
        ("Input format", form.name().to_owned()),
        ("Candidates", count.to_string()),
    ];
    result_header("Recovered candidates", &facts, Channel::Output);
    print(Channel::Output, &[String::new()]);
    print(Channel::Output, &wrap_text(summary, TEXT_WIDTH));
    let label = ORIGINAL_FINGERPRINT;
    let note = format!("Each {} uses an {FINGERPRINT_NOTE}.", label.to_lowercase());
    print(Channel::Output, &hint_lines(Channel::Output, &note));
    for (index, (words, fingerprint)) in candidates.iter().enumerate() {
        let number = candidate_label(index as u64 + 1);
        print_part(&format!("{number} of {count}"), true, Channel::Output);
        print_phrase(words, Channel::Output);
        print(
            Channel::Output,
            &[fact_line(Channel::Output, label, fingerprint, label.len())],
        );
    }
}

/// Every phrase that a record with a replaced last word may hold, each with its fingerprint: on
/// the private screen as a result, elsewhere one row each, for a script.
fn show_legacy_valid_candidates(backup: &Backup, dates: &[Date]) -> Result<(), Stop> {
    let mut candidates = Vec::new();
    for candidate in backup.candidates(dates)? {
        let (words, phrase) = words_of(&candidate)?;
        let fingerprint = phrase.as_ref().map_or(Ok(String::new()), fingerprint_of)?;
        candidates.push((words.as_str().to_owned(), fingerprint));
    }
    let summary = format!(
        "Recovered {} checksum-valid candidates for {ORIGINAL}.",
        candidates.len()
    );
    let (mode, form) = (backup.mode(), backup.form());
    if on_private_screen() && can_redraw(Channel::Output) {
        show_candidate_parts(&candidates, &summary, mode, form);
        return Ok(());
    }
    for (index, (words, fingerprint)) in candidates.iter().enumerate() {
        print(
            Channel::Output,
            &[format!("{}\t{words}\t{fingerprint}", index + 1)],
        );
    }
    print(
        Channel::Error,
        &[format!(
            "{summary} The final column is the original BIP32 master fingerprint for an empty BIP39 passphrase."
        )],
    );
    Ok(())
}

/// The encoded seed phrase and its complete dates from the options, as Decode reads them; Re-encode
/// reads an old backup so. The dates are counted as soon as the mode is known, so that a wrong count
/// is refused before the form of the codes is asked about.
pub(crate) fn backup_and_dates_from_options(parsed: &Parsed) -> Result<(Backup, Vec<Date>), Stop> {
    let mut entered = Vec::new();
    let backup = backup_from_options(parsed, false, |mode| {
        entered = dates(parsed)?;
        Ok(mode.check_date_count(entered.len(), false, DateWords::Codes)?)
    })?;
    Ok((backup, entered))
}

/// Every input from the options; a problem ends the command.
fn decode_from_options(parsed: &Parsed) -> Result<(), Stop> {
    let unused = WALLET_EVIDENCE_OPTIONS
        .iter()
        .chain(&SCREEN_ANSWERS)
        .find(|key| parsed.contains_key(**key));
    if let Some(key) = unused {
        return Err(DecodeError::ScreenAnswer((*key).to_owned()).into());
    }
    let (backup, entered) = backup_and_dates_from_options(parsed)?;
    if backup.gives_several() {
        return show_legacy_valid_candidates(&backup, &entered);
    }
    let result = backup.decode(&entered)?;
    show_recovered(&result, backup.mode(), backup.form(), Channel::Output)?;
    if !result.checksum_valid {
        report_shorter_phrases(&backup, &entered)?;
    }
    Ok(())
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    if is_on(parsed, "ask-secrets") {
        return decode_with_questions(parsed, &mut DecodeItself);
    }
    decode_from_options(parsed)
}

// On the private screen.

/// The line of a wallet question that says which BIP39 passphrase `tool` compares the wallet with.
/// A wallet made with another one does not match, whatever the dates.
pub(crate) fn compared_passphrase(tool: &str, with_passphrase: bool) -> String {
    if with_passphrase {
        format!("{tool} compares it with the BIP39 passphrase of --bip39-passphrase-file.")
    } else {
        format!("{tool} compares it without a BIP39 passphrase.")
    }
}

/// Why the wallet is asked for before a search, shown with the question.
fn decode_wallet_explanation(mode: Mode, with_passphrase: bool) -> Explanation {
    wallet_explanation(
        Some(mode),
        Some(compared_passphrase("Decode", with_passphrase)),
    )
}

/// What is asked or done next on the private screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Backup,
    Dates,
    Wallet,
    Search,
    Decode,
    LastWord,
    Done,
}

/// What the questions of Decode are for: Decode shows the phrase they decode; Re-encode confirms it
/// and encodes it again, from the whole backup.
pub(crate) trait DecodeUse {
    /// Whether codes and dates with ? are taken and searched.
    fn searches(&self) -> bool;
    /// Restores a share given for the codes, then uses its original phrase.
    fn restore(&mut self, handed: &Parsed, share: FirstShare) -> Result<Restored, Stop>;
    /// The choice that ends after a phrase whose checksum fails, beside typing again.
    fn stop(&self) -> Choice<Step>;
    /// What follows a record that gives several phrases.
    fn several(&mut self, backup: &Backup, dates: &[Date]) -> Result<Step, Stop>;
    /// What follows a phrase with a valid checksum, shown already.
    fn decoded(&mut self, backup: &Backup, dates: &[Date]) -> Result<Step, Stop>;
    /// Shows the decoded phrase: Decode's result on standard output, re-encode's on the terminal.
    fn show(&self, result: &Unmasked, mode: Mode, form: Form) -> Result<(), Stop>;
}

/// Decode itself: the phrase shown, a record's several phrases listed, and done.
struct DecodeItself;

impl DecodeUse for DecodeItself {
    fn searches(&self) -> bool {
        true
    }

    fn restore(&mut self, handed: &Parsed, share: FirstShare) -> Result<Restored, Stop> {
        sskr_combine::restore_from_share(handed, share, None)
    }

    fn stop(&self) -> Choice<Step> {
        Choice::noted("Done", "keep this result", Step::Done)
    }

    fn several(&mut self, backup: &Backup, dates: &[Date]) -> Result<Step, Stop> {
        // The result is a step of its own: the questions are cleared away.
        clear_private_screen();
        show_legacy_valid_candidates(backup, dates)?;
        Ok(Step::Done)
    }

    fn decoded(&mut self, _backup: &Backup, _dates: &[Date]) -> Result<Step, Stop> {
        Ok(Step::Done)
    }

    fn show(&self, result: &Unmasked, mode: Mode, form: Form) -> Result<(), Stop> {
        show_recovered(result, mode, form, Channel::Output)
    }
}

/// The answers that decode's options give its questions, each checked before the first question.
struct GivenAnswers {
    encoded_fingerprint: Option<String>,
    list: bool,
    max_candidates: Option<u64>,
    max_results: u64,
}

/// The answers of the options, so that none is lost to a wrong value later: the encoded fingerprint,
/// whether to list the candidates, and the limits. Refuses --list-candidates beside a wallet.
fn given_answers(parsed: &Parsed, wallet: &GivenWallet) -> Result<GivenAnswers, Stop> {
    // Read only by a restore from shares, after a share typed here: checked now all the same.
    search_limit(parsed)?;
    let list = is_on(parsed, "list-candidates");
    if list && wallet.check.is_some() {
        return Err(DecodeError::ListWithWallet.into());
    }
    let encoded_fingerprint = value(parsed, "encoded-fingerprint")
        .map(parse_master_fingerprint)
        .transpose()?;
    Ok(GivenAnswers {
        encoded_fingerprint,
        list,
        max_candidates: max_candidates_of(parsed)?,
        max_results: max_results_of(parsed)?,
    })
}

/// Decode's options that the restore from shares takes too, for a share typed for the codes.
fn handed_to_restore(parsed: &Parsed) -> Parsed {
    parsed
        .iter()
        .filter(|(key, _)| sskr_combine::OPTIONS.contains(&key.as_str()))
        .map(|(key, given)| (key.clone(), given.clone()))
        .collect()
}

/// The step after the dates: the search when a date holds ?, otherwise the decoding.
fn after_dates(dates: &DatesAnswer) -> Step {
    if dates.has_forgotten_digits() {
        Step::Wallet
    } else {
        Step::Decode
    }
}

/// The encoded fingerprint of `backup`, shown under the codes; none for no fingerprint.
pub(crate) fn encoded_fingerprint_of(backup: &Backup) -> Result<Option<String>, Stop> {
    Ok(backup.fingerprint()?.map(fingerprint_hex))
}

/// The step after the codes of `backup`: the decoding of an unmasked phrase; for a masked one, once
/// its encoded fingerprint is shown, the dates, or the step after `typed`, which still count when
/// the new phrase takes them.
fn step_after_codes(backup: &Backup, typed: Option<&Rc<DatesAnswer>>) -> Result<Step, Stop> {
    if !backup.mode().masked() {
        return Ok(Step::Decode);
    }
    show_encoded_fingerprint(encoded_fingerprint_of(backup)?.as_deref());
    Ok(match typed {
        Some(dates) if dates.fits_phrase(backup.words()) => after_dates(dates),
        _ => Step::Dates,
    })
}

/// The codes in hand, and what a search of marked codes said of them.
#[derive(Default)]
struct Codes {
    backup: Option<Backup>,
    /// The search of marked codes that found them: its codes and what it found, whose dates decode
    /// them as they are and whose lines are shown again with the result.
    found: Option<(MissingCodes, Box<MissingCodesFound>)>,
}

impl Codes {
    /// The backup, read before any step that uses it.
    fn backup(&self) -> Option<&Backup> {
        self.backup
            .as_ref()
            .or_else(|| self.found.as_ref().map(|(_, found)| &found.backup))
    }
}

/// The answers of decode on the private screen, in this order, each checked at once: the encoded
/// seed phrase and everything that can be checked before the dates, the dates, which may hold ?,
/// then either the decoding or, for dates with ?, the wallet (optional where the mode's checksum
/// leaves only some dates) and the search. A result that cannot be right offers what to type again;
/// every other answer is kept. `purpose` says what the decoded phrase is for.
pub(crate) fn decode_with_questions(
    parsed: &Parsed,
    purpose: &mut dyn DecodeUse,
) -> Result<(), Stop> {
    assert_asked_encoded_input(parsed)?;
    // The values of the options are checked before the first question, so that none is lost.
    assert_one_encoded_source(parsed)?;
    transform_mode(parsed, None)?;
    given_form(parsed)?;
    let mut wallet = given_wallet(parsed)?;
    let given = given_answers(parsed, &wallet)?;
    let input_kind = input_kind_of(parsed)?;
    let mut backup_parsed = parsed.clone();
    let mut codes = Codes::default();
    // The mode that a record header named, for codes typed after it without one.
    let mut record_mode = None;
    let mut typed_dates: Option<Rc<DatesAnswer>> = None;
    // "It cannot" at the wallet question, or --list-candidates, kept for dates typed again; a mode
    // that needs the wallet asks for it all the same.
    let mut without_wallet = given.list;
    let mut step = Step::Backup;
    while step != Step::Done {
        // An answer under a result led here: this step is not drawn under it (CORE-39).
        leave_result();
        step = match step {
            Step::Backup => {
                codes = Codes::default();
                let read = ask_encoded_backup(BackupQuestion {
                    parsed: &backup_parsed,
                    seedshift_only: false,
                    record_mode,
                    marks: purpose.searches(),
                    shares: true,
                    input_kind,
                })?;
                match read {
                    ReadBackup::Share(text, from_qr) => {
                        // A Shamir share typed here is restored from, with its mode if Decode was
                        // given one.
                        let first = FirstShare { text, from_qr };
                        match purpose.restore(&handed_to_restore(parsed), first)? {
                            Restored::Done => return Ok(()),
                            // Escape at the question whether Seedshift was used: the codes again.
                            Restored::Back => Step::Backup,
                        }
                    }
                    ReadBackup::Missing(marked, named) => {
                        record_mode = named.or(record_mode);
                        let answers = MissingCodesAnswers {
                            wallet: &wallet,
                            encoded_fingerprint: given.encoded_fingerprint.as_deref(),
                            list: given.list,
                            max_candidates: given.max_candidates,
                        };
                        match search_missing_codes(&marked, answers)? {
                            MissingOutcome::Shown => Step::Done,
                            MissingOutcome::Again => Step::Backup,
                            MissingOutcome::Found(found) => {
                                let complete = found.dates.is_some();
                                let next = if complete {
                                    Step::Decode
                                } else {
                                    step_after_codes(&found.backup, typed_dates.as_ref())?
                                };
                                codes.found = Some((marked, found));
                                next
                            }
                        }
                    }
                    ReadBackup::Codes(backup, named) => {
                        record_mode = named.or(record_mode);
                        let next = step_after_codes(&backup, typed_dates.as_ref())?;
                        codes.backup = Some(backup);
                        next
                    }
                }
            }
            Step::LastWord => {
                let current = codes
                    .backup()
                    .and_then(|backup| backup.last_word_replacement().transpose());
                codes.backup = current.transpose()?;
                Step::Decode
            }
            Step::Dates => {
                let word_count = codes.backup().map(Backup::words);
                let asked = ask_dates(word_count, purpose.searches(), None, |_| Ok(()))?;
                let next = after_dates(&asked);
                typed_dates = Some(Rc::new(asked));
                next
            }
            Step::Wallet => match codes.backup() {
                Some(backup) => asked_wallet(backup, &given, &mut wallet, &mut without_wallet)?,
                None => Step::Backup,
            },
            Step::Search => match (codes.backup(), &typed_dates) {
                (Some(backup), Some(dates)) => {
                    let next = search_and_show(backup, dates, &mut wallet, &backup_parsed, &given)?;
                    without_wallet = wallet.check.is_none();
                    next
                }
                _ => Step::Backup,
            },
            Step::Decode => {
                decode_and_show(&codes, typed_dates.as_deref(), &backup_parsed, purpose)?
            }
            Step::Done => Step::Done,
        };
        // The same file would give the same phrase: it is typed this time, and its mode asked again
        // unless --mode or a record named it.
        if step == Step::Backup {
            backup_parsed = typed_after_file(parsed);
        }
    }
    Ok(())
}

/// The wallet before a search of dates with ?: asked unless it was given, or unless it was left out
/// before ("It cannot", or --list-candidates) and the mode needs none.
fn asked_wallet(
    backup: &Backup,
    given: &GivenAnswers,
    wallet: &mut GivenWallet,
    without_wallet: &mut bool,
) -> Result<Step, Stop> {
    let mode = backup.mode();
    let needed = wallet_needed(mode);
    if needed && given.list && wallet.check.is_none() {
        notice(
            &format!(
                "--list-candidates does not apply here. {}",
                wallet_reason(Some(mode))
            ),
            NoticeKind::Warning,
        );
    }
    if wallet.check.is_some() || (*without_wallet && !needed) {
        return Ok(Step::Search);
    }
    let explanation = decode_wallet_explanation(mode, wallet.with_passphrase);
    let answer = ask_wallet_evidence(!needed, Some(&explanation), &wallet.place)?;
    *without_wallet = matches!(answer, WalletAnswer::None);
    Ok(match answer {
        WalletAnswer::Back => Step::Dates,
        WalletAnswer::None => Step::Search,
        WalletAnswer::Wallet(evidence) => {
            wallet.set_evidence(Some(evidence));
            Step::Search
        }
    })
}

/// Decodes with complete dates and shows the result, then does what `purpose` says with it. A
/// phrase without a valid checksum, which the Original Seedshift gives for a wrong date or code,
/// offers to type the dates or the codes again; `backup_parsed` are the options the codes were read
/// with.
fn decode_and_show(
    codes: &Codes,
    typed: Option<&DatesAnswer>,
    backup_parsed: &Parsed,
    purpose: &mut dyn DecodeUse,
) -> Result<Step, Stop> {
    let Some(backup) = codes.backup() else {
        return Ok(Step::Backup);
    };
    let found_dates = codes
        .found
        .as_ref()
        .and_then(|(_, found)| found.dates.as_ref());
    let known: Vec<Date> = found_dates
        .or(typed.map(DatesAnswer::known))
        .map_or_else(Vec::new, |dates| dates.iter().collect());
    let (mode, form) = (backup.mode(), backup.form());
    if backup.gives_several() {
        return purpose.several(backup, &known);
    }
    let result = backup.decode(&known)?;
    // The result is a step of its own: the questions are cleared away.
    clear_private_screen();
    if let Some((marked, found)) = &codes.found {
        report_found(marked, found)?;
    }
    purpose.show(&result, mode, form)?;
    if result.checksum_valid {
        return purpose.decoded(backup, &known);
    }
    report_shorter_phrases(backup, &known)?;
    let replaced = backup.last_word_replacement()?;
    let mut choices = Vec::new();
    if replaced.is_some() {
        notice(
            "A date or code may be wrong. If the Legacy backup's last word was replaced to make its checksum valid, choose that option; the original last word is needed to restore the phrase.",
            NoticeKind::Warning,
        );
        choices.push(Choice::new("The last word was replaced", Step::LastWord));
    }
    if mode.masked() {
        choices.push(dates_again_choice(Step::Dates));
    }
    choices.push(backup_choice(backup_parsed, Step::Backup));
    choices.push(purpose.stop());
    after_failure(WHAT_NOW, &choices, AfterFailure::default())
}

/// Searches the dates with ?, shows the matches as recover-date shows them, and asks what to change
/// when no match was found, or, without a wallet, when not every match is shown or the matches are
/// taller than the window. `backup_parsed` are the options the codes were read with.
fn search_and_show(
    backup: &Backup,
    dates: &Rc<DatesAnswer>,
    wallet: &mut GivenWallet,
    backup_parsed: &Parsed,
    given: &GivenAnswers,
) -> Result<Step, Stop> {
    let mode = backup.mode();
    let max_results = given.max_results;
    let result = search_dates(DateRequest {
        indexes: backup.indexes(),
        dates: Rc::clone(dates),
        mode,
        wallet,
        max_results,
        max_candidates: given.max_candidates,
        progress_every: PROGRESS_EVERY,
        keep: None,
    })?;
    // A search longer than twelve hours that the person did not want: the dates are typed again.
    let Some(result) = result else {
        return Ok(Step::Dates);
    };
    report_date_matches(&result, mode, wallet, max_results);
    if result.match_count > 0 {
        date_match_notes(wallet, result.warning);
    }
    let question = AfterSearch {
        mode,
        max_results,
        parsed: backup_parsed,
        explanation: decode_wallet_explanation(mode, wallet.with_passphrase),
        listing: false,
    };
    Ok(match ask_after_date_search(&result, wallet, &question)? {
        AfterDateSearch::Dates => Step::Dates,
        AfterDateSearch::Backup => Step::Backup,
        AfterDateSearch::Done => Step::Done,
        AfterDateSearch::Search(evidence) => {
            wallet.set_evidence(evidence);
            Step::Search
        }
    })
}
