//! The names of byte limits and the refusal of an input past its limit (TS
//! `src/core/byte-units.ts`). TS has one limit, 1 MiB; the port gives each question its own
//! (docs/design/architect/PLAN.md, "Owner decisions"), named in the largest unit that divides it.

use std::fmt;

use crate::refusal::Refusal;

/// Bytes in a kibibyte (IEC 80000-13).
pub const KIBIBYTE: usize = 1024;
/// Bytes in a mebibyte.
pub const MEBIBYTE: usize = 1024 * KIBIBYTE;

/// A limit of `bytes` as the messages name it: "1 MiB", "4 KiB", or "100 bytes".
pub fn limit_name(bytes: usize) -> String {
    if bytes >= MEBIBYTE && bytes.is_multiple_of(MEBIBYTE) {
        format!("{} MiB", bytes / MEBIBYTE)
    } else if bytes >= KIBIBYTE && bytes.is_multiple_of(KIBIBYTE) {
        format!("{} KiB", bytes / KIBIBYTE)
    } else {
        format!("{bytes} bytes")
    }
}

/// An input larger than its limit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputTooLarge {
    what: &'static str,
    limit: usize,
}

impl InputTooLarge {
    /// The refusal of `what`, named at the start of a sentence, past `limit` bytes.
    pub fn new(what: &'static str, limit: usize) -> Self {
        Self { what, limit }
    }
}

impl fmt::Display for InputTooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} exceeds the {} safety limit.",
            self.what,
            limit_name(self.limit)
        )
    }
}

impl std::error::Error for InputTooLarge {}

impl Refusal for InputTooLarge {
    fn code(&self) -> &'static str {
        // TS 0.1.0's code, without a namespace (ADR 0004).
        "too-large"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_are_named_in_their_largest_whole_unit() {
        assert_eq!(limit_name(MEBIBYTE), "1 MiB");
        assert_eq!(limit_name(4 * KIBIBYTE), "4 KiB");
        assert_eq!(limit_name(64 * KIBIBYTE), "64 KiB");
        assert_eq!(limit_name(1500), "1500 bytes");
    }

    #[test]
    fn an_input_past_its_limit_names_it() {
        let refused = InputTooLarge::new("The file", MEBIBYTE);
        assert_eq!(
            refused.to_string(),
            "The file exceeds the 1 MiB safety limit."
        );
        assert_eq!(refused.code(), "too-large");
    }
}
