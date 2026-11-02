//! Entry 8 of the start menu: the word table, one row at a time or all of it, and its exports.

use mnemocode::bip39::sizes::WORD_NUMBER_RANGE;
use mnemocode::bip39::table::{self, Lookup, UNICODE_CODE_HINT};
use mnemocode::forms::hints::BIP39;

use super::{Action, joined, line};
use crate::commands::asking::ask_list;
use crate::commands::encode_questions::file_questions;
use crate::commands::output_questions::{ask_new_folder, ask_output_file};
use crate::gate::Stop;
use crate::terminal::{self, Choice, Chosen, LineQuestion, ask_line};

/// The longest answer of a lookup.
const LOOKUP_LIMIT: usize = 64;

/// One value, keeping its lookup kind when the person asks to enter another.
pub(super) fn lookup_action(lookup: Lookup) -> Result<Action, Stop> {
    let numbers = format!("a number from {}", WORD_NUMBER_RANGE.to());
    let (question, label, what, option) = match lookup {
        Lookup::Word => ("Word", "Word", "a word of the English BIP39 list", "--word"),
        Lookup::Index => ("Word number", "Number", numbers.as_str(), "--index"),
        Lookup::Unicode => ("Unicode code", "Code", UNICODE_CODE_HINT, "--unicode"),
    };
    let how = LineQuestion {
        what: Some(what),
        limit: LOOKUP_LIMIT,
        hints: (lookup == Lookup::Word).then_some(&*BIP39 as &dyn terminal::Hints),
        ..LineQuestion::default()
    };
    // Given as the table writes it, as the command line takes it.
    let answer = ask_line(question, label, how, |answer: &str| {
        table::lookup(lookup, answer).map(|row| match lookup {
            Lookup::Word => row.english.to_owned(),
            Lookup::Index => row.index.to_string(),
            Lookup::Unicode => row.unicode_hex,
        })
    })?;
    match answer {
        Chosen::One(value) => Ok(Action::Run {
            run: vec!["table".to_owned(), option.to_owned(), value],
            again: Some(lookup),
        }),
        Chosen::Back => Ok(Action::Back),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// What the table saves.
#[derive(Clone, Copy)]
enum Export {
    List(&'static str),
    Guide,
    Set,
}

/// Saves a complete numbered word list or the standalone manual recovery guide.
fn table_export_action() -> Result<Action, Stop> {
    let choices = [
        Choice::new("English word list", Export::List("english")),
        Choice::new("Traditional Chinese word list", Export::List("chinese")),
        Choice::new("Unicode characters and codes", Export::List("unicode")),
        Choice::noted(
            "Full mapping",
            "number, English, Chinese and Unicode code",
            Export::List("mapping"),
        ),
        Choice::noted(
            "Manual recovery instructions",
            "English; keep a printed copy",
            Export::Guide,
        ),
        Choice::noted(
            "Full set",
            "all lists, full mapping and instructions",
            Export::Set,
        ),
    ];
    let Some(export) = ask_list("What should be exported?", "Export", &choices, None)? else {
        return Ok(Action::Back);
    };
    let file = match export {
        Export::Set => {
            let Some(folder) = ask_new_folder("mnemocode-recovery-pack")? else {
                return Ok(Action::Back);
            };
            return Ok(Action::run(joined(
                &["table", "--word-lists-dir"],
                vec![folder],
            )));
        }
        Export::Guide => "mnemocode-manual-recovery.md".to_owned(),
        Export::List(format) => format!("bip39-{format}.txt"),
    };
    let Some(path) = ask_output_file(file_questions::TEXT, &file)? else {
        return Ok(Action::Back);
    };
    let mut run = match export {
        Export::List(format) => line(&["table", "--all", "--table-format", format]),
        _ => line(&["table", "--recovery-guide"]),
    };
    run.extend(["--output".to_owned(), path]);
    Ok(Action::run(run))
}

/// What is looked up.
#[derive(Clone, Copy)]
enum Table {
    One(Lookup),
    All,
    Export,
}

/// Entry 8: one row of the word table, or all of it.
pub(super) fn table_action() -> Result<Action, Stop> {
    let numbers = WORD_NUMBER_RANGE.to();
    let choices = [
        Choice::noted("A word", "such as abandon", Table::One(Lookup::Word)),
        Choice::noted("A word number", &numbers, Table::One(Lookup::Index)),
        Choice::noted(
            "A Unicode code",
            UNICODE_CODE_HINT,
            Table::One(Lookup::Unicode),
        ),
        Choice::noted("The whole table", "all 2,048 rows", Table::All),
        Choice::noted("Export word lists and guide", "text files", Table::Export),
    ];
    match ask_list("What do you want to look up?", "Look up", &choices, None)? {
        None => Ok(Action::Back),
        Some(Table::All) => Ok(Action::run(line(&["table", "--all"]))),
        Some(Table::Export) => table_export_action(),
        Some(Table::One(lookup)) => lookup_action(lookup),
    }
}
