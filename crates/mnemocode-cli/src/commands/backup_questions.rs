//! The encoded seed phrase that the commands undoing Seedshift ask for on the private screen, typed
//! or read from --input-file or --qr-file, with everything that can be checked before the dates
//! (MnemoCode TS 0.1.0's `cli/backup-questions.ts`). Every question is asked again until its answer
//! can be used; what was answered before is kept.

use mnemocode::backup::record::parse_record;
use mnemocode::backup::{Backup, BackupError};
use mnemocode::forms::Form;
use mnemocode::forms::hints::{LineWordHints, codes_list};
use mnemocode::modes::phrase_words::ENCODED_FINGERPRINT;
use mnemocode::modes::{Mode, ModeError};
use mnemocode::recovery::marked::MissingCodes;
use mnemocode::recovery::reading::{BackupReading, ReadingRules, ShareKind};
use mnemocode::secret::SecretText;

use mnemocode::sskr::typed::{SHARE_SEPARATOR, SHARE_SEPARATOR_BYTE};

use super::asking::{AfterFailure, WHAT_NOW, after_failure, or_back_or_cancel, value_until};
use super::found::report_fingerprint;
use super::given::{
    ENCODED_INPUT_FILE, PATH_LIMIT, SHARE_READER, SHARE_SET_LIMIT, detected_form, encoded_input,
    encoded_input_from_question, given_form, given_mode, phrase_words,
};
use crate::args::{Given, Parsed, choice_option};
use crate::gate::Stop;
use crate::input::{Ask, dropped_path, secret_ask};
use crate::terminal::result::plain_fingerprint_line;
use crate::terminal::{
    Channel, Choice, Chosen, Lifetime, ListQuestion, NoticeKind, choose, hint_lines, keep_context,
    notice, notice_lines, question_ended,
};

/// The answer that types the encoded seed phrase, after a file that could not be used.
pub(crate) const TYPE_ENCODED_LABEL: &str = "Type the encoded seed phrase";
/// The answer that types it again, after one typed.
pub(crate) const TYPE_ENCODED_AGAIN_LABEL: &str = "Type the encoded seed phrase again";
/// The answer that types the codes again, after codes that cannot be the right ones.
pub(crate) const CODES_AGAIN_LABEL: &str = "Type the codes again";
/// The answer that reads another file of the encoded seed phrase.
const READ_ANOTHER_FILE: &str = "Read another file";
/// The question which Seedshift masked codes.
pub(crate) const WHICH_SEEDSHIFT_QUESTION: &str = "Which Seedshift was used?";
/// The question for codes that name no mode.
pub(crate) const ENCODED_SEEDSHIFT_QUESTION: &str = "Was Seedshift used when it was encoded?";

/// The question for shares, whose phrase may have been masked before it was split.
pub(crate) const SHARE_SEEDSHIFT_QUESTION: &str = "Was Seedshift used before it was split?";

/// Its answers: no Seedshift, or which one.
pub(crate) fn share_seedshift_choices() -> [Choice<Mode>; 3] {
    [
        Choice::noted("No", "the shares hold the seed phrase itself", Mode::Direct),
        Choice::noted(
            "MnemoCode Seedshift",
            "the dates are asked after the shares",
            Mode::Seedshift,
        ),
        Choice::noted(
            "Original Seedshift",
            "the dates and the word to remember are asked after the shares",
            Mode::SeedshiftLegacy,
        ),
    ]
}

/// The answer of a share's question for `mode`, as the sheet for heirs names it.
pub(crate) fn share_seedshift_label(mode: Mode) -> &'static str {
    encoded_seedshift_label(mode)
}

/// The answer of the question of codes that name no mode for `mode`, as the sheet names it.
pub(crate) fn encoded_seedshift_label(mode: Mode) -> &'static str {
    match mode {
        Mode::Seedshift => "MnemoCode Seedshift",
        Mode::SeedshiftLegacy | Mode::SeedshiftLegacyValid => "Original Seedshift",
        Mode::Direct => "No",
    }
}

/// The Seedshift fact of a result, in the words of the questions: which Seedshift masks the phrase,
/// or none.
pub(crate) fn seedshift_fact(mode: Mode) -> (&'static str, String) {
    let used = match mode {
        Mode::Direct => "not used",
        Mode::Seedshift => "MnemoCode Seedshift",
        Mode::SeedshiftLegacy | Mode::SeedshiftLegacyValid => "Original Seedshift",
    };
    ("Seedshift", used.to_owned())
}

/// Which Seedshift masked them: both as a question offers them.
pub(crate) fn seedshift_choices() -> Vec<Choice<Mode>> {
    vec![
        Choice::noted(
            "MnemoCode Seedshift",
            "a valid BIP39 seed phrase again; recommended",
            Mode::Seedshift,
        ),
        Choice::noted(
            "Original Seedshift",
            "as the original program; one more word to remember",
            Mode::SeedshiftLegacy,
        ),
    ]
}

/// The answers for codes that name no mode: not masked, or masked with one of the variants.
pub(crate) fn encoded_seedshift_choices() -> Vec<Choice<Mode>> {
    let mut all = vec![Choice::noted(
        "No",
        "the codes stand for the words themselves",
        Mode::Direct,
    )];
    all.extend(seedshift_choices());
    all
}

/// What --input-kind reads a text as that may be a Shamir share.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InputKind {
    Codes,
    Share,
}

/// --input-kind, checked before the first question.
pub(crate) fn input_kind_of(parsed: &Parsed) -> Result<Option<InputKind>, Stop> {
    Ok(
        choice_option(parsed, "input-kind", &["codes", "share"])?.map(|kind| {
            if kind == "share" {
                InputKind::Share
            } else {
                InputKind::Codes
            }
        }),
    )
}

/// What the question asks for.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BackupQuestion<'a> {
    pub(crate) parsed: &'a Parsed,
    /// Only a Seedshift mode will do.
    pub(crate) seedshift_only: bool,
    /// The mode that the record read before named, for codes typed after it without a header.
    pub(crate) record_mode: Option<Mode>,
    /// Codes marked with ? are read as codes to search.
    pub(crate) marks: bool,
    /// A Shamir share given here is offered to the restore from shares.
    pub(crate) shares: bool,
    pub(crate) input_kind: Option<InputKind>,
}

/// What the question read.
#[derive(Debug)]
pub(crate) enum ReadBackup {
    /// The codes, with the mode their record named.
    Codes(Backup, Option<Mode>),
    /// Codes marked with ?, with the mode their record named.
    Missing(MissingCodes, Option<Mode>),
    /// A Shamir share, with whether it was read from a QR code image.
    Share(SecretText, bool),
}

/// The file source and its retry prompt; file dispatch remains in `encoded_input`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SourceKind {
    Typed,
    Qr,
    Record,
}
const FILE_SOURCES: [(&str, SourceKind); 2] = [
    ("qr-file", SourceKind::Qr),
    ("input-file", SourceKind::Record),
];
impl SourceKind {
    fn of(parsed: &Parsed) -> Self {
        FILE_SOURCES
            .iter()
            .find_map(|(key, kind)| parsed.contains_key(*key).then_some(*kind))
            .unwrap_or(Self::Typed)
    }
    const fn question(self) -> &'static str {
        match self {
            Self::Qr => "Enter the QR code file name:",
            Self::Record | Self::Typed => "Enter the record file name:",
        }
    }
    fn file_option(self) -> Option<&'static str> {
        FILE_SOURCES
            .iter()
            .find_map(|(key, kind)| (*kind == self).then_some(*key))
    }
}

/// The options for typing after a file: every file-source selector removed, and with them the
/// word count and the kind of file, which told how many of the cards' codes are the phrase's and
/// what a folder was searched for: codes typed are read whole (AUD-008-FUN004).
pub(crate) fn typed_after_file(parsed: &Parsed) -> Parsed {
    let mut typed = parsed.clone();
    for (key, _) in FILE_SOURCES {
        typed.remove(key);
    }
    typed.remove("words");
    typed.remove("find");
    typed
}

/// Whether the options name a record or QR source.
pub(crate) fn from_file(parsed: &Parsed) -> bool {
    SourceKind::of(parsed) != SourceKind::Typed
}

/// The encoded fingerprint of the codes, kept on the screen of the next question: so that a
/// mistyped code is seen before any date is typed. Nothing for none.
pub(crate) fn show_encoded_fingerprint(fingerprint: Option<&str>) {
    let Some(fingerprint) = fingerprint else {
        return;
    };
    let plain = plain_fingerprint_line(false, fingerprint, true);
    keep_context(
        report_fingerprint(ENCODED_FINGERPRINT, fingerprint, &plain),
        Lifetime::Question,
    );
}

/// Where the encoded seed phrase comes from: typed, or a file read again after a problem.
struct BackupSource<'a> {
    kind: SourceKind,
    shares: bool,
    show_share_hint: bool,
    reads: u32,
    parsed: &'a Parsed,
}

impl BackupSource<'_> {
    /// Whether the text read last came from a QR code image.
    const fn reads_qr(&self) -> bool {
        matches!(self.kind, SourceKind::Qr)
    }

    /// The choice that asks for the phrase again.
    fn again_choice<T>(&self, again: T) -> Choice<T> {
        if self.kind == SourceKind::Typed {
            Choice::new(TYPE_ENCODED_AGAIN_LABEL, again)
        } else {
            Choice::noted(READ_ANOTHER_FILE, "or type the encoded seed phrase", again)
        }
    }

    /// The text of the next attempt; `problem`, shown first, is why the last could not be used.
    fn next(&mut self, problem: Option<String>) -> Result<SecretText, Stop> {
        // The words said for cards read before belong to them, not to this attempt.
        super::card_files::forget_chosen_words();
        if self.kind == SourceKind::Typed {
            return self.ask_typed(problem);
        }
        let mut problem = problem;
        if self.reads == 0 {
            self.reads += 1;
            if let Some(text) = retryable_file(encoded_input(self.parsed), &mut problem)? {
                return Ok(text);
            }
        }
        self.other_source(problem)
    }

    /// The longest answer: a whole set where shares are taken.
    const fn limit(&self) -> usize {
        if self.shares {
            SHARE_SET_LIMIT
        } else {
            PATH_LIMIT
        }
    }

    fn ask_typed(&self, problem: Option<String>) -> Result<SecretText, Stop> {
        if let Some(problem) = &problem {
            notice(problem, NoticeKind::Warning);
        }
        if self.show_share_hint {
            let mut lines = hint_lines(
                Channel::Error,
                "Shamir shares are accepted too; separate them with ;.",
            );
            lines.extend(hint_lines(
                Channel::Error,
                "Use ? for each missing or unreadable share code or digit.",
            ));
            keep_context(lines, Lifetime::Question);
        }
        let hints = LineWordHints::new(codes_list, |line| line);
        let ask = Ask {
            hints: Some(&hints),
            text_file: Some(ENCODED_INPUT_FILE),
            files: Some(super::card_files::answered_files),
            pasted_line_break: Some(if self.shares {
                SHARE_SEPARATOR_BYTE
            } else {
                b' '
            }),
            ..secret_ask(
                "Enter the encoded seed phrase, a record or the path of a text file:",
                "the encoded seed phrase or its record",
                self.limit(),
            )
        };
        let typed = super::asking::secret_until(&ask, |text: &str| {
            parse_record(text).map(|_| SecretText::copy_of("the codes", text))
        })?;
        if !self.shares {
            return Ok(typed);
        }
        // Keep line breaks for the library: words still use white space, shares stay apart.
        Ok(SecretText::copy_of(
            "the codes",
            &typed.replace(SHARE_SEPARATOR, "\n"),
        ))
    }

    /// After a file could not be used: another file, the phrase typed instead, or Stop.
    fn other_source(&mut self, problem: Option<String>) -> Result<SecretText, Stop> {
        let mut problem = problem;
        loop {
            if let Some(text) = problem.take() {
                notice(&text, NoticeKind::Warning);
            }
            let typed = or_back_or_cancel(
                WHAT_NOW,
                &[
                    Choice::new(READ_ANOTHER_FILE, false),
                    Choice::noted(TYPE_ENCODED_LABEL, "or paste it", true),
                ],
                false,
            )?;
            if typed == Some(true) {
                self.kind = SourceKind::Typed;
                return self.ask_typed(None);
            }
            let kind = self.kind;
            let Some(path) = value_until(
                kind.question(),
                "the name of the file",
                PATH_LIMIT,
                None,
                |answer: &str| Ok::<_, std::convert::Infallible>(dropped_path(answer)),
            )?
            else {
                continue;
            };
            let Some(key) = kind.file_option() else {
                return self.ask_typed(None);
            };
            let mut parsed = typed_after_file(self.parsed);
            parsed.insert(
                key.to_owned(),
                Given::One(path.to_string_lossy().into_owned()),
            );
            // File validation may retry; cancellation from a nested password question must leave.
            if let Some(text) = retryable_file(encoded_input_from_question(&parsed), &mut problem)?
            {
                return Ok(text);
            }
        }
    }
}

/// Only a validation refusal retries; nested cancellation and signals leave unchanged.
fn retryable_file(
    read: Result<SecretText, Stop>,
    problem: &mut Option<String>,
) -> Result<Option<SecretText>, Stop> {
    match read {
        Ok(text) => Ok(Some(text)),
        Err(stop @ Stop::Refused(_)) => {
            *problem = Some(stop.message());
            Ok(None)
        }
        Err(stop) => Err(stop),
    }
}

/// A further attempt, with why the last one could not be used, if anything is to be said.
struct Again(Option<String>);

/// Asks for the encoded seed phrase on the private screen, or reads the file given, and checks it,
/// until it passes.
pub(crate) fn ask_encoded_backup(question: BackupQuestion<'_>) -> Result<ReadBackup, Stop> {
    let mut source = BackupSource {
        kind: SourceKind::of(question.parsed),
        shares: question.shares,
        show_share_hint: question.shares && question.input_kind != Some(InputKind::Codes),
        reads: 0,
        parsed: question.parsed,
    };
    let mut problem = None;
    loop {
        let text = source.next(problem.take())?;
        // A SeedStitch legend stands for the record of the masked phrase it holds, or for its share.
        let (read, typed) = match super::stitch::text_of_legend(text.as_str()) {
            Ok(Some(read)) => (read, Some(text)),
            Ok(None) => (text, None),
            Err(stop @ Stop::Refused(_)) => {
                question_ended();
                problem = Some(stop.message());
                continue;
            }
            Err(stop) => return Err(stop),
        };
        match checked_backup(&read, question, &source)? {
            // The legend goes to the restore as typed, which checks what it says of Seedshift.
            Ok(ReadBackup::Share(_, from_qr)) if let Some(typed) = typed => {
                return Ok(ReadBackup::Share(typed, from_qr));
            }
            Ok(read) => return Ok(read),
            Err(Again(reason)) => {
                // What was kept for the questions about these codes goes with them.
                question_ended();
                problem = reason;
            }
        }
    }
}

/// The codes alone, for a command that takes neither marks nor shares.
pub(crate) fn ask_encoded_codes(
    question: BackupQuestion<'_>,
) -> Result<(Backup, Option<Mode>), Stop> {
    match ask_encoded_backup(question)? {
        ReadBackup::Codes(backup, mode) => Ok((backup, mode)),
        ReadBackup::Missing(..) | ReadBackup::Share(..) => Err(Stop::Cancelled),
    }
}

/// Whether a Shamir share given in place of the codes is restored from: a text that is surely a
/// share goes to the restore at once; only one that may also be the codes is asked about, unless
/// --input-kind answers it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Offered {
    Share,
    Codes,
    Again,
}

fn offered_restore(
    text: &str,
    source: &BackupSource<'_>,
    input_kind: Option<InputKind>,
) -> Result<Option<Offered>, Stop> {
    let Some(kind) = BackupReading::share_kind(text)? else {
        return Ok(None);
    };
    if input_kind == Some(InputKind::Share) {
        return Ok(Some(Offered::Share));
    }
    if kind == ShareKind::Share {
        notice(
            &format!(
                "These are the codes of a Shamir share: they go to \"{SHARE_READER}\" as its first share."
            ),
            NoticeKind::Info,
        );
        return Ok(Some(Offered::Share));
    }
    after_failure(
        "These may be the codes of a Shamir share, or of the encoded seed phrase.",
        &[
            Choice::noted(SHARE_READER, "kept as the first share", Offered::Share),
            Choice::noted(
                "The encoded seed phrase",
                "its codes with ? are searched",
                Offered::Codes,
            ),
            source.again_choice(Offered::Again),
        ],
        AfterFailure {
            escape: "asks again",
            ..AfterFailure::default()
        },
    )
    .map(Some)
}

/// The refusal of `result` as a further attempt.
fn again_of<T>(result: Result<T, Stop>) -> Result<Result<T, Again>, Stop> {
    match result {
        Ok(value) => Ok(Ok(value)),
        Err(stop @ Stop::Refused(_)) => Ok(Err(Again(Some(stop.message())))),
        Err(stop) => Err(stop),
    }
}

/// What follows codes that lack the checksum of their mode.
#[derive(Clone, Copy)]
enum AfterChecksum {
    /// They were masked with the Original Seedshift.
    Legacy,
    /// The phrase has another length: fewer or more of the codes are its own.
    Length,
    /// Another file, or the codes typed again.
    Again,
}

/// How many words the phrase has, asked after codes of `words` words lacked their checksum; none
/// for back.
fn ask_other_length(words: usize) -> Result<Option<usize>, Stop> {
    let choices: Vec<Choice<usize>> = mnemocode::bip39::sizes::WORD_COUNTS
        .into_iter()
        .filter(|&count| count != words)
        .map(|count| Choice::new(&super::menu_entries::phrase_words_answer(count), count))
        .collect();
    super::asking::ask_list(
        super::menu_entries::PHRASE_WORDS_QUESTION,
        "Words",
        &choices,
        None,
    )
}

fn checked_backup(
    text: &str,
    question: BackupQuestion<'_>,
    source: &BackupSource<'_>,
) -> Result<Result<ReadBackup, Again>, Stop> {
    if question.shares && question.input_kind != Some(InputKind::Codes) {
        match again_of(offered_restore(text, source, question.input_kind))? {
            Err(again) => return Ok(Err(again)),
            Ok(Some(Offered::Share)) => {
                let share = SecretText::copy_of("a share", text);
                return Ok(Ok(ReadBackup::Share(share, source.reads_qr())));
            }
            Ok(Some(Offered::Again)) => return Ok(Err(Again(None))),
            Ok(Some(Offered::Codes) | None) => {}
        }
    }
    // A length chosen after codes of cards lacked their checksum, in place of --words.
    let mut length = None;
    loop {
        let read = phrase_words(question.parsed).and_then(|given| {
            let rules = ReadingRules {
                seedshift_only: question.seedshift_only,
                share_reader: SHARE_READER,
                words: length.or(given),
            };
            Ok(BackupReading::of(text, rules)?)
        });
        let reading = match again_of(read)? {
            Ok(reading) => reading,
            Err(again) => return Ok(Err(again)),
        };
        let Some(settled) = settled_mode(&reading, question, source)? else {
            return Ok(Err(Again(None)));
        };
        if reading.marked() {
            return marked_backup(&reading, settled, question, source);
        }
        let read = codes_and_mode(&reading, settled, question, source, false, |form| {
            Ok(reading.codes(form)?)
        })?;
        let (codes, mode) = match read {
            Ok(read) => read,
            Err(again) => return Ok(Err(again)),
        };
        let recorded = reading.mode(None);
        match codes.with_mode(mode) {
            Ok(backup) => return Ok(Ok(ReadBackup::Codes(backup, recorded))),
            Err(error @ BackupError::Mode(ModeError::MissingChecksum(_))) => {
                // Codes of cards end with decoys: with another length, other codes are the phrase's,
                // whether or not a length was given.
                let words = length.or(phrase_words(question.parsed)?);
                let mut choices = vec![Choice::new(
                    "It was the Original Seedshift",
                    AfterChecksum::Legacy,
                )];
                choices.push(Choice::noted(
                    "Another seed phrase length",
                    "12, 15, 18, 21 or 24 words",
                    AfterChecksum::Length,
                ));
                choices.push(source.again_choice(AfterChecksum::Again));
                let next = after_failure(
                    &error.to_string(),
                    &choices,
                    AfterFailure {
                        escape: "asks again",
                        ..AfterFailure::default()
                    },
                )?;
                match (next, words) {
                    (AfterChecksum::Legacy, _) => {
                        let backup = codes.with_mode(Mode::SeedshiftLegacy)?;
                        return Ok(Ok(ReadBackup::Codes(backup, recorded)));
                    }
                    (AfterChecksum::Length, words) => {
                        // Back from the lengths: the same choice again.
                        if let Some(chosen) = ask_other_length(words.unwrap_or(0))? {
                            length = Some(chosen);
                        }
                    }
                    (AfterChecksum::Again, _) => return Ok(Err(Again(None))),
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// Codes marked with ? where the question takes them; elsewhere they are asked for again.
fn marked_backup(
    reading: &BackupReading,
    settled: Settled,
    question: BackupQuestion<'_>,
    source: &BackupSource<'_>,
) -> Result<Result<ReadBackup, Again>, Stop> {
    if !question.marks {
        return Ok(Err(Again(Some(
            "Every code is needed here: Decode searches codes marked with ?.".to_owned(),
        ))));
    }
    let read = codes_and_mode(reading, settled, question, source, true, |form| {
        Ok(reading.missing_codes(form)?)
    })?;
    Ok(read.map(|(codes, mode)| ReadBackup::Missing(codes.with_mode(mode), reading.mode(None))))
}

/// The mode of the codes, or that it is asked once they read.
#[derive(Clone, Copy)]
enum Settled {
    Mode(Mode),
    Ask,
}

/// The codes of `reading`, read by `read` in their settled form, with their mode.
fn codes_and_mode<Codes>(
    reading: &BackupReading,
    settled: Settled,
    question: BackupQuestion<'_>,
    source: &BackupSource<'_>,
    marked: bool,
    read: impl FnOnce(Form) -> Result<Codes, Stop>,
) -> Result<Result<(Codes, Mode), Again>, Stop> {
    let form = match settled_form(reading, question.parsed, source, marked)? {
        Ok(form) => form,
        Err(again) => return Ok(Err(again)),
    };
    let codes = match again_of(read(form))? {
        Ok(codes) => codes,
        Err(again) => return Ok(Err(again)),
    };
    let mode = match settled {
        Settled::Mode(mode) => Some(mode),
        Settled::Ask => asked_mode(question.seedshift_only)?,
    };
    Ok(mode.map(|mode| (codes, mode)).ok_or(Again(None)))
}

/// The mode of the codes: the record's, which wins over another --mode when the person agrees, or
/// --mode, or the mode of the record read before, or asked; none asks for the codes again.
fn settled_mode(
    reading: &BackupReading,
    question: BackupQuestion<'_>,
    source: &BackupSource<'_>,
) -> Result<Option<Settled>, Stop> {
    let given = given_mode(question.parsed)?;
    if let Some(conflict) = reading.mode_conflict(given) {
        let Some(named) = reading.mode(None) else {
            return Ok(None);
        };
        let record = after_failure(
            &conflict,
            &[
                Choice::noted("As the record says", named.name(), true),
                source.again_choice(false),
            ],
            AfterFailure {
                escape: "asks again",
                ..AfterFailure::default()
            },
        )?;
        return Ok(record.then_some(Settled::Mode(named)));
    }
    Ok(Some(
        reading
            .mode(given)
            .or(question.record_mode)
            .map_or(Settled::Ask, Settled::Mode),
    ))
}

/// How codes that name no mode were masked; none (Escape) asks for the codes again.
fn asked_mode(seedshift_only: bool) -> Result<Option<Mode>, Stop> {
    let choices = if seedshift_only {
        seedshift_choices()
    } else {
        keep_context(
            notice_lines(
                "Whether Seedshift was used is not written in the backup: only you know it.",
                NoticeKind::Info,
            ),
            Lifetime::Question,
        );
        encoded_seedshift_choices()
    };
    let asked = ListQuestion {
        question: if seedshift_only {
            WHICH_SEEDSHIFT_QUESTION
        } else {
            ENCODED_SEEDSHIFT_QUESTION
        },
        label: "Seedshift",
        quit: "asks for the codes again",
        explanation: None,
    };
    match choose(&asked, None, &choices)? {
        Chosen::One(mode) => Ok(Some(mode)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// The form of the codes: the record's, --format, or the one that fits; asked when several fit.
fn settled_form(
    reading: &BackupReading,
    parsed: &Parsed,
    source: &BackupSource<'_>,
    marked: bool,
) -> Result<Result<Form, Again>, Stop> {
    let given = given_form(parsed)?;
    if let Some(conflict) = reading.form_conflict(given) {
        let recorded = reading.forms(None)?;
        let form = recorded[0];
        let record = after_failure(
            &conflict,
            &[
                Choice::new(&format!("Read them as {}", form.name()), true),
                source.again_choice(false),
            ],
            AfterFailure {
                escape: "asks again",
                ..AfterFailure::default()
            },
        )?;
        return Ok(if record { Ok(form) } else { Err(Again(None)) });
    }
    let fitting = if marked {
        again_of(reading.marked_forms(given).map_err(Stop::from))?
    } else {
        again_of(reading.forms(given).map_err(Stop::from))?
    };
    let fitting = match fitting {
        Ok(fitting) => fitting,
        Err(again) => return Ok(Err(again)),
    };
    // A record or --format names the form; only a detected one is announced.
    if reading.has_record() || given.is_some() {
        return Ok(Ok(fitting[0]));
    }
    Ok(detected_form(&fitting, "asks for the codes again")?.ok_or(Again(None)))
}

#[cfg(test)]
mod source_tests {
    use super::*;

    #[test]
    fn every_file_kind_is_read_before_falling_back_to_typed_codes() {
        for (key, expected) in FILE_SOURCES {
            let mut parsed = Parsed::new();
            parsed.insert(key.to_owned(), Given::One("public-fixture".to_owned()));
            // The word count said for the cards of the file does not cut the codes typed after it.
            parsed.insert("words".to_owned(), Given::One("12".to_owned()));
            assert_eq!(SourceKind::of(&parsed), expected);
            assert!(from_file(&parsed));
            let typed = typed_after_file(&parsed);
            assert_eq!(SourceKind::of(&typed), SourceKind::Typed);
            assert!(!from_file(&typed));
            assert!(!typed.contains_key("words"));
        }
    }
}
