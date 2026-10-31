//! The text of a share (the engine of MnemoCode TS 0.1.0, `sskr-wasm/rust/src/share_text.rs`):
//! its deterministic CBOR, a byte string after the share's tag where the encoding carries one,
//! written as the minimal Bytewords of a compact UR or as standard Bytewords. Every
//! buffer that holds a share's bytes or text is locked and reserved at its full size at once, so
//! that no smaller copy is left behind, and wiped when dropped.

use super::bytewords::BYTEWORDS;
use crate::checksum::{CRC32_BYTES, crc32};
use crate::secret::{SecretBytes, SecretText};

/// The start of a share's compact UR, its type in lower case.
pub const UR_PREFIX: &str = "ur:sskr/";
/// The CBOR tag that the standard Bytewords of a share carry (BCR-2020-011).
const SHARE_TAG: u64 = 40309;
/// The CBOR major types of a byte string, which holds the share, and of a tag.
const BYTE_STRING: u8 = 2;
const TAG: u8 = 6;
/// The bits of a CBOR head's first byte below its major type.
const MAJOR_SHIFT: u8 = 5;
/// The additional information that says how many bytes of the head's value follow its first byte
/// (RFC 8949, 3): one, two, four or eight; a value below ONE_BYTE is the value itself.
const ONE_BYTE: u8 = 24;
const TWO_BYTES: u8 = 25;
const FOUR_BYTES: u8 = 26;
const EIGHT_BYTES: u8 = 27;
/// The letters of a word of Bytewords.
const WORD_LETTERS: usize = 4;

/// The deterministic head of a CBOR item of `major` type with `value`: in the fewest bytes, as
/// dcbor writes and requires it (RFC 8949, 4.2.1). It holds a tag or a length, nothing secret.
fn head(major: u8, value: u64) -> Vec<u8> {
    let kind = major << MAJOR_SHIFT;
    if let Ok(small) = u8::try_from(value) {
        return if small < ONE_BYTE {
            vec![kind | small]
        } else {
            vec![kind | ONE_BYTE, small]
        };
    }
    let mut written = Vec::with_capacity(9);
    if let Ok(two) = u16::try_from(value) {
        written.push(kind | TWO_BYTES);
        written.extend_from_slice(&two.to_be_bytes());
    } else if let Ok(four) = u32::try_from(value) {
        written.push(kind | FOUR_BYTES);
        written.extend_from_slice(&four.to_be_bytes());
    } else {
        written.push(kind | EIGHT_BYTES);
        written.extend_from_slice(&value.to_be_bytes());
    }
    written
}

/// The deterministic CBOR of the share `payload`, a byte string after the share's tag when
/// `tagged`, and its CRC-32: the bytes that Bytewords write, in a locked buffer.
fn checked_cbor(payload: &[u8], tagged: bool) -> SecretBytes {
    let tag = if tagged {
        head(TAG, SHARE_TAG)
    } else {
        Vec::new()
    };
    let length = head(BYTE_STRING, payload.len() as u64);
    let size = tag.len() + length.len() + payload.len() + CRC32_BYTES;
    let mut cbor = SecretBytes::zeroed("a share's CBOR", size);
    let body_end = size - CRC32_BYTES;
    let (body, checksum) = cbor.split_at_mut(body_end);
    body[..tag.len()].copy_from_slice(&tag);
    body[tag.len()..tag.len() + length.len()].copy_from_slice(&length);
    body[tag.len() + length.len()..].copy_from_slice(payload);
    checksum.copy_from_slice(&crc32(body).to_be_bytes());
    cbor
}

/// `bytes` as Bytewords after `prefix`: in `minimal` the first and last letters of each word, run
/// together, otherwise the words apart; written into one locked string of its full size.
fn bytewords_text(prefix: &str, bytes: &[u8], minimal: bool) -> SecretText {
    let length = if minimal {
        2 * bytes.len()
    } else {
        (WORD_LETTERS + 1) * bytes.len() - 1
    };
    // The capacity is the text's exact length, so nothing here is refused.
    let built = SecretText::build("a share's text", prefix.len() + length, |text| {
        text.push_str(prefix)?;
        for (place, &byte) in bytes.iter().enumerate() {
            let word = BYTEWORDS[usize::from(byte)];
            if minimal {
                text.push_str(&word[..1])?;
                text.push_str(&word[WORD_LETTERS - 1..])?;
            } else {
                if place > 0 {
                    text.push(' ')?;
                }
                text.push_str(word)?;
            }
        }
        Ok::<(), crate::secret::CapacityExceeded>(())
    });
    built.unwrap_or_else(|_| SecretText::copy_of("a share's text", ""))
}

/// The compact UR of the share `payload`: its untagged CBOR in minimal Bytewords.
pub fn compact_ur(payload: &[u8]) -> SecretText {
    bytewords_text(UR_PREFIX, &checked_cbor(payload, false), true)
}

/// The standard Bytewords of the share `payload`: its tagged CBOR, words apart.
pub fn standard_bytewords(payload: &[u8]) -> SecretText {
    bytewords_text("", &checked_cbor(payload, true), false)
}

#[cfg(test)]
mod tests {
    use super::super::bytewords::byte_of;
    use super::*;
    use crate::sskr::engine::combine;
    use crate::text::hex::hex_of_bytes;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../../vectors/sskr-v1.json");
    /// The tag of the first version of SSKR, which earlier standard Bytewords carry.
    const SHARE_TAG_V1: u64 = 309;
    /// The bits of a CBOR head's first byte below its major type.
    const ADDITIONAL_INFORMATION: u8 = (1 << MAJOR_SHIFT) - 1;

    // The readers of these texts, which hold the writers above to the published shares: the
    // library reads a share through `Share`.
    /// A text that holds no share in its encoding.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct NotShare;

    /// The value of the CBOR head of `major` type at `at` in `cbor`, which `at` then passes; refused
    /// unless it is written in the fewest bytes, as dcbor refuses it.
    fn read_head(cbor: &[u8], at: &mut usize, major: u8) -> Result<u64, NotShare> {
        let first = *cbor.get(*at).ok_or(NotShare)?;
        if first >> MAJOR_SHIFT != major {
            return Err(NotShare);
        }
        *at += 1;
        let (bytes, least) = match first & ADDITIONAL_INFORMATION {
            info @ 0..ONE_BYTE => return Ok(u64::from(info)),
            ONE_BYTE => (1, u64::from(ONE_BYTE)),
            TWO_BYTES => (2, u64::from(u8::MAX) + 1),
            FOUR_BYTES => (4, u64::from(u16::MAX) + 1),
            EIGHT_BYTES => (8, u64::from(u32::MAX) + 1),
            _ => return Err(NotShare),
        };
        let field = cbor.get(*at..*at + bytes).ok_or(NotShare)?;
        *at += bytes;
        let value = field
            .iter()
            .fold(0_u64, |value, byte| (value << u8::BITS) | u64::from(*byte));
        if value < least {
            return Err(NotShare);
        }
        Ok(value)
    }

    /// The bytes that the Bytewords `text` hold, their checksum checked and left out: words apart, or
    /// in `minimal` two letters each, run together; in one locked buffer.
    fn bytes_of(text: &str, minimal: bool) -> Result<SecretBytes, NotShare> {
        if !text.is_ascii() || (minimal && !text.len().is_multiple_of(2)) {
            return Err(NotShare);
        }
        let count = if minimal {
            text.len() / 2
        } else {
            text.split(' ').count()
        };
        let words: Box<dyn Iterator<Item = &[u8]>> = if minimal {
            Box::new(
                text.as_bytes()
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(<[u8; 2]>::as_slice),
            )
        } else {
            Box::new(text.split(' ').map(str::as_bytes))
        };
        let data = SecretBytes::build("a share's CBOR", count, |filler| {
            for word in words {
                filler
                    .push(byte_of(word, minimal).ok_or(NotShare)?)
                    .map_err(|_| NotShare)?;
            }
            Ok(())
        })?;
        let end = data.len().checked_sub(CRC32_BYTES).ok_or(NotShare)?;
        let (body, checksum) = data.split_at(end);
        if crc32(body).to_be_bytes() != checksum {
            return Err(NotShare);
        }
        Ok(SecretBytes::copy_of("a share's CBOR", body))
    }

    /// The share in `cbor`: a byte string after one of the `tags`, or after none.
    fn payload_of(cbor: &[u8], tags: &[u64]) -> Result<SecretBytes, NotShare> {
        let mut at = 0;
        if cbor.first().map(|first| first >> MAJOR_SHIFT) == Some(TAG)
            && !tags.contains(&read_head(cbor, &mut at, TAG)?)
        {
            return Err(NotShare);
        }
        let length =
            usize::try_from(read_head(cbor, &mut at, BYTE_STRING)?).map_err(|_| NotShare)?;
        let payload = cbor.get(at..).ok_or(NotShare)?;
        if payload.len() != length {
            return Err(NotShare);
        }
        Ok(SecretBytes::copy_of("a share", payload))
    }

    /// The share that the compact UR `record` holds, its type and Bytewords in either ASCII case.
    fn read_compact_ur(record: &str) -> Result<SecretBytes, NotShare> {
        let lower = SecretText::copy_of("a share's text", &record.to_ascii_lowercase());
        let body = lower.as_str().strip_prefix(UR_PREFIX).ok_or(NotShare)?;
        payload_of(&bytes_of(body, true)?, &[])
    }

    /// The share that the standard Bytewords `record` hold: its CBOR with the share's tag, or, for
    /// existing backups only, the earlier tag or none.
    fn read_standard_bytewords(record: &str) -> Result<SecretBytes, NotShare> {
        payload_of(&bytes_of(record, false)?, &[SHARE_TAG, SHARE_TAG_V1])
    }

    #[test]
    fn writes_and_reads_cbor_heads_in_their_fewest_bytes() {
        for (value, written) in [
            (0, vec![0x40]),
            (23, vec![0x40 | 23]),
            (24, vec![0x58, 24]),
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
        assert_eq!(read_head(&[0x58, 21], &mut 0, BYTE_STRING), Err(NotShare));
    }

    #[test]
    fn the_published_shares_are_read_and_written_as_blockchain_commons_writes_them() {
        let vectors: Value = serde_json::from_str(VECTORS).unwrap();
        let official = &vectors["official"];
        for share in official["shares"].as_array().unwrap() {
            let text = share.as_str().unwrap();
            let payload = read_compact_ur(text).unwrap();
            assert_eq!(compact_ur(&payload).as_str(), text);
            assert_eq!(
                read_compact_ur(&text.to_ascii_uppercase()).map(|read| hex_of_bytes(&read)),
                Ok(hex_of_bytes(&payload))
            );
        }
        let read: Vec<SecretBytes> = official["bytewords"]
            .as_array()
            .unwrap()
            .iter()
            .map(|words| {
                let text = words.as_str().unwrap();
                let payload = read_standard_bytewords(text).unwrap();
                assert_eq!(standard_bytewords(&payload).as_str(), text);
                payload
            })
            .collect();
        let restored = combine(&read.iter().map(|share| &share[..]).collect::<Vec<_>>()).unwrap();
        assert_eq!(
            hex_of_bytes(&restored),
            official["entropy"].as_str().unwrap()
        );
    }

    #[test]
    fn refuses_another_word_checksum_tag_or_length() {
        let record = compact_ur(&[0x42; 21]);
        let changed = record.as_str().replacen(UR_PREFIX, "ur:sskr/ae", 1);
        assert_eq!(read_compact_ur(&changed).err(), Some(NotShare));
        assert_eq!(read_compact_ur("ur:sskr/zz").err(), Some(NotShare));
        assert_eq!(read_compact_ur("ur:sskr/\u{212a}k").err(), Some(NotShare));
        assert_eq!(read_standard_bytewords("able acid").err(), Some(NotShare));
        let mut longer = checked_cbor(&[0x42; 21], false).to_vec();
        longer.truncate(longer.len() - CRC32_BYTES);
        longer.push(0);
        let checksum = crc32(&longer).to_be_bytes();
        longer.extend_from_slice(&checksum);
        assert_eq!(
            read_compact_ur(bytewords_text(UR_PREFIX, &longer, true).as_str()).err(),
            Some(NotShare)
        );
    }
}
