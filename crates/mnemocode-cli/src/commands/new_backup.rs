//! The questions of every new backup, one block in one order: Seedshift, its dates, Shamir shares,
//! the copies on the screen, the sheet for heirs, and last, before the seed phrase, where it is
//! saved, with the folder of its files asked once. A way of hiding adds its own questions after the
//! dates and its own places; it never drops or moves one of the block. An answer it cannot take
//! stays greyed in its place, with the reason.

use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::sskr::forms::ShareFormat;

use super::asking::ask_list;
use super::encode::ORIGINAL_COPY_FORM;
use super::encode_questions::{
    EncodingAnswers, Place, Takes, ask_copy_destination, ask_heir_sheet, ask_original_copy,
    ask_seedshift, ask_share_set, ask_shares, heir_sheet_files, shares_explanation,
};
use super::given::format_number;
use crate::gate::Stop;
use crate::terminal::{Choice, Explanation};

/// What a pattern made with the original Seedshift keeps, said where it is chosen and with the
/// result.
pub(crate) const LAST_WORD_WARNING: &str = "Only the Original Seedshift loses a word here: a pattern then keeps 11 of 12 words, or 23 of 24. Remember your seed phrase's real last word.";

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
    /// Which Seedshift it takes. A legend holds the entropy of a valid phrase, which the original
    /// Seedshift's result usually is not: its last word is replaced, and the owner keeps the real
    /// one.
    const fn takes(self) -> Takes {
        match self {
            Self::Form(_) => Takes::Either,
            Self::Embroidery => Takes::LastWordLost {
                note: "keeps all but the last word: remember it",
                warning: LAST_WORD_WARNING,
            },
        }
    }

    /// The mode its backup is made in for `mode` chosen: a pattern's original Seedshift replaces
    /// the last word, which no sheet for heirs leads through.
    fn kept(self, mode: Mode) -> Mode {
        match self {
            Self::Form(_) => mode,
            Self::Embroidery => mode.with_valid_last_word().unwrap_or(mode),
        }
    }

    /// Whether it is always masked: unmasked, the form would show the seed phrase itself.
    const fn always_masked(self) -> bool {
        match self {
            Self::Form(form) => form.always_masked(),
            Self::Embroidery => false,
        }
    }

    /// Why it cannot be split into Shamir shares; none where it can.
    const fn unsplittable(self) -> Option<&'static str> {
        match self {
            Self::Form(_) => None,
            Self::Embroidery => Some("a pattern's legend holds one seed phrase, not shares"),
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
    let Some(mode) = ask_seedshift("Use Seedshift?", way.always_masked(), way.takes())? else {
        return Ok(None);
    };
    let dates = super::given::ask_encoding_dates(mode)?;
    let Some(own) = way.pattern_only(super::pattern_questions::ask_pattern_own)? else {
        return Ok(None);
    };
    // The original Seedshift cannot be split into shares (mnemocode encode --help).
    let set = if mode.capabilities().split {
        let question = "Split it into Shamir shares?";
        match ask_share_set(question, &shares_explanation(), true, way.unsplittable())? {
            Some(set) => set,
            None => return Ok(None),
        }
    } else {
        None
    };
    // Codes in words are the masked words already; shares never are.
    let words_already = set.is_none() && way.written_in_words();
    let Some(shown) = ask_copies(mode, set.is_some(), words_already)? else {
        return Ok(None);
    };
    let Some(heir_size) = ask_heir_sheet(way.kept(mode))? else {
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
        // Its sets are greyed: a pattern is never split.
        (Some(_), Way::Embroidery) => None,
    };
    let Some(mut run) = run else {
        return Ok(None);
    };
    let Some(files) = way.pattern_only(super::pattern_questions::pattern_file)? else {
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

/// The copies on the screen, as every new backup asks them: the original phrase where it is masked
/// or `shared`, and the masked phrase in words where it is masked; their options, none for back.
pub(crate) fn ask_copies(
    mode: Mode,
    shared: bool,
    words_already: bool,
) -> Result<Option<Vec<String>>, Stop> {
    let mut shown = Vec::new();
    if shared || mode.masked() {
        let Some(copy) = ask_original_copy(mode, shared)? else {
            return Ok(None);
        };
        if copy {
            shown.extend(["--show-original".to_owned(), ORIGINAL_COPY_FORM.to_owned()]);
        }
    }
    if mode.masked() {
        let Some(show_words) = ask_masked_words(words_already)? else {
            return Ok(None);
        };
        if show_words {
            shown.push("--show-masked-words".to_owned());
        }
    }
    Ok(Some(shown))
}

/// Whether the masked phrase is also shown in English words; Yes greyed where the backup is those
/// words already.
fn ask_masked_words(words_already: bool) -> Result<Option<bool>, Stop> {
    let mut yes = Choice::noted("Yes", "the masked phrase; the dates are still needed", true);
    let mut lines = Vec::new();
    if words_already {
        yes.enabled = false;
        yes.note = Some("the backup is these words already".to_owned());
        lines.push("Not for this backup: its codes are the masked words.".to_owned());
    }
    let explanation = (!lines.is_empty()).then_some(Explanation {
        lines,
        more: Vec::new(),
    });
    ask_list(
        "Also show the Seedshift phrase as English words?",
        "Decoy words",
        &[
            Choice::noted("No", "keep only the codes or shares", false),
            yes,
        ],
        explanation.as_ref(),
    )
}
