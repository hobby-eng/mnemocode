//! QR codes (MnemoCode TS 0.1.0's `export/qr-image.ts`, `export/qr-reader.ts` and the hosts' QR
//! matrices, CAP-CARDS-QR-PNG-EXPORT and CAP-CLI-QR-IMAGE-INPUT): a payload's matrix at error
//! correction level M, its PNG image of 720 pixels with the quiet zone of ISO/IEC 18004 (four
//! modules, owner, 2026-10-27, TS first), and a PNG read back to its text. Every matrix is drawn and
//! read back with rqrr before it is given out, and every image before it is saved: the owner's
//! product promise. A PNG is read only after its admission ([`admission`]) and an inflation bounded
//! to the scanline bytes it counted. The pixels and the text read are wiped; the decoders' own
//! copies are not reachable here.

pub mod admission;
mod segments;

use std::fmt;
use std::io::Cursor;

use crate::refusal::Refusal;
use crate::secret::{SecretBytes, SecretText};
use crate::text::utf8::{NotUtf8, strict_utf8};
use admission::{PngError, admit};

/// The blank border of a QR symbol, in modules (ISO/IEC 18004).
pub const QR_QUIET_MODULES: usize = 4;
/// The side of a saved QR image, in pixels: a QR code of a whole share still reads at a glance.
pub const QR_IMAGE_PIXELS: usize = 720;
/// The pixels of a module in the raster a matrix is checked on: crisp at any version.
const CHECK_MODULE_PIXELS: usize = 4;
/// The grey level between a dark module and a light one.
const MIDDLE_GREY: u8 = 128;
/// One pixel in this many that changes sides of the grey level is noise, no drawn page.
const NOISE_SHARE: usize = 4;
/// How many pixels each side of a pixel becomes for the second reading of an image.
const ENLARGED: usize = 2;

/// The refusals of QR codes, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QrError {
    /// The admission refused the file.
    Png(PngError),
    /// The file did not inflate or decode as its admission promised.
    InvalidPng,
    /// No QR code was found in the image.
    NoCode,
    /// The code's bytes are no UTF-8 text.
    NotText(NotUtf8),
    /// A matrix or an image made here did not read back as its payload.
    VerificationFailed,
    /// An image of no text.
    Empty,
}

impl fmt::Display for QrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Png(error) => error.fmt(f),
            Self::InvalidPng => f.write_str("The QR input is not a valid PNG file."),
            Self::NoCode => f.write_str("No readable QR code was found in the PNG file."),
            Self::NotText(error) => error.fmt(f),
            Self::Empty => f.write_str("QR payload must not be empty."),
            Self::VerificationFailed => f.write_str(
                "QR verification failed: the image is unreadable or does not match the backup. It was not saved. Try creating it again.",
            ),
        }
    }
}

impl std::error::Error for QrError {}

impl Refusal for QrError {
    fn code(&self) -> &'static str {
        match self {
            Self::Png(error) => error.code(),
            Self::InvalidPng => "cli.qr-input.invalid-png-input",
            Self::NoCode => "cli.qr-input.no-readable-qr-code-was-found-png-file",
            Self::NotText(error) => error.code(),
            Self::VerificationFailed => "export.qr-image.qr-verification-failed",
            Self::Empty => "export.qr-image.qr-payload-not-empty",
        }
    }
}

impl From<PngError> for QrError {
    fn from(error: PngError) -> Self {
        Self::Png(error)
    }
}

/// The modules of a QR symbol, without its quiet zone.
#[derive(Clone, Debug)]
pub struct Matrix {
    size: usize,
    dark: Vec<bool>,
}

impl Matrix {
    /// The modules on a side: 21 to 177.
    pub fn size(&self) -> usize {
        self.size
    }

    /// Whether the module at `row` and `column`, each from 0 and below the size, is dark.
    pub fn is_dark(&self, row: usize, column: usize) -> bool {
        row < self.size && column < self.size && self.dark[row * self.size + column]
    }
}

/// The matrix of `payload` at level M, checked: drawn with integer modules and its quiet zone, and
/// read back as `payload`; refused where it does not.
pub fn matrix(payload: &str) -> Result<Matrix, QrError> {
    // Version 40 at level M holds 2331 bytes, far above any backup or share; a payload past it
    // gives no matrix to check, and fails as one that does not read back would.
    let code = segments::code_of(payload).ok_or(QrError::VerificationFailed)?;
    let size = usize::try_from(code.size()).map_err(|_| QrError::VerificationFailed)?;
    let mut dark = Vec::with_capacity(size * size);
    for row in 0..code.size() {
        for column in 0..code.size() {
            dark.push(code.get_module(column, row));
        }
    }
    let matrix = Matrix { size, dark };
    let side = (size + 2 * QR_QUIET_MODULES) * CHECK_MODULE_PIXELS;
    let mut pixels = SecretBytes::zeroed("a QR raster", side * side);
    draw(&matrix, &mut pixels, side, CHECK_MODULE_PIXELS as f64);
    check_reads_as(read_pixels(&pixels, side, side), payload)?;
    Ok(matrix)
}

/// `matrix` drawn on `pixels`, a square of grey levels `side` wide, with its quiet zone, each module
/// `scale` pixels: node-qrcode's sampling of a module for each pixel, light 255 and dark 0.
fn draw(matrix: &Matrix, pixels: &mut [u8], side: usize, scale: f64) {
    let margin = QR_QUIET_MODULES as f64 * scale;
    for y in 0..side {
        for x in 0..side {
            let (fy, fx) = (y as f64, x as f64);
            let inside = fy >= margin
                && fx >= margin
                && fy < side as f64 - margin
                && fx < side as f64 - margin;
            let dark = inside
                && matrix.is_dark(
                    ((fy - margin) / scale) as usize,
                    ((fx - margin) / scale) as usize,
                );
            pixels[y * side + x] = if dark { 0 } else { 255 };
        }
    }
}

/// Refuses `read`, a code read back, unless it is `payload`.
fn check_reads_as(read: Result<SecretText, QrError>, payload: &str) -> Result<(), QrError> {
    match read {
        Ok(text) if text.as_str() == payload => Ok(()),
        _ => Err(QrError::VerificationFailed),
    }
}

/// The PNG image of `payload`, 720 pixels of 8-bit grey with the quiet zone, in a locked buffer:
/// read back as `payload` before it is given out, so that a caller saves only an image that reads.
pub fn png(payload: &str) -> Result<SecretBytes, QrError> {
    if payload.is_empty() {
        return Err(QrError::Empty);
    }
    let matrix = matrix(payload)?;
    let symbol = matrix.size + 2 * QR_QUIET_MODULES;
    let scale = QR_IMAGE_PIXELS as f64 / symbol as f64;
    let side = (symbol as f64 * scale) as usize;
    let mut pixels = SecretBytes::zeroed("a QR image's pixels", side * side);
    draw(&matrix, &mut pixels, side, scale);
    let mut file = Vec::new();
    let width = u32::try_from(side).map_err(|_| QrError::VerificationFailed)?;
    let mut encoder = png::Encoder::new(&mut file, width, width);
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    // The encoder writes to memory, which refuses nothing: an error is none of these images'.
    let written = encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(&pixels));
    let image = SecretBytes::copy_of("a QR image", &file);
    zeroize::Zeroize::zeroize(&mut file);
    written.map_err(|_| QrError::VerificationFailed)?;
    check_reads_as(read_png(&image), payload)?;
    Ok(image)
}

/// The text of the QR code in the PNG `bytes`: admitted, inflated within the scanline bytes the
/// admission counted, decoded, and read with rqrr, also inverted. Refused: what the admission
/// refuses, a file that does not decode as admitted, no code found, and bytes of no UTF-8 text.
pub fn read_png(bytes: &[u8]) -> Result<SecretText, QrError> {
    let admitted = admit(bytes)?;
    // png bounds its own inflation only by its allocation limit: the exact budget comes first.
    let compressed = admitted.compressed_data();
    let inflated = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(
        &compressed,
        admitted.filtered_bytes(),
    )
    .map_err(|_| QrError::InvalidPng)?;
    let inflated = SecretBytes::copy_of("a PNG's scanlines", &inflated);
    admitted
        .check_inflated_size(inflated.len())
        .map_err(|_| QrError::InvalidPng)?;
    let (luma, width, height) = grey_pixels(bytes)?;
    read_pixels(&luma, width, height)
}

/// The grey level of each pixel of the PNG `bytes`, its width and its height: expanded to 8 bits,
/// alpha laid over white, colors weighted as ITU-R BT.601 weighs them.
fn grey_pixels(bytes: &[u8]) -> Result<(SecretBytes, usize, usize), QrError> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| QrError::InvalidPng)?;
    let size = reader.output_buffer_size().ok_or(QrError::InvalidPng)?;
    let mut buffer = SecretBytes::zeroed("a PNG's pixels", size);
    let frame = reader
        .next_frame(&mut buffer)
        .map_err(|_| QrError::InvalidPng)?;
    let (width, height) = (frame.width as usize, frame.height as usize);
    let channels = frame.color_type.samples();
    let mut grey = SecretBytes::zeroed("a QR image's grey levels", width * height);
    for (pixel, level) in grey.iter_mut().enumerate() {
        let row = pixel / width;
        let at = row * frame.line_size + (pixel % width) * channels;
        let sample = |offset: usize| u32::from(buffer.get(at + offset).copied().unwrap_or(255));
        let (color, alpha) = match channels {
            1 => (sample(0), 255),
            2 => (sample(0), sample(1)),
            3 => (
                (299 * sample(0) + 587 * sample(1) + 114 * sample(2)) / 1000,
                255,
            ),
            _ => (
                (299 * sample(0) + 587 * sample(1) + 114 * sample(2)) / 1000,
                sample(3),
            ),
        };
        let over_white = (color * alpha + 255 * (255 - alpha)) / 255;
        *level = u8::try_from(over_white).unwrap_or(u8::MAX);
    }
    Ok((grey, width, height))
}

/// The text of the first of `grids` that decodes; none where none does.
fn first_text<G: rqrr::BitGrid>(grids: &[rqrr::Grid<G>]) -> Option<Result<SecretText, QrError>> {
    grids.iter().find_map(|grid| {
        let mut bytes = Vec::new();
        let decoded = grid.decode_to(&mut bytes);
        let text = decoded.ok().map(|_| {
            strict_utf8(&bytes, "The QR code")
                .map(|text| SecretText::copy_of("a QR code's text", text))
                .map_err(QrError::NotText)
        });
        zeroize::Zeroize::zeroize(&mut bytes);
        text
    })
}

/// Whether more than one pixel in [`NOISE_SHARE`] of `grey` lies on the other side of
/// [`MIDDLE_GREY`] than the pixel before it. Such noise holds no page of cards, and rqrr's search of
/// finder patterns, which has no limit of its own, would take minutes over it (CORE-50).
fn changes_at_most_pixels(grey: &[u8], width: usize) -> bool {
    let changes = grey
        .chunks_exact(width.max(1))
        .flat_map(|row| row.windows(2))
        .filter(|pair| (pair[0] < MIDDLE_GREY) != (pair[1] < MIDDLE_GREY))
        .count();
    changes > grey.len() / NOISE_SHARE
}

/// The text of the first QR code rqrr finds in `grey`, a `width` × `height` image of grey levels:
/// tried again inverted as jsQR's attemptBoth does, then with each pixel as four, black below
/// [`MIDDLE_GREY`]. On a page of cards the modules are 3.5 pixels wide, black on white, and rqrr's
/// own threshold, whose window follows the width of the image, loses most of those pages.
fn read_pixels(grey: &[u8], width: usize, height: usize) -> Result<SecretText, QrError> {
    for inverted in [false, true] {
        let mut image = rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| {
            let level = grey[y * width + x];
            if inverted { 255 - level } else { level }
        });
        if let Some(text) = first_text(&image.detect_grids()) {
            return text;
        }
    }
    if changes_at_most_pixels(grey, width) {
        return Err(QrError::NoCode);
    }
    let (wide, high) = (width * ENLARGED, height * ENLARGED);
    let mut image = rqrr::PreparedImage::prepare_from_bitmap(wide, high, |x, y| {
        grey[y / ENLARGED * width + x / ENLARGED] < MIDDLE_GREY
    });
    first_text(&image.detect_grids()).unwrap_or(Err(QrError::NoCode))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The public phrase masked with its test date, in Unicode codes: a backup's payload.
    const PAYLOAD: &str = "MNC1:seedshift:unicode:8F44901950118F44901950118F44901950118F4490194F5C";

    #[test]
    fn a_payload_is_drawn_at_level_m_and_read_back() {
        let matrix = matrix(PAYLOAD).unwrap();
        assert_eq!((matrix.size() - 21) % 4, 0);
        let image = png(PAYLOAD).unwrap();
        assert!(admission::has_signature(&image));
        assert_eq!(read_png(&image).unwrap().as_str(), PAYLOAD);
    }

    #[test]
    fn noise_is_told_from_a_drawn_code_and_gets_no_long_search() {
        let side = 1024;
        let mut state = 0x2545_u32;
        let noise: Vec<u8> = (0..side * side)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 24) as u8
            })
            .collect();
        assert!(changes_at_most_pixels(&noise, side));
        assert!(matches!(
            read_pixels(&noise, side, side),
            Err(QrError::NoCode)
        ));
        let matrix = matrix(PAYLOAD).unwrap();
        let drawn = (matrix.size() + 2 * QR_QUIET_MODULES) * CHECK_MODULE_PIXELS;
        let mut pixels = vec![0; drawn * drawn];
        draw(&matrix, &mut pixels, drawn, CHECK_MODULE_PIXELS as f64);
        assert!(!changes_at_most_pixels(&pixels, drawn));
    }

    #[test]
    fn a_matrix_keeps_level_m_where_its_version_has_room_for_more() {
        for payload in ["MNC1:seedshift:english:abandon", PAYLOAD] {
            let matrix = matrix(payload).unwrap();
            let side = (matrix.size() + 2 * QR_QUIET_MODULES) * CHECK_MODULE_PIXELS;
            let mut pixels = vec![0; side * side];
            draw(&matrix, &mut pixels, side, CHECK_MODULE_PIXELS as f64);
            let mut image = rqrr::PreparedImage::prepare_from_greyscale(side, side, |x, y| {
                pixels[y * side + x]
            });
            let grids = image.detect_grids();
            let (meta, _) = grids[0].decode().unwrap();
            // The format bits of level M are 00.
            assert_eq!(meta.ecc_level, 0, "{payload}");
        }
    }

    #[test]
    fn the_image_keeps_four_modules_of_quiet_zone_on_every_side() {
        let image = png(PAYLOAD).unwrap();
        let (grey, width, height) = grey_pixels(&image).unwrap();
        assert_eq!((width, height), (QR_IMAGE_PIXELS, QR_IMAGE_PIXELS));
        let dark: Vec<(usize, usize)> = (0..width * height)
            .filter(|&pixel| grey[pixel] < 128)
            .map(|pixel| (pixel % width, pixel / width))
            .collect();
        let left = dark.iter().map(|&(x, _)| x).min().unwrap();
        let right = dark.iter().map(|&(x, _)| x).max().unwrap();
        let top = dark.iter().map(|&(_, y)| y).min().unwrap();
        let bottom = dark.iter().map(|&(_, y)| y).max().unwrap();
        let modules = matrix(PAYLOAD).unwrap().size();
        let module_pixels = (right - left + 1) as f64 / modules as f64;
        let quiet: Vec<usize> = [left, width - 1 - right, top, height - 1 - bottom]
            .iter()
            .map(|&pixels| (pixels as f64 / module_pixels).round() as usize)
            .collect();
        assert_eq!(quiet, [4, 4, 4, 4]);
    }

    #[test]
    fn an_image_without_a_code_and_a_damaged_file_are_refused() {
        // One white pixel: its row's filter byte and its level, compressed as zlib.
        let white = miniz_oxide::deflate::compress_to_vec_zlib(&[0, 255], 6);
        let blank = admission::synthetic::image(&[
            &admission::synthetic::header(1, 1, 8, 0, 0),
            &admission::synthetic::chunk(b"IDAT", &white),
        ]);
        assert_eq!(read_png(&blank).unwrap_err(), QrError::NoCode);
        let not_inflating = admission::synthetic::image(&[
            &admission::synthetic::header(1, 1, 8, 0, 0),
            &admission::synthetic::chunk(b"IDAT", &[0]),
        ]);
        assert_eq!(read_png(&not_inflating).unwrap_err(), QrError::InvalidPng);
        assert_eq!(
            read_png(b"not a png").unwrap_err().code(),
            "core.png-admission.not-png"
        );
        assert_eq!(
            QrError::VerificationFailed.code(),
            "export.qr-image.qr-verification-failed"
        );
    }
}
