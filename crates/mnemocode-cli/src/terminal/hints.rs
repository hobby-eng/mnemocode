//! Hints below a word being typed (MnemoCode TS 0.1.0's `cli/typed-hints.ts`,
//! CAP-CLI-WORD-HINTS-TYPING): the library's hint for the word, drawn as at most three rows of
//! words and how many more there are, a grey count, or a yellow warning that no word begins so.

use mnemocode::forms::hints::{WordHint, WordHints};

use super::answer::Hints;
use super::{Channel, escape_hint, paint, style};

/// Existing input feedback followed by the same separate keyboard hint for every question.
pub(crate) struct InputHints<'a> {
    inner: Option<&'a dyn Hints>,
    secret: bool,
}

impl<'a> InputHints<'a> {
    pub(crate) const fn new(inner: Option<&'a dyn Hints>, secret: bool) -> Self {
        Self { inner, secret }
    }
}

impl Hints for InputHints<'_> {
    fn rows(&self, typed: &str, length: usize, columns: usize) -> Vec<String> {
        let mut rows = self
            .inner
            .filter(|hint| length > 0 || hint.shown_at_once())
            .map_or_else(Vec::new, |hint| hint.rows(typed, length, columns));
        let action = if self.secret { "cancel" } else { "go back" };
        // The keys stand apart, a blank row above them.
        let keys = if super::steps_back() || super::back_to_menu_question() {
            Some(super::STEP_KEYS)
        } else if super::for_menu() && self.secret {
            Some(super::MENU_KEY)
        } else {
            None
        };
        if let Some(keys) = keys {
            if columns > keys.len() {
                rows.push(String::new());
                rows.push(super::key_line(keys));
            }
        } else if columns > "Press Esc to ".len() + action.len() {
            rows.push(String::new());
            rows.push(escape_hint(action));
        }
        rows
    }

    fn completion(&self, typed: &str) -> Option<(String, bool)> {
        self.inner.and_then(|hint| hint.completion(typed))
    }

    fn shown_at_once(&self) -> bool {
        true
    }
}

/// Rows of words shown at most.
const HINT_ROWS: usize = 3;
/// Spaces between two words of a row.
const WORD_GAP: usize = 2;
/// A terminal narrower than this shows no hints.
const NARROWEST_FOR_HINTS: usize = 24;
/// What every hint row begins with.
const INDENT: &str = "  ";

impl<T: WordHints> Hints for T {
    fn rows(&self, typed: &str, _length: usize, columns: usize) -> Vec<String> {
        hint_rows(&self.hint(typed), columns)
    }

    fn completion(&self, typed: &str) -> Option<(String, bool)> {
        let completion = WordHints::completion(self, typed);
        Some((completion.letters, completion.word_ends))
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
