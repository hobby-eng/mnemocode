//! Hints below a word being typed (MnemoCode TS 0.1.0's `cli/typed-hints.ts`,
//! CAP-CLI-WORD-HINTS-TYPING): the library's hint for the word, drawn as at most three rows of
//! words and how many more there are, a grey count, or a yellow warning that no word begins so.

use mnemocode::forms::hints::{WordHint, WordHints};

use super::answer::Hints;
use super::{Channel, paint, style};

/// Rows of words shown at most.
const HINT_ROWS: usize = 3;
/// Spaces between two words of a row.
const WORD_GAP: usize = 2;
/// A terminal narrower than this shows no hints.
const NARROWEST_FOR_HINTS: usize = 24;
/// What every hint row begins with.
const INDENT: &str = "  ";

impl<T: WordHints> Hints for T {
    fn rows(&self, typed: &str, columns: usize) -> Vec<String> {
        hint_rows(&self.hint(typed), columns)
    }

    fn completion(&self, typed: &str) -> (String, bool) {
        let completion = WordHints::completion(self, typed);
        (completion.letters, completion.word_ends)
    }
}

/// The rows of `hint` on a terminal `columns` wide; none on a narrow one.
fn hint_rows(hint: &WordHint, columns: usize) -> Vec<String> {
    if columns < NARROWEST_FOR_HINTS {
        return Vec::new();
    }
    let room = columns - 1 - INDENT.len();
    let row = |code: &str, text: &str| {
        let fitted: String = text.chars().take(room).collect();
        format!("{INDENT}{}", paint(Channel::Error, code, &fitted))
    };
    match hint {
        WordHint::Nothing => Vec::new(),
        WordHint::Count(_, text) => vec![row(style::MUTED, text)],
        WordHint::NoWord(text) => vec![row(style::WARNING, &format!("! {text}"))],
        WordHint::Words(words) => word_rows(words, room)
            .iter()
            .map(|text| row(style::MUTED, text))
            .collect(),
    }
}

/// `words` in columns of the longest word's width, at most [`HINT_ROWS`] rows of them, and how
/// many more there are.
fn word_rows(words: &[&str], room: usize) -> Vec<String> {
    let cell = words.iter().map(|word| word.len()).max().unwrap_or(0) + WORD_GAP;
    let per_row = (room / cell).max(1);
    let shown = words.len().min(per_row * HINT_ROWS);
    let mut rows: Vec<String> = words[..shown]
        .chunks(per_row)
        .map(|chunk| {
            let cells: String = chunk.iter().map(|word| format!("{word:<cell$}")).collect();
            cells.trim_end().to_owned()
        })
        .collect();
    if shown < words.len() {
        rows.push(format!("and {} more", words.len() - shown));
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_fill_three_rows_and_count_the_rest() {
        let words = [
            "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse",
        ];
        assert_eq!(
            word_rows(&words, 30),
            [
                "able      about     above",
                "absent    absorb    abstract",
                "absurd    abuse"
            ]
        );
        assert_eq!(
            word_rows(&words, 20),
            [
                "able      about",
                "above     absent",
                "absorb    abstract",
                "and 2 more"
            ]
        );
        assert!(hint_rows(&WordHint::Words(words.to_vec()), 23).is_empty());
    }
}
