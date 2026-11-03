//! The menu that MnemoCode shows when it starts without arguments at a terminal, as from a
//! double-click (MnemoCode TS 0.1.0's `cli/menu.ts` and `menu-runner.ts`). An entry asks its
//! questions as lists chosen with the arrow keys, builds the command line that does the same, shows
//! it in grey and runs it exactly as if it had been typed after `mnemocode`, in a process of its
//! own, so that the person can type it later. A secret is never part of that command line: the
//! command asks for it on its private screen (--ask-secrets).
//!
//! The menu checks each of its own answers at once, none of which is a secret; nothing is read from
//! the files, and the menu writes nothing. It holds no secret and takes no sandbox, which its
//! commands would inherit: each sets its own. Its questions stand under its heading with the record
//! of the answers given so far, which the command line closes: CORE-39 makes the start menu its
//! exception.

mod table;
mod typed_line;

use mnemocode::bip39::sizes::WORD_COUNTS;
use mnemocode::bip39::table::Lookup;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::qr::admission::MAX_PNG_BYTES;
use mnemocode::recovery::date_search::wallet_needed;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::wallet::coins::AddressLocation;
use mnemocode::wallet::evidence::{BitcoinProfile, KeyNetwork, Place};
use mnemocode_cards::export::SAMPLE_FILE_BASE;

use crate::commands::asking::{WHAT_NOW, ask_list};
use crate::commands::backup_questions::{
    ENCODED_SEEDSHIFT_QUESTION, SHARE_SEEDSHIFT_QUESTION, WHICH_SEEDSHIFT_QUESTION,
    encoded_seedshift_choices, seedshift_choices, share_seedshift_choices,
};
use crate::commands::candidates_file::ask_candidate_list;
use crate::commands::card_questions::ask_design;
use crate::commands::date_search::wallet_explanation;
use crate::commands::encode_questions::{
    QR_FILE, RECORD_FILE, ask_encoding, ask_heir_sheet, ask_seedshift, ask_share_set, ask_shares,
    example, file_questions, sample_of, seedshift_explanation, variant_explanation,
};
use crate::commands::menu_entries::{
    self, Guide, MENU_GUIDE, MenuEntry, PHRASE_WORDS_QUESTION, TYPED_SOURCE, phrase_words_answer,
};
use crate::commands::output_questions::{ask_output_file, forget_claimed, input_file};
use crate::commands::wallet_question::{Asker, WalletAnswer, ask_wallet_evidence_by};
use crate::commands::{help, named, self_test};
use crate::gate::Stop;
use crate::os::{self, Protection};
use crate::terminal::{
    self, Channel, Choice, Chosen, Digit, Explanation, LEAVE_ALTERNATE_SCREEN, LineQuestion,
    ListQuestion, NoticeKind, answer_mark, ask_line, choose, choose_from, error_line, error_raw,
    heading_line, more_line, notes_room, notice, paint, printable, readme_link,
    redraw_answer_record, start_answer_record, style, terminal_available, wait_for_enter_or_escape,
};
use typed_line::command_display;

/// What Ctrl+C ends a command with.
const CANCELLED_EXIT_CODE: i32 = 130;
/// What a shell reports for a process that a signal stopped: more than this.
/// What stands between the two samples beside the answer that types the codes.
const SAMPLES_APART: &str = " · ";
/// Said once when the entries that ask for a secret are no longer offered.
const SECRET_ENTRIES_LEFT_OUT: &str =
    "The entries that ask for a seed phrase or a share are not offered.";
/// Said once when a failed self-test closes every entry that runs a feature.
const FEATURE_ENTRIES_LEFT_OUT: &str = "Only the self-test, the help and Quit are offered: the other entries stay closed after a failed self-test.";

/// What an entry does once its questions are answered.
enum Action {
    /// The command line that does what was asked; after a lookup, the kind of the next one.
    Run {
        run: Vec<String>,
        again: Option<Lookup>,
    },
    Help,
    Quit,
    /// The person went back.
    Back,
}

impl Action {
    /// The command line `run`, without a next lookup.
    const fn run(run: Vec<String>) -> Self {
        Self::Run { run, again: None }
    }

    /// The command line `run` where the person answered; back otherwise.
    fn of(run: Option<Vec<String>>) -> Self {
        run.map_or(Self::Back, Self::run)
    }
}

/// `words` as the arguments of a command.
fn line(words: &[&str]) -> Vec<String> {
    words.iter().map(|&word| word.to_owned()).collect()
}

/// `first`, then `rest`.
fn joined(first: &[&str], rest: Vec<String>) -> Vec<String> {
    let mut run = line(first);
    run.extend(rest);
    run
}

/// The --words option of codes typed from printed cards.
fn words_option(words: Option<usize>) -> Vec<String> {
    words.map_or_else(Vec::new, |words| {
        vec!["--words".to_owned(), words.to_string()]
    })
}

/// Entry 1: the seed phrase in another form, masked with Seedshift and split into Shamir shares if
/// wanted.
fn encode_action() -> Result<Action, Stop> {
    Ok(Action::of(ask_encoding()?))
}

/// Entry 2, a backup made before encoded again: where it is and how it was masked, as Decode asks
/// it. Re-encode asks the rest on its private screen.
fn re_encode_action() -> Result<Action, Stop> {
    let old = ask_backup_source("--old-mode")?;
    Ok(Action::of(
        old.map(|old| joined(&["re-encode", "--ask-secrets"], old)),
    ))
}

/// How many words the seed phrase has, for codes typed from printed cards, which end with codes that
/// belong to nothing: an inner none where all the codes typed are read, an outer none for back.
fn ask_phrase_words() -> Result<Option<Option<usize>>, Stop> {
    let mut choices = vec![Choice::noted(
        "All the codes I type",
        "from paper or a record",
        None,
    )];
    choices.extend(WORD_COUNTS.map(|words| {
        Choice::noted(
            &phrase_words_answer(words),
            "from printed cards",
            Some(words),
        )
    }));
    ask_list(PHRASE_WORDS_QUESTION, "Words", &choices, None)
}

/// Where the encoded phrase of a source is.
#[derive(Clone, Copy)]
enum Source {
    Typed,
    Record,
    Qr,
}

/// Where an encoded seed phrase is read from, as options: typed on the private screen, with how many
/// words the phrase has, or a file encode saved.
fn ask_source() -> Result<Option<Vec<String>>, Stop> {
    let typed = Choice::noted(
        TYPED_SOURCE,
        "numbers, codes, colors, a record or a stitch legend",
        Source::Typed,
    );
    let record = Choice::noted(
        "In a record file",
        "the text file that Encode saved",
        Source::Record,
    );
    let qr = Choice::noted(
        "In a QR code image",
        "the PNG file that Encode saved",
        Source::Qr,
    );
    // Two samples share the room beside the labels, with what stands between them.
    let room = (notes_room(&[typed.clone(), record.clone(), qr.clone()])
        - SAMPLES_APART.chars().count())
        / 2;
    let samples = [
        sample_of(&example(Form::Indexes)?, room),
        sample_of(&example(Form::Colors)?, room),
    ];
    let typed = Choice {
        example: Some(samples.join(SAMPLES_APART)),
        ..typed
    };
    let source = ask_list(
        "Where is the encoded seed phrase?",
        "Source",
        &[typed, record, qr],
        None,
    )?;
    let (question, fallback, limit, option) = match source {
        None => return Ok(None),
        Some(Source::Typed) => return Ok(ask_phrase_words()?.map(words_option)),
        Some(Source::Record) => (
            file_questions::RECORD,
            RECORD_FILE,
            crate::commands::given::SHARE_SET_LIMIT,
            "--input-file",
        ),
        Some(Source::Qr) => (file_questions::QR, QR_FILE, MAX_PNG_BYTES, "--qr-file"),
    };
    let how = LineQuestion {
        fallback: Some(fallback),
        limit: crate::commands::given::PATH_LIMIT,
        ..LineQuestion::default()
    };
    Ok(
        match ask_line(question, "File", how, |answer: &str| {
            input_file(answer, limit)
        })? {
            Chosen::One(path) => Some(vec![option.to_owned(), path]),
            Chosen::Back => None,
            Chosen::Cancelled => return Err(Stop::Cancelled),
        },
    )
}

/// Entry 3: an encoded seed phrase turned back into the words.
fn decode_action() -> Result<Action, Stop> {
    let source = ask_backup_source("--mode")?;
    Ok(Action::of(source.map(|source| {
        joined(&["decode", "--ask-secrets"], source)
    })))
}

/// Whether `options` of a source name a record file, which names its own mode.
fn names_its_mode(options: &[String]) -> bool {
    options
        .first()
        .is_some_and(|option| option == "--input-file")
}

/// Where an encoded backup is and how it was masked, as options with its mode under `mode_flag`;
/// none for back. A record file names its mode; a QR code or typed codes do not, unless a whole
/// record is typed: the command itself asks for codes that name no mode.
fn ask_backup_source(mode_flag: &str) -> Result<Option<Vec<String>>, Stop> {
    let Some(mut options) = ask_source()? else {
        return Ok(None);
    };
    if names_its_mode(&options) {
        return Ok(Some(options));
    }
    let Some(mode) = ask_encoded_mode()? else {
        return Ok(None);
    };
    options.extend([mode_flag.to_owned(), mode.id().to_owned()]);
    Ok(Some(options))
}

/// Which Seedshift masked the codes, for decode, which reads typed codes. The menu says what follows
/// rather than what each variant does: the variants are told apart where the codes are read.
fn ask_encoded_mode() -> Result<Option<Mode>, Stop> {
    let choices: Vec<Choice<Mode>> = encoded_seedshift_choices()
        .into_iter()
        .map(|choice| {
            if choice.value.masked() {
                Choice::noted(&choice.label, "the dates are asked next", choice.value)
            } else {
                choice
            }
        })
        .collect();
    ask_list(
        ENCODED_SEEDSHIFT_QUESTION,
        "Seedshift",
        &choices,
        Some(&seedshift_explanation()),
    )
}

/// Entry 6, codes of an encoded seed phrase that cannot be read: typed with ? at their places, as
/// Decode reads them, which searches the codes the marks leave open.
fn marked_codes_action() -> Result<Action, Stop> {
    let Some(words) = ask_phrase_words()? else {
        return Ok(Action::Back);
    };
    let Some(mode) = ask_encoded_mode()? else {
        return Ok(Action::Back);
    };
    let mut run = joined(&["decode", "--ask-secrets"], words_option(words));
    run.extend(["--mode".to_owned(), mode.id().to_owned()]);
    Ok(Action::run(run))
}

/// Entry 4: standard Shamir shares of the seed phrase itself, in Bytewords or as a short code, as
/// other SSKR tools write and read them; restoring them gives the seed phrase in words.
fn split_action() -> Result<Action, Stop> {
    let Some(mode) = ask_seedshift("Use Seedshift before splitting?", false, true)? else {
        return Ok(Action::Back);
    };
    let explanation = Explanation {
        lines: vec![
            "Standard SSKR shares of the seed phrase itself, which other SSKR tools read."
                .to_owned(),
        ],
        more: vec![readme_link("splitting-a-mnemonic-into-shares")],
    };
    let set = ask_share_set(
        "How many shares, and how many of them restore the seed phrase?",
        &explanation,
        false,
    )?;
    let Some(Some(set)) = set else {
        return Ok(Action::Back);
    };
    let choices = [
        Choice::noted(
            "Words",
            "Bytewords, such as tuna next keep gyro ...",
            ShareFormat::Words,
        ),
        Choice::noted(
            "Short code",
            "ur:sskr/..., the standard short form",
            ShareFormat::Ur,
        ),
    ];
    let Some(format) = ask_list(
        "How should each share be written?",
        "Shares as",
        &choices,
        None,
    )?
    else {
        return Ok(Action::Back);
    };
    let Some(shares) = ask_shares(set, format)? else {
        return Ok(Action::Back);
    };
    let Some(heirs) = ask_heir_sheet(mode)? else {
        return Ok(Action::Back);
    };
    let mut run = joined(
        &["encode", "--sskr", "--ask-secrets", "--mode", mode.id()],
        shares,
    );
    run.extend(heirs);
    Ok(Action::run(run))
}

/// Whether the phrase of shares was masked before it was split; none means back.
fn ask_shares_masked() -> Result<Option<Mode>, Stop> {
    ask_list(
        SHARE_SEEDSHIFT_QUESTION,
        "Seedshift",
        &share_seedshift_choices(),
        Some(&seedshift_explanation()),
    )
}

/// The --mode of sskr-combine and sskr-export for shares of a phrase masked with `mode` before
/// splitting, and none for shares of an unmasked phrase, as those commands read it.
fn shares_mode_option(mode: Mode) -> Vec<String> {
    if mode.masked() {
        vec!["--mode".to_owned(), mode.id().to_owned()]
    } else {
        Vec::new()
    }
}

/// Entry 5: the seed phrase rebuilt from typed Shamir shares.
fn restore_action() -> Result<Action, Stop> {
    let Some(mode) = ask_shares_masked()? else {
        return Ok(Action::Back);
    };
    Ok(Action::run(joined(
        &["sskr-combine", "--ask-secrets"],
        shares_mode_option(mode),
    )))
}

/// What is forgotten.
#[derive(Clone, Copy)]
enum Forgotten {
    Word,
    Code,
    Date,
    Share,
}

/// Entry 6: a forgotten word, a forgotten digit of a date, or an unreadable code of a share.
fn recover_action() -> Result<Action, Stop> {
    let choices = [
        Choice::noted(
            "A word of the seed phrase",
            "or several, or a missing one",
            Forgotten::Word,
        ),
        Choice::noted(
            "A code of the encoded seed phrase",
            "typed with ? for each unread code",
            Forgotten::Code,
        ),
        Choice::noted(
            "A digit of a date",
            "for a phrase masked with Seedshift",
            Forgotten::Date,
        ),
        Choice::noted(
            "A code of a Shamir share",
            "the share with ? for each unread code",
            Forgotten::Share,
        ),
    ];
    let forgotten = ask_list("What is forgotten?", "Forgotten", &choices, None)?;
    if let Some(forgotten) = forgotten {
        let guide = match forgotten {
            Forgotten::Word => menu_entries::WORD_GUIDE,
            Forgotten::Code => menu_entries::CODE_GUIDE,
            Forgotten::Date => menu_entries::DATE_GUIDE,
            Forgotten::Share => menu_entries::SHARE_GUIDE,
        };
        redraw_answer_record(&heading_lines(None, guide), answer_mark());
    }
    match forgotten {
        None => Ok(Action::Back),
        Some(Forgotten::Word) => word_recovery_action(),
        Some(Forgotten::Code) => marked_codes_action(),
        // The shares come back whole, in their own form, without the seed phrase being shown.
        Some(Forgotten::Share) => share_repair_action(),
        Some(Forgotten::Date) => date_recovery_action(),
    }
}

/// Entry 6, a forgotten digit of a date. Every date gives MnemoCode Seedshift a valid phrase, so only
/// the wallet can tell the right one; the original Seedshift's checksum sorts out most dates by
/// itself. A record file names its own mode, and recover-date asks for the wallet after reading it
/// only when that mode needs one.
fn date_recovery_action() -> Result<Action, Stop> {
    let Some(source) = ask_source()? else {
        return Ok(Action::Back);
    };
    let mode = if names_its_mode(&source) {
        None
    } else {
        match ask_list(
            WHICH_SEEDSHIFT_QUESTION,
            "Seedshift",
            &seedshift_choices(),
            Some(&variant_explanation(false)),
        )? {
            Some(mode) => Some(mode),
            None => return Ok(Action::Back),
        }
    };
    let required = mode.is_some_and(wallet_needed);
    let Some(wallet) = ask_wallet(required, &wallet_explanation(mode, None))? else {
        return Ok(Action::Back);
    };
    let mut run = joined(&["recover-date", "--ask-secrets"], source);
    if let Some(mode) = mode {
        run.extend(["--mode".to_owned(), mode.id().to_owned()]);
    }
    run.extend(wallet);
    Ok(Action::run(run))
}

/// Entry 6, forgotten words: at their places with ?, or one missing word whose place is not known;
/// on request every candidate also goes to a list for the Discovery Scanner.
fn word_recovery_action() -> Result<Action, Stop> {
    let choices = [
        Choice::noted(
            "Yes",
            "type ? at each place, or ab* if it began with ab",
            false,
        ),
        Choice::noted("No", "one word is missing; type the words you have", true),
    ];
    let Some(missing) = ask_list(
        "Do you know where the forgotten words were?",
        "Places",
        &choices,
        None,
    )?
    else {
        return Ok(Action::Back);
    };
    let mut search = line(&["recover-word", "--ask-secrets"]);
    if missing {
        search.push("--missing-word".to_owned());
    }
    let choices = [
        Choice::new("No", false),
        Choice::noted(
            "Yes",
            "an encrypted list that the Scanner checks online",
            true,
        ),
    ];
    let explanation = Explanation {
        lines: vec![
            "Without the wallet's fingerprint, only a search for funds tells them apart."
                .to_owned(),
        ],
        more: vec![readme_link("forgotten-word-recovery")],
    };
    let Some(save) = ask_list(
        "Save the candidates for the Discovery Scanner?",
        "List",
        &choices,
        Some(&explanation),
    )?
    else {
        return Ok(Action::Back);
    };
    if !save {
        return Ok(Action::run(search));
    }
    let Some(list) = ask_candidate_list()? else {
        return Ok(Action::Back);
    };
    search.extend(list);
    Ok(Action::run(search))
}

/// Entry 6, a code of a share: the wallet, if it can be told, picks among sets of shares that fit.
/// For a phrase masked before splitting, the wallet is checked after the dates.
fn share_repair_action() -> Result<Action, Stop> {
    let explanation = Explanation {
        lines: vec![
            "Shares with many ? may fit in several ways; the wallet tells the right one."
                .to_owned(),
        ],
        more: vec![readme_link(mnemocode::sskr::repair::report::REPAIR_ANCHOR)],
    };
    let Some(wallet) = ask_wallet(false, &explanation)? else {
        return Ok(Action::Back);
    };
    let export = ["sskr-export", "--ask-secrets"];
    if wallet.is_empty() {
        return Ok(Action::run(line(&export)));
    }
    let Some(mode) = ask_shares_masked()? else {
        return Ok(Action::Back);
    };
    let mut run = joined(&export, shares_mode_option(mode));
    run.extend(wallet);
    Ok(Action::run(run))
}

/// What tells the right phrase among the candidates, as options: the BIP32 master fingerprint, or
/// one of the first receiving addresses of the wallet, of Bitcoin or another coin. Each is checked
/// at once. Without it (`required` false) every candidate is listed: no options.
fn ask_wallet(required: bool, explanation: &Explanation) -> Result<Option<Vec<String>>, Stop> {
    let place = Place {
        network: KeyNetwork::Mainnet,
        profiles: BitcoinProfile::ALL.to_vec(),
        location: AddressLocation {
            account: 0,
            branch: 0,
            index: 0,
        },
        addresses: None,
    };
    let answer = ask_wallet_evidence_by(Asker::Menu, !required, Some(explanation), &place)?;
    Ok(match answer {
        WalletAnswer::Back => None,
        WalletAnswer::None => Some(Vec::new()),
        WalletAnswer::Wallet(asked) => Some(asked.options),
    })
}

/// Entry 7: card designs drawn with a random sample phrase.
fn preview_action() -> Result<Action, Stop> {
    let Some(design) = ask_design(true, false)? else {
        return Ok(Action::Back);
    };
    let file = format!("{SAMPLE_FILE_BASE}.pdf");
    let Some(path) = ask_output_file(file_questions::PDF, &file)? else {
        return Ok(Action::Back);
    };
    let mut run = line(&["preview"]);
    if design.is_empty() {
        run.push("--all".to_owned());
    } else {
        run.extend(["--template".to_owned(), design]);
    }
    run.extend(["--pdf".to_owned(), path]);
    Ok(Action::run(run))
}

/// Entry 9.
fn self_test_action() -> Result<Action, Stop> {
    Ok(Action::run(line(&["self-test"])))
}

/// Entry 0.
fn help_action() -> Result<Action, Stop> {
    Ok(Action::Help)
}

/// The last entry.
fn quit_action() -> Result<Action, Stop> {
    Ok(Action::Quit)
}

/// One entry of the menu.
struct Entry {
    name: MenuEntry,
    action: fn() -> Result<Action, Stop>,
    /// The command asks for a seed phrase or a share, which needs a protected, self-tested process.
    asks_secrets: bool,
    /// It runs no feature: it stays offered after a failed self-test, which closes every other
    /// entry (CORE-27).
    runs_no_feature: bool,
}

/// An entry that runs a feature, `asks_secrets` or not.
const fn feature(
    name: MenuEntry,
    action: fn() -> Result<Action, Stop>,
    asks_secrets: bool,
) -> Entry {
    Entry {
        name,
        action,
        asks_secrets,
        runs_no_feature: false,
    }
}

/// An entry that runs no feature.
const fn no_feature(name: MenuEntry, action: fn() -> Result<Action, Stop>) -> Entry {
    Entry {
        name,
        action,
        asks_secrets: false,
        runs_no_feature: true,
    }
}

const ENTRIES: [Entry; 11] = [
    feature(menu_entries::ENCODE, encode_action, true),
    feature(menu_entries::RE_ENCODE, re_encode_action, true),
    feature(menu_entries::DECODE, decode_action, true),
    feature(menu_entries::SPLIT, split_action, true),
    feature(menu_entries::RESTORE, restore_action, true),
    feature(menu_entries::RECOVER, recover_action, true),
    feature(menu_entries::PREVIEW, preview_action, false),
    feature(menu_entries::TABLE, table::table_action, false),
    no_feature(menu_entries::SELF_TEST, self_test_action),
    no_feature(menu_entries::HELP, help_action),
    no_feature(menu_entries::QUIT, quit_action),
];

/// Entries that the menu no longer offers, and why.
enum Closure {
    /// After a failed self-test: every entry that runs a feature.
    Features(String),
    /// Where only the protection failed: the entries that ask for a secret.
    Secrets(String),
}

impl Closure {
    /// Whether `entry` is still offered.
    const fn offers(&self, entry: &Entry) -> bool {
        match self {
            Self::Features(_) => entry.runs_no_feature,
            Self::Secrets(_) => !entry.asks_secrets,
        }
    }

    /// Why the entries are closed.
    fn reason(&self) -> &str {
        match self {
            Self::Features(reason) | Self::Secrets(reason) => reason,
        }
    }

    /// What the notice says of the entries it closes.
    const fn left_out(&self) -> &'static str {
        match self {
            Self::Features(_) => FEATURE_ENTRIES_LEFT_OUT,
            Self::Secrets(_) => SECRET_ENTRIES_LEFT_OUT,
        }
    }
}

/// The entries closed at the start: after a failed core self-test, whose known answers are those of
/// every feature, all but the entries that run none; where only this process could not switch off
/// core dumps, the entries that ask for a secret. Each command checks both again before it starts
/// and would stop at once, so the menu checks them before its first question.
fn closed_at_start(protection: &mut Protection) -> Option<Closure> {
    protection.read_back();
    if let Err(failure) = self_test::assert_core() {
        return Some(Closure::Features(failure.message()));
    }
    protection.refusal().map(Closure::Secrets)
}

/// The menu's heading; `closure` says which entries are no longer offered, and why.
fn heading_lines(closure: Option<&Closure>, guide: Guide) -> Vec<String> {
    let mut lines = vec![
        String::new(),
        heading_line(Channel::Error, "Offline seed phrase encoding"),
        String::new(),
        guide.description.to_owned(),
        more_line(guide.anchor),
        paint(
            Channel::Error,
            style::MUTED,
            "Work on a trusted computer without a network connection.",
        ),
    ];
    if let Some(closure) = closure {
        lines.push(terminal::failure_line(closure.reason()));
        lines.extend(terminal::notice_lines(
            closure.left_out(),
            NoticeKind::Warning,
        ));
    }
    lines.push(String::new());
    lines
}

/// Whether the command `name` runs on the private screen, which a terminal shows.
fn runs_on_private_screen(name: &str) -> bool {
    named(name).is_some_and(|command| command.secret) && terminal_available()
}

/// Runs `run` in a process of its own, with the terminal's echo off until it takes the terminal:
/// what was typed or pasted with the last answer goes to no process, and what was typed while it
/// ran but not read by it answers no question of the menu.
fn run_quietly(run: &[String]) -> std::io::Result<os::CommandEnd> {
    os::without_echo(|| {
        os::drop_typed_ahead();
        let ended = os::run_own_process(run);
        os::drop_typed_ahead();
        // A Ctrl+C meant for the command, which has ended, cancels nothing here.
        os::forget_cancel();
        ended
    })
}

/// Runs `run` and returns its exit code, or none when the person went back to the menu instead. A
/// command that could not be started, or that a signal stopped, such as the out-of-memory killer, is
/// said so in one line and offered again with the same answers.
fn run_command(run: &[String]) -> Result<Option<i32>, Stop> {
    loop {
        // Ctrl+C typed with the last answer, before the command started, cancels it.
        if let Some(signal) = os::pending_signal() {
            return Err(Stop::Signal(signal));
        }
        let failure = match run_quietly(run) {
            Ok(end) if !end.stopped() => return Ok(Some(end.code)),
            Ok(end) => {
                // A command that a signal let clean up has left the private screen itself.
                if end.killed && run.first().is_some_and(|name| runs_on_private_screen(name)) {
                    error_raw(LEAVE_ALTERNATE_SCREEN);
                }
                format!("The command stopped unexpectedly ({}).", end.reason())
            }
            Err(error) => format!(
                "The command could not be started ({}).",
                os::start_failure(&error)
            ),
        };
        let choices = [
            Choice::noted("Start it again", "with the same answers", true),
            Choice::new("Back to the menu", false),
        ];
        let asked = ListQuestion {
            question: WHAT_NOW,
            label: "Next",
            quit: "goes back",
            explanation: None,
        };
        match choose(&asked, Some(&failure), &choices)? {
            Chosen::One(true) => {}
            Chosen::One(false) | Chosen::Back => return Ok(None),
            Chosen::Cancelled => return Err(Stop::Cancelled),
        }
    }
}

/// Asks which of the entries that `closure` leaves to run; `selected` the entry last chosen.
fn ask_entry(closure: Option<&Closure>, selected: usize) -> Result<Option<usize>, Stop> {
    let offered: Vec<usize> = (0..ENTRIES.len())
        .filter(|&index| closure.is_none_or(|closure| closure.offers(&ENTRIES[index])))
        .collect();
    let choices: Vec<Choice<usize>> = offered
        .iter()
        .map(|&index| {
            let name = ENTRIES[index].name;
            Choice {
                digit: Digit::Own(name.digit),
                ..Choice::new(name.label, index)
            }
        })
        .collect();
    let asked = ListQuestion {
        question: "What do you want to do?",
        label: "Task",
        quit: "quits",
        explanation: None,
    };
    let initial = offered
        .iter()
        .position(|&index| index == selected)
        .unwrap_or(0);
    match choose_from(&asked, None, &choices, initial)? {
        Chosen::One(index) => Ok(Some(index)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// Shows the command that an entry built, in grey, as it would be typed.
fn show_command(run: &[String]) {
    let command = command_display(run);
    if printable(&command) == command {
        error_line(&format!(
            "\n{}",
            paint(Channel::Error, style::MUTED, "The same as:")
        ));
        error_line(&paint(Channel::Error, style::ACCENT, &command));
    } else {
        notice(
            "Command preview omitted: an argument contains display controls.",
            NoticeKind::Warning,
        );
    }
}

/// Runs the menu until the person quits, with Escape, q or the entry Quit.
pub(crate) fn run(protection: &mut Protection) -> Result<(), Stop> {
    let mut closure = closed_at_start(protection);
    let mut guide = MENU_GUIDE;
    start_answer_record();
    redraw_answer_record(&heading_lines(closure.as_ref(), guide), 0);
    let mut selected = 0;
    let mut again = None;
    loop {
        let before = answer_mark();
        if again.is_none() {
            if guide != MENU_GUIDE {
                guide = MENU_GUIDE;
                start_answer_record();
                redraw_answer_record(&heading_lines(closure.as_ref(), guide), 0);
            }
            match ask_entry(closure.as_ref(), selected)? {
                Some(index) => selected = index,
                None => return Ok(()),
            }
        }
        if ENTRIES[selected].name == menu_entries::QUIT {
            return Ok(());
        }
        guide = ENTRIES[selected].name.guide;
        redraw_answer_record(&heading_lines(closure.as_ref(), guide), answer_mark());
        forget_claimed();
        let action = match again.take() {
            Some(lookup) => table::lookup_action(lookup)?,
            None => (ENTRIES[selected].action)()?,
        };
        match action {
            Action::Quit => return Ok(()),
            Action::Back => {
                // The task and the answers given for it leave the record before the list returns.
                guide = MENU_GUIDE;
                redraw_answer_record(&heading_lines(closure.as_ref(), guide), before);
                continue;
            }
            Action::Help => {
                // What follows is written below the record, which starts again under it.
                start_answer_record();
                help::print_usage();
            }
            Action::Run { run, again: next } => {
                start_answer_record();
                show_command(&run);
                // The command reports its own result, error or cancellation.
                let code = match run_command(&run)? {
                    Some(code) if code != CANCELLED_EXIT_CODE => code,
                    _ => continue,
                };
                if code == 0 {
                    again = next;
                }
                let name = run.first().map_or("", String::as_str);
                // A copy that fails its own check is not trusted with its features either.
                if name == "self-test"
                    && code != 0
                    && !matches!(closure, Some(Closure::Features(_)))
                {
                    let failed = Closure::Features("The self-test failed.".to_owned());
                    notice(
                        &format!("{} {}", failed.reason(), failed.left_out()),
                        NoticeKind::Warning,
                    );
                    closure = Some(failed);
                }
                // After the private screen the person has already read the result and pressed
                // Enter, and the command has left its summary on the main screen.
                if code == 0 && runs_on_private_screen(name) {
                    continue;
                }
            }
        }
        error_line("");
        // Repeated lookups keep their input kind; Escape there returns to the main menu.
        let message = if again.is_none() {
            "Press Enter to return to the menu (Esc quits)."
        } else {
            "Press Enter for another lookup (Esc returns to the menu)."
        };
        match wait_for_enter_or_escape(message)? {
            Chosen::One(()) => {}
            Chosen::Back if again.is_some() => again = None,
            Chosen::Back => return Ok(()),
            Chosen::Cancelled => return Err(Stop::Cancelled),
        }
    }
}
