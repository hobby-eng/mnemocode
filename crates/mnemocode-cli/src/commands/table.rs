//! `mnemocode table` (MnemoCode TS 0.1.0's `cli/table-command.ts`): one row of the word table by
//! its number, its English word or its Unicode code; the whole table or a numbered dictionary; the
//! manual recovery guide; or the recovery pack saved as a new folder. Nothing it shows is secret.

use std::fmt;
use std::path::Path;

use mnemocode::bip39::sizes::WORD_NUMBER_RANGE;
use mnemocode::bip39::table::{self, Format, Lookup, Row};
use mnemocode::pack;
use mnemocode::refusal::Refusal;

use crate::args::{Parsed, choice_option, integer_option, is_on, value};
use crate::gate::Stop;
use crate::os::{self, Folder};
use crate::terminal::{self, Channel, output_line, printable, saved};

/// The options `table` takes.
pub(crate) const OPTIONS: [&str; 8] = [
    "index",
    "word",
    "unicode",
    "all",
    "table-format",
    "output",
    "recovery-guide",
    "word-lists-dir",
];

/// The refusals of the table command.
#[derive(Debug)]
enum TableCommandError {
    /// Not exactly one selection.
    OneSelection,
    /// A format or an output without what takes them.
    ExportNeedsAll,
}

impl fmt::Display for TableCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::OneSelection => "Choose exactly one lookup value: a word index, a BIP39 word, or a Unicode value. Request the full table or the recovery guide instead when no lookup is needed.",
            Self::ExportNeedsAll => "--table-format requires --all; --output requires --all or --recovery-guide.",
        })
    }
}

impl std::error::Error for TableCommandError {}

impl Refusal for TableCommandError {
    fn code(&self) -> &'static str {
        match self {
            Self::OneSelection => {
                "cli.table-command.choose-exactly-one-lookup-value-word-index-bip39"
            }
            Self::ExportNeedsAll => "cli.table-command.export-needs-all",
        }
    }
}

/// One row: grey labels under the result's heading on a terminal, plain lines for a script.
fn print_row(row: &Row) -> Result<(), Stop> {
    let facts = [
        ("Index", row.index.to_string()),
        ("English", row.english.to_owned()),
        ("Unicode hex", row.unicode_hex.clone()),
    ];
    if terminal::can_redraw(Channel::Output) {
        for line in terminal::result_lines(Channel::Output, "Word mapping", &facts) {
            output_line(&line).map_err(|_| Stop::Cancelled)?;
        }
        return Ok(());
    }
    for line in [
        format!("index:       {}", row.index),
        format!("english:     {}", row.english),
        format!("unicode hex: {}", row.unicode_hex),
    ] {
        output_line(&line).map_err(|_| Stop::Cancelled)?;
    }
    Ok(())
}

/// The format named by `--table-format`.
fn format_option(parsed: &Parsed) -> Result<Option<Format>, Stop> {
    let names: Vec<&str> = Format::ALL.iter().map(|format| format.name()).collect();
    let chosen = choice_option(parsed, "table-format", &names)?;
    Ok(chosen.and_then(|name| Format::named(name).ok()))
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let index = value(parsed, "index");
    let word = value(parsed, "word");
    let unicode = value(parsed, "unicode");
    let all = is_on(parsed, "all");
    let guide = is_on(parsed, "recovery-guide");
    let directory = value(parsed, "word-lists-dir");
    let selections = [
        index.is_some(),
        word.is_some(),
        unicode.is_some(),
        all,
        guide,
        directory.is_some(),
    ];
    if selections.iter().filter(|chosen| **chosen).count() != 1 {
        return Err(TableCommandError::OneSelection.into());
    }
    let output = value(parsed, "output");
    let format = format_option(parsed)?;
    if (!all && format.is_some()) || (!all && !guide && output.is_some()) {
        return Err(TableCommandError::ExportNeedsAll.into());
    }
    if let Some(directory) = directory {
        return save_pack(directory);
    }
    if all || guide {
        let text = if guide {
            pack::MANUAL_RECOVERY.to_owned()
        } else {
            table::text(format)
        };
        let Some(output) = output else {
            if !guide && terminal::can_redraw(Channel::Output) {
                let columns = format.map_or("index, english, unicode_hex".to_owned(), |format| {
                    table_columns(format)
                });
                let facts = [("Rows", "2048".to_owned()), ("Columns", columns)];
                for line in terminal::result_lines(Channel::Output, "Word table", &facts) {
                    output_line(&line).map_err(|_| Stop::Cancelled)?;
                }
            }
            os::write_output(text.as_bytes()).map_err(|_| Stop::Cancelled)?;
            return Ok(());
        };
        let path = os::resolve(
            Path::new(output),
            terminal::environment().current.as_deref(),
        );
        os::publish_new_file(&path, text.as_bytes())?;
        let what = if guide {
            "manual recovery instructions"
        } else {
            "numbered BIP39 word list"
        };
        saved(&format!("Saved {what}: {}", printable(output)));
        return Ok(());
    }
    let row = if index.is_some() {
        let number = integer_option(parsed, "index", WORD_NUMBER_RANGE, None, None)?;
        table::row(usize::try_from(number).unwrap_or(0))?
    } else if let Some(word) = word {
        table::lookup(Lookup::Word, word)?
    } else {
        table::lookup(Lookup::Unicode, unicode.unwrap_or_default())?
    };
    print_row(&row)
}

/// The column names of a numbered dictionary, as its header names them.
fn table_columns(format: Format) -> String {
    table::text(Some(format))
        .lines()
        .next()
        .map(|header| header.split_whitespace().collect::<Vec<_>>().join(", "))
        .unwrap_or_default()
}

/// Publishes every dictionary and the guide together as a new folder, never over an old one.
fn save_pack(directory: &str) -> Result<(), Stop> {
    let taken = "Choose a new folder for the word-list set.".to_owned();
    let folder = Folder::claim(
        Path::new(directory),
        terminal::environment().current.as_deref(),
        taken,
    )?;
    folder.publish("mnemocode-word-lists-", |staging| {
        for (name, bytes) in pack::files() {
            os::write_new_private_file(&staging.join(name), &bytes)?;
        }
        Ok(())
    })?;
    saved(&format!(
        "Saved full word-list and recovery set: {}",
        printable(directory)
    ));
    Ok(())
}
