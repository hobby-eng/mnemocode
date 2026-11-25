//! The questions of every new backup, one block in one order: Seedshift, Shamir shares, the sheet
//! for heirs and where it is saved, with the folder of its files asked once; then, every other folder
//! closed to writing, its dates and the seed phrase (CORE-55). A masked backup shows the phrase
//! after Seedshift without a question. A way of hiding adds its own questions after Seedshift and
//! its own places; it never drops or moves one of the block. An answer it cannot take stays greyed
//! in its place, with the reason. Shift+Tab goes back a step.

use std::cell::Cell;

use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::secret::SecretVec;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::split::ShareSetChoice;

use super::encode_questions::{
    Place, Takes, ask_copy_destination, ask_heir_sheet, ask_pattern_shares, ask_seedshift,
    ask_share_set, ask_shares, heir_sheet_files, shares_explanation,
};
use super::given::format_number;
use super::output_questions::{claims_back_to, claims_now, folder_chosen};
use crate::gate::Stop;
use crate::terminal::{Channel, paint, screen_title, set_progress, set_screen_title, style};

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

    /// Its name, as the menu's list of forms shows it.
    fn label(self) -> &'static str {
        match self {
            Self::Form(form) => super::encode_questions::form_label(form),
            Self::Embroidery => "Embroidery",
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
            Self::Embroidery => vec![Place::Pattern, Place::Legend, Place::LegendQr],
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

/// `answer` of a question that names a file in the task's folder: `Nothing` unless the folder was
/// asked here, as otherwise nothing is asked: it was asked before, or no file is saved.
pub(crate) fn named_file<T>(
    ask: impl FnOnce() -> Result<Option<T>, Stop>,
) -> Result<(Option<T>, Answered), Stop> {
    let asked_before = folder_chosen();
    let answer = ask()?;
    let asked_here = !asked_before && folder_chosen();
    let step = match answer {
        None => Answered::Back,
        Some(_) if asked_here => Answered::Next,
        Some(_) => Answered::Nothing,
    };
    Ok((answer, step))
}

/// The steps of a task as a ruler under the title: a grey dot before each step passed, a cyan one
/// before the step `at` with its name in bold, a hollow one before each to come. Steps without a
/// name, and those passed over without a question, are left out.
fn ruler(names: &[Option<&str>], asked: &[bool], at: usize) -> String {
    let channel = Channel::Error;
    let mut parts = Vec::new();
    for (place, name) in names.iter().enumerate() {
        let Some(name) = name else {
            continue;
        };
        if place < at && !asked.get(place).copied().unwrap_or(true) {
            continue;
        }
        parts.push(match place.cmp(&at) {
            std::cmp::Ordering::Less => paint(channel, style::MUTED, &format!("● {name}")),
            std::cmp::Ordering::Equal => format!(
                "{} {}",
                paint(channel, style::HEADING, "●"),
                paint(channel, style::STRONG, name)
            ),
            std::cmp::Ordering::Greater => paint(channel, style::MUTED, &format!("○ {name}")),
        });
    }
    parts.join("  ")
}

/// Asks `count` steps in order, each through `ask`, Shift+Tab going back to the last step before
/// that asked something; true when the last is answered, false when the first goes back. What the
/// steps gone back over claimed of the task's files is given back. Where `names` names the steps,
/// as the answers so far settle them, one more for what comes after them, a ruler of them stands
/// under the screen's title.
pub(crate) fn run_steps(
    count: usize,
    names: impl Fn() -> Vec<Option<&'static str>>,
    mut ask: impl FnMut(usize) -> Result<Answered, Stop>,
) -> Result<bool, Stop> {
    let mut marks = vec![claims_now(); count];
    let mut asked = vec![true; count];
    let mut step = 0;
    while step < count {
        marks[step] = claims_now();
        let shown = names();
        if !shown.is_empty() {
            set_progress(Some(ruler(&shown, &asked, step)));
        }
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
                    if !names().is_empty() {
                        set_progress(None);
                    }
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
    // What comes after the steps, such as the seed phrase, is asked under the ruler too.
    let shown = names();
    if shown.len() > count {
        set_progress(Some(ruler(&shown, &asked, count)));
    }
    Ok(true)
}

/// What a new backup's answers give its command, in two parts.
pub(crate) enum Ending {
    /// The command line, every file it saves named and nothing secret typed yet: the command makes
    /// what the files need and closes every other folder to writing before the dates are asked.
    Named(Vec<String>),
    /// The dates, the last answer: the seed phrase, or the old backup, comes next.
    Dated(SecretVec<Date>),
}

/// What the end of a new backup's questions does with its answers: true once done, false to go back
/// to the step before, such as Shift+Tab at the seed phrase.
pub(crate) type Finish<'a> = dyn FnMut(Ending) -> Result<bool, Stop> + 'a;

/// The step that hands the command line to the command once its files are named: passed over when
/// going back, as it asks nothing.
pub(crate) fn files_named(finish: &mut Finish<'_>, command: Vec<String>) -> Result<Answered, Stop> {
    Ok(if finish(Ending::Named(command))? {
        Answered::Nothing
    } else {
        Answered::Back
    })
}

/// The last step, with the dates: the seed phrase, or the old backup.
pub(crate) fn dated(finish: &mut Finish<'_>, dates: &SecretVec<Date>) -> Result<Answered, Stop> {
    Ok(if finish(Ending::Dated(SecretVec::new(dates.to_vec())))? {
        Answered::Next
    } else {
        Answered::Back
    })
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

/// The new backup made the `way` chosen: the common block, with the way's own questions after
/// Seedshift, then `finish` with the command line once its files are named, and with the dates; false
/// for back from the first step. Shift+Tab goes back a step, from the seed phrase too.
pub(crate) fn ask_new_backup(way: Way, finish: &mut Finish<'_>) -> Result<bool, Stop> {
    let mode = Cell::new(Mode::Seedshift);
    let mut dates = SecretVec::new(Vec::new());
    let mut own = Vec::new();
    let mut set = None;
    let mut heir_size = None;
    let mut run = Vec::new();
    let mut heirs = Vec::new();
    // The title names the task and the way chosen; a ruler under it names the steps.
    let task = match screen_title().as_deref() {
        Some("Re-encode") => "Re-encode",
        _ => "Encode",
    };
    set_screen_title(&format!("{task} · {}", way.label()));
    let after = if task == "Encode" {
        "Phrase"
    } else {
        "Old backup"
    };
    let pattern_step = match way {
        Way::Embroidery => Some("Pattern"),
        Way::Form(_) => None,
    };
    // Dates only where Seedshift is chosen.
    let names = || {
        vec![
            Some("Seedshift"),
            pattern_step,
            Some("Shares"),
            Some("Heirs"),
            Some("Saving"),
            None,
            None,
            mode.get().masked().then_some("Dates"),
            Some(after),
        ]
    };
    let done = run_steps(9, names, |step| {
        Ok(match step {
            0 => answered(
                ask_seedshift("Use Seedshift?", way.always_masked(), Takes::Either)?
                    .map(|chosen| mode.set(chosen)),
            ),
            1 => match way {
                Way::Embroidery => {
                    answered(super::pattern_questions::ask_pattern_own()?.map(|asked| own = asked))
                }
                Way::Form(_) => {
                    own = Vec::new();
                    Answered::Nothing
                }
            },
            2 => answered(
                ask_share_set("Split it into Shamir shares?", &shares_explanation(), true)?
                    .map(|chosen| set = chosen),
            ),
            3 => answered(ask_heir_sheet()?.map(|size| heir_size = size)),
            // Where it is saved, the last of the settings.
            4 => answered(saved_where(way, mode.get(), &own, set)?.map(|saved| run = saved)),
            // The files the answers above ask for, named in the same folder.
            5 => {
                let (asked, step) = named_file(|| heir_sheet_files(heir_size))?;
                if let Some(sheet) = asked {
                    heirs = sheet;
                }
                step
            }
            // Every file named, every other folder is closed before anything secret is typed.
            6 => {
                // Codes in words are the masked words already; shares never are.
                let words_already = set.is_none() && way.written_in_words();
                let mut command = run.clone();
                command.extend(shown_masked_words(mode.get(), words_already));
                command.extend(heirs.iter().cloned());
                files_named(finish, command)?
            }
            7 => dates_step(mode.get(), &mut dates)?,
            // The seed phrase, or the old backup: what the answers are for.
            _ => dated(finish, &dates)?,
        })
    })?;
    Ok(done)
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
