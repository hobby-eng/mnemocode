//! The text of the help, generated once from MnemoCode TS 0.1.0's `cli/help-pages.ts`,
//! `help-options.ts` and `help-share-pages.ts`; the layout is in `commands/help.rs`.

mod decode;
mod encode;
mod options;
mod preview;
mod re_encode;
mod recover_date;
mod recover_word;
mod self_test;
mod sskr_combine;
mod sskr_export;
mod sskr_split;
mod table;
mod topics;

use super::{CommandHelp, TopicHelp};

/// Every command's page, in the order the overview lists them.
pub(super) const COMMAND_HELP: [(&str, CommandHelp); 11] = [
    ("encode", encode::PAGE),
    ("decode", decode::PAGE),
    ("re-encode", re_encode::PAGE),
    ("recover-date", recover_date::PAGE),
    ("recover-word", recover_word::PAGE),
    ("sskr-combine", sskr_combine::PAGE),
    ("sskr-export", sskr_export::PAGE),
    ("sskr-split", sskr_split::PAGE),
    ("preview", preview::PAGE),
    ("table", table::PAGE),
    ("self-test", self_test::PAGE),
];

/// Every topic.
pub(super) const TOPIC_HELP: [(&str, TopicHelp); 3] = [
    ("modes", topics::MODES),
    ("formats", topics::FORMATS),
    ("cards", topics::CARDS),
];
