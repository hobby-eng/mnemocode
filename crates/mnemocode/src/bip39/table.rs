//! The word table (MnemoCode TS 0.1.0's `core/word-table.ts`, CAP-PHRASE-FORMATS-WORD-TABLE-LOOKUP,
//! -NUMBERED-DICTIONARIES): each word number, from 1 through 2,048, with its English word and the
//! Unicode code of its Traditional Chinese word, over the bip39 crate's lists; a row looked up by
//! a typed word, number or code; and the numbered dictionaries as text, to read and print.

use std::fmt;

use bip39::Language;

use super::sizes::{DICTIONARY_SIZE, WORD_NUMBER_RANGE};
use crate::refusal::Refusal;
use crate::text::numbers::whole_number_of;
use crate::text::space::trim;

/// How a Unicode code of the table is written, for hints.
pub const UNICODE_CODE_HINT: &str = "four hexadecimal digits, such as 5BF6";

/// What a lookup starts from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lookup {
    /// An English word.
    Word,
    /// A word number.
    Index,
    /// A Unicode code.
    Unicode,
}

/// The numbered dictionaries; Chinese is the Traditional Chinese BIP39 list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// The English words.
    English,
    /// The Traditional Chinese words.
    Chinese,
    /// The Unicode codes, with their Chinese words.
    Unicode,
    /// The English words, the Unicode codes and the Chinese words.
    Mapping,
}

impl Format {
    /// Every format, in TS's order.
    pub const ALL: [Self; 4] = [Self::English, Self::Chinese, Self::Unicode, Self::Mapping];

    /// Its name, as `--table-format` takes it.
    pub const fn name(self) -> &'static str {
        match self {
            Self::English => "english",
            Self::Chinese => "chinese",
            Self::Unicode => "unicode",
            Self::Mapping => "mapping",
        }
    }

    /// The format named `name`; refused otherwise.
    pub fn named(name: &str) -> Result<Self, TableError> {
        Self::ALL
            .into_iter()
            .find(|format| format.name() == name)
            .ok_or(TableError::Format)
    }

    fn columns(self) -> &'static [Column] {
        match self {
            Self::English => &[Column::Index, Column::English],
            Self::Chinese => &[Column::Index, Column::Chinese],
            Self::Unicode => &[Column::Index, Column::UnicodeHex, Column::Chinese],
            Self::Mapping => &[
                Column::Index,
                Column::English,
                Column::UnicodeHex,
                Column::Chinese,
            ],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Column {
    Index,
    English,
    Chinese,
    UnicodeHex,
}

impl Column {
    const fn name(self) -> &'static str {
        match self {
            Self::Index => "index",
            Self::English => "english",
            Self::Chinese => "chinese",
            Self::UnicodeHex => "unicode_hex",
        }
    }
}

/// One row of the table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    /// The word number, from 1.
    pub index: usize,
    /// The English word.
    pub english: &'static str,
    /// The Traditional Chinese word.
    pub chinese: &'static str,
    /// Its Unicode code: four or more upper-case hexadecimal digits.
    pub unicode_hex: String,
}

impl Row {
    fn cell(&self, column: Column) -> String {
        match column {
            Column::Index => self.index.to_string(),
            Column::English => self.english.to_owned(),
            Column::Chinese => self.chinese.to_owned(),
            Column::UnicodeHex => self.unicode_hex.clone(),
        }
    }
}

/// The refusals of the table, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TableError {
    /// A word number outside 1 through 2,048.
    Index,
    /// Text that fits no row, with the lookup's refusal.
    Row(Lookup),
    /// A format that is none.
    Format,
}

impl fmt::Display for TableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Index => write!(
                f,
                "A wordlist index must be from {}.",
                WORD_NUMBER_RANGE.through()
            ),
            Self::Row(Lookup::Word) => f.write_str("That word is not in the English BIP39 list."),
            Self::Row(Lookup::Index) => write!(
                f,
                "A word number is a whole number from {}.",
                WORD_NUMBER_RANGE.through()
            ),
            Self::Row(Lookup::Unicode) => {
                write!(f, "No BIP39 word has that code; type {UNICODE_CODE_HINT}.")
            }
            Self::Format => {
                f.write_str("Word list format must be english, chinese, unicode or mapping.")
            }
        }
    }
}

impl std::error::Error for TableError {}

impl Refusal for TableError {
    fn code(&self) -> &'static str {
        match self {
            Self::Index => "core.words.wordlist-index-from",
            Self::Row(_) => "core.words.word-table-row-refused",
            Self::Format => "core.words.word-table-format",
        }
    }
}

/// The English list.
pub fn english() -> &'static [&'static str; DICTIONARY_SIZE] {
    Language::English.word_list()
}

/// The Traditional Chinese list.
pub fn chinese() -> &'static [&'static str; DICTIONARY_SIZE] {
    Language::TraditionalChinese.word_list()
}

/// The Unicode code of a character: four or more upper-case hexadecimal digits.
pub fn hex_code_point(character: char) -> String {
    format!("{:04X}", u32::from(character))
}

/// The Unicode code of the word at `index`, from 0.
pub fn unicode_code(index: usize) -> String {
    chinese()
        .get(index)
        .and_then(|word| word.chars().next())
        .map(hex_code_point)
        .unwrap_or_default()
}

/// The index, from 0, of an exact upper-case Unicode code; none for any other.
pub fn index_of_unicode(code: &str) -> Option<usize> {
    let mut characters = code.chars();
    let point = u32::from_str_radix(code, 16).ok()?;
    let character = char::from_u32(point)?;
    if code.len() < 4
        || characters.any(|c| c.is_ascii_lowercase())
        || hex_code_point(character) != code
    {
        return None;
    }
    chinese()
        .iter()
        .position(|word| word.starts_with(character) && word.chars().count() == 1)
}

/// The index, from 0, of the English word `word`, as the list writes it.
pub fn index_of_english(word: &str) -> Option<usize> {
    Language::English.find_word(word).map(usize::from)
}

/// A written word number as an index, from 0; none for other text or numbers.
pub fn index_of_number(token: &str) -> Option<usize> {
    let number = whole_number_of(token, WORD_NUMBER_RANGE)?;
    usize::try_from(number - 1).ok()
}

/// The row of word number `number`, from 1 through 2,048.
pub fn row(number: usize) -> Result<Row, TableError> {
    let index = number
        .checked_sub(1)
        .filter(|index| *index < DICTIONARY_SIZE)
        .ok_or(TableError::Index)?;
    Ok(Row {
        index: number,
        english: english()[index],
        chinese: chinese()[index],
        unicode_hex: unicode_code(index),
    })
}

/// The row named by a typed word, number or Unicode code, trimmed by the one rule.
pub fn lookup(by: Lookup, text: &str) -> Result<Row, TableError> {
    let typed = trim(text);
    let index = match by {
        Lookup::Word => {
            let words: Vec<String> = super::phrase::english_tokens(typed);
            match words.as_slice() {
                [word] => index_of_english(word),
                _ => None,
            }
        }
        Lookup::Index => index_of_number(typed),
        Lookup::Unicode => index_of_unicode(&typed.to_uppercase()),
    };
    let index = index.ok_or(TableError::Row(by))?;
    row(index + 1)
}

/// Every word under a header. With no format the original table, number, English word and Unicode
/// code, tab-separated, for a script; with a format its columns lined up with spaces, the number on
/// the right of its column, the others on the left, each as wide as its widest cell, the last
/// column as it is.
pub fn text(format: Option<Format>) -> String {
    let columns: &[Column] = format.map_or(
        &[Column::Index, Column::English, Column::UnicodeHex],
        Format::columns,
    );
    let mut rows: Vec<Vec<String>> = vec![
        columns
            .iter()
            .map(|column| column.name().to_owned())
            .collect(),
    ];
    for number in 1..=DICTIONARY_SIZE {
        if let Ok(row) = row(number) {
            rows.push(columns.iter().map(|column| row.cell(*column)).collect());
        }
    }
    if format.is_none() {
        return rows
            .iter()
            .map(|cells| format!("{}\n", cells.join("\t")))
            .collect();
    }
    // TS measures cells in UTF-16 units; every cell but the last column's is ASCII or one BMP
    // character, so characters count alike.
    let widths: Vec<usize> = (0..columns.len())
        .map(|at| {
            rows.iter()
                .map(|cells| cells.get(at).map_or(0, |cell| cell.chars().count()))
                .max()
                .unwrap_or(0)
        })
        .collect();
    let mut out = String::new();
    for cells in &rows {
        let last = cells.len() - 1;
        let aligned: Vec<String> = cells
            .iter()
            .enumerate()
            .map(|(at, cell)| {
                let width = widths.get(at).copied().unwrap_or(0);
                if at == last {
                    cell.clone()
                } else if columns.get(at) == Some(&Column::Index) {
                    format!("{cell:>width$}")
                } else {
                    format!("{cell:<width$}")
                }
            })
            .collect();
        out.push_str(&aligned.join("  "));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_are_found_by_word_number_and_code() {
        let first = row(1).unwrap();
        assert_eq!(
            (first.english, first.unicode_hex.as_str()),
            ("abandon", "7684")
        );
        assert_eq!(lookup(Lookup::Word, " ZOO ").unwrap().index, 2048);
        assert_eq!(lookup(Lookup::Unicode, "7684").unwrap().index, 1);
        assert_eq!(
            lookup(Lookup::Index, "0"),
            Err(TableError::Row(Lookup::Index))
        );
        assert_eq!(row(2049), Err(TableError::Index));
    }

    #[test]
    fn the_dictionaries_line_up_their_columns() {
        let mapping = text(Some(Format::Mapping));
        let mut lines = mapping.lines();
        assert_eq!(lines.next(), Some("index  english   unicode_hex  chinese"));
        assert_eq!(lines.next(), Some("    1  abandon   7684         的"));
        assert!(text(None).starts_with("index\tenglish\tunicode_hex\n1\tabandon\t7684\n"));
    }
}
