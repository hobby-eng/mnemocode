//! Text from outside shown safely (CAP-CLI-SAFE-DISPLAY-TEXT): a path, a file system's error or a
//! name the program did not write is shown with every control character that could move the
//! cursor, start an escape sequence or reorder the line replaced by U+FFFD, while the data itself
//! stays as it is. The rule is the library's, so the command line needs no Unicode crate.

/// What a character that may not be shown is replaced with.
pub const REPLACEMENT: char = '\u{fffd}';

/// Whether `character` may not be shown as it is: C0 controls, DEL, C1 controls, the line and
/// paragraph separators, and every Bidi_Control character (TS
/// `/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/u`).
pub fn is_unsafe(character: char) -> bool {
    matches!(
        character,
        '\u{0000}'..='\u{001f}'
            | '\u{007f}'..='\u{009f}'
            | '\u{2028}'
            | '\u{2029}'
            // Bidi_Control (PropList.txt): ALM, LRM and RLM, the embeddings, overrides and isolates.
            | '\u{061c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
    )
}

/// Whether `text` holds any character that [`is_unsafe`] replaces.
pub fn holds_unsafe(text: &str) -> bool {
    text.chars().any(is_unsafe)
}

/// `text` as it may be shown: every character [`is_unsafe`] names replaced by U+FFFD.
pub fn safe_display(text: &str) -> String {
    text.chars()
        .map(|character| {
            if is_unsafe(character) {
                REPLACEMENT
            } else {
                character
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controls_and_reordering_characters_are_replaced() {
        assert_eq!(
            safe_display("a\u{1b}[31mb\u{202e}c\u{85}d\u{2029}"),
            "a\u{fffd}[31mb\u{fffd}c\u{fffd}d\u{fffd}"
        );
        assert!(holds_unsafe("x\u{200f}"));
        assert!(!holds_unsafe("caf\u{e9} \u{7684}"));
    }

    #[test]
    fn ordinary_text_is_shown_as_it_is() {
        let text = "/home/\u{4e2d}\u{6587}/backup (1).txt";
        assert_eq!(safe_display(text), text);
    }
}
