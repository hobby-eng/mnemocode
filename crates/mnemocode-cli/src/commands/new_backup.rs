//! The questions of every new backup, one block in one order: Seedshift, its dates, Shamir shares,
//! the sheet for heirs, and last, before the seed phrase, where it is saved, with the folder of its
//! files asked once. A masked backup shows the phrase after Seedshift without a question. A way of
//! hiding adds its own questions after the dates and its own places; it never drops or moves one of
//! the block. An answer it cannot take stays greyed in its place, with the reason. Shift+Tab goes
//! back a step.

use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::secret::SecretVec;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::split::ShareSetChoice;

use super::encode_questions::{
    EncodingAnswers, Place, Takes, ask_copy_destination, ask_heir_sheet, ask_pattern_shares,
    ask_seedshift, ask_share_set, ask_shares, heir_sheet_files, shares_explanation,
};
use super::given::format_number;
use super::output_questions::{claims_back_to, claims_now, folder_chosen};
use crate::gate::Stop;

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
}

/// What one step of a task's questions gave.
pub(crate) enum Answered {
    /// An answer: on to the next step.
    Next,
    /// Shift+Tab: back to the step before.
    Back,
    /// Nothing was asked, as the answers before it settle the step: going back passes it.
    Nothing,
}

/// `Next` for an answer, `Back` for none.
pub(crate) fn answered<T>(answer: Option<T>) -> Answered {
    if answer.is_some() {
        Answered::Next
    } else {
        Answered::Back
    }
}

/// `answer` of a question that names a file in the task's folder: `Nothing` where the folder was
/// asked before, as then nothing is asked.
pub(crate) fn named_file<T>(
    ask: impl FnOnce() -> Result<Option<T>, Stop>,
) -> Result<(Option<T>, Answered), Stop> {
    let asked_before = folder_chosen();
    let answer = ask()?;
    let step = match (&answer, asked_before) {
        (None, _) => Answered::Back,
        (Some(_), true) => Answered::Nothing,
        (Some(_), false) => Answered::Next,
    };
    Ok((answer, step))
}

/// Asks `count` steps in order, each through `ask`, Shift+Tab going back to the last step before
/// that asked something; true when the last is answered, false when the first goes back. What the
/// steps gone back over claimed of the task's files is given back.
pub(crate) fn run_steps(
    count: usize,
    mut ask: impl FnMut(usize) -> Result<Answered, Stop>,
) -> Result<bool, Stop> {
    let mut marks = vec![claims_now(); count];
    let mut asked = vec![true; count];
    let mut step = 0;
    while step < count {
        marks[step] = claims_now();
        match ask(step)? {
            Answered::Next => {
                asked[step] = true;
                step += 1;
            }
            Answered::Nothing => {
                asked[step] = false;
                step += 1;
            }
            Answered::Back => loop {
                if step == 0 {
                    claims_back_to(marks[0]);
                    return Ok(false);
                }
                step -= 1;
                if asked[step] {
                    claims_back_to(marks[step]);
                    break;
                }
            },
        }
    }
    Ok(true)
}

/// The step of the dates that mask the phrase in `mode`, which keeps them in `dates`; nothing is
/// asked where `mode` takes none.
pub(crate) fn dates_step(mode: Mode, dates: &mut SecretVec<Date>) -> Result<Answered, Stop> {
    if !mode.masked() {
        *dates = SecretVec::new(Vec::new());
        return Ok(Answered::Nothing);
    }
    Ok(answered(
        super::given::ask_encoding_dates(mode)?.map(|typed| *dates = typed),
    ))
}

/// The new backup made the `way` chosen: the common block, with the way's own questions after the
/// dates; the command line and the dates kept apart from it, or none for back. Shift+Tab goes back
/// a step.
pub(crate) fn ask_new_backup(way: Way) -> Result<Option<EncodingAnswers>, Stop> {
    let mut mode = Mode::Seedshift;
    let mut dates = SecretVec::new(Vec::new());
    let mut own = Vec::new();
    let mut set = None;
    let mut heir_size = None;
    let mut run = Vec::new();
    let mut files = Vec::new();
    let mut heirs = Vec::new();
    let done = run_steps(7, |step| {
        Ok(match step {
            0 => answered(
                ask_seedshift("Use Seedshift?", way.always_masked(), Takes::Either)?
                    .map(|chosen| mode = chosen),
            ),
            1 => dates_step(mode, &mut dates)?,
            2 => match way {
                Way::Embroidery => {
                    answered(super::pattern_questions::ask_pattern_own()?.map(|asked| own = asked))
                }
                Way::Form(_) => {
                    own = Vec::new();
                    Answered::Nothing
                }
            },
            // The original Seedshift cannot be split into shares (mnemocode encode --help).
            3 if mode.capabilities().split => answered(
                ask_share_set("Split it into Shamir shares?", &shares_explanation(), true)?
                    .map(|chosen| set = chosen),
            ),
            3 => {
                set = None;
                Answered::Nothing
            }
            4 => answered(ask_heir_sheet(mode)?.map(|size| heir_size = size)),
            // Where it is saved comes last, just before the seed phrase.
            5 => answered(saved_where(way, mode, &own, set)?.map(|saved| run = saved)),
            // The files the answers above ask for, named in the same folder.
            _ => {
                let (asked, step) = named_file(|| {
                    let pattern = match (way, set) {
                        (Way::Form(_), _) => Some(Vec::new()),
                        (Way::Embroidery, None) => super::pattern_questions::pattern_file()?,
                        (Way::Embroidery, Some(_)) => super::pattern_questions::pattern_folder()?,
                    };
                    let Some(pattern) = pattern else {
                        return Ok(None);
                    };
                    Ok(heir_sheet_files(heir_size)?.map(|sheet| (pattern, sheet)))
                })?;
                if let Some((pattern, sheet)) = asked {
                    files = pattern;
                    heirs = sheet;
                }
                step
            }
        })
    })?;
    if !done {
        return Ok(None);
    }
    // Codes in words are the masked words already; shares never are.
    let words_already = set.is_none() && way.written_in_words();
    run.extend(files);
    run.extend(shown_masked_words(mode, words_already));
    run.extend(heirs);
    Ok(Some((run, dates)))
}

/// Where the backup of `way` in `mode` is saved, with the way's `own` answers and the share `set`
/// where it is split: the command that makes it, or none for back.
fn saved_where(
    way: Way,
    mode: Mode,
    own: &[String],
    set: Option<ShareSetChoice>,
) -> Result<Option<Vec<String>>, Stop> {
    Ok(match (set, way) {
        (None, _) => ask_copy_destination(&way.places())?.map(|saved| {
            let mut run = way.command(mode);
            run.extend(own.iter().cloned());
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
            run.extend(own.iter().cloned());
            run.extend(shares);
            run
        }),
    })
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
