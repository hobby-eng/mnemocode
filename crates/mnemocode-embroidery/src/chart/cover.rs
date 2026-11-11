//! The cover of the pattern, as a bought pattern opens: the picture as it looks stitched on Aida, on
//! a white mount, what the pattern is, its finished size on the usual fabrics, and how to start.

use std::rc::Rc;

use mnemocode_cards::scene::{MmRect, Page, Picture, Pixels, Rgb, Step, UiFont};

use super::{FOOTER, INK, MARGIN, MUTED, PAGE, WHITE, dressed, printable, right_aligned, tint};
use crate::fabric::{FABRICS, Fabric, centimetres};
use crate::pattern::Pattern;

/// About how many pixels the stitched picture has at most.
const PREVIEW_PIXELS: usize = 3_000_000;
/// The fewest and the most pixels a side of a stitch is drawn in.
const STITCH_PIXELS: (usize, usize) = (4, 12);
/// The colour of the fabric between the stitches, and at its holes.
const FABRIC: [f64; 3] = [0.95, 0.93, 0.88];
const HOLE: [f64; 3] = [0.78, 0.75, 0.69];
/// The steps of the cover's box "Before you start".
const STEPS: [&str; 4] = [
    "1. Fold the fabric in four to find its centre; the arrows on the chart point to the centre stitch.",
    "2. Stitch from the centre outwards, one colour at a time, in the order of the floss key.",
    "3. Make every cross with its top stitch the same way round, for an even finish.",
    "4. Do not knot the thread: hold its tail under the first stitches on the back.",
];

/// The cover of `pattern` on `fabric`, its band and headings in `accent`.
pub(super) fn page(pattern: &Pattern, font: &UiFont, fabric: Fabric, accent: Rgb) -> Page {
    let dot = printable(font, "·", "-");
    let times = printable(font, "×", "x");
    let note = format!("Counted cross stitch {dot} DMC threads");
    let mut page = dressed(font, PAGE, accent, ("Cross Stitch Pattern", &note), 1);
    mounted_picture(&mut page, pattern);
    let (w, h) = (pattern.width(), pattern.height());
    let top = 190.0;
    page.text(font, "About this pattern", (MARGIN, top), 11.0, accent);
    let facts = [
        format!("Design size: {w} {times} {h} stitches"),
        format!("Colours: {} DMC threads", pattern.thread_count()),
        "Stitches: full cross stitch only".to_owned(),
        match fabric.strands() {
            1 => "Strands: 1 strand of floss".to_owned(),
            strands => format!("Strands: {strands} strands of floss"),
        },
        match fabric {
            Fabric::Aida(_) => format!("Fabric: {}, white or antique white", fabric.name()),
            Fabric::LinenOverOne(_) => format!("Fabric: {}", fabric.name()),
        },
        "Chart: in colour with symbols, one square a stitch".to_owned(),
    ];
    for (i, fact) in facts.iter().enumerate() {
        page.text(font, fact, (MARGIN, top + 7.0 + 5.0 * i as f64), 8.5, INK);
    }
    let column = 112.0;
    page.text(font, "Finished size", (column, top), 11.0, accent);
    let mut fabrics = FABRICS.to_vec();
    if !fabrics.contains(&fabric) {
        fabrics.push(fabric);
    }
    fabrics.sort_by_key(|f| (f.count(), f.strands()));
    for (i, &each) in fabrics.iter().enumerate() {
        let line = top + 7.0 + 5.0 * i as f64;
        let color = if each == fabric { accent } else { INK };
        let count = each.count();
        let size = format!(
            "{:.1} {times} {:.1} cm",
            centimetres(w, count),
            centimetres(h, count)
        );
        let inches = format!(
            "{:.1} {times} {:.1} in",
            w as f64 / count as f64,
            h as f64 / count as f64
        );
        page.text(font, &each.short_name(), (column, line), 8.5, color);
        page.text(font, &size, (column + 27.0, line), 8.5, color);
        right_aligned(
            &mut page,
            font,
            (&inches, 8.5),
            (PAGE.0 - MARGIN, line),
            color,
        );
    }
    let framing = "Leave 5 cm (2 in) of fabric on every side for framing.";
    let below = top + 8.0 + 5.0 * fabrics.len() as f64;
    page.text(font, framing, (column, below), 7.5, MUTED);
    let box_top = 233.0;
    let panel = page.rect(MmRect {
        x: MARGIN,
        y: box_top,
        width: PAGE.0 - 2.0 * MARGIN,
        height: 42.0,
    });
    page.fill_rect(panel, tint(accent, 0.08), 1.0);
    let inside = MARGIN + 5.0;
    page.text(
        font,
        "Before you start",
        (inside, box_top + 4.0),
        11.0,
        accent,
    );
    for (i, step) in STEPS.iter().enumerate() {
        let line = box_top + 12.0 + 6.5 * i as f64;
        page.text(font, step, (inside, line), 8.5, INK);
    }
    let notice =
        "For personal use only. Please do not copy, share or resell this pattern. Happy stitching!";
    let foot = PAGE.1 - FOOTER + 2.5;
    page.text(font, notice, (MARGIN, foot), 7.5, MUTED);
    page
}

/// The stitched picture in the cover's upper part, on a white mount with a soft shadow.
fn mounted_picture(page: &mut Page, pattern: &Pattern) {
    let (w, h) = (pattern.width(), pattern.height());
    let (box_x, box_y) = (MARGIN + 6.0, 26.0);
    let (box_w, box_h) = (PAGE.0 - 2.0 * box_x, 150.0);
    let scale = (box_w / w as f64).min(box_h / h as f64);
    let (width, height) = (w as f64 * scale, h as f64 * scale);
    let (x, y) = (
        box_x + (box_w - width) / 2.0,
        box_y + (box_h - height) / 2.0,
    );
    let mount = 4.0;
    let around = |dx: f64, dy: f64| MmRect {
        x: x - mount + dx,
        y: y - mount + dy,
        width: width + 2.0 * mount,
        height: height + 2.0 * mount,
    };
    let shadow = page.rect(around(1.2, 1.5));
    page.fill_rect(shadow, INK, 0.14);
    let white = page.rect(around(0.0, 0.0));
    page.fill_rect(white, WHITE, 1.0);
    let place = page.rect(MmRect {
        x,
        y,
        width,
        height,
    });
    let picture = Rc::new(stitched(pattern));
    page.steps.push(Step::Image { picture, place });
}

/// What a pixel of a stitch shows: its thread, lit by a share (above 1 lighter, below darker), or
/// the fabric in a colour.
#[derive(Clone, Copy)]
enum Shade {
    Thread(f64),
    Fabric([f64; 3]),
}

/// `pattern` as it looks stitched: each stitch a cross of two strands of its thread on Aida, the top
/// one lighter, the fabric showing between the crosses and dark at the holes.
fn stitched(pattern: &Pattern) -> Picture {
    let (w, h) = (pattern.width(), pattern.height());
    let side = ((PREVIEW_PIXELS / (w * h).max(1)) as f64).sqrt() as usize;
    let side = side.clamp(STITCH_PIXELS.0, STITCH_PIXELS.1);
    let threads: Vec<[f64; 3]> = pattern
        .threads()
        .map(|thread| thread.rgb().map(|byte| f64::from(byte) / 255.0))
        .collect();
    // Every stitch is drawn alike, so its pixels' shades are worked out once.
    let shades: Vec<Shade> = (0..side * side)
        .map(|at| shade_at(at % side, at / side, side))
        .collect();
    let (width, height) = (w * side, h * side);
    let mut data = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let row = &pattern.cells()[(y / side) * w..(y / side + 1) * w];
        for x in 0..width {
            let thread = threads[usize::from(row[x / side])];
            let color = match shades[(y % side) * side + x % side] {
                Shade::Thread(light) if light > 1.0 => {
                    thread.map(|channel| channel + (1.0 - channel) * (light - 1.0))
                }
                Shade::Thread(light) => thread.map(|channel| channel * light),
                Shade::Fabric(fabric) => fabric,
            };
            data.extend(color.map(|channel| (channel.clamp(0.0, 1.0) * 255.0).round() as u8));
        }
    }
    Picture {
        width: u32::try_from(width).unwrap_or(u32::MAX),
        height: u32::try_from(height).unwrap_or(u32::MAX),
        pixels: Pixels::Rgb { data, alpha: None },
    }
}

/// The shade of pixel `(x, y)` of a stitch `side` pixels wide: the top strand from the lower left
/// to the upper right, the strand under it the other way, each thinner at its ends, where they go
/// into the holes.
fn shade_at(x: usize, y: usize, side: usize) -> Shade {
    let (u, v) = (
        (x as f64 + 0.5) / side as f64,
        (y as f64 + 0.5) / side as f64,
    );
    // Half a strand's width, in parts of the stitch, from its middle to its ends.
    let width = |along: f64| 0.34 * (0.75 + 0.25 * (1.0 - (2.0 * along - 1.0).abs()));
    let over = (u + v - 1.0).abs();
    if over < width(u) {
        return Shade::Thread(1.08 - 0.36 * (over / width(u)).powi(2));
    }
    let under = (u - v).abs();
    if under < width(u) {
        return Shade::Thread(0.9 - 0.3 * (under / width(u)).powi(2));
    }
    let edge = |t: f64| t.min(1.0 - t);
    if edge(u) < 0.16 && edge(v) < 0.16 {
        Shade::Fabric(HOLE)
    } else {
        Shade::Fabric(FABRIC)
    }
}
