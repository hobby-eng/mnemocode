//! `mnemocode sskr-split` and `encode --sskr` (MnemoCode TS 0.1.0's `cli/sskr-split-command.ts`): a
//! seed phrase split into Shamir shares (SSKR), written in the form asked for and saved where the
//! options say.

use std::fmt;

use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::refusal::Refusal;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::split::{MAX_SHARES, MIN_THRESHOLD, check_threshold, split_backup};
use mnemocode::text::numbers::WholeRange;
use mnemocode_cards::content::SskrLayout;
use mnemocode_cards::export::own_share_cards;
use mnemocode_cards::heir::{HeirBackup, HeirSheetFacts};

use super::backup_check::{backup_check_answer, offer_share_check};
use super::cards::validate_image_options;
use super::encode::{
    fingerprint_of, masked_words_requested, original_copy_requested, print_encoded_backup,
    print_fingerprints, print_masked_words, print_original_copy,
};
use super::given::{check_date_input, encode_format, phrase_and_dates, transform_mode};
use super::heir_sheet::{save_heir_sheet, validate_heir_sheet_options};
use super::share_output::{
    Presentation, ShareCards, check_share_cards_printable, export_options, in_form, print_shares,
    save_shares, share_format, share_format_named,
};
use crate::args::{Parsed, assert_single_values, integer_option, option_label, value};
use crate::gate::Stop;
use crate::os::SystemRandom;
use crate::output::report_renamed;
use crate::terminal::result::result_header;
use crate::terminal::{Channel, NoticeKind, can_redraw, clear_private_screen, notice};

/// The numbers that a share count or a threshold may be, each on its own.
pub(crate) const SHARE_RANGE: WholeRange = WholeRange::new(MIN_THRESHOLD as u64, MAX_SHARES as u64);

/// What only a plain backup takes, refused with --sskr.
pub(crate) const ENCODE_PLAIN_ONLY_OPTIONS: [&str; 3] = ["cards", "qr", "title"];

/// The options `sskr-split` takes, its card options apart.
pub(crate) const OPTIONS: [&str; 15] = [
    "mode",
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "date",
    "dates-file",
    "threshold",
    "shares",
    "format",
    "output",
    "qr-dir",
    "pdf",
    "heir-sheet",
    "heir-sheet-size",
    "backup-check",
];

/// The refusals of the command.
#[derive(Debug)]
enum SplitOptionError {
    PlainOnly(&'static str),
    OriginalCodes,
}

impl fmt::Display for SplitOptionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PlainOnly(label) => write!(
                f,
                "The {label} setting is not available in SSKR mode. Export shares to a PDF file or an individual-card output folder instead."
            ),
            Self::OriginalCodes => f.write_str(
                "The original seed phrase is shown only as English words. Use --show-original words, or select Seedshift to show a masked backup in --format.",
            ),
        }
    }
}

impl std::error::Error for SplitOptionError {}

impl Refusal for SplitOptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::PlainOnly(_) => {
                "cli.sskr-split-command.setting-not-available-sskr-mode-export-shares-pdf"
            }
            Self::OriginalCodes => "cli.sskr-split-command.original-codes-not-shown",
        }
    }
}

/// What the options of a split say, checked before any secret is asked.
#[derive(Debug)]
pub(crate) struct CheckedSplit {
    mode: Mode,
    threshold: usize,
    count: usize,
    format: ShareFormat,
    representation: Option<Form>,
    original_copy: bool,
    masked_words: bool,
    check_answer: Option<bool>,
    cards: Option<ShareCards>,
}

/// Checks every option of the split, the destinations included, before the seed phrase is asked or
/// read; the menu's split asks the Seedshift dates first.
/// Encode --sskr is `integrated`.
pub(crate) fn prepare_split(parsed: &Parsed, integrated: bool) -> Result<CheckedSplit, Stop> {
    assert_single_values(parsed, &["date"])?;
    let check_answer = backup_check_answer(parsed)?;
    // Each number within SSKR's bounds, then the two together, as the menu and a page check them.
    let threshold = integer_option(parsed, "threshold", SHARE_RANGE, None, None)? as usize;
    let count = integer_option(parsed, "shares", SHARE_RANGE, None, None)? as usize;
    check_threshold(threshold, count)?;
    if integrated {
        for key in ENCODE_PLAIN_ONLY_OPTIONS {
            if parsed.contains_key(key) {
                return Err(SplitOptionError::PlainOnly(option_label(key)).into());
            }
        }
    }
    // --format adds the whole masked backup beside the shares. An unmasked original is words only.
    let representation = if integrated && value(parsed, "format").is_some() {
        Some(encode_format(parsed)?)
    } else {
        None
    };
    let original_copy = integrated && original_copy_requested(parsed)?;
    let mode = transform_mode(parsed, None)?;
    if representation.is_some_and(|form| !form.written_in_words())
        && !original_copy
        && !mode.masked()
    {
        return Err(SplitOptionError::OriginalCodes.into());
    }
    let format = if integrated {
        share_format_named(value(parsed, "share-format"))?
    } else {
        share_format(parsed)?
    };
    let cards = export_options(parsed, format)?;
    validate_image_options(parsed)?;
    validate_heir_sheet_options(parsed)?;
    check_share_cards_printable(cards.as_ref())?;
    let masked_words = masked_words_requested(parsed, mode)?;
    check_date_input(parsed, mode, DateWords::Split)?;
    Ok(CheckedSplit {
        mode,
        threshold,
        count,
        format,
        representation,
        original_copy,
        masked_words,
        check_answer,
        cards,
    })
}

/// The layout that the result names: its cards', or the text alone.
fn layout_name(checked: &CheckedSplit) -> &'static str {
    checked
        .cards
        .as_ref()
        .and_then(|cards| cards.options.layout)
        .map_or("text", SskrLayout::name)
}

/// What the split shows.
struct SplitResult<'a> {
    checked: &'a CheckedSplit,
    phrase: &'a Phrase,
    dates: &'a [Date],
    shares: &'a [mnemocode::sskr::share::Share],
    held: &'a Phrase,
    /// With the Original Seedshift, the last word its shift gave, which the restore asks for.
    original_last_word: Option<u16>,
}

/// Puts the result on the screen; a repeated result restores every displayed part.
fn show(result: &SplitResult<'_>) -> Result<(), Stop> {
    let checked = result.checked;
    let (mode, threshold, count) = (checked.mode, checked.threshold, checked.count);
    let facts = [
        ("Threshold", format!("{threshold} of {count}")),
        super::backup_questions::seedshift_fact(mode),
        ("Format", checked.format.label()),
        ("Shares hold", mode.holds().to_owned()),
        ("Layout", layout_name(checked).to_owned()),
    ];
    let header = result_header("Split into shares", &facts, Channel::Output);
    if !header {
        notice(
            &format!(
                "SSKR: {threshold} of {count} shares required. Mode: {}.",
                mode.id()
            ),
            NoticeKind::Info,
        );
    }
    if !header {
        notice(
            &format!("The shares hold {}.", mode.holds()),
            NoticeKind::Info,
        );
    }
    if mode.masked() {
        crate::terminal::result_hint(
            "The shares do not store the dates or the mode; keep them yourself.",
        );
    }
    if let Some(form) = checked.representation.filter(|_| !checked.original_copy) {
        if mode.masked() {
            let backup = Backup::encode(result.phrase, result.dates, form, mode)?.backup;
            print_encoded_backup(&backup, "Encoded result")?;
            notice(
                "This is the complete backup: no share is needed, but the original dates are still required.",
                NoticeKind::Warning,
            );
        } else {
            print_original_copy(result.phrase.text().as_str());
        }
    }
    // A complete backup in codes that are words, shown above with --format alone, shows the masked
    // words already.
    let words_shown = checked
        .representation
        .is_some_and(|form| !checked.original_copy && form.written_in_words());
    // The optional original copy comes last, so it remains in view after long share blocks.
    print_shares(
        &in_form(result.shares, checked.format),
        result.shares.len(),
        Some(mode.holds()),
        Presentation::Backup,
    );
    if checked.masked_words && !words_shown {
        print_masked_words(result.held.text().as_str());
    }
    if checked.original_copy {
        print_original_copy(result.phrase.text().as_str());
    }
    let written = result
        .held
        .index(result.held.len() - 1)
        .and_then(|index| u16::try_from(index).ok());
    if let (Some(original), Some(written)) = (result.original_last_word, written) {
        super::encode::print_last_word(original, written);
    }
    let encoded = fingerprint_of(result.held)?;
    print_fingerprints(mode, &fingerprint_of(result.phrase)?, Some(&encoded));
    Ok(())
}

/// Splits the phrase, asked, read or `known`, and saves and shows the shares.
pub(crate) fn split_checked(
    parsed: &Parsed,
    checked: &CheckedSplit,
    known: Option<&Phrase>,
    dates: Option<&[mnemocode::dates::Date]>,
) -> Result<(), Stop> {
    let (phrase, dates) =
        match phrase_and_dates(parsed, checked.mode, DateWords::Split, known, dates)? {
            Ok(given) => given,
            Err(_) => return Err(Stop::Cancelled),
        };
    let split = split_backup(
        &phrase,
        checked.mode,
        &dates,
        checked.threshold,
        checked.count,
        &mut SystemRandom,
    )?;
    // The result is a step of its own: the questions are cleared away (CORE-39). The shares come
    // first, then the files saved under their heading, as every result shows them; a save that
    // fails is offered again or skipped, the shares on the screen either way.
    clear_private_screen();
    let result = SplitResult {
        checked,
        phrase: &phrase,
        dates: &dates,
        shares: &split.shares,
        held: &split.held,
        original_last_word: split.original_last_word,
    };
    show(&result)?;
    let written = in_form(&split.shares, checked.format);
    let shown: Vec<_> = written.iter().collect();
    let mut outputs = parsed.clone();
    if can_redraw(Channel::Error) && crate::output::saves_anything(parsed) {
        crate::terminal::result::print_part("Saved files", true, Channel::Error);
    }
    save_shares(
        &shown,
        &mut outputs,
        checked.cards.as_ref(),
        checked.mode.masked(),
    )?;
    let codes = split
        .shares
        .first()
        .map(|share| own_share_cards(share.ur().as_str(), checked.format))
        .transpose()?
        .flatten();
    let facts = HeirSheetFacts {
        backup: HeirBackup::Shares {
            format: checked.format,
            threshold: checked.threshold,
            count: checked.count,
            codes,
        },
        mode: checked.mode,
        dates: dates.len(),
    };
    save_heir_sheet(&mut outputs, &facts)?;
    report_renamed();
    offer_share_check(
        &phrase,
        (checked.mode, checked.threshold),
        &mut || show(&result),
        checked.check_answer,
        &dates,
    )
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let checked = prepare_split(parsed, false)?;
    split_checked(parsed, &checked, None, None)
}
