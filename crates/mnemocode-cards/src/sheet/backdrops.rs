//! Pages behind a material's design study (MnemoCode TS 0.1.0's `export/study-backdrops.ts`,
//! CAP-CARDS-MATERIAL-BACKDROPS), each from the world the material belongs to: a car showroom, an
//! exposed concrete wall, a tiled bathroom wall and an oak floor, drawn lightly, as a premium paper
//! would carry them, so that the samples stay in front.

use crate::scene::{MM, MmRect, Page, Rgb, Segment, ellipse_path, rgb};
use crate::sheet::CardGrid;

/// A material's page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaterialBackdrop {
    /// A plain studio wall.
    Studio,
    /// Concrete.
    Concrete,
    /// Tiles.
    Tiled,
    /// Parquet.
    Parquet,
}

const WHITE: Rgb = rgb(1.0, 1.0, 1.0);
/// Large primes of the spatial hash of Teschner et al. (2003), one per axis: they spread
/// neighbouring items far apart.
const HASH_PRIME_COLUMN: i32 = 73_856_093;
const HASH_PRIME_ROW: i32 = 19_349_663;
/// Added to the column and the row before they are hashed: an item in column 0 or row 0 would take
/// its shade from the other axis alone.
const HASH_OFFSET_COLUMN: i32 = 101;
const HASH_OFFSET_ROW: i32 = 211;
/// The steps of a shade between 0 and 1.
const SHADE_STEPS: u32 = 1000;
/// Horizontal bands of a smooth vertical gradient; each overlaps the next a little, so that no
/// hairline of the page shows between them.
const GRADIENT_BANDS: usize = 160;
const BAND_OVERLAP_MM: f64 = 0.2;

/// The edge of a polygon.
#[derive(Clone, Copy)]
struct Edge {
    color: Rgb,
    width: f64,
    opacity: f64,
}

/// Where a run of `step` that has a joint at `joint` starts, at or before the page's edge.
fn run_start(joint: f64, step: f64) -> f64 {
    joint - libm::ceil(joint / step) * step
}

fn mix(a: Rgb, b: Rgb, t: f64) -> Rgb {
    rgb(
        a.red + (b.red - a.red) * t,
        a.green + (b.green - a.green) * t,
        a.blue + (b.blue - a.blue) * t,
    )
}

/// A fixed shade from -1 to 1 for the item in column `i` and row `j` of a pattern, so that panels,
/// tiles and planks vary a little, the same way on every page.
fn shade(i: i32, j: i32) -> f64 {
    let hash = (i + HASH_OFFSET_COLUMN).wrapping_mul(HASH_PRIME_COLUMN)
        ^ (j + HASH_OFFSET_ROW).wrapping_mul(HASH_PRIME_ROW);
    f64::from((hash as u32) % (2 * SHADE_STEPS + 1)) / f64::from(SHADE_STEPS) - 1.0
}

/// A polygon given in millimetres from the top left corner of the page.
fn polygon(page: &mut Page, points: &[(f64, f64)], fill: Rgb, edge: Edge) {
    let mut path: Vec<Segment> = points
        .iter()
        .enumerate()
        .map(|(index, (x, y))| {
            let (x, y) = page.point(*x, *y);
            if index == 0 {
                Segment::Move(x, y)
            } else {
                Segment::Line(x, y)
            }
        })
        .collect();
    path.push(Segment::Close);
    page.fill(path.clone(), fill, 1.0);
    page.stroke(path, edge.color, edge.width, edge.opacity);
}

/// A straight line in millimetres from the top left corner of the page.
fn line(page: &mut Page, from: (f64, f64), to: (f64, f64), color: Rgb, stroke: (f64, f64)) {
    let (from, to) = (page.point(from.0, from.1), page.point(to.0, to.1));
    page.line(from, to, color, stroke.0, stroke.1);
}

/// A filled rectangle in millimetres from the top left corner of the page.
fn rectangle(page: &mut Page, rect: MmRect, color: Rgb) {
    let rect = page.rect(rect);
    page.fill_rect(rect, color, 1.0);
}

/// Fills the page from top to bottom through colour stops at shares of its height.
fn vertical_gradient(page: &mut Page, (width, height): (f64, f64), stops: &[(f64, Rgb)]) {
    let colour_at = |share: f64| {
        let next = stops.iter().position(|(place, _)| *place >= share);
        match next {
            None | Some(0) => stops[0].1,
            Some(next) => {
                let (from, start) = stops[next - 1];
                let (to, end) = stops[next];
                mix(start, end, (share - from) / (to - from))
            }
        }
    };
    let band = height / GRADIENT_BANDS as f64;
    for index in 0..GRADIENT_BANDS {
        let rect = MmRect {
            x: 0.0,
            y: index as f64 * band,
            width,
            height: band + BAND_OVERLAP_MM,
        };
        rectangle(
            page,
            rect,
            colour_at((index as f64 + 0.5) / GRADIENT_BANDS as f64),
        );
    }
}

/// A showroom: a pale wall with a soft light on it, meeting a polished grey floor that reflects the
/// light in a band along the horizon. It has no joints, so it follows no grid.
fn draw_studio(page: &mut Page, width: f64, height: f64) {
    // Where the wall meets the floor, as a share of the height from the top.
    let horizon = 0.62;
    vertical_gradient(
        page,
        (width, height),
        &[
            (0.0, rgb(0.9, 0.905, 0.915)),
            (horizon - 0.02, rgb(0.8, 0.81, 0.825)),
            (horizon, rgb(0.66, 0.675, 0.695)),
            (horizon + 0.06, rgb(0.74, 0.75, 0.765)),
            (1.0, rgb(0.6, 0.615, 0.635)),
        ],
    );
    // The light on the wall behind the samples: rings of white, each a little stronger inside.
    let rings = 8;
    let (x, y) = page.point(width / 2.0, height * 0.3);
    for ring in 0..rings {
        let share = 1.0 - f64::from(ring) / f64::from(rings);
        let path = ellipse_path(x, y, width * 0.5 * share * MM, height * 0.28 * share * MM);
        page.fill(path, WHITE, 0.05);
    }
    // The edge of the floor catches the light.
    line(
        page,
        (0.0, height * horizon),
        (width, height * horizon),
        WHITE,
        (0.5, 0.55),
    );
}

/// Exposed concrete: formwork panels with their joints, one panel behind each card, and the holes of
/// the form ties where the joints cross, in the gaps between the cards.
fn draw_concrete(page: &mut Page, width: f64, height: f64, grid: CardGrid) {
    let (panel_width, panel_height) = (grid.column_pitch, grid.row_pitch);
    let left = run_start(grid.left, panel_width);
    let top = run_start(grid.top, panel_height);
    let columns = libm::ceil((width - left) / panel_width) as i32;
    let rows = libm::ceil((height - top) / panel_height) as i32;
    let base = rgb(0.8, 0.79, 0.765);
    let joint = rgb(0.6, 0.59, 0.57);
    let light = rgb(0.9, 0.89, 0.87);
    let hole = rgb(0.6, 0.59, 0.57);
    // Small enough to stay within the gaps between the cards.
    let radius = panel_width.min(panel_height) * 0.02;
    for row in 0..rows {
        for column in 0..columns {
            let toward = if shade(column, row) > 0.0 {
                light
            } else {
                joint
            };
            let tone = mix(base, toward, shade(column, row).abs() * 0.08);
            let rect = MmRect {
                x: left + f64::from(column) * panel_width,
                y: top + f64::from(row) * panel_height,
                width: panel_width,
                height: panel_height,
            };
            rectangle(page, rect, tone);
        }
    }
    // The joints: a dark line with a light one beside it, as an edge that catches the light.
    for column in 1..columns {
        let x = left + f64::from(column) * panel_width;
        line(page, (x, 0.0), (x, height), joint, (0.5, 0.45));
        line(page, (x + 0.35, 0.0), (x + 0.35, height), light, (0.4, 0.6));
    }
    for row in 1..rows {
        let y = top + f64::from(row) * panel_height;
        line(page, (0.0, y), (width, y), joint, (0.5, 0.45));
        line(page, (0.0, y + 0.35), (width, y + 0.35), light, (0.4, 0.6));
    }
    // The ties, over the crossings of the joints.
    for row in 1..rows {
        for column in 1..columns {
            let (x, y) = page.point(
                left + f64::from(column) * panel_width,
                top + f64::from(row) * panel_height,
            );
            let size = radius * 1.35 * MM;
            page.fill(ellipse_path(x, y, size, size), light, 0.4);
            page.fill(ellipse_path(x, y, radius * MM, radius * MM), hole, 0.4);
        }
    }
}

/// A wall of large limestone-coloured tiles with light grout, stacked, one tile behind each card: a
/// running bond would move every other row's joints through the cards.
fn draw_tiles(page: &mut Page, width: f64, height: f64, grid: CardGrid) {
    let (tile_width, tile_height) = (grid.column_pitch, grid.row_pitch);
    let grout = tile_width * 0.012;
    let base = rgb(0.85, 0.83, 0.8);
    let light = rgb(0.92, 0.905, 0.88);
    let dark = rgb(0.74, 0.72, 0.69);
    let left = run_start(grid.left, tile_width);
    let top = run_start(grid.top, tile_height);
    let rows = libm::ceil((height - top) / tile_height) as i32;
    for row in 0..rows {
        let mut column = 0;
        while left + f64::from(column) * tile_width < width {
            let x = left + f64::from(column) * tile_width + grout / 2.0;
            let y = top + f64::from(row) * tile_height + grout / 2.0;
            let (w, h) = (tile_width - grout, tile_height - grout);
            let tone = shade(column, row);
            let toward = if tone > 0.0 { light } else { dark };
            let rect = MmRect {
                x,
                y,
                width: w,
                height: h,
            };
            rectangle(page, rect, mix(base, toward, tone.abs() * 0.12));
            // A glaze catches the light along the top edge and darkens along the bottom one.
            line(page, (x, y + 0.2), (x + w, y + 0.2), WHITE, (0.45, 0.55));
            line(
                page,
                (x, y + h - 0.2),
                (x + w, y + h - 0.2),
                dark,
                (0.45, 0.35),
            );
            column += 1;
        }
    }
}

/// A light oak floor laid in chevron: planks cut at an angle and meeting along straight seams, in
/// columns of about a sixth of the page that divide a column of cards evenly.
fn draw_parquet(page: &mut Page, width: f64, height: f64, grid: CardGrid) {
    let parts = libm::floor(grid.column_pitch / (width / 6.0) + 0.5).max(1.0);
    let column_width = grid.column_pitch / parts;
    let start = run_start(grid.left, column_width);
    let half = column_width / 2.0;
    // Planks meet at 45 degrees, so each half column rises by its own width.
    let rise = half;
    let plank = column_width * 0.2;
    let base = rgb(0.86, 0.8, 0.71);
    let light = rgb(0.9, 0.85, 0.77);
    let dark = rgb(0.78, 0.71, 0.61);
    let edge = Edge {
        color: rgb(0.62, 0.55, 0.45),
        width: 0.3,
        opacity: 0.45,
    };
    let rows = libm::ceil((height + rise) / plank) as i32 + 1;
    let mut column = 0;
    while start + f64::from(column) * column_width < width {
        let left = start + f64::from(column) * column_width;
        let middle = left + half;
        let right = left + column_width;
        for row in -1..rows {
            let top = f64::from(row) * plank - rise;
            let tone = |part: i32| {
                let tone = shade(2 * column + part, row);
                let toward = if tone > 0.0 { light } else { dark };
                mix(base, toward, tone.abs() * 0.5)
            };
            polygon(
                page,
                &[
                    (left, top + rise),
                    (middle, top),
                    (middle, top + plank),
                    (left, top + rise + plank),
                ],
                tone(0),
                edge,
            );
            polygon(
                page,
                &[
                    (middle, top),
                    (right, top + rise),
                    (right, top + rise + plank),
                    (middle, top + plank),
                ],
                tone(1),
                edge,
            );
        }
        column += 1;
    }
}

/// Draws a material's backdrop over the whole page, `width` by `height` millimetres, its joints
/// between the cards of `grid`.
pub fn draw_material_backdrop(
    page: &mut Page,
    backdrop: MaterialBackdrop,
    width: f64,
    height: f64,
    grid: CardGrid,
) {
    match backdrop {
        MaterialBackdrop::Studio => draw_studio(page, width, height),
        MaterialBackdrop::Concrete => draw_concrete(page, width, height, grid),
        MaterialBackdrop::Tiled => draw_tiles(page, width, height, grid),
        MaterialBackdrop::Parquet => draw_parquet(page, width, height, grid),
    }
}
