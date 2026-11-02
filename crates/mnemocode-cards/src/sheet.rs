//! The layout of a collection sheet, in millimetres (MnemoCode TS 0.1.0's
//! `export/collection-layout.ts`, CAP-CARDS-SHEET-LAYOUT): how many cards fit a page of a size and
//! in which grid, where each card and its caption go, and the plan of the pages of a set of cards;
//! `frame` draws the sheet that it lays out.

pub mod backdrops;
pub mod frame;
mod world_map;

use std::fmt;

use mnemocode::qr::{Matrix, QR_QUIET_MODULES, QrError};
use mnemocode::refusal::Refusal;

use crate::content::ContentError;
use crate::scene::{FitError, MM, MmRect, UiFont, centred_run_start, run_cell_size};
use crate::settings::{Orientation, PageSize};

/// The side of one module of a sheet's QR code, in millimetres.
pub const COLLECTION_QR_MODULE_MM: f64 = 0.3;
/// The least side of a sheet's QR code, in millimetres: its caption, COLLECTION QR, is 11.5 mm wide
/// at the least size that a sheet prints, and the code of 24 Unicode codes is smaller than that.
const COLLECTION_QR_MINIMUM_MM: f64 = 12.0;
/// The smallest size, in points, that a sheet prints: the captions, the QR caption and the frame of
/// a card-sized page. Captions are measured at it, so that a column the layout accepts never
/// refuses its caption.
pub const MINIMUM_FONT: f64 = 4.0;
/// Millimetres added to a caption's measured width, so that turning the column's millimetres back
/// into points never leaves the caption a rounding error below [`MINIMUM_FONT`].
const CAPTION_WIDTH_SLACK_MM: f64 = 0.1;
/// The smallest size of the frame of a sheet of A size, in points.
const SHEET_FRAME_MINIMUM_FONT: f64 = 4.5;
/// How far the plate behind the QR code reaches beyond it on each side, in millimetres.
pub const QR_PLATE_MARGIN: f64 = 0.6;
/// The least height of a card's picture on a sheet, in millimetres: below it no design shows.
const MINIMUM_CARD_HEIGHT: f64 = 2.0;
/// The most cards that one sheet lays out: more than the 33 Unicode codes of the longest share with
/// the most decoys.
pub const MAX_SHEET_CARDS: usize = 64;
/// The most cards in one row of a sheet.
const MAX_COLUMNS: usize = 10;
/// The fewest rows of a sheet where they fit: two long rows leave the page empty above and below.
pub const MIN_SHEET_ROWS: usize = 3;
/// The order in which a sheet's plan prefers grids, as a person is told it.
pub const SHEET_PLAN_TEXT: &str = "at least three rows, the largest cards";
/// How much larger, as a share of its area, a card of one plan must be to win over another: less is
/// a rounding error, and then more cards and the page's own orientation win.
const LARGER_CARD: f64 = 0.001;

/// What a sheet refuses.
#[derive(Debug)]
pub enum SheetError {
    /// A QR code that cannot fit on the page.
    QrCannotFit,
    /// No room for one card on the page.
    NoRoom,
    /// More cards than a sheet holds.
    TooManyCards,
    /// A layout that a sheet cannot be drawn from.
    InvalidLayout,
    /// Modules of a QR code too small to print.
    QrModuleSize,
    /// A QR code too small to read.
    QrTooSmall,
    /// A QR code outside the page.
    QrOutside,
    /// A text that does not fit.
    Fit(FitError),
    /// What the content of the cards refuses.
    Content(ContentError),
    /// What the QR code refuses.
    Qr(QrError),
    /// What a family of cards refuses while the sheet draws or measures its cards.
    Design(Box<dyn Refusal + Send + Sync>),
}

impl fmt::Display for SheetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::QrCannotFit => {
                f.write_str("The QR cannot fit on the design study; choose a larger page size.")
            }
            Self::NoRoom => f.write_str(
                "The cards and their codes cannot fit legibly on this page; choose a larger page size, such as A6.",
            ),
            Self::TooManyCards => write!(f, "A sheet holds at most {MAX_SHEET_CARDS} cards."),
            Self::InvalidLayout => f.write_str("Invalid design study layout."),
            Self::QrModuleSize => {
                f.write_str("The QR module size must be a positive physical measurement.")
            }
            Self::QrTooSmall => {
                f.write_str("The QR is too small for this payload; use a larger page.")
            }
            Self::QrOutside => f.write_str("The QR does not fit on this page."),
            Self::Fit(error) => error.fmt(f),
            Self::Content(error) => error.fmt(f),
            Self::Qr(error) => error.fmt(f),
            Self::Design(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for SheetError {}

impl Refusal for SheetError {
    fn code(&self) -> &'static str {
        match self {
            Self::QrCannotFit => {
                "export.collection-layout.qr-cannot-fit-on-design-study-choose-larger"
            }
            Self::NoRoom => "export.collection-layout.no-room",
            Self::TooManyCards => "export.collection-layout.sheet-holds-at-most-cards",
            Self::InvalidLayout => "export.collection-layout.invalid-design-study-layout",
            Self::QrModuleSize => "export.card-qr.qr-module-size-positive-physical-measurement",
            Self::QrTooSmall => "export.card-qr.qr-too-small-payload-use-larger-page",
            Self::QrOutside => "export.card-qr.qr-does-not-fit-on-page",
            Self::Fit(error) => error.code(),
            Self::Content(error) => error.code(),
            Self::Qr(error) => error.code(),
            Self::Design(error) => error.code(),
        }
    }
}

impl From<FitError> for SheetError {
    fn from(error: FitError) -> Self {
        Self::Fit(error)
    }
}

impl From<ContentError> for SheetError {
    fn from(error: ContentError) -> Self {
        Self::Content(error)
    }
}

impl From<QrError> for SheetError {
    fn from(error: QrError) -> Self {
        Self::Qr(error)
    }
}

/// Where one card of a sheet goes, and where its caption goes below it, in millimetres.
#[derive(Clone, Copy, Debug)]
pub struct StudyBox {
    /// The card's place among the cards of the content, counted from 0.
    pub index: usize,
    /// From the left of the page.
    pub x: f64,
    /// From the top of the page.
    pub y: f64,
    /// Its width.
    pub width: f64,
    /// Its height.
    pub height: f64,
    /// The top of the caption's first line, from the top edge of the page.
    pub caption_top: f64,
    /// The width of the caption's column: its whole cell, at least the card's.
    pub caption_width: f64,
    /// The left edge of the caption's column.
    pub caption_x: f64,
}

impl StudyBox {
    /// The card's box.
    #[must_use]
    pub const fn rect(&self) -> MmRect {
        MmRect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

/// The tops of a heading's lines and of the rule under it, from the top edge.
#[derive(Clone, Copy, Debug)]
pub struct HeadingRows {
    /// The title.
    pub title: f64,
    /// The line under the title.
    pub kind: f64,
    /// The line under that.
    pub subtitle: f64,
    /// Absent where the heading has no rule under it: a card-sized page has no room for one.
    pub rule: Option<f64>,
}

/// The measures of a sheet of one page size, in millimetres and points.
#[derive(Clone, Copy, Debug)]
pub struct StudyMetrics {
    /// The margin around the page.
    pub margin: f64,
    /// The room of the heading at the top of the page, which no card enters.
    pub heading_height: f64,
    /// The room of the footer at the bottom of the page, which no card enters.
    pub footer: f64,
    /// The size of the captions, in points.
    pub font_size: f64,
    /// The height of one caption line.
    pub line_height: f64,
    /// The room between two cards, and between the cards and the QR code.
    pub gap: f64,
    /// The room that a caption adds below its lines.
    pub caption_pad: f64,
    /// The distance of a caption's first line below its card.
    pub caption_offset: f64,
    /// The lines of the heading.
    pub rows: HeadingRows,
    /// The size of the title, in points.
    pub title_size: f64,
    /// The size of the heading's two smaller lines, as a share of the caption size.
    pub heading_scale: f64,
    /// The size of the footer line, as a share of the caption size.
    pub footer_scale: f64,
    /// The top of the footer line, from the bottom edge.
    pub footer_baseline: f64,
    /// The least size of the heading and the footer, in points.
    pub frame_minimum_font: f64,
}

/// The measures of a sheet of `size`: a card-sized page is laid out tighter than a sheet, an A4
/// sheet larger; the approved sheets were drawn with these numbers.
const fn metrics_of(size: PageSize) -> StudyMetrics {
    match size {
        PageSize::Business => StudyMetrics {
            margin: 3.0,
            heading_height: 11.0,
            footer: 4.5,
            font_size: 4.3,
            line_height: 2.1,
            gap: 1.5,
            caption_pad: 0.6,
            caption_offset: 0.5,
            rows: HeadingRows {
                title: 1.8,
                kind: 5.4,
                subtitle: 7.5,
                rule: None,
            },
            title_size: 8.0,
            // A card-sized page already prints its frame at the caption size.
            heading_scale: 1.0,
            footer_scale: 1.0,
            footer_baseline: 3.0,
            frame_minimum_font: MINIMUM_FONT,
        },
        PageSize::A6 => StudyMetrics {
            margin: 5.0,
            heading_height: 23.0,
            footer: 9.0,
            font_size: 6.0,
            line_height: 3.0,
            gap: 3.0,
            caption_pad: 1.2,
            caption_offset: 1.0,
            rows: HeadingRows {
                title: 5.5,
                kind: 12.0,
                subtitle: 15.4,
                rule: Some(19.4),
            },
            title_size: 13.0,
            heading_scale: 0.95,
            footer_scale: 0.9,
            footer_baseline: 5.2,
            frame_minimum_font: SHEET_FRAME_MINIMUM_FONT,
        },
        PageSize::A5 => StudyMetrics {
            margin: 7.0,
            heading_height: 28.0,
            footer: 11.0,
            font_size: 7.0,
            line_height: 3.5,
            gap: 4.5,
            caption_pad: 1.2,
            caption_offset: 1.0,
            rows: HeadingRows {
                title: 7.2,
                kind: 15.2,
                subtitle: 19.4,
                rule: Some(23.7),
            },
            title_size: 16.0,
            heading_scale: 0.95,
            footer_scale: 0.9,
            footer_baseline: 6.3,
            frame_minimum_font: SHEET_FRAME_MINIMUM_FONT,
        },
        PageSize::A4 => StudyMetrics {
            margin: 10.0,
            heading_height: 33.0,
            footer: 13.0,
            font_size: 8.0,
            line_height: 4.0,
            gap: 6.0,
            caption_pad: 1.2,
            caption_offset: 1.0,
            rows: HeadingRows {
                title: 9.0,
                kind: 18.5,
                subtitle: 23.5,
                rule: Some(28.0),
            },
            title_size: 19.0,
            heading_scale: 0.95,
            footer_scale: 0.9,
            footer_baseline: 7.5,
            frame_minimum_font: SHEET_FRAME_MINIMUM_FONT,
        },
    }
}

/// The pitch of the cards on a sheet, from the top left corner of the page: the middle of the gap
/// before the first column and above the first row, and how far one column or row is from the
/// next. A backdrop lays its joints out by it, so that they run between the cards.
#[derive(Clone, Copy, Debug)]
pub struct CardGrid {
    /// Before the first column.
    pub left: f64,
    /// Above the first row.
    pub top: f64,
    /// From one column to the next.
    pub column_pitch: f64,
    /// From one row to the next.
    pub row_pitch: f64,
}

/// The place of a sheet's QR code: its top left corner and its side, quiet zone included.
#[derive(Clone, Copy, Debug)]
pub struct QrPlace {
    /// From the left of the page.
    pub x: f64,
    /// From the top of the page.
    pub y: f64,
    /// Its side.
    pub size: f64,
}

/// The layout of a collection sheet.
#[derive(Clone, Debug)]
pub struct StudyLayout {
    /// The size of the page in its orientation.
    pub width: f64,
    /// See `width`.
    pub height: f64,
    /// The cards in a full row.
    pub columns: usize,
    /// The rows of cards; the last one may hold fewer than `columns`.
    pub rows: usize,
    /// Its measures.
    pub metrics: StudyMetrics,
    /// A card-sized page: the heading sits beside the QR code, without a rule or a slogan.
    pub compact: bool,
    /// The box of each card and its caption, in the order of the cards.
    pub cards: Vec<StudyBox>,
    /// The grid of the cards.
    pub grid: CardGrid,
    /// The sheet's QR code; absent where it prints none.
    pub qr: Option<QrPlace>,
}

/// A grid of a sheet: its columns and rows, the width of a cell, its card's and caption's height.
#[derive(Clone, Copy)]
struct SheetGrid {
    columns: usize,
    rows: usize,
    cell_width: f64,
    image_height: f64,
    caption_height: f64,
}

/// The side of the QR code `code`, quiet zone included, for modules `module_mm` wide, at least
/// `minimum`.
pub fn qr_size_for_module(code: &Matrix, minimum: f64, module_mm: f64) -> Result<f64, SheetError> {
    if !module_mm.is_finite() || module_mm <= 0.0 {
        return Err(SheetError::QrModuleSize);
    }
    Ok(minimum.max((code.size() + QR_QUIET_MODULES * 2) as f64 * module_mm))
}

/// The room left for the cards: its width and height and where it starts.
struct Room {
    qr: Option<QrPlace>,
    width: f64,
    height: f64,
    top: f64,
}

/// Where the sheet's QR code goes, if it prints one, and the room that is left for the cards on a
/// page `width` by `height` mm: below the code, or beside it on a card-sized page that is wide.
fn room_for_cards(
    (width, height): (f64, f64),
    metrics: &StudyMetrics,
    compact: bool,
    code: Option<&Matrix>,
) -> Result<Room, SheetError> {
    let &StudyMetrics {
        margin,
        heading_height,
        footer,
        line_height,
        gap,
        ..
    } = metrics;
    let mut room = Room {
        qr: None,
        width: width - margin * 2.0,
        height: height - heading_height - footer,
        top: heading_height,
    };
    let Some(code) = code else {
        return Ok(room);
    };
    let size = qr_size_for_module(code, COLLECTION_QR_MINIMUM_MM, COLLECTION_QR_MODULE_MM)?;
    // Raised into the corner of the heading, so that the code and its caption end above the cards
    // where they fit: a low sheet would otherwise show two long rows with empty bands around them.
    let qr = QrPlace {
        x: width - margin - size,
        y: margin / 2.0,
        size,
    };
    if qr.x < margin || qr.y + qr.size + line_height >= height - footer {
        return Err(SheetError::QrCannotFit);
    }
    if compact && width >= height {
        // A card-sized page is too low to place the cards below the QR code; they sit beside it.
        room.width -= size + gap * 2.0;
    } else {
        // The cards start below the QR code, so they stay centred under the heading.
        room.top = heading_height.max(qr.y + size + line_height + gap);
        room.height = height - room.top - footer;
    }
    room.qr = Some(qr);
    Ok(room)
}

/// Whether a grid of `rows` rows has enough of them: always on a card-sized page.
const fn has_enough_rows(rows: usize, compact: bool) -> bool {
    compact || rows >= MIN_SHEET_ROWS
}

/// What a grid is chosen by.
struct GridRules<'a> {
    metrics: &'a StudyMetrics,
    compact: bool,
    lines_in: &'a dyn Fn(f64, f64) -> usize,
    minimum_caption_width: f64,
}

/// The grid of `count` cards of `aspect` with the largest cards in `room`: of the column counts
/// whose rows are all full and that have enough rows; else of those whose rows are all full; and
/// only where no such count fits, of any.
fn largest_grid(
    count: usize,
    aspect: f64,
    room: &Room,
    rules: &GridRules<'_>,
) -> Result<SheetGrid, SheetError> {
    let StudyMetrics {
        gap,
        line_height,
        font_size,
        caption_pad,
        ..
    } = *rules.metrics;
    let mut grids = Vec::new();
    for columns in 1..=count.min(MAX_COLUMNS) {
        let rows = count.div_ceil(columns);
        let cell_width = run_cell_size(room.width, columns, gap);
        if cell_width < rules.minimum_caption_width {
            continue;
        }
        // The narrower the column, the more caption lines may take two lines each.
        let lines = (rules.lines_in)(cell_width, font_size);
        let caption_height = lines as f64 * line_height + caption_pad;
        let image_height =
            (cell_width / aspect).min(run_cell_size(room.height, rows, gap) - caption_height);
        if image_height > MINIMUM_CARD_HEIGHT {
            grids.push(SheetGrid {
                columns,
                rows,
                cell_width,
                image_height,
                caption_height,
            });
        }
    }
    let full: Vec<SheetGrid> = grids
        .iter()
        .copied()
        .filter(|grid| count.is_multiple_of(grid.columns))
        .collect();
    let tall: Vec<SheetGrid> = full
        .iter()
        .copied()
        .filter(|grid| has_enough_rows(grid.rows, rules.compact))
        .collect();
    let from = if !tall.is_empty() {
        &tall
    } else if !full.is_empty() {
        &full
    } else {
        &grids
    };
    // The largest card, the first such grid on a tie; every card has the same aspect.
    from.iter()
        .copied()
        .fold(None, |chosen: Option<SheetGrid>, grid| match chosen {
            Some(best) if grid.image_height <= best.image_height => Some(best),
            _ => Some(grid),
        })
        .ok_or(SheetError::NoRoom)
}

/// What a layout is asked for.
pub struct LayoutRequest<'a> {
    /// The page of the sheet.
    pub size: PageSize,
    /// How it is turned; none for the one with the most room.
    pub orientation: Option<Orientation>,
    /// The cards.
    pub count: usize,
    /// The shape of a card's box, width over height.
    pub aspect: f64,
    /// How many lines each caption is given room for, in a column of a width at a size in points.
    pub caption_lines: &'a dyn Fn(f64, f64) -> usize,
    /// The QR code that the sheet prints, if any.
    pub code: Option<&'a Matrix>,
    /// The least width of a column.
    pub minimum_caption_width: f64,
}

/// A collection is a single design proposal, never a stack of duplex print cards.
pub fn collection_sheet_layout(request: &LayoutRequest<'_>) -> Result<StudyLayout, SheetError> {
    let &LayoutRequest {
        size,
        orientation,
        count,
        aspect,
        ..
    } = request;
    if count > MAX_SHEET_CARDS {
        return Err(SheetError::TooManyCards);
    }
    if count < 1 || aspect <= 0.0 {
        return Err(SheetError::InvalidLayout);
    }
    let (width, height) = size.dimensions(orientation);
    // Ordinary cards of the business size are separate cards and never come here: the compact sheet
    // exists for the QR card of one Shamir share, which is offered in every size.
    let compact = size == PageSize::Business;
    let metrics = metrics_of(size);
    let StudyMetrics { margin, gap, .. } = metrics;
    let room = room_for_cards((width, height), &metrics, compact, request.code)?;
    let rules = GridRules {
        metrics: &metrics,
        compact,
        lines_in: request.caption_lines,
        minimum_caption_width: request.minimum_caption_width,
    };
    let SheetGrid {
        columns,
        rows,
        cell_width,
        image_height,
        caption_height,
    } = largest_grid(count, aspect, &room, &rules)?;
    let cell_height = image_height + caption_height;
    // The columns share the width out in equal cells. The rows share the height out evenly: the room
    // left beyond them goes in equal parts above, between and below them, so that the cards fill the
    // page symmetrically rather than stand as one block in its middle.
    let rows_float = rows as f64;
    let spare = (room.height - rows_float * cell_height - (rows_float - 1.0) * gap).max(0.0);
    let row_gap = gap + spare / (rows_float + 1.0);
    let top = room.top + spare / (rows_float + 1.0);
    let cards = (0..count)
        .map(|index| {
            let row = index / columns;
            let row_count = columns.min(count - row * columns);
            let caption_x = margin
                + centred_run_start(room.width, row_count, cell_width, gap)
                + (index % columns) as f64 * (cell_width + gap);
            let y = top + row as f64 * (cell_height + row_gap);
            let card_width = image_height * aspect;
            StudyBox {
                index,
                x: caption_x + (cell_width - card_width) / 2.0,
                y,
                width: card_width,
                height: image_height,
                caption_x,
                caption_width: cell_width,
                caption_top: y + image_height + metrics.caption_offset,
            }
        })
        .collect();
    Ok(StudyLayout {
        width,
        height,
        columns,
        rows,
        metrics,
        compact,
        cards,
        // The middle of the gap before the first full row's first card and above the first row.
        grid: CardGrid {
            left: margin + centred_run_start(room.width, columns, cell_width, gap) - gap / 2.0,
            top: top - row_gap / 2.0,
            column_pitch: cell_width + gap,
            row_pitch: cell_height + row_gap,
        },
        qr: room.qr,
    })
}

/// What the sheet of a design is planned from.
pub struct SheetShape<'a> {
    /// The font that the captions are measured in, as the sheet draws them.
    pub font: &'a UiFont,
    /// The shape of a card's box, width over height.
    pub aspect: f64,
    /// The lines under each of the first cards of a count; refused where the design cannot show so
    /// many, such as more codes than a material has samples.
    pub captions: &'a dyn Fn(usize) -> Result<Vec<Vec<String>>, SheetError>,
}

/// How many cards a sheet holds, decoys included, and how it is turned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SheetPlan {
    /// The cards of the sheet, decoys included: more than the backup's own, in full rows.
    pub count: usize,
    /// The orientation given, or the one whose plan won.
    pub orientation: Orientation,
}

/// The sheet for `own` codes of a backup in the design `shape`, on `size`: at least one decoy, at
/// most `most` cards in all, all rows full, enough rows where they fit, and the largest cards. The
/// orientation is `given`, or the one whose plan wins by the same rules; on a tie of sizes, more
/// cards. Where no count of cards fits, the first refusal of a layout or of its captions, or
/// [`SheetError::NoRoom`].
pub fn plan_collection_sheet(
    (size, given): (PageSize, Option<Orientation>),
    own: usize,
    most: usize,
    shape: &SheetShape<'_>,
    code: Option<&Matrix>,
) -> Result<SheetPlan, SheetError> {
    struct Best {
        plan: SheetPlan,
        area: f64,
        tall: bool,
    }
    let first = size.own_orientation();
    let orientations = match given {
        Some(orientation) => vec![orientation],
        None => {
            let mut all = vec![first];
            all.extend(Orientation::ALL.into_iter().filter(|other| *other != first));
            all
        }
    };
    let mut best: Option<Best> = None;
    let mut refusal = None;
    for orientation in orientations {
        for count in own + 1..=most.min(MAX_SHEET_CARDS) {
            // Measured as the sheet measures them, so that it draws this plan.
            let laid_out = (shape.captions)(count).and_then(|captions| {
                let room = StudyCaptions::new(shape.font, &captions);
                collection_sheet_layout(&LayoutRequest {
                    size,
                    orientation: Some(orientation),
                    count,
                    aspect: shape.aspect,
                    caption_lines: &|width, line_size| room.lines(width, line_size),
                    code,
                    minimum_caption_width: room.minimum_width(),
                })
            });
            let layout = match laid_out {
                Ok(layout) => layout,
                Err(error) => {
                    refusal.get_or_insert(error);
                    continue;
                }
            };
            if !count.is_multiple_of(layout.columns) {
                continue;
            }
            let area = layout.cards[0].width * layout.cards[0].height;
            // A sheet of enough rows wins over one of fewer whatever their cards.
            let tall = has_enough_rows(layout.rows, layout.compact);
            let wins = best.as_ref().is_none_or(|best| {
                // Of cards as large, the plan with more of them, which fills more of the page.
                let larger = area > best.area * (1.0 + LARGER_CARD);
                let as_large = !larger && area >= best.area * (1.0 - LARGER_CARD);
                (tall && !best.tall)
                    || (tall == best.tall && (larger || (as_large && count > best.plan.count)))
            });
            if wins {
                best = Some(Best {
                    plan: SheetPlan { count, orientation },
                    area,
                    tall,
                });
            }
        }
    }
    best.map(|best| best.plan)
        .ok_or_else(|| refusal.unwrap_or(SheetError::NoRoom))
}

/// One line of a caption, measured in points at 1 pt, and the halves it may be split into.
struct MeasuredLine {
    text: String,
    width: f64,
    /// The two halves that balance best, split at a space, and the wider half's width.
    halves: Option<([String; 2], f64)>,
}

/// `text` with the two halves that balance best, split at a space.
fn measured_line(text: &str, font: &UiFont) -> MeasuredLine {
    let words: Vec<&str> = text.split(' ').filter(|word| !word.is_empty()).collect();
    let mut halves: Option<([String; 2], f64)> = None;
    for cut in 1..words.len() {
        let texts = [words[..cut].join(" "), words[cut..].join(" ")];
        let width = font.width(&texts[0], 1.0).max(font.width(&texts[1], 1.0));
        if halves.as_ref().is_none_or(|(_, best)| width < *best) {
            halves = Some((texts, width));
        }
    }
    MeasuredLine {
        text: text.to_owned(),
        width: font.width(text, 1.0),
        halves,
    }
}

/// The captions under the cards of one sheet, measured once: how many lines each takes in a column
/// of a width, and those lines. The first line, the card's number and its code, always stays one
/// line; a later one that would print smaller than the sheet's caption size is split in two at the
/// space that balances the halves best.
pub struct StudyCaptions {
    captions: Vec<Vec<MeasuredLine>>,
    minimum_width: f64,
}

impl StudyCaptions {
    /// The captions `captions`, one list of lines per card, in the order of the cards.
    #[must_use]
    pub fn new(font: &UiFont, captions: &[Vec<String>]) -> Self {
        let captions: Vec<Vec<MeasuredLine>> = captions
            .iter()
            .map(|lines| lines.iter().map(|line| measured_line(line, font)).collect())
            .collect();
        // The narrowest column that still prints every line, split where it may be.
        let mut widest: f64 = 0.0;
        for lines in &captions {
            for (index, line) in lines.iter().enumerate() {
                let parts: Vec<&str> = match &line.halves {
                    Some((texts, width)) if index > 0 && line.width > *width => {
                        texts.iter().map(String::as_str).collect()
                    }
                    _ => vec![line.text.as_str()],
                };
                for part in parts {
                    widest = widest.max(font.width(part, MINIMUM_FONT));
                }
            }
        }
        Self {
            captions,
            minimum_width: widest / MM + CAPTION_WIDTH_SLACK_MM,
        }
    }

    /// The least width of a column in millimetres, below which a caption would not print.
    #[must_use]
    pub const fn minimum_width(&self) -> f64 {
        self.minimum_width
    }

    /// The most lines that a caption takes in a column `width` mm wide at `size` points.
    #[must_use]
    pub fn lines(&self, width: f64, size: f64) -> usize {
        self.captions
            .iter()
            .map(|lines| Self::split(lines, width, size).len())
            .max()
            .unwrap_or(1)
            .max(1)
    }

    /// The lines of the caption of card `index` in a column `width` mm wide at `size` points.
    #[must_use]
    pub fn wrapped(&self, index: usize, width: f64, size: f64) -> Vec<String> {
        self.captions
            .get(index)
            .map_or_else(Vec::new, |lines| Self::split(lines, width, size))
    }

    fn split(lines: &[MeasuredLine], width: f64, size: f64) -> Vec<String> {
        let room = width * MM;
        let mut split = Vec::new();
        for (index, line) in lines.iter().enumerate() {
            match &line.halves {
                Some((texts, _)) if index > 0 && line.width * size > room => {
                    split.extend(texts.iter().cloned());
                }
                _ => split.push(line.text.clone()),
            }
        }
        split
    }
}
