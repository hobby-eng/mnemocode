//! The files of backups found in a folder and the folders inside it: printed cards, which keep
//! their codes (`mnemocode_cards::printed`), cross-stitch patterns and QR code images. What they
//! hold is listed once each, a backup or a set of shares, a set as one entry whatever its files;
//! the person chooses where several are complete. Nothing is written.

use std::path::{Path, PathBuf};

use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode_embroidery::found::{Collector, FileKind, Item, MOST_DEPTH, MOST_FILES, STARTS};

use crate::commands::asking::ask_list;
use crate::gate::Stop;
use crate::input::{InputError, MAX_PATTERN_PDF_BYTES, local_folder, local_resolved};
use crate::os;
use crate::terminal::{Choice, Explanation};

/// The endings of the files read in a folder.
const ENDINGS: [&str; 4] = ["pdf", "png", "jpg", "jpeg"];

/// What is read: anything, sets of shares alone, or backups and shares of one kind of file.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wanted {
    Any,
    Shares,
    Patterns,
    Qr,
    Cards,
}

impl Wanted {
    /// What --find names: all (the default), patterns, qr or cards; refused for any other value.
    pub(crate) fn of_option(parsed: &crate::args::Parsed) -> Result<Self, Stop> {
        Ok(
            match crate::args::choice_option(parsed, "find", &["all", "patterns", "qr", "cards"])? {
                Some("patterns") => Self::Patterns,
                Some("qr") => Self::Qr,
                Some("cards") => Self::Cards,
                _ => Self::Any,
            },
        )
    }

    /// The kind of file it is, where it names one.
    const fn kind(self) -> Option<FileKind> {
        match self {
            Self::Patterns => Some(FileKind::Pattern),
            Self::Qr => Some(FileKind::Qr),
            Self::Cards => Some(FileKind::Cards),
            Self::Any | Self::Shares => None,
        }
    }

    /// What it is, for a list that has none of it: "cross-stitch pattern".
    const fn name(self) -> &'static str {
        match self {
            Self::Patterns => "cross-stitch pattern",
            Self::Qr => "QR code",
            Self::Cards => "printed card",
            Self::Any | Self::Shares => "backup",
        }
    }
}

/// Why the files give nothing to read.
#[derive(Debug)]
pub(crate) enum CardsError {
    /// A file that cannot be read.
    File(Box<InputError>),
    /// The one backup or set they hold is not complete, as said.
    Incomplete(String),
    /// They hold several complete backups or sets, listed.
    Several(String),
    /// They hold nothing of the kind asked for, named.
    NoneOfKind(&'static str),
}

impl std::fmt::Display for CardsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::File(error) => error.fmt(f),
            Self::Incomplete(what) => write!(f, "The backup is not complete: {what}."),
            Self::Several(listed) => write!(
                f,
                "These files hold several backups: {listed}. Give the file of one, or a folder that holds only its files."
            ),
            Self::NoneOfKind(kind) => write!(
                f,
                "These files hold no {kind}: give another folder, or --find another kind."
            ),
        }
    }
}

impl std::error::Error for CardsError {}

impl Refusal for CardsError {
    fn code(&self) -> &'static str {
        match self {
            Self::File(error) => error.code(),
            Self::Incomplete(_) => "cli.card-files.incomplete",
            Self::Several(_) => "cli.card-files.several",
            Self::NoneOfKind(_) => "cli.card-files.none-of-kind",
        }
    }
}

impl From<InputError> for CardsError {
    fn from(error: InputError) -> Self {
        Self::File(Box::new(error))
    }
}

/// Takes in the file at `path`, read only where it starts as a PDF, a PNG or a JPEG.
fn take_file(found: &mut Collector, path: &Path) -> Result<(), InputError> {
    let resolved = local_resolved(path)?;
    if !STARTS
        .iter()
        .any(|start| os::file_starts_with(&resolved, start))
    {
        found.add_held(
            path.to_path_buf(),
            None,
            mnemocode_embroidery::found::Held::Nothing,
        );
        return Ok(());
    }
    let file = os::read_large_secret_file(&resolved, MAX_PATTERN_PDF_BYTES, "The file")?;
    found.add(path.to_path_buf(), &file);
    Ok(())
}

/// The files at `path`: the file itself, or those of a folder and of every folder inside it, up to
/// [`MOST_DEPTH`] down and [`MOST_FILES`] in all.
fn files_at(path: &Path) -> Result<Vec<PathBuf>, InputError> {
    let Some(folder) = local_folder(path) else {
        return Ok(vec![path.to_path_buf()]);
    };
    let unreadable = |_| os::FileError::Unreadable("The folder");
    let mut files = Vec::new();
    let mut folders = vec![(folder, 0)];
    while let Some((folder, depth)) = folders.pop() {
        files.extend(os::files_ending(&folder, &ENDINGS).map_err(unreadable)?);
        if files.len() >= MOST_FILES {
            files.truncate(MOST_FILES);
            break;
        }
        if depth < MOST_DEPTH {
            for inner in os::folders_in(&folder)
                .map_err(unreadable)?
                .into_iter()
                .rev()
            {
                folders.push((inner, depth + 1));
            }
        }
    }
    Ok(files)
}

/// One backup or set of shares found, as the list shows it.
/// The words of the phrase whose cards were chosen, asked as the cards end with decoys.
static CHOSEN_WORDS: std::sync::Mutex<Option<usize>> = std::sync::Mutex::new(None);

/// Forgets the words said for cards read before: another attempt reads another backup.
pub(crate) fn forget_chosen_words() {
    *CHOSEN_WORDS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

/// How many words the phrase has whose cards were read, where the person said it.
pub(crate) fn chosen_words() -> Option<usize> {
    *CHOSEN_WORDS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Asks how many words the phrase of the cards of `item` has, where it is a backup's cards and no
/// length is known yet: its last cards are decoys.
fn ask_words_of(item: &Item, words_given: bool) -> Result<(), Ended> {
    if item.cards.is_none() || words_given {
        return Ok(());
    }
    let choices: Vec<Choice<usize>> = mnemocode::bip39::sizes::WORD_COUNTS
        .into_iter()
        .map(|words| {
            Choice::new(
                &crate::commands::menu_entries::phrase_words_answer(words),
                words,
            )
        })
        .collect();
    let explanation = Explanation {
        lines: vec!["The last cards hold codes that belong to nothing.".to_owned()],
        more: Vec::new(),
    };
    match ask_list(
        crate::commands::menu_entries::PHRASE_WORDS_QUESTION,
        "Words",
        &choices,
        Some(&explanation),
    ) {
        Ok(Some(words)) => {
            *CHOSEN_WORDS
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(words);
            Ok(())
        }
        Ok(None) => Err(Ended::Stopped(Stop::Cancelled)),
        Err(stop) => Err(Ended::Stopped(stop)),
    }
}

/// Everything that the files at `path` hold, each backup or set once, and how many files hold
/// nothing MnemoCode reads.
fn items_at(path: &Path) -> Result<(Vec<Item>, usize), InputError> {
    let root = local_folder(path).unwrap_or_else(|| path.parent().unwrap_or(path).to_path_buf());
    let mut found = Collector::new();
    for file in files_at(path)? {
        take_file(&mut found, &file)?;
    }
    let other = found.other();
    Ok((found.finish(&root), other))
}

/// What is said of `other` files that hold nothing MnemoCode reads, such as a pattern saved by
/// another program; none where there are none.
fn other_files(other: usize) -> Option<String> {
    match other {
        0 => None,
        1 => Some("1 other file holds nothing that MnemoCode reads.".to_owned()),
        other => Some(format!(
            "{other} other files hold nothing that MnemoCode reads."
        )),
    }
}

/// `label`, such as "Cards of a backup", inside a sentence: its first letter small, unless the word
/// is written in capitals, as QR is.
fn in_a_sentence(label: &str) -> String {
    let mut letters = label.chars();
    match (letters.next(), letters.next()) {
        (Some(first), Some(second)) if !second.is_uppercase() => {
            format!("{}{}", first.to_lowercase(), &label[first.len_utf8()..])
        }
        _ => label.to_owned(),
    }
}

/// How reading the files ended without a text: refused, or the person left the choice.
enum Ended {
    Refused(CardsError),
    Stopped(Stop),
}

impl From<CardsError> for Ended {
    fn from(error: CardsError) -> Self {
        Self::Refused(error)
    }
}

impl From<InputError> for Ended {
    fn from(error: InputError) -> Self {
        Self::Refused(error.into())
    }
}

/// The backup of the files at `path` that an answer names: the codes of cards, a QR code or a
/// pattern found there, else a pattern's legend line; several complete backups are refused.
pub(crate) fn answered_files(path: &Path) -> Result<Option<SecretText>, InputError> {
    match card_codes_unasked(path, Wanted::Any)
        .map_err(|error| InputError::Files(Box::new(error)))?
    {
        Some(codes) => Ok(Some(codes)),
        None => crate::input::pattern_legend(path),
    }
}

/// [`card_codes`] where nothing may be asked: several complete backups are refused.
///
/// # Errors
///
/// As [`card_codes`], [`CardsError::Several`] where several are complete.
pub(crate) fn card_codes_unasked(
    path: &Path,
    wanted: Wanted,
) -> Result<Option<SecretText>, CardsError> {
    match read(path, wanted, false, true) {
        Ok(text) => Ok(text),
        Err(Ended::Refused(error)) => Err(error),
        Err(Ended::Stopped(_)) => Ok(None),
    }
}

/// The text of the backup or set of shares at `path`, a file or a folder of files of backups, as a
/// person types it: a backup's, or its shares a line each; none where it holds nothing of
/// `wanted`. Where several are complete, the person chooses one where `asking`.
///
/// # Errors
///
/// The files' refusals; [`CardsError::Incomplete`] where none is complete, and
/// [`CardsError::Several`] where several are and none is asked for; Escape and Shift+Tab at the
/// choice as [`Stop::Cancelled`].
pub(crate) fn card_codes(
    path: &Path,
    wanted: Wanted,
    (asking, words_given): (bool, bool),
) -> Result<Option<SecretText>, Stop> {
    match read(path, wanted, asking, words_given) {
        Ok(text) => Ok(text),
        Err(Ended::Refused(error)) => Err(error.into()),
        Err(Ended::Stopped(stop)) => Err(stop),
    }
}

/// [`card_codes`], its refusals kept apart from the person leaving the choice.
fn read(
    path: &Path,
    wanted: Wanted,
    asking: bool,
    words_given: bool,
) -> Result<Option<SecretText>, Ended> {
    let (all, other) = items_at(path)?;
    let fits = |item: &Item| match wanted.kind() {
        None if wanted == Wanted::Shares => item.is_shares(),
        None => true,
        Some(kind) => item.kinds.contains(&kind),
    };
    // Nothing of the kind asked for: everything else found is offered, and said so.
    let none_of_kind = wanted != Wanted::Any && !all.iter().any(fits);
    // Without a question, nothing else is taken for the kind asked for.
    if none_of_kind && !asking && wanted != Wanted::Shares && !all.is_empty() {
        return Err(Ended::Refused(CardsError::NoneOfKind(wanted.name())));
    }
    let mut items: Vec<Item> = all
        .into_iter()
        .filter(|item| fits(item) || (none_of_kind && wanted != Wanted::Shares))
        .collect();
    // One file of a share: the other shares of its set are looked for beside it.
    if let ([only], None, Some(parent)) = (items.as_slice(), local_folder(path), path.parent())
        && only.trouble.is_some()
        && let Some(set) = only.set.clone()
    {
        let parent = if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        };
        if let Some(whole) = items_at(parent)?
            .0
            .into_iter()
            .find(|item| item.set.as_ref() == Some(&set))
        {
            items = vec![whole];
        }
    }
    let complete: Vec<&Item> = items.iter().filter(|item| item.trouble.is_none()).collect();
    match (items.len(), complete.as_slice()) {
        (0, _) => Ok(None),
        // One of the kind asked for is taken at once; one of another kind is offered, as the list
        // below offers several, and taken only when the person chooses it.
        (1, [only]) if !none_of_kind => {
            if asking {
                // What was taken is said on the next screen, with the files that hold nothing.
                let mut said = format!("Found {}: {}.", in_a_sentence(&only.label), only.note);
                if let Some(other) = other_files(other) {
                    said = format!("{said} {other}");
                }
                crate::terminal::keep_context(
                    crate::terminal::notice_lines(&said, crate::terminal::NoticeKind::Info),
                    crate::terminal::Lifetime::Question,
                );
                ask_words_of(only, words_given)?;
            }
            Ok(Some(only.text()))
        }
        (_, []) => Err(Ended::Refused(CardsError::Incomplete(
            items
                .iter()
                .filter_map(|item| item.trouble.clone())
                .collect::<Vec<_>>()
                .join("; "),
        ))),
        _ if !asking => Err(Ended::Refused(CardsError::Several(
            items
                .iter()
                .map(|item| format!("{} ({})", item.label, item.note))
                .collect::<Vec<_>>()
                .join("; "),
        ))),
        _ => {
            let choices: Vec<Choice<usize>> = items
                .iter()
                .enumerate()
                .map(|(place, item)| Choice {
                    enabled: item.trouble.is_none(),
                    ..Choice::noted(
                        &item.label,
                        item.trouble.as_ref().unwrap_or(&item.note),
                        place,
                    )
                })
                .collect();
            let mut found = format!(
                "Found in {} and the folders inside it.",
                crate::output::shown_path(&path.to_string_lossy())
            );
            if none_of_kind {
                found = format!("No {} was found. {found}", wanted.name());
            }
            if let Some(other) = other_files(other) {
                found = format!("{found} {other}");
            }
            let explanation = Explanation {
                lines: vec![found],
                more: Vec::new(),
            };
            match ask_list(
                "Which of them should be read?",
                "Backup",
                &choices,
                Some(&explanation),
            ) {
                Ok(Some(place)) => {
                    ask_words_of(&items[place], words_given)?;
                    Ok(Some(items[place].text()))
                }
                Ok(None) => Err(Ended::Stopped(Stop::Cancelled)),
                Err(stop) => Err(Ended::Stopped(stop)),
            }
        }
    }
}
