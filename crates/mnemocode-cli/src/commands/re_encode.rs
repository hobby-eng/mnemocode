//! `mnemocode re-encode` (MnemoCode TS 0.1.0's `cli/re-encode-command.ts`): an encoded backup made
//! again, with other dates, another mode or in another form, without its seed phrase being typed.
//! The old backup is read and decoded as Decode reads and decodes it, every code and date complete,
//! its dates asked right after its codes; a backup of the Original Seedshift with a valid last word
//! also takes the last word of the original phrase, which the person remembers. The phrase is shown,
//! and encoded again only once it is confirmed: the person recognises it or its fingerprint, or the
//! wallet has an address or the fingerprint they name. Its checksum confirms nothing. Then the new
//! backup is made as Encode makes it, from its options, or, with --ask-secrets and none of them,
//! from Encode's questions. Shares given instead of codes use Restore's questions and unmasking
//! first; only their original phrase reaches the same confirmation.

use std::fmt;

use mnemocode::backup::Backup;
use mnemocode::backup::re_encoding::{MatchedBy, ReEncoding, ReEncodingError, words};
use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::forms::hints::BIP39;
use mnemocode::modes::Mode;
use mnemocode::modes::seedshift::Unmasked;
use mnemocode::recovery::wallet_check::WalletCheck;
use mnemocode::refusal::Refusal;
use mnemocode::text::space::trim;

use super::asking::{AfterFailure, WHAT_NOW, after_failure, secret_until};
use super::date_search::{backup_choice, dates_again_choice};
use super::decode::{
    DecodeUse, Step, backup_and_dates_from_options, compared_passphrase, decode_with_questions,
    show_recovered, words_of,
};
use super::encode::{PreparedEncode, prepare_encode};
use super::encode_questions::{ask_encoding_in, ask_form};
use super::found::report_checksum;
use super::given::{DATES_OPTION, PHRASE_LIMIT, given_form, text_input, transform_mode};
use super::output_questions::forget_claimed;
use super::share_repair::FirstShare;
use super::sskr_combine::{self, PhrasesAt, Restored, RestoredNext};
use super::wallet_options::{
    AskedEvidence, GivenWallet, WALLET_EVIDENCE_OPTIONS, check_given_wallet, given_wallet,
    wallet_evidence_given,
};
use super::wallet_question::{WalletAnswer, ask_wallet_evidence};
use crate::args::{self, OLD_DATES_KEY, Parsed, assert_asked_not_given, is_on, value};
use crate::gate::Stop;
use crate::input::{Ask, assert_terminal, secret_ask};
use crate::os::{Needs, Protection};
use crate::output::{preflight, warn_of_cloud_copies};
use crate::terminal::result::part_line;
use crate::terminal::{
    Channel, Choice, Chosen, Explanation, Lifetime, ListQuestion, NoticeKind, can_redraw, choose,
    clear_private_screen, keep_context, lasting_warning, notice, notice_lines, readme_link,
    show_protection, wait_for_enter,
};

/// The option that answers the question below the phrase shown, as "Yes, I recognise it" does.
const RECOGNISED_OPTION: &str = "recognised";
/// The option that gives the last word of the original seed phrase.
const LAST_WORD_OPTION: &str = "last-word";
/// What a refusal of an option of the old backup begins with.
const OLD_BACKUP_REFUSAL: &str = "The old backup: ";
/// The question below the phrase shown.
const CONFIRM_QUESTION: &str = "Is this the seed phrase to re-encode?";

/// The options of the old backup, each with the name Decode reads it by.
const OLD_BACKUP_OPTIONS: [(&str, &str); 10] = [
    ("input", "input"),
    ("input-file", "input-file"),
    ("qr-file", "qr-file"),
    ("words", "words"),
    ("old-mode", "mode"),
    ("old-format", "format"),
    (OLD_DATES_KEY, "date"),
    ("old-dates-file", "dates-file"),
    (LAST_WORD_OPTION, LAST_WORD_OPTION),
    ("last-word-file", "last-word-file"),
];

/// The options `re-encode` adds to the old backup's names, its confirmation among them.
pub(crate) const OLD_OPTIONS: [&str; 11] = [
    "input",
    "input-file",
    "qr-file",
    "words",
    "old-mode",
    "old-format",
    OLD_DATES_KEY,
    "old-dates-file",
    LAST_WORD_OPTION,
    "last-word-file",
    RECOGNISED_OPTION,
];

/// Whether `key` is an option of the old backup, and its name for Decode.
fn old_name(key: &str) -> Option<&str> {
    OLD_BACKUP_OPTIONS
        .iter()
        .find(|(old, _)| *old == key)
        .map(|(_, name)| *name)
        .or_else(|| {
            WALLET_EVIDENCE_OPTIONS
                .iter()
                .copied()
                .find(|name| *name == key)
        })
}

/// Whether the new backup is asked on the private screen, before the old phrase, so that the rules
/// on writes stand before it is read: with --ask-secrets and no option of the new backup. Given one,
/// the options make it as Encode's do.
pub(crate) fn asks_new_backup(parsed: &Parsed) -> bool {
    is_on(parsed, "ask-secrets")
        && parsed
            .keys()
            .all(|key| key == "ask-secrets" || key == RECOGNISED_OPTION || old_name(key).is_some())
}

/// The refusals of the command.
#[derive(Debug)]
enum ReEncodeError {
    /// A refusal of an option of the old backup, said so.
    OldBackup(String),
    TwoConfirmations,
    NoConfirmation,
    NothingReEncoded,
}

impl fmt::Display for ReEncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OldBackup(message) => write!(f, "{OLD_BACKUP_REFUSAL}{message}"),
            Self::TwoConfirmations => f.write_str(
                "--recognised and a wallet option are two ways to confirm the seed phrase: give one.",
            ),
            Self::NoConfirmation => f.write_str(
                "Say how the seed phrase of the old backup is confirmed, since its checksum confirms nothing: a wallet option, such as --master-fingerprint or --bitcoin-address, or --recognised if you check it yourself.",
            ),
            Self::NothingReEncoded => f.write_str("Nothing was re-encoded."),
        }
    }
}

impl std::error::Error for ReEncodeError {}

impl Refusal for ReEncodeError {
    fn code(&self) -> &'static str {
        match self {
            Self::OldBackup(_) => "cli.re-encode-command.refused",
            Self::TwoConfirmations => {
                "cli.re-encode-command.recognised-wallet-option-two-ways-confirm-seed-phrase"
            }
            Self::NoConfirmation => {
                "cli.re-encode-command.say-how-seed-phrase-old-backup-confirmed-since"
            }
            Self::NothingReEncoded => "cli.re-encode-command.nothing-was-re-encoded",
        }
    }
}

/// Sorts `parsed` into the old backup's options, by Decode's names, and the new one's, by Encode's;
/// --ask-secrets goes to both, and --recognised, which answers the confirmation, to neither.
fn split_options(parsed: &Parsed) -> (Parsed, Parsed) {
    let (mut old, mut fresh) = (Parsed::new(), Parsed::new());
    for (key, entry) in parsed {
        if key == RECOGNISED_OPTION {
            continue;
        }
        if key == "ask-secrets" {
            old.insert(key.clone(), entry.clone());
            fresh.insert(key.clone(), entry.clone());
        } else if let Some(name) = old_name(key) {
            old.insert(name.to_owned(), entry.clone());
        } else {
            fresh.insert(key.clone(), entry.clone());
        }
    }
    (old, fresh)
}

/// Runs `read`, which reads or checks the old backup from its options, and names the old backup in
/// a refusal it raises: its options are Decode's under other names, and the new backup's, Encode's,
/// are refused in the same words.
fn of_old_backup<T>(read: impl FnOnce() -> Result<T, Stop>) -> Result<T, Stop> {
    read().map_err(|stop| match stop {
        Stop::Refused(refusal) => ReEncodeError::OldBackup(refusal.to_string()).into(),
        other => other,
    })
}

/// How the phrase is confirmed, where the options say it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GivenConfirmation {
    Recognised,
    Wallet,
}

/// How the options confirm the phrase, checked before any secret is read: --recognised or a wallet
/// option, not both; on the command line one of them is needed, since the checksum confirms
/// nothing. With --ask-secrets, without either, the screen asks.
fn given_confirmation(
    parsed: &Parsed,
    wallet_given: bool,
) -> Result<Option<GivenConfirmation>, Stop> {
    let recognised = is_on(parsed, RECOGNISED_OPTION);
    if recognised && wallet_given {
        return Err(ReEncodeError::TwoConfirmations.into());
    }
    if recognised {
        return Ok(Some(GivenConfirmation::Recognised));
    }
    if wallet_given {
        return Ok(Some(GivenConfirmation::Wallet));
    }
    if !is_on(parsed, "ask-secrets") {
        return Err(ReEncodeError::NoConfirmation.into());
    }
    Ok(None)
}

/// A line that says how the phrase was confirmed: shown under the phrase, and again at the top of
/// each screen of the new backup.
type Notices = Vec<(String, NoticeKind)>;

/// The notice of a phrase that the person recognised.
fn recognised() -> Notices {
    vec![(words::RECOGNISED.to_owned(), NoticeKind::Success)]
}

/// The old backup's checksum and fingerprint, on standard error, without the phrase.
fn show_old_fingerprint(phrase: &Phrase) -> Result<(), Stop> {
    report_checksum(Some(phrase))
}

/// The phrase of the old backup, shown for the person to confirm it: on the terminal only, never on
/// standard output, which carries the new backup, so that a redirected run saves no plaintext
/// beside it (AUD-022-SEC001). Where standard error is no terminal, only its fingerprint.
fn show_old_phrase(reading: &OldPhrase<'_>) -> Result<(), Stop> {
    if can_redraw(Channel::Error) {
        show_recovered(reading.result, reading.mode, reading.form, Channel::Error)
    } else {
        show_old_fingerprint(reading.phrase)
    }
}

/// What is shown of an old phrase.
struct OldPhrase<'a> {
    result: &'a Unmasked,
    phrase: &'a Phrase,
    mode: Mode,
    form: Form,
}

/// Shows `notices`; a warning among them still holds once the command has ended.
fn show_notices(notices: &Notices) {
    for (text, kind) in notices {
        if *kind == NoticeKind::Warning {
            lasting_warning(text);
        } else {
            notice(text, *kind);
        }
    }
}

/// A screen of the new backup: the phrase of the old one leaves the private screen, and the notices
/// of its confirmation stay under the title of each step screen, above a warning about the question
/// asked. Without a private screen nothing is cleared, and the notices were shown already.
fn new_backup_screen(notices: &Notices) {
    if !clear_private_screen() {
        return;
    }
    let mut lines = vec![part_line("New backup", true, Channel::Error)];
    for (text, kind) in notices {
        lines.extend(notice_lines(text, *kind));
    }
    keep_context(lines, Lifetime::Page);
}

/// Compares the phrase with the wallet and says whether it matched: a match confirms it, and its
/// notices are shown and given back: the check's own warning first, which the library gives with a
/// fingerprint (AUD-020-SEC001), then the library's line. A fingerprint's match is no proof where a
/// search tries many phrases; here it is one phrase, which a wrong one matches once in four billion
/// times, so it is accepted, with that warning.
fn wallet_confirms(
    re_encoding: &mut ReEncoding,
    check: &WalletCheck,
    by: MatchedBy,
) -> Result<Option<Notices>, Stop> {
    let matched = check.check(re_encoding.phrase())?;
    re_encoding.confirm_by_wallet(&matched);
    if !matched.matched {
        notice(words::NOT_MATCHED, NoticeKind::Warning);
        return Ok(None);
    }
    let mut notices = Notices::new();
    notices.extend(
        matched
            .warning
            .map(|text| (text.to_owned(), NoticeKind::Warning)),
    );
    notices.push((re_encoding.confirmation_line(by)?, NoticeKind::Success));
    show_notices(&notices);
    Ok(Some(notices))
}

/// The old backup from the options, decoded, its fingerprint shown but never its phrase, and
/// confirmed by the wallet that an option gives, or by --recognised. A wallet that does not match
/// ends the command.
fn re_encoding_from_options(
    old: &Parsed,
    wallet: &GivenWallet,
) -> Result<(ReEncoding, Notices), Stop> {
    let mut re_encoding = of_old_backup(|| {
        let (backup, dates) = backup_and_dates_from_options(old)?;
        let from_file = value(old, "last-word-file").is_some();
        let last_word = if from_file {
            let text = text_input(
                old,
                "last-word",
                ("the last word", "The original final-word file", "in a file"),
                PHRASE_LIMIT,
            )?;
            Some(trim(&text).to_owned())
        } else {
            value(old, LAST_WORD_OPTION).map(str::to_owned)
        };
        Ok(ReEncoding::of(&backup, &dates, last_word.as_deref())?)
    })?;
    show_old_fingerprint(re_encoding.phrase())?;
    let Some(check) = &wallet.check else {
        re_encoding.confirm_by_person();
        return Ok((re_encoding, recognised()));
    };
    let notices = wallet_confirms(&mut re_encoding, check, wallet.matched_by())?
        .ok_or(ReEncodeError::NothingReEncoded)?;
    Ok((re_encoding, notices))
}

/// The choice that ends re-encode before the new backup, beside typing again.
fn stop_choice() -> Choice<Step> {
    Choice::noted("Stop", "nothing is re-encoded", Step::Done)
}

/// The phrase confirmed, and the notices that say how.
struct Confirmed {
    re_encoding: ReEncoding,
    notices: Notices,
}

/// How the person confirms the phrase, or what they type again.
#[derive(Clone, Copy)]
enum Way {
    Person,
    Wallet,
    Typed(Step),
}

/// The questions of Decode, for a phrase that Re-encode confirms and makes new.
struct ReEncodeUse<'a> {
    old: &'a Parsed,
    wallet: &'a GivenWallet,
    confirmed_by: Option<GivenConfirmation>,
    confirmed: Option<Confirmed>,
}

impl ReEncodeUse<'_> {
    /// Confirms the phrase.
    fn confirm(&mut self, mut re_encoding: ReEncoding, mode: Mode) -> Result<Step, Stop> {
        let confirmed = confirmation(
            &mut re_encoding,
            mode,
            self.old,
            self.wallet,
            self.confirmed_by,
        )?;
        Ok(match confirmed {
            Ok(notices) => {
                self.confirmed = Some(Confirmed {
                    re_encoding,
                    notices,
                });
                Step::Done
            }
            Err(step) => step,
        })
    }

    /// What follows the phrases restored from shares given for the codes: one is chosen where there
    /// are several, shown and confirmed.
    fn restored(&mut self, restored: &PhrasesAt, mode: Mode) -> Result<RestoredNext, Stop> {
        let phrases = &restored.found.phrases;
        // A repaired set or a date search can give several phrases. Never silently take the first.
        let chosen = if let [only] = phrases.as_slice() {
            only
        } else {
            let choices: Vec<Choice<usize>> = phrases
                .iter()
                .enumerate()
                .map(|(index, phrase)| {
                    let note = format!(
                        "original fingerprint {}",
                        super::encode::fingerprint_of(&phrase.unmasked.phrase).unwrap_or_default()
                    );
                    Choice::noted(&format!("Phrase {}", index + 1), &note, index)
                })
                .collect();
            let asked = ListQuestion {
                question: "Which original seed phrase should be re-encoded?",
                label: "Phrase",
                quit: "goes back",
                explanation: None,
            };
            match choose(&asked, None, &choices)? {
                Chosen::One(index) => &phrases[index],
                Chosen::Back => return Ok(RestoredNext::Back),
                Chosen::Cancelled => return Err(Stop::Cancelled),
            }
        };
        // Restore has already removed Seedshift. Direct mode validates this original phrase without
        // applying the dates twice; ReEncoding still gates every new backup on confirmation.
        let text = chosen.unmasked.phrase.text();
        let original = Backup::read(text.as_str(), Form::English, Mode::Direct)?;
        let re_encoding = ReEncoding::of(&original, &[], None)?;
        clear_private_screen();
        show_old_phrase(&OldPhrase {
            result: re_encoding.result(),
            phrase: re_encoding.phrase(),
            mode,
            form: Form::English,
        })?;
        Ok(match self.confirm(re_encoding, mode)? {
            Step::Backup => RestoredNext::Back,
            Step::Dates => RestoredNext::Dates,
            _ => RestoredNext::Done,
        })
    }
}

impl DecodeUse for ReEncodeUse<'_> {
    fn searches(&self) -> bool {
        false
    }

    fn restore(&mut self, handed: &Parsed, share: FirstShare) -> Result<Restored, Stop> {
        sskr_combine::restore_from_share(
            handed,
            share,
            Some(&mut |restored, mode, _wallet| self.restored(restored, mode)),
        )
    }

    fn stop(&self) -> Choice<Step> {
        stop_choice()
    }

    fn several(&mut self, backup: &Backup, dates: &[Date]) -> Result<Step, Stop> {
        let re_encoding = match ask_last_word(backup, dates, self.old)? {
            Ok(re_encoding) => re_encoding,
            Err(step) => return Ok(step),
        };
        clear_private_screen();
        show_old_phrase(&OldPhrase {
            result: re_encoding.result(),
            phrase: re_encoding.phrase(),
            mode: backup.mode(),
            form: backup.form(),
        })?;
        self.confirm(re_encoding, backup.mode())
    }

    fn decoded(&mut self, backup: &Backup, dates: &[Date]) -> Result<Step, Stop> {
        let re_encoding = ReEncoding::of(backup, dates, None)?;
        self.confirm(re_encoding, backup.mode())
    }

    fn show(&self, result: &Unmasked, mode: Mode, form: Form) -> Result<(), Stop> {
        if can_redraw(Channel::Error) {
            return show_recovered(result, mode, form, Channel::Error);
        }
        // Without a terminal nothing of the phrase is shown; a phrase whose checksum fails has no
        // fingerprint either.
        report_checksum_of(result)
    }
}

/// The checksum and fingerprint of `result`, without the phrase.
fn report_checksum_of(result: &Unmasked) -> Result<(), Stop> {
    report_checksum(words_of(result)?.1.as_ref())
}

/// What the last word gave.
enum LastWord {
    Word(Box<ReEncoding>),
    NoPhrase,
}

/// The last word of the original seed phrase, for a backup of the Original Seedshift with a valid
/// last word, which keeps nothing of it, picking the phrase of the backup that ends with it. Where
/// none does, the word may be mistyped, or a wrong date gave other phrases: the person chooses what
/// to type again, or stops; the dates and the codes are given back to Decode's questions.
fn ask_last_word(
    backup: &Backup,
    dates: &[Date],
    old: &Parsed,
) -> Result<Result<ReEncoding, Step>, Stop> {
    let ask = Ask {
        hints: Some(&*BIP39),
        ..secret_ask(
            "Last word of the original seed phrase:",
            "the last word of the original seed phrase",
            PHRASE_LIMIT,
        )
    };
    loop {
        let read = secret_until(&ask, |answer: &str| {
            match ReEncoding::of(backup, dates, Some(answer)) {
                Ok(re_encoding) => Ok(LastWord::Word(Box::new(re_encoding))),
                Err(ReEncodingError::NoSuchLastWord) => Ok(LastWord::NoPhrase),
                Err(error) => Err(error),
            }
        })?;
        if let LastWord::Word(re_encoding) = read {
            return Ok(Ok(*re_encoding));
        }
        notice(
            &ReEncodingError::NoSuchLastWord.to_string(),
            NoticeKind::Warning,
        );
        // Only the Original Seedshift gives several phrases, and only with its dates.
        let next = after_failure(
            WHAT_NOW,
            &[
                Choice::new("Type the last word again", None),
                dates_again_choice(Some(Step::Dates)),
                backup_choice(old, Some(Step::Backup)),
                Choice::noted("Stop", "nothing is re-encoded", Some(Step::Done)),
            ],
            AfterFailure::default(),
        )?;
        if let Some(step) = next {
            return Ok(Err(step));
        }
    }
}

/// The new backup, asked until Encode takes it, with what it needs: a refusal, such as text that
/// does not fit the cards, is shown at the top of the questions asked again; Escape cancels.
fn new_backup_asked_until_taken() -> Result<(PreparedEncode, Needs), Stop> {
    let mut refusal = None;
    loop {
        match asked_new_backup(refusal.as_deref()) {
            Err(Stop::Refused(reason)) => refusal = Some(reason.to_string()),
            other => return other,
        }
    }
}

/// The new backup asked with Encode's questions on a screen of its own, under the `refusal` of the
/// answers before, if any, each answer checked at once: Escape at a later question goes back to the
/// first, and at the first it cancels. The names of the files are settled as the command line
/// settles them, and every option checked as Encode checks it.
fn asked_new_backup(refusal: Option<&str>) -> Result<(PreparedEncode, Needs), Stop> {
    // Encode's command line: its name, then the options.
    let encoding = loop {
        new_backup_screen(&Notices::new());
        if let Some(refusal) = refusal {
            notice(refusal, NoticeKind::Warning);
        }
        forget_claimed();
        let form = ask_form()?.ok_or(Stop::Cancelled)?;
        if let Some(encoding) = ask_encoding_in(form)? {
            break encoding;
        }
    };
    let mut fresh = args::parse_arguments(&encoding[1..])?;
    let needs = preflight(&mut fresh)?;
    // Only answers that are taken name files that will be saved.
    let prepared = prepare_encode(&fresh)?;
    warn_of_cloud_copies(&fresh);
    Ok((prepared, needs))
}

/// Confirms the phrase of `re_encoding`, shown above: as the options say, --recognised once the
/// person has read it and pressed Enter, a wallet option at once; otherwise, or when that wallet
/// does not match, as the person chooses: by recognising it, or by an address or fingerprint
/// compared with the wallet, which may be tried again. They may also type the dates or the backup
/// again.
fn confirmation(
    re_encoding: &mut ReEncoding,
    mode: Mode,
    old: &Parsed,
    wallet: &GivenWallet,
    confirmed: Option<GivenConfirmation>,
) -> Result<Result<Notices, Step>, Stop> {
    if confirmed == Some(GivenConfirmation::Recognised) {
        match wait_for_enter("Press Enter to make the new backup (Esc stops).")? {
            Chosen::One(()) => {}
            Chosen::Back | Chosen::Cancelled => return Err(Stop::Cancelled),
        }
        re_encoding.confirm_by_person();
        return Ok(Ok(recognised()));
    }
    if confirmed == Some(GivenConfirmation::Wallet)
        && let Some(check) = &wallet.check
        && let Some(notices) = wallet_confirms(re_encoding, check, wallet.matched_by())?
    {
        return Ok(Ok(notices));
    }
    let mut ways = vec![
        Choice::noted(
            "Yes, I recognise it",
            "the phrase or its fingerprint above",
            Way::Person,
        ),
        Choice::noted(
            "Check it against the wallet",
            "an address or the fingerprint",
            Way::Wallet,
        ),
    ];
    if mode.masked() {
        ways.push(dates_again_choice(Way::Typed(Step::Dates)));
    }
    ways.push(backup_choice(old, Way::Typed(Step::Backup)));
    let explanation = Explanation {
        lines: vec![
            "A valid checksum proves nothing: with MnemoCode Seedshift every date gives one."
                .to_owned(),
        ],
        more: vec![readme_link("re-encoding-a-backup")],
    };
    let compared = Explanation {
        lines: vec![compared_passphrase("Re-encode", wallet.with_passphrase)],
        more: Vec::new(),
    };
    loop {
        let way =
            super::asking::ask_or_stop(CONFIRM_QUESTION, "Confirm", &ways, Some(&explanation))?;
        match way {
            Way::Person => {
                re_encoding.confirm_by_person();
                return Ok(Ok(recognised()));
            }
            Way::Typed(step) => return Ok(Err(step)),
            Way::Wallet => {
                let answer = ask_wallet_evidence(false, Some(&compared), &wallet.place)?;
                let WalletAnswer::Wallet(asked) = answer else {
                    continue;
                };
                let by = matched_by_of(&asked);
                let check = WalletCheck::new(asked.evidence, wallet.passphrase());
                if let Some(notices) = wallet_confirms(re_encoding, &check, by)? {
                    return Ok(Ok(notices));
                }
            }
        }
    }
}

/// What a match of the wallet asked was of.
const fn matched_by_of(asked: &AskedEvidence) -> MatchedBy {
    if asked.fingerprint {
        MatchedBy::Fingerprint
    } else {
        MatchedBy::Address
    }
}

/// The old backup's mode and form, which Decode checks before its first question too, in its own
/// words.
fn check_old_backup(old: &Parsed) -> Result<(), Stop> {
    of_old_backup(|| {
        transform_mode(old, None)?;
        given_form(old)?;
        Ok(())
    })
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed, protection: &mut Protection) -> Result<(), Stop> {
    // The secrets of both backups are asked on the private screen; none may be given beside it.
    assert_asked_not_given(
        parsed,
        &[
            "input",
            OLD_DATES_KEY,
            "old-dates-file",
            LAST_WORD_OPTION,
            "last-word-file",
            DATES_OPTION,
            "dates-file",
        ],
    )?;
    let (old, fresh) = split_options(parsed);
    // The new backup's options, its destinations and cards, are checked before any question;
    // without them it is asked first: the rules on writes stand before the old phrase is read, and
    // every option given is checked before that first question, the secret files only looked at.
    let encode = if asks_new_backup(parsed) {
        check_given_wallet(&old)?;
        given_confirmation(parsed, wallet_evidence_given(&old))?;
        check_old_backup(&old)?;
        assert_terminal()?;
        let (prepared, needs) = new_backup_asked_until_taken()?;
        protection.rule_writes(&needs.folders);
        clear_private_screen();
        show_protection(&protection.report());
        prepared
    } else {
        prepare_encode(&fresh)?
    };
    let wallet = given_wallet(&old)?;
    let confirmed_by = given_confirmation(parsed, wallet.check.is_some())?;
    let confirmed = if is_on(parsed, "ask-secrets") {
        check_old_backup(&old)?;
        let mut purpose = ReEncodeUse {
            old: &old,
            wallet: &wallet,
            confirmed_by,
            confirmed: None,
        };
        decode_with_questions(&old, &mut purpose)?;
        // Stop, before the phrase was confirmed or a new backup was given, cancels as Ctrl+C does.
        purpose.confirmed.ok_or(Stop::Cancelled)?
    } else {
        let (re_encoding, notices) = re_encoding_from_options(&old, &wallet)?;
        Confirmed {
            re_encoding,
            notices,
        }
    };
    new_backup_screen(&confirmed.notices);
    let phrase = confirmed.re_encoding.confirmed_phrase()?;
    encode.run(Some(phrase))?;
    lasting_warning(words::OLD_BACKUP_STILL_OPENS);
    Ok(())
}
