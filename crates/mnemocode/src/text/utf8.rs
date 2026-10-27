//! Strict UTF-8 (TS `src/core/utf8-text.ts`): bytes that hold no UTF-8 character are refused, never
//! replaced with U+FFFD; a leading byte order mark is kept, since each format decides whether it
//! belongs to its text, and a valid U+FFFD stays.

use std::fmt;

use crate::refusal::Refusal;

/// Text read from something that holds bytes of no UTF-8 character.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotUtf8 {
    what: &'static str,
}

impl fmt::Display for NotUtf8 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&not_utf8_text(self.what))
    }
}

impl std::error::Error for NotUtf8 {}

impl Refusal for NotUtf8 {
    fn code(&self) -> &'static str {
        "cli.utf8.strict-utf8text-refused"
    }
}

/// Why text that holds bytes of no UTF-8 character is refused, for `what` it was read from, named
/// at the start of a sentence: "The file is not valid UTF-8 text."
pub fn not_utf8_text(what: &str) -> String {
    format!("{what} is not valid UTF-8 text.")
}

/// `bytes` as UTF-8 text, a leading byte order mark kept; refused when they are not UTF-8.
pub fn strict_utf8<'a>(bytes: &'a [u8], what: &'static str) -> Result<&'a str, NotUtf8> {
    std::str::from_utf8(bytes).map_err(|_| NotUtf8 { what })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_text_is_kept_whole_with_its_byte_order_mark() {
        assert_eq!(
            strict_utf8("\u{feff}a\u{fffd}".as_bytes(), "The file"),
            Ok("\u{feff}a\u{fffd}")
        );
    }

    #[test]
    fn bytes_of_no_character_are_refused() {
        let refused = strict_utf8(&[0x61, 0xff], "The file").unwrap_err();
        assert_eq!(refused.to_string(), "The file is not valid UTF-8 text.");
        assert_eq!(refused.code(), "cli.utf8.strict-utf8text-refused");
        assert!(strict_utf8(&[0xed, 0xa0, 0x80], "Standard input").is_err());
    }
}
