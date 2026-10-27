//! `mnemocode encode` (MnemoCode TS 0.1.0's `cli/encode-command.ts`, `encode-report.ts` and the
//! record of `encode-export.ts`, CAP-PHRASE-FORMATS-ENCODE): a seed phrase written as codes in one
//! form, masked with the dates where the mode masks; shown on the private screen with both
//! fingerprints, and saved as an MNC1 record where --output asks. Cards, shares, QR codes, the
//! sheet for heirs and the backup check come with their increments.

use std::fmt;
use std::path::Path;

use mnemocode::backup::{Backup, Encoding};
use mnemocode::bip32::{ExtendedKey, fingerprint_hex};
use mnemocode::bip39::phrase::Phrase;
use mnemocode::forms::Form;
use mnemocode::modes::phrase_words::{FINGERPRINT_ROLES, ORIGINAL_FINGERPRINT};
use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::Refusal;

use super::given::{check_date_input, encode_format, phrase_and_dates, transform_mode};
use crate::args::{Parsed, choice_option, is_on, value};
use crate::gate::Stop;
use crate::os;
use crate::terminal::result::{
    backup_code_lines, plain_fingerprint_line, print, print_phrase, print_sentence, result_header,
};
use crate::terminal::{
    self, Channel, NoticeKind, can_redraw, clear_private_screen, hint, more_line, notice,
    printable, saved,
};

/// The options `encode` takes.
pub(crate) const OPTIONS: [&str; 11] = [
    "mode",
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "date",
    "dates-file",
    "format",
    "show-masked-words",
    "show-original",
    "output",
    "legacy-valid-last-word",
];

/// The one value --show-original takes.
const ORIGINAL_COPY_FORM: &str = "words";
/// Why the codes of the Original Seedshift have no encoded fingerprint.
const NO_ENCODED_FINGERPRINT: &str =
    "unavailable because legacy Seedshift output may have an invalid BIP39 checksum";

/// The refusal of --show-masked-words without a mask.
#[derive(Debug)]
struct MaskedWordsNeedSeedshift;

impl fmt::Display for MaskedWordsNeedSeedshift {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("--show-masked-words needs a Seedshift mode.")
    }
}

impl std::error::Error for MaskedWordsNeedSeedshift {}

impl Refusal for MaskedWordsNeedSeedshift {
    fn code(&self) -> &'static str {
        "cli.encode-report.masked-words-need-seedshift"
    }
}

/// What the codes of `form` in `mode` hold, as the result names them.
pub(crate) fn encoded_output_label(form: Form, mode: Mode) -> String {
    let form = match form {
        Form::English => "English BIP39 words",
        Form::Indexes => "BIP39 word indexes (1-2048)",
        Form::Unicode => "Unicode code points",
        Form::Colors => "BIP39Colors RGB hexadecimal codes",
        Form::ColorsUnicode => "MnemoCode color Unicode code points",
    };
    format!("{form} of {}", mode.holds())
}

/// The master fingerprint of `phrase` with no passphrase, in hexadecimal.
pub(crate) fn fingerprint_of(phrase: &Phrase) -> Result<String, Stop> {
    Ok(fingerprint_hex(
        ExtendedKey::of_phrase(phrase, "")?.fingerprint()?,
    ))
}

/// The codes of `backup` under their heading, or under their label for a script.
pub(crate) fn print_encoded_backup(backup: &Backup, title: &str) -> Result<(), Stop> {
    let label = encoded_output_label(backup.form(), backup.mode());
    let facts = [
        ("Mode", backup.mode().id().to_owned()),
        ("Format", backup.form().name().to_owned()),
        ("Content", label.clone()),
    ];
    if !result_header(title, &facts, Channel::Output) {
        print(Channel::Output, &[format!("{label}:")]);
    }
    print(
        Channel::Output,
        &backup_code_lines(&backup.text()?, backup.form(), "backup"),
    );
    Ok(())
}

/// Both fingerprints: the original's, and the codes', where they are a valid phrase.
pub(crate) fn print_fingerprints(mode: Mode, original: &str, encoded: Option<&str>) {
    if can_redraw(Channel::Error) {
        terminal::error_line("");
        terminal::status(ORIGINAL_FINGERPRINT, original, true);
        let label = mode.encoded_fingerprint_label();
        match encoded {
            None => terminal::status(label, NO_ENCODED_FINGERPRINT, false),
            Some(encoded) => terminal::status(label, encoded, true),
        }
        if mode.masked() {
            hint(FINGERPRINT_ROLES);
        }
        return;
    }
    terminal::error_line(&plain_fingerprint_line(true, original, false));
    terminal::error_line(&encoded.map_or_else(
        || format!("Encoded BIP32 master fingerprint: {NO_ENCODED_FINGERPRINT}."),
        |encoded| plain_fingerprint_line(false, encoded, mode.masked()),
    ));
}

/// The masked phrase in English words, for codes in another form.
fn print_masked_words(words: &str, mode: Mode) {
    let facts = [
        ("Mode", mode.id().to_owned()),
        ("Content", "Masked phrase (decoy)".to_owned()),
    ];
    if !result_header("Seedshift phrase", &facts, Channel::Output) {
        print(
            Channel::Output,
            &["Seedshift phrase (masked, not the original wallet phrase):".to_owned()],
        );
    }
    print_phrase(words, Channel::Output);
    hint("These words need the original dates to recover the wallet seed phrase.");
}

/// The original phrase, for checking it by eye.
fn print_original_copy(phrase: &str) {
    let facts = [("Content", "English words for visual checking".to_owned())];
    if !result_header("Original seed phrase", &facts, Channel::Output) {
        print(
            Channel::Output,
            &["Original seed phrase (words for visual checking):".to_owned()],
        );
    }
    print_phrase(phrase, Channel::Output);
    notice(
        "Keep the original phrase apart from the encoded backup.",
        NoticeKind::Warning,
    );
}

/// The result of `encoding` of `phrase`: the codes, the masked words and the original where asked,
/// the fingerprints, and what became of the last word in the legacy mode.
fn print_result(
    encoding: &Encoding,
    phrase: &Phrase,
    mode: Mode,
    masked_words: bool,
    original_copy: bool,
) -> Result<(), Stop> {
    let backup = &encoding.backup;
    let legacy = mode.with_valid_last_word().is_some();
    if legacy && encoding.last_word_changed {
        terminal::error_line(&more_line("transformation-modes"));
    }
    print_encoded_backup(backup, "Encoded result")?;
    let english = |indexes: &[u16]| Form::English.codes(indexes);
    if masked_words && !backup.form().written_in_words() {
        print_masked_words(
            &english(encoding.result().shifted.as_slice())?,
            backup.mode(),
        );
    }
    let text = phrase.text();
    if original_copy {
        print_original_copy(text.as_str());
    }
    let encoded = backup.fingerprint()?.map(fingerprint_hex);
    print_fingerprints(backup.mode(), &fingerprint_of(phrase)?, encoded.as_deref());
    if !legacy {
        return Ok(());
    }
    for sentence in legacy_sentences(encoding)? {
        print_sentence(&sentence);
    }
    Ok(())
}

/// What became of the last word in the legacy mode, in TS's sentences for standard error.
fn legacy_sentences(encoding: &Encoding) -> Result<Vec<String>, Stop> {
    let english = |indexes: &[u16]| Form::English.codes(indexes);
    // The last of the words: a single index is no phrase that a form writes.
    let last = |indexes: &[u16]| -> Result<String, Stop> {
        let words = english(indexes)?;
        Ok(words
            .rsplit_once(' ')
            .map_or(words.as_str(), |(_, last)| last)
            .to_owned())
    };
    Ok(match &encoding.valid_last_word {
        _ if !encoding.last_word_changed => vec![
            "Legacy shifted phrase already has a valid BIP39 checksum; no final-word replacement is needed."
                .to_owned(),
        ],
        Some(valid) if !encoding.replaced => {
            let words = valid.shifted.as_slice();
            vec![
                format!("Optional checksum-valid final word: {}", last(words)?),
                format!("Optional checksum-valid legacy phrase: {}", english(words)?),
            ]
        }
        _ => vec![
            format!(
                "Replaced legacy final word {} with checksum-valid word {}.",
                last(encoding.base.shifted.as_slice())?,
                last(encoding.result().shifted.as_slice())?
            ),
            "The shifted last word is not stored; decoding lists the candidates.".to_owned(),
        ],
    })
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let mode = transform_mode(parsed)?;
    let original_copy = choice_option(parsed, "show-original", &[ORIGINAL_COPY_FORM])?.is_some();
    let masked_words = is_on(parsed, "show-masked-words");
    if masked_words && !mode.masked() {
        return Err(MaskedWordsNeedSeedshift.into());
    }
    let form = encode_format(parsed)?;
    let valid_last_word = is_on(parsed, "legacy-valid-last-word");
    Backup::check_encodable(mode, valid_last_word, Some(form))?;
    check_date_input(parsed, mode, DateWords::Codes)?;
    let (phrase, dates) = match phrase_and_dates(parsed, mode, DateWords::Codes)? {
        Ok(given) => given,
        Err(_) => return Err(Stop::Cancelled),
    };
    let encoding = Backup::encode(&phrase, &dates, form, mode, valid_last_word)?;
    clear_private_screen();
    print_result(&encoding, &phrase, mode, masked_words, original_copy)?;
    if let Some(output) = value(parsed, "output") {
        let path = os::resolve(
            Path::new(output),
            terminal::environment().current.as_deref(),
        );
        let record = format!("{}\n", encoding.backup.record()?);
        os::publish_new_file(&path, record.as_bytes())?;
        saved(&format!("Saved MnemoCode record: {}", printable(output)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use mnemocode::bip39::phrase::Phrase;
    use mnemocode::dates::parse_date;

    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn legacy(valid_last_word: bool) -> Vec<String> {
        let phrase = Phrase::parse(PHRASE).unwrap();
        let dates = [parse_date("23-09-2026").unwrap()];
        let encoding = Backup::encode(
            &phrase,
            &dates,
            Form::English,
            Mode::SeedshiftLegacy,
            valid_last_word,
        )
        .unwrap();
        legacy_sentences(&encoding).unwrap()
    }

    #[test]
    fn the_legacy_sentences_name_the_final_words() {
        let offered = legacy(false);
        let phrase = offered[1]
            .strip_prefix("Optional checksum-valid legacy phrase: ")
            .unwrap();
        let word = offered[0]
            .strip_prefix("Optional checksum-valid final word: ")
            .unwrap();
        assert!(!word.is_empty());
        assert_eq!(phrase.rsplit(' ').next(), Some(word));
        let replaced = legacy(true);
        let words = replaced[0]
            .strip_prefix("Replaced legacy final word ")
            .unwrap();
        let (old, new) = words.split_once(" with checksum-valid word ").unwrap();
        assert!(!old.is_empty());
        assert_eq!(new, format!("{word}."));
        assert_ne!(format!("{old}."), new);
    }
}
