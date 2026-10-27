//! Hints for a word being typed (MnemoCode TS 0.1.0's `core/word-hints.ts`,
//! CAP-PHRASE-FORMATS-WORD-HINTS), by the rule of mhfe: from [`LIST_FROM_LETTERS`] letters on, the
//! words of the list that begin with them; after one letter, how many words do; a warning when none
//! does. Tab completes a word as far as the words that begin with it agree.
//!
//! The lists are public and static, so a hint tells nothing that a person who sees the screen could
//! not look up; a front end shows one only where the typed text itself is shown.

use std::sync::LazyLock;

use super::Form;
use crate::bip39::table::english;
use crate::text::space::is_ecmascript_space;

/// Letters typed before the words that begin with them are listed; fewer give how many there are.
pub const LIST_FROM_LETTERS: usize = 2;

/// What a front end shows below a word being typed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WordHint {
    /// Nothing: no word is being typed, or the list has it whole and no longer word begins with it.
    Nothing,
    /// Fewer letters typed than [`LIST_FROM_LETTERS`]: how many words begin with them, and that
    /// count as shown, such as "12 BIP39 words begin with this letter".
    Count(usize, String),
    /// The words of the list that begin with the letters typed, in list order.
    Words(Vec<&'static str>),
    /// That no word of the list begins with what is typed, as shown.
    NoWord(String),
}

/// What Tab adds to the word being typed: the letters every word that begins with the typed ones
/// has next, and whether one word is left, so that the word ends and a space follows.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WordCompletion {
    /// The letters added; empty when the words differ.
    pub letters: String,
    /// Whether one word is left.
    pub word_ends: bool,
}

/// Where the words of a typed line are hinted from; `line` is the text before the cursor, and the
/// hint and the completion are about its last word.
pub trait WordHints {
    /// The hint for the last word of `line`.
    fn hint(&self, line: &str) -> WordHint;
    /// What Tab adds to the last word of `line`.
    fn completion(&self, line: &str) -> WordCompletion;
}

/// The English BIP39 list, built once.
pub static BIP39: LazyLock<WordList> = LazyLock::new(WordList::bip39);

/// The list below codes being typed in any form: the English words where the line so far most
/// likely is English words ([`Form::likely`]), none in another form.
pub fn codes_list(line: &str) -> Option<&'static WordList> {
    (Form::likely(line) == Form::English).then(|| &*BIP39)
}

/// A sorted static word list that typed words are hinted from.
#[derive(Debug)]
pub struct WordList {
    one: &'static str,
    many: &'static str,
    words: &'static [&'static str],
    longest: usize,
    separator: fn(char) -> bool,
    run_together: Option<usize>,
}

impl WordList {
    /// The list `words`, sorted, of lower-case letters and hyphens, named `one` and `many`; words
    /// stand apart where `separator` is true, and, with `run_together`, a longer run of letters is
    /// words of that length, as Bytewords.
    pub fn new(
        (one, many): (&'static str, &'static str),
        words: &'static [&'static str],
        separator: fn(char) -> bool,
        run_together: Option<usize>,
    ) -> Self {
        let longest = words.iter().map(|word| word.len()).max().unwrap_or(0);
        Self {
            one,
            many,
            words,
            longest,
            separator,
            run_together,
        }
    }

    /// The English BIP39 list: seed phrases and encoded seed phrases in English words, apart at
    /// white space.
    pub fn bip39() -> Self {
        Self::new(
            ("BIP39 word", "BIP39 words"),
            english(),
            is_ecmascript_space,
            None,
        )
    }

    /// The last word of `line` in lower case: after its last separator, letters and hyphens only;
    /// none where no word is being typed. A word longer than the longest of the list is "", which
    /// begins none (AUD-015-UI004 of mhfe), unless words are run together: then the last of them,
    /// whole or begun.
    fn last_word(&self, line: &str) -> Option<String> {
        let word = line.rsplit(self.separator).next().unwrap_or_default();
        if word.is_empty()
            || !word
                .bytes()
                .all(|byte| byte.is_ascii_alphabetic() || byte == b'-')
        {
            return None;
        }
        if word.len() <= self.longest {
            return Some(word.to_ascii_lowercase());
        }
        let Some(width) = self.run_together else {
            return Some(String::new());
        };
        let begun = match word.len() % width {
            0 => width,
            begun => begun,
        };
        Some(word[word.len() - begun..].to_ascii_lowercase())
    }

    /// The words that begin with `letters`, in list order.
    fn starting_with(&self, letters: &str) -> &'static [&'static str] {
        let start = self.words.partition_point(|word| *word < letters);
        let count = self.words[start..]
            .iter()
            .take_while(|word| word.starts_with(letters))
            .count();
        &self.words[start..start + count]
    }
}

impl WordHints for WordList {
    fn hint(&self, line: &str) -> WordHint {
        let Some(typed) = self.last_word(line) else {
            return WordHint::Nothing;
        };
        let matches = if typed.is_empty() {
            &[][..]
        } else {
            self.starting_with(&typed)
        };
        match matches {
            [] => WordHint::NoWord(format!("No {} begins like this.", self.one)),
            [only] if *only == typed => WordHint::Nothing,
            _ if typed.len() < LIST_FROM_LETTERS => {
                let count = matches.len();
                let begins = if count == 1 {
                    format!("{} begins", self.one)
                } else {
                    format!("{} begin", self.many)
                };
                WordHint::Count(count, format!("{count} {begins} with this letter"))
            }
            _ => WordHint::Words(matches.to_vec()),
        }
    }

    fn completion(&self, line: &str) -> WordCompletion {
        let Some(typed) = self.last_word(line).filter(|typed| !typed.is_empty()) else {
            return WordCompletion::default();
        };
        let matches = self.starting_with(&typed);
        let (Some(first), Some(last)) = (matches.first(), matches.last()) else {
            return WordCompletion::default();
        };
        // The list is sorted, so the first and the last word share what all of them share.
        let shared = typed.len()
            + first
                .bytes()
                .zip(last.bytes())
                .skip(typed.len())
                .take_while(|(a, b)| a == b)
                .count();
        WordCompletion {
            letters: first[typed.len()..shared].to_owned(),
            word_ends: matches.len() == 1,
        }
    }
}

/// The hints of a line that may be written in more than one form, such as the codes of an encoded
/// seed phrase or shares: those of the list that `list_of` finds for the part being typed, which
/// `part_of` takes of the line, and none where that part is written in a form without words.
pub struct LineWordHints<L, P> {
    list_of: L,
    part_of: P,
}

impl<L, P> LineWordHints<L, P>
where
    L: Fn(&str) -> Option<&'static WordList>,
    P: Fn(&str) -> &str,
{
    /// The hints of `list_of` over the part `part_of` takes.
    pub const fn new(list_of: L, part_of: P) -> Self {
        Self { list_of, part_of }
    }
}

impl<L, P> WordHints for LineWordHints<L, P>
where
    L: Fn(&str) -> Option<&'static WordList>,
    P: Fn(&str) -> &str,
{
    fn hint(&self, line: &str) -> WordHint {
        let part = (self.part_of)(line);
        (self.list_of)(part).map_or(WordHint::Nothing, |list| list.hint(part))
    }

    fn completion(&self, line: &str) -> WordCompletion {
        let part = (self.part_of)(line);
        (self.list_of)(part).map_or_else(WordCompletion::default, |list| list.completion(part))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_follow_the_letters_typed() {
        let list = WordList::bip39();
        assert_eq!(list.hint(""), WordHint::Nothing);
        assert_eq!(list.hint("abandon "), WordHint::Nothing);
        assert_eq!(list.hint("abandon"), WordHint::Nothing);
        assert_eq!(
            list.hint("z"),
            WordHint::Count(4, "4 BIP39 words begin with this letter".to_owned())
        );
        assert_eq!(
            list.hint("zoo ab"),
            WordHint::Words(vec![
                "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
                "absurd", "abuse"
            ])
        );
        assert_eq!(
            list.hint("xy"),
            WordHint::NoWord("No BIP39 word begins like this.".to_owned())
        );
        assert_eq!(
            list.hint("abandonabandon"),
            WordHint::NoWord("No BIP39 word begins like this.".to_owned())
        );
        assert_eq!(list.hint("ab?"), WordHint::Nothing);
    }

    #[test]
    fn tab_completes_as_far_as_the_words_agree() {
        let list = WordList::bip39();
        assert_eq!(
            list.completion("abs"),
            WordCompletion {
                letters: String::new(),
                word_ends: false
            }
        );
        assert_eq!(
            list.completion("abst"),
            WordCompletion {
                letters: "ract".to_owned(),
                word_ends: true
            }
        );
        assert_eq!(
            list.completion("zo"),
            WordCompletion {
                letters: String::new(),
                word_ends: false
            }
        );
        assert_eq!(
            list.completion("Wor"),
            WordCompletion {
                letters: String::new(),
                word_ends: false
            }
        );
        assert_eq!(list.completion("xy"), WordCompletion::default());
    }

    #[test]
    fn words_run_together_hint_the_last_one() {
        static WORDS: [&str; 3] = ["able", "acid", "also"];
        let list = WordList::new(
            ("Byteword", "Bytewords"),
            &WORDS,
            is_ecmascript_space,
            Some(4),
        );
        assert_eq!(list.hint("ableac"), WordHint::Words(vec!["acid"]));
        assert_eq!(list.hint("ableacid"), WordHint::Nothing);
    }
}
