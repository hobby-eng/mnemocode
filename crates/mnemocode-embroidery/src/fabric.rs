//! How large a pattern is stitched: its fabric, of so many stitches an inch, and the paper sizes a
//! picture may be fitted into, each in stitches on that fabric, as the menu offers them (the
//! owner's requests of 2026-11-04 and 05).

use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::text::numbers::WholeRange;

use crate::picture::{MAX_HEIGHT, MAX_WIDTH, MIN_WIDTH, PictureError, height_of};

/// Millimetres in an inch.
const INCH: f64 = 25.4;
/// The counts of Aida a pattern may be given for, stitches an inch.
pub const AIDA_COUNTS: WholeRange = WholeRange::new(6, 28);
/// The counts of linen stitched over one thread a pattern may be given for, threads an inch.
pub const LINEN_COUNTS: WholeRange = WholeRange::new(20, 40);

/// The fabric a pattern is stitched on: Aida, whose holes make the grid, or evenweave linen with
/// each stitch over one thread, as fine as its count, for detail in a small piece (the owner's
/// request of 2026-11-05: 28-count linen over one puts 200 stitches into A4's width).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fabric {
    /// Aida of so many stitches an inch.
    Aida(u64),
    /// Evenweave linen of so many threads an inch, each stitch over one thread.
    LinenOverOne(u64),
}

impl Fabric {
    /// Its stitches an inch.
    #[must_use]
    pub const fn count(self) -> u64 {
        match self {
            Self::Aida(count) | Self::LinenOverOne(count) => count,
        }
    }

    /// The strands of floss in the needle: two on Aida, one over one thread of linen, as so fine a
    /// stitch takes.
    #[must_use]
    pub const fn strands(self) -> u64 {
        match self {
            Self::Aida(_) => 2,
            Self::LinenOverOne(_) => 1,
        }
    }

    /// Its stitches a centimetre.
    #[must_use]
    pub fn per_centimetre(self) -> f64 {
        self.count() as f64 * 10.0 / INCH
    }

    /// As a pattern's facts name it: "14-count Aida" or "28-count linen, over one thread".
    #[must_use]
    pub fn name(self) -> String {
        match self {
            Self::Aida(count) => format!("{count}-count Aida"),
            Self::LinenOverOne(count) => format!("{count}-count linen, over one thread"),
        }
    }

    /// As a list of fabrics names it: "Aida 14" or "Linen 28 over 1".
    #[must_use]
    pub fn short_name(self) -> String {
        match self {
            Self::Aida(count) => format!("Aida {count}"),
            Self::LinenOverOne(count) => format!("Linen {count} over 1"),
        }
    }

    /// As `--fabric` takes it: "14" or "linen-28".
    #[must_use]
    pub fn option(self) -> String {
        match self {
            Self::Aida(count) => count.to_string(),
            Self::LinenOverOne(count) => format!("linen-{count}"),
        }
    }

    /// The fabric that `text` names as [`Fabric::option`] writes it, within [`AIDA_COUNTS`] or
    /// [`LINEN_COUNTS`].
    ///
    /// # Errors
    ///
    /// [`UnknownFabric`] for anything else, other spellings of a count included ("+14", "014",
    /// " 14"), so that no two texts name one fabric.
    pub fn named(text: &str) -> Result<Self, UnknownFabric> {
        let within = |range: WholeRange, count: u64| (range.min..=range.max).contains(&count);
        match text.strip_prefix("linen-") {
            Some(count) => count
                .parse()
                .ok()
                .filter(|&count| within(LINEN_COUNTS, count))
                .map(Self::LinenOverOne),
            None => text
                .parse()
                .ok()
                .filter(|&count| within(AIDA_COUNTS, count))
                .map(Self::Aida),
        }
        .filter(|fabric| fabric.option() == text)
        .ok_or(UnknownFabric)
    }
}

/// A text that names no fabric a pattern is given for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnknownFabric;

impl fmt::Display for UnknownFabric {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            "A fabric is Aida by its count, 6 to 28 stitches an inch, such as 14, or linen-N for linen of N threads an inch stitched over one thread, N from 20 to 40, such as linen-28.",
        )
    }
}

impl std::error::Error for UnknownFabric {}

impl Refusal for UnknownFabric {
    fn code(&self) -> &'static str {
        "embroidery.fabric.unknown"
    }
}

/// The fabric a pattern is given for unless the person chooses: 14-count Aida.
pub const DEFAULT_FABRIC: Fabric = Fabric::Aida(14);
/// The fabrics the menu offers, the usual one first.
pub const FABRICS: [Fabric; 5] = [
    Fabric::Aida(14),
    Fabric::Aida(11),
    Fabric::Aida(16),
    Fabric::Aida(18),
    Fabric::LinenOverOne(28),
];

/// A paper size a picture may be fitted into: its name, and its short and long side in millimetres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Format {
    /// Its name, as "A4".
    pub name: &'static str,
    /// Its short side, in millimetres.
    pub short: f64,
    /// Its long side, in millimetres.
    pub long: f64,
}

/// The ISO A sheets, smallest first: a pattern is fitted into one, and its chart printed on one.
pub const SHEETS: [Format; 7] = [
    Format {
        name: "A6",
        short: 105.0,
        long: 148.0,
    },
    Format {
        name: "A5",
        short: 148.0,
        long: 210.0,
    },
    Format {
        name: "A4",
        short: 210.0,
        long: 297.0,
    },
    Format {
        name: "A3",
        short: 297.0,
        long: 420.0,
    },
    Format {
        name: "A2",
        short: 420.0,
        long: 594.0,
    },
    Format {
        name: "A1",
        short: 594.0,
        long: 841.0,
    },
    Format {
        name: "A0",
        short: 841.0,
        long: 1189.0,
    },
];
/// How many of [`SHEETS`] the menu offers for the size of a pattern: A6 to A2.
pub const OFFERED_SHEETS: usize = 5;
/// The stitches across from which a photograph looks real (the owner's look at a rabbit in 78, 105,
/// 200 and 300 stitches, 2026-11-04): a front end first selects the smallest offered size that
/// gives them, and says why.
pub const DETAILED_ACROSS: usize = 200;
/// The margin kept around a pattern fitted into a sheet, in millimetres, as a framed piece keeps
/// some fabric around it.
pub const PRINT_MARGIN: f64 = 10.0;

/// The side of one stitch on fabric of `count` stitches an inch, in millimetres.
#[must_use]
pub fn stitch_side(count: u64) -> f64 {
    INCH / count as f64
}

/// The sheet a chart is printed on: an ISO name, none for a sheet of the chart's own size, and its
/// width and height in millimetres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sheet {
    /// Its ISO name, as "A4"; none for a sheet of the chart's own size.
    pub name: Option<&'static str>,
    /// Its width, in millimetres.
    pub width: f64,
    /// Its height, in millimetres.
    pub height: f64,
}

/// The sheet of a pattern of `w` by `h` stitches on fabric of `count`: the smallest of [`SHEETS`]
/// that holds it at its size on the fabric with [`PRINT_MARGIN`] around it, turned as the pattern
/// is, or beyond A0 a sheet of its own size. A pattern fitted into a sheet by [`width_in`] gets
/// that sheet, and its chart is drawn on it.
#[must_use]
pub fn sheet_for(w: usize, h: usize, count: u64) -> Sheet {
    let side = stitch_side(count);
    let (across, down) = (
        w as f64 * side + 2.0 * PRINT_MARGIN,
        h as f64 * side + 2.0 * PRINT_MARGIN,
    );
    // A hair of room, as the stitches a sheet holds were counted down from its millimetres.
    let holds = |width: f64, height: f64| across <= width + 1e-6 && down <= height + 1e-6;
    for format in SHEETS {
        let turned = [(format.short, format.long), (format.long, format.short)];
        let ways = if w > h {
            [turned[1], turned[0]]
        } else {
            turned
        };
        if let Some((width, height)) = ways
            .into_iter()
            .find(|&(width, height)| holds(width, height))
        {
            return Sheet {
                name: Some(format.name),
                width,
                height,
            };
        }
    }
    Sheet {
        name: None,
        width: across,
        height: down,
    }
}

/// The whole stitches that `millimetres` of fabric of `count` stitches an inch hold.
#[must_use]
pub fn stitches_in(millimetres: f64, count: u64) -> usize {
    // A hair over, so that a length of whole stitches is not lost to rounding.
    (millimetres / INCH * count as f64 + 1e-9).floor() as usize
}

/// The centimetres that `stitches` take on fabric of `count` stitches an inch.
#[must_use]
pub fn centimetres(stitches: usize, count: u64) -> f64 {
    stitches as f64 / count as f64 * INCH / 10.0
}

/// The stitches across that a picture of `size` upright pixels may have: from [`MIN_WIDTH`] to the
/// most within [`MAX_WIDTH`], its own width and [`MAX_HEIGHT`] down.
///
/// # Errors
///
/// [`PictureError::NarrowerThanPattern`] for a picture of fewer pixels across than [`MIN_WIDTH`],
/// and [`PictureError::TooTall`] for one so tall that no width is left.
pub fn widths(size: (usize, usize)) -> Result<WholeRange, PictureError> {
    if size.0 < MIN_WIDTH {
        return Err(PictureError::NarrowerThanPattern { needed: MIN_WIDTH });
    }
    let mut most = MAX_WIDTH.min(size.0);
    while most >= MIN_WIDTH && height_of(size, most) > MAX_HEIGHT {
        most -= 1;
    }
    if most < MIN_WIDTH {
        return Err(PictureError::TooTall);
    }
    Ok(WholeRange::new(MIN_WIDTH as u64, most as u64))
}

/// The centimetres that `widths` take on fabric of `count`, least and most: the least rounded up and
/// the most down to a millimetre, so that both ends are widths a pattern may have.
#[must_use]
pub fn centimetre_range(widths: WholeRange, count: u64) -> (f64, f64) {
    let least = centimetres(widths.min as usize, count);
    let most = centimetres(widths.max as usize, count);
    ((least * 10.0).ceil() / 10.0, (most * 10.0).floor() / 10.0)
}

/// The stitches across of a width of `centimetres` that a person typed, on fabric of `count`; none
/// where it is no number above 0 or its stitches are not within `widths`.
#[must_use]
pub fn typed_width(centimetres: f64, widths: WholeRange, count: u64) -> Option<usize> {
    if !centimetres.is_finite() || centimetres <= 0.0 {
        return None;
    }
    let across = stitches_in(centimetres * 10.0, count);
    (widths.min..=widths.max)
        .contains(&(across as u64))
        .then_some(across)
}

/// A size offered for a picture: one of the first [`OFFERED_SHEETS`] of [`SHEETS`], and the
/// stitches the picture takes in it on a fabric.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OfferedSize {
    /// The sheet the picture is fitted into, and its chart drawn on.
    pub format: Format,
    /// The stitches across.
    pub across: usize,
    /// The stitches down.
    pub down: usize,
}

/// The sizes offered for a picture of `size` upright pixels on `fabric`, smallest first: each of
/// the first [`OFFERED_SHEETS`] of [`SHEETS`] that holds [`MIN_WIDTH`] stitches of it, with the
/// stitches [`width_in`] gives it there.
#[must_use]
pub fn offered_sizes(size: (usize, usize), fabric: Fabric) -> Vec<OfferedSize> {
    SHEETS[..OFFERED_SHEETS]
        .iter()
        .filter_map(|&format| {
            let across = width_in(size, format, fabric.count())?;
            Some(OfferedSize {
                format,
                across,
                down: height_of(size, across),
            })
        })
        .collect()
}

/// The place among `sizes` that a front end selects first: the smallest that gives
/// [`DETAILED_ACROSS`] stitches across, else the largest, which gives most; none where there is
/// none.
#[must_use]
pub fn first_offered(sizes: &[OfferedSize]) -> Option<usize> {
    sizes
        .iter()
        .position(|size| size.across >= DETAILED_ACROSS)
        .or_else(|| sizes.len().checked_sub(1))
}

/// The most stitches across, within the limits of a pattern, that a picture of `size` upright
/// pixels may have in `format` on fabric of `count`, inside [`PRINT_MARGIN`], the format turned
/// whichever way holds it larger; none where it cannot hold [`MIN_WIDTH`].
#[must_use]
pub fn width_in(size: (usize, usize), format: Format, count: u64) -> Option<usize> {
    let (short, long) = (
        format.short - 2.0 * PRINT_MARGIN,
        format.long - 2.0 * PRINT_MARGIN,
    );
    let upright = width_within(size, (short, long), count);
    let turned = width_within(size, (long, short), count);
    upright.max(turned)
}

/// The most stitches across that a picture of `size` may have in `width` by `height` millimetres.
fn width_within(size: (usize, usize), (width, height): (f64, f64), count: u64) -> Option<usize> {
    let most_down = stitches_in(height, count).min(MAX_HEIGHT);
    let mut across = stitches_in(width, count).min(MAX_WIDTH).min(size.0);
    while across >= MIN_WIDTH && height_of(size, across) > most_down {
        across -= 1;
    }
    (across >= MIN_WIDTH).then_some(across)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A4: Format = SHEETS[2];

    #[test]
    fn a_fabric_is_named_and_read_back_as_the_option_writes_it() {
        for fabric in FABRICS {
            assert_eq!(Fabric::named(&fabric.option()), Ok(fabric));
        }
        assert_eq!(Fabric::named("linen-28").map(Fabric::count), Ok(28));
        assert_eq!(Fabric::LinenOverOne(28).strands(), 1);
        assert_eq!(Fabric::named("5"), Err(UnknownFabric));
        assert_eq!(Fabric::named("linen-12"), Err(UnknownFabric));
        assert_eq!(Fabric::named("aida-14"), Err(UnknownFabric));
        for other in [
            "+14",
            "014",
            " 14",
            "14 ",
            "linen-+28",
            "linen-028",
            " linen-28",
        ] {
            assert_eq!(Fabric::named(other), Err(UnknownFabric), "{other:?}");
        }
    }

    #[test]
    fn a_format_holds_as_many_stitches_as_its_sides_on_the_fabric() {
        assert_eq!(
            (stitches_in(A4.short, 14), stitches_in(A4.long, 14)),
            (115, 163)
        );
        assert!((stitch_side(14) - 1.814).abs() < 1e-3);
        assert_eq!(stitches_in(25.4, 14), 14);
        assert!((centimetres(14, 14) - 2.54).abs() < 1e-9);
    }

    #[test]
    fn a_picture_is_fitted_into_a_format_whichever_way_round_holds_it_larger() {
        // Inside the margin of A4, 190 by 277 mm: 104 by 152 stitches on Aida 14. Upright, a square
        // fills the short side, and so does a picture of A4's own shape.
        assert_eq!(width_in((1000, 1000), A4, 14), Some(104));
        assert_eq!(width_in((1000, 1414), A4, 14), Some(104));
        // A wide picture turns the sheet: 152 across, 101 down.
        assert_eq!(width_in((3000, 2000), A4, 14), Some(152));
        assert_eq!(height_of((3000, 2000), 152), 101);
        // A very long picture holds fewer across than the short side.
        assert_eq!(width_in((1000, 3000), A4, 14), Some(50));
        // Finer fabric, more stitches.
        assert_eq!(width_in((1000, 1000), A4, 18), Some(134));
    }

    #[test]
    fn a_picture_may_have_from_the_fewest_stitches_to_its_own_width_or_the_tallest_pattern() {
        assert_eq!(widths((4000, 3000)), Ok(WholeRange::new(40, 500)));
        assert_eq!(widths((120, 100)), Ok(WholeRange::new(40, 120)));
        assert_eq!(widths((1000, 10_000)), Ok(WholeRange::new(40, 80)));
        assert_eq!(
            widths((39, 39)),
            Err(PictureError::NarrowerThanPattern { needed: 40 })
        );
        assert_eq!(widths((100, 3000)), Err(PictureError::TooTall));
    }

    #[test]
    fn the_sizes_offered_are_the_sheets_from_a6_to_a2_that_hold_the_picture() {
        // A picture of 3000 by 2000 pixels on Aida 14: A4 holds 104 by 152 stitches inside its
        // margin, the picture turned the long way, so 152 across and 101 down.
        let sizes = offered_sizes((3000, 2000), DEFAULT_FABRIC);
        let names: Vec<&str> = sizes.iter().map(|size| size.format.name).collect();
        assert_eq!(names, ["A6", "A5", "A4", "A3", "A2"]);
        assert_eq!((sizes[2].across, sizes[2].down), (152, 101));
        // A picture of 60 pixels across fills no sheet beyond its own width.
        let small = offered_sizes((60, 60), DEFAULT_FABRIC);
        assert!(small.iter().all(|size| size.across <= 60));
        // Linen 28 over one holds twice the stitches of Aida 14 in a sheet.
        let linen = offered_sizes((3000, 2000), Fabric::LinenOverOne(28));
        assert!(linen[2].across >= 2 * sizes[2].across - 2);
        // A3 is the smallest to give 200 across; where none does, the largest is selected.
        assert_eq!(first_offered(&sizes), Some(3));
        assert_eq!(first_offered(&small), Some(small.len() - 1));
        assert_eq!(first_offered(&[]), None);
    }

    #[test]
    fn a_typed_width_is_the_whole_stitches_it_holds_within_the_widths() {
        let widths = WholeRange::new(40, 500);
        assert_eq!(typed_width(21.0, widths, 14), Some(115));
        assert_eq!(typed_width(2.54, widths, 14), None);
        for wrong in [0.0, -5.0, f64::NAN, f64::INFINITY] {
            assert_eq!(typed_width(wrong, widths, 14), None);
        }
        // 40 to 500 stitches of Aida 14 are 7.26 to 90.71 cm: rounded inward, both ends hold.
        let (least, most) = centimetre_range(widths, 14);
        assert_eq!((least, most), (7.3, 90.7));
        assert!(typed_width(least, widths, 14).is_some());
        assert!(typed_width(most, widths, 14).is_some());
    }

    #[test]
    fn a_format_too_small_or_a_picture_too_narrow_gives_none() {
        assert_eq!(width_in((1000, 1000), SHEETS[0], 14), Some(46));
        assert_eq!(width_in((1000, 1000), SHEETS[0], 11), None);
        assert_eq!(width_in((30, 30), A4, 14), None);
        assert_eq!(width_in((120, 100), A4, 14), Some(120));
    }

    #[test]
    fn a_pattern_fitted_into_a_sheet_has_its_chart_drawn_on_a_sheet_no_larger() {
        for (size, count) in [((1000, 1000), 14), ((3000, 2000), 14), ((1000, 3000), 18)] {
            for format in &SHEETS[..OFFERED_SHEETS] {
                let Some(across) = width_in(size, *format, count) else {
                    continue;
                };
                let sheet = sheet_for(across, height_of(size, across), count);
                assert!(
                    sheet.width.min(sheet.height) <= format.short,
                    "{} {size:?} {count}: {sheet:?}",
                    format.name
                );
            }
        }
        // 104 by 107 stitches on Aida 14, 18.9 by 19.4 cm, on A4 upright; a wide chart turns it.
        assert_eq!(
            sheet_for(104, 107, 14),
            Sheet {
                name: Some("A4"),
                width: 210.0,
                height: 297.0
            }
        );
        assert_eq!(sheet_for(152, 101, 14).name, Some("A4"));
        assert!(sheet_for(152, 101, 14).width > sheet_for(152, 101, 14).height);
        // 400 by 600 on Aida 14 is 72.6 by 108.9 cm, which A0 holds; 500 by 800, 90.7 by 145.1 cm,
        // takes a sheet of its own.
        assert_eq!(sheet_for(400, 600, 14).name, Some("A0"));
        let own = sheet_for(500, 800, 14);
        assert_eq!(own.name, None);
        assert!((own.width - (500.0 * 25.4 / 14.0 + 20.0)).abs() < 1e-9);
    }
}
