//! Hidden UTF-8 records after a QR byte segment's terminator. The public XOR pattern is camouflage,
//! not encryption; callers protect phrases with Seedshift or MHFE before making their records.
mod blocks;
mod stream;
use super::{Matrix, QrError};
use crate::secret::{SecretBytes, SecretText};
use qrcodegen::{QrCode, QrCodeEcc, Version};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const HEADER: usize = 3; // format version 1, then a big-endian u16 UTF-8 byte length
const CHECK: usize = 4;
const DOMAIN: &[u8] = b"MnemoCode QR hidden record 1";
const PATTERN: &[u8] = b"MnemoCode QR hidden record 1 pattern";

fn xor(bytes: &mut [u8], version: u8) {
    for (counter, chunk) in bytes.chunks_mut(32).enumerate() {
        let mut hash = Sha256::new();
        hash.update(PATTERN);
        hash.update([version]);
        hash.update((counter as u32).to_be_bytes());
        let mut digest = hash.finalize();
        for (byte, mask) in chunk.iter_mut().zip(digest.iter()) {
            *byte ^= mask;
        }
        digest.as_mut_slice().zeroize();
    }
}
fn check(bytes: &[u8]) -> [u8; CHECK] {
    let mut hash = Sha256::new();
    hash.update(DOMAIN);
    hash.update(bytes);
    let mut digest = hash.finalize();
    let result = [digest[0], digest[1], digest[2], digest[3]];
    digest.as_mut_slice().zeroize();
    result
}

/// A level-M matrix with a visible UTF-8 byte segment and an exact hidden UTF-8 record.
/// Both must be nonempty and fit together in version 40. Both layers are verified before return.
pub fn matrix(visible: &str, record: &str) -> Result<Matrix, QrError> {
    if visible.is_empty() || record.is_empty() {
        return Err(QrError::Empty);
    }
    let length = u16::try_from(record.len()).map_err(|_| QrError::TooLarge)?;
    let version = (1..=40)
        .find(|&v| {
            let prefix = if v < 10 { 2 } else { 3 };
            visible.len() + prefix + record.len() + HEADER + CHECK <= blocks::capacity(v)
                && (v >= 10 || visible.len() < 256)
        })
        .ok_or(QrError::TooLarge)?;
    let prefix = if version < 10 { 2 } else { 3 };
    let mut data = SecretBytes::zeroed("hidden QR codewords", blocks::capacity(version));
    // Byte mode, an 8- or 16-bit count, bytes, then the 0000 terminator. The nibbles are offset by 4.
    data[0] = 0x40;
    if prefix == 2 {
        data[0] |= (visible.len() >> 4) as u8;
        data[1] = (visible.len() << 4) as u8;
    } else {
        data[0] |= (visible.len() >> 12) as u8;
        data[1] = (visible.len() >> 4) as u8;
        data[2] = (visible.len() << 4) as u8;
    }
    for (i, b) in visible.bytes().enumerate() {
        data[prefix - 1 + i] |= b >> 4;
        data[prefix + i] = b << 4;
    }
    let start = prefix + visible.len();
    let end = start + HEADER + record.len();
    data[start] = 1;
    data[start + 1..start + 3].copy_from_slice(&length.to_be_bytes());
    data[start + HEADER..end].copy_from_slice(record.as_bytes());
    let digest = check(&data[start..end]);
    data[end..end + CHECK].copy_from_slice(&digest);
    xor(&mut data[start..end + CHECK], version);
    for (i, b) in data[end + CHECK..].iter_mut().enumerate() {
        *b = if i % 2 == 0 { 0xec } else { 0x11 };
    }
    let code = QrCode::encode_codewords(Version::new(version), QrCodeEcc::Medium, &data, None);
    let output = super::matrix_from_code(&code)?;
    let grid = rqrr::Grid::new(rqrr::SimpleGrid::from_func(output.size(), |x, y| {
        output.is_dark(y, x)
    }));
    let mut shown = Vec::new();
    let decoded = grid.decode_to(&mut shown);
    let same = decoded.is_ok() && shown == visible.as_bytes();
    zeroize::Zeroize::zeroize(&mut shown);
    if !same || read_grid(&grid)?.as_str() != record {
        return Err(QrError::VerificationFailed);
    }
    Ok(output)
}

/// A PNG holding `visible` for ordinary scanners and the exact `record` for MnemoCode.
/// The PNG is read back as both layers before it is returned.
pub fn png(visible: &str, record: &str) -> Result<SecretBytes, QrError> {
    let matrix = matrix(visible, record)?;
    let image = super::png_matrix(&matrix)?;
    if super::read_png(&image)?.as_str() != visible || read_png(&image)?.as_str() != record {
        return Err(QrError::VerificationFailed);
    }
    Ok(image)
}

/// Reads an exact hidden record from an admitted PNG, correcting level-M QR codewords.
/// Ordinary QR codes and damaged hidden records are refused, never returned as a visible contact.
pub fn read_png(bytes: &[u8]) -> Result<SecretText, QrError> {
    super::validate_png(bytes)?;
    let (grey, width, height) = super::grey_pixels(bytes)?;
    for inverted in [false, true] {
        let mut img = rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| {
            let v = grey[y * width + x];
            if inverted { 255 - v } else { v }
        });
        for grid in img.detect_grids() {
            if let Ok(record) = read_grid(&grid) {
                return Ok(record);
            }
        }
    }
    if !super::changes_at_most_pixels(&grey, width) {
        let mut img = rqrr::PreparedImage::prepare_from_bitmap(width * 2, height * 2, |x, y| {
            grey[y / 2 * width + x / 2] < 128
        });
        for grid in img.detect_grids() {
            if let Ok(record) = read_grid(&grid) {
                return Ok(record);
            }
        }
    }
    Err(QrError::NoHiddenRecord)
}

fn read_grid<G: rqrr::BitGrid>(grid: &rqrr::Grid<G>) -> Result<SecretText, QrError> {
    read_oriented_grid(grid).or_else(|_| {
        let transposed = rqrr::Grid::new(rqrr::SimpleGrid::from_func(grid.grid.size(), |x, y| {
            grid.grid.bit(x, y)
        }));
        read_oriented_grid(&transposed)
    })
}

fn read_oriented_grid<G: rqrr::BitGrid>(grid: &rqrr::Grid<G>) -> Result<SecretText, QrError> {
    let (meta, mut raw) = grid.get_raw_data().map_err(|_| QrError::NoHiddenRecord)?;
    zeroize::Zeroize::zeroize(&mut raw.data);
    // QR's format bits use 00 for M. Only this format's level M is supported.
    if meta.ecc_level != 0 {
        return Err(QrError::NoHiddenRecord);
    }
    let version = u8::try_from(meta.version.0).map_err(|_| QrError::NoHiddenRecord)?;
    if !(1..=40).contains(&version) {
        return Err(QrError::NoHiddenRecord);
    }
    let unmasked = stream::read(&grid.grid, version, meta.mask);
    let data = blocks::corrected(&unmasked, version)?;
    envelope(&data, version)
}

fn envelope(data: &[u8], version: u8) -> Result<SecretText, QrError> {
    let prefix = if version < 10 { 2 } else { 3 };
    if data.len() < prefix || data[0] >> 4 != 4 {
        return Err(QrError::NoHiddenRecord);
    }
    let length = if prefix == 2 {
        ((data[0] & 15) as usize) * 16 + (data[1] >> 4) as usize
    } else {
        ((data[0] & 15) as usize) * 4096 + (data[1] as usize) * 16 + (data[2] >> 4) as usize
    };
    let start = prefix + length;
    if start + HEADER + CHECK > data.len() || data[start - 1] & 15 != 0 {
        return Err(QrError::NoHiddenRecord);
    }
    let mut tail = SecretBytes::copy_of("hidden QR envelope", &data[start..]);
    xor(&mut tail, version);
    if tail[0] != 1 {
        return Err(QrError::NoHiddenRecord);
    }
    let size = usize::from(u16::from_be_bytes([tail[1], tail[2]]));
    let end = HEADER + size;
    if size == 0 || end + CHECK > tail.len() || check(&tail[..end]) != tail[end..end + CHECK] {
        return Err(QrError::NoHiddenRecord);
    }
    let text = std::str::from_utf8(&tail[HEADER..end]).map_err(|_| QrError::NoHiddenRecord)?;
    Ok(SecretText::copy_of("hidden QR record", text))
}

/// The format's independent Python hashlib known answer, also checked before startup controls open.
pub(crate) fn check_format() -> Result<(), QrError> {
    const VECTOR: [u8; 28] = [
        0x40, 0x65, 0x07, 0x56, 0x26, 0xc6, 0x96, 0x30, 0xc7, 0x4c, 0x25, 0x33, 0x39, 0xa2, 0x83,
        0x3a, 0x8a, 0xef, 0x05, 0x3a, 0x07, 0xa4, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
    ];
    if envelope(&VECTOR, 2)?.as_str() != "#000064" {
        return Err(QrError::VerificationFailed);
    }
    let mut damaged = VECTOR;
    damaged[12] ^= 1;
    if envelope(&damaged, 2).is_ok() {
        return Err(QrError::VerificationFailed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_independent_format_vector_and_its_corruption_are_checked() {
        check_format().unwrap();
    }
    #[test]
    fn ordinary_scanners_show_the_contact_and_hidden_readers_recover_the_exact_record() {
        let visible = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Public Test\r\nEND:VCARD";
        for record in [
            "MNC1:direct:unicode:768476847684",
            "#000064 #1EAB91",
            "28:1725 25:2163",
            "public Δ test",
        ] {
            let image = png(visible, record).unwrap();
            assert_eq!(super::super::read_png(&image).unwrap().as_str(), visible);
            assert_eq!(read_png(&image).unwrap().as_str(), record);
        }
    }
    #[test]
    fn mirrored_grids_and_large_records_preserve_the_hidden_record() {
        use rqrr::BitGrid;
        for size in [1, 256, 700, 2000] {
            let record = "r".repeat(size);
            let code = matrix("Public note", &record).unwrap();
            let mirrored = rqrr::Grid::new(rqrr::SimpleGrid::from_func(code.size(), |x, y| {
                code.is_dark(x, y)
            }));
            assert_eq!(mirrored.grid.size(), code.size());
            assert_eq!(read_grid(&mirrored).unwrap().as_str(), record);
        }
    }

    #[test]
    fn plain_codes_empty_records_and_excess_capacity_are_refused() {
        assert!(matches!(
            read_png(&super::super::png("public").unwrap()),
            Err(QrError::NoHiddenRecord)
        ));
        assert!(matches!(matrix("a", ""), Err(QrError::Empty)));
        assert!(matches!(
            matrix("a", &"x".repeat(2400)),
            Err(QrError::TooLarge)
        ));
    }
}
