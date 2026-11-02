//! The help of `mnemocode self-test`.

use super::super::CommandHelp;

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Run the self-test",
    about: &[
        "Checks every phrase length, format and mode, the sorting of dates, the public test vectors, the 24 English BIP39 seed vectors, the date and word searches with a wallet, the search of unreadable codes, encrypted candidate lists and their writer, the check of a written backup, marked Shamir shares repaired together and with dates, the split into shares and their restore, every coin address vector, the sheet for heirs, share cards, the colors and decoys of card sets, QR images beside a sheet, card export with every kind of artwork and font, and card pages read back. The check of each feature is also given a case it must refuse. Run it before using a newly built or copied installation.",
        "A smaller core self-test runs before every command that processes data, in less than half a second: it checks both BIP39 word lists and fixed test phrases in every mode, and compares each feature with known answers: the BIP39 seed and fingerprint, dates with ? and |, codes and shares marked with ?, the word search, the candidate list, the check of a written backup, wallet evidence and the addresses of the twelve coins, the sheet for heirs and share cards. A failure stops the command before any input is read.",
    ],
    usage: "",
    groups: &[],
    asks: None,
    examples: &[(
        "mnemocode self-test",
        "Run every check and print the result of each group",
    )],
    notes: None,
};
