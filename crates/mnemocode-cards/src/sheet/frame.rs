//! Draws a collection sheet where its layout lays it out (MnemoCode TS 0.1.0's
//! `export/collection-sheet.ts` and `card-qr.ts`, CAP-CARDS-SHEET-FRAME): the frame of a design
//! study with its heading, footer and QR code, the backdrop, and each card's shadow and caption.

use std::sync::OnceLock;

use mnemocode::qr::{Matrix, QR_QUIET_MODULES, matrix};

use super::backdrops::{MaterialBackdrop, draw_material_backdrop};
use super::world_map::{WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH, graticule, land};
use super::{
    COLLECTION_QR_MODULE_MM, LayoutRequest, MINIMUM_FONT, QR_PLATE_MARGIN, SheetError, StudyBox,
    StudyCaptions, StudyLayout, collection_sheet_layout,
};
use crate::content::ColorCards;
use crate::scene::{MM, MmRect, Page, Path, PointRect, Rgb, Step, TextBox, UiFont, rgb};
use crate::settings::{CardPresentation, PageSize};

/// The smallest module that a printed code keeps, in millimetres.
pub const MIN_MODULE_MM: f64 = 0.4;
/// How far a module may fall short of the smallest, in millimetres: rounding of the sums.
const MODULE_ROUNDING_MM: f64 = 1e-8;
/// How far a code may reach past the page, in points: rounding of millimetres into points.
const PAGE_ROUNDING_POINTS: f64 = 0.01;
const WHITE: Rgb = rgb(1.0, 1.0, 1.0);
const BLACK: Rgb = rgb(0.0, 0.0, 0.0);
/// The grid of the world map is meant to be felt rather than seen.
const GRID_COLOR: Rgb = rgb(0.5, 0.53, 0.58);
const GRID_OPACITY: f64 = 0.07;
const GRATICULE_STEP_DEGREES: usize = 30;
/// The width of the thin edge that shows round a card's picture on a sheet, in millimetres.
const CARD_EDGE_MM: f64 = 0.3;

/// The backdrop of a design study: a plain theme, or a material's own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StudyTheme {
    /// A cool dark.
    Cool,
    /// A warm dark.
    Warm,
    /// Black.
    Noir,
    /// A material's page.
    Material(MaterialBackdrop),
}

/// The colours of the grey world map behind the cards.
#[derive(Clone, Copy)]
struct MapColors {
    land: Rgb,
    coast: Rgb,
}

/// What lies behind the cards of one sheet.
#[derive(Clone, Copy)]
enum Backdrop {
    Map(MapColors),
    Material(MaterialBackdrop),
}

/// Colours of one sheet.
#[derive(Clone, Copy)]
struct SheetPalette {
    background: Rgb,
    backdrop: Backdrop,
    /// The plate behind the QR code and its border.
    plate: Rgb,
    plate_border: Rgb,
    /// The heading, and the quieter lines around it.
    ink: Rgb,
    muted: Rgb,
    /// The first line under a card, and the lines below it.
    caption: Rgb,
    caption_muted: Rgb,
    /// The thin edge around a card and the darkness of its shadow.
    card_edge: Rgb,
    shadow_opacity: f64,
}

/// The dark page with the grey map, shared by the dark themes; only their ink differs.
const COOL: SheetPalette = SheetPalette {
    background: rgb(0.043, 0.047, 0.059),
    backdrop: Backdrop::Map(MapColors {
        land: rgb(0.155, 0.165, 0.19),
        coast: rgb(0.22, 0.235, 0.265),
    }),
    plate: rgb(0.075, 0.082, 0.1),
    plate_border: rgb(0.3, 0.33, 0.38),
    ink: rgb(0.93, 0.95, 0.97),
    muted: rgb(0.56, 0.61, 0.67),
    caption: rgb(0.88, 0.91, 0.94),
    caption_muted: rgb(0.55, 0.61, 0.67),
    card_edge: rgb(0.24, 0.28, 0.31),
    shadow_opacity: 0.42,
};

/// The colours of `theme`; the light material pages carry dark ink, and their own backdrop covers
/// the background.
const fn palette_of(theme: StudyTheme) -> SheetPalette {
    match theme {
        StudyTheme::Cool => COOL,
        StudyTheme::Warm => SheetPalette {
            ink: rgb(0.95, 0.91, 0.84),
            muted: rgb(0.66, 0.6, 0.52),
            caption: rgb(0.93, 0.88, 0.8),
            caption_muted: rgb(0.63, 0.55, 0.46),
            ..COOL
        },
        StudyTheme::Noir => SheetPalette {
            card_edge: rgb(0.18, 0.22, 0.26),
            shadow_opacity: 0.5,
            ..COOL
        },
        StudyTheme::Material(MaterialBackdrop::Studio) => SheetPalette {
            background: rgb(0.86, 0.87, 0.88),
            backdrop: Backdrop::Material(MaterialBackdrop::Studio),
            plate: rgb(0.96, 0.965, 0.97),
            plate_border: rgb(0.5, 0.53, 0.57),
            ink: rgb(0.11, 0.12, 0.14),
            muted: rgb(0.33, 0.36, 0.4),
            caption: rgb(0.11, 0.12, 0.14),
            caption_muted: rgb(0.33, 0.36, 0.4),
            card_edge: rgb(0.6, 0.63, 0.67),
            shadow_opacity: 0.24,
        },
        StudyTheme::Material(MaterialBackdrop::Concrete) => SheetPalette {
            background: rgb(0.8, 0.79, 0.765),
            backdrop: Backdrop::Material(MaterialBackdrop::Concrete),
            plate: rgb(0.95, 0.945, 0.93),
            plate_border: rgb(0.5, 0.49, 0.47),
            ink: rgb(0.13, 0.13, 0.13),
            muted: rgb(0.33, 0.32, 0.3),
            caption: rgb(0.13, 0.13, 0.13),
            caption_muted: rgb(0.31, 0.3, 0.28),
            card_edge: rgb(0.58, 0.57, 0.55),
            shadow_opacity: 0.26,
        },
        StudyTheme::Material(MaterialBackdrop::Tiled) => SheetPalette {
            background: rgb(0.93, 0.92, 0.9),
            backdrop: Backdrop::Material(MaterialBackdrop::Tiled),
            plate: rgb(0.97, 0.965, 0.955),
            plate_border: rgb(0.52, 0.5, 0.47),
            ink: rgb(0.14, 0.15, 0.16),
            muted: rgb(0.35, 0.35, 0.34),
            caption: rgb(0.14, 0.15, 0.16),
            caption_muted: rgb(0.33, 0.33, 0.32),
            card_edge: rgb(0.55, 0.53, 0.5),
            shadow_opacity: 0.28,
        },
        StudyTheme::Material(MaterialBackdrop::Parquet) => SheetPalette {
            background: rgb(0.86, 0.8, 0.71),
            backdrop: Backdrop::Material(MaterialBackdrop::Parquet),
            plate: rgb(0.97, 0.95, 0.91),
            plate_border: rgb(0.52, 0.45, 0.36),
            ink: rgb(0.17, 0.13, 0.1),
            muted: rgb(0.36, 0.29, 0.22),
            caption: rgb(0.17, 0.13, 0.1),
            caption_muted: rgb(0.34, 0.27, 0.2),
            card_edge: rgb(0.6, 0.53, 0.43),
            shadow_opacity: 0.26,
        },
    }
}

/// The map's lines and land, made once.
fn map_paths() -> &'static (Vec<Path>, Vec<Path>) {
    static PATHS: OnceLock<(Vec<Path>, Vec<Path>)> = OnceLock::new();
    PATHS.get_or_init(|| (graticule(GRATICULE_STEP_DEGREES), land()))
}

/// Draws the grey world map, as wide as the page allows and centred a little below the middle.
fn draw_world_map(page: &mut Page, colours: MapColors, (width, height): (f64, f64), margin: f64) {
    let map_width = (width - margin) * MM;
    let scale = map_width / WORLD_MAP_WIDTH;
    let map_height = WORLD_MAP_HEIGHT * scale;
    let x = (page.width - map_width) / 2.0;
    // The top left corner of the map, drawn downwards from it; its lines scale with it.
    let y = page.height / 2.0 + map_height / 2.0 - height * 0.045 * MM;
    let (lines, land) = map_paths();
    page.steps.push(Step::Save);
    page.steps
        .push(Step::Transform([scale, 0.0, 0.0, -scale, x, y]));
    for path in lines {
        page.stroke(path.clone(), GRID_COLOR, 0.35, GRID_OPACITY);
    }
    for path in land {
        page.fill(path.clone(), colours.land, 1.0);
        page.stroke(path.clone(), colours.coast, 0.3, 1.0);
    }
    page.steps.push(Step::Restore);
}

/// Draw exact data, the code `code`, as vector modules, never as part of a decorative bitmap, in a
/// square of `size` millimetres whose top left corner is `x` and `top` millimetres from the page's.
/// Refuses a square whose modules would be narrower than `minimum_module`, and one that reaches past
/// the page.
pub fn draw_collection_qr(
    page: &mut Page,
    code: &Matrix,
    (x, top): (f64, f64),
    size: f64,
    minimum_module: f64,
) -> Result<(), SheetError> {
    let total = (code.size() + QR_QUIET_MODULES * 2) as f64;
    if size / total < minimum_module - MODULE_ROUNDING_MM {
        return Err(SheetError::QrTooSmall);
    }
    if x < 0.0
        || top < 0.0
        || (x + size) * MM > page.width + PAGE_ROUNDING_POINTS
        || (top + size) * MM > page.height + PAGE_ROUNDING_POINTS
    {
        return Err(SheetError::QrOutside);
    }
    let pitch = (size * MM) / total;
    let plate = page.rect(MmRect {
        x,
        y: top,
        width: size,
        height: size,
    });
    page.fill_rect(plate, WHITE, 1.0);
    for row in 0..code.size() {
        for column in 0..code.size() {
            if !code.is_dark(row, column) {
                continue;
            }
            let module = PointRect {
                x: x * MM + (column + QR_QUIET_MODULES) as f64 * pitch,
                y: plate.y + (code.size() + QR_QUIET_MODULES - 1 - row) as f64 * pitch,
                width: pitch,
                height: pitch,
            };
            page.fill_rect(module, BLACK, 1.0);
        }
    }
    Ok(())
}

/// The sheet's QR code `code` on its plate in the corner that `layout` keeps, with its caption.
fn draw_sheet_qr(
    page: &mut Page,
    font: &UiFont,
    layout: &StudyLayout,
    code: &Matrix,
    palette: &SheetPalette,
) -> Result<(), SheetError> {
    let Some(place) = layout.qr else {
        return Ok(());
    };
    let plate = page.rect(
        MmRect {
            x: place.x,
            y: place.y,
            width: place.size,
            height: place.size,
        }
        .outset(QR_PLATE_MARGIN),
    );
    page.fill_rect(plate, palette.plate, 0.94);
    page.stroke(
        crate::scene::rectangle_path(plate),
        palette.plate_border,
        0.4,
        0.62,
    );
    draw_collection_qr(
        page,
        code,
        (place.x, place.y),
        place.size,
        COLLECTION_QR_MODULE_MM,
    )?;
    page.centred_text(
        font,
        "COLLECTION QR",
        TextBox {
            left: place.x,
            top: place.y + place.size + 0.3,
            width: place.size,
        },
        (layout.metrics.font_size, MINIMUM_FONT),
        "QR caption",
        palette.muted,
    )?;
    Ok(())
}

/// What a frame names.
struct FrameTexts<'a> {
    presentation: &'a CardPresentation,
    title: &'a str,
    series: &'a str,
    prepared_for: &'a str,
}

/// The line that names the person a set of cards is prepared for.
#[must_use]
pub fn prepared_for_line(name: &str) -> String {
    format!("Prepared for {name}")
}

/// A restrained proposal frame surrounds the existing artwork without altering it.
fn draw_study_frame(
    page: &mut Page,
    font: &UiFont,
    layout: &StudyLayout,
    texts: &FrameTexts<'_>,
    code: Option<&Matrix>,
    theme: StudyTheme,
) -> Result<(), SheetError> {
    let &StudyLayout {
        width,
        height,
        compact,
        metrics,
        ..
    } = layout;
    let palette = palette_of(theme);
    let whole = PointRect {
        x: 0.0,
        y: 0.0,
        width: page.width,
        height: page.height,
    };
    page.fill_rect(whole, palette.background, 1.0);
    match palette.backdrop {
        Backdrop::Material(backdrop) => {
            draw_material_backdrop(page, backdrop, width, height, layout.grid);
        }
        Backdrop::Map(colours) => draw_world_map(page, colours, (width, height), metrics.margin),
    }
    // A QR code occupies the top right corner. On a sheet the heading stays centred on the page and
    // clear of the code on both sides; a card-sized page only has room beside the code.
    let reserved = layout.qr.map_or(0.0, |qr| qr.size + metrics.margin);
    let spare = if compact { reserved } else { 2.0 * reserved };
    let heading_width = width - 2.0 * metrics.margin - spare;
    let heading_left = if compact {
        metrics.margin
    } else {
        (width - heading_width) / 2.0
    };
    let presentation = texts.presentation;
    let heading = metrics.font_size * metrics.heading_scale;
    let subtitle = if compact {
        presentation.subtitle.clone()
    } else {
        format!(
            "{}  {}",
            presentation.subtitle,
            prepared_for_line(texts.prepared_for)
        )
    };
    // The label names the text in the refusal when it does not fit.
    let lines: [(&str, &str, f64, f64, Rgb); 3] = [
        (
            "The studio name or title",
            texts.title,
            metrics.rows.title,
            metrics.title_size,
            palette.ink,
        ),
        (
            "Study heading",
            "DESIGN STUDY / FOR SELECTION",
            metrics.rows.kind,
            heading,
            palette.muted,
        ),
        (
            "The line with the subtitle and the name",
            &subtitle,
            metrics.rows.subtitle,
            heading,
            palette.muted,
        ),
    ];
    for (label, value, top, preferred, color) in lines {
        let place = TextBox {
            left: heading_left,
            top,
            width: heading_width,
        };
        let sizes = (preferred, metrics.frame_minimum_font);
        page.centred_text(font, value, place, sizes, label, color)?;
    }
    if let Some(rule) = metrics.rows.rule {
        let rule_width = (heading_width * 0.4).min(40.0);
        let from = page.point((width - rule_width) / 2.0, rule);
        let to = page.point((width + rule_width) / 2.0, rule);
        page.line(from, to, palette.muted, 0.4, 0.55);
    }
    // The slogan shares the footer line, where nothing crosses it.
    let series = format!("Series {} / 01", texts.series);
    let slogan = if compact { "" } else { &presentation.slogan };
    let footer: Vec<&str> = [slogan, &series, &presentation.footer]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();
    page.centred_text(
        font,
        &footer.join("   |   "),
        TextBox {
            left: metrics.margin,
            top: height - metrics.footer_baseline,
            width: width - 2.0 * metrics.margin,
        },
        (
            metrics.font_size * metrics.footer_scale,
            metrics.frame_minimum_font,
        ),
        "Study footer",
        palette.muted,
    )?;
    match code {
        Some(code) => draw_sheet_qr(page, font, layout, code, &palette),
        None => Ok(()),
    }
}

/// The shadow and the thin edge round a card's picture in `place` on a sheet.
fn draw_study_shadow(page: &mut Page, place: MmRect, theme: StudyTheme) {
    let palette = palette_of(theme);
    // The shadow falls to the lower right; the edge shows round the card.
    let shadow = page.rect(MmRect {
        x: place.x + 0.45,
        y: place.y + 0.7,
        ..place
    });
    page.fill_rect(shadow, BLACK, palette.shadow_opacity);
    let edge = page.rect(place.outset(CARD_EDGE_MM));
    page.fill_rect(edge, palette.card_edge, 0.88);
}

/// Draws the caption `lines` of the card in `place` of `layout`, each line centred in the caption
/// column, at the layout's caption size or smaller where it must be, down to [`MINIMUM_FONT`].
fn draw_study_caption(
    page: &mut Page,
    font: &UiFont,
    layout: &StudyLayout,
    place: &StudyBox,
    lines: &[String],
    theme: StudyTheme,
) -> Result<(), SheetError> {
    let palette = palette_of(theme);
    for (index, value) in lines.iter().enumerate() {
        let color = if index == 0 {
            palette.caption
        } else {
            palette.caption_muted
        };
        page.centred_text(
            font,
            value,
            TextBox {
                left: place.caption_x,
                top: place.caption_top + index as f64 * layout.metrics.line_height,
                width: place.caption_width,
            },
            (layout.metrics.font_size, MINIMUM_FONT),
            "Study reference",
            color,
        )?;
    }
    Ok(())
}

/// Whether the sheet holds a QR code of the whole backup, a share's, which only `qr_card` asks for.
fn whole_share_qr(cards: &ColorCards) -> bool {
    cards.kind.whole_backup_qr() && cards.qr_card
}

/// The text of the collection's QR code where the cards ask for one.
#[must_use]
pub fn collection_payload(cards: &ColorCards) -> Option<&str> {
    (cards.settings.card_qr || whole_share_qr(cards)).then_some(cards.codes.payload.as_str())
}

/// The separate card that a renderer is asked for: `index`, or none, a sheet, where the content asks
/// for a share's whole-share QR code, which only a sheet prints. An index that is not one of the
/// cards is refused first, also where the sheet is drawn.
pub fn separate_card_index(
    cards: &ColorCards,
    index: Option<usize>,
) -> Result<Option<usize>, SheetError> {
    if let Some(index) = index {
        cards.check_index(index)?;
    }
    Ok(if whole_share_qr(cards) { None } else { index })
}

/// What [`draw_collection_study`] draws a family's collection sheet from.
pub struct CollectionStudy<'a> {
    /// The font of the frame and of the captions.
    pub font: &'a UiFont,
    /// What the sheet is of: its title, its series, its settings and the text of its QR code.
    pub cards: &'a ColorCards,
    /// The texts of the frame.
    pub presentation: &'a CardPresentation,
    /// The name of the person the sheet is prepared for.
    pub prepared_for: &'a str,
    /// The backdrop of the sheet and the colours of its frame, shadows and captions.
    pub theme: StudyTheme,
    /// The shape of a card's box, width over height.
    pub aspect: f64,
    /// The lines under each card, in the order of the cards.
    pub captions: Vec<Vec<String>>,
    /// Where the picture of a card lies in its box, which the shadow follows; the box by default.
    pub picture_area: Option<&'a dyn Fn(&StudyBox) -> MmRect>,
}

/// Draws the collection sheet of `study` on a new page: the frame, then for each card its shadow,
/// `paint` and its caption. Every family of cards draws its sheet with it.
pub fn draw_collection_study(
    study: &CollectionStudy<'_>,
    paint: &mut dyn FnMut(&mut Page, &StudyBox) -> Result<(), SheetError>,
) -> Result<Page, SheetError> {
    let &CollectionStudy {
        font, cards, theme, ..
    } = study;
    // One matrix for the room that the layout keeps and for the code drawn in it.
    let code = collection_payload(cards).map(matrix).transpose()?;
    // The captions decide how narrow a column may be, and how many lines they take in it.
    let room = StudyCaptions::new(font, &study.captions);
    let layout = collection_sheet_layout(&LayoutRequest {
        size: PageSize::resolve(cards.settings.page_size, false),
        orientation: cards.settings.orientation,
        count: study.captions.len(),
        aspect: study.aspect,
        caption_lines: &|width, size| room.lines(width, size),
        code: code.as_ref(),
        minimum_caption_width: room.minimum_width(),
    })?;
    let mut page = Page::new(layout.width, layout.height);
    let title = cards
        .title
        .as_deref()
        .unwrap_or(&study.presentation.studio_name);
    let texts = FrameTexts {
        presentation: study.presentation,
        title,
        series: cards.series(),
        prepared_for: study.prepared_for,
    };
    draw_study_frame(&mut page, font, &layout, &texts, code.as_ref(), theme)?;
    for place in &layout.cards {
        let picture = study
            .picture_area
            .map_or_else(|| place.rect(), |area| area(place));
        draw_study_shadow(&mut page, picture, theme);
        paint(&mut page, place)?;
        let lines = room.wrapped(place.index, place.caption_width, layout.metrics.font_size);
        draw_study_caption(&mut page, font, &layout, place, &lines, theme)?;
    }
    Ok(page)
}
