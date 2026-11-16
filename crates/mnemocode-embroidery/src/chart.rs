//! The pattern as a three-page PDF that looks like one bought from a designer: a cover, the floss
//! key and the chart. Nothing on it names MnemoCode or a backup. The PDF holds the legend, and so
//! the phrase, so its bytes are a secret.

mod cover;
mod symbols;

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::secret::{SecretBytes, SecretText};
use mnemocode_cards::pdf::{self, PdfError};
use mnemocode_cards::scene::{MM, MmRect, Page, Path, Rgb, Segment, UiFont, rgb};

use crate::fabric::{Fabric, Sheet, sheet_for};
use crate::hide::Hidden;
use crate::legend::{self, SYMBOLS};
use crate::pattern::Pattern;
use symbols::Cell;

/// The cover's and the key's A4 page, in millimetres.
const PAGE: (f64, f64) = (210.0, 297.0);
/// The margin at the sides of every page, in millimetres.
const MARGIN: f64 = 12.0;
/// The height of the coloured band at the top of every page, in millimetres.
const BAND: f64 = 16.0;
/// Where the line above the page's number lies, in millimetres from the bottom.
const FOOTER: f64 = 10.0;
/// The pages of the pattern.
const PAGES: usize = 3;
/// The place of the floss key among the pages, whose private data keeps the legend line.
const KEY_PAGE: usize = 1;
/// The name the legend line is kept under in that private data: one a pattern program might use,
/// naming neither MnemoCode nor a backup.
const LEGEND_PIECE: &str = "FlossKey";
/// Where the key's rows start and end, in millimetres from the top of its page.
const ROWS_TOP: f64 = 32.0;
const ROWS_BOTTOM: f64 = PAGE.1 - FOOTER - 3.0;
/// How far apart the key's rows are at most, in millimetres; more rows come closer.
const ROW_PITCH: f64 = 7.0;
/// The side of a key row's symbol and colour sample at most, in millimetres.
const ROW_BOX: f64 = 5.0;
/// The size of a key row's text at most, in points.
const ROW_TEXT: f64 = 9.0;
/// Full cross stitches one skein makes in two strands on 14-count Aida, about; on other fabric in
/// proportion to its count, as a stitch takes thread in proportion to its size, and to how few
/// strands it takes.
const STITCHES_PER_SKEIN: u64 = 1800;
/// The fabric and strands [`STITCHES_PER_SKEIN`] is given for.
const SKEIN_COUNT: u64 = 14;
const SKEIN_STRANDS: u64 = 2;
/// The ink of text and lines.
const INK: Rgb = rgb(0.13, 0.12, 0.11);
/// The ink of what is said in passing.
const MUTED: Rgb = rgb(0.45, 0.42, 0.39);
/// The paper of every page: a warm white.
const PAPER: Rgb = rgb(0.988, 0.976, 0.953);
/// How far a chart symbol's ink goes from its cell's colour to black or white: half, so that the
/// colours show and the symbols still read.
const SYMBOL_CONTRAST: f64 = 0.5;
/// The white of the page.
const WHITE: Rgb = rgb(1.0, 1.0, 1.0);
/// The band's colour where the picture has none dark and lively enough.
const PLAIN_ACCENT: Rgb = rgb(0.24, 0.33, 0.42);

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

/// The PDF of the pattern of `hidden` on `fabric`: the cover, the floss key and the chart.
///
/// # Errors
///
/// [`ChartError::Pdf`] where the PDF writer refuses (`export.pdf-documents.*`).
pub fn chart(hidden: &Hidden, fabric: Fabric) -> Result<SecretBytes, ChartError> {
    let font = UiFont::load();
    let pattern = hidden.pattern();
    let accent = accent(pattern);
    let sheet = sheet_for(pattern.width(), pattern.height(), fabric.count());
    let pages = [
        cover::page(pattern, &font, fabric, accent),
        key_page(hidden, &font, fabric, accent),
        chart_page(hidden, &font, &sheet, accent),
    ];
    // The legend line, as a person types it back, kept compressed in the key page's private data,
    // which no viewer shows, so that Decode reads the PDF itself. It holds nothing that the key
    // page does not print.
    let line = legend::line(hidden.rows()).ok();
    let piece = line
        .as_ref()
        .map(|line| (KEY_PAGE, LEGEND_PIECE, line.as_str().as_bytes()));
    pdf::document_with_piece(&font, &pages, piece).map_err(ChartError::Pdf)
}

/// The most bytes of a pattern's PDF read for its legend, by the command line and the browser alike:
/// a chart of 500 by 800 stitches is about 20 MiB.
pub const MAX_PATTERN_PDF_BYTES: usize = 64 * 1024 * 1024;

/// The legend line kept in the private data of a pattern's PDF; none where the PDF has none, as
/// one rewritten by another program, or what it has is no legend line.
#[must_use]
pub fn legend_of_pdf(pdf: &[u8]) -> Option<SecretText> {
    let data = pdf::piece::private_data(pdf, LEGEND_PIECE)?;
    let text = std::str::from_utf8(&data).ok()?;
    if !legend::is_line(text) {
        return None;
    }
    SecretText::build("a SeedStitch legend", text.len(), |filler| {
        filler.push_str(text)
    })
    .ok()
}

/// The colour of the bands: the thread of the picture that is most lively, weighted by how much of
/// the picture it covers, among those dark enough for white letters; a slate blue where none is.
fn accent(pattern: &Pattern) -> Rgb {
    let counts = pattern.counts();
    pattern
        .threads()
        .zip(counts)
        .map(|(thread, stitches)| (color_of(thread.rgb()), stitches))
        .filter(|&(color, _)| luma(color) < 0.45)
        .map(|(color, stitches)| {
            let lively = color.red.max(color.green).max(color.blue)
                - color.red.min(color.green).min(color.blue);
            (color, lively * f64::from(stitches).sqrt())
        })
        .filter(|&(_, weight)| weight > 0.0)
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map_or(PLAIN_ACCENT, |(color, _)| color)
}

/// A page of `size` millimetres in the pattern's dress: warm paper, a band of `accent` with `title`
/// and `note`, and its number among the pages at its foot.
fn dressed(
    font: &UiFont,
    size: (f64, f64),
    accent: Rgb,
    (title, note): (&str, &str),
    number: usize,
) -> Page {
    let (width, height) = size;
    let mut page = Page::new(width, height);
    let paper = page.rect(MmRect {
        x: 0.0,
        y: 0.0,
        width,
        height,
    });
    page.fill_rect(paper, PAPER, 1.0);
    let band = page.rect(MmRect {
        x: 0.0,
        y: 0.0,
        width,
        height: BAND,
    });
    page.fill_rect(band, accent, 1.0);
    page.text(font, title, (MARGIN, 4.6), 15.0, WHITE);
    right_aligned(&mut page, font, (note, 8.0), (width - MARGIN, 6.6), WHITE);
    let (from, to) = (
        page.point(MARGIN, height - FOOTER),
        page.point(width - MARGIN, height - FOOTER),
    );
    page.line(from, to, accent, 0.6, 1.0);
    let foot = format!("Page {number} of {PAGES}");
    let top = height - FOOTER + 2.5;
    right_aligned(&mut page, font, (&foot, 7.5), (width - MARGIN, top), MUTED);
    page
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
    mix(WHITE, color, share)
}

/// `from` mixed with `to`, `share` of `to` taken.
fn mix(from: Rgb, to: Rgb, share: f64) -> Rgb {
    rgb(
        from.red + (to.red - from.red) * share,
        from.green + (to.green - from.green) * share,
        from.blue + (to.blue - from.blue) * share,
    )
}

/// How light `color` looks, from 0 to 1.
fn luma(color: Rgb) -> f64 {
    0.299 * color.red + 0.587 * color.green + 0.114 * color.blue
}

/// Black or white, whichever stands out on `color`.
fn ink_on(color: Rgb) -> Rgb {
    if luma(color) > 0.5 { INK } else { WHITE }
}

/// The floss key: every row of the legend, from the top, closer together and smaller where there
/// are more than a few, every other row on a shade of `accent`.
fn key_page(hidden: &Hidden, font: &UiFont, fabric: Fabric, accent: Rgb) -> Page {
    let pattern = hidden.pattern();
    let times = printable(font, "×", "x");
    let note = format!(
        "{} DMC threads {} {} {times} {} stitches",
        pattern.thread_count(),
        printable(font, "·", "-"),
        pattern.width(),
        pattern.height()
    );
    let mut page = dressed(font, PAGE, accent, ("Floss key", &note), 2);
    let rows = hidden.rows();
    let (pitch, side, size) = row_layout(rows.len());
    let header = ROWS_TOP - 7.0;
    for (x, label) in [
        (14.0, "Symbol"),
        (36.0, "DMC"),
        (54.0, "Colour name"),
        (152.0, "Stitches"),
        (178.0, "Skeins"),
    ] {
        page.text(font, label, (x, header), 8.5, MUTED);
    }
    let (from, to) = (
        page.point(MARGIN, ROWS_TOP - 1.5),
        page.point(PAGE.0 - MARGIN, ROWS_TOP - 1.5),
    );
    page.line(from, to, accent, 0.5, 1.0);
    let shade = tint(accent, 0.07);
    let per_skein =
        STITCHES_PER_SKEIN * fabric.count() * SKEIN_STRANDS / (SKEIN_COUNT * fabric.strands());
    for (i, (row, thread)) in rows.iter().zip(hidden.row_threads()).enumerate() {
        let top = ROWS_TOP + pitch * i as f64;
        if i % 2 == 1 {
            let stripe = page.rect(MmRect {
                x: MARGIN,
                y: top - (pitch - side) / 2.0,
                width: PAGE.0 - 2.0 * MARGIN,
                height: pitch,
            });
            page.fill_rect(stripe, shade, 1.0);
        }
        let text_top = top + side / 2.0 - 0.6 * size / MM;
        let symbol = SYMBOLS[row.symbol() - 1];
        let swatch = color_of(thread.rgb());
        for (x, background, ink) in [(14.0, WHITE, INK), (22.0, swatch, ink_on(swatch))] {
            let place = page.rect(MmRect {
                x,
                y: top,
                width: side,
                height: side,
            });
            page.fill_rect(place, background, 1.0);
            let cell = Cell {
                x: place.x,
                y: place.y,
                side: side * MM,
            };
            symbols::draw(&mut page, font, symbol, cell, ink);
        }
        let number = printable(font, thread.number(), "?");
        page.text(font, number, (36.0, text_top), size, INK);
        let name = printable(font, thread.name(), "?");
        page.text(font, name, (54.0, text_top), size, INK);
        let stitches = row.stitches().to_string();
        let skeins = u64::from(row.stitches()).div_ceil(per_skein).to_string();
        right_aligned(&mut page, font, (&stitches, size), (170.0, text_top), INK);
        right_aligned(&mut page, font, (&skeins, size), (192.0, text_top), INK);
    }
    page
}

/// How far apart the key's `rows` are and the side of their symbols, in millimetres, and the size
/// of their text in points: [`ROW_PITCH`], [`ROW_BOX`] and [`ROW_TEXT`] while they fit, closer and
/// smaller beyond, so that every row is on the one page.
fn row_layout(rows: usize) -> (f64, f64, f64) {
    let pitch = ROW_PITCH.min((ROWS_BOTTOM - ROWS_TOP) / rows.max(1) as f64);
    (
        pitch,
        ROW_BOX.min(pitch - 0.6),
        ROW_TEXT.min(pitch * MM * 0.72),
    )
}

/// `text` at `size` points in `color`, ending at `right` millimetres from the left, `top` from the
/// top.
fn right_aligned(
    page: &mut Page,
    font: &UiFont,
    (text, size): (&str, f64),
    (right, top): (f64, f64),
    color: Rgb,
) {
    let width = font.width(text, size) / MM;
    page.text(font, text, (right - width, top), size, color);
}

/// The whole chart on `sheet`, as large as the page leaves room for, in the middle: each cell in its
/// thread's colour under its symbol.
fn chart_page(hidden: &Hidden, font: &UiFont, sheet: &Sheet, accent: Rgb) -> Page {
    let pattern = hidden.pattern();
    let (w, h) = (pattern.width(), pattern.height());
    let times = printable(font, "×", "x");
    let note = format!("{w} {times} {h} stitches, one square a stitch");
    let size = (sheet.width, sheet.height);
    let mut page = dressed(font, size, accent, ("Pattern chart", &note), 3);
    // Room for the numbers and the arrows at every edge.
    let (left, top) = (MARGIN + 6.0, BAND + 10.0);
    let (room_w, room_h) = (
        sheet.width - left - MARGIN - 6.0,
        sheet.height - top - FOOTER - 8.0,
    );
    let side = (room_w / w as f64).min(room_h / h as f64);
    let origin = (
        left + (room_w - w as f64 * side) / 2.0,
        top + (room_h - h as f64 * side) / 2.0,
    );
    let colors: Vec<Rgb> = pattern.threads().map(|t| color_of(t.rgb())).collect();
    let symbols = hidden.symbols_by_thread();
    for (at, &thread) in pattern.cells().iter().enumerate() {
        let (x, y) = (at % w, at / w);
        let thread = usize::from(thread);
        let place = page.rect(MmRect {
            x: origin.0 + x as f64 * side,
            y: origin.1 + y as f64 * side,
            width: side,
            height: side,
        });
        let background = colors[thread];
        page.fill_rect(place, background, 1.0);
        let cell = Cell {
            x: place.x,
            y: place.y,
            side: side * MM,
        };
        let ink = mix(background, ink_on(background), SYMBOL_CONTRAST);
        symbols::draw(&mut page, font, SYMBOLS[symbols[thread]], cell, ink);
    }
    grid_lines(&mut page, font, origin, side, (w, h));
    centre_arrows(&mut page, origin, side, (w, h), accent);
    page
}

/// The lines between the cells of the chart, `side` millimetres apart, bold every ten stitches and
/// around it, and the numbers of every tenth stitch along the top and the left.
fn grid_lines(
    page: &mut Page,
    font: &UiFont,
    origin: (f64, f64),
    side: f64,
    (w, h): (usize, usize),
) {
    let (left, top) = origin;
    let (right, bottom) = (left + w as f64 * side, top + h as f64 * side);
    let stroke = |page: &mut Page, from: (f64, f64), to: (f64, f64), bold: bool| {
        let (from, to) = (page.point(from.0, from.1), page.point(to.0, to.1));
        if bold {
            page.line(from, to, INK, 0.6, 0.9);
        } else {
            page.line(from, to, INK, 0.15, 0.3);
        }
    };
    for x in 0..=w {
        let at = left + x as f64 * side;
        stroke(page, (at, top), (at, bottom), x % 10 == 0 || x == w);
        if x % 10 == 0 && x > 0 {
            let label = x.to_string();
            let width = font.width(&label, 6.0) / MM;
            page.text(font, &label, (at - width / 2.0, top - 3.6), 6.0, MUTED);
        }
    }
    for y in 0..=h {
        let at = top + y as f64 * side;
        stroke(page, (left, at), (right, at), y % 10 == 0 || y == h);
        if y % 10 == 0 && y > 0 {
            let label = y.to_string();
            let width = font.width(&label, 6.0) / MM;
            page.text(font, &label, (left - width - 1.2, at - 1.0), 6.0, MUTED);
        }
    }
}

/// The arrows that point at the middle column and the middle row from the four edges of the chart,
/// as charts mark where to start.
fn centre_arrows(
    page: &mut Page,
    (left, top): (f64, f64),
    side: f64,
    (w, h): (usize, usize),
    accent: Rgb,
) {
    let (right, bottom) = (left + w as f64 * side, top + h as f64 * side);
    let (middle_x, middle_y) = (left + w as f64 * side / 2.0, top + h as f64 * side / 2.0);
    let (reach, half) = (3.4, 1.8);
    // Each arrow's tip, beyond the numbers along its edge, and the way it points, at the chart.
    let arrows = [
        ((middle_x, top - 4.0), (0.0, 1.0)),
        ((middle_x, bottom + 1.0), (0.0, -1.0)),
        ((left - 5.2, middle_y), (1.0, 0.0)),
        ((right + 1.0, middle_y), (-1.0, 0.0)),
    ];
    for ((tip_x, tip_y), (dx, dy)) in arrows {
        let base = (tip_x - dx * reach, tip_y - dy * reach);
        let corners = [
            (tip_x, tip_y),
            (base.0 - dy * half, base.1 + dx * half),
            (base.0 + dy * half, base.1 - dx * half),
        ];
        let mut path: Path = corners
            .iter()
            .enumerate()
            .map(|(i, &(x, y))| {
                let (x, y) = page.point(x, y);
                if i == 0 {
                    Segment::Move(x, y)
                } else {
                    Segment::Line(x, y)
                }
            })
            .collect();
        path.push(Segment::Close);
        page.fill(path, accent, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use mnemocode::random::{Random, RandomError};

    use super::*;
    use crate::hide::hide;
    use crate::phrase::LegendEntropy;
    use crate::picture;
    use crate::sample::gradient_png;

    /// A source that steps through the bytes, for a legend drawn the same on every run.
    struct Steps(u8);

    impl Random for Steps {
        fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
            for byte in bytes {
                self.0 = self.0.wrapping_add(3);
                *byte = self.0;
            }
            Ok(())
        }
    }

    #[test]
    fn the_pattern_s_pdf_keeps_its_legend_line_where_decode_finds_it() {
        let grid = picture::grid(&gradient_png(), 120).unwrap();
        let entropy = LegendEntropy::known(&[0x7f; 16]);
        let hidden = hide(&grid, &entropy, &mut Steps(0)).unwrap();
        let pdf = chart(&hidden, crate::fabric::DEFAULT_FABRIC).unwrap();
        let line = legend::line(hidden.rows()).unwrap();
        assert_eq!(legend_of_pdf(&pdf).unwrap().as_str(), line.as_str());
        assert!(legend_of_pdf(b"%PDF-1.7 nothing").is_none());
    }

    #[test]
    fn a_small_pattern_holds_its_phrase_in_the_order_of_its_rows_and_its_pdf_keeps_them() {
        // 60 stitches across leave format 1 no room for 24 words (docs/SEEDSTITCH.md, "Examples").
        let grid = picture::grid(&gradient_png(), 60).unwrap();
        let entropy = LegendEntropy::known(&[0x5a; 32]);
        let hidden = hide(&grid, &entropy, &mut Steps(0)).unwrap();
        assert!(hidden.rows().iter().all(|row| row.thread().is_some()));
        let pdf = chart(&hidden, crate::fabric::DEFAULT_FABRIC).unwrap();
        let kept = legend_of_pdf(&pdf).unwrap();
        assert_eq!(kept.as_str(), legend::line(hidden.rows()).unwrap().as_str());
        match legend::read(&legend::parse(kept.as_str()).unwrap()) {
            legend::Reading::Read { entropy: read, .. } => assert_eq!(&*read, &[0x5a; 32]),
            _ => panic!("the PDF's line does not read"),
        }
    }

    #[test]
    fn a_key_of_every_symbol_fits_its_one_page_in_readable_text() {
        for rows in 1..=crate::legend::MAX_ROWS {
            let (pitch, side, size) = row_layout(rows);
            let bottom = ROWS_TOP + pitch * (rows - 1) as f64 + side;
            assert!(bottom <= ROWS_BOTTOM, "{rows} rows end at {bottom} mm");
            assert!(
                side >= 2.5 && size >= 6.5,
                "{rows} rows: {side} mm, {size} pt"
            );
        }
        assert_eq!(row_layout(36), (ROW_PITCH, ROW_BOX, ROW_TEXT));
    }
}
