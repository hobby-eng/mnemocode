//! The printed pattern, as a shop's cross-stitch kit lays it out: a cover with the picture and its
//! size, the legend (symbol, a sample of the thread's colour, DMC number, name, stitches and about
//! how many skeins), then the chart in pages of 60 by 80 cells, each cell lightly tinted with its
//! thread's colour under its symbol, a bold line every ten stitches and the numbers along the
//! edges. Nothing on it names MnemoCode or a backup. The PDF holds the legend that holds a phrase,
//! so its bytes are a secret.

mod symbols;

use std::fmt;
use std::rc::Rc;

use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretBytes;
use mnemocode_cards::pdf::{self, PdfError};
use mnemocode_cards::scene::{MM, MmRect, Page, Picture, Pixels, Rgb, Step, UiFont, rgb};

use crate::hide::Hidden;
use crate::legend::SYMBOLS;
use symbols::Cell;

/// An A4 page, in millimetres.
const PAGE: (f64, f64) = (210.0, 297.0);
/// The margin of every page, in millimetres.
const MARGIN: f64 = 12.0;
/// A chart cell's side, in millimetres.
const CELL: f64 = 3.0;
/// Cells across and down one chart page.
const PAGE_CELLS: (usize, usize) = (60, 80);
/// The rows of the legend on one page.
const LEGEND_ROWS: usize = 34;
/// The fabric the finished size is given for: Aida of 14 stitches an inch.
const STITCHES_PER_INCH: f64 = 14.0;
/// Full cross stitches one skein makes in two strands on 14-count Aida, about.
const STITCHES_PER_SKEIN: u32 = 1800;
/// The ink of text and lines.
const INK: Rgb = rgb(0.1, 0.1, 0.1);
/// The faint lines between cells.
const GRID: Rgb = rgb(0.62, 0.62, 0.62);
/// The white of the page.
const WHITE: Rgb = rgb(1.0, 1.0, 1.0);

/// Why the printed pattern could not be made.
#[derive(Debug)]
pub enum ChartError {
    /// The PDF could not be written.
    Pdf(PdfError),
}

impl fmt::Display for ChartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pdf(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ChartError {}

impl Refusal for ChartError {
    fn code(&self) -> &'static str {
        match self {
            Self::Pdf(error) => error.code(),
        }
    }
}

/// The PDF of the pattern of `hidden`: cover, legend and chart pages.
///
/// # Errors
///
/// [`ChartError::Pdf`]: the PDF writer's `export.pdf-documents.font-not-embedded` or
/// `export.pdf-documents.not-written`.
pub fn chart(hidden: &Hidden) -> Result<SecretBytes, ChartError> {
    let font = UiFont::load();
    let mut pages = vec![cover(hidden, &font)];
    pages.extend(legend_pages(hidden, &font));
    pages.extend(chart_pages(hidden, &font));
    pdf::document(&font, &pages).map_err(ChartError::Pdf)
}

/// `text` where the font has every character of it, else `plain`.
fn printable<'a>(font: &UiFont, text: &'a str, plain: &'a str) -> &'a str {
    if font.has_every_character(text) {
        text
    } else {
        plain
    }
}

/// The colour of a thread's sRGB bytes.
fn color_of([r, g, b]: [u8; 3]) -> Rgb {
    rgb(
        f64::from(r) / 255.0,
        f64::from(g) / 255.0,
        f64::from(b) / 255.0,
    )
}

/// `color` mixed with white, `share` of the colour kept.
fn tint(color: Rgb, share: f64) -> Rgb {
    rgb(
        color.red * share + 1.0 - share,
        color.green * share + 1.0 - share,
        color.blue * share + 1.0 - share,
    )
}

/// Black or white, whichever stands out on `color`.
fn ink_on(color: Rgb) -> Rgb {
    let luma = 0.299 * color.red + 0.587 * color.green + 0.114 * color.blue;
    if luma > 0.5 { INK } else { WHITE }
}

/// The cover: title, size and the picture as stitched.
fn cover(hidden: &Hidden, font: &UiFont) -> Page {
    let pattern = hidden.pattern();
    let (w, h) = (pattern.width(), pattern.height());
    let mut page = Page::new(PAGE.0, PAGE.1);
    page.text(font, "Cross-stitch pattern", (MARGIN, MARGIN), 18.0, INK);
    let times = printable(font, "×", "x");
    let inches = |stitches: usize| stitches as f64 / STITCHES_PER_INCH * 2.54;
    let lines = [
        format!(
            "Design size: {w} {times} {h} stitches, {} colours",
            pattern.thread_count()
        ),
        format!(
            "Finished size on 14-count Aida: {:.1} {times} {:.1} cm",
            inches(w),
            inches(h)
        ),
        "Full cross stitch in two strands; each cell of the chart is one stitch.".to_owned(),
    ];
    for (i, line) in lines.iter().enumerate() {
        page.text(
            font,
            line,
            (MARGIN, MARGIN + 11.0 + 6.0 * i as f64),
            10.0,
            INK,
        );
    }
    let threads: Vec<[u8; 3]> = pattern.threads().map(|t| t.rgb()).collect();
    let mut data = Vec::with_capacity(w * h * 3);
    for &cell in pattern.cells() {
        data.extend(threads[usize::from(cell)]);
    }
    let picture = Rc::new(Picture {
        width: u32::try_from(w).unwrap_or(u32::MAX),
        height: u32::try_from(h).unwrap_or(u32::MAX),
        pixels: Pixels::Rgb { data, alpha: None },
    });
    let (box_w, box_h) = (PAGE.0 - 2.0 * MARGIN, PAGE.1 - 2.0 * MARGIN - 34.0);
    let scale = (box_w / w as f64).min(box_h / h as f64);
    let (pw, ph) = (w as f64 * scale, h as f64 * scale);
    let place = page.rect(MmRect {
        x: MARGIN + (box_w - pw) / 2.0,
        y: MARGIN + 34.0,
        width: pw,
        height: ph,
    });
    page.steps.push(Step::Image { picture, place });
    page
}

/// The legend, [`LEGEND_ROWS`] threads a page.
fn legend_pages(hidden: &Hidden, font: &UiFont) -> Vec<Page> {
    let threads: Vec<_> = hidden.pattern().threads().collect();
    let mut pages = Vec::new();
    for (chunk, rows) in hidden.rows().chunks(LEGEND_ROWS).enumerate() {
        let mut page = Page::new(PAGE.0, PAGE.1);
        page.text(font, "Legend", (MARGIN, MARGIN), 16.0, INK);
        let header = MARGIN + 12.0;
        for (x, label) in [
            (14.0, "Symbol"),
            (36.0, "DMC"),
            (54.0, "Name"),
            (152.0, "Stitches"),
            (178.0, "Skeins"),
        ] {
            page.text(font, label, (x, header), 9.0, INK);
        }
        let first = chunk * LEGEND_ROWS;
        for (i, row) in rows.iter().enumerate() {
            let thread = threads[first + i];
            let top = header + 7.0 + 7.0 * i as f64;
            let symbol = SYMBOLS[row.symbol() - 1];
            let swatch = color_of(thread.rgb());
            let symbol_box = page.rect(MmRect {
                x: 14.0,
                y: top,
                width: 5.0,
                height: 5.0,
            });
            page.fill_rect(symbol_box, WHITE, 1.0);
            symbols::draw(
                &mut page,
                font,
                symbol,
                Cell {
                    x: symbol_box.x,
                    y: symbol_box.y,
                    side: 5.0 * MM,
                },
                INK,
            );
            let swatch_box = page.rect(MmRect {
                x: 22.0,
                y: top,
                width: 5.0,
                height: 5.0,
            });
            page.fill_rect(swatch_box, swatch, 1.0);
            symbols::draw(
                &mut page,
                font,
                symbol,
                Cell {
                    x: swatch_box.x,
                    y: swatch_box.y,
                    side: 5.0 * MM,
                },
                ink_on(swatch),
            );
            page.text(
                font,
                printable(font, thread.number(), "?"),
                (36.0, top + 0.6),
                9.0,
                INK,
            );
            page.text(
                font,
                printable(font, thread.name(), "?"),
                (54.0, top + 0.6),
                9.0,
                INK,
            );
            let stitches = row.stitches().to_string();
            let skeins = row.stitches().div_ceil(STITCHES_PER_SKEIN).to_string();
            right_aligned(&mut page, font, &stitches, 170.0, top + 0.6);
            right_aligned(&mut page, font, &skeins, 192.0, top + 0.6);
        }
        pages.push(page);
    }
    pages
}

/// `text` at 9 points, ending `right` millimetres from the left.
fn right_aligned(page: &mut Page, font: &UiFont, text: &str, right: f64, top: f64) {
    let width = font.width(text, 9.0) / MM;
    page.text(font, text, (right - width, top), 9.0, INK);
}

/// The chart, in pages of [`PAGE_CELLS`], from the top left, row of pages by row of pages.
fn chart_pages(hidden: &Hidden, font: &UiFont) -> Vec<Page> {
    let pattern = hidden.pattern();
    let (w, h) = (pattern.width(), pattern.height());
    let (across, down) = (w.div_ceil(PAGE_CELLS.0), h.div_ceil(PAGE_CELLS.1));
    let colors: Vec<Rgb> = pattern.threads().map(|t| color_of(t.rgb())).collect();
    let symbols: Vec<_> = hidden
        .rows()
        .iter()
        .map(|r| SYMBOLS[r.symbol() - 1])
        .collect();
    let mut pages = Vec::with_capacity(across * down);
    for page_row in 0..down {
        for page_column in 0..across {
            let (x0, y0) = (page_column * PAGE_CELLS.0, page_row * PAGE_CELLS.1);
            let (x1, y1) = ((x0 + PAGE_CELLS.0).min(w), (y0 + PAGE_CELLS.1).min(h));
            let mut page = Page::new(PAGE.0, PAGE.1);
            let dash = printable(font, "–", "-");
            let title = format!(
                "Chart, page {} of {}: stitches {}{dash}{} across, {}{dash}{} down",
                pages.len() + 1,
                across * down,
                x0 + 1,
                x1,
                y0 + 1,
                y1
            );
            page.text(font, &title, (MARGIN, MARGIN), 9.0, INK);
            let origin = (MARGIN + 7.0, MARGIN + 12.0);
            for y in y0..y1 {
                for x in x0..x1 {
                    let thread = usize::from(pattern.cells()[y * w + x]);
                    let place = page.rect(MmRect {
                        x: origin.0 + (x - x0) as f64 * CELL,
                        y: origin.1 + (y - y0) as f64 * CELL,
                        width: CELL,
                        height: CELL,
                    });
                    let background = tint(colors[thread], 0.55);
                    page.fill_rect(place, background, 1.0);
                    let cell = Cell {
                        x: place.x,
                        y: place.y,
                        side: CELL * MM,
                    };
                    symbols::draw(&mut page, font, symbols[thread], cell, ink_on(background));
                }
            }
            grid_lines(&mut page, font, origin, (x0, x1), (y0, y1));
            pages.push(page);
        }
    }
    pages
}

/// The lines between the cells of a chart page, bold every ten stitches, and the numbers of every
/// tenth stitch along the top and the left.
fn grid_lines(
    page: &mut Page,
    font: &UiFont,
    origin: (f64, f64),
    (x0, x1): (usize, usize),
    (y0, y1): (usize, usize),
) {
    let (left, top) = origin;
    let (right, bottom) = (
        left + (x1 - x0) as f64 * CELL,
        top + (y1 - y0) as f64 * CELL,
    );
    for x in x0..=x1 {
        let at = left + (x - x0) as f64 * CELL;
        let bold = x % 10 == 0 || x == x1;
        let (from, to) = (page.point(at, top), page.point(at, bottom));
        page.line(
            from,
            to,
            if bold { INK } else { GRID },
            if bold { 0.7 } else { 0.2 },
            1.0,
        );
        if x % 10 == 0 && x > 0 {
            let label = x.to_string();
            let width = font.width(&label, 6.0) / MM;
            page.text(font, &label, (at - width / 2.0, top - 4.0), 6.0, INK);
        }
    }
    for y in y0..=y1 {
        let at = top + (y - y0) as f64 * CELL;
        let bold = y % 10 == 0 || y == y1;
        let (from, to) = (page.point(left, at), page.point(right, at));
        page.line(
            from,
            to,
            if bold { INK } else { GRID },
            if bold { 0.7 } else { 0.2 },
            1.0,
        );
        if y % 10 == 0 && y > 0 {
            let label = y.to_string();
            let width = font.width(&label, 6.0) / MM;
            page.text(font, &label, (left - width - 1.0, at - 1.0), 6.0, INK);
        }
    }
}
