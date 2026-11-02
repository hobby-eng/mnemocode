//! The entries of the start menu as it shows them (MnemoCode TS 0.1.0's `cli/menu-entries.ts`),
//! each a digit and a label. The menu lists them, and the messages and the sheet for heirs that send
//! a person to an entry name it from here, so that every text names an entry as the menu shows it.

/// A task's explanation and the README section that describes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Guide {
    pub(crate) description: &'static str,
    pub(crate) anchor: &'static str,
}

impl Guide {
    const fn new(description: &'static str, anchor: &'static str) -> Self {
        Self {
            description,
            anchor,
        }
    }
}

pub(crate) const MENU_GUIDE: Guide = Guide::new(
    "Choose a backup, recovery or lookup task. Everything is processed on this computer.",
    "menu",
);
pub(crate) const WORD_GUIDE: Guide = Guide::new(
    "Find missing seed words and compare candidates with a known wallet reference.",
    "forgotten-word-recovery",
);
pub(crate) const CODE_GUIDE: Guide = Guide::new(
    "Repair unreadable backup codes, with dates and a wallet check where needed.",
    "codes-that-cannot-be-read",
);
pub(crate) const DATE_GUIDE: Guide = Guide::new(
    "Search missing date digits and check the recovered phrase against your wallet.",
    "date-recovery-helper",
);
pub(crate) const SHARE_GUIDE: Guide = Guide::new(
    "Repair unreadable share codes using the shares and any wallet reference you have.",
    "damaged-shares",
);

/// One entry of the start menu: the digit that chooses it, if any, and its label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MenuEntry {
    pub(crate) digit: Option<u8>,
    pub(crate) label: &'static str,
    pub(crate) guide: Guide,
}

const fn entry(
    digit: u8,
    label: &'static str,
    description: &'static str,
    anchor: &'static str,
) -> MenuEntry {
    MenuEntry {
        digit: Some(digit),
        label,
        guide: Guide::new(description, anchor),
    }
}

pub(crate) const ENCODE: MenuEntry = entry(
    1,
    "Encode a seed phrase as numbers, codes or colors",
    "Make a backup in another form, with optional date masking, shares or printable cards.",
    "1-encode",
);
pub(crate) const RE_ENCODE: MenuEntry = entry(
    2,
    "Re-encode a backup with other dates or in another form",
    "Restore an existing backup, confirm the original phrase and make its replacement.",
    "2-re-encode",
);
pub(crate) const DECODE: MenuEntry = entry(
    3,
    "Decode numbers, codes or colors back into a seed phrase",
    "Read a backup and undo date masking to recover the original words.",
    "3-decode",
);
pub(crate) const SPLIT: MenuEntry = entry(
    4,
    "Split a seed phrase into standard Shamir shares",
    "Make standard Shamir shares and choose how many are needed to restore the phrase.",
    "4-split-into-shares",
);
pub(crate) const RESTORE: MenuEntry = entry(
    5,
    "Restore a seed phrase from Shamir shares",
    "Combine enough shares and undo date masking if it was used.",
    "5-restore-from-shares",
);
pub(crate) const RECOVER: MenuEntry = entry(
    6,
    "Find a forgotten word, code, date digit or share code",
    "Choose which recovery material is missing; keep every part you can still read.",
    "6-recovery",
);
pub(crate) const PREVIEW: MenuEntry = entry(
    7,
    "Print sample cards with a random sample phrase",
    "Try card designs with sample data before making your own backup.",
    "7-preview-cards",
);
pub(crate) const TABLE: MenuEntry = entry(
    8,
    "Look up a seed word, its number or its Unicode code",
    "Look up a word or export dictionaries and a guide for recovery without MnemoCode.",
    "8-word-lookup",
);
pub(crate) const SELF_TEST: MenuEntry = entry(
    9,
    "Run the self-test",
    "Check this installation, including transformations, recovery, shares and drawing.",
    "9-self-test",
);
pub(crate) const HELP: MenuEntry = entry(
    0,
    "Show every command and option",
    "Read the available commands and their options.",
    "0-help",
);
/// The last entry, without a digit; Escape quits as well.
pub(crate) const QUIT: MenuEntry = MenuEntry {
    digit: None,
    label: "Quit",
    guide: Guide::new("Leave MnemoCode.", "quit"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_menu_and_recovery_guide_has_a_readme_destination() {
        let readme = include_str!("../../../../README.md");
        let guides = [
            MENU_GUIDE,
            ENCODE.guide,
            RE_ENCODE.guide,
            DECODE.guide,
            SPLIT.guide,
            RESTORE.guide,
            RECOVER.guide,
            PREVIEW.guide,
            TABLE.guide,
            SELF_TEST.guide,
            HELP.guide,
            QUIT.guide,
            WORD_GUIDE,
            CODE_GUIDE,
            DATE_GUIDE,
            SHARE_GUIDE,
        ];
        for guide in guides {
            let heading = readme
                .lines()
                .filter_map(|line| line.strip_prefix('#'))
                .map(|line| {
                    line.trim_start_matches('#')
                        .trim()
                        .to_ascii_lowercase()
                        .chars()
                        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == ' ' || *ch == '-')
                        .collect::<String>()
                        .replace(' ', "-")
                })
                .any(|anchor| anchor == guide.anchor);
            assert!(
                heading || readme.contains(&format!("id=\"{}\"", guide.anchor)),
                "{}",
                guide.anchor
            );
            assert!(!guide.description.is_empty());
        }
    }
}
