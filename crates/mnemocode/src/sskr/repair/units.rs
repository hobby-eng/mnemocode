//! The units and layouts of a share as its repair reads them (MnemoCode TS 0.1.0's
//! `src/sskr/share-units.ts` and `repair-units.ts`): the bits of one unit of each form, a unit as
//! written and read, and every structure of a share's bytes that a count of units allows (its CBOR
//! layouts and, for the mixed forms, their header and length), each affine over GF(2) in the unit
//! values.

use super::super::bytewords::{BYTEWORDS, byte_of};
use super::super::forms::{Mixed, SHARE_HEADER_BYTES, ShareFormat, share_mask, share_word_index};
use super::super::gf2::{Bits, bit_fields};
use super::super::share::{
    CBOR_BYTE_STRING, CBOR_BYTE_STRING_ONE_BYTE_LENGTH, CBOR_SHORT_LENGTH_LIMIT, CBOR_UINT16_TAG,
    MEMBER_BYTE, NIBBLE_BITS, SHARE_LENGTHS, SSKR_CBOR_TAGS,
};
use super::super::text::UR_PREFIX;
use crate::bip39::table::{index_of_unicode, unicode_code};
use crate::checksum::{CRC32_BYTES, checksum_at, crc32};
use crate::forms::colors::{colors_to_unicode, rgb_hex, unicode_to_color_codes};
use crate::secret::SecretBytes;

/// The most units of a share: each holds at least one byte of its transport.
pub(crate) const MAX_REPAIR_UNITS: usize = super::super::share::MAX_TRANSPORT_BYTES;

impl ShareFormat {
    /// The mixed layout its units hold; none for the UR and Bytewords, whose units are bytes.
    pub(crate) const fn mixed(self) -> Option<Mixed> {
        match self {
            Self::Ur | Self::Words => None,
            Self::Indexes | Self::Unicode => Some(Mixed::Words),
            Self::Colors | Self::ColorsUnicode => Some(Mixed::Colors),
        }
    }

    /// The bits of one unit.
    pub(crate) const fn unit_bits(self) -> usize {
        match self {
            Self::Ur | Self::Words => 8,
            Self::Indexes | Self::Unicode => 11,
            Self::Colors | Self::ColorsUnicode => 24,
        }
    }

    /// The value of one unit as written: a pair of letters of a UR or a Byteword in lower case, a
    /// code or a color in capitals; none when it is none.
    pub(crate) fn unit_value(self, unit: &str) -> Option<u32> {
        match self {
            Self::Ur => byte_of(unit.as_bytes(), true).map(u32::from),
            Self::Words => byte_of(unit.as_bytes(), false).map(u32::from),
            Self::Indexes => share_word_index(unit),
            Self::Unicode => index_of_unicode(unit).and_then(|index| u32::try_from(index).ok()),
            Self::Colors => color_value(unit),
            Self::ColorsUnicode => match unicode_to_color_codes(unit).ok()?.as_slice() {
                [color] => color_value(color),
                _ => None,
            },
        }
    }

    /// One unit as written.
    pub(crate) fn unit_text(self, value: u32) -> String {
        let byte = || BYTEWORDS[(value & 0xff) as usize];
        match self {
            Self::Ur => {
                let word = byte().as_bytes();
                [word[0], word[word.len() - 1]]
                    .iter()
                    .map(|&letter| char::from(letter))
                    .collect()
            }
            Self::Words => byte().to_owned(),
            Self::Indexes => (value + 1).to_string(),
            Self::Unicode => unicode_code(value as usize),
            Self::Colors => rgb_hex(value),
            Self::ColorsUnicode => colors_to_unicode(&[rgb_hex(value)]).unwrap_or_default(),
        }
    }

    /// The text of a share of `values`, joined as the form writes its units.
    pub(crate) fn units_written(self, values: &[u32]) -> String {
        let units: Vec<String> = values.iter().map(|&value| self.unit_text(value)).collect();
        match self {
            Self::Ur => format!("{UR_PREFIX}{}", units.concat()),
            Self::ColorsUnicode => units.concat(),
            _ => units.join(" "),
        }
    }
}

/// The value of a color written as six hexadecimal digits in capitals, with or without its #.
fn color_value(color: &str) -> Option<u32> {
    let digits = color.strip_prefix('#').unwrap_or(color);
    (digits.len() == 6
        && digits
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte)))
    .then(|| u32::from_str_radix(digits, 16).ok())
    .flatten()
}

/// A CBOR layout of a share: its payload's length, its byte string's head in bytes, and its tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CborLayout {
    payload_length: usize,
    header: usize,
    tag: Option<u16>,
}

/// The heads that a byte string of `length` bytes may be written with: one byte where it fits,
/// and two.
fn byte_string_heads(length: usize) -> Vec<Vec<u8>> {
    let mut heads = Vec::new();
    if length < usize::from(CBOR_SHORT_LENGTH_LIMIT) {
        heads.push(vec![CBOR_BYTE_STRING + length as u8]);
    }
    heads.push(vec![CBOR_BYTE_STRING_ONE_BYTE_LENGTH, length as u8]);
    heads
}

/// The bytes that open a share tagged with `tag`.
fn tag_bytes(tag: Option<u16>) -> Vec<u8> {
    tag.map_or_else(Vec::new, |tag| {
        let [high, low] = tag.to_be_bytes();
        vec![CBOR_UINT16_TAG, high, low]
    })
}

/// No tag, then each SSKR tag a share may carry.
const TAGS: [Option<u16>; 3] = [None, Some(SSKR_CBOR_TAGS[0]), Some(SSKR_CBOR_TAGS[1])];

impl CborLayout {
    /// The bytes of its CBOR: tag, head and payload.
    fn length(self) -> usize {
        tag_bytes(self.tag).len() + self.header + self.payload_length
    }

    /// The residual rows of `cbor` in this layout: the tag, the head for its payload's length, and
    /// the reserved nibble.
    fn rows(self, cbor: &[u8]) -> Vec<(u64, usize)> {
        let tag = tag_bytes(self.tag);
        let head = byte_string_heads(self.payload_length)
            .into_iter()
            .find(|head| head.len() == self.header)
            .unwrap_or_default();
        let mut rows: Vec<(u64, usize)> = tag
            .iter()
            .chain(&head)
            .enumerate()
            .map(|(index, &byte)| (u64::from(cbor[index] ^ byte), 8))
            .collect();
        rows.push((
            u64::from(cbor[tag.len() + self.header + MEMBER_BYTE] >> NIBBLE_BITS),
            4,
        ));
        rows
    }

    /// The payload of `cbor` in this layout, a copy in a locked buffer.
    fn payload(self, cbor: &[u8]) -> SecretBytes {
        let start = tag_bytes(self.tag).len() + self.header;
        SecretBytes::copy_of(
            "a share's payload",
            &cbor[start..start + self.payload_length],
        )
    }

    /// The residual and the payload of `cbor` in this layout, `recorded` its checksum as written:
    /// the checksum against the CBOR, then `fields` of the form, then the rows of the layout.
    fn evaluate(self, cbor: &[u8], recorded: u32, fields: &[(u64, usize)]) -> (Bits, SecretBytes) {
        let mut all = vec![(u64::from(crc32(cbor) ^ recorded), CRC32_BYTES * 8)];
        all.extend_from_slice(fields);
        all.extend(self.rows(cbor));
        (bit_fields(&all), self.payload(cbor))
    }
}

/// Every CBOR layout of a mixed share: each length, each head its length allows, each tag.
fn mixed_layouts() -> Vec<CborLayout> {
    SHARE_LENGTHS
        .iter()
        .flat_map(|&payload_length| {
            byte_string_heads(payload_length)
                .into_iter()
                .flat_map(move |head| {
                    TAGS.into_iter().map(move |tag| CborLayout {
                        payload_length,
                        header: head.len(),
                        tag,
                    })
                })
        })
        .collect()
}

/// Where a mixed share of `layout` ends: its checksum, its version and length, and its CBOR.
fn mixed_end(layout: CborLayout) -> usize {
    CRC32_BYTES + SHARE_HEADER_BYTES + layout.length()
}

/// The unit counts that a mixed share of `mixed` can have, each once, in the order of the layouts.
pub(crate) fn mixed_unit_counts(mixed: Mixed) -> Vec<usize> {
    let mut counts = Vec::new();
    for layout in mixed_layouts() {
        let count = mixed.unit_count(mixed_end(layout));
        if !counts.contains(&count) {
            counts.push(count);
        }
    }
    counts
}

/// The number of units that a share of `mixed` says it has, when the units of its checksum and
/// header are `values`' first ones and all are read; none otherwise.
pub(crate) fn own_unit_count(mixed: Mixed, values: &[u32]) -> Option<usize> {
    let (bytes, _, _) = mixed.pack(values);
    let header = CRC32_BYTES + SHARE_HEADER_BYTES;
    if bytes.len() < header {
        return None;
    }
    let length = bytes[CRC32_BYTES + 1] ^ share_mask(&bytes[..CRC32_BYTES], 1);
    Some(mixed.unit_count(header + usize::from(length)))
}

/// One way the bytes of a share can be laid out, as functions of its unit values, both affine over
/// GF(2): the residual bits, zero exactly when the share is well formed, and its payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Structure {
    layout: CborLayout,
    mixed: Option<Mixed>,
}

impl Structure {
    /// The bytes of the payload in this layout: 5 of metadata and the secret's.
    pub(crate) const fn payload_length(&self) -> usize {
        self.layout.payload_length
    }

    /// The residual and the payload at `values`, one for each unit.
    pub(crate) fn evaluate(&self, values: &[u32]) -> (Bits, SecretBytes) {
        let Some(mixed) = self.mixed else {
            let bytes: Vec<u8> = values.iter().map(|&value| (value & 0xff) as u8).collect();
            let end = bytes.len() - CRC32_BYTES;
            let recorded = checksum_at(&bytes, end).unwrap_or(0);
            return self.layout.evaluate(&bytes[..end], recorded, &[]);
        };
        let (bytes, leftover, leftover_bits) = mixed.pack(values);
        let cbor_length = self.layout.length();
        let end = mixed_end(self.layout);
        let checksum = &bytes[..CRC32_BYTES];
        let body: Vec<u8> = (0..SHARE_HEADER_BYTES + cbor_length)
            .map(|index| bytes[CRC32_BYTES + index] ^ share_mask(checksum, index))
            .collect();
        let mut fields = vec![
            (u64::from(body[0] ^ mixed.version()), 8),
            (u64::from(body[1]) ^ cbor_length as u64, 8),
        ];
        fields.extend(bytes[end..].iter().map(|&byte| (u64::from(byte), 8)));
        fields.push((u64::from(leftover), leftover_bits));
        let recorded = checksum_at(&bytes, 0).unwrap_or(0);
        self.layout
            .evaluate(&body[SHARE_HEADER_BYTES..], recorded, &fields)
    }
}

/// The structures of a share of `units` units in `format`: one per layout its count holds.
pub(crate) fn structures_of(format: ShareFormat, units: usize) -> Vec<Structure> {
    match format.mixed() {
        Some(mixed) => mixed_layouts()
            .into_iter()
            .filter(|&layout| mixed.unit_count(mixed_end(layout)) == units)
            .map(|layout| Structure {
                layout,
                mixed: Some(mixed),
            })
            .collect(),
        None => TAGS
            .into_iter()
            .flat_map(|tag| {
                let bytes = units.saturating_sub(CRC32_BYTES + tag_bytes(tag).len());
                [2, 1].into_iter().filter_map(move |header| {
                    let payload_length = bytes.checked_sub(header)?;
                    (SHARE_LENGTHS.contains(&payload_length)
                        && byte_string_heads(payload_length)
                            .iter()
                            .any(|head| head.len() == header))
                    .then_some(CborLayout {
                        payload_length,
                        header,
                        tag,
                    })
                })
            })
            .map(|layout| Structure {
                layout,
                mixed: None,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sskr::forms::read_share;
    use crate::sskr::testing::{share, share_units};

    #[test]
    fn a_written_share_is_well_formed_in_one_of_its_structures() {
        let ur = share(None);
        let read = read_share(&ur).unwrap().share;
        for format in ShareFormat::ALL {
            let written = share_units(&ur, format);
            // Color Unicode's units are colors: two codes each.
            let units: Vec<String> = if format == ShareFormat::ColorsUnicode {
                written.chunks(2).map(<[String]>::concat).collect()
            } else {
                written
            };
            let values: Vec<u32> = units
                .iter()
                .map(|unit| {
                    format
                        .unit_value(&unit.to_lowercase())
                        .or_else(|| format.unit_value(unit))
                        .unwrap()
                })
                .collect();
            assert_eq!(
                format.units_written(&values),
                format.write(&read).as_str(),
                "{format:?}"
            );
            let fits: Vec<_> = structures_of(format, values.len())
                .into_iter()
                .filter(|structure| structure.evaluate(&values).0.is_zero())
                .collect();
            assert_eq!(fits.len(), 1, "{format:?}");
            assert_eq!(&*fits[0].evaluate(&values).1, read.payload());
        }
    }
}
