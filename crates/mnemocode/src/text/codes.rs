//! How codes are written as text (TS `src/core/code-text.ts`): what separates the elements of one
//! backup or one share, and how hexadecimal codes of one width are read, written apart or run
//! together, with ? for what cannot be read. Every reader of codes and shares, and every guess of a
//! text's form, reads its text through these, so they all take the same separators.

use super::space::is_ecmascript_space;

/// The hexadecimal digits of the Unicode code of a word.
pub const UNICODE_CODE_DIGITS: usize = 4;

/// What a ? means in codes run together, which the refusal of such codes adds: a whole code.
pub const JOINED_MARKS_HINT: &str = "In codes run together, a ? stands for a whole code; to mark one digit, write the codes apart, as the screen shows them.";

/// The spacing between elements: white space, commas and semicolons.
fn is_spacing(character: char) -> bool {
    is_ecmascript_space(character) || character == ',' || character == ';'
}

/// What separates the elements of one backup or share: the spacing, and the # before a color.
fn is_separator(character: char) -> bool {
    is_spacing(character) || character == '#'
}

/// A Unicode code point of the Basic Multilingual Plane as its four hexadecimal digits: "7684".
pub fn hex_code_point(point: u32) -> String {
    format!("{point:0width$X}", width = UNICODE_CODE_DIGITS)
}

/// `text` without its separators, in its own case: the Private Use symbols of Color Unicode, which
/// take the same separators as codes written in digits.
pub fn without_separators(text: &str) -> String {
    text.chars()
        .filter(|character| !is_separator(*character))
        .collect()
}

/// The elements of `text`, in capitals.
pub fn code_tokens(text: &str) -> Vec<String> {
    text.to_uppercase()
        .split(is_separator)
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The elements of `text` run together, in capitals: the text of codes written without spaces.
pub fn compact_code(text: &str) -> String {
    code_tokens(text).concat()
}

/// `text` in capitals without its spacing, the # before a color kept: for a reader that asks where
/// the # stand, as the colors of a seed phrase do.
pub fn unspaced_code(text: &str) -> String {
    text.to_uppercase()
        .chars()
        .filter(|character| !is_spacing(*character))
        .collect()
}

/// Whether `text` is elements that each fit `element`: at least one, and nothing but the
/// separators between them; how a text looks to a guess of its form.
pub fn elements_fit(text: &str, element: impl Fn(&str) -> bool) -> bool {
    let tokens = code_tokens(text);
    !tokens.is_empty() && tokens.iter().all(|token| element(token))
}

/// Whether `token` is only marks: a code of which nothing can be read.
pub fn whole_mark(token: &str) -> bool {
    !token.is_empty() && token.chars().all(|character| character == '?')
}

/// Whether `character` is an upper-case hexadecimal digit.
fn is_hex_digit(character: char) -> bool {
    matches!(character, '0'..='9' | 'A'..='F')
}

/// Whether `text` is hexadecimal codes run together with a ? among them.
fn joined_with_marks(text: &str) -> bool {
    match code_tokens(text).as_slice() {
        [token] => {
            token
                .chars()
                .all(|character| is_hex_digit(character) || character == '?')
                && token.contains('?')
                && !whole_mark(token)
        }
        _ => false,
    }
}

/// `message`, with [`JOINED_MARKS_HINT`] after it where `text` is codes run together with marks.
pub fn with_joined_marks_hint(message: &str, text: &str) -> String {
    if joined_with_marks(text) {
        format!("{message} {JOINED_MARKS_HINT}")
    } else {
        message.to_owned()
    }
}

/// Whether `written` fits `pattern`, of the same length, a ? in the pattern fitting any symbol;
/// counted in UTF-16 code units, as TS compares them.
pub fn fits_pattern(pattern: &str, written: &str) -> bool {
    pattern.encode_utf16().count() == written.encode_utf16().count()
        && pattern
            .encode_utf16()
            .zip(written.encode_utf16())
            .all(|(wanted, symbol)| wanted == u16::from(b'?') || wanted == symbol)
}

/// Whether `token` is a code of `width` hexadecimal digits written apart: a lone ?, or `width`
/// symbols each a digit or ?.
fn apart_unit(token: &str, width: usize) -> bool {
    token == "?"
        || (token.chars().count() == width
            && token
                .chars()
                .all(|character| is_hex_digit(character) || character == '?'))
}

/// Codes of `width` hexadecimal digits written apart, more than one, each a lone ? or `width`
/// symbols where each ? is one digit; none when the text is not written so.
pub fn apart_hex_units(text: &str, width: usize) -> Option<Vec<String>> {
    let tokens = code_tokens(text);
    (tokens.len() > 1 && tokens.iter().all(|token| apart_unit(token, width))).then_some(tokens)
}

/// Codes of `width` hexadecimal digits run together, the separators left out, where each ? stands
/// for a whole code; none when the text is not written so.
pub fn joined_hex_units(text: &str, width: usize) -> Option<Vec<String>> {
    let compact: Vec<char> = compact_code(text).chars().collect();
    if compact.is_empty() || width == 0 {
        return None;
    }
    let mut units = Vec::new();
    let mut at = 0;
    while at < compact.len() {
        if compact[at] == '?' {
            units.push("?".to_owned());
            at += 1;
            continue;
        }
        let unit = compact.get(at..at + width)?;
        if !unit.iter().all(|character| is_hex_digit(*character)) {
            return None;
        }
        units.push(unit.iter().collect());
        at += width;
    }
    Some(units)
}

/// Codes of `width` hexadecimal digits written apart ([`apart_hex_units`]), where each ? is one
/// digit, or run together ([`joined_hex_units`]), where each ? stands for a whole code. With
/// `fold_whole_marks`, a code written apart all of whose digits are ? is given as a lone ?, the same
/// mark of the whole code, as a share repair reads it.
pub fn hex_units(text: &str, width: usize, fold_whole_marks: bool) -> Option<Vec<String>> {
    let Some(apart) = apart_hex_units(text, width) else {
        return joined_hex_units(text, width);
    };
    if !fold_whole_marks {
        return Some(apart);
    }
    Some(
        apart
            .into_iter()
            .map(|token| {
                if whole_mark(&token) {
                    "?".to_owned()
                } else {
                    token
                }
            })
            .collect(),
    )
}

/// Complete codes of `width` hexadecimal digits, apart or run together; none otherwise.
pub fn complete_hex_units(text: &str, width: usize) -> Option<Vec<String>> {
    hex_units(text, width, false).filter(|units| units.iter().all(|unit| !unit.contains('?')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elements_split_at_spacing_and_the_color_mark() {
        assert_eq!(
            code_tokens("ab,cd; #ef\u{3000}12"),
            ["AB", "CD", "EF", "12"]
        );
        assert_eq!(compact_code(" 07 a4 "), "07A4");
        assert_eq!(unspaced_code("#ab, #cd"), "#AB#CD");
        assert!(elements_fit("1 2 3", |token| token
            .bytes()
            .all(|b| b.is_ascii_digit())));
        assert!(!elements_fit(" , ", |_| true));
        assert_eq!(hex_code_point(0x7684), "7684");
        assert_eq!(hex_code_point(0x41), "0041");
    }

    #[test]
    fn codes_are_read_apart_or_run_together() {
        assert_eq!(
            apart_hex_units("7684 ?6?4 ?", 4).unwrap(),
            ["7684", "?6?4", "?"]
        );
        assert_eq!(apart_hex_units("7684", 4), None);
        assert_eq!(joined_hex_units("76845728", 4).unwrap(), ["7684", "5728"]);
        assert_eq!(
            joined_hex_units("7684?5728", 4).unwrap(),
            ["7684", "?", "5728"]
        );
        assert_eq!(joined_hex_units("768?", 4), None);
        assert_eq!(joined_hex_units("", 4), None);
        assert_eq!(hex_units("7684 ????", 4, true).unwrap(), ["7684", "?"]);
        assert_eq!(hex_units("7684 ????", 4, false).unwrap(), ["7684", "????"]);
        assert_eq!(
            complete_hex_units("7684 5728", 4).unwrap(),
            ["7684", "5728"]
        );
        assert_eq!(complete_hex_units("7684 ?728", 4), None);
    }

    #[test]
    fn the_hint_follows_codes_run_together_with_marks() {
        assert_eq!(
            with_joined_marks_hint("Refused.", "7684?728"),
            format!("Refused. {JOINED_MARKS_HINT}")
        );
        assert_eq!(with_joined_marks_hint("Refused.", "7684 ?728"), "Refused.");
        assert_eq!(with_joined_marks_hint("Refused.", "????"), "Refused.");
        assert!(fits_pattern("7?84", "7684"));
        assert!(!fits_pattern("7?84", "76840"));
        assert!(whole_mark("??"));
        assert!(!whole_mark(""));
    }
}
