//! What a page of cards draws, in one list of steps that the PDF writer and the page images both
//! take (ARCHITECTURE.md §5, crates report decision 5), with the box and text-fitting primitives
//! that sheets and templates share (MnemoCode TS 0.1.0's `export/business-layout.ts` and
//! `business-render-primitives.ts`). Positions are PDF points with y upwards until a step changes
//! them; the layouts give millimetres from the top left, which the page turns into points.

use std::fmt;
use std::rc::Rc;

use mnemocode::refusal::Refusal;
use mnemocode::secret::redacted;
use skrifa::instance::{LocationRef, Size};
use skrifa::metrics::GlyphMetrics;
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider};

use crate::assets::UI_FONT;

/// Points in an inch: the default unit of PDF user space.
pub const POINTS_PER_INCH: f64 = 72.0;
/// Points in a millimetre.
pub const MM: f64 = POINTS_PER_INCH / 25.4;
/// The least width a text is measured at, so that an empty one never divides by zero.
const MIN_MEASURED_WIDTH: f64 = 0.001;
/// The rounded corners of a card, as a share of its height.
const CORNER_RADIUS_HEIGHT_RATIO: f64 = 0.055;
/// The historical rounded coefficient of a quarter circle, which keeps the approved clipping.
const QUARTER_CIRCLE_CONTROL: f64 = 0.552_284_75;
/// A quarter of an ellipse as four Bézier curves draw it: (4 / 3) * tan(pi / 8).
const ELLIPSE_KAPPA: f64 = 4.0 * ((std::f64::consts::SQRT_2 - 1.0) / 3.0);

/// The dark ink of the business designs' text.
pub const INK: Rgb = rgb(0.12, 0.13, 0.14);

/// An opaque colour, each channel from 0 to 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgb {
    /// Red.
    pub red: f64,
    /// Green.
    pub green: f64,
    /// Blue.
    pub blue: f64,
}

/// A colour.
#[must_use]
pub const fn rgb(red: f64, green: f64, blue: f64) -> Rgb {
    Rgb { red, green, blue }
}

/// A rectangle in millimetres, measured from the top left of the page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmRect {
    /// From the left of the page.
    pub x: f64,
    /// From the top of the page.
    pub y: f64,
    /// Its width.
    pub width: f64,
    /// Its height.
    pub height: f64,
}

impl MmRect {
    /// This box grown by `margin` millimetres on every side.
    #[must_use]
    pub fn outset(self, margin: f64) -> Self {
        Self {
            x: self.x - margin,
            y: self.y - margin,
            width: self.width + 2.0 * margin,
            height: self.height + 2.0 * margin,
        }
    }
}

/// A rectangle in PDF points from the bottom left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointRect {
    /// From the left of the page.
    pub x: f64,
    /// From the bottom of the page.
    pub y: f64,
    /// Its width.
    pub width: f64,
    /// Its height.
    pub height: f64,
}

/// One segment of a path.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segment {
    /// Starts a part of the path at a point.
    Move(f64, f64),
    /// A straight line to a point.
    Line(f64, f64),
    /// A cubic Bézier curve: two control points and its end.
    Curve(f64, f64, f64, f64, f64, f64),
    /// Closes the part of the path.
    Close,
}

/// A path.
pub type Path = Vec<Segment>;

/// A rectangle as a path.
#[must_use]
pub fn rectangle_path(rect: PointRect) -> Path {
    let PointRect {
        x,
        y,
        width,
        height,
    } = rect;
    vec![
        Segment::Move(x, y),
        Segment::Line(x + width, y),
        Segment::Line(x + width, y + height),
        Segment::Line(x, y + height),
        Segment::Close,
    ]
}

/// An ellipse round the point, as a path.
#[must_use]
pub fn ellipse_path(x: f64, y: f64, x_scale: f64, y_scale: f64) -> Path {
    let (ox, oy) = (x_scale * ELLIPSE_KAPPA, y_scale * ELLIPSE_KAPPA);
    vec![
        Segment::Move(x - x_scale, y),
        Segment::Curve(x - x_scale, y - oy, x - ox, y - y_scale, x, y - y_scale),
        Segment::Curve(x + ox, y - y_scale, x + x_scale, y - oy, x + x_scale, y),
        Segment::Curve(x + x_scale, y + oy, x + ox, y + y_scale, x, y + y_scale),
        Segment::Curve(x - ox, y + y_scale, x - x_scale, y + oy, x - x_scale, y),
        Segment::Close,
    ]
}

/// An image on a page: the pixels, or a whole JPEG file.
#[derive(Debug, PartialEq, Eq)]
pub enum Pixels {
    /// Three RGB bytes per pixel, rows from the top, and an opacity byte per pixel if any is not 255.
    Rgb {
        /// The colour bytes.
        data: Vec<u8>,
        /// The opacity bytes.
        alpha: Option<Vec<u8>>,
    },
    /// A complete JPEG file, embedded as it is.
    Jpeg(&'static [u8]),
}

/// An image, shared by the pages that draw it.
#[derive(Debug, PartialEq, Eq)]
pub struct Picture {
    /// Its width in pixels.
    pub width: u32,
    /// Its height in pixels.
    pub height: u32,
    /// Its pixels.
    pub pixels: Pixels,
}

/// How a fill is laid over what is below it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Blend {
    /// Laid on top.
    Normal,
    /// The hue and saturation of the fill, at the luminosity of what is below (ISO 32000-1, 11.3.5.3).
    Color,
}

/// One drawing step. A step of text holds a code of a backup or a share, so its `Debug` tells
/// nothing (RUST-13).
#[derive(Clone, PartialEq)]
pub enum Step {
    /// Keeps the state of the drawing.
    Save,
    /// Goes back to the state last kept.
    Restore,
    /// `[a, b, c, d, e, f]` as PDF's cm takes it.
    Transform([f64; 6]),
    /// Draws only inside a path from here on.
    Clip {
        /// The path.
        path: Path,
        /// Whether its inside goes by the even-odd rule.
        even_odd: bool,
    },
    /// Fills a path.
    Fill {
        /// The path.
        path: Path,
        /// The colour.
        color: Rgb,
        /// From 0 to 1.
        opacity: f64,
        /// How it lies over what is below.
        blend: Blend,
    },
    /// Draws the line of a path.
    Stroke {
        /// The path.
        path: Path,
        /// The colour.
        color: Rgb,
        /// The width of the line in points.
        width: f64,
        /// From 0 to 1.
        opacity: f64,
    },
    /// Draws an image.
    Image {
        /// The image.
        picture: Rc<Picture>,
        /// Where it goes.
        place: PointRect,
    },
    /// Draws a line of text.
    Text {
        /// The glyphs of the UI font, which a PDF shows and an image fills.
        glyphs: Vec<u16>,
        /// The characters they stand for, for the text a PDF reader copies.
        text: String,
        /// Where its base line starts, from the left.
        x: f64,
        /// Where its base line starts, from the bottom.
        y: f64,
        /// The size in points.
        size: f64,
        /// The colour.
        color: Rgb,
    },
}

impl fmt::Debug for Step {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, "Step")
    }
}

/// One page. It shows the codes of its cards, so its `Debug` tells nothing (RUST-13).
#[derive(Clone, PartialEq)]
pub struct Page {
    /// Its size in points.
    pub width: f64,
    /// Its height in points.
    pub height: f64,
    /// What it draws, in order.
    pub steps: Vec<Step>,
}

impl fmt::Debug for Page {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, "Page")
    }
}

/// A character the font lacks, or a text too long: what the refusal names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FitError {
    /// The character the font lacks.
    UnknownCharacter(String),
    /// The text too long for its box.
    TooLong(String),
}

impl fmt::Display for FitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownCharacter(label) => {
                write!(
                    f,
                    "{label} contains a character not supported by the card font."
                )
            }
            Self::TooLong(label) => {
                write!(
                    f,
                    "{label} is too long to fit legibly on the card; shorten it."
                )
            }
        }
    }
}

impl std::error::Error for FitError {}

impl Refusal for FitError {
    fn code(&self) -> &'static str {
        match self {
            Self::UnknownCharacter(_) => {
                "export.business-render-primitives.contains-character-not-supported-by-card-font"
            }
            Self::TooLong(_) => {
                "export.business-render-primitives.too-long-fit-legibly-on-card-shorten"
            }
        }
    }
}

/// The font of every card and sheet: each character is drawn as its own glyph from the cmap, so
/// that letters copied by hand from a card stay apart (crates report, decision 6).
#[derive(Clone)]
pub struct UiFont {
    font: FontRef<'static>,
    per_em: f64,
}

impl fmt::Debug for UiFont {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("UiFont")
    }
}

impl UiFont {
    /// The bundled font, which the build checks with its first test.
    ///
    /// # Panics
    ///
    /// Never for the bundled file, which `the_bundled_font_reads` reads.
    #[must_use]
    pub fn load() -> Self {
        #[expect(
            clippy::expect_used,
            reason = "the file is compiled in, and the first test reads it"
        )]
        let font = FontRef::new(UI_FONT).expect("the bundled font reads");
        let per_em = font
            .head()
            .map_or(2048.0, |head| f64::from(head.units_per_em()));
        Self { font, per_em }
    }

    /// The font file itself.
    pub(crate) const fn bytes(&self) -> &'static [u8] {
        UI_FONT
    }

    /// The glyph of `character`, none when the font lacks it.
    fn glyph(&self, character: char) -> Option<GlyphId> {
        self.font.charmap().map(character)
    }

    /// Whether the font has every character of `text`; a character it lacks would draw blank.
    #[must_use]
    pub fn has_every_character(&self, text: &str) -> bool {
        text.chars()
            .all(|character| self.glyph(character).is_some())
    }

    /// The metrics in font units.
    fn metrics(&self) -> GlyphMetrics<'_> {
        self.font
            .glyph_metrics(Size::unscaled(), LocationRef::default())
    }

    /// The advance of glyph `glyph` in font units.
    pub(crate) fn advance(&self, glyph: u16) -> f64 {
        f64::from(
            self.metrics()
                .advance_width(GlyphId::new(u32::from(glyph)))
                .unwrap_or(0.0),
        )
    }

    /// The font's units in an em.
    pub(crate) const fn per_em(&self) -> f64 {
        self.per_em
    }

    /// The width of `text` at `size` points: the sum of its characters' advances.
    #[must_use]
    pub fn width(&self, text: &str, size: f64) -> f64 {
        let units: f64 = self
            .glyphs(text)
            .iter()
            .map(|glyph| self.advance(*glyph))
            .sum();
        units * size / self.per_em
    }

    /// The glyphs of `text`; a character the font lacks draws as glyph 0.
    pub(crate) fn glyphs(&self, text: &str) -> Vec<u16> {
        text.chars()
            .map(|character| {
                self.glyph(character)
                    .map_or(0, |glyph| u16::try_from(glyph.to_u32()).unwrap_or(0))
            })
            .collect()
    }

    /// The outline of `glyph` in units of 1 em, y upwards.
    pub(crate) fn outline(&self, glyph: u16) -> Path {
        let mut pen = OutlineSegments {
            per_em: self.per_em,
            segments: Vec::new(),
            at: (0.0, 0.0),
        };
        if let Some(outline) = self
            .font
            .outline_glyphs()
            .get(GlyphId::new(u32::from(glyph)))
        {
            // In the font's own units: a size of its own would round each point to 1/64 of it.
            let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
            // A glyph that cannot be drawn stays blank, as the font's own .notdef does.
            let _ = outline.draw(settings, &mut pen);
        }
        pen.segments
    }

    /// The size, at most `preferred`, at which `text` fits `width` points; refused, naming `label`,
    /// when the font lacks one of its characters or it would be smaller than `minimum`.
    pub fn fit(
        &self,
        text: &str,
        preferred: f64,
        minimum: f64,
        width: f64,
        label: &str,
    ) -> Result<f64, FitError> {
        if !self.has_every_character(text) {
            return Err(FitError::UnknownCharacter(label.to_owned()));
        }
        let size = preferred.min(width / self.width(text, 1.0).max(MIN_MEASURED_WIDTH));
        if size < minimum {
            return Err(FitError::TooLong(label.to_owned()));
        }
        Ok(size)
    }
}

/// Collects an outline given in font units, in units of 1 em; quadratic curves become cubic, as PDF
/// has them.
struct OutlineSegments {
    per_em: f64,
    segments: Path,
    at: (f64, f64),
}

impl OutlineSegments {
    /// A point of the font in units of 1 em.
    fn em(&self, x: f32, y: f32) -> (f64, f64) {
        (f64::from(x) / self.per_em, f64::from(y) / self.per_em)
    }
}

impl OutlinePen for OutlineSegments {
    fn move_to(&mut self, x: f32, y: f32) {
        self.at = self.em(x, y);
        self.segments.push(Segment::Move(self.at.0, self.at.1));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.at = self.em(x, y);
        self.segments.push(Segment::Line(self.at.0, self.at.1));
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let ((cx, cy), (x, y)) = (self.em(cx, cy), self.em(x, y));
        let (from_x, from_y) = self.at;
        self.segments.push(Segment::Curve(
            from_x + 2.0 / 3.0 * (cx - from_x),
            from_y + 2.0 / 3.0 * (cy - from_y),
            x + 2.0 / 3.0 * (cx - x),
            y + 2.0 / 3.0 * (cy - y),
            x,
            y,
        ));
        self.at = (x, y);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let ((cx0, cy0), (cx1, cy1)) = (self.em(cx0, cy0), self.em(cx1, cy1));
        self.at = self.em(x, y);
        self.segments
            .push(Segment::Curve(cx0, cy0, cx1, cy1, self.at.0, self.at.1));
    }

    fn close(&mut self) {
        self.segments.push(Segment::Close);
    }
}

/// A box that centred text fits, in millimetres.
#[derive(Clone, Copy, Debug)]
pub struct TextBox {
    /// From the left of the page.
    pub left: f64,
    /// From the top of the page.
    pub top: f64,
    /// Its width.
    pub width: f64,
}

impl Page {
    /// An empty page of `width` by `height` millimetres.
    #[must_use]
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            width: width * MM,
            height: height * MM,
            steps: Vec::new(),
        }
    }

    /// The point `x` millimetres from the left and `top` below the top, in PDF points.
    #[must_use]
    pub fn point(&self, x: f64, top: f64) -> (f64, f64) {
        (x * MM, self.height - top * MM)
    }

    /// `rect`, given in millimetres from the top left, in PDF points from the bottom left.
    #[must_use]
    pub fn rect(&self, rect: MmRect) -> PointRect {
        let (x, y) = self.point(rect.x, rect.y + rect.height);
        PointRect {
            x,
            y,
            width: rect.width * MM,
            height: rect.height * MM,
        }
    }

    /// Fills `path`.
    pub fn fill(&mut self, path: Path, color: Rgb, opacity: f64) {
        self.steps.push(Step::Fill {
            path,
            color,
            opacity,
            blend: Blend::Normal,
        });
    }

    /// Strokes `path`.
    pub fn stroke(&mut self, path: Path, color: Rgb, width: f64, opacity: f64) {
        self.steps.push(Step::Stroke {
            path,
            color,
            width,
            opacity,
        });
    }

    /// Fills `rect`, in points.
    pub fn fill_rect(&mut self, rect: PointRect, color: Rgb, opacity: f64) {
        self.fill(rectangle_path(rect), color, opacity);
    }

    /// A straight line between two points, in points.
    pub fn line(&mut self, from: (f64, f64), to: (f64, f64), color: Rgb, width: f64, opacity: f64) {
        let path = vec![Segment::Move(from.0, from.1), Segment::Line(to.0, to.1)];
        self.stroke(path, color, width, opacity);
    }

    /// Draws `value` at `size` points, `x` millimetres from the left edge and with its top `top`
    /// millimetres from the top, in `color`. The line box of one font size keeps the approved
    /// typography: PDF measures from the bottom, the layouts from the top.
    pub fn text(
        &mut self,
        font: &UiFont,
        value: &str,
        (x, top): (f64, f64),
        size: f64,
        color: Rgb,
    ) {
        let (_, y) = self.point(0.0, top);
        self.steps.push(Step::Text {
            glyphs: font.glyphs(value),
            text: value.to_owned(),
            x: x * MM,
            y: y - size,
            size,
            color,
        });
    }

    /// `value` centred in `place`, at the size from `preferred` down to `minimum` at which it fits
    /// the box.
    pub fn centred_text(
        &mut self,
        font: &UiFont,
        value: &str,
        place: TextBox,
        (preferred, minimum): (f64, f64),
        label: &str,
        color: Rgb,
    ) -> Result<(), FitError> {
        let size = font.fit(value, preferred, minimum, place.width * MM, label)?;
        let left = place.left + (place.width - font.width(value, size) / MM) / 2.0;
        self.text(font, value, (left, place.top), size, color);
        Ok(())
    }

    /// The photograph of the card in `place`, clipped to the card's rounded corners.
    pub fn clipped_artwork(&mut self, picture: &Rc<Picture>, place: MmRect) {
        let rect = self.rect(place);
        let PointRect {
            x,
            y,
            width: w,
            height: h,
        } = rect;
        let r = h * CORNER_RADIUS_HEIGHT_RATIO;
        let k = QUARTER_CIRCLE_CONTROL;
        let path = vec![
            Segment::Move(x + r, y),
            Segment::Line(x + w - r, y),
            Segment::Curve(x + w - r + r * k, y, x + w, y + r - r * k, x + w, y + r),
            Segment::Line(x + w, y + h - r),
            Segment::Curve(
                x + w,
                y + h - r + r * k,
                x + w - r + r * k,
                y + h,
                x + w - r,
                y + h,
            ),
            Segment::Line(x + r, y + h),
            Segment::Curve(x + r - r * k, y + h, x, y + h - r + r * k, x, y + h - r),
            Segment::Line(x, y + r),
            Segment::Curve(x, y + r - r * k, x + r - r * k, y, x + r, y),
            Segment::Close,
        ];
        self.steps.push(Step::Save);
        self.steps.push(Step::Clip {
            path,
            even_odd: false,
        });
        self.steps.push(Step::Image {
            picture: Rc::clone(picture),
            place: rect,
        });
        self.steps.push(Step::Restore);
    }

    /// Scales and moves what is drawn, and takes the size in millimetres: a separate card on a page
    /// of another size.
    pub fn resized(&mut self, scale: f64, x: f64, y: f64, width: f64, height: f64) {
        let mut steps = vec![
            Step::Save,
            Step::Transform([scale, 0.0, 0.0, scale, x * MM, y * MM]),
        ];
        steps.append(&mut self.steps);
        steps.push(Step::Restore);
        self.steps = steps;
        self.width = width * MM;
        self.height = height * MM;
    }
}

/// The size of each of `count` cells that fill `span` with `gap` between neighbours.
#[must_use]
pub fn run_cell_size(span: f64, count: usize, gap: f64) -> f64 {
    (span - (count as f64 - 1.0) * gap) / count as f64
}

/// Where a run of `count` cells of `size`, `gap` apart, starts so that it is centred in `span`.
#[must_use]
pub fn centred_run_start(span: f64, count: usize, size: f64, gap: f64) -> f64 {
    (span - count as f64 * size - (count as f64 - 1.0) * gap) / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_font_reads() {
        let font = UiFont::load();
        assert!(font.width("Hello", 10.0) > 10.0);
        assert!(font.has_every_character("ABC 123 #"));
        assert!(!font.has_every_character("雪"));
    }

    #[test]
    fn an_outline_keeps_the_points_of_the_font() {
        let font = UiFont::load();
        // The letter S as fontTools reads the file: neither point lies on a 64th of an em.
        let outline = font.outline(font.glyphs("S")[0]);
        let em = |units: f64| units / 2048.0;
        assert!(outline.contains(&Segment::Move(em(1096.0), em(1444.0))));
        assert!(outline.contains(&Segment::Line(em(1096.0), em(1247.0))));
    }

    #[test]
    fn a_text_that_does_not_fit_is_refused_by_its_label() {
        let font = UiFont::load();
        let long = "x".repeat(200);
        assert_eq!(
            font.fit(&long, 8.0, 4.0, 10.0, "Name"),
            Err(FitError::TooLong("Name".to_owned()))
        );
    }
}
