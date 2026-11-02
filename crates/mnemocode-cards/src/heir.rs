//! The sheet that tells heirs how to restore a backup (MnemoCode TS 0.1.0's `export/heir-sheet.ts`
//! and `heir-sheet-text.ts`, CAP-CARDS-HEIR-SHEET-PDF, CAP-CARDS-HEIR-SHEET-TEXT): one sheet, printed
//! on both sides. The front says what the owner leaves and gives the rest of its room to a hint
//! written by hand; the back gives the steps and the basics for someone new to wallets. It never
//! names anything that would help whoever finds it: no codes, no dates, no fingerprint and no
//! places where shares are kept, and it prints at most one address, the route's.

use std::fmt;

use mnemocode::bip39::sizes::{SizesError, check_word_count};
use mnemocode::forms::Form;
use mnemocode::modes::{DateWords, Mode, ModeError};
use mnemocode::refusal::Refusal;
#[cfg(feature = "sskr")]
use mnemocode::sskr::forms::ShareFormat;
#[cfg(feature = "sskr")]
use mnemocode::sskr::set::is_recorded_quorum;
#[cfg(feature = "sskr")]
use mnemocode::sskr::share::MAX_GROUP_MEMBERS;
use mnemocode::text::words::list_in_words;

use crate::scene::{MM, Page, Rgb, Step, UiFont, rgb};
use crate::settings::{Orientation, PageSize};

/// The PDF that the sheet for heirs is saved in by default.
pub const HEIR_SHEET_FILE: &str = "mnemocode-heirs.pdf";
/// Line height as a multiple of the font size; dense, as on a printed leaflet.
const LEADING: f64 = 1.22;
/// Space between a heading and its text, and after the paragraphs of the back.
const SMALL_GAP: f64 = 0.8 * MM;
/// Indent of a list item's text, as a multiple of the font size: room for "5." and a space.
const ITEM_INDENT: f64 = 1.5;
/// Fewer ruled lines than this leave no real room for a hint.
const MIN_HINT_LINES: usize = 4;
/// The fewest shares that restore anything, as a sheet names a threshold.
#[cfg(feature = "sskr")]
const MIN_RECORDED_THRESHOLD: usize = 1;
const INK: Rgb = rgb(0.1, 0.1, 0.1);
const MUTED: Rgb = rgb(0.4, 0.4, 0.4);
const RULE: Rgb = rgb(0.7, 0.7, 0.7);
/// How the color forms look, the same for codes and for shares.
const COLORS_LOOK: &str = "color codes such as #1EAB91, on paper or on printed cards";
const COLOR_CODES_LOOK: &str = "codes of digits and letters A to F that stand for colors";
/// The last step, whatever the program.
const OPEN_WALLET: &str = "Open the wallet with this seed phrase in a wallet program (see below).";
/// What printed cards end with: decoys, which the sheet tells apart by their count.
const DECOYS_AFTER: &str = "the cards after them belong to nothing";
/// The title of the back of the sheet, which the front points to.
const STEPS_TITLE: &str = "Steps";
/// The title of the part for newcomers, which the front points to.
const BASICS_TITLE: &str = "The basics";
const SEED_PHRASE_BASICS: &str = "Cryptocurrency is recorded on a public ledger, not at a bank. Whoever knows the seed phrase of a wallet, 12 to 24 English words from the BIP39 list, can spend what it holds; any BIP39 wallet program opens it.";
const MASK_BASICS_START: &str = "The owner masked the words with secret dates, such as birthdays: their year, month and day shift the words along the BIP39 list (with 23-09-2026, \"abandon\" becomes \"wool\"). Use the owner's dates to undo the shift.";
const MASK_BASICS_END: &str = "The dates have nothing to do with today's date.";
const WALLET_BASICS: &str = "Install a well-known wallet program from its own website, choose \"Restore\" (not \"Create\") and type the seed phrase. Wallet empty? Check the dates, try the program the owner used, or look for a BIP39 passphrase, an extra word that MnemoCode does not keep. Then move everything to a new wallet of your own.";
const SCAM_BASICS: &str = "Nobody honest asks for a seed phrase; whoever has it can take everything for good. For help, ask someone you trust to sit beside you, and keep the words in your own hands.";

/// What a sheet refuses.
#[derive(Debug)]
pub enum HeirError {
    /// A hint of the dates too long for the front of a sheet.
    NoRoomForHint,
    /// A back of a sheet that does not fit on its page.
    BackOverflows,
    /// A size that is no size of a sheet.
    Size,
    /// A character that the font lacks.
    UnknownCharacter,
    /// A word wider than the page, which no line break can split.
    WordWiderThanPage,
    /// A threshold above the shares of a set.
    Quorum,
    /// Codes of shares that do not fit a sheet.
    Codes,
    /// A count of dates that is no whole number.
    Dates,
    /// An address that does not fit a sheet.
    Address,
    /// What the mode refuses.
    Mode(ModeError),
    /// A word count.
    Sizes(SizesError),
}

impl fmt::Display for HeirError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoRoomForHint => {
                f.write_str("The instructions for heirs leave no room for a hint on the front.")
            }
            Self::BackOverflows => {
                f.write_str("The steps and the basics for heirs do not fit on the back.")
            }
            Self::Size => write!(
                f,
                "The size of the instructions for heirs must be {}.",
                list_in_words(&HeirSheetSize::ALL.map(HeirSheetSize::name), "or")
            ),
            Self::UnknownCharacter => f.write_str(
                "The instructions for heirs contain a character not supported by the font.",
            ),
            Self::WordWiderThanPage => {
                f.write_str("The instructions for heirs contain a word wider than the page.")
            }
            #[cfg(feature = "sskr")]
            Self::Quorum => write!(
                f,
                "A sheet for heirs needs a threshold from {MIN_RECORDED_THRESHOLD} to the number of shares, and at most {MAX_GROUP_MEMBERS} shares."
            ),
            #[cfg(not(feature = "sskr"))]
            Self::Quorum => Ok(()),
            Self::Codes => {
                f.write_str("A sheet for heirs needs a whole number of codes for each share.")
            }
            Self::Dates => f.write_str("A sheet for heirs needs a whole number of dates."),
            Self::Address => {
                f.write_str("The sheet for heirs may print the route's address once and no other.")
            }
            Self::Mode(error) => error.fmt(f),
            Self::Sizes(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for HeirError {}

impl Refusal for HeirError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoRoomForHint => {
                "export.heir-sheet.instructions-heirs-leave-no-room-hint-on-front"
            }
            Self::BackOverflows => "export.heir-sheet.steps-basics-heirs-do-not-fit-on-back",
            Self::Size => "export.heir-sheet.size-instructions-heirs",
            Self::UnknownCharacter => {
                "export.heir-sheet.instructions-heirs-contain-character-not-supported-by-font"
            }
            Self::WordWiderThanPage => "export.heir-sheet.instructions-heirs-word-wider-than-page",
            Self::Quorum => {
                "export.heir-sheet-text.sheet-heirs-threshold-from-number-shares-at-most"
            }
            Self::Codes => "export.heir-sheet-text.sheet-heirs-whole-number-codes-each-share",
            Self::Dates => "export.heir-sheet-text.sheet-heirs-whole-number-dates",
            Self::Address => "export.heir-sheet-text.sheet-heirs-may-print-route-s-address-once",
            Self::Mode(error) => error.code(),
            Self::Sizes(error) => error.code(),
        }
    }
}

impl From<ModeError> for HeirError {
    fn from(error: ModeError) -> Self {
        Self::Mode(error)
    }
}

impl From<SizesError> for HeirError {
    fn from(error: SizesError) -> Self {
        Self::Sizes(error)
    }
}

/// A part of the back: a heading and its paragraphs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeirSheetSection {
    /// The heading of the part.
    pub heading: String,
    /// Its paragraphs, each wrapped at spaces to the width of the page.
    pub paragraphs: Vec<String>,
}

/// The words of the sheet, in the order they are printed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeirSheetText {
    /// The title of the front.
    pub title: String,
    /// The line under the title that names the program that made the sheet.
    pub subtitle: String,
    /// The line that sends someone new to wallets to the basics on the back first.
    pub newcomer: String,
    /// The heading of what the heirs need.
    pub needs_heading: String,
    /// What the heirs need, one item each, printed after a dash.
    pub needs: Vec<String>,
    /// The heading of the owner's hint.
    pub hint_heading: String,
    /// The note under the hint's heading; ruled lines follow it.
    pub hint_note: String,
    /// The title of the back.
    pub steps_title: String,
    /// The steps of the back, each printed after its number, from 1.
    pub steps: Vec<String>,
    /// The heading of what to do when a step does not work.
    pub trouble_heading: String,
    /// The paragraph of what to do when a step does not work.
    pub trouble: String,
    /// The warning never to type the backup into a website.
    pub warning: String,
    /// What the sheet is, for whoever keeps it; printed under the title.
    pub footer: String,
    /// The title of the basics.
    pub basics_title: String,
    /// The parts of the basics.
    pub basics: Vec<HeirSheetSection>,
}

/// A size of the sheet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeirSheetSize {
    /// The size of a notebook, with larger print; the default.
    A5,
    /// The size of a postcard and of the cards.
    A6,
}

/// A page size with the type sizes, in points, and the spacing that suit it.
#[derive(Clone, Copy, Debug)]
struct HeirSheetFormat {
    width: f64,
    height: f64,
    margin: f64,
    title: f64,
    heading: f64,
    body: f64,
    small: f64,
    gap: f64,
    ruling: f64,
}

impl HeirSheetSize {
    /// The sizes, by the names a host takes them by.
    pub const ALL: [Self; 2] = [Self::A5, Self::A6];

    /// Its name.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::A5 => "a5",
            Self::A6 => "a6",
        }
    }

    /// The size that `value` names, the default without it; refuses a name of no size.
    pub fn parse(value: Option<&str>) -> Result<Self, HeirError> {
        let Some(value) = value else {
            return Ok(Self::A5);
        };
        Self::ALL
            .into_iter()
            .find(|size| size.name() == value)
            .ok_or(HeirError::Size)
    }

    /// The paper upright, in millimetres.
    fn millimetres(self) -> (f64, f64) {
        let size = match self {
            Self::A5 => PageSize::A5,
            Self::A6 => PageSize::A6,
        };
        size.dimensions(Some(Orientation::Portrait))
    }

    /// The size in the words of the menu and the help, such as "148 x 210 mm".
    #[must_use]
    pub fn label(self) -> String {
        let (width, height) = self.millimetres();
        format!("{width} x {height} mm")
    }

    fn format(self) -> HeirSheetFormat {
        let (width, height) = self.millimetres();
        match self {
            Self::A5 => HeirSheetFormat {
                width: width * MM,
                height: height * MM,
                margin: 10.0 * MM,
                title: 14.0,
                heading: 10.5,
                body: 9.0,
                small: 7.5,
                gap: 3.5 * MM,
                ruling: 7.0 * MM,
            },
            Self::A6 => HeirSheetFormat {
                width: width * MM,
                height: height * MM,
                margin: 5.0 * MM,
                title: 10.5,
                heading: 7.5,
                body: 6.7,
                small: 6.0,
                gap: 2.0 * MM,
                ruling: 6.0 * MM,
            },
        }
    }
}

/// Splits `text` into lines no wider than `width` at `size`; words are never broken.
fn wrap(text: &str, font: &UiFont, size: f64, width: f64) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in text.split(' ') {
        let candidate = if line.is_empty() {
            word.to_owned()
        } else {
            format!("{line} {word}")
        };
        if !line.is_empty() && font.width(&candidate, size) > width {
            lines.push(std::mem::replace(&mut line, word.to_owned()));
        } else {
            line = candidate;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// Writes one page from the top down; `y` is the baseline of the last line written. Without a page
/// it only measures.
struct Writer<'a> {
    y: f64,
    page: Option<&'a mut Page>,
    font: &'a UiFont,
    format: HeirSheetFormat,
}

impl<'a> Writer<'a> {
    fn new(page: Option<&'a mut Page>, font: &'a UiFont, format: HeirSheetFormat) -> Self {
        Self {
            y: format.height - format.margin,
            page,
            font,
            format,
        }
    }

    /// The room left above the bottom margin.
    const fn room(&self) -> f64 {
        self.y - self.format.margin
    }

    /// Draws `text` at `x` on the baseline.
    fn draw(&mut self, text: &str, x: f64, size: f64, color: Rgb) {
        let (y, font) = (self.y, self.font);
        if let Some(page) = &mut self.page {
            page.steps.push(Step::Text {
                glyphs: font.glyphs(text),
                text: text.to_owned(),
                x,
                y,
                size,
                color,
            });
        }
    }

    /// Writes `text`, wrapped, after `marker` if given; refuses a character that the font does not
    /// have before it draws it, as a host's route may write one.
    fn paragraph(
        &mut self,
        text: &str,
        size: f64,
        (color, indent, marker): (Rgb, f64, Option<&str>),
    ) -> Result<(), HeirError> {
        if !self.font.has_every_character(text) {
            return Err(HeirError::UnknownCharacter);
        }
        let width = self.format.width - 2.0 * self.format.margin - indent;
        // A host's word, such as a long subtitle without a space, would run off the page
        // (AUD-039-UI001).
        if text
            .split(' ')
            .any(|word| self.font.width(word, size) > width)
        {
            return Err(HeirError::WordWiderThanPage);
        }
        let x = self.format.margin;
        for (index, line) in wrap(text, self.font, size, width).iter().enumerate() {
            self.y -= size * LEADING;
            if let (0, Some(marker)) = (index, marker) {
                self.draw(marker, x, size, color);
            }
            self.draw(line, x + indent, size, color);
        }
        Ok(())
    }

    /// A paragraph of plain ink.
    fn plain(&mut self, text: &str, size: f64) -> Result<(), HeirError> {
        self.paragraph(text, size, (INK, 0.0, None))
    }

    /// A paragraph of muted ink.
    fn muted(&mut self, text: &str, size: f64) -> Result<(), HeirError> {
        self.paragraph(text, size, (MUTED, 0.0, None))
    }

    fn gap(&mut self) {
        self.y -= self.format.gap;
    }

    fn heading(&mut self, text: &str) -> Result<(), HeirError> {
        self.gap();
        self.plain(text, self.format.heading)?;
        self.y -= SMALL_GAP;
        Ok(())
    }

    fn ruled_lines(&mut self, count: usize) {
        for _ in 0..count {
            self.y -= self.format.ruling;
            let (y, left, right) = (
                self.y,
                self.format.margin,
                self.format.width - self.format.margin,
            );
            if let Some(page) = &mut self.page {
                page.line((left, y), (right, y), RULE, 0.5, 1.0);
            }
        }
    }
}

/// The front: what the owner leaves, the hint being one block of ruled lines to the foot.
fn write_front(
    writer: &mut Writer<'_>,
    text: &HeirSheetText,
    format: &HeirSheetFormat,
    hint_lines: usize,
) -> Result<(), HeirError> {
    writer.plain(&text.title, format.title)?;
    writer.muted(&text.subtitle, format.small)?;
    writer.muted(&text.footer, format.small)?;
    writer.plain(&text.newcomer, format.body)?;
    writer.heading(&text.needs_heading)?;
    for need in &text.needs {
        let item = (INK, ITEM_INDENT * format.body, Some("-"));
        writer.paragraph(need, format.body, item)?;
    }
    writer.heading(&text.hint_heading)?;
    writer.muted(&text.hint_note, format.small)?;
    writer.ruled_lines(hint_lines);
    Ok(())
}

/// How many ruled lines fill the room that the front leaves, measured by writing it once without
/// drawing it.
fn hint_lines_for(
    font: &UiFont,
    text: &HeirSheetText,
    format: &HeirSheetFormat,
) -> Result<usize, HeirError> {
    let mut trial = Writer::new(None, font, *format);
    write_front(&mut trial, text, format, 0)?;
    let lines = libm::floor(trial.room() / format.ruling).max(0.0) as usize;
    if lines < MIN_HINT_LINES {
        return Err(HeirError::NoRoomForHint);
    }
    Ok(lines)
}

/// The back: what to do, the steps first and then the basics.
fn write_back(
    writer: &mut Writer<'_>,
    text: &HeirSheetText,
    format: &HeirSheetFormat,
) -> Result<(), HeirError> {
    writer.plain(&text.steps_title, format.title)?;
    for (index, step) in text.steps.iter().enumerate() {
        let marker = format!("{}.", index + 1);
        let item = (INK, ITEM_INDENT * format.body, Some(marker.as_str()));
        writer.paragraph(step, format.body, item)?;
    }
    writer.heading(&text.trouble_heading)?;
    writer.plain(&text.trouble, format.body)?;
    writer.gap();
    writer.plain(&text.warning, format.heading)?;
    writer.gap();
    writer.plain(&text.basics_title, format.title)?;
    for section in &text.basics {
        writer.heading(&section.heading)?;
        for paragraph in &section.paragraphs {
            writer.plain(paragraph, format.body)?;
            writer.y -= SMALL_GAP;
        }
    }
    if writer.room() < 0.0 {
        return Err(HeirError::BackOverflows);
    }
    Ok(())
}

/// Draws the sheet for heirs of `text` in `size`, its front and its back.
pub fn render_heir_sheet(
    font: &UiFont,
    text: &HeirSheetText,
    size: HeirSheetSize,
) -> Result<Vec<Page>, HeirError> {
    let format = size.format();
    let (width, height) = size.millimetres();
    let hint_lines = hint_lines_for(font, text, &format)?;
    let (mut front, mut back) = (Page::new(width, height), Page::new(width, height));
    write_front(
        &mut Writer::new(Some(&mut front), font, format),
        text,
        &format,
        hint_lines,
    )?;
    write_back(
        &mut Writer::new(Some(&mut back), font, format),
        text,
        &format,
    )?;
    Ok(vec![front, back])
}

/// What was made: the seed phrase of `words` words in one encoded form, or Shamir shares of it,
/// each of `codes` codes on its cards where its form has cards.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeirBackup {
    /// The seed phrase in one encoded form.
    Encoded {
        /// The form that the codes are written in.
        form: Form,
        /// How many words the seed phrase has.
        words: usize,
    },
    /// Shamir shares of the seed phrase.
    #[cfg(feature = "sskr")]
    Shares {
        /// The form that the shares are written in.
        format: ShareFormat,
        /// How many of the shares restore the seed phrase.
        threshold: usize,
        /// How many shares were made.
        count: usize,
        /// The codes of one share on its cards, before the decoys.
        codes: Option<usize>,
    },
}

/// What the sheet for heirs says of a backup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeirSheetFacts {
    /// The backup that the sheet names.
    pub backup: HeirBackup,
    /// How the seed phrase was masked.
    pub mode: Mode,
    /// How many dates mask the seed phrase.
    pub dates: usize,
}

/// The way through one program from a computer one trusts to the seed phrase on its screen.
pub trait HeirRoute {
    /// The line under the title: which program made the sheet.
    fn subtitle(&self) -> String;
    /// The one web address that the sheet prints, once, in the `start` steps.
    fn address(&self) -> String;
    /// The steps that get the program and start it offline.
    fn start(&self) -> Vec<String>;
    /// The steps that open the restore of an encoded backup and type it, then `dates`.
    fn decode(&self, mode: Mode, words: usize, dates: Option<&str>) -> Vec<String>;
    /// The steps that open the restore from shares and type `threshold` of them, then `dates`.
    fn restore(&self, mode: Mode, threshold: usize, dates: Option<&str>) -> Vec<String>;
    /// What to do when a digit of a date cannot be read.
    fn date_digit_help(&self) -> Option<String>;
}

/// How each encoded form looks, so that an heir recognises the backup.
fn encoded_look(form: Form) -> String {
    match form {
        Form::English => "English words that look like a seed phrase but are masked".to_owned(),
        Form::Indexes => "numbers from 1 to 2048, one per word".to_owned(),
        Form::Unicode => "codes of four digits and letters A to F, one per word".to_owned(),
        Form::Colors => COLORS_LOOK.to_owned(),
        Form::ColorsUnicode => COLOR_CODES_LOOK.to_owned(),
    }
}

/// How each share format looks.
#[cfg(feature = "sskr")]
const fn share_look(format: ShareFormat) -> &'static str {
    match format {
        ShareFormat::Words => "words such as tuna next keep gyro",
        ShareFormat::Ur => "codes that start with ur:sskr/",
        ShareFormat::Indexes => "numbers from 1 to 2048",
        ShareFormat::Unicode => "codes of four digits and letters A to F",
        ShareFormat::Colors => COLORS_LOOK,
        ShareFormat::ColorsUnicode => COLOR_CODES_LOOK,
    }
}

/// What the sheet says of one backup.
struct BackupWords {
    /// The lines of "What you need" that name the backup, before the dates.
    needs: Vec<String>,
    /// Whether it needs no program at all: the seed phrase itself in English words.
    plain_phrase: bool,
    /// The advice for a step that fails that only this kind of backup needs.
    trouble: Vec<String>,
}

/// What the sheet says of `backup`, made in `mode`, once its rules have checked it.
fn backup_words(backup: HeirBackup, mode: Mode) -> Result<BackupWords, HeirError> {
    match backup {
        HeirBackup::Encoded { form, words } => {
            check_word_count(words)?;
            if form.written_in_words() && !mode.masked() {
                return Ok(BackupWords {
                    needs: vec![format!(
                        "The seed phrase itself: {words} English words, not masked."
                    )],
                    plain_phrase: true,
                    trouble: Vec::new(),
                });
            }
            let count = format!("The seed phrase has {words} words.");
            let printed = if form.has_cards() {
                format!(
                    "{count} On printed cards its backup is the first {} codes; {DECOYS_AFTER}.",
                    form.element_count(words)
                )
            } else {
                count
            };
            Ok(BackupWords {
                needs: vec![format!("The backup: {}.", encoded_look(form)), printed],
                plain_phrase: false,
                trouble: Vec::new(),
            })
        }
        #[cfg(feature = "sskr")]
        HeirBackup::Shares {
            format,
            threshold,
            count,
            codes,
        } => {
            if !is_recorded_quorum(threshold, count) {
                return Err(HeirError::Quorum);
            }
            if codes == Some(0) {
                return Err(HeirError::Codes);
            }
            mode.check_split()?;
            let mut needs = vec![format!(
                "Any {threshold} of the {count} Shamir shares, written as {}.",
                share_look(format)
            )];
            if let (Some(codes), true) = (codes, format.has_cards()) {
                needs.push(format!(
                    "On printed cards each share is the first {codes} codes; {DECOYS_AFTER}."
                ));
            }
            Ok(BackupWords {
                needs,
                plain_phrase: false,
                // Unreadable elements of a share are filled in from its checksum.
                trouble: vec!["Type ? for each code you cannot read.".to_owned()],
            })
        }
    }
}

/// `address` where it stands whole, removed from `sheet`, and how often it stood.
fn without_address(sheet: &str, address: &str) -> (String, usize) {
    if address.is_empty() {
        return (sheet.to_owned(), 0);
    }
    let mut rest = String::new();
    let mut printed = 0;
    let mut from = 0;
    while let Some(at) = sheet[from..].find(address) {
        let start = from + at;
        let end = start + address.len();
        let after = sheet[end..].chars().next();
        let then = sheet[end..].chars().nth(1);
        let ends_sentence = |next: Option<char>| next.is_none_or(char::is_whitespace);
        let whole = match after {
            None => true,
            Some(next) if next.is_whitespace() || matches!(next, ',' | '"') => true,
            Some('.' | ';' | ':' | '!' | '?' | ')') => ends_sentence(then),
            Some(_) => false,
        };
        rest.push_str(&sheet[from..start]);
        if whole {
            printed += 1;
            rest.push(' ');
        } else {
            rest.push_str(address);
        }
        from = end;
    }
    rest.push_str(&sheet[from..]);
    (rest, printed)
}

/// Whether byte `at` of `text` starts a word.
fn starts_word(text: &[u8], at: usize) -> bool {
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    word(text[at]) && (at == 0 || !word(text[at - 1]))
}

/// Whether a host name with a domain ending starts at `at`, such as example.org.
fn host_at(text: &[u8], at: usize) -> bool {
    let label = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-';
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    let mut place = at;
    loop {
        let start = place;
        while place < text.len() && label(text[place]) {
            place += 1;
        }
        while place > start && text[place - 1] == b'-' {
            place -= 1;
        }
        if place == start || text.get(place) != Some(&b'.') {
            return false;
        }
        let ending = place + 1;
        let mut end = ending;
        while end < text.len() && text[end].is_ascii_lowercase() {
            end += 1;
        }
        if end - ending >= 2 && text.get(end).is_none_or(|byte| !word(*byte)) {
            return true;
        }
        place = ending;
    }
}

/// Whether `text` holds a web address: with http:// or https://, with www., or a host name with a
/// domain ending, with or without a path.
fn holds_web_address(text: &str) -> bool {
    let bytes = text.as_bytes();
    (0..bytes.len()).any(|at| {
        if !starts_word(bytes, at) {
            return false;
        }
        let linked = [&b"http://"[..], b"https://", b"www."].iter().any(|start| {
            bytes[at..]
                .strip_prefix(*start)
                .and_then(<[u8]>::first)
                .is_some_and(|next| !next.is_ascii_whitespace() && !matches!(next, b',' | b'"'))
        });
        linked || host_at(bytes, at)
    })
}

/// Every line of `text`, in the order it is printed.
fn lines_of(text: &HeirSheetText) -> Vec<&str> {
    let mut lines = vec![
        text.title.as_str(),
        &text.subtitle,
        &text.footer,
        &text.newcomer,
        &text.needs_heading,
    ];
    lines.extend(text.needs.iter().map(String::as_str));
    lines.extend([
        text.hint_heading.as_str(),
        &text.hint_note,
        &text.steps_title,
    ]);
    lines.extend(text.steps.iter().map(String::as_str));
    lines.extend([
        text.trouble_heading.as_str(),
        &text.trouble,
        &text.warning,
        &text.basics_title,
    ]);
    for section in &text.basics {
        lines.push(&section.heading);
        lines.extend(section.paragraphs.iter().map(String::as_str));
    }
    lines
}

/// The back's basics for someone who has never used a wallet.
fn basics(mode: Mode) -> Vec<HeirSheetSection> {
    let section = |heading: &str, paragraph: String| HeirSheetSection {
        heading: heading.to_owned(),
        paragraphs: vec![paragraph],
    };
    let mut sections = vec![section("Seed phrase", SEED_PHRASE_BASICS.to_owned())];
    if mode.masked() {
        sections.push(section(
            "Secret dates",
            format!(
                "{MASK_BASICS_START} {} {MASK_BASICS_END}",
                mode.wrong_date_warning().unwrap_or_default()
            ),
        ));
    }
    sections.push(section("Opening the wallet", WALLET_BASICS.to_owned()));
    sections.push(section("Scams", SCAM_BASICS.to_owned()));
    sections
}

/// The note under the hint's heading.
fn hint_note(facts: &HeirSheetFacts) -> String {
    if !facts.mode.masked() {
        return "Write by hand what only your heirs will understand, such as a clue to a BIP39 passphrase if you used one.".to_owned();
    }
    let one = facts.dates == 1;
    let what = if one { "the date" } else { "the dates" };
    let example = if one {
        "\"the day we met\""
    } else {
        "\"the day we met and our son's birthday\""
    };
    let never = if one {
        "Never the date itself."
    } else {
        "Never the dates themselves."
    };
    format!(
        "Write by hand a clue to {what} that only your heirs will understand, such as {example}. {never}"
    )
}

/// The words of the sheet for `facts` through `route`. Refuses facts that would print a wrong
/// sheet, and words of the route that would print its address twice, or another address.
pub fn heir_sheet_text(
    route: &dyn HeirRoute,
    facts: &HeirSheetFacts,
) -> Result<HeirSheetText, HeirError> {
    let &HeirSheetFacts {
        backup,
        mode,
        dates,
    } = facts;
    mode.check_heir_sheet()?;
    let words = backup_words(backup, mode)?;
    mode.check_date_count(dates, false, DateWords::Codes)?;
    let masked = mode.masked();
    let typed_dates = masked.then(|| {
        let noun = if dates == 1 { "date" } else { "dates" };
        format!("the secret {noun} as day-month-year (23-09-2026)")
    });
    let mut steps = Vec::new();
    if !words.plain_phrase {
        steps.extend(route.start());
        match backup {
            HeirBackup::Encoded { words, .. } => {
                steps.extend(route.decode(mode, words, typed_dates.as_deref()));
            }
            #[cfg(feature = "sskr")]
            HeirBackup::Shares { threshold, .. } => {
                steps.extend(route.restore(mode, threshold, typed_dates.as_deref()));
            }
        }
    }
    steps.push(OPEN_WALLET.to_owned());
    let mut needs = words.needs;
    needs.push(match (masked, dates) {
        (false, _) => "No secret dates are needed.".to_owned(),
        (true, 1) => "The owner's secret date (see the back). It is written nowhere; the hint may lead to it.".to_owned(),
        (true, count) => format!(
            "The owner's {count} secret dates (see the back). They are written nowhere; the hint may lead to them."
        ),
    });
    let mut trouble = vec![
        "An error usually means a mistyped code or word: check each one against the paper."
            .to_owned(),
    ];
    trouble.extend(words.trouble);
    if masked {
        trouble.extend(route.date_digit_help());
    }
    let text = HeirSheetText {
        title: "How to restore this wallet backup".to_owned(),
        subtitle: route.subtitle(),
        newcomer: format!(
            "The {} are on the back. New to wallets? Read \"{BASICS_TITLE}\" there first.",
            STEPS_TITLE.to_lowercase()
        ),
        needs_heading: "What you need".to_owned(),
        needs,
        hint_heading: "Hint from the owner".to_owned(),
        hint_note: hint_note(facts),
        steps_title: STEPS_TITLE.to_owned(),
        steps,
        trouble_heading: "If something goes wrong".to_owned(),
        trouble: trouble.join(" "),
        warning: format!(
            "Never type the backup{} or the seed phrase into a website or send them to anyone.",
            if masked { ", the dates" } else { "" }
        ),
        footer: "This sheet holds no secret. Keep it apart from the backup.".to_owned(),
        basics_title: BASICS_TITLE.to_owned(),
        basics: basics(mode),
    };
    // The route's own address, counted where it stands whole, then any other left beside it: a
    // longer address that starts with it, such as its releases page, is another address.
    let sheet = lines_of(&text).join("\n");
    let (rest, printed) = without_address(&sheet, &route.address());
    if printed > 1 || holds_web_address(&rest) {
        return Err(HeirError::Address);
    }
    Ok(text)
}
