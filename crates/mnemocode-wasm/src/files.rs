//! The files part for a page (`browser-files`): what the files a person picks hold, printed cards
//! (a PDF, PNG or JPEG, which keep the codes in their design metadata), cross-stitch patterns' PDFs
//! and QR code images, one file at a time ([`read_backup_file`]), and the backups and sets of
//! shares they hold together ([`BackupFiles`]), listed as Decode lists a folder. A page reads each
//! file and compares its size with [`backup_file_max_bytes`] first: the bytes are copied into
//! WebAssembly memory before an entry runs. Results hold codes, so a page drops them soon after.

use std::fmt;
use std::path::{Path, PathBuf};

use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode_cards::printed::{Page, found_in};
use mnemocode_embroidery::found::{
    Collector, FileKind, Held, Item, MAX_FILE_BYTES, MOST_DEPTH, MOST_FILES, codes_of, format_of,
    read_file, words_of,
};
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, place, refused};

/// Why a file is not read.
#[derive(Debug)]
enum FileRefusal {
    /// More bytes than [`backup_file_max_bytes`].
    TooLarge,
    /// Nothing MnemoCode reads: a page may pass over such a file without a word.
    Nothing,
}

impl fmt::Display for FileRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::TooLarge => "The file is larger than MnemoCode reads.",
            Self::Nothing => "This file holds nothing that MnemoCode reads.",
        })
    }
}

impl std::error::Error for FileRefusal {}

impl Refusal for FileRefusal {
    fn code(&self) -> &'static str {
        match self {
            Self::TooLarge => "wasm.files.too-large",
            Self::Nothing => "wasm.files.nothing",
        }
    }
}

/// The most bytes a file of a backup may have.
#[wasm_bindgen(js_name = backupFileMaxBytes)]
#[must_use]
pub fn backup_file_max_bytes() -> u32 {
    u32::try_from(MAX_FILE_BYTES).unwrap_or(u32::MAX)
}

/// The most files of a folder that Decode reads, as the command line does; a page stops there.
#[wasm_bindgen(js_name = backupFolderMaxFiles)]
#[must_use]
pub fn backup_folder_max_files() -> u32 {
    u32::try_from(MOST_FILES).unwrap_or(u32::MAX)
}

/// How deep below a folder given its folders are read, as the command line does. A folder has no
/// limit of bytes of its own: each file has [`backup_file_max_bytes`].
#[wasm_bindgen(js_name = backupFolderMaxDepth)]
#[must_use]
pub fn backup_folder_max_depth() -> u32 {
    u32::try_from(MOST_DEPTH).unwrap_or(u32::MAX)
}

/// What one file holds: printed cards, a backup, or a share.
#[wasm_bindgen]
pub struct BackupFile {
    kind: FileKind,
    held: Held,
}

/// What the file of `bytes` holds. Refused above [`backup_file_max_bytes`] (code ending
/// `files.too-large`) and for a file that holds nothing MnemoCode reads (`files.nothing`), which a
/// page may pass over without a word.
#[wasm_bindgen(js_name = readBackupFile)]
pub fn read_backup_file(bytes: &[u8]) -> Result<BackupFile, JsValue> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(refused(&FileRefusal::TooLarge));
    }
    after_secret(|| match read_file(bytes) {
        (Some(kind), held) => Ok(BackupFile { kind, held }),
        (None, _) => Err(refused(&FileRefusal::Nothing)),
    })
}

impl BackupFile {
    /// Its pages of cards; none for anything else.
    fn pages(&self) -> Option<&[Page]> {
        match &self.held {
            Held::Cards(pages) => Some(pages),
            _ => None,
        }
    }

    /// The codes it holds, as [`BackupFile::codes`] gives them.
    fn held_text(&self) -> Option<SecretText> {
        match &self.held {
            Held::Whole(text) | Held::Share(_, text) => Some(text.clone()),
            Held::Cards(pages) => found_in(std::slice::from_ref(pages))
                .into_iter()
                .next()
                .and_then(|found| found.parts.into_iter().next())
                .and_then(Result::ok),
            Held::Nothing => None,
        }
    }
}

#[wasm_bindgen]
impl BackupFile {
    /// What kind of file it is: "cards", "qr" or "pattern".
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.name().to_owned()
    }

    /// Whether it holds one share of a set.
    #[wasm_bindgen(getter, js_name = isShare)]
    pub fn is_share(&self) -> bool {
        match &self.held {
            Held::Share(..) => true,
            Held::Cards(pages) => pages.iter().any(|page| page.share.is_some()),
            _ => false,
        }
    }

    /// The codes it holds as a person types them: a backup's codes or record, a legend line, a
    /// share's text; for cards, the codes of this file alone in the order of their numbers, decoys
    /// included. Undefined for cards whose file holds only part of a set's numbers.
    pub fn codes(&self) -> Result<Option<String>, JsValue> {
        after_secret(|| Ok(self.held_text().map(|text| text.as_str().to_owned())))
    }

    /// The `--format` name of its codes: english, indexes, unicode, colors-unicode or colors for a
    /// backup, a share's own form (ur, words, …), or legend; undefined where it is not told, as
    /// for cards that hold only part of a set's numbers.
    #[wasm_bindgen(getter)]
    pub fn form(&self) -> Option<String> {
        after_secret(|| self.held_text().map(|text| format_of(&text).to_owned()))
    }

    /// The kind of its codes: "words", "word numbers", "Unicode", "colors as text", "colors" or
    /// "legend"; undefined for cards.
    #[wasm_bindgen(getter, js_name = codesKind)]
    pub fn codes_kind(&self) -> Option<String> {
        match &self.held {
            Held::Whole(text) | Held::Share(_, text) => Some(codes_of(text).to_owned()),
            _ => None,
        }
    }

    /// The words of the phrase of a backup's codes, record or legend; undefined for cards, whose
    /// last codes are decoys, and for a share.
    #[wasm_bindgen(getter)]
    pub fn words(&self) -> Option<usize> {
        after_secret(|| match &self.held {
            Held::Whole(text) => words_of(text.as_str()),
            _ => None,
        })
    }

    /// The identifier of the set of a share, four hexadecimal digits; undefined for a backup.
    #[wasm_bindgen(getter, js_name = shareSet)]
    pub fn share_set(&self) -> Option<String> {
        match &self.held {
            Held::Share(share, _) => Some(format!("{:04X}", share.info().identifier)),
            Held::Cards(pages) => pages
                .iter()
                .find_map(|page| page.share.as_deref())
                .map(|reference| reference.split('-').next().unwrap_or(reference).to_owned()),
            _ => None,
        }
    }

    /// The member number of a share, from 1; undefined for a backup and for cards.
    #[wasm_bindgen(getter, js_name = shareMember)]
    pub fn share_member(&self) -> Option<usize> {
        match &self.held {
            Held::Share(share, _) => Some(share.info().member_index + 1),
            _ => None,
        }
    }

    /// How many shares of its set restore it; undefined for a backup and for cards.
    #[wasm_bindgen(getter, js_name = shareThreshold)]
    pub fn share_threshold(&self) -> Option<usize> {
        match &self.held {
            Held::Share(share, _) => Some(share.info().member_threshold),
            _ => None,
        }
    }

    /// The document ID (`xmpMM:DocumentID`) of the cards' set, the same in every file of one
    /// backup or share; undefined for anything but cards.
    #[wasm_bindgen(getter, js_name = documentId)]
    pub fn document_id(&self) -> Option<String> {
        self.pages()
            .and_then(|pages| pages.first())
            .map(|page| page.document.clone())
    }
}

/// The files a person picked, taken in one by one, then listed as the backups and sets of shares
/// they hold ([`BackupFiles::finish`]).
#[wasm_bindgen]
pub struct BackupFiles {
    collector: Collector,
}

impl Default for BackupFiles {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl BackupFiles {
    /// No file taken yet.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self {
            collector: Collector::new(),
        }
    }

    /// Takes in the file of `bytes` named `name`, its path below the folder picked where the page
    /// knows it ("cards/card-designs.pdf"), which the notes name. What kind it is: "cards", "qr" or
    /// "pattern"; undefined where it holds nothing MnemoCode reads, which [`FoundBackups::other`]
    /// counts. Refused above [`backup_file_max_bytes`] (code ending `files.too-large`).
    pub fn add(&mut self, bytes: &[u8], name: &str) -> Result<Option<String>, JsValue> {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(refused(&FileRefusal::TooLarge));
        }
        let collector = &mut self.collector;
        after_secret(|| {
            Ok(collector
                .add(PathBuf::from(name), bytes)
                .map(|kind| kind.name().to_owned()))
        })
    }

    /// Everything taken in, each backup or set once: the sets of shares first, then the backups.
    /// The notes name the files by their place below `root`, the folder picked; none: as given.
    pub fn finish(self, root: Option<String>) -> FoundBackups {
        let other = self.collector.other();
        let root = PathBuf::from(root.unwrap_or_default());
        let items = after_secret(|| self.collector.finish(Path::new(&root)));
        FoundBackups { items, other }
    }
}

/// The backups and sets of shares that the files picked hold, as Decode lists a folder: each with
/// what it is, a note of what it holds and where, and why it cannot be read where it is not
/// complete.
#[wasm_bindgen]
pub struct FoundBackups {
    items: Vec<Item>,
    other: usize,
}

impl FoundBackups {
    /// The item at `at`.
    fn at(&self, at: f64) -> Option<&Item> {
        self.items.get(place(at))
    }
}

#[wasm_bindgen]
impl FoundBackups {
    /// How many there are.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.items.len()
    }

    /// How many files held nothing MnemoCode reads.
    #[wasm_bindgen(getter)]
    pub fn other(&self) -> usize {
        self.other
    }

    /// What the item at `at` is, such as "Cards of a backup"; none past the last.
    pub fn label(&self, at: f64) -> Option<String> {
        self.at(at).map(|item| item.label.clone())
    }

    /// What it holds and where, such as "18 cards, colors, card-designs.pdf".
    pub fn note(&self, at: f64) -> Option<String> {
        self.at(at).map(|item| item.note.clone())
    }

    /// Why it cannot be read, such as "1 share, 2 needed"; undefined where it is complete.
    pub fn trouble(&self, at: f64) -> Option<String> {
        self.at(at).and_then(|item| item.trouble.clone())
    }

    /// The kinds of file it was read from: "cards", "qr" or "pattern", each once.
    pub fn kinds(&self, at: f64) -> Vec<String> {
        let mut kinds: Vec<String> = self
            .at(at)
            .map(|item| {
                item.kinds
                    .iter()
                    .map(|kind| kind.name().to_owned())
                    .collect()
            })
            .unwrap_or_default();
        kinds.sort_unstable();
        kinds.dedup();
        kinds
    }

    /// Whether it is a set of shares.
    #[wasm_bindgen(js_name = isShares)]
    pub fn is_shares(&self, at: f64) -> bool {
        self.at(at).is_some_and(Item::is_shares)
    }

    /// The identifier of its set of shares; undefined for a backup.
    pub fn set(&self, at: f64) -> Option<String> {
        self.at(at).and_then(|item| item.set.clone())
    }

    /// How many shares of its group restore it, for a set of one group; undefined for a backup and
    /// for a set of several groups, whose note says how many groups.
    pub fn needed(&self, at: f64) -> Option<usize> {
        self.at(at).and_then(|item| item.needed)
    }

    /// The members of its set that were found, from 1; a copy of one counts once.
    pub fn members(&self, at: f64) -> Vec<u32> {
        self.at(at)
            .map(|item| {
                item.members
                    .iter()
                    .map(|&member| u32::try_from(member).unwrap_or(u32::MAX))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The group of each member found, from 1, in the order of [`FoundBackups::members`].
    pub fn groups(&self, at: f64) -> Vec<u32> {
        self.at(at)
            .map(|item| {
                item.groups
                    .iter()
                    .map(|&group| u32::try_from(group).unwrap_or(u32::MAX))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// What is wrong with files of it that are not needed, such as a damaged share beyond the
    /// threshold; undefined where nothing is.
    pub fn warning(&self, at: f64) -> Option<String> {
        self.at(at).and_then(|item| item.warning.clone())
    }

    /// How many cards a backup's cards are, decoys included, which tells that the page asks for the
    /// phrase's words; undefined for anything else.
    pub fn cards(&self, at: f64) -> Option<usize> {
        self.at(at).and_then(|item| item.cards)
    }

    /// The kind of its codes, as [`BackupFile::codes_kind`] names it.
    #[wasm_bindgen(js_name = codesKind)]
    pub fn codes_kind(&self, at: f64) -> Option<String> {
        self.at(at).and_then(|item| item.codes).map(str::to_owned)
    }

    /// The `--format` name of its codes, as [`BackupFile::form`] gives it; undefined where its
    /// files hold several.
    pub fn form(&self, at: f64) -> Option<String> {
        self.at(at).and_then(|item| item.format).map(str::to_owned)
    }

    /// The names of its files, as they were given.
    pub fn files(&self, at: f64) -> Vec<String> {
        self.at(at)
            .map(|item| {
                item.files
                    .iter()
                    .map(|file| file.to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Its text as a person types it: a backup's codes, record or legend line, or its shares a line
    /// each, which Decode and the restore read; none past the last.
    pub fn text(&self, at: f64) -> Result<Option<String>, JsValue> {
        after_secret(|| Ok(self.at(at).map(|item| item.text().as_str().to_owned())))
    }

    /// Its shares in the standard form, ur:sskr/…, one for each member found; empty for a backup.
    pub fn shares(&self, at: f64) -> Result<Vec<String>, JsValue> {
        after_secret(|| {
            Ok(self
                .at(at)
                .map(|item| {
                    item.shares()
                        .iter()
                        .map(|share| share.ur().as_str().to_owned())
                        .collect()
                })
                .unwrap_or_default())
        })
    }
}
