//! The forms a share is written in (MnemoCode TS 0.1.0's `src/sskr/share-units.ts`,
//! `mixed-layout.ts` and the forms of `transport.ts`, CAP-SSKR-FORM-*, CAP-SSKR-SHARE-ANY-FORM,
//! CAP-SSKR-MIXED-LAYOUT): the compact UR and standard Bytewords, which write the transport's
//! bytes, and MnemoCode's own forms, which write it mixed (its checksum, then a version, the CBOR's
//! length and the CBOR, each byte masked from the checksum) and packed into word indexes, 11 bits
//! each, or 24-bit colors, the last unit filled with zero bits. A share is read in any form, and a
//! text that is none is refused by the reader of the form it is written in (owner, 2026-10-27).

use std::fmt;

use super::bytewords::BYTEWORDS;
use super::share::{Share, TransportError};
use crate::bip39::phrase::{PhraseError, run_together_numbers, unicode_indexes_of};
use crate::bip39::sizes::{WORD_NUMBER_DIGITS, WORD_NUMBER_RANGE};
use crate::bip39::table::{index_of_number, index_of_unicode, unicode_code};
use crate::checksum::{CRC32_BYTES, crc32};
use crate::forms::Form;
use crate::forms::colors::{
    ColorsError, RGB_HEX_DIGITS, colors_to_unicode, is_color_unicode_symbol, rgb_hex,
    unicode_to_color_codes,
};
use crate::forms::hints::WordList;
use crate::refusal::Refusal;
use crate::secret::{SecretBytes, SecretText};
use crate::text::codes::{
    UNICODE_CODE_DIGITS, code_tokens, compact_code, complete_hex_units, elements_fit,
};
use crate::text::space::{trim, without_byte_order_mark};

/// The version byte of shares in colors, and of shares in word numbers or Unicode codes.
const COLOR_VERSION: u8 = 0xa1;
const WORD_VERSION: u8 = 0xa2;
/// The version and the CBOR's length before the CBOR of a mixed share.
pub(crate) const SHARE_HEADER_BYTES: usize = 2;
/// The bytes of a color, and the bits of a word index.
const RGB_BYTES: usize = 3;
const INDEX_BITS: usize = 11;
/// The most characters of a mixed share's text, as TS reads it.
const MAX_MIXED_TEXT: usize = 1024;

/// A form of shares, the standard UR first as the default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShareFormat {
    /// The compact UR, `ur:sskr/…`.
    Ur,
    /// Standard Bytewords, the registered tag included.
    Words,
    /// BIP39 word numbers.
    Indexes,
    /// Unicode codes of the Traditional Chinese list.
    Unicode,
    /// Colors, #RRGGBB.
    Colors,
    /// Colors as Unicode codes.
    ColorsUnicode,
}

/// Why a share's text holds no share, as its form's reader refuses it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShareTextError {
    /// The share's bytes or form refused it.
    Transport(TransportError),
    /// The reader of Unicode codes refused it.
    Codes(PhraseError),
    /// The reader of Color Unicode refused it.
    Colors(ColorsError),
}

impl fmt::Display for ShareTextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(error) => error.fmt(f),
            Self::Codes(error) => error.fmt(f),
            Self::Colors(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ShareTextError {}

impl Refusal for ShareTextError {
    fn code(&self) -> &'static str {
        match self {
            Self::Transport(error) => error.code(),
            Self::Codes(error) => error.code(),
            Self::Colors(error) => error.code(),
        }
    }
}

impl From<TransportError> for ShareTextError {
    fn from(error: TransportError) -> Self {
        Self::Transport(error)
    }
}

impl ShareFormat {
    /// The form of shares when none is chosen: the standard UR.
    pub const DEFAULT: Self = Self::Ur;

    /// Every form, the default first.
    pub const ALL: [Self; 6] = [
        Self::Ur,
        Self::Words,
        Self::Indexes,
        Self::Unicode,
        Self::Colors,
        Self::ColorsUnicode,
    ];

    /// The order in which the forms are tried on a text: the UR, word numbers, colors, Unicode
    /// codes, Color Unicode, and Bytewords, which take any text, last.
    const READ_ORDER: [Self; 6] = [
        Self::Ur,
        Self::Indexes,
        Self::Colors,
        Self::Unicode,
        Self::ColorsUnicode,
        Self::Words,
    ];

    /// Its name, as `--share-format` takes it.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Ur => "ur",
            Self::Words => "words",
            Self::Indexes => "indexes",
            Self::Unicode => "unicode",
            Self::Colors => "colors",
            Self::ColorsUnicode => "colors-unicode",
        }
    }

    /// The form of an encoded backup it looks like: restored shares show the phrase in it.
    pub const fn mirrored(self) -> Form {
        match self {
            Self::Ur | Self::Words => Form::English,
            Self::Indexes => Form::Indexes,
            Self::Unicode => Form::Unicode,
            Self::Colors => Form::Colors,
            Self::ColorsUnicode => Form::ColorsUnicode,
        }
    }

    /// Its name as a person reads it.
    pub fn label(self) -> String {
        match self {
            Self::Ur => "Compact UR".to_owned(),
            Self::Words => "Bytewords".to_owned(),
            Self::Indexes => format!("BIP39 word numbers ({})", WORD_NUMBER_RANGE.span()),
            Self::Unicode => "Unicode codes".to_owned(),
            Self::Colors => "RGB hexadecimal codes (ordered)".to_owned(),
            Self::ColorsUnicode => "Colors as Unicode codes".to_owned(),
        }
    }

    /// The share form a seed phrase in `form` is split into unless one is chosen: the one that
    /// looks like it, standard Bytewords for English words, which other SSKR tools read as well as
    /// the UR and a person reads more easily.
    pub const fn mirroring(form: Form) -> Self {
        match form {
            Form::English => Self::Words,
            Form::Indexes => Self::Indexes,
            Form::Unicode => Self::Unicode,
            Form::ColorsUnicode => Self::ColorsUnicode,
            Form::Colors => Self::Colors,
        }
    }

    /// Whether a share in this form is its colors, which its cards print, not codes beside them.
    pub const fn is_color(self) -> bool {
        self.mirrored().written_in_colors()
    }

    /// Whether shares in this form have cards: those that look like a form of a phrase with cards.
    pub const fn has_cards(self) -> bool {
        self.mirrored().has_cards()
    }

    /// Refuses cards of shares written in a form that has none.
    pub const fn check_has_cards(self) -> Result<(), TransportError> {
        if self.has_cards() {
            Ok(())
        } else {
            Err(TransportError::NoCards(self.name()))
        }
    }

    /// The form `name` names; refused with the list of them.
    pub fn named(name: &str) -> Result<Self, TransportError> {
        Self::ALL
            .into_iter()
            .find(|format| format.name() == name)
            .ok_or_else(|| TransportError::FormatOne(Self::ALL.map(Self::name).join(", ")))
    }

    /// Whether `text` looks like a share in this form, by its characters alone.
    fn looks(self, text: &str) -> bool {
        let hex = |token: &str| token.bytes().all(|byte| byte.is_ascii_hexdigit());
        match self {
            Self::Ur => text
                .get(..3)
                .is_some_and(|start| start.eq_ignore_ascii_case("ur:")),
            Self::Words => !text.is_empty(),
            Self::Indexes => elements_fit(text, |token| {
                token.bytes().all(|byte| byte.is_ascii_digit())
            }),
            Self::Unicode | Self::Colors => elements_fit(text, hex),
            Self::ColorsUnicode => elements_fit(text, |token| {
                token.chars().all(|character| {
                    character.is_ascii_hexdigit() || is_color_unicode_symbol(character)
                })
            }),
        }
    }

    /// Whether `text`, which no form reads, is written in this form, so that its reader gives the
    /// refusal: only Unicode codes can be told from the colors read before them.
    fn written_in(self, text: &str) -> bool {
        self == Self::Unicode && written_in_word_codes(text)
    }

    /// The share that `text`, trimmed, writes in this form.
    fn read(self, text: &str) -> Result<Share, ShareTextError> {
        Ok(match self {
            Self::Ur => Share::read_ur(text)?,
            Self::Words => Share::read_bytewords(text)?,
            Self::Indexes => {
                let numbers = code_tokens(text);
                if numbers.iter().any(|number| run_together_numbers(number)) {
                    return Err(TransportError::RunTogether.into());
                }
                let indexes: Option<Vec<u32>> = numbers
                    .iter()
                    .map(|number| share_word_index(number))
                    .collect();
                match indexes {
                    Some(indexes) if numbers.len() <= MAX_MIXED_TEXT => {
                        mixed_share(Mixed::Words, &indexes)?
                    }
                    _ => {
                        return Err(TransportError::WordNumbers(WORD_NUMBER_RANGE.through()).into());
                    }
                }
            }
            Self::Unicode => {
                if text.len() > MAX_MIXED_TEXT {
                    return Err(TransportError::UnicodeTooLong.into());
                }
                let indexes = unicode_indexes_of(text).map_err(ShareTextError::Codes)?;
                let indexes: Vec<u32> = indexes.iter().map(|&index| index as u32).collect();
                mixed_share(Mixed::Words, &indexes)?
            }
            Self::Colors => mixed_share(Mixed::Colors, &color_values(text)?)?,
            Self::ColorsUnicode => {
                let colors = unicode_to_color_codes(text).map_err(ShareTextError::Colors)?;
                mixed_share(Mixed::Colors, &color_values(&colors.join(" "))?)?
            }
        })
    }

    /// `share` written in this form, in a locked buffer.
    pub fn write(self, share: &Share) -> SecretText {
        let mixed = match self {
            Self::Ur => return share.ur(),
            Self::Words => return share.bytewords(),
            Self::Indexes | Self::Unicode => Mixed::Words,
            Self::Colors | Self::ColorsUnicode => Mixed::Colors,
        };
        let units = mixed.unpack(&mix(&share.transport(), mixed.version()));
        SecretText::copy_of("a share's text", &self.units_text(&units))
    }

    /// The text of `units` as this mixed form writes them.
    fn units_text(self, units: &[u32]) -> String {
        match self {
            Self::Indexes => units
                .iter()
                .map(|&index| (index + 1).to_string())
                .collect::<Vec<_>>()
                .join(" "),
            Self::Unicode => units
                .iter()
                .map(|&index| unicode_code(index as usize))
                .collect::<Vec<_>>()
                .join(" "),
            Self::Colors => units
                .iter()
                .map(|&color| rgb_hex(color))
                .collect::<Vec<_>>()
                .join(" "),
            Self::ColorsUnicode => {
                let colors: Vec<String> = units.iter().map(|&color| rgb_hex(color)).collect();
                colors_to_unicode(&colors).unwrap_or_default()
            }
            Self::Ur | Self::Words => String::new(),
        }
    }
}

/// The two mixed layouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mixed {
    /// Word indexes, 11 bits each.
    Words,
    /// Colors, three bytes each.
    Colors,
}

impl Mixed {
    pub(crate) const fn version(self) -> u8 {
        match self {
            Self::Words => WORD_VERSION,
            Self::Colors => COLOR_VERSION,
        }
    }

    /// The units of a share of `bytes` bytes, its checksum and header included.
    pub(crate) const fn unit_count(self, bytes: usize) -> usize {
        match self {
            Self::Words => (bytes * 8).div_ceil(INDEX_BITS),
            Self::Colors => bytes.div_ceil(RGB_BYTES),
        }
    }

    /// Why units of this form hold no share.
    const fn refusal(self) -> &'static str {
        match self {
            Self::Words => "Unsupported or truncated SSKR share in word numbers or Unicode codes.",
            Self::Colors => "Unsupported or truncated SSKR color record.",
        }
    }

    /// The units that hold `bytes`, the last filled with zero bits.
    pub(crate) fn unpack(self, bytes: &[u8]) -> Vec<u32> {
        match self {
            Self::Colors => bytes
                .chunks(RGB_BYTES)
                .map(|color| {
                    (0..RGB_BYTES).fold(0, |value, at| {
                        (value << 8) | u32::from(color.get(at).copied().unwrap_or(0))
                    })
                })
                .collect(),
            Self::Words => {
                let mut indexes = Vec::new();
                let (mut buffer, mut bits) = (0_u32, 0_usize);
                for &byte in bytes {
                    buffer = (buffer << 8) | u32::from(byte);
                    bits += 8;
                    while bits >= INDEX_BITS {
                        bits -= INDEX_BITS;
                        indexes.push((buffer >> bits) & 0x7ff);
                    }
                    buffer &= (1 << bits) - 1;
                }
                if bits > 0 {
                    indexes.push((buffer << (INDEX_BITS - bits)) & 0x7ff);
                }
                indexes
            }
        }
    }

    /// The whole bytes that `units` hold, and the bits left over after them with their count.
    pub(crate) fn pack(self, units: &[u32]) -> (Vec<u8>, u32, usize) {
        match self {
            Self::Colors => (
                units
                    .iter()
                    .flat_map(|&color| color.to_be_bytes()[1..].to_vec())
                    .collect(),
                0,
                0,
            ),
            Self::Words => {
                let mut bytes = Vec::with_capacity(units.len() * INDEX_BITS / 8);
                let (mut buffer, mut bits) = (0_u32, 0_usize);
                for &index in units {
                    buffer = (buffer << INDEX_BITS) | index;
                    bits += INDEX_BITS;
                    while bits >= 8 {
                        bits -= 8;
                        bytes.push(((buffer >> bits) & 0xff) as u8);
                    }
                    buffer &= (1 << bits) - 1;
                }
                (bytes, buffer, bits)
            }
        }
    }
}

/// The mask of the byte at `index` after a mixed share's `checksum`.
pub(crate) fn share_mask(checksum: &[u8], index: usize) -> u8 {
    let mut input = checksum.to_vec();
    input.extend_from_slice(&[(index >> 8) as u8, (index & 0xff) as u8]);
    (crc32(&input) & 0xff) as u8
}

/// The checksum, then the version, the CBOR's length and the CBOR, masked: what a mixed form packs.
fn mix(transport: &[u8], version: u8) -> SecretBytes {
    let (cbor, checksum) = transport.split_at(transport.len() - CRC32_BYTES);
    let mut mixed = SecretBytes::zeroed(
        "a mixed share",
        CRC32_BYTES + SHARE_HEADER_BYTES + cbor.len(),
    );
    mixed[..CRC32_BYTES].copy_from_slice(checksum);
    let body = [version, cbor.len() as u8]
        .into_iter()
        .chain(cbor.iter().copied());
    for (index, byte) in body.enumerate() {
        mixed[CRC32_BYTES + index] = byte ^ share_mask(checksum, index);
    }
    mixed
}

/// The share that `units` of `mixed` start with: the units after its own length, such as the decoys
/// of its cards, left out; refused with the form's words where they hold none.
fn mixed_share(mixed: Mixed, units: &[u32]) -> Result<Share, TransportError> {
    let refused = TransportError::Mixed(mixed.refusal());
    let (bytes, _, _) = mixed.pack(units);
    let own = if bytes.len() >= CRC32_BYTES + SHARE_HEADER_BYTES {
        let length = bytes[CRC32_BYTES + 1] ^ share_mask(&bytes[..CRC32_BYTES], 1);
        mixed
            .unit_count(CRC32_BYTES + SHARE_HEADER_BYTES + usize::from(length))
            .min(units.len())
    } else {
        units.len()
    };
    let (bytes, leftover, _) = mixed.pack(&units[..own]);
    if bytes.len() < CRC32_BYTES {
        return Err(refused);
    }
    let checksum = &bytes[..CRC32_BYTES];
    let body: Vec<u8> = bytes[CRC32_BYTES..]
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ share_mask(checksum, index))
        .collect();
    let length = usize::from(body.get(1).copied().unwrap_or(0));
    let end = CRC32_BYTES + SHARE_HEADER_BYTES + length;
    let filled = body.len() >= SHARE_HEADER_BYTES + length
        && bytes[end.min(bytes.len())..].iter().all(|&byte| byte == 0)
        && leftover == 0;
    if length < 1 || !filled || body[0] != mixed.version() || mixed.unit_count(end) != own {
        return Err(refused);
    }
    let mut transport = body[SHARE_HEADER_BYTES..SHARE_HEADER_BYTES + length].to_vec();
    transport.extend_from_slice(checksum);
    Share::of_transport(&transport)
}

/// The values of colors written as #RRGGBB codes in their printed order.
fn color_values(text: &str) -> Result<Vec<u32>, TransportError> {
    let codes = (text.len() <= MAX_MIXED_TEXT)
        .then(|| complete_hex_units(text, RGB_HEX_DIGITS))
        .flatten()
        .ok_or(TransportError::RgbCodes)?;
    codes
        .iter()
        .map(|code| u32::from_str_radix(code, 16).map_err(|_| TransportError::RgbCodes))
        .collect()
}

/// The word index, from 0, of a word number of a share, at most four digits; none otherwise.
pub(crate) fn share_word_index(token: &str) -> Option<u32> {
    (token.len() <= WORD_NUMBER_DIGITS)
        .then(|| index_of_number(token))
        .flatten()
        .map(|index| index as u32)
}

/// Whether `text` is written as a share in Unicode codes: its digits, separators left out, hold
/// more than one word's Unicode code at more than half as many places as it has codes, every place
/// looked at, so that codes run together that lost or gained a digit still count.
fn written_in_word_codes(text: &str) -> bool {
    let digits = compact_code(text);
    let words = (0..digits.len().saturating_sub(UNICODE_CODE_DIGITS - 1))
        .filter(|&at| {
            digits
                .get(at..at + UNICODE_CODE_DIGITS)
                .is_some_and(|code| index_of_unicode(code).is_some())
        })
        .count();
    words > 1 && words * UNICODE_CODE_DIGITS * 2 > digits.len()
}

/// The Bytewords of a share as written, in lower case: apart at the separators of elements or
/// dashes, or run together four letters each where a ? stands for a word.
pub fn byteword_units(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let apart: Vec<String> = lower
        .split(|character: char| {
            crate::text::space::is_ecmascript_space(character)
                || matches!(character, ',' | ';' | '-')
        })
        .filter(|unit| !unit.is_empty())
        .map(str::to_owned)
        .collect();
    let known = |unit: &str| unit == "?" || BYTEWORDS.contains(&unit);
    if apart.iter().all(|unit| known(unit)) {
        return apart;
    }
    let joined = apart.concat();
    let mut units = Vec::new();
    let mut rest = joined.as_str();
    while !rest.is_empty() {
        let width = if rest.starts_with('?') { 1 } else { 4 };
        let Some(unit) = rest.get(..width) else {
            return apart;
        };
        if !known(unit) {
            return apart;
        }
        units.push(unit.to_owned());
        rest = &rest[width..];
    }
    units
}

/// Bytewords as a list typed words are hinted from: apart at the spacing of elements or dashes, or
/// run together four letters each, as [`byteword_units`] reads them.
static BYTEWORD_LIST: std::sync::LazyLock<WordList> = std::sync::LazyLock::new(|| {
    WordList::new(
        ("Byteword", "Bytewords"),
        &BYTEWORDS,
        |character| {
            crate::text::space::is_ecmascript_space(character)
                || matches!(character, ',' | ';' | '-')
        },
        Some(4),
    )
});

/// The list a share typed so far is written in the words of: Bytewords where it looks like no
/// other form, as [`read_share`] takes it; none for a share in codes, colors or a UR.
pub fn share_word_list(share: &str) -> Option<&'static WordList> {
    let text = trim(share);
    ShareFormat::READ_ORDER
        .into_iter()
        .find(|format| format.looks(text))
        .filter(|&format| format == ShareFormat::Words)
        .map(|_| &*BYTEWORD_LIST)
}

/// A share read from text, and the form it was written in.
#[derive(Debug)]
pub struct ReadShare {
    /// The share.
    pub share: Share,
    /// Its form.
    pub format: ShareFormat,
}

/// The share that `value` writes in any form, trimmed and without a file's byte order mark. Text
/// that is no share is refused by the reader of the form it is written in, also where a character
/// mistyped in it makes it look like none (Unicode codes against colors); otherwise by the first
/// form it looks like. Blank text is no share.
pub fn read_share(value: &str) -> Result<ReadShare, ShareTextError> {
    let text = trim(without_byte_order_mark(value));
    let mut refusal = None;
    for format in ShareFormat::READ_ORDER {
        if !format.looks(text) {
            continue;
        }
        match format.read(text) {
            Ok(share) => return Ok(ReadShare { share, format }),
            Err(error) => {
                if refusal.is_none() || format.written_in(text) {
                    refusal = Some(error);
                }
            }
        }
    }
    for format in ShareFormat::READ_ORDER {
        if format.looks(text) || !format.written_in(text) {
            continue;
        }
        match format.read(text) {
            Ok(share) => return Ok(ReadShare { share, format }),
            Err(error) => {
                refusal = Some(error);
                break;
            }
        }
    }
    Err(refusal.unwrap_or(ShareTextError::Transport(TransportError::NotShare)))
}

/// Refuses a share QR code whose `payload` holds another share than the cards beside it print: the
/// share of the `colors`, or, where the cards print `labels`, the share's codes in another form, the
/// share those spell. Colors, labels or a payload that are no share are refused by their readers.
pub fn check_share_qr(
    colors: &str,
    payload: &str,
    labels: Option<&str>,
) -> Result<(), ShareTextError> {
    let printed = match labels {
        Some(labels) => read_share(labels)?.share,
        None => ShareFormat::Colors.read(colors)?,
    };
    if read_share(payload)?.share.payload() == printed.payload() {
        Ok(())
    } else {
        Err(TransportError::QrMismatch.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_unicode_is_refused_as_ts_refuses_it() {
        for (text, code) in [
            ("\u{e000}", "core.colors.color-unicode-pairs"),
            ("\u{e000}\u{e001}", "sskr.transport.mixed-share-refused"),
            (
                "\u{f8ff}\u{e000}",
                "core.colors.color-unicode-contains-value-outside-rrggbb-range",
            ),
        ] {
            assert_eq!(read_share(text).unwrap_err().code(), code);
        }
    }
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../../vectors/sskr-v1.json");

    fn vectors() -> Value {
        serde_json::from_str(VECTORS).unwrap()
    }

    fn official_shares() -> Vec<Share> {
        vectors()["official"]["shares"]
            .as_array()
            .unwrap()
            .iter()
            .map(|share| Share::read_ur(share.as_str().unwrap()).unwrap())
            .collect()
    }

    #[test]
    fn every_recorded_share_is_written_in_the_colors_ts_wrote() {
        let vectors = vectors();
        for vector in vectors["deterministic"].as_array().unwrap() {
            let shares = vector["shares"].as_array().unwrap();
            let colors = vector["colors"].as_array().unwrap();
            for (share, colors) in shares.iter().zip(colors) {
                let share = Share::read_ur(share.as_str().unwrap()).unwrap();
                let written: Vec<String> = ShareFormat::Colors
                    .write(&share)
                    .as_str()
                    .split(' ')
                    .map(str::to_owned)
                    .collect();
                let recorded: Vec<String> = colors
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|color| color.as_str().unwrap().to_owned())
                    .collect();
                assert_eq!(written, recorded);
            }
        }
        let first = &official_shares()[0];
        let recorded: Vec<&str> = vectors["official"]["firstShareColors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|color| color.as_str().unwrap())
            .collect();
        assert_eq!(
            ShareFormat::Colors.write(first).as_str(),
            recorded.join(" ")
        );
    }

    #[test]
    fn every_share_is_read_back_from_every_form() {
        for share in official_shares() {
            for format in ShareFormat::ALL {
                let text = format.write(&share);
                let read = read_share(text.as_str()).unwrap();
                assert_eq!(read.format, format, "{}", format.name());
                assert_eq!(read.share.payload(), share.payload(), "{}", format.name());
            }
            // Decoys after a mixed share's codes are left out.
            let colors = ShareFormat::Colors.write(&share);
            let read = read_share(&format!("{} #000000 #FFFFFF", colors.as_str())).unwrap();
            assert_eq!(read.share.payload(), share.payload());
        }
        assert_eq!(ShareFormat::named("unicode"), Ok(ShareFormat::Unicode));
        assert_eq!(
            ShareFormat::named("png").unwrap_err().to_string(),
            "The share format must be one of: ur, words, indexes, unicode, colors, colors-unicode."
        );
    }

    #[test]
    fn a_damaged_share_is_refused_by_the_reader_of_its_form() {
        let share = &official_shares()[0];
        let unicode = ShareFormat::Unicode.write(share);
        let codes: Vec<&str> = unicode.as_str().split(' ').collect();
        let code = |text: &str| read_share(text).unwrap_err().code();
        for spacing in [" ", ""] {
            assert_eq!(
                code(&codes[..codes.len() - 1].join(spacing)),
                "sskr.transport.mixed-share-refused"
            );
        }
        let mut lost = codes.clone();
        let shorter = codes[0][..3].to_owned();
        lost[0] = &shorter;
        assert_eq!(
            code(&lost.join(" ")),
            "core.words.unicode-codes-four-hexadecimal-digits-each-separated-by"
        );
        let joined = codes.concat();
        assert_eq!(
            code(&joined[1..]),
            "core.words.unicode-codes-four-hexadecimal-digits-each-separated-by"
        );
        let mut not_word = codes.clone();
        not_word[0] = "9FFF";
        assert_eq!(
            code(&not_word.join(" ")),
            "core.words.unicode-code-not-bip39-word"
        );
        let place = codes.iter().position(|code| code.contains('0')).unwrap();
        let typo = codes[place].replacen('0', "O", 1);
        let mut mistyped = codes.clone();
        mistyped[place] = &typo;
        assert_eq!(
            code(&mistyped.join(" ")),
            "core.words.unicode-codes-four-hexadecimal-digits-each-separated-by"
        );
        // Colors, cut or with a digit lost, are refused as colors, as before.
        let colors = ShareFormat::Colors.write(share);
        let parts: Vec<&str> = colors.as_str().split(' ').collect();
        assert_eq!(
            code(&parts[..parts.len() - 1].join(" ")),
            "sskr.transport.mixed-share-refused"
        );
        let mut cut = parts.clone();
        let short = parts[0][..6].to_owned();
        cut[0] = &short;
        assert_eq!(
            code(&cut.join(" ")),
            "sskr.transport.invalid-sskr-rgb-codes-preserve-their-printed-order"
        );
        assert_eq!(code("   "), "sskr.transport.not-sskr-share");
        assert_eq!(
            code("able acid also"),
            "sskr.transport.invalid-sskr-transport-length"
        );
        assert_eq!(code("ur:sskr/zz"), "sskr.transport.decoded-bytes-refused");
        assert_eq!(
            code("ur:sskr/a"),
            "sskr.transport.expected-single-part-ur-sskr-record"
        );
    }

    #[test]
    fn a_ur_is_read_through_javascripts_case_folding_and_a_files_byte_order_mark() {
        let share = &official_shares()[0];
        let ur = share.ur();
        let upper = ur.as_str().to_ascii_uppercase();
        assert!(read_share(&upper).is_ok());
        let kelvin = ur.as_str().replace("ur:sskr", "ur:ss\u{212a}r");
        assert!(read_share(&kelvin).is_ok());
        assert!(read_share(&format!("\u{feff}{}\n", ur.as_str())).is_ok());
        assert_eq!(
            byteword_units("ableacid ALSO-apex"),
            ["able", "acid", "also", "apex"]
        );
    }

    #[test]
    fn a_share_qr_must_hold_the_share_printed_beside_it() {
        let shares = official_shares();
        let printed = ShareFormat::Colors.write(&shares[0]);
        let labels = ShareFormat::Unicode.write(&shares[0]);
        let first = shares[0].ur();
        let second = shares[1].ur();
        assert_eq!(
            check_share_qr(printed.as_str(), first.as_str(), None),
            Ok(())
        );
        assert_eq!(
            check_share_qr("", first.as_str(), Some(labels.as_str())),
            Ok(())
        );
        assert_eq!(
            check_share_qr(printed.as_str(), second.as_str(), None),
            Err(ShareTextError::Transport(TransportError::QrMismatch))
        );
    }

    #[test]
    fn each_form_says_what_it_mirrors_and_whether_it_has_cards() {
        assert_eq!(ShareFormat::DEFAULT, ShareFormat::ALL[0]);
        assert_eq!(ShareFormat::Indexes.label(), "BIP39 word numbers (1-2048)");
        assert_eq!(ShareFormat::mirroring(Form::English), ShareFormat::Words);
        for form in Form::ALL {
            assert_eq!(ShareFormat::mirroring(form).mirrored(), form);
        }
        let colors: Vec<ShareFormat> = ShareFormat::ALL
            .into_iter()
            .filter(|format| format.is_color())
            .collect();
        assert_eq!(colors, [ShareFormat::Colors, ShareFormat::ColorsUnicode]);
        let cards: Vec<ShareFormat> = ShareFormat::ALL
            .into_iter()
            .filter(|format| format.has_cards())
            .collect();
        assert_eq!(
            cards,
            [
                ShareFormat::Unicode,
                ShareFormat::Colors,
                ShareFormat::ColorsUnicode
            ]
        );
        assert_eq!(
            ShareFormat::Indexes
                .check_has_cards()
                .unwrap_err()
                .to_string(),
            "Shares written as indexes have no cards: cards print shares in colors or in Unicode codes."
        );
    }
}
