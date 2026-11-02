//! The entries of the start menu as it shows them (MnemoCode TS 0.1.0's `cli/menu-entries.ts`),
//! each a digit and a label. The menu lists them, and the messages and the sheet for heirs that send
//! a person to an entry name it from here, so that every text names an entry as the menu shows it.

/// One entry of the start menu: the digit that chooses it, if any, and its label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MenuEntry {
    pub(crate) digit: Option<u8>,
    pub(crate) label: &'static str,
}

const fn entry(digit: u8, label: &'static str) -> MenuEntry {
    MenuEntry {
        digit: Some(digit),
        label,
    }
}

pub(crate) const ENCODE: MenuEntry = entry(1, "Encode a seed phrase as numbers, codes or colors");
pub(crate) const RE_ENCODE: MenuEntry =
    entry(2, "Re-encode a backup with other dates or in another form");
pub(crate) const DECODE: MenuEntry =
    entry(3, "Decode numbers, codes or colors back into a seed phrase");
pub(crate) const SPLIT: MenuEntry = entry(4, "Split a seed phrase into standard Shamir shares");
pub(crate) const RESTORE: MenuEntry = entry(5, "Restore a seed phrase from Shamir shares");
pub(crate) const RECOVER: MenuEntry =
    entry(6, "Find a forgotten word, code, date digit or share code");
pub(crate) const PREVIEW: MenuEntry = entry(7, "Print sample cards with a random sample phrase");
pub(crate) const TABLE: MenuEntry = entry(8, "Look up a seed word, its number or its Unicode code");
pub(crate) const SELF_TEST: MenuEntry = entry(9, "Run the self-test");
pub(crate) const HELP: MenuEntry = entry(0, "Show every command and option");
/// The last entry, without a digit; Escape quits as well.
pub(crate) const QUIT: MenuEntry = MenuEntry {
    digit: None,
    label: "Quit",
};

/// The answer of the menu that types an encoded seed phrase in, which the sheet for heirs names.
pub(crate) const TYPED_SOURCE: &str = "Type or paste it";
/// The question of how many words the typed codes stand for.
pub(crate) const PHRASE_WORDS_QUESTION: &str = "How many words does the seed phrase have?";

/// The answer of that question for `words` words.
pub(crate) fn phrase_words_answer(words: usize) -> String {
    format!("{words} words")
}

/// An entry as the menu shows it, its digit before its label: "3 Decode numbers, …".
pub(crate) fn shown_entry(entry: MenuEntry) -> String {
    match entry.digit {
        Some(digit) => format!("{digit} {}", entry.label),
        None => entry.label.to_owned(),
    }
}
