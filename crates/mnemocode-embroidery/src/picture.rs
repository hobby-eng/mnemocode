//! The picture a pattern is made from: a PNG, JPEG or WebP file read within limits, turned upright by
//! its EXIF orientation, brightened as a designer of patterns brightens a photograph (more
//! saturated and more contrasted, so that a small object keeps its shades in threads), and averaged
//! down to one colour per stitch in linear light.

use std::fmt;
use std::io::Cursor;

use mnemocode::refusal::Refusal;
use mnemocode::text::numbers::WholeRange;

use crate::color::{self, Lab};

/// The largest picture file read: 40 MiB.
pub const MAX_FILE_BYTES: usize = 40 * 1024 * 1024;
/// The most pixels a picture may hold: 60 megapixels, more than any phone camera takes.
pub const MAX_PIXELS: usize = 60_000_000;
/// The fewest stitches across a pattern.
pub const MIN_WIDTH: usize = 40;
/// The most stitches across a pattern.
pub const MAX_WIDTH: usize = 500;
/// The stitches across a pattern, as a question, an option or a page reads them.
pub const WIDTHS: WholeRange = WholeRange::new(MIN_WIDTH as u64, MAX_WIDTH as u64);
/// The stitches across a pattern unless the person chooses: 200, about 36 cm on 14-count Aida.
pub const DEFAULT_WIDTH: usize = 200;
/// The most stitches down a pattern.
pub const MAX_HEIGHT: usize = 800;
/// How much more saturated the picture is made: its colours moved away from their own grey.
const SATURATION: f64 = 1.2;
/// How much more contrasted the picture is made: its colours moved away from its mean grey.
const CONTRAST: f64 = 1.1;

/// Why a picture cannot be made into a pattern.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PictureError {
    /// The file is larger than [`MAX_FILE_BYTES`].
    FileTooLarge,
    /// The file is no PNG, JPEG or WebP picture this program reads.
    NotAPicture,
    /// The picture has more than [`MAX_PIXELS`] pixels.
    TooManyPixels,
    /// The pattern's width is outside [`MIN_WIDTH`] to [`MAX_WIDTH`] stitches.
    WidthOutOfRange,
    /// The picture has fewer pixels across than the pattern has stitches.
    NarrowerThanPattern {
        /// The pixels across that the pattern needs.
        needed: usize,
    },
    /// The picture is so tall for its width that the pattern would exceed [`MAX_HEIGHT`].
    TooTall,
}

impl fmt::Display for PictureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FileTooLarge => write!(
                f,
                "The picture file is larger than {} MiB.",
                MAX_FILE_BYTES / 1024 / 1024
            ),
            Self::NotAPicture => {
                f.write_str("The picture is no PNG, JPEG or WebP file that can be read.")
            }
            Self::TooManyPixels => write!(
                f,
                "The picture has more than {} megapixels; make it smaller first.",
                MAX_PIXELS / 1_000_000
            ),
            Self::WidthOutOfRange => {
                write!(f, "A pattern is {MIN_WIDTH} to {MAX_WIDTH} stitches wide.")
            }
            Self::NarrowerThanPattern { needed } => write!(
                f,
                "The picture is narrower than the pattern: it needs at least {needed} pixels across."
            ),
            Self::TooTall => write!(
                f,
                "The picture is too tall for its width: a pattern is at most {MAX_HEIGHT} stitches high."
            ),
        }
    }
}

impl std::error::Error for PictureError {}

impl Refusal for PictureError {
    fn code(&self) -> &'static str {
        match self {
            Self::FileTooLarge => "embroidery.picture.file-too-large",
            Self::NotAPicture => "embroidery.picture.not-a-picture",
            Self::TooManyPixels => "embroidery.picture.too-many-pixels",
            Self::WidthOutOfRange => "embroidery.picture.width-out-of-range",
            Self::NarrowerThanPattern { .. } => "embroidery.picture.narrower-than-pattern",
            Self::TooTall => "embroidery.picture.too-tall",
        }
    }
}

/// One colour for each stitch of a pattern, rows from the top.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    width: usize,
    height: usize,
    colors: Vec<Lab>,
}

impl Grid {
    /// Stitches across.
    #[must_use]
    pub const fn width(&self) -> usize {
        self.width
    }

    /// Stitches down.
    #[must_use]
    pub const fn height(&self) -> usize {
        self.height
    }

    /// Every stitch's colour, row by row.
    #[must_use]
    pub fn colors(&self) -> &[Lab] {
        &self.colors
    }
}

/// Pixels in RGB bytes, rows from the top, as stored in the file.
struct Pixels {
    width: usize,
    height: usize,
    rgb: Vec<u8>,
    /// The EXIF orientation, 1 to 8; 1 where the file names none.
    orientation: u8,
}

impl Pixels {
    /// The size once upright.
    const fn upright_size(&self) -> (usize, usize) {
        if self.orientation >= 5 {
            (self.height, self.width)
        } else {
            (self.width, self.height)
        }
    }

    /// Brightens every pixel as a designer brightens a photograph for a pattern: each colour moved
    /// away from its own grey by [`SATURATION`], then from the picture's mean grey by [`CONTRAST`],
    /// each step kept within a byte, as an image editor's controls do.
    fn brighten(&mut self) {
        let grey = |[r, g, b]: [u8; 3]| {
            (f64::from(r) * 299.0 + f64::from(g) * 587.0 + f64::from(b) * 114.0) / 1000.0
        };
        let byte = |value: f64| value.round().clamp(0.0, 255.0) as u8;
        let (pixels, _) = self.rgb.as_chunks_mut::<3>();
        let total: f64 = pixels.iter().map(|&pixel| grey(pixel)).sum();
        let mean = (total / pixels.len().max(1) as f64).round();
        for pixel in pixels {
            let own = grey(*pixel);
            let saturated = pixel.map(|c| byte(own + (f64::from(c) - own) * SATURATION));
            *pixel = saturated.map(|c| byte(mean + (f64::from(c) - mean) * CONTRAST));
        }
    }

    /// The stored pixel shown at `(x, y)` of the upright picture (EXIF 2.32, tag 0x0112).
    fn upright(&self, x: usize, y: usize) -> [u8; 3] {
        let (w, h) = (self.width, self.height);
        let (sx, sy) = match self.orientation {
            2 => (w - 1 - x, y),
            3 => (w - 1 - x, h - 1 - y),
            4 => (x, h - 1 - y),
            5 => (y, x),
            6 => (y, h - 1 - x),
            7 => (w - 1 - y, h - 1 - x),
            8 => (w - 1 - y, x),
            _ => (x, y),
        };
        let at = (sy * w + sx) * 3;
        [self.rgb[at], self.rgb[at + 1], self.rgb[at + 2]]
    }
}

/// The colours of `file` averaged down to `width` stitches across, keeping the picture's shape.
///
/// # Errors
///
/// [`PictureError`]: a file too large, not PNG, JPEG or WebP, too many pixels, or a bad width.
pub fn grid(file: &[u8], width: usize) -> Result<Grid, PictureError> {
    if !(MIN_WIDTH..=MAX_WIDTH).contains(&width) {
        return Err(PictureError::WidthOutOfRange);
    }
    let mut pixels = pixels(file)?;
    let (source_width, source_height) = pixels.upright_size();
    if source_width < width {
        return Err(PictureError::NarrowerThanPattern { needed: width });
    }
    let height = height_of((source_width, source_height), width);
    if height > MAX_HEIGHT {
        return Err(PictureError::TooTall);
    }
    pixels.brighten();
    let linear: Vec<f64> = (0..=u8::MAX).map(color::linear).collect();
    let mut colors = Vec::with_capacity(width * height);
    for row in 0..height {
        let (y0, y1) = span(row, height, source_height);
        for column in 0..width {
            let (x0, x1) = span(column, width, source_width);
            let mut sum = [0.0; 3];
            for y in y0..y1 {
                for x in x0..x1 {
                    for (total, byte) in sum.iter_mut().zip(pixels.upright(x, y)) {
                        *total += linear[usize::from(byte)];
                    }
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as f64;
            colors.push(color::lab_of_linear(sum.map(|total| total / count)));
        }
    }
    Ok(Grid {
        width,
        height,
        colors,
    })
}

/// The upright pixel size of the picture in `file`, so a front end can offer pattern sizes first.
///
/// # Errors
///
/// [`PictureError`]: a file too large, not PNG, JPEG or WebP, or too many pixels.
pub fn upright_size(file: &[u8]) -> Result<(usize, usize), PictureError> {
    Ok(pixels(file)?.upright_size())
}

/// The stitches down a pattern `width` stitches across of a picture of `size` upright pixels, as
/// [`grid`] makes it: the picture's shape kept, at least one.
#[must_use]
pub fn height_of((source_width, source_height): (usize, usize), width: usize) -> usize {
    ((source_height * width + source_width / 2) / source_width.max(1)).max(1)
}

/// The pixels of `file`, by the form its first bytes name.
fn pixels(file: &[u8]) -> Result<Pixels, PictureError> {
    if file.len() > MAX_FILE_BYTES {
        return Err(PictureError::FileTooLarge);
    }
    if file.starts_with(b"\x89PNG\r\n\x1a\n") {
        png_pixels(file)
    } else if file.starts_with(&[0xFF, 0xD8, 0xFF]) {
        jpeg_pixels(file)
    } else if file.starts_with(b"RIFF") && file.get(8..12) == Some(b"WEBP".as_slice()) {
        webp_pixels(file)
    } else {
        Err(PictureError::NotAPicture)
    }
}

/// The source pixels `[start, end)` that stitch `index` of `stitches` covers, at least one. The
/// products are taken in 64 bits: a side of a very long picture times the stitch index overflows a
/// 32-bit usize (WebAssembly), though each result fits.
fn span(index: usize, stitches: usize, pixels: usize) -> (usize, usize) {
    let at = |i: usize| (i as u64 * pixels as u64 / stitches as u64) as usize;
    let start = at(index);
    let end = at(index + 1).max(start + 1);
    (start, end.min(pixels))
}

/// The pixels of a PNG file, transparency laid over white.
fn png_pixels(file: &[u8]) -> Result<Pixels, PictureError> {
    let mut decoder = png::Decoder::new(Cursor::new(file));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| PictureError::NotAPicture)?;
    let (width, height) = {
        let info = reader.info();
        (info.width as usize, info.height as usize)
    };
    if width.saturating_mul(height) > MAX_PIXELS {
        return Err(PictureError::TooManyPixels);
    }
    let size = reader
        .output_buffer_size()
        .ok_or(PictureError::NotAPicture)?;
    let mut buffer = vec![0; size];
    let frame = reader
        .next_frame(&mut buffer)
        .map_err(|_| PictureError::NotAPicture)?;
    let channels = frame.color_type.samples();
    let mut rgb = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let line = &buffer[y * frame.line_size..];
        for x in 0..width {
            let sample = |offset: usize| u32::from(line[x * channels + offset]);
            let (color, alpha) = match channels {
                1 => ([sample(0); 3], 255),
                2 => ([sample(0); 3], sample(1)),
                3 => ([sample(0), sample(1), sample(2)], 255),
                _ => ([sample(0), sample(1), sample(2)], sample(3)),
            };
            rgb.extend(color.map(|channel| over_white(channel, alpha)));
        }
    }
    Ok(Pixels {
        width,
        height,
        rgb,
        orientation: 1,
    })
}

/// `channel` of a pixel whose opacity is `alpha`, laid over white.
fn over_white(channel: u32, alpha: u32) -> u8 {
    let laid = (channel * alpha + 255 * (255 - alpha)) / 255;
    u8::try_from(laid).unwrap_or(u8::MAX)
}

/// The pixels of a WebP file, lossy or lossless, transparency laid over white, and its EXIF
/// orientation; an animated one gives its first frame. The decoder may hold no more than the
/// largest picture at four bytes a pixel.
fn webp_pixels(file: &[u8]) -> Result<Pixels, PictureError> {
    let mut decoder =
        image_webp::WebPDecoder::new(Cursor::new(file)).map_err(|_| PictureError::NotAPicture)?;
    let (width, height) = decoder.dimensions();
    let (width, height) = (width as usize, height as usize);
    if width.saturating_mul(height) > MAX_PIXELS {
        return Err(PictureError::TooManyPixels);
    }
    decoder.set_memory_limit(MAX_PIXELS * 4);
    let orientation = decoder
        .exif_metadata()
        .ok()
        .flatten()
        .map_or(1, |exif| exif_orientation(&exif));
    let size = decoder
        .output_buffer_size()
        .ok_or(PictureError::NotAPicture)?;
    let mut buffer = vec![0; size];
    decoder
        .read_image(&mut buffer)
        .map_err(|_| PictureError::NotAPicture)?;
    let rgb = if decoder.has_alpha() {
        let (pixels, _) = buffer.as_chunks::<4>();
        pixels
            .iter()
            .flat_map(|&[red, green, blue, alpha]| {
                [red, green, blue].map(|channel| over_white(channel.into(), alpha.into()))
            })
            .collect()
    } else {
        buffer
    };
    Ok(Pixels {
        width,
        height,
        rgb,
        orientation,
    })
}

/// The pixels of a JPEG file in RGB, and its EXIF orientation.
fn jpeg_pixels(file: &[u8]) -> Result<Pixels, PictureError> {
    use zune_jpeg::zune_core::bytestream::ZCursor;
    use zune_jpeg::zune_core::colorspace::ColorSpace;
    use zune_jpeg::zune_core::options::DecoderOptions;

    let options = DecoderOptions::default()
        .jpeg_set_out_colorspace(ColorSpace::RGB)
        .set_max_width(MAX_PIXELS)
        .set_max_height(MAX_PIXELS);
    let mut decoder = zune_jpeg::JpegDecoder::new_with_options(ZCursor::new(file), options);
    decoder
        .decode_headers()
        .map_err(|_| PictureError::NotAPicture)?;
    let (width, height) = decoder.dimensions().ok_or(PictureError::NotAPicture)?;
    if width.saturating_mul(height) > MAX_PIXELS {
        return Err(PictureError::TooManyPixels);
    }
    let orientation = decoder.exif().map_or(1, |exif| exif_orientation(exif));
    let rgb = decoder.decode().map_err(|_| PictureError::NotAPicture)?;
    if rgb.len() < width * height * 3 {
        return Err(PictureError::NotAPicture);
    }
    Ok(Pixels {
        width,
        height,
        rgb,
        orientation,
    })
}

/// The orientation tag (0x0112) of the first image directory of EXIF data, 1 where it is missing
/// or out of range: the TIFF header, then twelve-byte entries.
fn exif_orientation(exif: &[u8]) -> u8 {
    let data = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    let big_endian = match data.get(..2) {
        Some(b"MM") => true,
        Some(b"II") => false,
        _ => return 1,
    };
    let u16_at = |at: usize| {
        data.get(at..at.checked_add(2)?).map(|bytes| {
            let pair = [bytes[0], bytes[1]];
            if big_endian {
                u16::from_be_bytes(pair)
            } else {
                u16::from_le_bytes(pair)
            }
        })
    };
    let u32_at = |at: usize| {
        data.get(at..at.checked_add(4)?).map(|bytes| {
            let quad = [bytes[0], bytes[1], bytes[2], bytes[3]];
            if big_endian {
                u32::from_be_bytes(quad)
            } else {
                u32::from_le_bytes(quad)
            }
        })
    };
    let Some(directory) = u32_at(4).map(|offset| offset as usize) else {
        return 1;
    };
    let entries = u16_at(directory).unwrap_or(0);
    for entry in 0..usize::from(entries) {
        let Some(at) = directory.checked_add(2 + entry * 12) else {
            return 1;
        };
        if u16_at(at) == Some(0x0112) {
            let value = at.checked_add(8).and_then(u16_at).unwrap_or(1);
            return u8::try_from(value)
                .ok()
                .filter(|v| (1..=8).contains(v))
                .unwrap_or(1);
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::png_file;

    // AUD-007-FUN003: the spans of the longest side a picture may have, at the most stitches, cover it
    // whole and in order, with no product that a 32-bit usize could not hold.
    #[test]
    fn the_spans_of_a_very_long_side_cover_it_in_order() {
        for (pixels, stitches) in [(MAX_PIXELS, 400), (MAX_PIXELS, 7), (40, 40), (3, 400)] {
            let mut previous = 0;
            for index in 0..stitches {
                let (start, end) = span(index, stitches, pixels);
                assert!(
                    previous <= start && start < end && end <= pixels,
                    "{pixels} {stitches} {index}"
                );
                assert!(u64::try_from(end).is_ok_and(|end| end <= u64::from(u32::MAX)));
                previous = start;
            }
            assert_eq!(span(stitches - 1, stitches, pixels).1, pixels);
        }
    }

    #[test]
    fn a_picture_is_averaged_down_to_one_colour_per_stitch() {
        // Left half black, right half white: 80 by 40 pixels into 40 stitches across.
        let file = png_file(80, 40, |x, _| if x < 40 { [0; 3] } else { [255; 3] });
        let grid = grid(&file, 40).unwrap();
        assert_eq!((grid.width(), grid.height()), (40, 20));
        assert!(grid.colors()[0].l < 0.01);
        assert!((grid.colors()[39].l - 100.0).abs() < 0.01);
    }

    #[test]
    fn a_picture_is_brightened_and_its_greys_kept() {
        // A grey of its own mean stays as it is; a dull red is made more saturated.
        let mut grey = Pixels {
            width: 1,
            height: 1,
            rgb: vec![120, 120, 120],
            orientation: 1,
        };
        grey.brighten();
        assert_eq!(grey.rgb, [120, 120, 120]);
        let mut red = Pixels {
            width: 1,
            height: 1,
            rgb: vec![160, 100, 100],
            orientation: 1,
        };
        red.brighten();
        assert!(red.rgb[0] > 160 && red.rgb[1] < 100, "{:?}", red.rgb);
    }

    #[test]
    fn limits_and_wrong_files_are_refused() {
        let small = png_file(30, 30, |_, _| [128; 3]);
        assert_eq!(
            grid(&small, 40),
            Err(PictureError::NarrowerThanPattern { needed: 40 })
        );
        assert_eq!(grid(&small, 20), Err(PictureError::WidthOutOfRange));
        assert_eq!(grid(b"GIF89a", 40), Err(PictureError::NotAPicture));
        let tall = png_file(40, 900, |_, _| [128; 3]);
        assert_eq!(grid(&tall, 40), Err(PictureError::TooTall));
    }

    /// A WebP file, lossless, of `width` by `height` RGB or RGBA `pixels`, with `exif` if any.
    fn webp_file(width: u32, height: u32, pixels: &[u8], exif: Option<&[u8]>) -> Vec<u8> {
        let mut file = Vec::new();
        let mut encoder = image_webp::WebPEncoder::new(&mut file);
        if let Some(exif) = exif {
            encoder.set_exif_metadata(exif.to_vec());
        }
        let kind = if pixels.len() == (width * height * 4) as usize {
            image_webp::ColorType::Rgba8
        } else {
            image_webp::ColorType::Rgb8
        };
        encoder.encode(pixels, width, height, kind).unwrap();
        file
    }

    #[test]
    fn a_webp_picture_reads_as_the_same_picture_in_png() {
        let pixel = |x: u32, y: u32| [(x * 3) as u8, (y * 5) as u8, 90];
        let png = png_file(80, 40, pixel);
        let rgb: Vec<u8> = (0..40)
            .flat_map(|y| (0..80).flat_map(move |x| pixel(x, y)))
            .collect();
        let webp = webp_file(80, 40, &rgb, None);
        assert_eq!(grid(&webp, 40).unwrap(), grid(&png, 40).unwrap());
        // Transparent pixels are laid over white, as a PNG's are.
        let clear = webp_file(40, 20, &[0; 40 * 20 * 4], None);
        assert!((grid(&clear, 40).unwrap().colors()[0].l - 100.0).abs() < 0.01);
        // Turned a quarter by its EXIF orientation: 80 by 40 pixels stand 40 across, 80 down.
        let turned = b"MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0";
        let upright = webp_file(80, 40, &rgb, Some(turned));
        let read = grid(&upright, 40).unwrap();
        assert_eq!((read.width(), read.height()), (40, 80));
        assert_eq!(
            grid(b"RIFF\0\0\0\0WEBPVP8 ", 40),
            Err(PictureError::NotAPicture)
        );
    }

    #[test]
    fn an_exif_orientation_is_read_from_either_byte_order() {
        // TIFF header, one entry: tag 0x0112, type SHORT, count 1, value 6.
        let motorola = b"Exif\0\0MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0";
        let intel = b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0";
        assert_eq!(exif_orientation(motorola), 6);
        assert_eq!(exif_orientation(intel), 6);
        assert_eq!(exif_orientation(b"MM\0\x2a\0\0\0\x08\0"), 1);
        assert_eq!(exif_orientation(b"nothing"), 1);
    }
}
