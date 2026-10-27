//! White space as typed text needs it. Two rules, each where TS has it: ECMAScript's white space
//! (`/\s/u`: WhiteSpace and LineTerminator), which splits words, dates and codes into tokens as TS
//! splits them; and Unicode's White_Space (`str::trim`, TS `trimWhiteSpace`), the one trim of every
//! value a person typed or pasted (owner, 2026-10-27). They differ in two characters: U+FEFF is
//! ECMAScript white space only, U+0085 is White_Space only.

/// U+FEFF, which an editor may put at the start of a text file.
pub const BYTE_ORDER_MARK: char = '\u{feff}';

/// Whether `character` is ECMAScript white space or a line terminator (ECMA-262 WhiteSpace and
/// LineTerminator, `/\s/u`): the 25 characters that split typed words, dates and codes in TS.
pub fn is_ecmascript_space(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// The tokens of `text` split at ECMAScript white space, empty ones left out, as TS's
/// `text.split(/\s+/u).filter(Boolean)` gives them; each borrows `text`.
pub fn tokens(text: &str) -> impl Iterator<Item = &str> {
    text.split(is_ecmascript_space)
        .filter(|token| !token.is_empty())
}

/// `text` without Unicode White_Space at its ends, as people paste and type it: TS's
/// `trimWhiteSpace`, the one trim of every value a wallet check or reader takes (owner,
/// 2026-10-27). A byte order mark is no white space and stays.
pub fn trim(text: &str) -> &str {
    text.trim()
}

/// The text of a file without the byte order mark that an editor may have put at its start.
pub fn without_byte_order_mark(text: &str) -> &str {
    text.strip_prefix(BYTE_ORDER_MARK).unwrap_or(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ECMAScript white space of Node.js 26 (`/^\s$/u` over every scalar value).
    const NODE_SEPARATORS: [u32; 25] = [
        9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
        8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279,
    ];

    #[test]
    fn every_scalar_value_is_white_space_exactly_as_node_says() {
        for point in 0..=u32::from(char::MAX) {
            let Some(character) = char::from_u32(point) else {
                continue;
            };
            assert_eq!(
                is_ecmascript_space(character),
                NODE_SEPARATORS.contains(&point),
                "U+{point:04X}"
            );
        }
    }

    #[test]
    fn tokens_split_at_any_run_of_white_space() {
        assert_eq!(
            tokens("\u{feff} abandon\u{3000}\u{3000}about\n").collect::<Vec<_>>(),
            ["abandon", "about"]
        );
        assert_eq!(tokens(" \t\r\n").count(), 0);
        assert_eq!(tokens("a\u{85}b").collect::<Vec<_>>(), ["a\u{85}b"]);
    }

    #[test]
    fn the_one_trim_takes_white_space_not_a_byte_order_mark() {
        assert_eq!(trim("\u{85} key \u{85}"), "key");
        assert_eq!(trim("\u{feff}key"), "\u{feff}key");
    }

    #[test]
    fn only_a_leading_byte_order_mark_is_removed() {
        assert_eq!(
            without_byte_order_mark("\u{feff}text\u{feff}"),
            "text\u{feff}"
        );
        assert_eq!(without_byte_order_mark("text"), "text");
    }
}
