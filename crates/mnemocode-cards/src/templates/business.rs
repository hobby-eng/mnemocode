//! The business designs (MnemoCode TS 0.1.0's `export/business-cards.ts`, `business-designs.ts`
//! and `business-artwork.ts`, CAP-CARDS-BUSINESS-RENDER): what sets each design apart, in one
//! descriptor per design, and the cards drawn from it: a sheet of the whole collection, or one
//! separate card, the artwork of each recoloured for its code.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use mnemocode::random::Random;

use super::{BusinessStyle, CardDrawing, PhysicalStyle, TemplateError};
use crate::content::ColorCards;
use crate::details::{CompanySector, ExportDetails};
use crate::palette::{
    BusinessTint, ReferenceTint, artwork_brightness, channel_of_byte, hsv, peak_relative_luma,
    rgb_of_hsv,
};
use crate::scene::{FitError, INK, MM, MmRect, Page, Picture, Pixels, Rgb, UiFont, rgb};
use crate::settings::{
    BUSINESS_CARD_HEIGHT, BUSINESS_CARD_WIDTH, CardPresentation, CardProfile, PageSize,
    ProfileField,
};
use crate::sheet::SheetError;
use crate::sheet::frame::{
    CollectionStudy, StudyTheme, draw_collection_study, separate_card_index,
};

/// The shape of a business card, width over height.
pub(super) const BUSINESS_ASPECT: f64 = BUSINESS_CARD_WIDTH / BUSINESS_CARD_HEIGHT;
/// Pixels per millimetre of the artwork: 254 dpi, 900 x 500 on a business card.
const ARTWORK_PIXELS_PER_MM: f64 = 10.0;
const RGBA_CHANNELS: usize = 4;
/// The top of the reference line's box on a separate card, in millimetres.
const REFERENCE_TOP: f64 = 46.0;
/// The least size of the reference line, in points.
const REFERENCE_MINIMUM_SIZE: f64 = 4.2;
/// Above this lightness of the artwork a reference's colour is light enough for the dark ink; below
/// it the curves design writes white on it.
const LIGHT_REFERENCE_LUMA: f64 = 0.48;
const WHITE: Rgb = rgb(1.0, 1.0, 1.0);
const LIGHT_REFERENCE_INK: Rgb = rgb(0.84, 0.86, 0.88);
/// Where the reference line of a separate card starts, in millimetres from the left edge.
pub const REFERENCE_MARGIN: f64 = 7.2;
/// How long the reference line may be, in millimetres.
const REFERENCE_WIDTH: f64 = 76.0;
/// Where the IT design ends its reference line, clear of its artwork, in millimetres.
const IT_REFERENCE_END: f64 = 55.5;
/// The least size of a name, in points on a card.
const NAME_MINIMUM_SIZE: f64 = 6.0;
/// The least size of every other detail, in points on a card.
const FIELD_MINIMUM_SIZE: f64 = 4.0;

/// The reference line of a separate card.
#[derive(Clone, Copy, Debug)]
pub struct ReferenceLine {
    /// Where the line may end, in millimetres from the left edge of the card.
    pub end: f64,
    /// Whether the line ends at `end`, or starts at the margin.
    pub flush_right: bool,
    /// Its size in points, from which a long line shrinks.
    pub preferred_size: f64,
    /// Dark ink on a light edge of the artwork, or a light grey on a dark one.
    pub dark: bool,
}

/// The reference line of most designs: from the margin, light grey, 6.3 pt.
const STANDARD_REFERENCE: ReferenceLine = ReferenceLine {
    end: REFERENCE_MARGIN + REFERENCE_WIDTH,
    flush_right: false,
    preferred_size: 6.3,
    dark: false,
};

/// Where a design prints one detail of the person: `x` and `width` are shares of the card width,
/// `y` the top of the line box as a share of its height, `preferred` the size in points on a card.
#[derive(Clone, Copy, Debug)]
struct FieldPlace {
    field: ProfileField,
    x: f64,
    y: f64,
    width: f64,
    preferred: f64,
    /// In dark ink, on a light part of the artwork; white otherwise.
    dark: bool,
}

const fn place(field: ProfileField, x: f64, y: f64, width: f64, preferred: f64) -> FieldPlace {
    FieldPlace {
        field,
        x,
        y,
        width,
        preferred,
        dark: false,
    }
}

const fn dark(field: ProfileField, x: f64, y: f64, width: f64, preferred: f64) -> FieldPlace {
    FieldPlace {
        field,
        x,
        y,
        width,
        preferred,
        dark: true,
    }
}

/// One business design: what sets it apart, measured from the artwork.
#[derive(Clone, Copy, Debug)]
struct BusinessDesign {
    /// The hue of the photograph's coloured parts, which a reference's hue replaces.
    hue_origin: f64,
    /// How strongly its photograph takes a reference's colour.
    tint: BusinessTint,
    /// Whether the ink of the dark fields is chosen against the reference's colour where those
    /// fields lie on it (the curves design), or always the dark ink.
    contrast_ink: bool,
    /// Where and how a separate card prints its reference line; a sheet prints none.
    reference: ReferenceLine,
    /// The theme of a sheet of its cards alone.
    study_theme: StudyTheme,
    /// The person's details.
    fields: &'static [FieldPlace],
}

use ProfileField::{Company, Email, Location, Name, Phone, Role, Website};

const ARCHITECT: BusinessDesign = BusinessDesign {
    hue_origin: 0.56,
    tint: BusinessTint::Muted,
    contrast_ink: false,
    reference: STANDARD_REFERENCE,
    study_theme: StudyTheme::Cool,
    fields: &[
        place(Company, 0.17, 0.123, 0.36, 7.8),
        place(Name, 0.08, 0.268, 0.43, 10.0),
        place(Role, 0.08, 0.368, 0.41, 6.0),
        place(Email, 0.16, 0.514, 0.32, 6.2),
        place(Website, 0.16, 0.657, 0.34, 6.2),
        place(Location, 0.16, 0.8, 0.37, 6.2),
    ],
};

const IT: BusinessDesign = BusinessDesign {
    hue_origin: 0.56,
    tint: BusinessTint::Muted,
    contrast_ink: false,
    // The line ends clear of the artwork and is set flush right against it.
    reference: ReferenceLine {
        end: IT_REFERENCE_END,
        flush_right: true,
        ..STANDARD_REFERENCE
    },
    study_theme: StudyTheme::Noir,
    fields: &[
        place(Company, 0.17, 0.123, 0.36, 7.8),
        place(Name, 0.08, 0.265, 0.43, 10.0),
        place(Role, 0.08, 0.36, 0.41, 6.0),
        place(Email, 0.16, 0.518, 0.32, 6.2),
        place(Website, 0.16, 0.664, 0.34, 6.2),
        place(Location, 0.16, 0.812, 0.37, 6.2),
    ],
};

const ESTATE: BusinessDesign = BusinessDesign {
    hue_origin: 0.56,
    tint: BusinessTint::Vivid,
    contrast_ink: false,
    reference: STANDARD_REFERENCE,
    study_theme: StudyTheme::Cool,
    fields: &[
        place(Company, 0.2, 0.13, 0.29, 9.0),
        place(Name, 0.071, 0.32, 0.4, 10.5),
        place(Role, 0.071, 0.408, 0.4, 7.0),
        place(Email, 0.14, 0.528, 0.33, 6.4),
        place(Phone, 0.14, 0.604, 0.33, 6.4),
        place(Website, 0.14, 0.68, 0.33, 6.4),
        place(Location, 0.14, 0.749, 0.33, 6.4),
    ],
};

const DIAGONAL: BusinessDesign = BusinessDesign {
    hue_origin: 0.09,
    tint: BusinessTint::Vivid,
    contrast_ink: false,
    reference: STANDARD_REFERENCE,
    study_theme: StudyTheme::Cool,
    fields: &[
        // The photograph narrows the free space towards the top: the line is kept shorter.
        place(Company, 0.18, 0.122, 0.285, 9.0),
        place(Name, 0.065, 0.35, 0.42, 10.0),
        place(Role, 0.065, 0.435, 0.42, 6.8),
        place(Email, 0.065, 0.58, 0.41, 6.4),
        place(Website, 0.065, 0.66, 0.41, 6.4),
        place(Phone, 0.065, 0.74, 0.41, 6.4),
    ],
};

const CONTACT: BusinessDesign = BusinessDesign {
    hue_origin: 0.5,
    tint: BusinessTint::Vivid,
    contrast_ink: false,
    reference: ReferenceLine {
        preferred_size: 4.6,
        dark: true,
        ..STANDARD_REFERENCE
    },
    study_theme: StudyTheme::Cool,
    fields: &[
        dark(Company, 0.065, 0.78, 0.34, 9.0),
        place(Name, 0.54, 0.085, 0.41, 9.0),
        place(Role, 0.54, 0.161, 0.41, 6.0),
        place(Phone, 0.54, 0.357, 0.41, 7.0),
        place(Email, 0.54, 0.56, 0.41, 6.5),
        place(Website, 0.54, 0.62, 0.41, 6.5),
        place(Location, 0.54, 0.816, 0.41, 6.5),
    ],
};

const CURVES: BusinessDesign = BusinessDesign {
    hue_origin: 0.12,
    tint: BusinessTint::Vivid,
    contrast_ink: true,
    reference: STANDARD_REFERENCE,
    study_theme: StudyTheme::Cool,
    fields: &[
        // Above the logo, on the plain background: lower down, the curve runs under it.
        place(Company, 0.06, 0.095, 0.31, 9.0),
        dark(Name, 0.45, 0.163, 0.46, 10.0),
        dark(Role, 0.45, 0.246, 0.46, 6.5),
        place(Phone, 0.44, 0.49, 0.47, 7.0),
        place(Email, 0.44, 0.59, 0.47, 6.5),
        place(Website, 0.44, 0.69, 0.47, 6.5),
        place(Location, 0.44, 0.79, 0.47, 6.5),
    ],
};

const FACETS: BusinessDesign = BusinessDesign {
    hue_origin: 0.39,
    tint: BusinessTint::Vivid,
    contrast_ink: false,
    reference: ReferenceLine {
        dark: true,
        ..STANDARD_REFERENCE
    },
    study_theme: StudyTheme::Cool,
    fields: &[
        dark(Company, 0.245, 0.125, 0.5, 10.0),
        dark(Name, 0.245, 0.262, 0.52, 10.0),
        dark(Role, 0.245, 0.345, 0.52, 6.5),
        dark(Phone, 0.245, 0.5, 0.52, 6.8),
        dark(Email, 0.245, 0.585, 0.52, 6.5),
        dark(Website, 0.245, 0.67, 0.52, 6.5),
    ],
};

/// The descriptor of `style`.
const fn design_of(style: PhysicalStyle) -> &'static BusinessDesign {
    match style {
        PhysicalStyle::Architect => &ARCHITECT,
        PhysicalStyle::It => &IT,
        PhysicalStyle::Estate => &ESTATE,
        PhysicalStyle::Diagonal => &DIAGONAL,
        PhysicalStyle::Contact => &CONTACT,
        PhysicalStyle::Curves => &CURVES,
        PhysicalStyle::Facets => &FACETS,
    }
}

/// The design that card `index` of `style` shows: the mixed one takes the designs in turn.
const fn physical_style(style: BusinessStyle, index: usize) -> PhysicalStyle {
    match style {
        BusinessStyle::Physical(style) => style,
        BusinessStyle::Mixed => PhysicalStyle::ALL[index % PhysicalStyle::ALL.len()],
    }
}

/// The theme of a sheet of `style`: the design's own, or the mixed sheet's.
const fn study_theme_of(style: BusinessStyle) -> StudyTheme {
    match style {
        BusinessStyle::Physical(style) => design_of(style).study_theme,
        BusinessStyle::Mixed => StudyTheme::Cool,
    }
}

/// The approved photograph of a design, resampled to a card, as RGBA.
#[derive(Debug)]
pub struct BusinessImage {
    width: usize,
    height: usize,
    data: Vec<u8>,
}

/// The file of the photograph of `style`; none where the build leaves its design out.
const fn photograph_file(style: PhysicalStyle) -> Option<&'static [u8]> {
    match style {
        #[cfg(feature = "template-business-architect")]
        PhysicalStyle::Architect => Some(crate::assets::BUSINESS_ARCHITECT),
        #[cfg(feature = "template-business-contact")]
        PhysicalStyle::Contact => Some(crate::assets::BUSINESS_CONTACT),
        #[cfg(feature = "template-business-curves")]
        PhysicalStyle::Curves => Some(crate::assets::BUSINESS_CURVES),
        #[cfg(feature = "template-business-diagonal")]
        PhysicalStyle::Diagonal => Some(crate::assets::BUSINESS_DIAGONAL),
        #[cfg(feature = "template-business-estate")]
        PhysicalStyle::Estate => Some(crate::assets::BUSINESS_ESTATE),
        #[cfg(feature = "template-business-facets")]
        PhysicalStyle::Facets => Some(crate::assets::BUSINESS_FACETS),
        #[cfg(feature = "template-business-it")]
        PhysicalStyle::It => Some(crate::assets::BUSINESS_IT),
        #[allow(
            unreachable_patterns,
            reason = "with every design built, nothing is left"
        )]
        _ => None,
    }
}

impl BusinessImage {
    /// The photograph of `style`, read and resampled; smooth sampling preserves its detail.
    pub(super) fn prepared(style: PhysicalStyle) -> Result<Self, TemplateError> {
        let (width, height, data) = photograph_file(style)
            .and_then(decoded)
            .ok_or(TemplateError::Artwork)?;
        let out_width = (BUSINESS_CARD_WIDTH * ARTWORK_PIXELS_PER_MM) as usize;
        let out_height = (BUSINESS_CARD_HEIGHT * ARTWORK_PIXELS_PER_MM) as usize;
        let mut out = vec![0; out_width * out_height * RGBA_CHANNELS];
        let at =
            |x: usize, y: usize, c: usize| f64::from(data[(y * width + x) * RGBA_CHANNELS + c]);
        // Pixel-center bilinear sampling; this arithmetic order keeps the approved output.
        for y in 0..out_height {
            for x in 0..out_width {
                let sx = ((x as f64 + 0.5) * width as f64) / out_width as f64 - 0.5;
                let sy = ((y as f64 + 0.5) * height as f64) / out_height as f64 - 0.5;
                let x0 = libm::floor(sx).max(0.0) as usize;
                let y0 = libm::floor(sy).max(0.0) as usize;
                let x1 = (width - 1).min(x0 + 1);
                let y1 = (height - 1).min(y0 + 1);
                let dx = sx - x0 as f64;
                let dy = sy - y0 as f64;
                for c in 0..RGBA_CHANNELS {
                    let value = at(x0, y0, c) * (1.0 - dx) * (1.0 - dy)
                        + at(x1, y0, c) * dx * (1.0 - dy)
                        + at(x0, y1, c) * (1.0 - dx) * dy
                        + at(x1, y1, c) * dx * dy;
                    out[(y * out_width + x) * RGBA_CHANNELS + c] = libm::floor(value + 0.5) as u8;
                }
            }
        }
        Ok(Self {
            width: out_width,
            height: out_height,
            data: out,
        })
    }

    /// The artwork of the design `design` for the reference `code`: decorative hue, saturation and
    /// brightness follow the reference approximately; the printed code remains exact.
    fn recoloured(&self, design: &BusinessDesign, code: &str) -> Result<Picture, TemplateError> {
        let reference = ReferenceTint::new(code)?;
        let pixels = self.width * self.height;
        let mut rgb_data = Vec::with_capacity(pixels * 3);
        let mut alpha = Vec::with_capacity(pixels);
        for &[red, green, blue, opacity] in self.data.as_chunks::<RGBA_CHANNELS>().0 {
            let colour = hsv(
                channel_of_byte(red),
                channel_of_byte(green),
                channel_of_byte(blue),
            );
            if ReferenceTint::keeps(colour) {
                rgb_data.extend_from_slice(&[red, green, blue]);
            } else {
                let tinted = reference.pixel(colour, design.tint, design.hue_origin);
                rgb_data.extend_from_slice(&rgb_of_hsv(tinted));
            }
            alpha.push(opacity);
        }
        let opaque = alpha.iter().all(|opacity| *opacity == u8::MAX);
        Ok(Picture {
            width: self.width as u32,
            height: self.height as u32,
            pixels: Pixels::Rgb {
                data: rgb_data,
                alpha: (!opaque).then_some(alpha),
            },
        })
    }
}

/// The width, height and RGBA bytes of the PNG `file`.
fn decoded(file: &[u8]) -> Option<(usize, usize, Vec<u8>)> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(file));
    decoder.set_transformations(
        png::Transformations::normalize_to_color8() | png::Transformations::ALPHA,
    );
    let mut reader = decoder.read_info().ok()?;
    let mut data = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut data).ok()?;
    data.truncate(frame.buffer_size());
    Some((frame.width as usize, frame.height as usize, data))
}

/// A detail of the person fitted to a design.
struct FittedField {
    value: String,
    x: f64,
    y: f64,
    size: f64,
    dark: bool,
}

/// The person's details as `design` prints them, each at the size at which it fits; a refusal names
/// the detail.
fn fitted_fields(
    design: &BusinessDesign,
    profile: &CardProfile,
    font: &UiFont,
) -> Result<Vec<FittedField>, FitError> {
    design
        .fields
        .iter()
        .map(|place| {
            let value = profile.get(place.field).unwrap_or_default().to_owned();
            let minimum = if place.field == Name {
                NAME_MINIMUM_SIZE
            } else {
                FIELD_MINIMUM_SIZE
            };
            let room = BUSINESS_CARD_WIDTH * MM * place.width;
            let size = font.fit(&value, place.preferred, minimum, room, &place.field.label())?;
            Ok(FittedField {
                value,
                x: place.x,
                y: place.y,
                size,
                dark: place.dark,
            })
        })
        .collect()
}

/// What the cards of one document are drawn with.
struct Context<'a> {
    drawing: &'a CardDrawing,
    cards: &'a ColorCards,
    style: BusinessStyle,
    offset: usize,
    profile: CardProfile,
    presentation: CardPresentation,
    /// Scoped to one document: shared images never retain user data across exports.
    artwork: RefCell<HashMap<(PhysicalStyle, String), Rc<Picture>>>,
}

impl Context<'_> {
    /// The design that card `index` shows.
    const fn design_of(&self, index: usize) -> PhysicalStyle {
        physical_style(self.style, index + self.offset)
    }

    /// The ink of a field of card `index`.
    fn field_color(&self, dark: bool, index: usize) -> Result<Rgb, TemplateError> {
        if !dark {
            return Ok(WHITE);
        }
        if !design_of(self.design_of(index)).contrast_ink {
            return Ok(INK);
        }
        let color = &self.cards.codes.colors[index];
        let lightness = peak_relative_luma(color)? * artwork_brightness(color)?;
        Ok(if lightness > LIGHT_REFERENCE_LUMA {
            INK
        } else {
            WHITE
        })
    }

    /// The artwork of card `index`, which prints `code`.
    fn artwork_of(&self, index: usize, code: &str) -> Result<Rc<Picture>, TemplateError> {
        let design = self.design_of(index);
        let key = (design, code.to_owned());
        if let Some(picture) = self.artwork.borrow().get(&key) {
            return Ok(Rc::clone(picture));
        }
        let photograph = self.drawing.business_photograph(design)?;
        let picture = Rc::new(photograph.recoloured(design_of(design), code)?);
        self.artwork.borrow_mut().insert(key, Rc::clone(&picture));
        Ok(picture)
    }

    /// The face of card `index` in `place`: its artwork clipped to the card and the person's
    /// details, sized to the box.
    fn draw_face(&self, page: &mut Page, place: MmRect, index: usize) -> Result<(), TemplateError> {
        let font = &self.drawing.font;
        let code = self.cards.codes.colors[index].to_uppercase();
        page.clipped_artwork(&self.artwork_of(index, &code)?, place);
        let scale = place.width / BUSINESS_CARD_WIDTH;
        let design = design_of(self.design_of(index));
        for field in fitted_fields(design, &self.profile, font)? {
            page.text(
                font,
                &field.value,
                (
                    place.x + field.x * place.width,
                    place.y + field.y * place.height,
                ),
                field.size * scale,
                self.field_color(field.dark, index)?,
            );
        }
        Ok(())
    }

    /// A page of its own for the separate card `index`, which holds this reference alone: no
    /// collection QR or hidden full payload.
    fn render_single(&self, index: usize) -> Result<Page, TemplateError> {
        let font = &self.drawing.font;
        let cards = self.cards;
        let mut page = Page::new(BUSINESS_CARD_WIDTH, BUSINESS_CARD_HEIGHT);
        let whole = MmRect {
            x: 0.0,
            y: 0.0,
            width: BUSINESS_CARD_WIDTH,
            height: BUSINESS_CARD_HEIGHT,
        };
        self.draw_face(&mut page, whole, index)?;
        // Every separate card shows its number, and as the rules of its kind say, its series.
        let reference = cards
            .kind
            .separate_reference(&cards.codes.numbered(index, "  "), cards.series());
        let line = format!("{} {reference}", self.presentation.reference_label);
        let line = mnemocode::text::space::trim(&line);
        let design = design_of(self.design_of(index));
        let (x, size) = reference_placement(font, line, &design.reference)?;
        let ink = if design.reference.dark {
            INK
        } else {
            LIGHT_REFERENCE_INK
        };
        page.text(font, line, (x, REFERENCE_TOP), size, ink);
        resize_single_page(&mut page, cards);
        Ok(page)
    }
}

/// Where the reference line `line` starts, in millimetres, and its size in points: a line that ends
/// early shrinks to the room between the margin and that end instead of running off the card.
fn reference_placement(
    font: &UiFont,
    line: &str,
    reference: &ReferenceLine,
) -> Result<(f64, f64), FitError> {
    let ReferenceLine {
        end,
        flush_right,
        preferred_size,
        ..
    } = *reference;
    let room = (end - REFERENCE_MARGIN) * MM;
    let size = font.fit(
        line,
        preferred_size,
        REFERENCE_MINIMUM_SIZE,
        room,
        "Reference",
    )?;
    let x = if flush_right {
        end - font.width(line, size) / MM
    } else {
        REFERENCE_MARGIN
    };
    Ok((x, size))
}

/// The page that the settings ask for, the card centred on it, and drawn smaller only where the
/// page is smaller than the card.
fn resize_single_page(page: &mut Page, cards: &ColorCards) {
    let settings = &cards.settings;
    if settings.page_size.is_none() && settings.orientation.is_none() {
        return;
    }
    let (width, height) =
        PageSize::resolve(settings.page_size, true).dimensions(settings.orientation);
    let scale = (width / BUSINESS_CARD_WIDTH)
        .min(height / BUSINESS_CARD_HEIGHT)
        .min(1.0);
    let x = (width - BUSINESS_CARD_WIDTH * scale) / 2.0;
    // The card is centred, so its distance from the bottom edge equals its distance from the top.
    let top = (height - BUSINESS_CARD_HEIGHT * scale) / 2.0;
    page.resized(scale, x, top, width, height);
}

/// The lines under the first `count` cards of a sheet: each card's number and code.
pub(super) fn sheet_captions(cards: &ColorCards, count: usize) -> Vec<Vec<String>> {
    (0..count)
        .map(|index| vec![cards.codes.numbered(index, "  ")])
        .collect()
}

/// Draws the business cards of `cards` in `style`, whose employer is of `sector`: the sheet of the
/// whole collection, or with `individual` that one separate card; `offset` turns the mixed design's
/// styles further for each card.
pub(super) fn render_business_cards(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    (style, sector): (BusinessStyle, Option<CompanySector>),
    cards: &ColorCards,
    individual: Option<usize>,
    offset: usize,
) -> Result<Page, TemplateError> {
    cards.check()?;
    let separate = separate_card_index(cards, individual)?;
    // Through an export the content carries the details settled for it, which come back unchanged.
    let details = ExportDetails::person_first(random, &cards.settings, sector)?;
    let context = Context {
        drawing,
        cards,
        style,
        offset,
        profile: details.profile,
        presentation: details.presentation,
        artwork: RefCell::default(),
    };
    if let Some(index) = separate {
        return context.render_single(index);
    }
    let study = CollectionStudy {
        font: &drawing.font,
        cards,
        presentation: &context.presentation,
        prepared_for: context.profile.get(Name).unwrap_or_default(),
        theme: study_theme_of(style),
        aspect: BUSINESS_ASPECT,
        captions: sheet_captions(cards, cards.codes.colors.len()),
        picture_area: None,
    };
    let page = draw_collection_study(&study, &mut |page, place| {
        context
            .draw_face(page, place.rect(), place.index)
            .map_err(|error| SheetError::Design(Box::new(error)))
    })?;
    Ok(page)
}
