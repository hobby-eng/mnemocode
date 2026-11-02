//! What the commands are given (MnemoCode TS 0.1.0's `cli/input.ts`): the mode and the form of
//! codes from their options, and the phrase and the dates from options, files or questions on the
//! private screen. Each text input has its own limit, its longest canonical answer rounded up to a
//! power of two (PLAN.md, answer limits).

use std::fmt;
use std::path::Path;

use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::bip39::sizes::{WORD_COUNTS, word_counts_text};
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::dates::{DATE_FORMAT_TEXT, Date, maximum_dates, parse_date};
use mnemocode::forms::Form;
use mnemocode::forms::hints::BIP39;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::recovery::reading::{BackupReading, ReadingRules, mode_conflict_of};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode::text::numbers::WholeRange;
use mnemocode::text::words::list_in_words;

use crate::args::{Parsed, assert_asked_not_given, integer_option, is_on, value, values};
use crate::gate::Stop;
use crate::input::{Ask, Left, ask_until, read_input_text, read_qr_bytes, secret_ask};
use crate::terminal::{
    Choice, Chosen, Lifetime, ListQuestion, NoticeKind, choose, keep_context, notice_lines,
    terminal_available,
};

/// A phrase of 24 words of eight letters and the spaces between them: 215 bytes.
pub(crate) const PHRASE_LIMIT: usize = 256;
/// Eight dates DD-MM-YYYY and the spaces between them: 87 bytes.
pub(crate) const DATES_LIMIT: usize = 128;
const _: () = assert!(24 * 8 + 23 <= PHRASE_LIMIT && 8 * 10 + 7 <= DATES_LIMIT);
/// What has no longest answer of its own: a path, a passphrase, or codes with their decoys.
pub(crate) const PATH_LIMIT: usize = 4096;
/// A pattern of forgotten words at the search's limit of combinations, two places holding all 2048
/// words and one holding four: 26,456 bytes.
pub(crate) const PATTERN_LIMIT: usize = 32 * 1024;
/// The one answer that holds a whole set of shares: 58,879 bytes.
pub(crate) const SHARE_SET_LIMIT: usize = 64 * 1024;
/// The options that give a seed phrase.
pub(crate) const PHRASE_SECRET_OPTIONS: [&str; 2] = ["mnemonic", "mnemonic-file"];
/// The question of a form when codes fit several.
const WHICH_FORMAT: &str = "The input fits more than one format. Which format was recorded?";
/// The option that gives dates, which --ask-secrets asks for on the private screen too.
pub(crate) const DATES_OPTION: &str = "date";
/// What a refusal of a file of the encoded seed phrase names it by.
pub(crate) const ENCODED_INPUT_FILE: &str = "The encoded input file";
/// Where the person reads Shamir shares, for a share given in place of the codes.
pub(crate) const SHARE_READER: &str = "Restore a seed phrase from Shamir shares";
/// The menu's entry that decodes, which a seed phrase typed in place of a share is sent to.
pub(crate) const DECODE_ENTRY: &str = "Decode numbers, codes or colors back into a seed phrase";
/// The word counts of --words, within which a count that is none is refused in words.
pub(crate) const WORD_COUNT_RANGE: WholeRange = WholeRange::new(12, 24);

/// The refusals of what a command is given, word for word as TS 0.1.0 writes them.
#[derive(Debug)]
pub(crate) enum GivenError {
    /// A text given both directly and in a file; what it is.
    BothSources(&'static str),
    /// A text given neither way; what it is, and where it may be.
    NoSource(&'static str, &'static str),
    /// A QR image together with text.
    OneEncodedSource,
    /// A count of words that no phrase has.
    WordCount,
    /// Codes that fit several forms, where nothing can ask.
    SeveralForms(String),
    /// What the record says against --format.
    FormConflict(String),
    /// What the record says against --mode.
    ModeConflict(String),
    /// A form that is none.
    Format,
    /// A mode that is none.
    Mode,
}

impl fmt::Display for GivenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BothSources(subject) => {
                write!(
                    f,
                    "Provide {subject} either as direct text or in a file, but not both."
                )
            }
            Self::NoSource(subject, sources) => {
                write!(f, "Provide {subject} {sources} or through --ask-secrets.")
            }
            Self::OneEncodedSource => {
                f.write_str("Choose one encoded input source: a QR image or a text file.")
            }
            Self::WordCount => {
                write!(f, "The mnemonic word count must be {}.", word_counts_text())
            }
            Self::SeveralForms(forms) => write!(
                f,
                "The input matches several formats ({forms}). Choose the recorded format explicitly."
            ),
            Self::FormConflict(conflict) | Self::ModeConflict(conflict) => f.write_str(conflict),
            Self::Format => write!(
                f,
                "The representation format must be one of: {}. Use the number or the name.",
                format_legend()
            ),
            Self::Mode => {
                let names: Vec<&str> = Mode::ALL.iter().map(|mode| mode.id()).collect();
                write!(
                    f,
                    "The transformation mode must be {}.",
                    list_in_words(&names, "or")
                )
            }
        }
    }
}

impl std::error::Error for GivenError {}

impl Refusal for GivenError {
    fn code(&self) -> &'static str {
        match self {
            Self::BothSources(_) => "cli.input.provide-either-as-direct-text-file-but-not",
            Self::NoSource(..) => "cli.input.provide-as-direct-text-file-through-ask-secrets",
            Self::OneEncodedSource => "cli.input.choose-one-encoded-input-source-qr-image-direct",
            Self::WordCount => "cli.input.mnemonic-word-count",
            Self::SeveralForms(_) => {
                "cli.input.input-matches-several-formats-choose-recorded-format-explicitly"
            }
            Self::FormConflict(_) => "cli.input.backup-from-options-refused",
            Self::ModeConflict(_) => "cli.input.transform-mode-refused",
            Self::Format => "cli.input.representation-format-one-use-number-name",
            Self::Mode => "cli.input.transformation-mode",
        }
    }
}

/// The number of a form for --format: its place in [`Form::ALL`], from 1.
pub(crate) fn format_number(form: Form) -> usize {
    Form::ALL.iter().position(|each| *each == form).unwrap_or(0) + 1
}

/// Every form with its number: "1 english, 2 indexes, …".
pub(crate) fn format_legend() -> String {
    Form::ALL
        .iter()
        .map(|form| format!("{} {}", format_number(*form), form.name()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The form `text` names, by its number or its name.
pub(crate) fn input_format(text: &str) -> Result<Form, GivenError> {
    Form::ALL
        .into_iter()
        .find(|form| text == form.name() || text == format_number(*form).to_string())
        .ok_or(GivenError::Format)
}

/// The form of --format, English words where it is not given.
pub(crate) fn encode_format(parsed: &Parsed) -> Result<Form, GivenError> {
    value(parsed, "format").map_or(Ok(Form::English), input_format)
}

/// The forms that print on cards, by their numbers, as a refusal names them: "3, 4 or 5".
pub(crate) fn card_format_numbers() -> String {
    let numbers: Vec<usize> = Form::ALL
        .iter()
        .filter(|form| form.has_cards())
        .map(|form| format_number(*form))
        .collect();
    list_in_words(&numbers, "or")
}

/// The forms written in colors, by their numbers, as the help and the messages name them.
pub(crate) fn color_format_numbers() -> String {
    let numbers: Vec<usize> = Form::ALL
        .iter()
        .filter(|form| form.written_in_colors())
        .map(|form| format_number(*form))
        .collect();
    list_in_words(&numbers, "and")
}

/// The form that --format names; none without it.
pub(crate) fn given_form(parsed: &Parsed) -> Result<Option<Form>, GivenError> {
    value(parsed, "format").map(input_format).transpose()
}

/// The mode that --mode names; none without it.
pub(crate) fn given_mode(parsed: &Parsed) -> Result<Option<Mode>, GivenError> {
    value(parsed, "mode")
        .map(|name| Mode::named(name).map_err(|_| GivenError::Mode))
        .transpose()
}

/// The mode of the codes: --mode, else `recorded`, the one their record names, else Seedshift
/// where dates are given and direct otherwise; refused where --mode differs from the record.
pub(crate) fn transform_mode(parsed: &Parsed, recorded: Option<Mode>) -> Result<Mode, GivenError> {
    let given = given_mode(parsed)?;
    if let Some(conflict) = mode_conflict_of(recorded, given) {
        return Err(GivenError::ModeConflict(conflict));
    }
    if let Some(mode) = given.or(recorded) {
        return Ok(mode);
    }
    let dated = !values(parsed, "date").is_empty() || value(parsed, "dates-file").is_some();
    Ok(if dated { Mode::Seedshift } else { Mode::Direct })
}

/// The words of the seed phrase that --words gives: of codes from printed cards, which end with
/// decoys, only those of so many words from the start are read.
pub(crate) fn phrase_words(parsed: &Parsed) -> Result<Option<usize>, Stop> {
    if value(parsed, "words").is_none() {
        return Ok(None);
    }
    let words = integer_option(parsed, "words", WORD_COUNT_RANGE, None, None)? as usize;
    if !WORD_COUNTS.contains(&words) {
        return Err(GivenError::WordCount.into());
    }
    Ok(Some(words))
}

/// The encoded seed phrase of --input, --input-file or --qr-file.
pub(crate) fn encoded_input(parsed: &Parsed) -> Result<SecretText, Stop> {
    let Some(path) = value(parsed, "qr-file") else {
        return text_input(
            parsed,
            "input",
            (
                "the encoded input",
                ENCODED_INPUT_FILE,
                "in a file, in a QR image",
            ),
            SHARE_SET_LIMIT,
        );
    };
    if value(parsed, "input").is_some() || value(parsed, "input-file").is_some() {
        return Err(GivenError::OneEncodedSource.into());
    }
    read_qr_path(Path::new(path), false)
}

/// The encoded seed phrase given with the options, read as the screen reads typed codes: a share,
/// a header that cannot be read or codes that fit no form are refused with the library's reason,
/// and a mode or form that the record contradicts too. `mode_known` is called with the mode as soon
/// as it is settled: a refusal by the mode comes before any by the form. Codes that fit several
/// forms are asked about on a terminal; anywhere else they end the command.
pub(crate) fn backup_from_options(
    parsed: &Parsed,
    seedshift_only: bool,
    mode_known: impl FnOnce(Mode) -> Result<(), Stop>,
) -> Result<Backup, Stop> {
    let reading = BackupReading::of(
        &encoded_input(parsed)?,
        ReadingRules {
            seedshift_only,
            share_reader: SHARE_READER,
            words: phrase_words(parsed)?,
        },
    )?;
    let mode = transform_mode(parsed, reading.mode(None))?;
    mode_known(mode)?;
    let given = given_form(parsed)?;
    if let Some(conflict) = reading.form_conflict(given) {
        return Err(GivenError::FormConflict(conflict).into());
    }
    let fitting = reading.forms(given)?;
    let mut form = fitting[0];
    // A record or --format names the form; only a detected one is announced.
    if !reading.has_record() && given.is_none() {
        if fitting.len() > 1 && !terminal_available() {
            let names: Vec<&str> = fitting.iter().map(|form| form.name()).collect();
            return Err(GivenError::SeveralForms(names.join(", ")).into());
        }
        form = detected_form(&fitting, "cancels")?.ok_or(Stop::Cancelled)?;
    }
    Ok(reading.codes(form)?.with_mode(mode)?)
}

/// The form of codes that `fitting` forms read, as detected: the one, or the one the person picks,
/// each said in one line; none when the person leaves with Escape.
pub(crate) fn detected_form(fitting: &[Form], quit: &str) -> Result<Option<Form>, Stop> {
    let form = if let [form] = fitting {
        *form
    } else {
        let choices: Vec<Choice<Form>> = fitting
            .iter()
            .map(|form| Choice::new(form.name(), *form))
            .collect();
        let asked = ListQuestion {
            question: WHICH_FORMAT,
            label: "Format",
            quit,
            explanation: None,
        };
        match choose(&asked, None, &choices)? {
            Chosen::One(form) => form,
            Chosen::Back => return Ok(None),
            Chosen::Cancelled => return Err(Stop::Cancelled),
        }
    };
    keep_context(
        notice_lines(
            &format!("Detected input format: {}.", form.name()),
            NoticeKind::Info,
        ),
        Lifetime::Question,
    );
    Ok(Some(form))
}

/// Refuses with --ask-secrets what it asks on the private screen: the codes and the dates.
pub(crate) fn assert_asked_encoded_input(parsed: &Parsed) -> Result<(), Stop> {
    Ok(assert_asked_not_given(
        parsed,
        &["input", DATES_OPTION, "dates-file"],
    )?)
}

/// Refuses a QR image beside the text of the codes.
pub(crate) fn assert_one_encoded_source(parsed: &Parsed) -> Result<(), Stop> {
    let text = value(parsed, "input").is_some() || value(parsed, "input-file").is_some();
    if value(parsed, "qr-file").is_some() && text {
        return Err(GivenError::OneEncodedSource.into());
    }
    Ok(())
}

/// The text of the QR code in the PNG file at `path`, read by the library's strict reader;
/// `regular_only` for a name typed at a question (read_qr_bytes).
pub(crate) fn read_qr_path(path: &Path, regular_only: bool) -> Result<SecretText, Stop> {
    Ok(mnemocode::qr::read_png(&read_qr_bytes(
        path,
        regular_only,
    )?)?)
}

/// The dates or date patterns of --date or --dates-file, as one answer.
pub(crate) fn date_input_text(parsed: &Parsed) -> Result<SecretText, Stop> {
    let direct = values(parsed, "date");
    let Some(path) = value(parsed, "dates-file") else {
        return Ok(SecretText::copy_of("the dates", &direct.join(" ")));
    };
    if !direct.is_empty() {
        return Err(GivenError::BothSources("the dates").into());
    }
    Ok(read_input_text(path, "The dates file", PATH_LIMIT)?)
}

/// The text of option `key` given directly or in its file (`<key>-file`), the file at most `limit`
/// bytes; `subject`, `file` and `sources` name it in a refusal.
pub(crate) fn text_input(
    parsed: &Parsed,
    key: &str,
    (subject, file, sources): (&'static str, &'static str, &'static str),
    limit: usize,
) -> Result<SecretText, Stop> {
    let direct = value(parsed, key);
    let path = value(parsed, &format!("{key}-file"));
    match (direct, path) {
        (Some(_), Some(_)) => Err(GivenError::BothSources(subject).into()),
        (None, None) => Err(GivenError::NoSource(subject, sources).into()),
        (Some(text), None) => Ok(SecretText::copy_of("a text option", text)),
        (None, Some(path)) => Ok(read_input_text(path, file, limit)?),
    }
}

/// The dates of --date, each read as a date, or of --dates-file, read as typed dates.
pub(crate) fn dates(parsed: &Parsed) -> Result<Vec<Date>, Stop> {
    let direct = values(parsed, "date");
    let Some(path) = value(parsed, "dates-file") else {
        return Ok(direct
            .iter()
            .map(|text| parse_date(text))
            .collect::<Result<_, _>>()?);
    };
    if !direct.is_empty() {
        return Err(GivenError::BothSources("the dates").into());
    }
    let text = read_input_text(path, "The dates file", DATES_LIMIT)?;
    Ok(DatesAnswer::parse(&text, None, false)?
        .known()
        .iter()
        .collect())
}

/// Refuses a count of dates `mode` does not take, unless they are asked later; a dates file counts
/// as one, as it is read only once the secret is.
pub(crate) fn check_date_input(parsed: &Parsed, mode: Mode, words: DateWords) -> Result<(), Stop> {
    if is_on(parsed, "ask-secrets") {
        return Ok(());
    }
    let count = if value(parsed, "dates-file").is_some() {
        1
    } else {
        values(parsed, "date").len()
    };
    Ok(mode.check_date_count(count, false, words)?)
}

/// "up to N, " for a seed phrase of `word_count` words; nothing when the count is not known yet.
pub(crate) fn most_dates(word_count: Option<usize>) -> String {
    word_count
        .filter(|words| words % 3 == 0 && (12..=24).contains(words))
        .map_or_else(String::new, |words| {
            format!("up to {}, ", maximum_dates(words))
        })
}

/// The question for the dates of a phrase of `word_count` words.
pub(crate) fn dates_prompt(word_count: Option<usize>) -> String {
    format!(
        "Dates ({}{DATE_FORMAT_TEXT}, separated by spaces):",
        most_dates(word_count)
    )
}

/// What a question gave: its answer, or that the person left.
pub(crate) type Asked<T> = Result<T, Left>;

/// Asks the seed phrase on the private screen, with the hints of the English words, until it is a
/// valid phrase.
pub(crate) fn ask_phrase() -> Result<Asked<Phrase>, Stop> {
    let ask = Ask {
        hints: Some(&*BIP39),
        ..secret_ask(
            "Seed phrase (English BIP39 words):",
            "the words of the seed phrase",
            PHRASE_LIMIT,
        )
    };
    Ok(ask_until(&ask, true, Phrase::parse)?)
}

/// Asks the dates of a phrase of `word_count` words on the private screen.
fn ask_known_dates(word_count: Option<usize>) -> Result<Asked<Vec<Date>>, Stop> {
    let ask = secret_ask(&dates_prompt(word_count), "the dates", DATES_LIMIT);
    Ok(ask_until(&ask, true, |line| {
        DatesAnswer::parse(line, word_count, false).map(|answer| answer.known().iter().collect())
    })?)
}

/// The phrase and the dates to encode: asked with --ask-secrets, from the options otherwise; the
/// count of dates refused where `mode` does not take it. A `known` phrase, which Re-encode decoded
/// and confirmed, is neither asked nor read: only its dates are.
pub(crate) fn phrase_and_dates(
    parsed: &Parsed,
    mode: Mode,
    words: DateWords,
    known: Option<&Phrase>,
) -> Result<Asked<(Phrase, Vec<Date>)>, Stop> {
    let (phrase, dates) = if is_on(parsed, "ask-secrets") {
        assert_asked_not_given(parsed, &["mnemonic", "mnemonic-file", "date", "dates-file"])?;
        let phrase = match known
            .map(Phrase::copy)
            .map_or_else(ask_phrase, |phrase| Ok(Ok(phrase)))?
        {
            Ok(phrase) => phrase,
            Err(left) => return Ok(Err(left)),
        };
        let dates = if mode.masked() {
            match ask_known_dates(Some(phrase.len()))? {
                Ok(dates) => dates,
                Err(left) => return Ok(Err(left)),
            }
        } else {
            Vec::new()
        };
        (phrase, dates)
    } else {
        let phrase = match known {
            Some(phrase) => phrase.copy(),
            None => {
                let text = text_input(
                    parsed,
                    "mnemonic",
                    ("the mnemonic", "The mnemonic file", "in a file"),
                    PHRASE_LIMIT,
                )?;
                Phrase::parse(&text)?
            }
        };
        (phrase, dates(parsed)?)
    };
    mode.check_date_count(dates.len(), false, words)?;
    Ok(Ok((phrase, dates)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forms_go_by_number_or_name() {
        assert_eq!(
            format_legend(),
            "1 english, 2 indexes, 3 unicode, 4 colors-unicode, 5 colors"
        );
        assert_eq!(input_format("4").unwrap(), Form::ColorsUnicode);
        assert_eq!(input_format("colors").unwrap(), Form::Colors);
        assert!(input_format("6").is_err());
        assert_eq!(
            dates_prompt(Some(12)),
            "Dates (up to 4, DD-MM-YYYY, separated by spaces):"
        );
        assert_eq!(
            dates_prompt(None),
            "Dates (DD-MM-YYYY, separated by spaces):"
        );
    }
}
