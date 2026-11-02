//! The words of running text that the library and every front end share (TS `src/core/prose.ts`,
//! `places.ts`): a list in words, places named as a message's subject, a small number as a word, a
//! clause made the start of a sentence or put after other words, and a message after its place.

use std::fmt::Display;

/// The small numbers as running text writes them; larger ones stay in digits.
const NUMBER_WORDS: [&str; 13] = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve",
];

/// Items in words, the last joined with `last`: "2", "1 and 2", "12, 15 or 18"; empty for none.
pub fn list_in_words<T: Display>(items: &[T], last: &str) -> String {
    match items {
        [] => String::new(),
        [only] => only.to_string(),
        [rest @ .., final_item] => {
            let rest: Vec<String> = rest.iter().map(ToString::to_string).collect();
            format!("{} {last} {final_item}", rest.join(", "))
        }
    }
}

/// Places in words: "2", "1 and 2", "1, 2 and 3"; empty for no place.
pub fn places_in_words(places: &[usize]) -> String {
    list_in_words(places, "and")
}

/// The places with what is at them, as the subject of a message: "Date 2", "Dates 1 and 2".
pub fn places_named(noun: &str, places: &[usize]) -> String {
    let plural = if places.len() == 1 { "" } else { "s" };
    format!("{noun}{plural} {}", places_in_words(places))
}

/// The place among those typed of the share counted `share` from 1, by `places`; the share's own
/// number where no place is given, so a share is named where it was typed.
pub fn place_of(places: Option<&[usize]>, share: usize) -> usize {
    places
        .and_then(|places| share.checked_sub(1).and_then(|index| places.get(index)))
        .copied()
        .unwrap_or(share)
}

/// `value` as a word where running text writes it so, "three"; otherwise its digits, "12".
pub fn number_word(value: u64) -> String {
    usize::try_from(value)
        .ok()
        .and_then(|index| NUMBER_WORDS.get(index))
        .map_or_else(|| value.to_string(), |word| (*word).to_owned())
}

/// `text` with its first character changed by `change`, as TS changes `text.charAt(0)`: a first
/// character outside the Basic Multilingual Plane is half a UTF-16 pair there, which no case
/// mapping changes, so it stays as it is.
fn first_changed<I: Iterator<Item = char>>(text: &str, change: impl FnOnce(char) -> I) -> String {
    let mut characters = text.chars();
    match characters.next() {
        Some(first) if first.len_utf16() == 1 => change(first).chain(characters).collect(),
        _ => text.to_owned(),
    }
}

/// `text` with its first letter in capitals, for a clause or label that starts a sentence.
pub fn capitalized(text: &str) -> String {
    first_changed(text, char::to_uppercase)
}

/// Whether the first word of `text` keeps its case: an abbreviation such as SSKR or PDF (two
/// capitals at the start), a name with a capital inside it, such as MnemoCode, or the name Unicode.
fn keeps_case(text: &str) -> bool {
    let bytes = text.as_bytes();
    let capital = |at: usize| bytes.get(at).is_some_and(u8::is_ascii_uppercase);
    if capital(0) && capital(1) {
        return true;
    }
    let small = bytes
        .iter()
        .skip(1)
        .take_while(|byte| byte.is_ascii_lowercase())
        .count();
    if capital(0) && small > 0 && capital(1 + small) {
        return true;
    }
    text.strip_prefix("Unicode").is_some_and(|rest| {
        !rest.starts_with(|next: char| next.is_ascii_alphanumeric() || next == '_')
    })
}

/// `text` with its first letter made small, to follow other words, unless its first word keeps its
/// case, an abbreviation such as SSKR or a name such as MnemoCode or Unicode.
pub fn lower_first(text: &str) -> String {
    if keeps_case(text) {
        return text.to_owned();
    }
    first_changed(text, char::to_lowercase)
}

/// `message` after the place it is about and `joint`: "Share 2: unknown …", "Date 1: the day …",
/// "Share 2 cannot be read: …". The message's first letter is made small ([`lower_first`]).
pub fn after_place(noun: &str, place: usize, message: &str, joint: &str) -> String {
    format!("{noun} {place}{joint}{}", lower_first(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_join_their_last_item_with_its_word() {
        assert_eq!(list_in_words::<u32>(&[], "and"), "");
        assert_eq!(list_in_words(&[2], "and"), "2");
        assert_eq!(list_in_words(&[1, 2], "and"), "1 and 2");
        assert_eq!(list_in_words(&[12, 15, 18], "or"), "12, 15 or 18");
        assert_eq!(places_named("Date", &[2]), "Date 2");
        assert_eq!(places_named("Date", &[1, 2]), "Dates 1 and 2");
    }

    #[test]
    fn a_share_is_named_where_it_was_typed() {
        assert_eq!(place_of(Some(&[3, 5]), 2), 5);
        assert_eq!(place_of(Some(&[3]), 2), 2);
        assert_eq!(place_of(None, 4), 4);
        assert_eq!(place_of(Some(&[3]), 0), 0);
    }

    #[test]
    fn small_numbers_are_words_and_large_ones_digits() {
        assert_eq!(number_word(0), "zero");
        assert_eq!(number_word(12), "twelve");
        assert_eq!(number_word(13), "13");
    }

    #[test]
    fn a_clause_keeps_the_case_of_abbreviations_and_names() {
        assert_eq!(capitalized("share 2"), "Share 2");
        assert_eq!(capitalized(""), "");
        assert_eq!(lower_first("Unknown word"), "unknown word");
        assert_eq!(lower_first("SSKR share"), "SSKR share");
        assert_eq!(lower_first("MnemoCode reads"), "MnemoCode reads");
        assert_eq!(lower_first("Mnemo"), "mnemo");
        assert_eq!(
            after_place("Share", 2, "Unknown word.", ": "),
            "Share 2: unknown word."
        );
    }

    #[test]
    fn the_name_unicode_keeps_its_capital_as_a_word_of_its_own() {
        for text in ["Unicode codes have four digits.", "Unicode", "Unicode-wide"] {
            assert_eq!(lower_first(text), text);
        }
        assert_eq!(lower_first("Unicodes"), "unicodes");
        assert_eq!(lower_first("Unicode_x"), "unicode_x");
        assert_eq!(lower_first("Unicode7"), "unicode7");
    }
}
