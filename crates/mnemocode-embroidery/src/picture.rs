//! The picture a pattern is made from: a PNG or JPEG file read within limits, turned upright by its
//! EXIF orientation, and averaged down to one colour per stitch in linear light.

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

/// Why a picture cannot be made into a pattern.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PictureError {
    /// The file is larger than [`MAX_FILE_BYTES`].
    FileTooLarge,
    /// The file is no PNG or JPEG picture this program reads.
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
                f.write_str("The picture is no PNG or JPEG file that can be read.")
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

/// The colours of `file` averaged down to `width` stitches across, the height following the
/// picture's shape.
///
/// # Errors
///
/// [`PictureError`]: a file too large, no PNG or JPEG, too many pixels, a width outside the
/// limits, a picture narrower than the pattern or too tall for it.
pub fn grid(file: &[u8], width: usize) -> Result<Grid, PictureError> {
    if file.len() > MAX_FILE_BYTES {
        return Err(PictureError::FileTooLarge);
    }
    if !(MIN_WIDTH..=MAX_WIDTH).contains(&width) {
        return Err(PictureError::WidthOutOfRange);
    }
    let pixels = if file.starts_with(b"\x89PNG\r\n\x1a\n") {
        png_pixels(file)?
    } else if file.starts_with(&[0xFF, 0xD8, 0xFF]) {
        jpeg_pixels(file)?
    } else {
        return Err(PictureError::NotAPicture);
    };
    let (source_width, source_height) = pixels.upright_size();
    if source_width < width {
        return Err(PictureError::NarrowerThanPattern { needed: width });
    }
    let height = (source_height * width + source_width / 2) / source_width;
    if height > MAX_HEIGHT {
        return Err(PictureError::TooTall);
    }
    let height = height.max(1);
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

/// The source pixels `[start, end)` that stitch `index` of `stitches` covers, at least one.
fn span(index: usize, stitches: usize, pixels: usize) -> (usize, usize) {
    let start = index * pixels / stitches;
    let end = ((index + 1) * pixels / stitches).max(start + 1);
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
            for channel in color {
                let over_white = (channel * alpha + 255 * (255 - alpha)) / 255;
                rgb.push(u8::try_from(over_white).unwrap_or(u8::MAX));
            }
        }
    }
    Ok(Pixels {
        width,
        height,
        rgb,
        orientation: 1,
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
