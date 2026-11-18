//! The backups found among files: printed cards, which keep their codes
//! (`mnemocode_cards::printed`), cross-stitch patterns, which keep their legend line, and QR code
//! images. [`read_file`] tells what one file holds from its bytes; a [`Collector`] takes the files
//! of a folder, or those a person picked, and lists each backup and each set of shares once,
//! whatever files hold it. A host reads the files and asks; nothing here touches a file system.

use std::path::{Path, PathBuf};

use mnemocode::backup::record::parse_record;
use mnemocode::forms::Form;
use mnemocode::qr::{self, QrError};
use mnemocode::secret::SecretText;
use mnemocode::sskr::forms::read_share;
use mnemocode::sskr::share::{Share, ShareInfo};
use mnemocode::text::display::safe_display;
use mnemocode_cards::printed::{Found, Page, found_in, pages_in};

use crate::{chart, legend, phrase};

/// The largest file read: a pattern's PDF or a page of cards.
pub const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
/// How deep below a folder given the folders inside it are read.
pub const MOST_DEPTH: usize = 6;
/// The most files of a folder that are read.
pub const MOST_FILES: usize = 1024;

/// The first bytes of the files that may hold a backup: a PDF, a PNG and a JPEG.
pub const STARTS: [&[u8]; 3] = [b"%PDF-", b"\x89PNG\r\n\x1a\n", &[0xFF, 0xD8]];

/// The kind of file a backup or a share was read from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
    /// Printed cards: a PDF, PNG or JPEG of them.
    Cards,
    /// A QR code image.
    Qr,
    /// A cross-stitch pattern's PDF.
    Pattern,
}

impl FileKind {
    /// Its name, as a host passes it on: "cards", "qr" or "pattern".
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Cards => "cards",
            Self::Qr => "qr",
            Self::Pattern => "pattern",
        }
    }
}

/// What one file holds.
pub enum Held {
    /// Pages of printed cards.
    Cards(Vec<Page>),
    /// A share, and the text it was read from: a pattern's legend line or a QR code's codes.
    Share(Share, SecretText),
    /// A whole backup: a pattern's legend line, or the record of a QR code.
    Whole(SecretText),
    /// Nothing MnemoCode reads.
    Nothing,
}

/// Whether `bytes` start as a file that may hold a backup: a PDF, a PNG or a JPEG.
#[must_use]
pub fn may_hold(bytes: &[u8]) -> bool {
    STARTS.iter().any(|start| bytes.starts_with(start))
}

/// What `text` holds, a legend line, a share's code or a record; a record only where `records`
/// takes one, as from a QR code.
#[must_use]
pub fn held_in_text(text: &SecretText, records: bool) -> Held {
    let line = text.as_str();
    if legend::is_line(line) {
        return match phrase::share_of_legend(line) {
            Ok(Some(read)) => Held::Share(read.share, text.clone()),
            Ok(None) => Held::Whole(text.clone()),
            Err(_) => Held::Nothing,
        };
    }
    match read_share(line) {
        Ok(read) => Held::Share(read.share, text.clone()),
        Err(_) if records && !line.trim().is_empty() => Held::Whole(text.clone()),
        Err(_) => Held::Nothing,
    }
}

/// The text of a QR code image: its hidden record, or else what it shows.
fn qr_text(bytes: &[u8]) -> Option<SecretText> {
    match qr::hidden::read_png(bytes) {
        Ok(record) => Some(record),
        Err(QrError::NoHiddenRecord) => qr::read_png(bytes).ok(),
        Err(_) => None,
    }
}

/// What the file of `bytes` holds, and its kind: the pages of cards where it keeps them, else a
/// pattern's legend line in a PDF, else a QR code's text in a PNG; none for anything else.
#[must_use]
pub fn read_file(bytes: &[u8]) -> (Option<FileKind>, Held) {
    if !may_hold(bytes) || bytes.len() > MAX_FILE_BYTES {
        return (None, Held::Nothing);
    }
    let pages = pages_in(bytes);
    if !pages.is_empty() {
        return (Some(FileKind::Cards), Held::Cards(pages));
    }
    let (kind, text, records) = if bytes.starts_with(STARTS[0]) {
        (FileKind::Pattern, chart::legend_of_pdf(bytes), false)
    } else if bytes.starts_with(STARTS[1]) {
        (FileKind::Qr, qr_text(bytes), true)
    } else {
        return (None, Held::Nothing);
    };
    match text.map(|text| held_in_text(&text, records)) {
        Some(Held::Nothing) | None => (None, Held::Nothing),
        Some(held) => (Some(kind), held),
    }
}

/// The form of the codes in `text`: the one a record of an earlier version names, else the one
/// they look like.
#[must_use]
pub fn form_of(text: &str) -> Form {
    match parse_record(text) {
        Ok(Some(record)) => record.form,
        _ => Form::likely(text),
    }
}

/// The words of the phrase that `text`, a backup's codes, record or legend line, holds; none where
/// it does not tell, as for printed cards, which end with decoys.
#[must_use]
pub fn words_of(text: &str) -> Option<usize> {
    if legend::is_line(text) {
        return phrase::record_of_legend(text)
            .ok()
            .flatten()
            .map(|read| read.record().as_str().split_whitespace().count());
    }
    let (form, codes) = match parse_record(text) {
        Ok(Some(record)) => (record.form, record.payload),
        _ => (Form::likely(text), text),
    };
    form.read(codes).ok().map(|indexes| indexes.len())
}

/// The `--format` name of the codes `text` holds: "legend" for a pattern's legend line, a share's
/// own form (ur, words, …), or a backup's form (english, indexes, unicode, colors-unicode, colors).
#[must_use]
pub fn format_of(text: &SecretText) -> &'static str {
    let text = text.as_str();
    if legend::is_line(text) {
        return "legend";
    }
    if let Ok(read) = read_share(text) {
        return read.format.name();
    }
    form_of(text).name()
}

/// What kind of codes `text` holds, as a list says it: "Unicode", "colors", or "legend" for a
/// pattern's legend line.
#[must_use]
pub fn codes_of(text: &SecretText) -> &'static str {
    let text = text.as_str();
    if legend::is_line(text) {
        return "legend";
    }
    match form_of(text) {
        Form::English => "words",
        Form::Indexes => "word numbers",
        Form::Unicode => "Unicode",
        Form::ColorsUnicode => "colors as text",
        Form::Colors => "colors",
    }
}

/// One backup or set of shares found, as a list shows it.
pub struct Item {
    /// What it is, such as "Cards of a backup".
    pub label: String,
    /// What it holds and where its files are, such as "18 cards, colors, card-designs.pdf".
    pub note: String,
    /// Why it cannot be read; none where it is complete.
    pub trouble: Option<String>,
    /// The identifier of its set of shares, in hexadecimal; none for a backup.
    pub set: Option<String>,
    /// How many shares of its group restore it, for a set of one group.
    pub needed: Option<usize>,
    /// The members of its set that were found, from 1, each once.
    pub members: Vec<usize>,
    /// The group of each member found, from 1.
    pub groups: Vec<usize>,
    /// What is wrong with files of it that are not needed, such as a damaged share beyond the
    /// threshold; none where nothing is.
    pub warning: Option<String>,
    /// How many cards a backup's cards are, decoys included; none for anything else.
    pub cards: Option<usize>,
    /// The kind of its codes, as [`codes_of`] says it.
    pub codes: Option<&'static str>,
    /// The `--format` name of its codes, as [`format_of`] gives it; none where its files hold
    /// several.
    pub format: Option<&'static str>,
    /// The kinds of file it was read from.
    pub kinds: Vec<FileKind>,
    /// Its files.
    pub files: Vec<PathBuf>,
    texts: Vec<SecretText>,
    shares: Vec<Share>,
}

impl Item {
    /// Whether it is a set of shares.
    #[must_use]
    pub const fn is_shares(&self) -> bool {
        self.set.is_some()
    }

    /// Its text as a person types it: a backup's, or its shares a line each.
    #[must_use]
    pub fn text(&self) -> SecretText {
        let texts: Vec<&str> = self.texts.iter().map(SecretText::as_str).collect();
        SecretText::copy_of("the files of a backup", &texts.join("\n"))
    }

    /// Its shares, one for each member found.
    #[must_use]
    pub fn shares(&self) -> &[Share] {
        &self.shares
    }
}

/// A set of shares being gathered: each share by its group and member, the first copy kept.
struct Set {
    id: String,
    files: Vec<PathBuf>,
    found: Vec<(ShareInfo, Share, SecretText)>,
    /// Two different shares with one group and member number: (group, member), from 1.
    conflicts: Vec<(usize, usize)>,
    /// Why parts of it could not be read, such as a share's card missing.
    damage: Vec<String>,
    kinds: Vec<FileKind>,
}

impl Set {
    /// Takes in `share`, read from `text`: a copy of a share counts once; another share with the
    /// same group and member is a conflict.
    fn take(&mut self, share: Share, text: SecretText) {
        let info = share.info();
        let same = |other: &ShareInfo| {
            other.group_index == info.group_index && other.member_index == info.member_index
        };
        match self.found.iter().find(|(other, _, _)| same(other)) {
            Some((_, kept, _)) if kept.payload() == share.payload() => {}
            Some(_) => {
                let key = (info.group_index + 1, info.member_index + 1);
                if !self.conflicts.contains(&key) {
                    self.conflicts.push(key);
                }
            }
            None => self.found.push((info, share, text)),
        }
    }

    /// Whether the shares found agree on the set they belong to, and it is the set that their
    /// cards' reference names.
    fn consistent(&self) -> bool {
        let Some((first, _, _)) = self.found.first() else {
            return true;
        };
        format!("{:04X}", first.identifier) == self.id
            && self.found.iter().all(|(info, _, _)| {
                info.identifier == first.identifier
                    && info.group_threshold == first.group_threshold
                    && info.group_count == first.group_count
                    && info.secret_length == first.secret_length
                    && self.found.iter().all(|(other, _, _)| {
                        other.group_index != info.group_index
                            || other.member_threshold == info.member_threshold
                    })
            })
    }

    /// Whether the shares found restore the phrase: enough members in enough groups.
    fn enough(&self) -> bool {
        let Some((first, _, _)) = self.found.first() else {
            return false;
        };
        let groups = (0..first.group_count)
            .filter(|&group| {
                let members: Vec<&ShareInfo> = self
                    .found
                    .iter()
                    .map(|(info, _, _)| info)
                    .filter(|info| info.group_index == group)
                    .collect();
                members
                    .first()
                    .is_some_and(|info| members.len() >= info.member_threshold)
            })
            .count();
        groups >= first.group_threshold
    }
}

/// The files of backups taken in one by one, then listed.
#[derive(Default)]
pub struct Collector {
    card_pages: Vec<Vec<Page>>,
    card_files: Vec<PathBuf>,
    items: Vec<Item>,
    sets: Vec<Set>,
    other: usize,
}

impl Collector {
    /// No file taken yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Takes in `file`, of `bytes`; the kind of what it holds, none where it holds nothing.
    pub fn add(&mut self, file: PathBuf, bytes: &[u8]) -> Option<FileKind> {
        let (kind, held) = read_file(bytes);
        self.add_held(file, kind, held);
        kind
    }

    /// Takes in what `file` holds, as [`read_file`] tells it.
    pub fn add_held(&mut self, file: PathBuf, kind: Option<FileKind>, held: Held) {
        match (kind, held) {
            (_, Held::Cards(pages)) => {
                self.card_files.push(file);
                self.card_pages.push(pages);
            }
            (Some(kind), Held::Whole(text)) => self.items.push(Item {
                label: match kind {
                    FileKind::Pattern => "Cross-stitch backup",
                    _ => "QR code of a backup",
                }
                .to_owned(),
                note: String::new(),
                trouble: None,
                set: None,
                needed: None,
                members: Vec::new(),
                groups: Vec::new(),
                warning: None,
                cards: None,
                codes: Some(codes_of(&text)),
                format: Some(format_of(&text)),
                kinds: vec![kind],
                files: vec![file],
                texts: vec![text],
                shares: Vec::new(),
            }),
            (Some(kind), Held::Share(share, text)) => {
                let id = format!("{:04X}", share.info().identifier);
                let set = self.set_of(id);
                set.files.push(file);
                set.kinds.push(kind);
                set.take(share, text);
            }
            _ => self.other += 1,
        }
    }

    /// How many files held nothing MnemoCode reads.
    #[must_use]
    pub const fn other(&self) -> usize {
        self.other
    }

    /// The set of shares `id`, made where it is new.
    fn set_of(&mut self, id: String) -> &mut Set {
        let at = match self.sets.iter().position(|set| set.id == id) {
            Some(at) => at,
            None => {
                self.sets.push(Set {
                    id,
                    files: Vec::new(),
                    found: Vec::new(),
                    conflicts: Vec::new(),
                    damage: Vec::new(),
                    kinds: Vec::new(),
                });
                self.sets.len() - 1
            }
        };
        &mut self.sets[at]
    }

    /// Adds what the cards `found` hold: a backup as an item of its own, the shares of a set to that
    /// set, with the shares of its other files.
    fn add_cards(&mut self, found: Found) {
        let files: Vec<PathBuf> = found
            .files
            .iter()
            .map(|&file| self.card_files[file].clone())
            .collect();
        let damage: Vec<String> = found
            .parts
            .iter()
            .filter_map(|part| part.as_ref().err().map(ToString::to_string))
            .collect();
        let texts: Vec<SecretText> = found.parts.into_iter().filter_map(Result::ok).collect();
        let Some(id) = found.set else {
            let cards = texts
                .iter()
                .map(|text| text.as_str().split(' ').count())
                .sum();
            self.items.push(Item {
                label: "Cards of a backup".to_owned(),
                note: String::new(),
                trouble: damage.into_iter().next(),
                set: None,
                needed: None,
                members: Vec::new(),
                groups: Vec::new(),
                warning: None,
                cards: Some(cards),
                codes: texts.first().map(codes_of),
                format: texts.first().map(format_of),
                kinds: vec![FileKind::Cards],
                files,
                texts,
                shares: Vec::new(),
            });
            return;
        };
        let set = self.set_of(id);
        set.files.extend(files);
        set.kinds.push(FileKind::Cards);
        // A damaged share is reported, and keeps the set from being read only where the others
        // are too few.
        set.damage.extend(damage);
        // Codes in order that make no share are damage too, as a gap in their numbers is.
        for text in texts {
            match read_share(text.as_str()) {
                Ok(read) => set.take(read.share, text),
                Err(_) => set
                    .damage
                    .push("the codes of a share do not read".to_owned()),
            }
        }
    }

    /// Everything taken in, each backup or set once: the sets of shares first, then the backups.
    /// The notes name the files by their place below `root`, the folder looked in.
    #[must_use]
    pub fn finish(mut self, root: &Path) -> Vec<Item> {
        for found in found_in(&std::mem::take(&mut self.card_pages)) {
            self.add_cards(found);
        }
        let several = self.sets.len() > 1;
        let mut all: Vec<Item> = self
            .sets
            .into_iter()
            .map(|set| set_item(set, several, root))
            .collect();
        for mut item in self.items {
            // A pattern holds a legend, as its label says already.
            let codes = item.codes.filter(|_| item.kinds != [FileKind::Pattern]);
            let what = match (item.cards, codes) {
                (Some(cards), Some(codes)) => format!("{cards} cards, {codes}"),
                (Some(cards), None) => format!("{cards} cards"),
                (None, Some(codes)) => codes.to_owned(),
                (None, None) => String::new(),
            };
            item.note = match (what.is_empty(), place_of(&item.files, root)) {
                (false, Some(place)) => format!("{what}, {place}"),
                (true, Some(place)) => place,
                (_, None) => what,
            };
            all.push(item);
        }
        all
    }
}

/// The item of `set`, its identifier in its label where `several` sets look alike.
fn set_item(set: Set, several: bool, root: &Path) -> Item {
    let count = set.found.len();
    let first = set.found.first().map(|(info, _, _)| *info);
    let one_group = first.is_none_or(|info| info.group_count == 1);
    let needed = first
        .filter(|_| one_group)
        .map(|info| info.member_threshold);
    let shares_word = |count: usize| if count == 1 { "share" } else { "shares" };
    let mut what = match (first, needed) {
        (_, Some(needed)) => format!("{count} {}, {needed} needed", shares_word(count)),
        (Some(info), None) => format!(
            "{count} {}, {} of {} groups needed",
            shares_word(count),
            info.group_threshold,
            info.group_count
        ),
        (None, None) => format!("{count} {}", shares_word(count)),
    };
    let trouble = if !set.conflicts.is_empty() {
        let numbers: Vec<String> = set
            .conflicts
            .iter()
            .map(|(group, member)| {
                if one_group {
                    member.to_string()
                } else {
                    format!("{member} of group {group}")
                }
            })
            .collect();
        Some(format!(
            "different shares with the same number: {}",
            numbers.join(", ")
        ))
    } else if !set.consistent() {
        Some("shares that do not belong to one set".to_owned())
    } else if !set.enough() {
        Some(match set.damage.first() {
            Some(damage) => format!("{what}; {damage}"),
            None => what.clone(),
        })
    } else {
        None
    };
    let warning = (trouble.is_none() && !set.damage.is_empty()).then(|| {
        format!(
            "{} damaged, not needed: {}",
            set.damage.len(),
            set.damage.join("; ")
        )
    });
    let texts: Vec<SecretText> = set.found.iter().map(|(_, _, text)| text.clone()).collect();
    let mut formats: Vec<&str> = texts.iter().map(format_of).collect();
    formats.dedup();
    let format = match formats.as_slice() {
        [one] => Some(*one),
        _ => None,
    };
    let mut codes: Vec<&str> = texts.iter().map(codes_of).collect();
    codes.sort_unstable();
    codes.dedup();
    if !codes.is_empty() {
        what = format!("{what}, {}", codes.join(" and "));
    }
    if !set.damage.is_empty() && trouble.is_none() {
        what = format!("{what}, {} damaged", set.damage.len());
    }
    // The folder of the set, without "in": the note is short enough for one line.
    if let Some(place) = place_of(&set.files, root) {
        let place = place.strip_prefix("in ").unwrap_or(&place).to_owned();
        what = format!("{what}, {place}");
    }
    let mut label = shares_label(&set.kinds).to_owned();
    if several {
        label = format!("{label} {}", set.id);
    }
    Item {
        label,
        note: what,
        trouble,
        needed,
        members: set
            .found
            .iter()
            .map(|(info, _, _)| info.member_index + 1)
            .collect(),
        groups: set
            .found
            .iter()
            .map(|(info, _, _)| info.group_index + 1)
            .collect(),
        warning,
        cards: None,
        codes: codes.first().copied(),
        format,
        kinds: set.kinds,
        files: set.files,
        texts,
        shares: set.found.into_iter().map(|(_, share, _)| share).collect(),
        set: Some(set.id),
    }
}

/// What the shares of a set were read from, as a list names them.
fn shares_label(kinds: &[FileKind]) -> &'static str {
    let all = |wanted: FileKind| !kinds.is_empty() && kinds.iter().all(|&kind| kind == wanted);
    if all(FileKind::Cards) {
        "Cards of Shamir shares"
    } else if all(FileKind::Qr) {
        "QR codes of Shamir shares"
    } else if all(FileKind::Pattern) {
        "Cross-stitch shares"
    } else {
        "Shamir shares"
    }
}

/// Where `files` are, by the names of their folders and file below `root`, the folder looked in:
/// a file's, or the folder that holds them all; none where that is `root` itself.
#[must_use]
pub fn place_of(files: &[PathBuf], root: &Path) -> Option<String> {
    // A file's name is shown, never obeyed: a control character in it becomes U+FFFD.
    let shown =
        |path: &Path| safe_display(&path.strip_prefix(root).unwrap_or(path).to_string_lossy());
    match files {
        [one] => Some(shown(one)),
        [first, ..] => {
            // The deepest folder that holds them all, such as the folder of a share's own folders.
            let mut folder = first.parent()?;
            while !files.iter().all(|file| file.starts_with(folder)) {
                folder = folder.parent()?;
            }
            let shown = shown(folder);
            if !shown.is_empty() {
                return Some(format!("in {shown}"));
            }
            let mut folders: Vec<&Path> = files.iter().filter_map(|file| file.parent()).collect();
            folders.sort_unstable();
            folders.dedup();
            (folders.len() > 1).then(|| format!("in {} folders", folders.len()))
        }
        [] => None,
    }
}

#[cfg(test)]
mod tests {
    use mnemocode::random::{Random, RandomError};
    use mnemocode::sskr::engine::{Group, split};
    use mnemocode::sskr::forms::ShareFormat;

    use super::*;

    /// Randomness of one public byte: two splits of one byte share their set identifier.
    struct Filled(u8);

    impl Random for Filled {
        fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
            bytes.fill(self.0);
            Ok(())
        }
    }

    /// The shares of 16 bytes of `secret`, group after group, `quorum` of the groups needed.
    fn shares_of(secret: u8, quorum: usize, groups: &[Group]) -> Vec<Share> {
        split(&[secret; 16], quorum, groups, &mut Filled(7))
            .unwrap()
            .iter()
            .map(|payload| Share::of_payload(payload).unwrap())
            .collect()
    }

    /// One set of 2 of 3 shares.
    fn two_of_three(secret: u8) -> Vec<Share> {
        shares_of(
            secret,
            1,
            &[Group {
                threshold: 2,
                count: 3,
            }],
        )
    }

    /// What QR code images of `shares`, each with its file's name, hold.
    fn of_qr(shares: &[(&str, &Share)]) -> Vec<Item> {
        let mut collector = Collector::new();
        for (file, share) in shares {
            let copy = Share::of_payload(share.payload()).unwrap();
            let held = Held::Share(copy, share.ur());
            collector.add_held(PathBuf::from(file), Some(FileKind::Qr), held);
        }
        collector.finish(Path::new(""))
    }

    /// What files of cards, each of `pages`, hold.
    fn of_cards(files: Vec<Vec<Page>>) -> Vec<Item> {
        let mut collector = Collector::new();
        for (at, pages) in files.into_iter().enumerate() {
            collector.add_held(PathBuf::from(format!("{at}.pdf")), None, Held::Cards(pages));
        }
        collector.finish(Path::new(""))
    }

    /// The one set of `items`, readable.
    fn readable(mut items: Vec<Item>) -> Item {
        assert_eq!(items.len(), 1);
        let item = items.remove(0);
        assert_eq!(item.trouble, None);
        item
    }

    /// The page of the cards of `share`, its Unicode codes one to a card.
    fn page_of(share: &Share) -> Page {
        let text = ShareFormat::Unicode.write(share);
        let info = share.info();
        let reference = format!(
            "{:04X}-{}-{}",
            info.identifier,
            info.group_index + 1,
            info.member_index + 1
        );
        Page {
            document: "public".to_owned(),
            share: Some(reference),
            codes: text
                .as_str()
                .split(' ')
                .enumerate()
                .map(|(at, code)| (at + 1, SecretText::copy_of("a card", code)))
                .collect(),
        }
    }

    // AUD-008-FUN002: members of different groups may have one number; each is kept.
    #[test]
    fn shares_of_different_groups_with_one_number_are_each_kept() {
        let group = Group {
            threshold: 2,
            count: 3,
        };
        let all = shares_of(0, 2, &[group, group]);
        // Group after group: the first three, then the second three.
        let item = readable(of_qr(&[
            ("a.png", &all[0]),
            ("b.png", &all[1]),
            ("c.png", &all[3]),
            ("d.png", &all[4]),
        ]));
        assert_eq!(item.members, [1, 2, 1, 2]);
        assert_eq!(item.groups, [1, 1, 2, 2]);
        assert!(item.note.contains("2 of 2 groups needed"), "{}", item.note);
    }

    #[test]
    fn two_different_shares_with_one_number_are_a_conflict_and_a_copy_counts_once() {
        let (one, other) = (two_of_three(0), two_of_three(1));
        assert_eq!(one[0].info().identifier, other[0].info().identifier);
        let copied = readable(of_qr(&[
            ("a.png", &one[0]),
            ("b.png", &one[0]),
            ("c.png", &one[1]),
        ]));
        assert_eq!(copied.members, [1, 2]);
        let items = of_qr(&[("a.png", &one[0]), ("b.png", &other[0]), ("c.png", &one[1])]);
        let trouble = items[0].trouble.as_deref().unwrap_or_default();
        assert_eq!(trouble, "different shares with the same number: 1");
    }

    // AUD-008-FUN003: a damaged share beyond the threshold is told, and the set is read.
    #[test]
    fn a_damaged_share_beyond_the_threshold_leaves_the_set_readable() {
        let all = two_of_three(0);
        let mut damaged = page_of(&all[2]);
        let mut other = page_of(&all[2]);
        // Two files print different codes under the same card number.
        other.codes[0].1 = SecretText::copy_of("a card", "FFFF");
        damaged.codes.truncate(2);
        let item = readable(of_cards(vec![
            vec![page_of(&all[0])],
            vec![page_of(&all[1])],
            vec![damaged],
            vec![other],
        ]));
        assert_eq!(item.members, [1, 2]);
        let warning = item.warning.as_deref().unwrap_or_default();
        assert!(
            warning.starts_with("1 damaged, not needed: card 01"),
            "{warning}"
        );
        // With one share left whole, the damage is the trouble.
        let mut bad = page_of(&all[2]);
        bad.codes[0].1 = SecretText::copy_of("a card", "FFFF");
        let items = of_cards(vec![vec![page_of(&all[0])], vec![page_of(&all[2]), bad]]);
        let trouble = items[0].trouble.as_deref().unwrap_or_default();
        assert!(
            trouble.starts_with("1 share, 2 needed; card 01"),
            "{trouble}"
        );
    }

    // AUD-009-FUN001: a share of another set under a set's reference makes no set.
    #[test]
    fn a_share_of_another_set_under_its_reference_is_no_set() {
        let ours = two_of_three(0);
        let group = [Group {
            threshold: 2,
            count: 3,
        }];
        let theirs: Vec<Share> = split(&[0; 16], 1, &group, &mut Filled(9))
            .unwrap()
            .iter()
            .map(|payload| Share::of_payload(payload).unwrap())
            .collect();
        assert_ne!(ours[0].info().identifier, theirs[0].info().identifier);
        let mut labelled = page_of(&theirs[1]);
        labelled.share = page_of(&ours[1]).share;
        let items = of_cards(vec![vec![page_of(&ours[0])], vec![labelled]]);
        assert_eq!(items.len(), 1);
        let trouble = items[0].trouble.as_deref().unwrap_or_default();
        assert_eq!(trouble, "shares that do not belong to one set");
        // Their own cards under their own reference are a set of their own.
        let items = of_cards(vec![vec![page_of(&theirs[0])], vec![page_of(&theirs[1])]]);
        assert_eq!(readable(items).members, [1, 2]);
    }

    // AUD-009-FUN002: an extra share whose codes are in order but too few is damage, told.
    #[test]
    fn an_extra_share_cut_short_is_told() {
        let all = two_of_three(0);
        let mut short = page_of(&all[2]);
        short.codes.truncate(1);
        let item = readable(of_cards(vec![
            vec![page_of(&all[0])],
            vec![page_of(&all[1])],
            vec![short],
        ]));
        assert_eq!(item.members, [1, 2]);
        let warning = item.warning.as_deref().unwrap_or_default();
        assert_eq!(
            warning,
            "1 damaged, not needed: the codes of a share do not read"
        );
    }

    // AUD-008-SEC002: a file's name is shown, never obeyed by the terminal.
    #[test]
    fn a_control_character_in_a_file_name_is_not_passed_on() {
        let root = Path::new("/backups");
        let file = PathBuf::from("/backups/a\u{1b}[2Jb.png");
        let place = place_of(&[file], root).unwrap_or_default();
        assert!(!place.contains('\u{1b}'), "{place:?}");
        assert!(
            place.starts_with('a') && place.ends_with("b.png"),
            "{place:?}"
        );
    }
}
