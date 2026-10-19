//! The text of a share: its deterministic CBOR, a byte string after the share's tag where the
//! encoding carries one, written as the minimal Bytewords of a compact UR or as standard Bytewords,
//! and read back. It is written here rather than through the CBOR values of dcbor and the decoder of
//! bc-ur, which keep copies of a share's bytes in memory that nothing wipes: every buffer here that
//! holds a share's bytes is made at its full size at once, so that no smaller one is left behind,
//! and is wiped when it is dropped (AUD-037-SEC006). From bc-ur it takes only the encoder of
//! Bytewords, which reads the bytes without copying them, and the list of the words.

use crate::Refusal;
use bc_ur::bytewords::{self, Style, BYTEWORDS};
use zeroize::Zeroizing;

/// The start of a share's compact UR, its type in lower case.
const UR_PREFIX: &str = "ur:sskr/";
/// The CBOR tag that the standard Bytewords of a share carry (BCR-2020-011).
const SHARE_TAG: u64 = bc_tags::TAG_SSKR_SHARE;
/// The tag of the first version of SSKR, which earlier standard Bytewords carry and are read with.
const SHARE_TAG_V1: u64 = bc_tags::TAG_SSKR_SHARE_V1;
/// The CBOR major types of a share's encoding.
const BYTE_STRING: u8 = 2;
const TAG: u8 = 6;
/// The bits of a CBOR head's first byte that hold its major type.
const MAJOR_SHIFT: u8 = 5;
/// The CRC-32 at the end of the bytes that Bytewords write.
const CHECKSUM_BYTES: usize = 4;
/// The reflected polynomial of the CRC-32 that Bytewords use (ISO-HDLC, as in zlib).
const CRC32_POLYNOMIAL: u32 = 0xEDB8_8320;

/// The deterministic head of a CBOR item of `major` type with `value`: in the fewest bytes, as
/// dcbor writes it and requires it (RFC 8949, 4.2.1). It holds a tag or a length, nothing secret.
fn head(major: u8, value: u64) -> Vec<u8> {
    let kind = major << MAJOR_SHIFT;
    if let Ok(small) = u8::try_from(value) {
        return if small < 24 {
            vec![kind | small]
        } else {
            vec![kind | 24, small]
        };
    }
    let mut written = Vec::with_capacity(9);
    if let Ok(two) = u16::try_from(value) {
        written.push(kind | 25);
        written.extend_from_slice(&two.to_be_bytes());
    } else if let Ok(four) = u32::try_from(value) {
        written.push(kind | 26);
        written.extend_from_slice(&four.to_be_bytes());
    } else {
        written.push(kind | 27);
        written.extend_from_slice(&value.to_be_bytes());
    }
    written
}

/// The value of the CBOR head of `major` type at `at` in `cbor`, which `at` then passes; refused
/// unless it is written in the fewest bytes, as dcbor refuses it.
fn read_head(cbor: &[u8], at: &mut usize, major: u8) -> Result<u64, Refusal> {
    let first = *cbor.get(*at).ok_or(Refusal::Decode)?;
    if first >> MAJOR_SHIFT != major {
        return Err(Refusal::Decode);
    }
    *at += 1;
    let (bytes, least) = match first & 0x1f {
        info @ 0..=23 => return Ok(u64::from(info)),
        24 => (1, 24),
        25 => (2, 1 << 8),
        26 => (4, 1 << 16),
        27 => (8, 1 << 32),
        _ => return Err(Refusal::Decode),
    };
    let field = cbor.get(*at..*at + bytes).ok_or(Refusal::Decode)?;
    *at += bytes;
    let value = field
        .iter()
        .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte));
    if value < least {
        return Err(Refusal::Decode);
    }
    Ok(value)
}

/// The deterministic CBOR of the share `payload`, a byte string, after the share's tag when
/// `tagged`.
fn share_cbor(payload: &[u8], tagged: bool) -> Zeroizing<Vec<u8>> {
    let tag = if tagged {
        head(TAG, SHARE_TAG)
    } else {
        Vec::new()
    };
    let length = head(
        BYTE_STRING,
        u64::try_from(payload.len()).unwrap_or(u64::MAX),
    );
    let mut cbor = Zeroizing::new(Vec::with_capacity(tag.len() + length.len() + payload.len()));
    cbor.extend_from_slice(&tag);
    cbor.extend_from_slice(&length);
    cbor.extend_from_slice(payload);
    cbor
}

/// The compact UR of the share `payload`: its untagged CBOR in minimal Bytewords.
pub(crate) fn compact_ur(payload: &[u8]) -> String {
    let body = Zeroizing::new(bytewords::encode(
        share_cbor(payload, false).as_slice(),
        Style::Minimal,
    ));
    let mut record = String::with_capacity(UR_PREFIX.len() + body.len());
    record.push_str(UR_PREFIX);
    record.push_str(&body);
    record
}

/// The standard Bytewords of the share `payload`: its tagged CBOR, words apart.
pub(crate) fn standard_bytewords(payload: &[u8]) -> String {
    bytewords::encode(share_cbor(payload, true).as_slice(), Style::Standard)
}

/// The CRC-32 of `data`, the checksum that ends the bytes of Bytewords.
fn crc32(data: &[u8]) -> u32 {
    !data.iter().fold(!0_u32, |crc, byte| {
        (0..8).fold(crc ^ u32::from(*byte), |crc, _| {
            if crc & 1 == 1 {
                (crc >> 1) ^ CRC32_POLYNOMIAL
            } else {
                crc >> 1
            }
        })
    })
}

/// The byte of a word of Bytewords: a whole word, or its first and last letters in `minimal`.
fn byte_of(word: &[u8], minimal: bool) -> Result<u8, Refusal> {
    BYTEWORDS
        .iter()
        .position(|candidate| {
            let letters = candidate.as_bytes();
            if minimal {
                word.len() == 2 && letters.first() == word.first() && letters.last() == word.last()
            } else {
                letters == word
            }
        })
        .and_then(|index| u8::try_from(index).ok())
        .ok_or(Refusal::Decode)
}

/// The bytes that the Bytewords `text` hold, without their checksum, which must fit them: words
/// apart, or in `minimal` two letters each, run together. Read as bc-ur's decoder reads them, into
/// one buffer of their full size.
fn bytes_of(text: &str, minimal: bool) -> Result<Zeroizing<Vec<u8>>, Refusal> {
    if !text.is_ascii() || (minimal && text.len() % 2 != 0) {
        return Err(Refusal::Decode);
    }
    let count = if minimal {
        text.len() / 2
    } else {
        text.split(' ').count()
    };
    let mut data = Zeroizing::new(Vec::with_capacity(count));
    if minimal {
        for word in text.as_bytes().chunks_exact(2) {
            data.push(byte_of(word, true)?);
        }
    } else {
        for word in text.split(' ') {
            data.push(byte_of(word.as_bytes(), false)?);
        }
    }
    let end = data
        .len()
        .checked_sub(CHECKSUM_BYTES)
        .ok_or(Refusal::Decode)?;
    let (body, checksum) = data.split_at(end);
    if crc32(body).to_be_bytes() != checksum {
        return Err(Refusal::Decode);
    }
    data.truncate(end);
    Ok(data)
}

/// The share in `cbor`: a byte string after one of the `tags`, or after none.
fn payload_of(cbor: &[u8], tags: &[u64]) -> Result<Zeroizing<Vec<u8>>, Refusal> {
    let mut at = 0;
    if cbor.first().map(|first| first >> MAJOR_SHIFT) == Some(TAG)
        && !tags.contains(&read_head(cbor, &mut at, TAG)?)
    {
        return Err(Refusal::Decode);
    }
    let length =
        usize::try_from(read_head(cbor, &mut at, BYTE_STRING)?).map_err(|_| Refusal::Decode)?;
    let payload = cbor.get(at..).ok_or(Refusal::Decode)?;
    if payload.len() != length {
        return Err(Refusal::Decode);
    }
    Ok(Zeroizing::new(payload.to_vec()))
}

/// The share that the compact UR `record` holds, its type and Bytewords in either case, as bc-ur
/// reads a UR: its body is the share's CBOR without a tag.
pub(crate) fn read_compact_ur(record: &str) -> Result<Zeroizing<Vec<u8>>, Refusal> {
    let lower = Zeroizing::new(record.to_ascii_lowercase());
    let body = lower.strip_prefix(UR_PREFIX).ok_or(Refusal::Decode)?;
    payload_of(&bytes_of(body, true)?, &[])
}

/// The standard Bytewords of the share `payload` without its tag, as earlier backups wrote it.
#[cfg(test)]
pub(crate) fn untagged_standard_bytewords(payload: &[u8]) -> String {
    bytewords::encode(share_cbor(payload, false).as_slice(), Style::Standard)
}

/// The share that the standard Bytewords `record` hold: the share's CBOR with its tag, or, for
/// existing backups only, the earlier tag or none.
pub(crate) fn read_standard_bytewords(record: &str) -> Result<Zeroizing<Vec<u8>>, Refusal> {
    payload_of(&bytes_of(record, false)?, &[SHARE_TAG, SHARE_TAG_V1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_cbor_heads_in_their_fewest_bytes() {
        for (value, written) in [
            (0, vec![0x40]),
            (23, vec![0x40 | 23]),
            (24, vec![0x58, 24]),
            (255, vec![0x58, 255]),
            (256, vec![0x59, 1, 0]),
            (65_536, vec![0x5a, 0, 1, 0, 0]),
        ] {
            assert_eq!(head(BYTE_STRING, value), written);
            let mut at = 0;
            assert_eq!(read_head(&written, &mut at, BYTE_STRING), Ok(value));
            assert_eq!(at, written.len());
        }
        assert_eq!(head(TAG, SHARE_TAG), vec![0xd9, 0x9d, 0x75]);
        // 21 written in two bytes is not the fewest, and is refused.
        assert_eq!(
            read_head(&[0x58, 21], &mut 0, BYTE_STRING),
            Err(Refusal::Decode)
        );
    }

    #[test]
    fn checks_the_crc32_of_the_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn refuses_bytewords_with_a_wrong_word_or_checksum() {
        let record = compact_ur(&[0x42; 21]);
        let changed = record.replacen("ur:sskr/", "ur:sskr/ae", 1);
        assert_eq!(read_compact_ur(&changed), Err(Refusal::Decode));
        assert_eq!(read_compact_ur("ur:sskr/zz"), Err(Refusal::Decode));
        assert_eq!(read_standard_bytewords("able acid"), Err(Refusal::Decode));
    }

    #[test]
    fn reads_a_compact_ur_in_either_case() {
        let record = compact_ur(&[0x42; 21]);
        assert_eq!(
            read_compact_ur(&record.to_ascii_uppercase()).map(|share| share.to_vec()),
            Ok(vec![0x42; 21])
        );
    }
}
