//! What cards print (MnemoCode TS 0.1.0's `export/content-kinds.ts`, `card-content.ts`,
//! `card-codes.ts`, `card-decoys.ts`, `backup-cards.ts` and `sskr-content.ts`, CAP-CARDS-CONTENT):
//! the two kinds of cards, a seed phrase's and a share's, and what each decides; the codes of a set
//! of cards and the check that its QR code holds the backup they print; and the decoys after them,
//! random codes in full rows, of which only the sheet for heirs tells the count.

use std::fmt;

use mnemocode::backup::Backup;
use mnemocode::bip39::sizes::{
    DICTIONARY_SIZE, SizesError, WORD_COUNTS, check_word_count, check_word_indexes,
};
use mnemocode::bip39::table::unicode_code;
use mnemocode::forms::colors::{
    ColorsError, color_counts, colors_to_indexes, indexes_to_colors, is_rgb_reference,
    unicode_to_colors,
};
#[cfg(feature = "sskr")]
use mnemocode::forms::colors::{RGB_MAX_VALUE, rgb_hex};
use mnemocode::forms::{Form, FormError};
use mnemocode::random::{Random, RandomError};
use mnemocode::refusal::Refusal;
use mnemocode::text::space::{tokens, trim};

use crate::palette::{TooManyColours, code_colors};
use crate::settings::{CardSettings, PageSize, SHEET_SIZES_TEXT, SettingsError};
use crate::text_rules::{TextError, card_title};

/// The refusal of cards without any reference, which every family that checks gives.
pub const EMPTY_CARD_COLLECTION: &str = "The card collection is empty.";
/// The most decoys that a set of cards takes: more than any sheet needs to fill its last row.
pub const MAX_DECOYS: usize = 16;
/// Separate cards need no grid padding: one extra card follows all real codes.
const INDIVIDUAL_DECOYS: usize = 1;
/// The series of the cards and sheets of a seed phrase's colors, which has no set to name.
const PHRASE_SERIES: &str = "01";

/// What content refuses.
#[derive(Debug)]
pub enum ContentError {
    /// Labels that are not one code for each color.
    LabelsPerColor,
    /// A QR code that holds another backup than the cards print.
    QrMismatch,
    /// Decoy colors beside colors that are no whole phrase's.
    NoWholePhrase,
    /// A QR code on separate cards of a phrase.
    QrOnSheetOnly,
    /// A QR code on separate cards of a share.
    QrOnSheetOnlyLayout,
    /// No card at that number; the number from 1 and the count.
    NoCard(usize, usize),
    /// A count of decoys that is not below the cards.
    Decoys,
    /// Cards that have their decoys already.
    DecoysAlready,
    /// Fewer cards kept than the backup's own, or more than there are.
    KeptCards,
    /// A form that no card prints, by its name.
    NoCards(String),
    /// A layout of none.
    #[cfg(feature = "sskr")]
    Layout,
    /// A collection sheet of the business size.
    #[cfg(feature = "sskr")]
    LayoutBusiness,
    /// The settings of the cards.
    Settings(SettingsError),
    /// A text of the cards.
    Text(TextError),
    /// The colors of a phrase.
    Colors(ColorsError),
    /// The form of the codes.
    Form(FormError),
    /// A word count.
    Sizes(SizesError),
    /// A palette of more colours than a sheet holds.
    Palette(TooManyColours),
    /// The random source.
    Random(RandomError),
    /// A share that cannot be read.
    #[cfg(feature = "sskr")]
    Share(mnemocode::sskr::forms::ShareTextError),
}

impl fmt::Display for ContentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LabelsPerColor => {
                f.write_str("Cards that print codes print one code for each color, in order.")
            }
            Self::QrMismatch => f.write_str("Collection QR does not match the printed references."),
            Self::NoWholePhrase => f.write_str("Decoys are added to the colors of a whole phrase."),
            Self::QrOnSheetOnly => write!(
                f,
                "A QR code is printed on a sheet only. Choose the {SHEET_SIZES_TEXT} size for a QR code; separate cards never carry one."
            ),
            Self::QrOnSheetOnlyLayout => write!(
                f,
                "A QR code is printed on a sheet only. Choose the qr layout, or a collection sheet of the {SHEET_SIZES_TEXT} size, for a QR code; separate cards never carry one."
            ),
            Self::NoCard(number, count) => {
                write!(f, "There is no card {number}: the cards are 1 to {count}.")
            }
            Self::Decoys => {
                f.write_str("The decoy cards must be a whole number, fewer than the cards.")
            }
            Self::DecoysAlready => f.write_str("These cards have their decoys already."),
            Self::KeptCards => f.write_str("The cards kept must hold every code of the backup."),
            Self::NoCards(form) => write!(f, "No card prints codes written as {form}."),
            #[cfg(feature = "sskr")]
            Self::Layout => write!(
                f,
                "The card layout must be one of: {}.",
                SskrLayout::ALL.map(SskrLayout::name).join(", ")
            ),
            #[cfg(feature = "sskr")]
            Self::LayoutBusiness => write!(
                f,
                "The business page size gives separate cards. Choose the {SHEET_SIZES_TEXT} size for a collection sheet."
            ),
            Self::Settings(error) => error.fmt(f),
            Self::Text(error) => error.fmt(f),
            Self::Colors(error) => error.fmt(f),
            Self::Form(error) => error.fmt(f),
            Self::Sizes(error) => error.fmt(f),
            Self::Palette(error) => error.fmt(f),
            Self::Random(error) => error.fmt(f),
            #[cfg(feature = "sskr")]
            Self::Share(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ContentError {}

impl Refusal for ContentError {
    fn code(&self) -> &'static str {
        match self {
            Self::LabelsPerColor => {
                "export.card-content.cards-print-codes-print-one-code-each-color"
            }
            Self::QrMismatch => {
                "export.content-kinds.collection-qr-does-not-match-printed-references"
            }
            Self::NoWholePhrase => "export.content-kinds.decoys-added-colors-whole-phrase",
            Self::QrOnSheetOnly => "export.content-kinds.qr-code-printed-on-sheet-only-choose-size",
            Self::QrOnSheetOnlyLayout => {
                "export.sskr-content.qr-code-printed-on-sheet-only-choose-layout"
            }
            Self::NoCard(..) => "export.card-codes.there-no-card-cards-1",
            Self::Decoys => "export.card-decoys.decoy-cards-whole-number-fewer-than-cards",
            Self::DecoysAlready => "export.card-decoys.cards-their-decoys-already",
            Self::KeptCards => "export.card-decoys.cards-kept-hold-every-code-backup",
            Self::NoCards(_) => "export.backup-cards.no-card-prints-codes-written-as",
            #[cfg(feature = "sskr")]
            Self::Layout => "export.sskr-content.card-layout-one",
            #[cfg(feature = "sskr")]
            Self::LayoutBusiness => {
                "export.sskr-content.business-page-size-gives-separate-cards-choose-size"
            }
            Self::Settings(error) => error.code(),
            Self::Text(error) => error.code(),
            Self::Colors(error) => error.code(),
            Self::Form(error) => error.code(),
            Self::Sizes(error) => error.code(),
            Self::Palette(error) => error.code(),
            Self::Random(error) => error.code(),
            #[cfg(feature = "sskr")]
            Self::Share(error) => error.code(),
        }
    }
}

macro_rules! from_error {
    ($($error:ty => $variant:ident),+ $(,)?) => {
        $(impl From<$error> for ContentError {
            fn from(error: $error) -> Self {
                Self::$variant(error)
            }
        })+
    };
}

from_error!(
    SettingsError => Settings,
    TextError => Text,
    ColorsError => Colors,
    FormError => Form,
    SizesError => Sizes,
    TooManyColours => Palette,
    RandomError => Random,
);

#[cfg(feature = "sskr")]
impl From<mnemocode::sskr::forms::ShareTextError> for ContentError {
    fn from(error: mnemocode::sskr::forms::ShareTextError) -> Self {
        Self::Share(error)
    }
}

/// A kind of content of colour cards, which every family of cards asks instead of testing the kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentKind {
    /// A seed phrase's cards.
    Colors,
    /// A share's cards.
    #[cfg(feature = "sskr")]
    Sskr,
}

impl ContentKind {
    /// Refuses a QR code `payload` that holds another backup than the backup's own cards print:
    /// their `colors`, or, where the cards print `labels` in place of the colours, those codes.
    fn check_qr(
        self,
        colors: &[String],
        payload: &str,
        labels: Option<&[String]>,
    ) -> Result<(), ContentError> {
        match self {
            Self::Colors => check_phrase_qr(colors, payload, labels),
            #[cfg(feature = "sskr")]
            Self::Sskr => Ok(mnemocode::sskr::forms::check_share_qr(
                &colors.join(" "),
                payload,
                labels.map(|labels| labels.join(" ")).as_deref(),
            )?),
        }
    }

    /// A decoy colour beside the `own` colours of the backup: for a phrase a colour of a random
    /// phrase of as many colours, with an order tag and word positions like theirs; for a share a
    /// random one, as its colours look.
    fn decoy_color(self, random: &mut dyn Random, own: usize) -> Result<String, ContentError> {
        match self {
            Self::Colors => {
                let words = color_counts()
                    .iter()
                    .position(|count| *count == own)
                    .and_then(|place| WORD_COUNTS.get(place))
                    .ok_or(ContentError::NoWholePhrase)?;
                let mut indexes = Vec::with_capacity(*words);
                for _ in 0..*words {
                    indexes.push(random.below(DICTIONARY_SIZE as u32)? as u16);
                }
                let mut colors = indexes_to_colors(&indexes)?;
                let at = random.below(colors.len() as u32)? as usize;
                Ok(colors.swap_remove(at))
            }
            #[cfg(feature = "sskr")]
            Self::Sskr => Ok(rgb_hex(random.below(RGB_MAX_VALUE + 1)?)),
        }
    }

    /// Whether the sheet may hold a QR code of the whole backup, which only `qr_card` asks for.
    #[must_use]
    pub const fn whole_backup_qr(self) -> bool {
        !matches!(self, Self::Colors)
    }

    /// The reference line of a separate card that prints `code`, in the series `series`: a seed
    /// phrase has one series, which a separate card does not repeat.
    #[must_use]
    #[cfg_attr(
        not(feature = "sskr"),
        expect(unused_variables, reason = "only a share has a series")
    )]
    pub fn separate_reference(self, code: &str, series: &str) -> String {
        match self {
            Self::Colors => code.to_owned(),
            #[cfg(feature = "sskr")]
            Self::Sskr => format!("{code}  |  {series}"),
        }
    }
}

/// Whether `payload`, the text of a QR code, holds `colors`: written as the colors themselves, or
/// as Color Unicode codes that decode to them.
fn payload_holds_colors(colors: &[String], payload: &str) -> Result<bool, ColorsError> {
    let written = colors.join(" ");
    if payload == written {
        return Ok(true);
    }
    if trim(payload).is_empty() || tokens(payload).all(is_rgb_reference) {
        return Ok(false);
    }
    Ok(unicode_to_colors(payload)?.join(" ") == written)
}

/// Refuses a seed phrase's QR code that holds another phrase than its cards print.
fn check_phrase_qr(
    colors: &[String],
    payload: &str,
    labels: Option<&[String]>,
) -> Result<(), ContentError> {
    if let Some(labels) = labels {
        let indexes = Form::Unicode.read(&labels.join(" "))?;
        check_word_count(indexes.len())?;
        check_word_indexes(&indexes)?;
        if Form::Unicode.read(payload)? != indexes {
            return Err(ContentError::QrMismatch);
        }
        return Ok(());
    }
    colors_to_indexes(colors)?;
    if !payload_holds_colors(colors, payload)? {
        return Err(ContentError::QrMismatch);
    }
    Ok(())
}

/// The colours of cards, the codes they print in their place where those only decorate, and what
/// their QR code holds. A backup in text: its `Debug` tells nothing, and the zeroing allocator wipes
/// it when it is dropped.
#[derive(Clone)]
pub struct CardCodes {
    /// The color of each card as # and six hexadecimal digits: the backup's own, then the decoys.
    pub colors: Vec<String>,
    /// The codes printed in place of the colors, one per color.
    pub labels: Option<Vec<String>>,
    /// The text of the QR code: the backup alone, without the decoys.
    pub payload: String,
}

impl fmt::Debug for CardCodes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[CardCodes: redacted]")
    }
}

impl CardCodes {
    /// The code that the card of the element at `index` prints, without a #.
    #[must_use]
    pub fn printed(&self, index: usize) -> String {
        match &self.labels {
            Some(labels) => labels[index].clone(),
            None => self.colors[index][1..].to_uppercase(),
        }
    }

    /// The element at `index` as cards and sheets label it: its number, counted from 1, then `gap`
    /// and its printed code. No card names the count of the set: the cards end with decoys.
    #[must_use]
    pub fn numbered(&self, index: usize, gap: &str) -> String {
        format!("{}{gap}{}", two_digits(index + 1), self.printed(index))
    }
}

/// A count or a number as cards print it: at least two digits, "07".
#[must_use]
pub fn two_digits(number: usize) -> String {
    format!("{number:02}")
}

/// The file of page `index` of `count`, counted from 0, as every export names its pages: one page
/// has the name alone, several end in "-01", "-02" … ; `extension` without its point.
#[must_use]
pub fn page_file_name(base: &str, index: usize, count: usize, extension: &str) -> String {
    if count == 1 {
        format!("{base}.{extension}")
    } else {
        format!("{base}-{}.{extension}", two_digits(index + 1))
    }
}

/// The file name of separate card `index`, counted from 0: its number alone, never the code it
/// prints, which a folder listing would show.
#[must_use]
pub fn separate_card_name(index: usize) -> String {
    two_digits(index + 1)
}

/// The content of colour cards: the colours of a seed phrase, or a share's, or the Unicode codes of
/// either printed on cards whose colours decorate them; and the settings they are printed with.
#[derive(Clone, Debug)]
pub struct ColorCards {
    /// A seed phrase's cards or a share's, whose QR code is checked as such.
    pub kind: ContentKind,
    /// The codes.
    pub codes: CardCodes,
    /// How many of the last cards are decoys; none until a plan adds them.
    pub decoys: Option<usize>,
    /// The title of the sheet in place of the studio name.
    pub title: Option<String>,
    /// The share's reference, such as 376C-1-2: the series that its sheets name.
    pub reference: Option<String>,
    /// Whether its sheet carries a QR code of the whole share (the qr layout).
    pub qr_card: bool,
    /// The page, the profile and the texts of the cards.
    pub settings: CardSettings,
}

impl ColorCards {
    /// How many of the cards print the backup's own codes: all but the decoys after them. Refuses a
    /// count of decoys that is not below the number of cards.
    pub fn own(&self) -> Result<usize, ContentError> {
        let decoys = self.decoys.unwrap_or(0);
        if self.decoys.is_some() && decoys >= self.codes.colors.len() {
            return Err(ContentError::Decoys);
        }
        Ok(self.codes.colors.len() - decoys)
    }

    /// The series that a card or sheet names, from the reference of the content's set.
    #[must_use]
    pub fn series(&self) -> &str {
        self.reference.as_deref().unwrap_or(PHRASE_SERIES)
    }

    /// Refuses content whose QR code holds another backup than the cards print before their decoys,
    /// labels that are not one code for each color, and a title that a sheet refuses.
    pub fn check(&self) -> Result<(), ContentError> {
        if let Some(title) = &self.title {
            card_title(title)?;
        }
        let CardCodes {
            colors,
            labels,
            payload,
        } = &self.codes;
        if let Some(labels) = labels
            && (labels.len() != colors.len() || labels.iter().any(|label| trim(label).is_empty()))
        {
            return Err(ContentError::LabelsPerColor);
        }
        let own = self.own()?;
        let printed = labels.as_ref().map(|labels| &labels[..own]);
        self.kind.check_qr(&colors[..own], payload, printed)
    }

    /// Refuses a QR code on cards of the business size where the kind prints it on a sheet only.
    pub fn check_sheet_qr(&self) -> Result<(), ContentError> {
        if self.kind == ContentKind::Colors {
            check_phrase_sheet_qr(&self.settings)?;
        }
        Ok(())
    }

    /// Refuses a card `index`, counted from 0, that is not one of the cards.
    pub fn check_index(&self, index: usize) -> Result<(), ContentError> {
        let count = self.codes.colors.len();
        if index >= count {
            return Err(ContentError::NoCard(index + 1, count));
        }
        Ok(())
    }

    /// These cards with [`MAX_DECOYS`] decoys after their own codes, of which a plan keeps the first
    /// few: Unicode codes of words beside printed codes, else colours as the kind draws them. Cards
    /// that print codes take their colours again for every code, which keeps those of their own.
    pub fn with_decoy_pool(&self, random: &mut dyn Random) -> Result<Self, ContentError> {
        if self.decoys.unwrap_or(0) != 0 {
            return Err(ContentError::DecoysAlready);
        }
        let mut cards = self.clone();
        let own = self.codes.colors.len();
        if let Some(labels) = &mut cards.codes.labels {
            for _ in 0..MAX_DECOYS {
                labels.push(unicode_code(random.below(DICTIONARY_SIZE as u32)? as usize));
            }
            cards.codes.colors = code_colors(labels)?;
        } else {
            for _ in 0..MAX_DECOYS {
                let color = self.kind.decoy_color(random, own)?;
                cards.codes.colors.push(color);
            }
        }
        cards.decoys = Some(MAX_DECOYS);
        Ok(cards)
    }

    /// These cards with only their first `count`: their own codes and the decoys that fit.
    pub fn kept(&self, count: usize) -> Result<Self, ContentError> {
        let own = self.own()?;
        if count < own || count > self.codes.colors.len() {
            return Err(ContentError::KeptCards);
        }
        let mut cards = self.clone();
        cards.codes.colors.truncate(count);
        if let Some(labels) = &mut cards.codes.labels {
            labels.truncate(count);
        }
        cards.decoys = Some(count - own);
        Ok(cards)
    }

    /// Every real code and the first decoy of an existing plan or pool, without redrawing.
    pub fn kept_individual(&self) -> Result<Self, ContentError> {
        if self.decoys == Some(INDIVIDUAL_DECOYS) {
            self.own()?;
            return Ok(self.clone());
        }
        self.kept(self.own()? + INDIVIDUAL_DECOYS)
    }
}

/// Refuses a QR code on separate cards of a phrase, which print it on a sheet only.
pub fn check_phrase_sheet_qr(settings: &CardSettings) -> Result<(), ContentError> {
    if settings.page_size == Some(PageSize::Business) && settings.card_qr {
        return Err(ContentError::QrOnSheetOnly);
    }
    Ok(())
}

/// The content of the cards of `backup` with `settings`: its colours, or its Unicode codes in the
/// colours that decorate them, without decoys yet, and `title` as it is drawn. Refuses a form that
/// no card prints and a title that a sheet refuses.
pub fn backup_card_content(
    backup: &Backup,
    settings: CardSettings,
    title: Option<&str>,
) -> Result<ColorCards, ContentError> {
    let form = backup.form();
    let (colors, labels) = match form {
        Form::Unicode => {
            let codes: Vec<String> = backup
                .indexes()
                .iter()
                .map(|index| unicode_code(usize::from(*index)))
                .collect();
            (code_colors(&codes)?, Some(codes))
        }
        Form::Colors | Form::ColorsUnicode => (indexes_to_colors(backup.indexes())?, None),
        Form::English | Form::Indexes => {
            return Err(ContentError::NoCards(form.name().to_owned()));
        }
    };
    let payload = backup
        .text()
        .map_err(|_| ContentError::NoCards(form.name().to_owned()))?
        .as_str()
        .to_owned();
    Ok(ColorCards {
        kind: ContentKind::Colors,
        codes: CardCodes {
            colors,
            labels,
            payload,
        },
        decoys: None,
        title: title.map(card_title).transpose()?,
        reference: None,
        qr_card: false,
        settings,
    })
}

/// A layout of share cards.
#[cfg(feature = "sskr")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SskrLayout {
    /// A QR card holds one whole share and is available in every size.
    Qr,
    /// One sheet for each share.
    Collection,
    /// Each card of a share is a document of its own, without a QR code.
    Individual,
}

#[cfg(feature = "sskr")]
impl SskrLayout {
    /// The layouts that a caller may ask for.
    pub const ALL: [Self; 3] = [Self::Qr, Self::Collection, Self::Individual];

    /// The layout's name.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Qr => "qr",
            Self::Collection => "collection",
            Self::Individual => "individual",
        }
    }

    /// The layout that `value` names, none where none is given, for the page size to decide.
    pub fn parse(value: Option<&str>) -> Result<Option<Self>, ContentError> {
        value
            .map(|value| {
                Self::ALL
                    .into_iter()
                    .find(|layout| layout.name() == value)
                    .ok_or(ContentError::Layout)
            })
            .transpose()
    }

    /// Whether each card of a share is a document of its own.
    #[must_use]
    pub const fn separate_cards(self) -> bool {
        matches!(self, Self::Individual)
    }

    /// Whether each share's sheet carries a QR code of the whole share.
    #[must_use]
    pub const fn whole_share_qr(self) -> bool {
        matches!(self, Self::Qr)
    }

    /// Whether the mixed style starts each share's sheet at another design, by its member.
    #[must_use]
    pub const fn design_by_member(self) -> bool {
        matches!(self, Self::Qr)
    }

    /// The layout of `requested` or of the page size: a sheet size gives one collection sheet per
    /// share, a card size separate numbered cards. Refuses a collection sheet of the business size
    /// and separate cards of a sheet size.
    pub fn resolved(
        requested: Option<Self>,
        page_size: Option<PageSize>,
    ) -> Result<Self, ContentError> {
        let business = page_size == Some(PageSize::Business);
        let layout = requested.unwrap_or(if business {
            Self::Individual
        } else {
            Self::Collection
        });
        match layout {
            Self::Qr => {}
            Self::Collection if business => return Err(ContentError::LayoutBusiness),
            Self::Collection => {}
            Self::Individual => crate::settings::check_separate_card_size(page_size)?,
        }
        Ok(layout)
    }

    /// Refuses a QR code on the separate cards of this layout, which never carry one.
    pub fn check_qr(self, settings: &CardSettings) -> Result<(), ContentError> {
        if self.separate_cards() && settings.card_qr {
            return Err(ContentError::QrOnSheetOnlyLayout);
        }
        Ok(())
    }
}
