//! A share and its bytes (MnemoCode TS 0.1.0's `src/sskr/share-layout.ts` and the share bytes of
//! `transport.ts`, CAP-SSKR-SHARE-BYTES-METADATA): the payload of a share, its five bytes of
//! metadata and its secret, read from the transport that every form writes (an optional CBOR tag,
//! the head of a byte string, the payload, a CRC-32) with every refusal of TS, and written back as
//! a compact UR or standard Bytewords. A share lives in a locked owner from the moment it is read.

use std::fmt;

use super::bytewords::byte_of;
use super::text::{UR_PREFIX, compact_ur, standard_bytewords};
use crate::bip39::sizes::{WORD_COUNTS, entropy_bytes};
use crate::checksum::{CRC32_BYTES, checksum_at, crc32};
use crate::refusal::Refusal;
use crate::secret::{SecretBytes, SecretText};
use crate::text::space::trim;

/// The metadata of a share before its secret: two bytes of the identifier, then the group
/// threshold and count, then the group index and member threshold, then the member index, a nibble
/// each, every threshold and count less one.
pub const SHARE_METADATA_BYTES: usize = 5;
/// The byte of the metadata that holds the group threshold and count.
pub(crate) const GROUP_BYTE: usize = 2;
/// The byte that holds the group index and the member threshold.
pub(crate) const MEMBER_THRESHOLD_BYTE: usize = 3;
/// The byte that holds the member index in its low half; its high half is reserved and zero.
pub(crate) const MEMBER_BYTE: usize = 4;
/// The bits of half a byte of the metadata.
pub(crate) const NIBBLE_BITS: usize = 4;
/// The low half of a byte of the metadata.
pub(crate) const NIBBLE_MASK: u8 = 0x0f;
/// The payload lengths of a share: its metadata and a secret of 16 to 32 bytes.
pub const SHARE_LENGTHS: [usize; WORD_COUNTS.len()] = {
    let mut lengths = [0; WORD_COUNTS.len()];
    let mut place = 0;
    while place < WORD_COUNTS.len() {
        lengths[place] = entropy_bytes(WORD_COUNTS[place]) + SHARE_METADATA_BYTES;
        place += 1;
    }
    lengths
};
/// The most bytes a share's transport may have, its checksum included.
pub const MAX_TRANSPORT_BYTES: usize = 128;
/// Members of one group: a nibble numbers them.
pub const MAX_GROUP_MEMBERS: usize = 16;
/// Groups of one set: a nibble numbers them too.
pub const MAX_GROUPS: usize = 16;
/// The SSKR tags that a share may carry: the registered one, which MnemoCode writes, and the
/// earlier one, still read.
pub(crate) const SSKR_CBOR_TAGS: [u16; 2] = [40309, 309];
/// The head of a CBOR tag of two bytes, and the head of a byte string whose length follows in one
/// byte; a byte string below 24 bytes holds its length in its head (0x40 + length).
pub(crate) const CBOR_UINT16_TAG: u8 = 0xd9;
pub(crate) const CBOR_BYTE_STRING: u8 = 0x40;
pub(crate) const CBOR_BYTE_STRING_ONE_BYTE_LENGTH: u8 = 0x58;
pub(crate) const CBOR_SHORT_LENGTH_LIMIT: u8 = 24;

/// The refusals of a share's bytes and forms, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransportError {
    /// A transport of no share's length.
    Length,
    /// A transport whose checksum does not match.
    Checksum,
    /// A CBOR tag of no share.
    NotTag,
    /// A byte string of no share's length.
    ByteString,
    /// Metadata of no share.
    Metadata,
    /// A unit of no byte: its words.
    Unit(&'static str),
    /// No single-part UR of a share.
    NotSingleUr,
    /// Bytewords longer than a share's.
    TooLong,
    /// Units of a mixed form that hold no share: the form's words.
    Mixed(&'static str),
    /// Colors that are no codes of a share.
    RgbCodes,
    /// A name of no form of shares: the forms.
    FormatOne(String),
    /// A form without cards: its name.
    NoCards(&'static str),
    /// Word numbers run together.
    RunTogether,
    /// Word numbers of no word: the range.
    WordNumbers(String),
    /// Unicode codes longer than a share's.
    UnicodeTooLong,
    /// Text of no form of shares.
    NotShare,
    /// A QR code of another share than the cards beside it print.
    QrMismatch,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Length => f.write_str("Invalid SSKR transport length."),
            Self::Checksum => f.write_str("SSKR transport checksum does not match."),
            Self::NotTag => f.write_str("Not an SSKR CBOR tag."),
            Self::ByteString => f.write_str("Invalid SSKR share byte string."),
            Self::Metadata => f.write_str("Invalid SSKR share metadata."),
            Self::Unit(words) | Self::Mixed(words) => f.write_str(words),
            Self::NotSingleUr => f.write_str("Expected a single-part ur:sskr record."),
            Self::TooLong => f.write_str("SSKR record is too long."),
            Self::RgbCodes => f.write_str("Invalid SSKR RGB codes. Preserve their printed order."),
            Self::FormatOne(forms) => write!(f, "The share format must be one of: {forms}."),
            Self::NoCards(form) => write!(
                f,
                "Shares written as {form} have no cards: cards print shares in colors or in Unicode codes."
            ),
            Self::RunTogether => crate::bip39::phrase::PhraseError::RunTogether.fmt(f),
            Self::WordNumbers(range) => {
                write!(f, "Word numbers of a share are whole numbers from {range}.")
            }
            Self::UnicodeTooLong => f.write_str("The Unicode codes of a share are too long."),
            Self::NotShare => f.write_str("This is not an SSKR share."),
            Self::QrMismatch => f.write_str("Share QR does not match the printed references."),
        }
    }
}

impl std::error::Error for TransportError {}

impl Refusal for TransportError {
    fn code(&self) -> &'static str {
        match self {
            Self::Length => "sskr.transport.invalid-sskr-transport-length",
            Self::Checksum => "sskr.transport.sskr-transport-checksum-does-not-match",
            Self::NotTag => "sskr.transport.not-sskr-cbor-tag",
            Self::ByteString => "sskr.transport.invalid-sskr-share-byte-string",
            Self::Metadata => "sskr.transport.invalid-sskr-share-metadata",
            Self::Unit(_) => "sskr.transport.decoded-bytes-refused",
            Self::NotSingleUr => "sskr.transport.expected-single-part-ur-sskr-record",
            Self::TooLong => "sskr.transport.sskr-record-too-long",
            Self::Mixed(_) => "sskr.transport.mixed-share-refused",
            Self::RgbCodes => "sskr.transport.invalid-sskr-rgb-codes-preserve-their-printed-order",
            Self::FormatOne(_) => "sskr.transport.share-format-one",
            Self::NoCards(_) => "sskr.transport.shares-written-as-no-cards-cards-print-shares",
            Self::RunTogether => "sskr.transport.word-numbers-run-together",
            Self::WordNumbers(_) => "sskr.transport.word-numbers-share-whole-numbers-from",
            Self::UnicodeTooLong => "sskr.transport.unicode-codes-share-too-long",
            Self::NotShare => "sskr.transport.not-sskr-share",
            Self::QrMismatch => "sskr.transport.share-qr-does-not-match-printed-references",
        }
    }
}

/// The metadata of a share.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShareInfo {
    /// The set's identifier, the same on every share of one split.
    pub identifier: u16,
    /// The groups that a restore needs, 1 to 16, never more than the groups.
    pub group_threshold: usize,
    /// The groups of the set, 1 to 16.
    pub group_count: usize,
    /// The share's group, from 0.
    pub group_index: usize,
    /// The members of its group that a restore needs, 1 to 16.
    pub member_threshold: usize,
    /// The share's member in its group, from 0.
    pub member_index: usize,
    /// The secret's length in bytes: 16, 20, 24, 28 or 32.
    pub secret_length: usize,
}

/// A share: its payload, metadata and secret, in a locked owner, and its metadata read.
pub struct Share {
    payload: SecretBytes,
    info: ShareInfo,
}

impl fmt::Debug for Share {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a share")
    }
}

/// The metadata of `payload`, a share's; refused for a reserved bit set, or a group threshold or
/// index beyond the groups.
fn info_of(payload: &[u8]) -> Result<ShareInfo, TransportError> {
    let [high, low, groups, member_threshold, member, ..] = *payload else {
        return Err(TransportError::ByteString);
    };
    let info = ShareInfo {
        identifier: u16::from_be_bytes([high, low]),
        group_threshold: usize::from(groups >> NIBBLE_BITS) + 1,
        group_count: usize::from(groups & NIBBLE_MASK) + 1,
        group_index: usize::from(member_threshold >> NIBBLE_BITS),
        member_threshold: usize::from(member_threshold & NIBBLE_MASK) + 1,
        member_index: usize::from(member & NIBBLE_MASK),
        secret_length: payload.len() - SHARE_METADATA_BYTES,
    };
    if member >> NIBBLE_BITS != 0
        || info.group_threshold > info.group_count
        || info.group_index >= info.group_count
    {
        return Err(TransportError::Metadata);
    }
    Ok(info)
}

impl Share {
    /// The share whose `payload`, metadata and secret, the engine made or read; refused for a
    /// payload of no share.
    pub fn of_payload(payload: &[u8]) -> Result<Self, TransportError> {
        if !SHARE_LENGTHS.contains(&payload.len()) {
            return Err(TransportError::ByteString);
        }
        let info = info_of(payload)?;
        Ok(Self {
            payload: SecretBytes::copy_of("a share", payload),
            info,
        })
    }

    /// The share whose transport is `transport`: its checksum, then a CBOR tag of a share if it has
    /// one, then a definite byte string of a share's length, then its metadata. A transport cut
    /// short is a share refused, never a fault.
    pub fn of_transport(transport: &[u8]) -> Result<Self, TransportError> {
        if transport.len() < CRC32_BYTES + 1 || transport.len() > MAX_TRANSPORT_BYTES {
            return Err(TransportError::Length);
        }
        let end = transport.len() - CRC32_BYTES;
        if Some(crc32(&transport[..end])) != checksum_at(transport, end) {
            return Err(TransportError::Checksum);
        }
        let cbor = &transport[..end];
        let mut at = 0;
        if cbor.first() == Some(&CBOR_UINT16_TAG) {
            let tag = cbor
                .get(1..3)
                .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]));
            if !tag.is_some_and(|tag| SSKR_CBOR_TAGS.contains(&tag)) {
                return Err(TransportError::NotTag);
            }
            at = 3;
        }
        let head = cbor.get(at).copied();
        at += 1;
        let length = match head {
            Some(head)
                if (CBOR_BYTE_STRING..CBOR_BYTE_STRING + CBOR_SHORT_LENGTH_LIMIT)
                    .contains(&head) =>
            {
                Some(usize::from(head - CBOR_BYTE_STRING))
            }
            Some(CBOR_BYTE_STRING_ONE_BYTE_LENGTH) => {
                at += 1;
                cbor.get(at - 1).map(|&length| usize::from(length))
            }
            _ => None,
        };
        let payload = cbor.get(at..).unwrap_or_default();
        if length != Some(payload.len()) || !SHARE_LENGTHS.contains(&payload.len()) {
            return Err(TransportError::ByteString);
        }
        Self::of_payload(payload)
    }

    /// A copy of the share, in a locked owner of its own.
    pub fn copy(&self) -> Self {
        Self {
            payload: SecretBytes::copy_of("a share", &self.payload),
            info: self.info,
        }
    }

    /// Its metadata.
    pub fn info(&self) -> ShareInfo {
        self.info
    }

    /// Its payload, as the engine takes it.
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Its transport in its canonical form: the byte string with the shortest head, untagged, and
    /// its CRC-32, which the mixed forms write.
    pub fn transport(&self) -> SecretBytes {
        let length = self.payload.len();
        // A share's payload is 21 to 37 bytes: below 24 its length sits in the head.
        let head: &[u8] = if length < usize::from(CBOR_SHORT_LENGTH_LIMIT) {
            &[CBOR_BYTE_STRING + length as u8]
        } else {
            &[CBOR_BYTE_STRING_ONE_BYTE_LENGTH, length as u8]
        };
        let mut transport =
            SecretBytes::zeroed("a share's transport", head.len() + length + CRC32_BYTES);
        let (cbor, checksum) = transport.split_at_mut(head.len() + length);
        cbor[..head.len()].copy_from_slice(head);
        cbor[head.len()..].copy_from_slice(&self.payload);
        checksum.copy_from_slice(&crc32(cbor).to_be_bytes());
        transport
    }

    /// Its compact UR, `ur:sskr/…`.
    pub fn ur(&self) -> SecretText {
        compact_ur(&self.payload)
    }

    /// Its standard Bytewords, with the registered tag.
    pub fn bytewords(&self) -> SecretText {
        standard_bytewords(&self.payload)
    }

    /// The share that `text` writes as a single-part UR, its prefix in any case, its checksum
    /// checked; refused for any other text, a pair of letters of no byte, and bytes of no share.
    pub fn read_ur(text: &str) -> Result<Self, TransportError> {
        let text = trim(text);
        let prefix = ur_prefix_end(text);
        // The letters of the body, two per byte; a Kelvin sign is a k, a long s no letter of a byte.
        let body: Vec<u8> = text[prefix.unwrap_or(0)..]
            .chars()
            .map(|written| match written {
                '\u{212a}' => Some(b'k'),
                '\u{17f}' => Some(b'?'),
                letter if letter.is_ascii_alphabetic() => Some(letter.to_ascii_lowercase() as u8),
                _ => None,
            })
            .collect::<Option<_>>()
            .unwrap_or_default();
        if prefix.is_none()
            || body.is_empty()
            || !body.len().is_multiple_of(2)
            || body.len() > MAX_TRANSPORT_BYTES * 2
        {
            return Err(TransportError::NotSingleUr);
        }
        let pairs: Vec<&[u8]> = body
            .as_chunks::<2>()
            .0
            .iter()
            .map(<[u8; 2]>::as_slice)
            .collect();
        Self::of_transport(&bytes_of(
            &pairs,
            true,
            "Unknown Bytewords pair in SSKR record.",
        )?)
    }

    /// The share that `text` writes in standard Bytewords, apart or run together; refused for too
    /// many words, words that are no Bytewords and bytes of no share.
    pub fn read_bytewords(text: &str) -> Result<Self, TransportError> {
        let words = super::forms::byteword_units(text);
        if words.len() > MAX_TRANSPORT_BYTES {
            return Err(TransportError::TooLong);
        }
        let units: Vec<&[u8]> = words.iter().map(String::as_bytes).collect();
        Self::of_transport(&bytes_of(&units, false, "Unknown SSKR Byteword.")?)
    }
}

/// Where the UR prefix `ur:sskr/` ends at the start of `text`, in bytes: in any case, as
/// JavaScript's case-insensitive Unicode match takes it, where the long s and the Kelvin sign are s
/// and k too; none when `text` does not start so.
pub(crate) fn ur_prefix_end(text: &str) -> Option<usize> {
    let mut characters = text.char_indices();
    for wanted in UR_PREFIX.chars() {
        let (_, written) = characters.next()?;
        if folded(written) != wanted {
            return None;
        }
    }
    Some(characters.next().map_or(text.len(), |(at, _)| at))
}

/// `character` as a case-insensitive Unicode match of JavaScript compares it with lower-case ASCII.
fn folded(character: char) -> char {
    match character {
        '\u{212a}' => 'k',
        '\u{17f}' => 's',
        other => other.to_ascii_lowercase(),
    }
}

/// The bytes of `units`, Bytewords or their minimal pairs, in a locked buffer; refused with
/// `unknown` at the first unit of no byte.
fn bytes_of(
    units: &[&[u8]],
    minimal: bool,
    unknown: &'static str,
) -> Result<SecretBytes, TransportError> {
    SecretBytes::build("a share's transport", units.len(), |filler| {
        for unit in units {
            let byte = byte_of(unit, minimal).ok_or(TransportError::Unit(unknown))?;
            filler
                .push(byte)
                .map_err(|_| TransportError::Unit(unknown))?;
        }
        Ok(())
    })
}
