//! Damaged shares written again whole, as sskr-export writes them (MnemoCode TS 0.1.0's
//! `ShareRestore.repair` of `sskr/share-restore.ts`, CAP-SSKR-EXPORT-REPAIR-FLOW): the phrase is
//! never given.

use std::collections::BTreeSet;
use std::rc::Rc;

use super::flow::{PhrasesFound, ShareRestoreOutcome, match_warnings};
use super::{NO_SHARE_SETTLED, SEEDSHIFT_REPAIR_NEEDS_WALLET, ShareFlowError};
use super::{WALLET_CHECK_NEEDS_THRESHOLD, variants_message};
use crate::bip32::{ExtendedKey, fingerprint_hex};
use crate::modes::Mode;
use crate::secret::SecretText;
use crate::sskr::forms::ShareFormat;
use crate::sskr::repair::report::{NO_PHRASE_FITS, RepairReport, ReportLine, ShareRepairs};
use crate::sskr::restore::{MarkedElement, SetShare, ShareSet};
use crate::sskr::typed::{CheckedExport, EachRepair, ShareInput};

/// Why a repair of shares in `mode` cannot start, before any share is read: a wallet tells sets of
/// repaired shares apart, and for a Seedshift phrase it needs the dates, which serve only its check.
pub const fn repair_refusal(mode: Mode, wallet_given: bool) -> Option<&'static str> {
    if mode.masked() && !wallet_given {
        Some(SEEDSHIFT_REPAIR_NEEDS_WALLET)
    } else {
        None
    }
}

/// What a repair gives before any restore: why it cannot start, or complete shares written again,
/// which need no quorum without a wallet check; none where it needs a restore.
pub fn repair_before_restore(
    input: &ShareInput,
    mode: Mode,
    wallet_given: bool,
    form: Option<ShareFormat>,
) -> Result<Option<ShareRepairOutcome>, ShareFlowError> {
    if let Some(refusal) = repair_refusal(mode, wallet_given) {
        return Ok(Some(ShareRepairOutcome::Trouble {
            message: refusal.to_owned(),
            lines: Vec::new(),
        }));
    }
    if !rewrites_only(input, wallet_given) {
        return Ok(None);
    }
    match input.rewritten() {
        Err(trouble) => Ok(Some(ShareRepairOutcome::Trouble {
            message: trouble.message,
            lines: Vec::new(),
        })),
        Ok(shares) => {
            export_outcome(&shares, &[], &input.places(), form, Vec::new(), Vec::new()).map(Some)
        }
    }
}

/// Whether a repair only writes the shares of `input` again: complete shares without a wallet check
/// restore no phrase, so they need no quorum.
pub fn rewrites_only(input: &ShareInput, wallet_given: bool) -> bool {
    !input.marked() && !wallet_given
}

/// The export path after a restore, which only this library decides.
#[derive(Debug)]
pub enum ShareExportDecision<'a> {
    /// Too few shares to restore a phrase: each share is repaired and written on its own.
    Each,
    /// Several sets fit: each is shown with its fingerprint, and none is written.
    Variants(&'a PhrasesFound),
    /// One set fits: its shares are written again.
    Set(&'a PhrasesFound, Rc<ShareSet>),
    /// Nothing is written: why, for the person.
    Trouble(&'static str),
}

/// Selects the export path of what a restore `found`, none where the shares were too few.
pub fn export_decision(
    found: Option<&PhrasesFound>,
    wallet_given: bool,
) -> ShareExportDecision<'_> {
    let Some(found) = found else {
        return if wallet_given {
            ShareExportDecision::Trouble(WALLET_CHECK_NEEDS_THRESHOLD)
        } else {
            ShareExportDecision::Each
        };
    };
    match found.sets.as_slice() {
        [] => ShareExportDecision::Trouble(NO_PHRASE_FITS),
        [set] => ShareExportDecision::Set(found, Rc::clone(set)),
        _ => ShareExportDecision::Variants(found),
    }
}

/// A share written again, by its place among those typed.
#[derive(Debug)]
pub struct RepairedShare {
    /// The share's place among those typed, from 1.
    pub number: usize,
    /// The share in the form asked for, or in its own.
    pub text: SecretText,
    /// The form that `text` is written in.
    pub format: ShareFormat,
    /// The share as an SSKR UR record, which cards and share files take.
    pub record: SecretText,
}

/// `share` at `number`, written in `form` or its own.
fn repaired_share(
    share: &crate::sskr::share::Share,
    own: ShareFormat,
    number: usize,
    form: Option<ShareFormat>,
) -> RepairedShare {
    let format = form.unwrap_or(own);
    RepairedShare {
        number,
        text: format.write(share),
        format,
        record: ShareFormat::Ur.write(share),
    }
}

/// A set of shares that fits, with the original fingerprint of its phrase, after the dates.
#[derive(Debug)]
pub struct ShareVariant {
    /// The fingerprint of the phrase; none for a share repaired alone, of no phrase.
    pub fingerprint: Option<String>,
    /// The set's shares written again, each named by its place.
    pub shares: Vec<RepairedShare>,
    /// What the repair filled in, share by share, each guess marked.
    pub repairs: Vec<ShareRepairs>,
}

/// Every set of `found` with the original fingerprint of its phrase, after the dates: the one that
/// a wallet check compares with, not that of the masked phrase the shares hold.
pub fn variants(
    found: &PhrasesFound,
    places: &[usize],
    form: Option<ShareFormat>,
) -> Result<Vec<ShareVariant>, ShareFlowError> {
    found
        .sets
        .iter()
        .map(|set| {
            let phrase = found
                .phrases
                .iter()
                .find(|phrase| Rc::ptr_eq(&phrase.unmasked.set, set))
                .map_or_else(|| set.phrase(), |phrase| &phrase.unmasked.phrase);
            let key = ExtendedKey::of_phrase(phrase, "")?;
            Ok(ShareVariant {
                fingerprint: Some(fingerprint_hex(key.fingerprint()?)),
                shares: set
                    .shares()
                    .iter()
                    .enumerate()
                    .map(|(index, share)| {
                        repaired_share(&share.share, share.format, places[index], form)
                    })
                    .collect(),
                repairs: RepairReport::repairs(set, Some(places)),
            })
        })
        .collect()
}

/// What a repair of marked shares ends with.
#[derive(Debug)]
pub enum ShareRepairOutcome {
    /// A trouble to say, after the lines of the report.
    Trouble {
        /// The trouble.
        message: String,
        /// The lines of the report.
        lines: Vec<ReportLine>,
    },
    /// A search that waits for the person's yes.
    Question {
        /// What to ask.
        question: String,
        /// The lines of the report.
        lines: Vec<ReportLine>,
    },
    /// The host stopped the search: nothing is told.
    Stopped {
        /// The lines of the report said before the stop.
        lines: Vec<ReportLine>,
    },
    /// The shares written again.
    Shares {
        /// The shares, by their places, copies given once.
        shares: Vec<RepairedShare>,
        /// The one form every share is written in; none when they keep different forms.
        form: Option<ShareFormat>,
        /// What the repair filled in, share by share.
        repairs: Vec<ShareRepairs>,
        /// The lines of the report, said before the shares.
        lines: Vec<ReportLine>,
        /// The notes said with the shares, such as of shares left out or of copies.
        notes: Vec<String>,
        /// What the wallet check said of the match that chose these shares, joined by a space.
        warning: Option<String>,
    },
    /// The sets shown, none written.
    Variants {
        /// Why the sets are shown and none is written.
        message: String,
        /// Every set that fits, each with its fingerprint.
        variants: Vec<ShareVariant>,
        /// The lines of the report, said before the sets.
        lines: Vec<ReportLine>,
        /// What the wallet check said of its match with every set shown, joined by a space.
        warning: Option<String>,
    },
}

/// One set written again: a share that nothing settles is left out, copies are given once.
fn export_outcome(
    shares: &[SetShare],
    unsettled: &[MarkedElement],
    places: &[usize],
    form: Option<ShareFormat>,
    lines: Vec<ReportLine>,
    notes: Vec<String>,
) -> Result<ShareRepairOutcome, ShareFlowError> {
    let checked = ShareInput::checked_export(shares, unsettled, places, form)?;
    let written = match checked {
        CheckedExport::Written(written) => written,
        CheckedExport::None(written) => {
            let mut parts = vec![NO_SHARE_SETTLED.to_owned()];
            parts.extend(written.left_out_messages());
            return Ok(ShareRepairOutcome::Trouble {
                message: parts.join(" "),
                lines,
            });
        }
        CheckedExport::Trouble(_, trouble) => {
            return Ok(ShareRepairOutcome::Trouble {
                message: trouble.message,
                lines,
            });
        }
    };
    let forms: BTreeSet<&'static str> = written
        .shown()
        .iter()
        .map(|share| share.format.name())
        .collect();
    let mut notes = notes;
    notes.extend(written.left_out_messages());
    notes.extend(written.copies_note().map(str::to_owned));
    Ok(ShareRepairOutcome::Shares {
        shares: written
            .shown()
            .iter()
            .map(|share| repaired_share(&share.share, share.format, share.number, None))
            .collect(),
        form: match written.shown() {
            [first, ..] if forms.len() == 1 => Some(first.format),
            _ => None,
        },
        repairs: RepairReport::repairs_of(shares, unsettled, Some(places)),
        lines,
        notes,
        warning: None,
    })
}

/// Fewer shares than the threshold restore no phrase: each is repaired from its own checks.
fn repair_each(
    input: &ShareInput,
    form: Option<ShareFormat>,
    few: String,
) -> Result<ShareRepairOutcome, ShareFlowError> {
    let lines = vec![ReportLine::Warning(few)];
    match input.repair_each() {
        EachRepair::Unreadable { message, .. } => Ok(ShareRepairOutcome::Trouble {
            message,
            lines: Vec::new(),
        }),
        EachRepair::Variants {
            place,
            variants,
            message,
        } => Ok(ShareRepairOutcome::Variants {
            message,
            variants: variants
                .iter()
                .map(|variant| ShareVariant {
                    fingerprint: None,
                    shares: vec![repaired_share(&variant.share, variant.format, place, form)],
                    repairs: Vec::new(),
                })
                .collect(),
            lines,
            warning: None,
        }),
        EachRepair::Repaired(shares) => {
            export_outcome(&shares, &[], &input.places(), form, lines, Vec::new())
        }
    }
}

/// Damaged shares written again whole, as sskr-export writes them, once a restore gave `outcome`:
/// each in its own form, or in `form`; the phrase is never given. Marked shares are repaired
/// together, or each on its own when fewer than the threshold were typed. A wallet tells apart
/// several sets that fit; without one each set is given with its fingerprint and none is chosen.
pub fn repaired(
    outcome: ShareRestoreOutcome,
    input: &ShareInput,
    form: Option<ShareFormat>,
    wallet_given: bool,
) -> Result<ShareRepairOutcome, ShareFlowError> {
    let (found, places, lines, notes) = match outcome {
        ShareRestoreOutcome::Trouble { message, lines } => {
            return Ok(ShareRepairOutcome::Trouble { message, lines });
        }
        ShareRestoreOutcome::Question { question, lines } => {
            return Ok(ShareRepairOutcome::Question { question, lines });
        }
        ShareRestoreOutcome::Stopped { lines } => {
            return Ok(ShareRepairOutcome::Stopped { lines });
        }
        ShareRestoreOutcome::Few { message, lines } => {
            return match export_decision(None, wallet_given) {
                ShareExportDecision::Trouble(message) => Ok(ShareRepairOutcome::Trouble {
                    message: message.to_owned(),
                    lines,
                }),
                _ => repair_each(input, form, message),
            };
        }
        ShareRestoreOutcome::Phrases {
            found,
            places,
            lines,
            notes,
        } => (found, places, lines, notes),
    };
    // The wallet chose the set written, or matched every set shown: what its check said of the
    // match is said with them.
    let warnings = match_warnings(&found.phrases);
    let warning = (!warnings.is_empty()).then(|| warnings.join(" "));
    match export_decision(Some(&found), wallet_given) {
        // A restore that found phrases is never too few: only that no phrase fits is left.
        ShareExportDecision::Each | ShareExportDecision::Trouble(_) => {
            Ok(ShareRepairOutcome::Trouble {
                message: NO_PHRASE_FITS.to_owned(),
                lines,
            })
        }
        ShareExportDecision::Variants(found) => Ok(ShareRepairOutcome::Variants {
            message: variants_message(found.sets.len(), wallet_given),
            variants: variants(found, &places, form)?,
            lines,
            warning,
        }),
        ShareExportDecision::Set(_, set) => {
            let exported =
                export_outcome(set.shares(), set.unsettled(), &places, form, lines, notes)?;
            Ok(match exported {
                ShareRepairOutcome::Shares {
                    shares,
                    form,
                    repairs,
                    lines,
                    notes,
                    ..
                } => ShareRepairOutcome::Shares {
                    shares,
                    form,
                    repairs,
                    lines,
                    notes,
                    warning,
                },
                other => other,
            })
        }
    }
}
