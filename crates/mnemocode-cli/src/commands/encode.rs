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
use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::phrase_words::{FINGERPRINT_ROLES, ORIGINAL_FINGERPRINT};
use mnemocode::modes::{DateWords, Mode};
use mnemocode::recovery::backup_check::EncodedOriginal;
use mnemocode::refusal::Refusal;
use mnemocode::secret::{SecretText, SecretVec};

use super::backup_check::{backup_check_answer, offer_encoded_check};
use super::cards::{
    PlannedCards, card_file_format, card_outputs, card_settings, card_template, check_cards_fit,
    export_card_files, export_page_images, image_format, publish_pdf, saved_pages_notice,
    validate_card_options, validate_image_options,
};
use super::configure::run_configured;
use super::given::{check_date_input, encode_format, phrase_and_dates, transform_mode};
use super::heir_sheet::{save_heir_sheet, validate_heir_sheet_options};
use super::resolved;
use super::saving::{ResultName, save_output};
use super::share_output::{report_qr_verified, step_failed};
use super::sskr_split::{CheckedSplit, prepare_split, split_checked};
use crate::args::{Parsed, choice_option, is_on, option_label, value};
use crate::gate::Stop;
use crate::os::{self, FileError, SystemRandom};
use crate::output::{report_renamed, saves_anything, shown_path};
use crate::terminal::result::{
    backup_code_lines, plain_fingerprint_line, print, print_part, print_phrase, print_sentence,
    result_header,
};
use crate::terminal::{
    self, Channel, NoticeKind, can_redraw, clear_private_screen, notice, paint, result_hint, saved,
    style,
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

/// Why codes have no encoded fingerprint: every mode writes a valid phrase, so only codes read
/// from elsewhere can lack one.
const NO_ENCODED_FINGERPRINT: &str = "none: these codes are no valid BIP39 phrase";

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
        super::backup_questions::seedshift_fact(backup.mode()),
        (
            "Format",
            super::encode_questions::form_label(backup.form()).to_owned(),
        ),
        ("Content", label.clone()),
    ];
    if !result_header(title, &facts, Channel::Output) {
        print(Channel::Output, &[format!("{label}:")]);
    }
    terminal::keep_result_from_start();
    print(
        Channel::Output,
        &backup_code_lines(backup.text()?.as_str(), backup.form(), "backup"),
    );
    Ok(())
}

/// Both fingerprints: the original's, and the codes', where they are a valid phrase.
pub(crate) fn print_fingerprints(mode: Mode, original: &str, encoded: Option<&str>) {
    if can_redraw(Channel::Error) {
        print_part("Fingerprints", true, Channel::Error);
        terminal::status(ORIGINAL_FINGERPRINT, original, true);
        let label = mode.encoded_fingerprint_label();
        match encoded {
            None => terminal::status(label, NO_ENCODED_FINGERPRINT, false),
            Some(encoded) => terminal::status(label, encoded, true),
        }
        let empty = format!("With an {}.", terminal::result::FINGERPRINT_NOTE);
        if mode.masked() {
            result_hint(&format!("{FINGERPRINT_ROLES} {empty}"));
        } else {
            result_hint(&empty);
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
pub(crate) fn print_masked_words(words: &str) {
    // A part of the result under its heading, as the other parts are.
    if can_redraw(Channel::Output) {
        print_part("Seed phrase after Seedshift", true, Channel::Output);
    } else {
        print(
            Channel::Output,
            &["Seed phrase after Seedshift (not the wallet's own phrase):".to_owned()],
        );
    }
    print_phrase(words, Channel::Output);
    result_hint("Only your dates turn these words back into the wallet's seed phrase.");
}

/// The original phrase, for checking it by eye.
pub(crate) fn print_original_copy(phrase: &str) {
    if can_redraw(Channel::Output) {
        print_part("Original seed phrase", true, Channel::Output);
    } else {
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
    masked_words: bool,
    original_copy: bool,
) -> Result<(), Stop> {
    let backup = &encoding.backup;
    print_encoded_backup(backup, "Encoded result")?;
    let english = |indexes: &[u16]| Form::English.codes(indexes);
    if masked_words && !backup.form().written_in_words() {
        print_masked_words(english(encoding.result().shifted.as_slice())?.as_str());
    }
    let text = phrase.text();
    if original_copy {
        print_original_copy(text.as_str());
    }
    if let (Some(original), Some(&written)) = (encoding.original_last_word, backup.indexes().last())
    {
        print_last_word(original, written);
    }
    let encoded = backup.fingerprint()?.map(fingerprint_hex);
    print_fingerprints(backup.mode(), &fingerprint_of(phrase)?, encoded.as_deref());
    Ok(())
}

/// The English word of `index`.
fn word_of(index: u16) -> &'static str {
    mnemocode::bip39::table::english()[usize::from(index)]
}

/// The word to remember with the Original Seedshift, `original`, the last word its shift gave,
/// where the codes end with `written`: recovery material, so on the private screen a part of its
/// own before the fingerprints, the word in bold, and elsewhere sentences where the result goes,
/// never on a terminal outside the private screen.
pub(crate) fn print_last_word(original: u16, written: u16) {
    let channel = terminal::secret_channel();
    if channel != Channel::Error || !can_redraw(channel) {
        for sentence in legacy_sentences(original, written) {
            print_sentence(&sentence);
        }
        return;
    }
    let (original, written) = (word_of(original), word_of(written));
    print_part("Last word", true, channel);
    terminal::hint(if original == written {
        "The decoy phrase passes the BIP39 checksum with its own last word."
    } else {
        "The backup ends with a matching word, so that the decoy phrase passes the BIP39 checksum."
    });
    let shown = paint(channel, style::STRONG, original);
    terminal::error_line("");
    terminal::error_line(&terminal::fact_line(
        channel,
        "Word to remember:",
        &shown,
        18,
    ));
    terminal::error_line("");
    for line in terminal::notice_lines(REMEMBER_WORD, NoticeKind::Warning) {
        terminal::error_line(&line);
    }
}

/// Why the word is remembered.
const REMEMBER_WORD: &str = "Remember this word: Decode asks for it to give back your seed phrase exactly. Without it, Decode may give two seed phrases.";

/// The word to remember with the Original Seedshift, as sentences.
fn legacy_sentences(original: u16, written: u16) -> Vec<String> {
    let (original, written) = (word_of(original), word_of(written));
    let first = if original == written {
        "The masked words pass the BIP39 checksum as they are.".to_owned()
    } else {
        format!(
            "The last masked word {original} is written as {written}, which passes the BIP39 checksum."
        )
    };
    vec![
        first,
        format!(
            "Remember the word {original}: Decode asks for it to give back the seed phrase exactly."
        ),
    ]
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
    check_answer: Option<bool>,
    cards: Option<EncodeCards>,
}

/// Encode once its options are checked: it asks for the phrase, or reads it, unless it is known,
/// which Re-encode decoded and confirmed, then its dates, and makes and saves the backup.
#[derive(Debug)]
pub(crate) enum PreparedEncode {
    Plain(Parsed, CheckedEncode, Option<SecretVec<Date>>),
    Split(Parsed, CheckedSplit, Option<SecretVec<Date>>),
}

impl PreparedEncode {
    /// Retains dates already asked on this process's private screen.
    pub(crate) fn with_dates(mut self, dates: Option<SecretVec<Date>>) -> Self {
        let (Self::Plain(_, _, stored) | Self::Split(_, _, stored)) = &mut self;
        *stored = dates;
        self
    }

    /// Makes the backup.
    pub(crate) fn run(&self, known: Option<&Phrase>) -> Result<(), Stop> {
        match self {
            Self::Plain(parsed, checked, dates) => {
                encode_checked(parsed, checked, known, dates.as_deref())
            }
            Self::Split(parsed, checked, dates) => {
                split_checked(parsed, checked, known, dates.as_deref())
            }
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

/// Checks every option of Encode, the destinations included, before the phrase is asked or read,
/// and gives what then encodes: a plain backup, or with --sskr its shares.
pub(crate) fn prepare_encode(parsed: &Parsed) -> Result<PreparedEncode, Stop> {
    super::hidden_qr::validate(parsed)?;
    if is_on(parsed, "sskr") {
        return Ok(PreparedEncode::Split(
            parsed.clone(),
            prepare_split(parsed, true)?,
            None,
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
    Backup::check_encodable(mode, Some(form))?;
    check_date_input(parsed, mode, DateWords::Codes)?;
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
            check_answer,
            cards,
        },
        None,
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
        saved(&format!("Saved PDF: {}", shown_path(path)));
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
                shown_path(&folder)
            ));
        }
    }
    Ok((pdf, images))
}

/// The QR code that the sheets print with --card-qr, also saved as an image with --card-qr-png where
/// they were saved: beside the PDF, or else in the folder of their images. Not when --qr names an
/// image of its own, which holds the same codes.
fn save_sheet_qr(
    parsed: &Parsed,
    text: &str,
    cards: Option<&EncodeCards>,
    (pdf, images): (Option<&str>, Option<&str>),
) -> Result<(), Stop> {
    if !cards.is_some_and(|c| c.settings.card_qr)
        || !is_on(parsed, "card-qr-png")
        || value(parsed, "qr").is_some()
    {
        return Ok(());
    }
    let contact = cards
        .filter(|c| c.settings.hidden_qr)
        .map(|c| c.settings.profile.qr_contact());
    let path = match (pdf, images) {
        (Some(pdf), _) => super::cards::save_qr_beside_with(text, pdf, "", contact.as_deref())?,
        (None, Some(images)) => {
            super::cards::save_qr_inside_with(text, images, "", contact.as_deref())?
        }
        (None, None) => None,
    };
    if let Some(path) = path {
        saved(&format!(
            "Saved the QR code of the sheet as an image: {}",
            shown_path(&path)
        ));
    }
    Ok(())
}

/// A QR image written where a save asks, its image read back first (qr::png).
pub(crate) fn write_qr(parsed: &Parsed, text: &str, path: &str) -> Result<(), FileError> {
    let image = super::hidden_qr::image(parsed, text).map_err(super::share_output::step_failed)?;
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
    // The codes alone, as the screen shows them: nothing in the file names the program, the mode
    // or the form, which Decode tells by the codes themselves.
    let codes = backup.text()?;
    let record = SecretText::copy_of("record", &format!("{}\n", codes.as_str()));
    let record_saved = save_output(
        &mut outputs,
        "output",
        ResultName::one("The codes"),
        |path| os::publish_new_file(&resolved(path), record.as_str().as_bytes()),
    )?;
    if let Some(path) = record_saved {
        saved(&format!("Saved the codes: {}", shown_path(&path)));
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
        write_qr(parsed, text.as_str(), path)
    })?;
    if let Some(path) = qr_saved {
        report_qr_verified(1);
        saved(&format!(
            "Saved QR code ({}): {}",
            backup.form().name(),
            shown_path(&path)
        ));
    }
    save_sheet_qr(
        parsed,
        &text,
        cards,
        (sheets.0.as_deref(), sheets.1.as_deref()),
    )?;
    Ok(outputs)
}

/// Encodes the phrase, asked, read or `known`, and saves and shows what the options ask for.
fn encode_checked(
    parsed: &Parsed,
    checked: &CheckedEncode,
    known: Option<&Phrase>,
    dates: Option<&[Date]>,
) -> Result<(), Stop> {
    let CheckedEncode {
        mode,
        form,
        original_copy,
        masked_words,
        check_answer,
        ref cards,
    } = *checked;
    let (phrase, dates) = match phrase_and_dates(parsed, mode, DateWords::Codes, known, dates)? {
        Ok(given) => given,
        Err(_) => return Err(Stop::Cancelled),
    };
    let encoding = Backup::encode(&phrase, &dates, form, mode)?;
    // The result is a step of its own: the questions are cleared away (CORE-39).
    clear_private_screen();
    print_result(&encoding, &phrase, masked_words, original_copy)?;
    // The files saved come last, under their heading.
    if can_redraw(Channel::Error) && saves_anything(parsed) {
        print_part("Saved files", true, Channel::Error);
    }
    let mut outputs = save_results(parsed, &encoding, cards.as_ref())?;
    let backup = &encoding.backup;
    let facts = HeirSheetFacts {
        backup: HeirBackup::Encoded {
            form: backup.form(),
            words: backup.words(),
        },
        mode: backup.mode(),
        dates: dates.len(),
    };
    save_heir_sheet(&mut outputs, &facts)?;
    report_renamed();
    offer_encoded_check(
        EncodedOriginal {
            phrase: phrase.copy(),
            form: backup.form(),
            mode: backup.mode(),
            codes: mnemocode::modes::seedshift::Indexes::new(backup.indexes().to_vec()),
            dates: mnemocode::dates::Dates::new(&dates),
        },
        &mut || print_result(&encoding, &phrase, masked_words, original_copy),
        check_answer,
    )
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed, protection: &mut crate::os::Protection) -> Result<(), Stop> {
    run_configured(
        parsed,
        protection,
        |finish| {
            if is_on(parsed, "sskr") {
                super::encode_questions::ask_splitting(finish)
            } else {
                super::encode_questions::ask_encoding_in(encode_format(parsed)?, finish)
            }
        },
        |fresh, dates| prepare_encode(fresh)?.with_dates(dates).run(None),
    )
}

#[cfg(test)]
mod tests {
    use mnemocode::bip39::phrase::Phrase;
    use mnemocode::dates::parse_date;

    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn the_legacy_sentences_name_the_word_to_remember() {
        let phrase = Phrase::parse(PHRASE).unwrap();
        let dates = [parse_date("23-09-2026").unwrap()];
        let encoding =
            Backup::encode(&phrase, &dates, Form::English, Mode::SeedshiftLegacy).unwrap();
        let original = encoding.original_last_word.unwrap();
        let written = *encoding.backup.indexes().last().unwrap();
        let sentences = legacy_sentences(original, written);
        assert!(sentences[1].starts_with(&format!("Remember the word {}:", word_of(original))));
    }
}
