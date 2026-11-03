//! The commands of the command line: each with the options it takes and whether it handles a
//! secret, which decides whether it runs behind the gate on its private screen (gate.rs). Each
//! command's module translates its options into library calls and their results into output.

pub(crate) mod asking;
mod backup_check;
pub(crate) mod backup_questions;
pub(crate) mod candidates_file;
pub(crate) mod card_questions;
mod cards;
pub(crate) mod date_search;
pub(crate) mod decode;
pub(crate) mod encode;
pub(crate) mod encode_questions;
mod found;
pub(crate) mod given;
mod heir_sheet;
pub(crate) mod help;
mod marked_search;
pub(crate) mod menu_entries;
pub(crate) mod output_questions;
pub(crate) mod preview;
pub(crate) mod re_encode;
pub(crate) mod recover_date;
pub(crate) mod recover_word;
mod restored_output;
mod saving;
mod searching;
pub(crate) mod self_test;
mod share_output;
mod share_repair;
pub(crate) mod sskr_combine;
pub(crate) mod sskr_export;
pub(crate) mod sskr_split;
pub(crate) mod stitch;
pub(crate) mod table;
mod wallet_options;
pub(crate) mod wallet_question;

use crate::args::{self, Parsed};
use crate::gate::Stop;
use crate::os::Protection;
use crate::output::resolved;

/// The version, as `mnemocode --version` prints it.
pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");

/// What the command line must know of a command before it runs it.
pub(crate) struct Command {
    /// Its name.
    pub(crate) name: &'static str,
    /// The options it takes, by the groups they are kept in.
    pub(crate) options: &'static [&'static [&'static str]],
    /// Whether it takes or shows a secret: it then runs behind the gate, on the private screen.
    pub(crate) secret: bool,
    /// What runs it.
    pub(crate) run: Run,
    /// Whether the answers on its private screen may name the folders it saves into.
    pub(crate) asks_outputs: Option<fn(&Parsed) -> bool>,
}

/// What runs a command.
#[derive(Clone, Copy)]
pub(crate) enum Run {
    /// A command that goes by its options.
    Options(fn(&Parsed) -> Result<(), Stop>),
    /// A command whose answers name the files it saves, which rules its writes before the secret.
    Ruling(fn(&Parsed, &mut Protection) -> Result<(), Stop>),
    /// The self-test, which writes in a temporary folder and reports what protects the process.
    SelfTest(fn(&Protection) -> Result<(), Stop>),
}

/// Every command, in the order the help lists them.
pub(crate) const COMMANDS: [Command; 12] = [
    Command {
        name: "encode",
        options: &[
            &encode::SHARED_OPTIONS,
            &encode::SSKR_ONLY_OPTIONS,
            &encode::OWN_OPTIONS,
            &sskr_split::ENCODE_PLAIN_ONLY_OPTIONS,
            &cards::CARD_OPTIONS,
        ],
        secret: true,
        run: Run::Options(encode::run),
        asks_outputs: None,
    },
    Command {
        name: "decode",
        options: &[&decode::OPTIONS],
        secret: true,
        run: Run::Options(decode::run),
        asks_outputs: None,
    },
    Command {
        name: "re-encode",
        options: &[
            &re_encode::OLD_OPTIONS,
            &wallet_options::WALLET_EVIDENCE_OPTIONS,
            &encode::SHARED_OPTIONS,
            &encode::SSKR_ONLY_OPTIONS,
            &encode::OWN_OPTIONS,
            &sskr_split::ENCODE_PLAIN_ONLY_OPTIONS,
            &cards::CARD_OPTIONS,
        ],
        secret: true,
        run: Run::Ruling(re_encode::run),
        asks_outputs: Some(re_encode::asks_new_backup),
    },
    Command {
        name: "recover-date",
        options: &[&recover_date::OPTIONS],
        secret: true,
        run: Run::Options(recover_date::run),
        asks_outputs: None,
    },
    Command {
        name: "recover-word",
        options: &[&recover_word::OPTIONS],
        secret: true,
        run: Run::Options(recover_word::run),
        asks_outputs: Some(recover_word::offers_candidate_list),
    },
    Command {
        name: "sskr-combine",
        options: &[&sskr_combine::OPTIONS],
        secret: true,
        run: Run::Options(sskr_combine::run),
        asks_outputs: None,
    },
    Command {
        name: "sskr-export",
        options: &[
            &sskr_export::OPTIONS,
            &wallet_options::WALLET_EVIDENCE_OPTIONS,
            &cards::CARD_OPTIONS,
            &["card-layout"],
        ],
        secret: true,
        run: Run::Options(sskr_export::run),
        asks_outputs: None,
    },
    Command {
        name: "sskr-split",
        options: &[&sskr_split::OPTIONS, &cards::CARD_OPTIONS, &["card-layout"]],
        secret: true,
        run: Run::Options(sskr_split::run),
        asks_outputs: None,
    },
    Command {
        name: "stitch",
        options: &[&stitch::OPTIONS],
        secret: true,
        run: Run::Options(stitch::run),
        asks_outputs: None,
    },
    Command {
        name: "preview",
        options: &[&preview::OPTIONS],
        secret: false,
        run: Run::Options(preview::run),
        asks_outputs: None,
    },
    Command {
        name: "table",
        options: &[&table::OPTIONS],
        secret: false,
        run: Run::Options(table::run),
        asks_outputs: None,
    },
    Command {
        name: "self-test",
        options: &[],
        secret: false,
        run: Run::SelfTest(self_test::run),
        asks_outputs: None,
    },
];

/// The command named `name`.
pub(crate) fn named(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.name == name)
}

/// Checks `parsed` against `command`'s options and its file sources.
pub(crate) fn check_options(command: &Command, parsed: &Parsed) -> Result<(), Stop> {
    let options: Vec<&str> = command.options.iter().copied().flatten().copied().collect();
    args::assert_allowed(parsed, command.name, &options)?;
    args::assert_private_file_sources(parsed)?;
    Ok(())
}
