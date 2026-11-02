//! How cards are printed (MnemoCode TS 0.1.0's `export/card-settings.ts`,
//! CAP-CARDS-PAGE-SETTINGS): the page sizes and orientations, the person's details and the texts of
//! a design, each checked before any template draws.

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::text::words::{capitalized, list_in_words};
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};
use unicode_script::{Script, UnicodeScript};

use crate::text_rules::{TextError, card_text};

/// What the QR code of a sheet holds, as the menu and the help name it: the backup alone.
pub const SHEET_QR_HOLDS: &str = "the codes of the backup, without the extra cards";
/// The sheet sizes as messages name them.
pub const SHEET_SIZES_TEXT: &str = "A6, A5 or A4";

/// The size of a page of cards: print layout is independent of the design and the form.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageSize {
    /// A6.
    A6,
    /// A5.
    A5,
    /// A4.
    A4,
    /// The size of a real business card: every card becomes its own numbered page.
    Business,
}

impl PageSize {
    /// Every size, in the order the messages list them.
    pub const ALL: [Self; 4] = [Self::A6, Self::A5, Self::A4, Self::Business];

    /// Its name, as --page-size takes it.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::A6 => "a6",
            Self::A5 => "a5",
            Self::A4 => "a4",
            Self::Business => "business",
        }
    }

    /// Width and height in millimetres, in the size's natural orientation.
    #[must_use]
    pub const fn millimetres(self) -> (f64, f64) {
        match self {
            Self::A4 => (210.0, 297.0),
            Self::A5 => (148.0, 210.0),
            Self::A6 => (148.0, 105.0),
            Self::Business => (BUSINESS_CARD_WIDTH, BUSINESS_CARD_HEIGHT),
        }
    }

    /// The size in the words of the menu and the help, such as "148 x 105 mm".
    #[must_use]
    pub fn label(self) -> String {
        let (width, height) = self.millimetres();
        format!("{width} x {height} mm")
    }

    /// The size that `value` names; a sheet's when none is given.
    pub fn parse(value: Option<&str>) -> Result<Self, SettingsError> {
        let Some(value) = value else {
            return Ok(Self::A6);
        };
        Self::ALL
            .into_iter()
            .find(|size| size.name() == value)
            .ok_or(SettingsError::PageSize)
    }

    /// The size that `value` names, or without one the size of a `separate` card or of a sheet.
    pub fn resolve(value: Option<Self>, separate: bool) -> Self {
        value.unwrap_or(if separate { Self::Business } else { Self::A6 })
    }

    /// The width and height of a page of this size in `orientation`, in millimetres.
    #[must_use]
    pub fn dimensions(self, orientation: Option<Orientation>) -> (f64, f64) {
        let (width, height) = self.millimetres();
        let turn = match orientation {
            Some(Orientation::Portrait) => width > height,
            Some(Orientation::Landscape) => width < height,
            None => false,
        };
        if turn {
            (height, width)
        } else {
            (width, height)
        }
    }

    /// The orientation in which a page of this size is first listed.
    #[must_use]
    pub fn own_orientation(self) -> Orientation {
        let (width, height) = self.millimetres();
        if width >= height {
            Orientation::Landscape
        } else {
            Orientation::Portrait
        }
    }
}

/// Refuses a sheet size for separate cards, which have the business size; none given passes.
pub fn check_separate_card_size(size: Option<PageSize>) -> Result<(), SettingsError> {
    match size {
        None | Some(PageSize::Business) => Ok(()),
        Some(_) => Err(SettingsError::SeparateSize),
    }
}

/// A business card in millimetres: the separate cards, and the box that their designs are drawn in.
pub const BUSINESS_CARD_WIDTH: f64 = 90.0;
/// See [`BUSINESS_CARD_WIDTH`].
pub const BUSINESS_CARD_HEIGHT: f64 = 50.0;

/// How a sheet of cards is turned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orientation {
    /// Taller than wide.
    Portrait,
    /// Wider than tall.
    Landscape,
}

impl Orientation {
    /// Every orientation.
    pub const ALL: [Self; 2] = [Self::Portrait, Self::Landscape];

    /// Its name, as --orientation takes it.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
        }
    }

    /// The orientation that `value` names, or none.
    pub fn parse(value: Option<&str>) -> Result<Option<Self>, SettingsError> {
        value
            .map(|value| {
                Self::ALL
                    .into_iter()
                    .find(|orientation| orientation.name() == value)
                    .ok_or(SettingsError::Orientation)
            })
            .transpose()
    }
}

/// A detail of the person on the cards.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileField {
    /// The name.
    Name,
    /// The role.
    Role,
    /// The company.
    Company,
    /// The email address.
    Email,
    /// The phone number.
    Phone,
    /// The website.
    Website,
    /// The location.
    Location,
}

impl ProfileField {
    /// The details in the order a host asks for them.
    pub const ALL: [Self; 7] = [
        Self::Name,
        Self::Role,
        Self::Company,
        Self::Email,
        Self::Phone,
        Self::Website,
        Self::Location,
    ];

    /// Its name in a refusal and in its option, `--card-<name>`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Role => "role",
            Self::Company => "company",
            Self::Email => "email",
            Self::Phone => "phone",
            Self::Website => "website",
            Self::Location => "location",
        }
    }

    /// How it is named to the person: its name, capitalized.
    #[must_use]
    pub fn label(self) -> String {
        capitalized(self.name())
    }
}

/// The details of the person on the cards, each optional.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CardProfile {
    values: [Option<String>; 7],
}

impl CardProfile {
    /// The detail `field`.
    #[must_use]
    pub fn get(&self, field: ProfileField) -> Option<&str> {
        self.values[field as usize].as_deref()
    }

    /// Gives the detail `field`.
    pub fn set(&mut self, field: ProfileField, value: String) {
        self.values[field as usize] = Some(value);
    }

    /// `self`, with what `over` gives printed over it.
    #[must_use]
    pub fn overlaid(&self, over: &Self) -> Self {
        let mut merged = self.clone();
        for field in ProfileField::ALL {
            if let Some(value) = over.get(field) {
                merged.set(field, value.to_owned());
            }
        }
        merged
    }

    /// The details, each trimmed and in NFC; refuses a detail that is empty, on more than one line
    /// or holds a control character, one that is too long, and a name not in Latin letters.
    pub fn validated(&self) -> Result<Self, SettingsError> {
        let mut result = Self::default();
        for field in ProfileField::ALL {
            let Some(text) = self.get(field) else {
                continue;
            };
            let normalized = card_text(text, field.name(), ", without control characters.")?;
            if field == ProfileField::Name && !is_latin_name(&normalized) {
                return Err(SettingsError::LatinName);
            }
            result.set(field, normalized);
        }
        Ok(result)
    }
}

/// Whether `name` has a Latin letter and nothing but Latin letters, marks, spaces, dots,
/// apostrophes and hyphens.
fn is_latin_name(name: &str) -> bool {
    let latin = |character: char| character.script() == Script::Latin;
    let mark = |character: char| {
        matches!(
            character.general_category(),
            GeneralCategory::NonspacingMark
                | GeneralCategory::SpacingMark
                | GeneralCategory::EnclosingMark
        )
    };
    name.chars().any(latin)
        && name
            .chars()
            .all(|c| latin(c) || mark(c) || " .’'‐-".contains(c))
}

/// Every text of a card design besides the person's details.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CardPresentation {
    /// The name of the studio that the sheet says made the study.
    pub studio_name: String,
    /// The line under the studio.
    pub slogan: String,
    /// The line under the heading.
    pub subtitle: String,
    /// The closing line of the page.
    pub footer: String,
    /// The label before each code.
    pub reference_label: String,
}

/// How cards are printed. A size or orientation left out is chosen by the plan.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CardSettings {
    /// The size of the page; none: A6 for a sheet, the business size for separate cards.
    pub page_size: Option<PageSize>,
    /// How the page is turned; none: a sheet's plan chooses, a separate card keeps its own.
    pub orientation: Option<Orientation>,
    /// The person's details; those left out are invented.
    pub profile: CardProfile,
    /// The texts of the design, given whole and each checked; chosen at random when none.
    pub presentation: Option<CardPresentation>,
    /// Whether a sheet prints the backup's QR code; separate cards never do.
    pub card_qr: bool,
}

/// The refusals of the settings, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettingsError {
    /// A name of no size.
    PageSize,
    /// A sheet size for separate cards.
    SeparateSize,
    /// A name of no orientation.
    Orientation,
    /// A text of a card that its rules refuse.
    Text(TextError),
    /// A name not in Latin letters.
    LatinName,
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PageSize => {
                let names: Vec<&str> = PageSize::ALL.iter().map(|size| size.name()).collect();
                write!(f, "Page size must be {}.", list_in_words(&names, "or"))
            }
            Self::SeparateSize => f.write_str(
                "Separate cards have the business size. Choose the business size, or leave the size out.",
            ),
            Self::Orientation => {
                let names: Vec<&str> = Orientation::ALL.iter().map(|kind| kind.name()).collect();
                write!(f, "Orientation must be {}.", list_in_words(&names, "or"))
            }
            Self::Text(error) => error.fmt(f),
            Self::LatinName => f.write_str(
                "Card name must use Latin letters only (spaces, apostrophes and hyphens are allowed).",
            ),
        }
    }
}

impl std::error::Error for SettingsError {}

impl From<TextError> for SettingsError {
    fn from(error: TextError) -> Self {
        Self::Text(error)
    }
}

impl Refusal for SettingsError {
    fn code(&self) -> &'static str {
        match self {
            Self::PageSize => "export.card-settings.page-size",
            Self::SeparateSize => {
                "export.card-settings.separate-cards-business-size-choose-business-size-leave"
            }
            Self::Orientation => "export.card-settings.orientation",
            Self::Text(error) => error.code(),
            Self::LatinName => {
                "export.card-settings.card-name-use-latin-letters-only-spaces-apostrophes"
            }
        }
    }
}
