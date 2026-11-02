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
    given_form, given_mode, phrase_words, read_qr_path,
};
use crate::args::{Parsed, choice_option, value};
use crate::gate::Stop;
use crate::input::{Ask, dropped_path, read_input_path, secret_ask};
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

/// Its answers: shares take only MnemoCode Seedshift, so there is nothing more to choose.
pub(crate) fn share_seedshift_choices() -> [Choice<Mode>; 2] {
    [
        Choice::new("No", Mode::Direct),
        Choice::noted(
            "Yes",
            "the dates are asked after the shares",
            Mode::Seedshift,
        ),
    ]
}

/// The answer of a share's question for `mode`, as the sheet for heirs names it.
pub(crate) fn share_seedshift_label(mode: Mode) -> &'static str {
    if mode.masked() { "Yes" } else { "No" }
}

/// The answer of the question of codes that name no mode for `mode`, as the sheet names it.
pub(crate) fn encoded_seedshift_label(mode: Mode) -> &'static str {
    match mode {
        Mode::Seedshift => "MnemoCode Seedshift",
        Mode::SeedshiftLegacy => "Original Seedshift",
        _ => "No",
    }
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
            "as the original program; checksum usually fails",
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

/// The options for typing the encoded seed phrase after it was read: without its file.
pub(crate) fn typed_after_file(parsed: &Parsed) -> Parsed {
    let mut typed = parsed.clone();
    typed.remove("input-file");
    typed.remove("qr-file");
    typed
}

/// Whether the options name a file of the encoded seed phrase.
pub(crate) fn from_file(parsed: &Parsed) -> bool {
    value(parsed, "input-file").is_some() || value(parsed, "qr-file").is_some()
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
    typed: bool,
    qr: bool,
    shares: bool,
    show_share_hint: bool,
    reads: u32,
    parsed: &'a Parsed,
}

impl BackupSource<'_> {
    /// Whether the text read last came from a QR code image.
    const fn reads_qr(&self) -> bool {
        !self.typed && self.qr
    }

    /// The choice that asks for the phrase again.
    fn again_choice<T>(&self, again: T) -> Choice<T> {
        if self.typed {
            Choice::new(TYPE_ENCODED_AGAIN_LABEL, again)
        } else {
            Choice::noted(READ_ANOTHER_FILE, "or type the encoded seed phrase", again)
        }
    }

    /// The text of the next attempt; `problem`, shown first, is why the last could not be used.
    fn next(&mut self, problem: Option<String>) -> Result<SecretText, Stop> {
        if self.typed {
            return self.ask_typed(problem);
        }
        let mut problem = problem;
        if self.reads == 0 {
            self.reads += 1;
            match encoded_input(self.parsed) {
                Ok(text) => return Ok(text),
                Err(stop @ Stop::Refused(_)) => problem = Some(stop.message()),
                Err(stop) => return Err(stop),
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
            pasted_line_break: Some(if self.shares {
                SHARE_SEPARATOR_BYTE
            } else {
                b' '
            }),
            ..secret_ask(
                "Encoded seed phrase, record or text file path:",
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
                self.typed = true;
                return self.ask_typed(None);
            }
            let qr = self.qr;
            let prompt = if qr {
                "QR code file name:"
            } else {
                "Record file name:"
            };
            let read = value_until(
                prompt,
                "the name of the file",
                PATH_LIMIT,
                None,
                |answer: &str| {
                    let path = dropped_path(answer);
                    let text = if qr {
                        read_qr_path(&path, true)
                    } else {
                        read_input_path(&path, "The file", self.limit(), true).map_err(Stop::from)
                    };
                    text.map_err(|stop| stop.message())
                },
            )?;
            if let Some(text) = read {
                return Ok(text);
            }
        }
    }
}

/// A further attempt, with why the last one could not be used, if anything is to be said.
struct Again(Option<String>);

/// Asks for the encoded seed phrase on the private screen, or reads the file given, and checks it,
/// until it passes.
pub(crate) fn ask_encoded_backup(question: BackupQuestion<'_>) -> Result<ReadBackup, Stop> {
    let qr = value(question.parsed, "qr-file").is_some();
    let mut source = BackupSource {
        typed: !qr && value(question.parsed, "input-file").is_none(),
        qr,
        shares: question.shares,
        show_share_hint: question.shares && question.input_kind != Some(InputKind::Codes),
        reads: 0,
        parsed: question.parsed,
    };
    let mut problem = None;
    loop {
        let text = source.next(problem.take())?;
        match checked_backup(&text, question, &source)? {
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
    let read = phrase_words(question.parsed).and_then(|words| {
        let rules = ReadingRules {
            seedshift_only: question.seedshift_only,
            share_reader: SHARE_READER,
            words,
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
        Ok(backup) => Ok(Ok(ReadBackup::Codes(backup, recorded))),
        Err(error @ BackupError::Mode(ModeError::MissingChecksum(_))) => {
            let legacy = after_failure(
                &error.to_string(),
                &[
                    Choice::new("It was the Original Seedshift", true),
                    source.again_choice(false),
                ],
                AfterFailure {
                    escape: "asks again",
                    ..AfterFailure::default()
                },
            )?;
            if !legacy {
                return Ok(Err(Again(None)));
            }
            let backup = codes.with_mode(Mode::SeedshiftLegacy)?;
            Ok(Ok(ReadBackup::Codes(backup, recorded)))
        }
        Err(error) => Err(error.into()),
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
                "These codes have no MNC1 record header, so they do not say how they were made.",
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
