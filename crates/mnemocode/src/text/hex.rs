//! Bytes as hexadecimal text and back (TS `src/core/bits.ts`): what every check and every printed
//! key writes bytes as.

use std::fmt;

use crate::refusal::Refusal;

/// The hexadecimal digits of one byte.
pub const HEX_DIGITS_PER_BYTE: usize = 2;

/// Hexadecimal text that is not two digits, 0-9 or a-f, for each byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NotHexBytes;

impl fmt::Display for NotHexBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Hexadecimal text has two digits, 0-9 or a-f, for each byte.")
    }
}

impl std::error::Error for NotHexBytes {}

impl Refusal for NotHexBytes {
    fn code(&self) -> &'static str {
        "core.bits.hexadecimal-text-two-digits-0-9-f-each"
    }
}

/// Bytes as lower-case hexadecimal text, two digits each.
pub fn hex_of_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The value of one hexadecimal digit, in either case.
fn digit(byte: u8) -> Option<u8> {
    char::from(byte)
        .to_digit(16)
        .and_then(|value| u8::try_from(value).ok())
}

/// The bytes of hexadecimal text, two digits each, in either case, written into `target` as they
/// are read, so that a secret's bytes go straight into their owner; `target` takes exactly
/// `text.len() / 2` bytes. Refuses text of an odd length or with another character.
pub fn bytes_of_hex_into(text: &str, target: &mut [u8]) -> Result<(), NotHexBytes> {
    let (pairs, rest) = text.as_bytes().as_chunks::<HEX_DIGITS_PER_BYTE>();
    if !rest.is_empty() || pairs.len() != target.len() {
        return Err(NotHexBytes);
    }
    for (slot, [high, low]) in target.iter_mut().zip(pairs) {
        let (Some(high), Some(low)) = (digit(*high), digit(*low)) else {
            return Err(NotHexBytes);
        };
        *slot = (high << 4) | low;
    }
    Ok(())
}

/// The bytes of public hexadecimal text, two digits each, in either case: the inverse of
/// [`hex_of_bytes`]. A secret's text goes through [`bytes_of_hex_into`] instead.
pub fn bytes_of_hex(text: &str) -> Result<Vec<u8>, NotHexBytes> {
    if !text.len().is_multiple_of(HEX_DIGITS_PER_BYTE) {
        return Err(NotHexBytes);
    }
    let mut bytes = vec![0; text.len() / HEX_DIGITS_PER_BYTE];
    bytes_of_hex_into(text, &mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_go_to_hexadecimal_and_back() {
        assert_eq!(hex_of_bytes(&[0, 0xab, 0x7f]), "00ab7f");
        assert_eq!(bytes_of_hex("00AB7f").unwrap(), [0, 0xab, 0x7f]);
        assert_eq!(bytes_of_hex("").unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn odd_or_foreign_hexadecimal_text_is_refused() {
        for refused in ["0", "0g", "+1", " 1", "\u{e9}1"] {
            assert_eq!(bytes_of_hex(refused), Err(NotHexBytes), "{refused:?}");
        }
        let mut target = [0; 1];
        assert_eq!(bytes_of_hex_into("0102", &mut target), Err(NotHexBytes));
        assert_eq!(
            NotHexBytes.code(),
            "core.bits.hexadecimal-text-two-digits-0-9-f-each"
        );
    }
}
