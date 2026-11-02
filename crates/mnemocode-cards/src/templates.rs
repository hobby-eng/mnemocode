//! The installed card designs (MnemoCode TS 0.1.0's `export/template-catalog.ts` and
//! `templates.ts`, CAP-CARDS-TEMPLATE-CATALOG): the styles of each family, and from them each
//! design's id, family and style, in the order that the list of designs numbers them. Keep ids and
//! their order stable for recorded commands, which name a design by its id or its number.

pub mod business;
mod finishes;
pub mod material;

use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::rc::Rc;

use mnemocode::forms::colors::ColorsError;
use mnemocode::random::Random;
use mnemocode::refusal::Refusal;

use self::business::{
    BUSINESS_ASPECT, BusinessImage, render_business_cards, sheet_captions as business_captions,
};
use self::material::{material_aspect, render_material_card, sheet_captions as material_captions};
use crate::content::{ColorCards, ContentError};
use crate::details::CompanySector;
use crate::scene::{FitError, Page, Picture, UiFont};
use crate::settings::{PageSize, SHEET_SIZES_TEXT};
use crate::sheet::{SheetError, SheetShape};

/// A business design with artwork of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PhysicalStyle {
    /// Architect.
    Architect,
    /// IT.
    It,
    /// Estate.
    Estate,
    /// Diagonal city.
    Diagonal,
    /// Light contact blocks.
    Contact,
    /// Signature curves.
    Curves,
    /// Light facets.
    Facets,
}

impl PhysicalStyle {
    /// Every one, in the order that the mixed design shows them.
    pub const ALL: [Self; 7] = [
        Self::Architect,
        Self::It,
        Self::Estate,
        Self::Diagonal,
        Self::Contact,
        Self::Curves,
        Self::Facets,
    ];
}

/// A business card design; the mixed one draws the others in turn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BusinessStyle {
    /// One design.
    Physical(PhysicalStyle),
    /// The designs in turn.
    Mixed,
}

/// A material design, a collection of samples that only its sheet shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MaterialStyle {
    /// Vehicle finishes.
    Vehicle,
    /// Enclosure finishes.
    Enclosure,
    /// Tiles.
    Tile,
    /// Switch finishes.
    Switch,
    /// Kitchen finishes.
    Kitchen,
}

impl MaterialStyle {
    /// Its name, in a refusal and in the list of designs.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Vehicle => "vehicle",
            Self::Enclosure => "enclosure",
            Self::Tile => "tile",
            Self::Switch => "switch",
            Self::Kitchen => "kitchen",
        }
    }
}

/// How a design draws: a business style or a material.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CardStyle {
    /// A business design.
    Business(BusinessStyle),
    /// A material design.
    Material(MaterialStyle),
}

/// Why a design is not drawn as separate cards, of `design`, a design named in a sentence.
#[must_use]
pub fn sheets_only(design: &str) -> String {
    format!(
        "{design} is printed on sheets only: separate cards are made in the business card designs."
    )
}

/// What the designs refuse.
#[derive(Debug)]
pub enum TemplateError {
    /// A name of no design.
    Unknown,
    /// Separate cards of a design printed on sheets only.
    SheetsOnly,
    /// More distinct codes than a material has samples: its name and how many it has.
    TooFewSamples(&'static str, usize),
    /// A reference that is no colour of six hexadecimal digits.
    NoReference,
    /// A material sheet of no card.
    Empty,
    /// More references than a sheet of samples holds.
    TooManyReferences,
    /// What the sheet refuses.
    Sheet(SheetError),
    /// What the content of the cards refuses.
    Content(ContentError),
    /// A text that does not fit.
    Fit(FitError),
    /// What the colors refuse.
    Colors(ColorsError),
    /// A bundled photograph that cannot be read.
    Artwork,
}

impl fmt::Display for TemplateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown => f.write_str(
                "The card template is unknown or incompatible. List the available preview templates and choose one of them.",
            ),
            Self::SheetsOnly => f.write_str(&sheets_only("This design")),
            Self::TooFewSamples(name, count) => {
                write!(f, "The {name} material offers only {count} distinct samples.")
            }
            Self::NoReference => {
                f.write_str("Material reference must contain exactly six hexadecimal digits.")
            }
            Self::Empty => f.write_str(crate::content::EMPTY_CARD_COLLECTION),
            Self::TooManyReferences => write!(
                f,
                "Material cards support at most {} references.",
                crate::sheet::MAX_SHEET_CARDS
            ),
            Self::Sheet(error) => error.fmt(f),
            Self::Content(error) => error.fmt(f),
            Self::Fit(error) => error.fmt(f),
            Self::Colors(error) => error.fmt(f),
            Self::Artwork => f.write_str("The card artwork could not be loaded."),
        }
    }
}

impl std::error::Error for TemplateError {}

impl Refusal for TemplateError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unknown => {
                "export.template-catalog.card-template-unknown-incompatible-list-available-preview-templates"
            }
            Self::SheetsOnly => "export.template-catalog.sheets-only",
            Self::TooFewSamples(..) => {
                "export.material-artwork.material-offers-only-distinct-samples"
            }
            Self::NoReference => {
                "export.material-artwork.material-reference-contain-exactly-six-hexadecimal-digits"
            }
            Self::Empty => "export.material-cards.empty-card-collection",
            Self::TooManyReferences => {
                "export.material-cards.material-cards-support-at-most-references"
            }
            Self::Sheet(error) => error.code(),
            Self::Content(error) => error.code(),
            Self::Fit(error) => error.code(),
            Self::Colors(error) => error.code(),
            Self::Artwork => "export.platform.cannot-load-card-artwork",
        }
    }
}

impl From<SheetError> for TemplateError {
    fn from(error: SheetError) -> Self {
        Self::Sheet(error)
    }
}

impl From<ContentError> for TemplateError {
    fn from(error: ContentError) -> Self {
        Self::Content(error)
    }
}

impl From<FitError> for TemplateError {
    fn from(error: FitError) -> Self {
        Self::Fit(error)
    }
}

impl From<ColorsError> for TemplateError {
    fn from(error: ColorsError) -> Self {
        Self::Colors(error)
    }
}

/// What the card renderers draw with: the font and the bundled photographs, read and prepared once
/// for as long as it is kept. It holds only public artwork.
#[derive(Debug)]
pub struct CardDrawing {
    /// The font of every card and sheet.
    pub font: UiFont,
    business: RefCell<HashMap<PhysicalStyle, Rc<BusinessImage>>>,
    material: RefCell<HashMap<MaterialStyle, Rc<Picture>>>,
}

impl Default for CardDrawing {
    fn default() -> Self {
        Self::new()
    }
}

impl CardDrawing {
    /// A drawing that reads each photograph on its first use.
    #[must_use]
    pub fn new() -> Self {
        Self {
            font: UiFont::load(),
            business: RefCell::default(),
            material: RefCell::default(),
        }
    }

    /// The prepared photograph of `style`.
    pub(crate) fn business_photograph(
        &self,
        style: PhysicalStyle,
    ) -> Result<Rc<BusinessImage>, TemplateError> {
        if let Some(image) = self.business.borrow().get(&style) {
            return Ok(Rc::clone(image));
        }
        let image = Rc::new(BusinessImage::prepared(style)?);
        self.business.borrow_mut().insert(style, Rc::clone(&image));
        Ok(image)
    }

    /// The photograph of `style`.
    pub(crate) fn material_photograph(
        &self,
        style: MaterialStyle,
    ) -> Result<Rc<Picture>, TemplateError> {
        if let Some(image) = self.material.borrow().get(&style) {
            return Ok(Rc::clone(image));
        }
        let image = Rc::new(material::photograph(style)?);
        self.material.borrow_mut().insert(style, Rc::clone(&image));
        Ok(image)
    }
}

/// An installed card design.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CardTemplate {
    /// Its id, by which a command names it; stable for recorded commands.
    pub id: &'static str,
    /// How it draws.
    pub style: CardStyle,
}

/// A template entry of a business style.
#[allow(dead_code, reason = "with no design built, the registry names none")]
const fn business(id: &'static str, style: PhysicalStyle) -> CardTemplate {
    CardTemplate {
        id,
        style: CardStyle::Business(BusinessStyle::Physical(style)),
    }
}

/// A template entry of a material.
#[allow(dead_code, reason = "with no design built, the registry names none")]
const fn material_design(id: &'static str, style: MaterialStyle) -> CardTemplate {
    CardTemplate {
        id,
        style: CardStyle::Material(style),
    }
}

/// The designs, in the order that the list of designs shows and numbers them, from 1.
pub const CARD_TEMPLATES: &[CardTemplate] = &[
    #[cfg(feature = "template-business-architect")]
    business("business-architect", PhysicalStyle::Architect),
    #[cfg(feature = "template-business-it")]
    business("business-it", PhysicalStyle::It),
    #[cfg(feature = "template-business-estate")]
    business("business-estate", PhysicalStyle::Estate),
    #[cfg(feature = "template-business-diagonal")]
    business("business-diagonal", PhysicalStyle::Diagonal),
    #[cfg(feature = "template-business-contact")]
    business("business-contact", PhysicalStyle::Contact),
    #[cfg(feature = "template-business-curves")]
    business("business-curves", PhysicalStyle::Curves),
    #[cfg(feature = "template-business-facets")]
    business("business-facets", PhysicalStyle::Facets),
    #[cfg(feature = "template-business-mixed")]
    CardTemplate {
        id: "business-mixed",
        style: CardStyle::Business(BusinessStyle::Mixed),
    },
    #[cfg(feature = "template-material-vehicle")]
    material_design("material-vehicle", MaterialStyle::Vehicle),
    #[cfg(feature = "template-material-enclosure")]
    material_design("material-enclosure", MaterialStyle::Enclosure),
    #[cfg(feature = "template-material-tile")]
    material_design("material-tile", MaterialStyle::Tile),
    #[cfg(feature = "template-material-switch")]
    material_design("material-switch", MaterialStyle::Switch),
    #[cfg(feature = "template-material-kitchen")]
    material_design("material-kitchen", MaterialStyle::Kitchen),
];

/// The design of share cards when none is named, chosen for shares on its own.
pub const DEFAULT_SHARE_TEMPLATE_ID: &str = "business-it";

/// The design that `id_or_number` names: by its id, or by its number in the list, from 1 without
/// leading zeros; the first when none is named. None when none fits.
#[must_use]
pub fn find_template(id_or_number: Option<&str>) -> Option<&'static CardTemplate> {
    let Some(name) = id_or_number else {
        return CARD_TEMPLATES.first();
    };
    CARD_TEMPLATES
        .iter()
        .find(|template| template.id == name)
        .or_else(|| {
            let digits = name.bytes().all(|byte| byte.is_ascii_digit());
            if !digits || name.starts_with('0') || name.is_empty() {
                return None;
            }
            let number: usize = name.parse().ok()?;
            CARD_TEMPLATES.get(number.checked_sub(1)?)
        })
}

/// The design that `id_or_number` names, refused where it names none.
pub fn select_template(id_or_number: Option<&str>) -> Result<&'static CardTemplate, TemplateError> {
    find_template(id_or_number).ok_or(TemplateError::Unknown)
}

impl CardTemplate {
    /// Its name in the list of designs, such as "IT card collection".
    #[must_use]
    pub fn name(&self) -> String {
        match self.style {
            CardStyle::Business(style) => {
                let name = match style {
                    BusinessStyle::Physical(PhysicalStyle::Architect) => "Architecture",
                    BusinessStyle::Physical(PhysicalStyle::It) => "IT",
                    BusinessStyle::Physical(PhysicalStyle::Estate) => "Property consultant",
                    BusinessStyle::Physical(PhysicalStyle::Diagonal) => "Diagonal city",
                    BusinessStyle::Physical(PhysicalStyle::Contact) => "Light contact blocks",
                    BusinessStyle::Physical(PhysicalStyle::Curves) => "Signature curves",
                    BusinessStyle::Physical(PhysicalStyle::Facets) => "Light geometric",
                    BusinessStyle::Mixed => "Mixed design",
                };
                format!("{name} card collection")
            }
            CardStyle::Material(style) => format!(
                "{} finish selection",
                mnemocode::text::words::capitalized(style.name())
            ),
        }
    }

    /// What it draws and on which page sizes: a sentence beside its name in the list of designs.
    #[must_use]
    pub fn description(&self) -> String {
        match self.style {
            CardStyle::Business(BusinessStyle::Mixed) => format!(
                "One identity across all designs; {SHEET_SIZES_TEXT} sheets or individual cards."
            ),
            CardStyle::Business(_) => format!(
                "Editable contact details; {SHEET_SIZES_TEXT} sheets or individual {} cards.",
                PageSize::Business.label()
            ),
            CardStyle::Material(_) => format!(
                "Photo-realistic material samples with finish names and exact references; optional collection QR. {SHEET_SIZES_TEXT} sheets."
            ),
        }
    }

    /// Whether it is drawn as separate cards as well as on sheets: a business card is a thing of
    /// its own, while a material design is a collection of samples that only its sheet shows.
    #[must_use]
    pub const fn draws_separate_cards(&self) -> bool {
        matches!(self.style, CardStyle::Business(_))
    }

    /// The sector of the employer that its cards print, which the design suits; none for a style
    /// that suits any.
    #[must_use]
    pub const fn sector(&self) -> Option<CompanySector> {
        match self.style {
            CardStyle::Business(BusinessStyle::Physical(PhysicalStyle::Architect)) => {
                Some(CompanySector::Architecture)
            }
            CardStyle::Business(BusinessStyle::Physical(PhysicalStyle::It)) => {
                Some(CompanySector::It)
            }
            CardStyle::Business(BusinessStyle::Physical(PhysicalStyle::Estate)) => {
                Some(CompanySector::Property)
            }
            _ => None,
        }
    }

    /// Draws the page of `cards`: their sheet, or the separate card `fragment`, counted from 0,
    /// where the design has separate cards. `business_offset` starts the mixed business style at
    /// another of its designs, as the QR cards of shares do by member.
    pub fn draw(
        &self,
        drawing: &CardDrawing,
        random: &mut dyn Random,
        cards: &ColorCards,
        fragment: Option<usize>,
        business_offset: usize,
    ) -> Result<Page, TemplateError> {
        if fragment.is_some() && !self.draws_separate_cards() {
            return Err(TemplateError::SheetsOnly);
        }
        match self.style {
            CardStyle::Business(style) => render_business_cards(
                drawing,
                random,
                (style, self.sector()),
                cards,
                fragment,
                business_offset,
            ),
            CardStyle::Material(style) => render_material_card(drawing, random, style, cards),
        }
    }

    /// What `then` gives with the shape of a sheet of `page_size` for `cards` in this design.
    pub fn with_sheet_shape<T>(
        &self,
        drawing: &CardDrawing,
        cards: &ColorCards,
        page_size: PageSize,
        then: impl FnOnce(&SheetShape<'_>) -> Result<T, TemplateError>,
    ) -> Result<T, TemplateError> {
        match self.style {
            CardStyle::Business(_) => then(&SheetShape {
                font: &drawing.font,
                aspect: BUSINESS_ASPECT,
                captions: &|count| Ok(business_captions(cards, count)),
            }),
            CardStyle::Material(style) => {
                let aspect = material_aspect(drawing, style)?;
                let compact = page_size == PageSize::Business;
                then(&SheetShape {
                    font: &drawing.font,
                    aspect,
                    captions: &|count| {
                        material_captions(style, cards, compact, count)
                            .map_err(|error| SheetError::Design(Box::new(error)))
                    },
                })
            }
        }
    }
}
