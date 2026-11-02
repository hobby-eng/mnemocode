//! Which PNG files are let in (MnemoCode TS 0.1.0's `core/png-admission.ts`,
//! CAP-CLI-PNG-ADMISSION): the whole chunk stream checked, and the exact bytes of filtered
//! scanlines counted from the header, before anything is inflated or a pixel allocated. The
//! structure follows the W3C PNG specification, Third Edition (sections 5, 8.1 and 11.2).

use std::fmt;

use crate::checksum::{CRC32_BYTES, crc32};
use crate::refusal::Refusal;
use crate::secret::SecretBytes;
use crate::text::limits::{InputTooLarge, MEBIBYTE};

/// The largest QR code image read.
pub const MAX_PNG_BYTES: usize = 16 * MEBIBYTE;
/// The widest and tallest QR code image read, in pixels: far above the 720 px images MnemoCode
/// writes, low enough to bound the pixels a decoder allocates.
pub const MAX_PNG_DIMENSION: u32 = 4096;
/// A megapixel as the limit names it: 2^20 pixels.
pub const MEGAPIXEL: u64 = 1 << 20;
/// The most pixels of a QR code image read: a screen of 1920 x 1080 fits, and the QR images that
/// MnemoCode saves are 720 px; a page image is read cropped to its code (owner, 2026-11-02; TS 0.1.0
/// took 8). A smaller image shortens rqrr's search through noise, which grows faster than the
/// pixels, but does not bound it: noise of 2 megapixels has kept it for 21 s.
pub const MAX_PNG_PIXELS: u64 = 2 * MEGAPIXEL;
/// The most bits of a sample read: a QR code has two levels.
pub const MAX_PNG_SAMPLE_BITS: u8 = 8;

/// The signature, chunk framing and the types of the chunks read.
const SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
const CHUNK_HEADER_BYTES: usize = 8;
const IHDR_BYTES: usize = 13;
const IHDR: &[u8; 4] = b"IHDR";
const IDAT: &[u8; 4] = b"IDAT";
const IEND: &[u8; 4] = b"IEND";
const PLTE: &[u8; 4] = b"PLTE";
/// The bit of a chunk type's first letter that marks an ancillary chunk (lower case).
const ANCILLARY_BIT: u8 = 0x20;
/// A palette holds 1 to 256 entries of three bytes.
const PALETTE_ENTRY_BYTES: usize = 3;
const MAX_PALETTE_BYTES: usize = 256 * PALETTE_ENTRY_BYTES;
const INDEXED_COLOR: u8 = 3;
/// Where the first chunk's data starts, and the bytes through its height.
const HEADER_DATA_AT: usize = SIGNATURE.len() + CHUNK_HEADER_BYTES;
const DIMENSIONS_END: usize = HEADER_DATA_AT + 8;
/// The Adam7 interlace method; 0 is none.
const ADAM7_INTERLACE: u8 = 1;
/// x and y start and step of each Adam7 pass (section 8.1).
const ADAM7: [(u64, u64, u64, u64); 7] = [
    (0, 0, 8, 8),
    (4, 0, 8, 8),
    (0, 4, 4, 8),
    (2, 0, 4, 4),
    (0, 2, 2, 4),
    (1, 0, 2, 2),
    (0, 1, 1, 2),
];

/// The refusals of PNG files, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PngError {
    /// A file larger than [`MAX_PNG_BYTES`].
    TooLarge(InputTooLarge),
    /// A chunk stream PNG does not allow, for a reason the others do not give.
    Invalid,
    /// Dimensions of zero.
    DimensionsZero,
    /// Dimensions over the limits.
    DimensionsTooLarge,
    /// A file cut short.
    Incomplete,
    /// No PNG file.
    NotPng,
    /// A first chunk that is no IHDR.
    NoLeadingHeader,
    /// An IHDR of another length.
    HeaderLength,
    /// Samples of more than [`MAX_PNG_SAMPLE_BITS`] bits.
    WideSamples,
}

impl fmt::Display for PngError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge(error) => error.fmt(f),
            Self::Invalid => f.write_str("The QR input is not a valid PNG file."),
            Self::DimensionsZero => f.write_str("QR PNG dimensions must be non-zero."),
            Self::DimensionsTooLarge => write!(
                f,
                "QR PNG dimensions exceed the {MAX_PNG_DIMENSION} px / {}-megapixel safety limit.",
                MAX_PNG_PIXELS / MEGAPIXEL
            ),
            Self::Incomplete => f.write_str("The QR input is not a complete PNG file."),
            Self::NotPng => f.write_str("The QR input is not a PNG file."),
            Self::NoLeadingHeader => f.write_str("The QR PNG does not begin with an IHDR chunk."),
            Self::HeaderLength => f.write_str("The QR PNG has an invalid IHDR chunk length."),
            Self::WideSamples => write!(
                f,
                "The QR PNG has samples of more than {MAX_PNG_SAMPLE_BITS} bits; save it with {MAX_PNG_SAMPLE_BITS} bits per sample."
            ),
        }
    }
}

impl std::error::Error for PngError {}

impl Refusal for PngError {
    fn code(&self) -> &'static str {
        match self {
            Self::TooLarge(error) => error.code(),
            Self::Invalid => "core.png-admission.invalid-png-input",
            Self::DimensionsZero => "core.png-admission.qr-png-dimensions-non-zero",
            Self::DimensionsTooLarge => {
                "core.png-admission.qr-png-dimensions-exceed-px-megapixel-safety-limit"
            }
            Self::Incomplete => "core.png-admission.incomplete-png",
            Self::NotPng => "core.png-admission.not-png",
            Self::NoLeadingHeader => "core.png-admission.no-leading-ihdr",
            Self::HeaderLength => "core.png-admission.invalid-ihdr-length",
            Self::WideSamples => "core.png-admission.wide-samples",
        }
    }
}

/// The big-endian u32 at `at` of `bytes`; none past their end.
fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at.checked_add(4)?)?;
    Some(u32::from_be_bytes([field[0], field[1], field[2], field[3]]))
}

/// Refuses dimensions of zero or over the limits.
fn check_dimensions(width: u32, height: u32) -> Result<(), PngError> {
    if width == 0 || height == 0 {
        return Err(PngError::DimensionsZero);
    }
    let pixels = u64::from(width) * u64::from(height);
    if width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || pixels > MAX_PNG_PIXELS {
        return Err(PngError::DimensionsTooLarge);
    }
    Ok(())
}

/// The channels of a color type whose sample `depth` it permits (section 11.2.1); none otherwise.
fn channels(color: u8, depth: u8) -> Option<u64> {
    let (channels, depths): (u64, &[u8]) = match color {
        0 => (1, &[1, 2, 4, 8, 16]),
        2 => (3, &[8, 16]),
        3 => (1, &[1, 2, 4, 8]),
        4 => (2, &[8, 16]),
        6 => (4, &[8, 16]),
        _ => return None,
    };
    depths.contains(&depth).then_some(channels)
}

/// The bytes of a row of `width` pixels of `bits` each, with its filter byte.
fn row_bytes(width: u64, bits: u64) -> u64 {
    1 + (width * bits).div_ceil(8)
}

/// The filtered scanline bytes of an image, with each nonempty Adam7 pass where `interlaced`.
fn scanline_bytes(width: u64, height: u64, bits: u64, interlaced: bool) -> u64 {
    if !interlaced {
        return height * row_bytes(width, bits);
    }
    ADAM7
        .iter()
        .map(|&(x, y, x_step, y_step)| {
            let columns = width.saturating_sub(x).div_ceil(x_step);
            let rows = height.saturating_sub(y).div_ceil(y_step);
            if columns == 0 || rows == 0 {
                0
            } else {
                rows * row_bytes(columns, bits)
            }
        })
        .sum()
}

/// A PNG file let in: where its image data lies, and the exact bytes its scanlines inflate to.
#[derive(Debug)]
pub struct Admitted<'a> {
    bytes: &'a [u8],
    data: Vec<(usize, usize)>,
    filtered_bytes: usize,
}

/// Whether `bytes` start as a PNG file, whatever its name says.
pub fn has_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(&SIGNATURE)
}

/// The admission of `bytes`: their whole chunk stream checked, so that a second IHDR never
/// replaces the dimensions read. Refused: a file over [`MAX_PNG_BYTES`], cut short, no PNG, a first
/// chunk that is no IHDR of its length, dimensions of zero or over the limits, wide samples, and
/// any other chunk stream PNG does not allow.
pub fn admit(bytes: &[u8]) -> Result<Admitted<'_>, PngError> {
    if bytes.len() > MAX_PNG_BYTES {
        return Err(PngError::TooLarge(InputTooLarge::new(
            "QR PNG input",
            MAX_PNG_BYTES,
        )));
    }
    if bytes.len() < SIGNATURE.len() {
        return Err(PngError::Incomplete);
    }
    if !has_signature(bytes) {
        return Err(PngError::NotPng);
    }
    if bytes.len() < DIMENSIONS_END {
        return Err(PngError::Incomplete);
    }
    // The start is read before the chunk stream, so that a damaged one is refused with its reason;
    // the type first: a first chunk of another type is no IHDR, whatever its length.
    if bytes.get(SIGNATURE.len() + 4..HEADER_DATA_AT) != Some(IHDR.as_slice()) {
        return Err(PngError::NoLeadingHeader);
    }
    if u32_at(bytes, SIGNATURE.len()) != Some(13) {
        return Err(PngError::HeaderLength);
    }
    let width = u32_at(bytes, HEADER_DATA_AT).ok_or(PngError::Incomplete)?;
    let height = u32_at(bytes, HEADER_DATA_AT + 4).ok_or(PngError::Incomplete)?;
    check_dimensions(width, height)?;
    let mut offset = SIGNATURE.len();
    let mut budget = None;
    let (mut ended, mut palette, mut data_ended) = (false, false, false);
    let mut color = 0;
    let mut data = Vec::new();
    while offset < bytes.len() {
        let length = u32_at(bytes, offset).ok_or(PngError::Invalid)?;
        let start = offset + CHUNK_HEADER_BYTES;
        let end = start
            .checked_add(usize::try_from(length).map_err(|_| PngError::Invalid)?)
            .ok_or(PngError::Invalid)?;
        let kind = bytes.get(offset + 4..start).ok_or(PngError::Invalid)?;
        let stored = u32_at(bytes, end).ok_or(PngError::Invalid)?;
        if crc32(&bytes[offset + 4..end]) != stored {
            return Err(PngError::Invalid);
        }
        if budget.is_none() && kind != IHDR {
            return Err(PngError::Invalid);
        }
        let field = |at: usize| bytes.get(start + at).copied().ok_or(PngError::Invalid);
        if kind == IHDR {
            if budget.is_some() || end - start != IHDR_BYTES {
                return Err(PngError::Invalid);
            }
            let width = u32_at(bytes, start).ok_or(PngError::Invalid)?;
            let height = u32_at(bytes, start + 4).ok_or(PngError::Invalid)?;
            check_dimensions(width, height)?;
            let depth = field(8)?;
            color = field(9)?;
            let interlace = field(12)?;
            let layout = channels(color, depth).ok_or(PngError::Invalid)?;
            if depth > MAX_PNG_SAMPLE_BITS {
                return Err(PngError::WideSamples);
            }
            // Compression and filter method 0 are the only ones defined.
            if field(10)? != 0 || field(11)? != 0 || interlace > ADAM7_INTERLACE {
                return Err(PngError::Invalid);
            }
            let filtered = scanline_bytes(
                u64::from(width),
                u64::from(height),
                u64::from(depth) * layout,
                interlace == ADAM7_INTERLACE,
            );
            budget = Some(usize::try_from(filtered).map_err(|_| PngError::Invalid)?);
        } else if kind == IDAT {
            if data_ended || (color == INDEXED_COLOR && !palette) {
                return Err(PngError::Invalid);
            }
            data.push((start, end));
        } else {
            data_ended |= !data.is_empty();
            if kind == PLTE {
                let length = end - start;
                if palette
                    || data_ended
                    || length == 0
                    || length > MAX_PALETTE_BYTES
                    || !length.is_multiple_of(PALETTE_ENTRY_BYTES)
                {
                    return Err(PngError::Invalid);
                }
                palette = true;
            } else if kind == IEND {
                if end != start || data.is_empty() || end + CRC32_BYTES != bytes.len() {
                    return Err(PngError::Invalid);
                }
                ended = true;
            } else if kind[0] & ANCILLARY_BIT == 0 {
                return Err(PngError::Invalid);
            }
        }
        offset = end + CRC32_BYTES;
    }
    match budget {
        Some(filtered_bytes) if ended => Ok(Admitted {
            bytes,
            data,
            filtered_bytes,
        }),
        _ => Err(PngError::Invalid),
    }
}

impl Admitted<'_> {
    /// The exact inflated scanline bytes, with the filter bytes and each nonempty Adam7 pass.
    pub fn filtered_bytes(&self) -> usize {
        self.filtered_bytes
    }

    /// The image data of every IDAT chunk, joined, in a locked buffer.
    pub fn compressed_data(&self) -> SecretBytes {
        let length = self.data.iter().map(|(start, end)| end - start).sum();
        let mut joined = SecretBytes::zeroed("a PNG's compressed data", length);
        let mut at = 0;
        for &(start, end) in &self.data {
            joined[at..at + end - start].copy_from_slice(&self.bytes[start..end]);
            at += end - start;
        }
        joined
    }

    /// Refuses `length`, the inflated bytes, other than [`Admitted::filtered_bytes`]: scanlines
    /// cut short, and more than they hold, Adam7's empty passes among them.
    pub fn check_inflated_size(&self, length: usize) -> Result<(), PngError> {
        if length == self.filtered_bytes {
            Ok(())
        } else {
            Err(PngError::Invalid)
        }
    }
}

/// Synthetic PNG files for the checks of the admission, framed as section 5 says, each chunk with
/// its real CRC-32: written out here, not taken from the admission's constants, so that the checks
/// do not build their input from the reader's own rules. Public synthetic bytes only.
pub(crate) mod synthetic {
    use crate::checksum::crc32;

    /// One chunk: its length, its four-letter `kind`, `data` and the CRC-32 of both.
    pub(crate) fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        let length = u32::try_from(data.len()).unwrap_or(u32::MAX);
        let mut chunk = length.to_be_bytes().to_vec();
        chunk.extend_from_slice(&body);
        chunk.extend_from_slice(&crc32(&body).to_be_bytes());
        chunk
    }

    /// The IHDR of a `width` × `height` image of `depth` bits per sample, `color` type and
    /// `interlace` 0 for none or 1 for Adam7.
    pub(crate) fn header(width: u32, height: u32, depth: u8, color: u8, interlace: u8) -> Vec<u8> {
        let mut data = width.to_be_bytes().to_vec();
        data.extend_from_slice(&height.to_be_bytes());
        // Compression and filter method 0, the only ones defined.
        data.extend_from_slice(&[depth, color, 0, 0, interlace]);
        chunk(b"IHDR", &data)
    }

    /// A PNG file: the signature, `chunks` in turn, and IEND.
    pub(crate) fn image(chunks: &[&[u8]]) -> Vec<u8> {
        let mut file = vec![137, 80, 78, 71, 13, 10, 26, 10];
        for part in chunks {
            file.extend_from_slice(part);
        }
        file.extend_from_slice(&chunk(b"IEND", &[]));
        file
    }
}

#[cfg(test)]
mod tests {
    use super::synthetic::{chunk, header, image};
    use super::*;

    #[test]
    fn the_scanline_budget_is_counted_from_the_header() {
        let data = chunk(b"IDAT", &[0]);
        for (width, height, depth, color, interlace, filtered) in [
            (1, 1, 8, 6, 0, 5),
            (3, 5, 8, 0, 1, 25),
            (9, 2, 1, 0, 0, 6),
            (9, 9, 8, 0, 1, 100),
        ] {
            let file = image(&[&header(width, height, depth, color, interlace), &data]);
            assert_eq!(admit(&file).unwrap().filtered_bytes(), filtered);
        }
    }

    #[test]
    fn a_damaged_start_is_refused_with_its_reason() {
        let data = chunk(b"IDAT", &[0]);
        let good = image(&[&header(1, 1, 8, 0, 0), &data]);
        assert_eq!(admit(&good[..5]).unwrap_err(), PngError::Incomplete);
        assert_eq!(admit(b"GIF89a-not-a-png").unwrap_err(), PngError::NotPng);
        let other_first = image(&[&chunk(b"tEXt", &[65]), &data]);
        assert_eq!(admit(&other_first).unwrap_err(), PngError::NoLeadingHeader);
        let mut long_header = good.clone();
        long_header[11] = 14;
        assert_eq!(admit(&long_header).unwrap_err(), PngError::HeaderLength);
        let zero = image(&[&header(0, 1, 8, 0, 0), &data]);
        assert_eq!(admit(&zero).unwrap_err(), PngError::DimensionsZero);
        let wide = image(&[&header(4097, 1, 8, 0, 0), &data]);
        assert_eq!(
            admit(&wide).unwrap_err().to_string(),
            "QR PNG dimensions exceed the 4096 px / 2-megapixel safety limit."
        );
        let too_many = image(&[&header(4096, 4096, 8, 0, 0), &data]);
        assert_eq!(admit(&too_many).unwrap_err(), PngError::DimensionsTooLarge);
        let sixteen = image(&[&header(1, 1, 16, 0, 0), &data]);
        assert_eq!(admit(&sixteen).unwrap_err(), PngError::WideSamples);
        let large = vec![0; MAX_PNG_BYTES + 1];
        assert_eq!(admit(&large).unwrap_err().code(), "too-large");
    }

    #[test]
    fn a_screen_fits_and_a_square_past_two_megapixels_does_not() {
        assert_eq!(check_dimensions(1920, 1080), Ok(()));
        assert_eq!(check_dimensions(1448, 1448), Ok(()));
        assert_eq!(
            check_dimensions(1449, 1449),
            Err(PngError::DimensionsTooLarge)
        );
    }

    #[test]
    fn a_chunk_stream_png_does_not_allow_is_refused() {
        let data = chunk(b"IDAT", &[0]);
        let first = header(1, 1, 8, 0, 0);
        for refused in [
            image(&[&first, &header(4097, 1, 8, 0, 0), &data]),
            [image(&[&first, &data]), chunk(b"tEXt", &[65])].concat(),
            image(&[&header(1, 1, 8, 3, 0), &data]),
            image(&[&first]),
            image(&[&first, &chunk(b"QUUX", &[]), &data]),
            image(&[&first, &data, &chunk(b"tEXt", &[65]), &data]),
            image(&[&header(1, 1, 8, 0, 2), &data]),
            image(&[&header(1, 1, 3, 0, 0), &data]),
        ] {
            assert_eq!(admit(&refused).unwrap_err(), PngError::Invalid);
        }
        let mut damaged = image(&[&first, &data]);
        let crc = damaged.len() - 13;
        damaged[crc] ^= 1;
        assert_eq!(admit(&damaged).unwrap_err(), PngError::Invalid);
        let with_palette = image(&[&header(1, 1, 8, 3, 0), &chunk(b"PLTE", &[0, 0, 0]), &data]);
        let admitted = admit(&with_palette).unwrap();
        assert_eq!(*admitted.compressed_data(), [0]);
        assert_eq!(admitted.check_inflated_size(2), Ok(()));
        assert_eq!(admitted.check_inflated_size(3), Err(PngError::Invalid));
    }
}
