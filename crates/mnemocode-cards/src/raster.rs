//! Page images (crates report decision 5, CAP-CARDS-PAGE-IMAGES): the same steps that the PDF
//! writes, drawn in-process with tiny-skia at 300 dpi, as PNG, whose unpainted paper stays
//! transparent, or as JPEG on white. pdftocairo and its pipe go with it.

use std::fmt;

use jpeg_encoder::{ColorType, Encoder, PixelDensity};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretBytes;
use tiny_skia::{
    BlendMode, Color, FillRule, FilterQuality, LineCap, Mask, Paint, PathBuilder, Pattern, Pixmap,
    Rect, SpreadMode, Stroke, Transform,
};

use crate::scene::{
    Blend, POINTS_PER_INCH, Page, Path, Picture, Pixels, Rgb, Segment, Step, UiFont,
};

/// The resolution that pages are drawn at as images.
pub const IMAGE_DPI: f64 = 300.0;
/// The quality of a JPEG page, of 100.
pub const JPEG_QUALITY: u8 = 90;
/// [`IMAGE_DPI`] as a PNG file says it, in pixels per metre, so that a page prints at its size.
const PNG_PIXELS_PER_METRE: u32 = (IMAGE_DPI * 1000.0 / 25.4) as u32;

/// An image format of the files of cards.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    /// A PNG image.
    Png,
    /// A JPEG image.
    Jpg,
}

impl ImageFormat {
    /// The ending of its files.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
        }
    }
}

/// Why a page could not be drawn or encoded.
#[derive(Debug)]
pub struct RasterError(String);

impl fmt::Display for RasterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "The page could not be drawn as an image: {}.", self.0)
    }
}

impl std::error::Error for RasterError {}

impl Refusal for RasterError {
    fn code(&self) -> &'static str {
        "export.image-export.page-not-drawn"
    }
}

/// Whole pixels that a page of `points` covers completely, at least one: rounding the size up
/// would cover the last row and column only in part, which then show the paper as a thin line.
#[must_use]
pub fn covered_pixels(points: f64) -> u32 {
    ((points * IMAGE_DPI / POINTS_PER_INCH).floor() as u32).max(1)
}

/// The path of `path`, none for one that holds nothing.
fn skia_path(path: &Path) -> Option<tiny_skia::Path> {
    let mut builder = PathBuilder::new();
    for segment in path {
        match *segment {
            Segment::Move(x, y) => builder.move_to(x as f32, y as f32),
            Segment::Line(x, y) => builder.line_to(x as f32, y as f32),
            Segment::Curve(x1, y1, x2, y2, x, y) => {
                builder.cubic_to(
                    x1 as f32, y1 as f32, x2 as f32, y2 as f32, x as f32, y as f32,
                );
            }
            Segment::Close => builder.close(),
        }
    }
    builder.finish()
}

/// A paint of one colour.
fn paint_of(color: Rgb, opacity: f64, blend: Blend) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color(
        Color::from_rgba(
            color.red as f32,
            color.green as f32,
            color.blue as f32,
            opacity as f32,
        )
        .unwrap_or(Color::BLACK),
    );
    paint.anti_alias = true;
    paint.blend_mode = match blend {
        Blend::Normal => BlendMode::SourceOver,
        Blend::Color => BlendMode::Color,
    };
    paint
}

/// The graphics state.
#[derive(Clone)]
struct State {
    transform: Transform,
    clip: Option<Mask>,
}

/// The refusal of an image format of none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NoImageFormat;

impl fmt::Display for NoImageFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("The image format must be one of: png, jpg; jpeg is accepted as an alias.")
    }
}

impl std::error::Error for NoImageFormat {}

impl Refusal for NoImageFormat {
    fn code(&self) -> &'static str {
        "export.document-formats.image-format-one-accepted-as-alias"
    }
}

impl ImageFormat {
    /// `value` as an image format, jpeg as jpg; none gives the default, png.
    pub fn parse(value: Option<&str>) -> Result<Self, NoImageFormat> {
        match value {
            None | Some("png") => Ok(Self::Png),
            Some("jpg" | "jpeg") => Ok(Self::Jpg),
            Some(_) => Err(NoImageFormat),
        }
    }
}

/// The width and height of the JPEG `file`.
#[must_use]
pub fn jpeg_size(file: &[u8]) -> Option<(u32, u32)> {
    let mut decoder =
        zune_jpeg::JpegDecoder::new(zune_jpeg::zune_core::bytestream::ZCursor::new(file));
    decoder.decode_headers().ok()?;
    let (width, height) = decoder.dimensions()?;
    Some((u32::try_from(width).ok()?, u32::try_from(height).ok()?))
}

/// `picture` as premultiplied pixels.
fn pixmap_of(picture: &Picture) -> Result<Pixmap, RasterError> {
    let mut pixmap = Pixmap::new(picture.width, picture.height)
        .ok_or_else(|| RasterError("an empty image".to_owned()))?;
    let decoded;
    let (rgb, alpha) = match &picture.pixels {
        Pixels::Rgb { data, alpha } => (data.as_slice(), alpha.as_deref()),
        Pixels::Jpeg(file) => {
            let mut decoder =
                zune_jpeg::JpegDecoder::new(zune_jpeg::zune_core::bytestream::ZCursor::new(file));
            decoded = decoder
                .decode()
                .map_err(|error| RasterError(error.to_string()))?;
            (decoded.as_slice(), None)
        }
    };
    for (index, pixel) in pixmap.pixels_mut().iter_mut().enumerate() {
        let opacity = alpha.map_or(255, |alpha| alpha[index]);
        let channel = |at: usize| u16::from(rgb[index * 3 + at]) * u16::from(opacity) / 255;
        if let Some(value) = tiny_skia::PremultipliedColorU8::from_rgba(
            channel(0) as u8,
            channel(1) as u8,
            channel(2) as u8,
            opacity,
        ) {
            *pixel = value;
        }
    }
    Ok(pixmap)
}

/// Draws `page` on a new pixmap: JPEG has no transparency, so `white` lays white paper first.
fn drawn(font: &UiFont, page: &Page, white: bool) -> Result<Pixmap, RasterError> {
    let (width, height) = (covered_pixels(page.width), covered_pixels(page.height));
    let mut pixmap =
        Pixmap::new(width, height).ok_or_else(|| RasterError("an empty page".to_owned()))?;
    if white {
        pixmap.fill(Color::WHITE);
    }
    let scale = (IMAGE_DPI / POINTS_PER_INCH) as f32;
    // PDF's y runs upwards from the bottom of the page.
    let base = Transform::from_row(scale, 0.0, 0.0, -scale, 0.0, page.height as f32 * scale);
    let mut state = State {
        transform: base,
        clip: None,
    };
    let mut saved = Vec::new();
    for step in &page.steps {
        match step {
            Step::Save => saved.push(state.clone()),
            Step::Restore => {
                if let Some(previous) = saved.pop() {
                    state = previous;
                }
            }
            Step::Transform([a, b, c, d, e, f]) => {
                let matrix = Transform::from_row(
                    *a as f32, *b as f32, *c as f32, *d as f32, *e as f32, *f as f32,
                );
                state.transform = state.transform.pre_concat(matrix);
            }
            Step::Clip { path, even_odd } => {
                let Some(shape) = skia_path(path) else {
                    continue;
                };
                let rule = if *even_odd {
                    FillRule::EvenOdd
                } else {
                    FillRule::Winding
                };
                match &mut state.clip {
                    Some(mask) => mask.intersect_path(&shape, rule, true, state.transform),
                    None => {
                        let mut mask = Mask::new(width, height)
                            .ok_or_else(|| RasterError("an empty page".to_owned()))?;
                        mask.fill_path(&shape, rule, true, state.transform);
                        state.clip = Some(mask);
                    }
                }
            }
            Step::Fill {
                path,
                color,
                opacity,
                blend,
            } => {
                if let Some(shape) = skia_path(path) {
                    let paint = paint_of(*color, *opacity, *blend);
                    pixmap.fill_path(
                        &shape,
                        &paint,
                        FillRule::Winding,
                        state.transform,
                        state.clip.as_ref(),
                    );
                }
            }
            Step::Stroke {
                path,
                color,
                width: line,
                opacity,
            } => {
                if let Some(shape) = skia_path(path) {
                    let paint = paint_of(*color, *opacity, Blend::Normal);
                    let stroke = Stroke {
                        width: *line as f32,
                        line_cap: LineCap::Butt,
                        ..Stroke::default()
                    };
                    pixmap.stroke_path(
                        &shape,
                        &paint,
                        &stroke,
                        state.transform,
                        state.clip.as_ref(),
                    );
                }
            }
            Step::Image { picture, place } => {
                let image = pixmap_of(picture)?;
                let Some(rect) = Rect::from_xywh(
                    place.x as f32,
                    place.y as f32,
                    place.width as f32,
                    place.height as f32,
                ) else {
                    continue;
                };
                // Image space runs from the top: its first row lies at the top of the place.
                let inner = Transform::from_row(
                    place.width as f32 / picture.width as f32,
                    0.0,
                    0.0,
                    -(place.height as f32) / picture.height as f32,
                    place.x as f32,
                    (place.y + place.height) as f32,
                );
                let paint = Paint {
                    anti_alias: true,
                    shader: Pattern::new(
                        image.as_ref(),
                        SpreadMode::Pad,
                        FilterQuality::Bicubic,
                        1.0,
                        inner,
                    ),
                    ..Paint::default()
                };
                pixmap.fill_rect(rect, &paint, state.transform, state.clip.as_ref());
            }
            Step::Text {
                glyphs,
                x,
                y,
                size,
                color,
                ..
            } => {
                let paint = paint_of(*color, 1.0, Blend::Normal);
                let mut pen = *x;
                for glyph in glyphs {
                    if let Some(shape) = skia_path(&font.outline(*glyph)) {
                        let place = state.transform.pre_concat(Transform::from_row(
                            *size as f32,
                            0.0,
                            0.0,
                            *size as f32,
                            pen as f32,
                            *y as f32,
                        ));
                        pixmap.fill_path(
                            &shape,
                            &paint,
                            FillRule::Winding,
                            place,
                            state.clip.as_ref(),
                        );
                    }
                    pen += font.advance(*glyph) * size / font.per_em();
                }
            }
        }
    }
    Ok(pixmap)
}

/// RGBA pixels as a PNG file.
pub fn png_of(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, RasterError> {
    let mut file = Vec::new();
    let mut encoder = png::Encoder::new(&mut file, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    // As pdftocairo says them for TS's pages.
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: PNG_PIXELS_PER_METRE,
        yppu: PNG_PIXELS_PER_METRE,
        unit: png::Unit::Meter,
    }));
    encoder.set_source_srgb(png::SrgbRenderingIntent::RelativeColorimetric);
    encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(rgba))
        .map_err(|error| RasterError(error.to_string()))?;
    Ok(file)
}

/// `page` as an image file in `format`, held as a secret: it shows the codes.
pub fn page_image(
    font: &UiFont,
    page: &Page,
    format: ImageFormat,
) -> Result<SecretBytes, RasterError> {
    let pixmap = drawn(font, page, format == ImageFormat::Jpg)?;
    let (width, height) = (pixmap.width(), pixmap.height());
    let file = match format {
        ImageFormat::Png => {
            let rgba = pixmap.clone().take_demultiplied();
            png_of(width, height, &rgba)?
        }
        ImageFormat::Jpg => {
            let rgb: Vec<u8> = pixmap
                .data()
                .as_chunks::<4>()
                .0
                .iter()
                .flat_map(|&[red, green, blue, _]| [red, green, blue])
                .collect();
            let mut file = Vec::new();
            let mut encoder = Encoder::new(&mut file, JPEG_QUALITY);
            encoder.set_density(PixelDensity::dpi(IMAGE_DPI as u16));
            encoder
                .encode(&rgb, width as u16, height as u16, ColorType::Rgb)
                .map_err(|error| RasterError(error.to_string()))?;
            file
        }
    };
    Ok(SecretBytes::large("a page image", file))
}
