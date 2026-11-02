//! The help of `mnemocode sskr-combine`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{DATES, DATES_FILE, MAX_CANDIDATES, MAX_TRIES, RUN_1, RUN_7, RUN_9};

const OWN_0_4: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("MODE"),
    summary: "seedshift when the phrase was masked before splitting",
    details: &[
        "The mode and the dates are not stored in the shares; give the same ones as for the split.",
    ],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Restore a phrase from Shamir shares",
    about: &[
        "Needs at least the threshold number of shares, in any of the share forms, which may be mixed. Type each element that cannot be read as ?: the shares are then repaired together, and every phrase that passes the hash stored in the shares is listed with its fingerprint. Shares of different sets, two different shares with the same member number and too few shares are refused; a share given twice is used once.",
        "With --ask-secrets each share is read as soon as the answer is given: a share that cannot be read is named and typed again alone, and a result that cannot be used offers what to change. Where nothing tells which of two shares is wrong, such as two that are the same member of the set but differ, both are named and you choose which to change or leave out.",
        "On the private screen with --mode seedshift, complete shares show the encoded fingerprint of the masked phrase they hold before the dates are asked for, to compare with the one the split showed. A date may then hold ? for each forgotten digit, also together with ? in the shares: the dates are searched as recover-date searches them, after the wallet's fingerprint or one of its first receiving addresses, of Bitcoin or another coin, is asked for, and the work, share combinations times date combinations, is shown first.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --share-file <PATH> | --share-qr <PNG>)",
    groups: &[
        HelpGroup {
            heading: "Options:",
            options: &[
                RUN_9,
                &[&OWN_0_4, &DATES, &DATES_FILE, &MAX_TRIES, &MAX_CANDIDATES],
            ],
        },
        HelpGroup {
            heading: "Wallet check (one of them keeps only the matching phrases):",
            options: &[RUN_1],
        },
        HelpGroup {
            heading: "Candidate list for the Discovery Scanner (docs/CANDIDATES.md):",
            options: &[RUN_7],
        },
    ],
    asks: Some(&[
        (
            "Shares",
            "shares separated by ;, ? for each unreadable element",
        ),
        (
            "Dates",
            "only with --mode seedshift; ? for each forgotten digit",
        ),
        (
            "Wallet",
            "for dates with ?, unless an option gives it; then how many addresses, unless --scan-gap",
        ),
        (
            "List passphrase",
            "twice, for a candidate list, unless an option chooses how the list is protected",
        ),
    ]),
    examples: &[
        (
            "mnemocode sskr-combine --ask-secrets",
            "Shares on the private screen",
        ),
        (
            "mnemocode sskr-combine --ask-secrets --mode seedshift",
            "Shares and dates on the private screen, ? for a forgotten digit",
        ),
        (
            "mnemocode sskr-combine --share-file ./first-share.txt --share-file ./second-share.txt",
            "Two shares from separate protected files",
        ),
        (
            "mnemocode sskr-combine --share-file ./selected-shares.txt",
            "Shares from a file",
        ),
        (
            "mnemocode sskr-combine --share-qr ./first.png --share-qr ./second.png",
            "Shares from QR images",
        ),
        (
            "mnemocode sskr-combine --share-file ./shares.txt --mode seedshift --dates-file dates.txt",
            "Shares of a phrase masked before splitting",
        ),
    ],
    notes: Some(&[
        "Every real card of one share is needed, in numbered order, to rebuild that share; its last card is a decoy and may be left out.",
        "Replace each unreadable element with ? at its place, on any of the shares, up to 64 on one share. In a color, the Unicode code of a word or a Color Unicode code written apart, a ? may also stand for one digit, such as #B5?0??, 4E?0 or E1?A, and the digits read are used; in codes run together a ? stands for a whole code, and the other forms take a ? only for a whole element. The shares are solved together: their checksums, the data they share and every share beyond the threshold settle most marks without trying anything, and the hash stored with the secret decides the rest. How many combinations are left, how long they take and what would help is shown first. More than one answer is listed, never chosen.",
        "A share file holds shares one per line or separated by ;. A share that a narrow column wrapped over lines is joined again, as when it is pasted.",
    ]),
};
