//! `mnemocode encode` (MnemoCode TS 0.1.0's `cli/encode-command.ts`, `encode-report.ts` and
//! `encode-export.ts`, CAP-PHRASE-FORMATS-ENCODE and -ENCODE-QR): a seed phrase written as codes in
//! one form, masked with the dates where the mode masks, or with --sskr split into shares; shown on
//! the private screen with both fingerprints, saved where the options say, and offered a check of
//! the backup as it was written down.

use std::fmt;

use mnemocode::backup::{Backup, Encoding};
use mnemocode::bip32::{ExtendedKey, fingerprint_hex};
use mnemocode::bip39::phrase::Phrase;
use mnemocode::bip39::sizes::WORD_NUMBER_RANGE;
use mnemocode::forms::Form;
use mnemocode::modes::phrase_words::{FINGERPRINT_ROLES, ORIGINAL_FINGERPRINT};
use mnemocode::modes::{DateWords, Mode};
use mnemocode::recovery::backup_check::EncodedOriginal;
use mnemocode::refusal::Refusal;

use super::backup_check::{backup_check_answer, offer_encoded_check};
use super::cards::{
    PlannedCards, card_file_format, card_outputs, card_settings, card_template, check_cards_fit,
    export_card_files, export_page_images, image_format, publish_pdf, save_qr_beside,
    save_qr_inside, saved_pages_notice, validate_card_options, validate_image_options,
};
use super::given::{check_date_input, encode_format, phrase_and_dates, transform_mode};
use super::heir_sheet::{save_heir_sheet, validate_heir_sheet_options};
use super::resolved;
use super::saving::{ResultName, save_output};
use super::share_output::{report_qr_verified, step_failed};
use super::sskr_split::{CheckedSplit, prepare_split, split_checked};
use crate::args::{Parsed, choice_option, is_on, option_label, value};
use crate::gate::Stop;
use crate::os::{self, FileError, SystemRandom};
use crate::output::report_renamed;
use crate::terminal::result::{
    backup_code_lines, plain_fingerprint_line, print, print_phrase, print_sentence, result_header,
};
use crate::terminal::{
    self, Channel, NoticeKind, can_redraw, clear_private_screen, hint, more_line, notice,
    printable, saved,
};
use mnemocode_cards::content::backup_card_content;
use mnemocode_cards::export::{CardJob, card_pages, individual_cards};
use mnemocode_cards::heir::{HeirBackup, HeirSheetFacts};
use mnemocode_cards::settings::CardSettings;
use mnemocode_cards::templates::{CardDrawing, CardTemplate};

/// What Encode takes in both modes: the phrase and the dates, the outputs.
pub(crate) const SHARED_OPTIONS: [&str; 13] = [
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
    "pdf",
    "heir-sheet",
    "heir-sheet-size",
];
/// What only a split into shares takes: the set, the form of the shares and their card layout.
pub(crate) const SSKR_ONLY_OPTIONS: [&str; 5] = [
    "threshold",
    "shares",
    "share-format",
    "card-layout",
    "qr-dir",
];
/// The rest of Encode's own: the check of the backup, and --sskr, which chooses between its modes.
pub(crate) const OWN_OPTIONS: [&str; 2] = ["backup-check", "sskr"];

/// The one value --show-original takes.
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
    let indexes = format!("BIP39 word indexes ({})", WORD_NUMBER_RANGE.span());
    let form = match form {
        Form::English => "English BIP39 words",
        Form::Indexes => indexes.as_str(),
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
    terminal::keep_result_from_start();
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

/// The original phrase is shown only in English words, for visual checking.
pub(crate) const ORIGINAL_COPY_FORM: &str = "words";

/// The optional original-copy form, refused before any secret is read when it is unknown.
pub(crate) fn original_copy_requested(parsed: &Parsed) -> Result<bool, Stop> {
    Ok(choice_option(parsed, "show-original", &[ORIGINAL_COPY_FORM])?.is_some())
}

/// Checks the optional display of Seedshift words before any phrase is read.
pub(crate) fn masked_words_requested(parsed: &Parsed, mode: Mode) -> Result<bool, Stop> {
    let show = is_on(parsed, "show-masked-words");
    if show && !mode.masked() {
        return Err(MaskedWordsNeedSeedshift.into());
    }
    Ok(show)
}

/// The masked phrase in English words, for codes in another form.
pub(crate) fn print_masked_words(words: &str, mode: Mode) {
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
pub(crate) fn print_original_copy(phrase: &str) {
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

/// What the options settled of the cards of a backup, once, so that every output of the command
/// shows the same details.
#[derive(Debug)]
pub(crate) struct EncodeCards {
    drawing: CardDrawing,
    template: &'static CardTemplate,
    settings: CardSettings,
    title: Option<String>,
}

/// A plain backup once its options are checked.
#[derive(Debug)]
pub(crate) struct CheckedEncode {
    mode: Mode,
    form: Form,
    original_copy: bool,
    masked_words: bool,
    valid_last_word: bool,
    check_answer: Option<bool>,
    cards: Option<EncodeCards>,
}

/// Encode once its options are checked: it asks for the phrase, or reads it, unless it is known,
/// which Re-encode decoded and confirmed, then its dates, and makes and saves the backup.
#[derive(Debug)]
pub(crate) enum PreparedEncode {
    Plain(Parsed, CheckedEncode),
    Split(Parsed, CheckedSplit),
}

impl PreparedEncode {
    /// Makes the backup.
    pub(crate) fn run(&self, known: Option<&Phrase>) -> Result<(), Stop> {
        match self {
            Self::Plain(parsed, checked) => encode_checked(parsed, checked, known),
            Self::Split(parsed, checked) => split_checked(parsed, checked, known),
        }
    }
}

/// The refusals of Encode's options.
#[derive(Debug)]
enum EncodeOptionError {
    SskrOnly(&'static str),
    ColorCards,
}

impl fmt::Display for EncodeOptionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SskrOnly(label) => {
                write!(f, "The {label} setting is available only in SSKR mode.")
            }
            Self::ColorCards => write!(
                f,
                "Terminal color cards are available only for RGB color formats {}.",
                super::given::color_format_numbers()
            ),
        }
    }
}

impl std::error::Error for EncodeOptionError {}

impl Refusal for EncodeOptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::SskrOnly(_) => "cli.encode-command.setting-available-only-sskr-mode",
            Self::ColorCards => {
                "cli.encode-command.terminal-color-cards-available-only-rgb-color-formats"
            }
        }
    }
}

/// Checks every option of Encode, the destinations included, before any secret is asked or read,
/// and gives what then encodes: a plain backup, or with --sskr its shares.
pub(crate) fn prepare_encode(parsed: &Parsed) -> Result<PreparedEncode, Stop> {
    if is_on(parsed, "sskr") {
        return Ok(PreparedEncode::Split(
            parsed.clone(),
            prepare_split(parsed, true)?,
        ));
    }
    for key in SSKR_ONLY_OPTIONS {
        if parsed.contains_key(key) {
            return Err(EncodeOptionError::SskrOnly(option_label(key)).into());
        }
    }
    let mode = transform_mode(parsed, None)?;
    let original_copy = original_copy_requested(parsed)?;
    let masked_words = masked_words_requested(parsed, mode)?;
    let form = encode_format(parsed)?;
    let valid_last_word = is_on(parsed, "legacy-valid-last-word");
    Backup::check_encodable(mode, valid_last_word, Some(form))?;
    check_date_input(parsed, mode, DateWords::Codes)?;
    // The sheet leads through the menu, whose Decode does not offer a replaced last word.
    if valid_last_word
        && parsed.contains_key("heir-sheet")
        && let Some(replacement) = mode.with_valid_last_word()
    {
        replacement.check_heir_sheet()?;
    }
    if is_on(parsed, "cards") && !form.written_in_colors() {
        return Err(EncodeOptionError::ColorCards.into());
    }
    validate_card_options(parsed, form)?;
    validate_image_options(parsed)?;
    validate_heir_sheet_options(parsed)?;
    let check_answer = backup_check_answer(parsed)?;
    let cards = encode_cards(parsed, form)?;
    Ok(PreparedEncode::Plain(
        parsed.clone(),
        CheckedEncode {
            mode,
            form,
            original_copy,
            masked_words,
            valid_last_word,
            check_answer,
            cards,
        },
    ))
}

/// The cards that the options ask for, settled once; a detail too long for its card is refused
/// here, before a secret is asked or read, not after the result is shown.
fn encode_cards(parsed: &Parsed, form: Form) -> Result<Option<EncodeCards>, Stop> {
    let outputs = card_outputs(parsed);
    if !outputs.sheets && !outputs.cards {
        return Ok(None);
    }
    let template = card_template(parsed)?;
    let settings = card_settings(parsed, Some(template))?;
    let drawing = CardDrawing::new();
    check_cards_fit(&drawing, parsed, &settings, form)?;
    Ok(Some(EncodeCards {
        drawing,
        template,
        settings,
        title: value(parsed, "title").map(str::to_owned),
    }))
}

/// Saves the cards of `backup` where the options say, from one plan, so that every file shows the
/// same cards; where the PDF and the images went.
fn save_cards(
    outputs: &mut Parsed,
    backup: &Backup,
    cards: &EncodeCards,
) -> Result<(Option<String>, Option<String>), Stop> {
    terminal::work("Rendering the cards…");
    let drawing = &cards.drawing;
    let content = backup_card_content(backup, cards.settings.clone(), cards.title.as_deref())?;
    let mut planned = PlannedCards::new(CardJob {
        template: cards.template,
        cards: content,
    });
    let sheets = value(outputs, "pdf").is_some() || value(outputs, "images-dir").is_some();
    let jobs = if sheets {
        vec![planned.job(drawing)?.clone()]
    } else {
        Vec::new()
    };
    let mut random = SystemRandom;
    let pdf = save_output(outputs, "pdf", ResultName::one("The PDF"), |path| {
        let pages = card_pages(drawing, &mut random, &jobs).map_err(step_failed)?;
        publish_pdf(drawing, pages, &resolved(path))
    })?;
    if let Some(path) = &pdf {
        saved(&format!("Saved PDF: {}", printable(path)));
    }
    let (format, mut count) = (image_format(outputs)?, 0);
    let images = save_output(
        outputs,
        "images-dir",
        ResultName {
            what: "The images",
            plural: true,
        },
        |path| {
            let pages = card_pages(drawing, &mut random, &jobs).map_err(step_failed)?;
            count = export_page_images(drawing, pages, path, format)?;
            Ok(())
        },
    )?;
    if let Some(folder) = &images {
        saved_pages_notice(outputs, count, folder, None)?;
    }
    if value(outputs, "cards-dir").is_some() {
        let job = planned.separate_job(drawing)?;
        let format = card_file_format(outputs)?;
        let mut files = 0;
        let folder = save_output(
            outputs,
            "cards-dir",
            ResultName {
                what: "The card files",
                plural: true,
            },
            |path| {
                let documents = individual_cards(drawing, &mut random, job.template, &job.cards)
                    .map_err(step_failed)?;
                files = export_card_files(drawing, documents, path, format)?;
                Ok(())
            },
        )?;
        if let Some(folder) = folder {
            saved(&format!(
                "Saved {files} individual card files to: {}",
                printable(&folder)
            ));
        }
    }
    Ok((pdf, images))
}

/// The QR code that the sheets print with --card-qr, also saved as an image where they were saved:
/// beside the PDF, or else in the folder of their images. Not when --qr names an image of its own,
/// which holds the same codes.
fn save_sheet_qr(
    parsed: &Parsed,
    text: &str,
    (pdf, images): (Option<&str>, Option<&str>),
) -> Result<(), Stop> {
    if !is_on(parsed, "card-qr") || value(parsed, "qr").is_some() {
        return Ok(());
    }
    let path = match (pdf, images) {
        (Some(pdf), _) => save_qr_beside(text, pdf, "")?,
        (None, Some(images)) => save_qr_inside(text, images, "")?,
        (None, None) => None,
    };
    if let Some(path) = path {
        saved(&format!(
            "Saved the QR code of the sheet as an image: {}",
            printable(&path)
        ));
    }
    Ok(())
}

/// A QR image written where a save asks, its image read back first (qr::png).
fn write_qr(text: &str, path: &str) -> Result<(), FileError> {
    let image = mnemocode::qr::png(text).map_err(super::share_output::step_failed)?;
    os::publish_new_file(&resolved(path), &image)
}

/// Saves every result of Encode that the options name, each on its own, and gives the options as
/// the saves left them.
fn save_results(
    parsed: &Parsed,
    encoding: &Encoding,
    cards: Option<&EncodeCards>,
) -> Result<Parsed, Stop> {
    let mut outputs = parsed.clone();
    let backup = &encoding.backup;
    let record = format!("{}\n", backup.record()?);
    let record_saved = save_output(
        &mut outputs,
        "output",
        ResultName::one("The record"),
        |path| os::publish_new_file(&resolved(path), record.as_bytes()),
    )?;
    if let Some(path) = record_saved {
        saved(&format!("Saved MnemoCode record: {}", printable(&path)));
    }
    // The colour cards on the terminal come after the record.
    if is_on(parsed, "cards") {
        let channel = terminal::secret_channel();
        let colors = mnemocode::forms::colors::indexes_to_colors(backup.indexes())?;
        print(channel, &[terminal::color_cards(&colors, channel)]);
    }
    let text = backup.text()?;
    let sheets = match cards {
        Some(cards) => save_cards(&mut outputs, backup, cards)?,
        None => (None, None),
    };
    let qr_saved = save_output(&mut outputs, "qr", ResultName::one("The QR code"), |path| {
        write_qr(&text, path)
    })?;
    if let Some(path) = qr_saved {
        report_qr_verified(1);
        saved(&format!(
            "Saved QR code ({}): {}",
            backup.form().name(),
            printable(&path)
        ));
    }
    save_sheet_qr(parsed, &text, (sheets.0.as_deref(), sheets.1.as_deref()))?;
    Ok(outputs)
}

/// Encodes the phrase, asked, read or `known`, and saves and shows what the options ask for.
fn encode_checked(
    parsed: &Parsed,
    checked: &CheckedEncode,
    known: Option<&Phrase>,
) -> Result<(), Stop> {
    let CheckedEncode {
        mode,
        form,
        original_copy,
        masked_words,
        valid_last_word,
        check_answer,
        ref cards,
    } = *checked;
    let (phrase, dates) = match phrase_and_dates(parsed, mode, DateWords::Codes, known)? {
        Ok(given) => given,
        Err(_) => return Err(Stop::Cancelled),
    };
    let encoding = Backup::encode(&phrase, &dates, form, mode, valid_last_word)?;
    // The result is a step of its own: the questions are cleared away (CORE-39).
    clear_private_screen();
    print_result(&encoding, &phrase, mode, masked_words, original_copy)?;
    let mut outputs = save_results(parsed, &encoding, cards.as_ref())?;
    let backup = &encoding.backup;
    // A record with a replaced last word never gets a sheet.
    if backup.mode().capabilities().heir_sheet {
        let facts = HeirSheetFacts {
            backup: HeirBackup::Encoded {
                form: backup.form(),
                words: backup.words(),
            },
            mode: backup.mode(),
            dates: dates.len(),
        };
        save_heir_sheet(&mut outputs, &facts)?;
    }
    report_renamed();
    offer_encoded_check(
        EncodedOriginal {
            phrase: phrase.copy(),
            form: backup.form(),
            mode: backup.mode(),
            codes: mnemocode::modes::seedshift::Indexes::new(backup.indexes().to_vec()),
            dates: mnemocode::dates::Dates::new(&dates),
        },
        &mut || print_result(&encoding, &phrase, mode, masked_words, original_copy),
        check_answer,
    )
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    prepare_encode(parsed)?.run(None)
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
