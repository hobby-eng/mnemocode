//! The questions of every new backup, one block in one order: Seedshift, its dates, Shamir shares,
//! the sheet for heirs, and last, before the seed phrase, where it is saved, with the folder of its
//! files asked once. A masked backup shows the phrase after Seedshift without a question. A way of hiding adds its own questions after the
//! dates and its own places; it never drops or moves one of the block. An answer it cannot take
//! stays greyed in its place, with the reason.

use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::sskr::forms::ShareFormat;

use super::encode_questions::{
    EncodingAnswers, Place, Takes, ask_copy_destination, ask_heir_sheet, ask_pattern_shares,
    ask_seedshift, ask_share_set, ask_shares, heir_sheet_files, shares_explanation,
};
use super::given::format_number;
use crate::gate::Stop;

/// Options that a way asks or names for itself; none for back.
type Own = fn() -> Result<Option<Vec<String>>, Stop>;

/// A way of hiding the phrase that the menu's Encode offers.
#[derive(Clone, Copy)]
pub(crate) enum Way {
    /// Codes in one of the encoded forms.
    Form(Form),
    /// The legend of a cross-stitch pattern (docs/SEEDSTITCH.md).
    Embroidery,
}

impl Way {
    /// Whether it is always masked: unmasked, the form would show the seed phrase itself.
    const fn always_masked(self) -> bool {
        match self {
            Self::Form(form) => form.always_masked(),
            Self::Embroidery => false,
        }
    }

    /// Whether its codes are the masked words themselves.
    const fn written_in_words(self) -> bool {
        match self {
            Self::Form(form) => form.written_in_words(),
            Self::Embroidery => false,
        }
    }

    /// The places one copy may be saved to: the record or legend text and a QR code image, which
    /// every way has, then its own.
    fn places(self) -> Vec<Place> {
        match self {
            Self::Form(form) => {
                let mut places = vec![Place::Record, Place::QrImage];
                if form.has_cards() {
                    places.push(Place::Cards(form));
                }
                places
            }
            Self::Embroidery => vec![Place::Legend, Place::LegendQr],
        }
    }

    /// The command that makes one copy in `mode`, with the way's own answers.
    fn command(self, mode: Mode) -> Vec<String> {
        let mut run: Vec<String> = match self {
            Self::Form(form) => vec![
                "encode".to_owned(),
                "--ask-secrets".to_owned(),
                "--format".to_owned(),
                format_number(form).to_string(),
            ],
            Self::Embroidery => vec!["stitch".to_owned(), "--ask-secrets".to_owned()],
        };
        run.extend(["--mode".to_owned(), mode.id().to_owned()]);
        run
    }

    /// What a pattern adds through `pattern`, its own questions or files, where a form adds
    /// nothing; none for back.
    fn pattern_only(self, pattern: Own) -> Result<Option<Vec<String>>, Stop> {
        match self {
            Self::Form(_) => Ok(Some(Vec::new())),
            Self::Embroidery => pattern(),
        }
    }
}

/// The new backup made the `way` chosen: the common block, with the way's own questions after the
/// dates; the command line and the dates kept apart from it, or none for back.
pub(crate) fn ask_new_backup(way: Way) -> Result<Option<EncodingAnswers>, Stop> {
    let Some(mode) = ask_seedshift("Use Seedshift?", way.always_masked(), Takes::Either)? else {
        return Ok(None);
    };
    let dates = super::given::ask_encoding_dates(mode)?;
    let Some(own) = way.pattern_only(super::pattern_questions::ask_pattern_own)? else {
        return Ok(None);
    };
    // The original Seedshift cannot be split into shares (mnemocode encode --help).
    let set = if mode.capabilities().split {
        let question = "Split it into Shamir shares?";
        match ask_share_set(question, &shares_explanation(), true)? {
            Some(set) => set,
            None => return Ok(None),
        }
    } else {
        None
    };
    // Codes in words are the masked words already; shares never are.
    let words_already = set.is_none() && way.written_in_words();
    let shown = shown_masked_words(mode, words_already);
    let Some(heir_size) = ask_heir_sheet(mode)? else {
        return Ok(None);
    };
    // Where it is saved comes last, just before the seed phrase; then the files the answers
    // above ask for, named in the same folder.
    let run = match (set, way) {
        (None, _) => ask_copy_destination(&way.places())?.map(|saved| {
            let mut run = way.command(mode);
            run.extend(own);
            run.extend(saved);
            run
        }),
        (Some(set), Way::Form(form)) => {
            ask_shares(set, ShareFormat::mirroring(form))?.map(|shares| {
                let mut run: Vec<String> = ["encode", "--sskr", "--ask-secrets", "--mode"]
                    .map(str::to_owned)
                    .to_vec();
                run.push(mode.id().to_owned());
                run.extend(shares);
                run
            })
        }
        // One pattern to a share, from the same picture.
        (Some(set), Way::Embroidery) => ask_pattern_shares(set)?.map(|shares| {
            let mut run = way.command(mode);
            run.extend(own);
            run.extend(shares);
            run
        }),
    };
    let Some(mut run) = run else {
        return Ok(None);
    };
    // A pattern's PDF, or with shares a new folder of one PDF a share.
    let pattern = if set.is_some() {
        super::pattern_questions::pattern_folder
    } else {
        super::pattern_questions::pattern_file
    };
    let Some(files) = way.pattern_only(pattern)? else {
        return Ok(None);
    };
    let Some(heirs) = heir_sheet_files(heir_size)? else {
        return Ok(None);
    };
    run.extend(files);
    run.extend(shown);
    run.extend(heirs);
    Ok(Some((run, dates)))
}

/// The phrase after Seedshift, which every masked backup shows on the screen without a question,
/// unless its codes are those words already; the phrase itself is seen as it is typed.
pub(crate) fn shown_masked_words(mode: Mode, words_already: bool) -> Vec<String> {
    if mode.masked() && !words_already {
        vec!["--show-masked-words".to_owned()]
    } else {
        Vec::new()
    }
}
