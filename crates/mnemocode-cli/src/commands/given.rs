//! What the commands are given (MnemoCode TS 0.1.0's `cli/input.ts`): the mode and the form of
//! codes from their options, and the phrase and the dates from options, files or questions on the
//! private screen. Each text input has its own limit, its longest canonical answer rounded up to a
//! power of two (PLAN.md, answer limits).

use std::fmt;

use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::dates::{DATE_FORMAT_TEXT, Date, maximum_dates, parse_date};
use mnemocode::forms::Form;
use mnemocode::forms::hints::BIP39;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode::text::words::list_in_words;

use crate::args::{Parsed, assert_asked_not_given, is_on, value, values};
use crate::gate::Stop;
use crate::input::{Ask, Left, ask_until, read_input_text, secret_ask};

/// A phrase of 24 words of eight letters and the spaces between them: 215 bytes.
pub(crate) const PHRASE_LIMIT: usize = 256;
/// Eight dates DD-MM-YYYY and the spaces between them: 87 bytes.
pub(crate) const DATES_LIMIT: usize = 128;
const _: () = assert!(24 * 8 + 23 <= PHRASE_LIMIT && 8 * 10 + 7 <= DATES_LIMIT);

/// The refusals of what a command is given, word for word as TS 0.1.0 writes them.
#[derive(Debug)]
pub(crate) enum GivenError {
    /// A text given both directly and in a file; what it is.
    BothSources(&'static str),
    /// A text given neither way; what it is.
    NoSource(&'static str),
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
            Self::NoSource(subject) => {
                write!(f, "Provide {subject} in a file or through --ask-secrets.")
            }
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
            Self::NoSource(_) => "cli.input.provide-as-direct-text-file-through-ask-secrets",
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

/// The mode of --mode; without it, Seedshift where dates are given and direct otherwise.
pub(crate) fn transform_mode(parsed: &Parsed) -> Result<Mode, GivenError> {
    if let Some(name) = value(parsed, "mode") {
        return Mode::named(name).map_err(|_| GivenError::Mode);
    }
    let dated = !values(parsed, "date").is_empty() || value(parsed, "dates-file").is_some();
    Ok(if dated { Mode::Seedshift } else { Mode::Direct })
}

/// The text of option `key` given directly or in its file (`<key>-file`), the file at most `limit`
/// bytes; `subject` and `file` name it in a refusal.
pub(crate) fn text_input(
    parsed: &Parsed,
    key: &str,
    (subject, file): (&'static str, &'static str),
    limit: usize,
) -> Result<SecretText, Stop> {
    let direct = value(parsed, key);
    let path = value(parsed, &format!("{key}-file"));
    match (direct, path) {
        (Some(_), Some(_)) => Err(GivenError::BothSources(subject).into()),
        (None, None) => Err(GivenError::NoSource(subject).into()),
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

/// The question for the dates of a phrase of `word_count` words.
pub(crate) fn dates_prompt(word_count: Option<usize>) -> String {
    let most = word_count
        .filter(|words| words % 3 == 0 && (12..=24).contains(words))
        .map_or_else(String::new, |words| {
            format!("up to {}, ", maximum_dates(words))
        });
    format!("Dates ({most}{DATE_FORMAT_TEXT}, separated by spaces):")
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
pub(crate) fn ask_dates(word_count: Option<usize>) -> Result<Asked<Vec<Date>>, Stop> {
    let ask = secret_ask(&dates_prompt(word_count), "the dates", DATES_LIMIT);
    Ok(ask_until(&ask, true, |line| {
        DatesAnswer::parse(line, word_count, false).map(|answer| answer.known().iter().collect())
    })?)
}

/// The phrase and the dates to encode: asked with --ask-secrets, from the options otherwise; the
/// count of dates refused where `mode` does not take it.
pub(crate) fn phrase_and_dates(
    parsed: &Parsed,
    mode: Mode,
    words: DateWords,
) -> Result<Asked<(Phrase, Vec<Date>)>, Stop> {
    let (phrase, dates) = if is_on(parsed, "ask-secrets") {
        assert_asked_not_given(parsed, &["mnemonic", "mnemonic-file", "date", "dates-file"])?;
        let phrase = match ask_phrase()? {
            Ok(phrase) => phrase,
            Err(left) => return Ok(Err(left)),
        };
        let dates = if mode.masked() {
            match ask_dates(Some(phrase.len()))? {
                Ok(dates) => dates,
                Err(left) => return Ok(Err(left)),
            }
        } else {
            Vec::new()
        };
        (phrase, dates)
    } else {
        let text = text_input(
            parsed,
            "mnemonic",
            ("the mnemonic", "The mnemonic file"),
            PHRASE_LIMIT,
        )?;
        (Phrase::parse(&text)?, dates(parsed)?)
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
