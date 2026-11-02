//! `mnemocode sskr-export` (MnemoCode TS 0.1.0's `cli/sskr-export-command.ts`): shares read back,
//! repaired where marked, and written again in another form or as cards, as sskr-split writes them.
//! From the command line a share that cannot be used ends the command; with --ask-secrets, on the
//! private screen, it is named and typed again, or left out.

use std::fmt;

use mnemocode::modes::phrase_words::{
    MASKED, ORIGINAL_FINGERPRINT, REPAIRED_MASKED, REPAIRED_UNKNOWN,
};
use mnemocode::recovery::shares::flow::PhrasesFound;
use mnemocode::recovery::shares::repair::{
    ShareExportDecision, export_decision, repair_refusal, rewrites_only, variants,
};
use mnemocode::recovery::shares::{
    NO_SHARE_SETTLED, WALLET_CHECK_NEEDS_THRESHOLD, variants_message,
};
use mnemocode::refusal::Refusal;
use mnemocode::sskr::export::{ShareExport, WrittenShare};
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::restore::{MarkedElement, SetShare};
use mnemocode::sskr::share::Share;
use mnemocode::sskr::typed::{CheckedExport, EachRepair, ShareInput, ShareTrouble};

use super::asking::{AfterFailure, WHAT_NOW, after_failure, ask_or_stop, or_back_or_cancel};
use super::restored_output::report_wallet_warnings;
use super::share_output::{
    Presentation, ShareCards, check_share_cards_printable, export_options, print_share_block,
    print_shares, save_shares, share_format,
};
use super::share_repair::{TypedShares, add_more_shares, mend_shares, report_repairs};
use super::sskr_combine::{
    AfterFew, Recovery, RestoreRules, Restoring, recovery_settings, restore_phrases,
};
use crate::args::{Parsed, REPEATABLE_OPTIONS, assert_single_values, value};
use crate::gate::Stop;
use crate::output::report_renamed;
use crate::terminal::result::{print, result_header};
use crate::terminal::{Channel, Choice, NoticeKind, clear_private_screen, hint, notice};

/// The options `sskr-export` takes, its card options apart.
pub(crate) const OPTIONS: [&str; 13] = [
    "mode",
    "date",
    "dates-file",
    "max-tries",
    "max-candidates",
    "format",
    "output",
    "qr-dir",
    "pdf",
    "share",
    "share-file",
    "share-qr",
    "ask-secrets",
];

/// The refusals of the command, in the library's words.
#[derive(Debug)]
enum ExportError {
    CardForm,
    CardsOwnForm(String),
    NoShareSettled,
    RepairEach(String, &'static str),
    Few(String),
    Refused(String),
}

impl fmt::Display for ExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CardForm => f.write_str(
                "The shares are written in different forms: choose one with --format for cards.",
            ),
            Self::CardsOwnForm(refusal) => write!(
                f,
                "Without --format each share is printed in the form it is written in, which may be \
                 {}; --format colors prints every share in colors. {refusal}",
                ShareFormat::Unicode.label()
            ),
            Self::NoShareSettled => f.write_str(NO_SHARE_SETTLED),
            Self::RepairEach(text, _) | Self::Few(text) | Self::Refused(text) => f.write_str(text),
        }
    }
}

impl std::error::Error for ExportError {}

impl Refusal for ExportError {
    fn code(&self) -> &'static str {
        match self {
            Self::CardForm => "cli.sskr-export-command.card-form-refused",
            Self::CardsOwnForm(_) => "cli.sskr-export-command.cards-own-form-refused",
            Self::NoShareSettled => "cli.sskr-export-command.no-share-settled",
            Self::RepairEach(_, code) => code,
            Self::Few(_) => "cli.sskr-export-command.few-export-refused",
            Self::Refused(_) => "cli.sskr-export-command.run-sskr-export-refused",
        }
    }
}

/// Asks in which form cards show shares written in different forms; Stop cancels. Without a private
/// screen the mix ends the command.
fn card_form(forms: &[ShareFormat], interactive: bool) -> Result<ShareFormat, Stop> {
    if !interactive {
        return Err(ExportError::CardForm.into());
    }
    let choices: Vec<Choice<ShareFormat>> = forms
        .iter()
        .map(|format| Choice::new(&format.label(), *format))
        .collect();
    ask_or_stop(
        "The shares are written in different forms. Which form should the cards show?",
        "Cards",
        &choices,
        None,
    )
}

/// Where and how an export shows and saves the shares, as its options say.
struct ExportOutput {
    /// The form of --format, in which every share is written; none keeps each share's own.
    given: Option<ShareFormat>,
    /// The cards to save, checked before the shares were asked.
    checked: Option<ShareCards>,
    /// The options of the command, which name the files to save.
    parsed: Parsed,
}

/// What a try of an export gave.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Export {
    Done,
    /// The shares were changed on the private screen, to be tried again.
    Changed,
}

/// Shows a set of shares, repaired or not, each in its own form or the one of --format, and saves it
/// where the options say, by the rules of an export: a share with elements that nothing settles is
/// left out, and copies of one share are shown as typed and saved once.
fn export_set(
    r: &mut Recovery,
    (shares, unsettled): (&[SetShare], &[MarkedElement]),
    places: &[usize],
    output: &mut ExportOutput,
) -> Result<Export, Stop> {
    // The result is a step of its own: the questions and the search are cleared away (CORE-39),
    // before the repairs it reports.
    clear_private_screen();
    report_repairs(shares, unsettled, Some(places));
    let checked = ShareInput::checked_export(shares, unsettled, places, output.given)?;
    let say_left_out = |written: &ShareExport| {
        for message in written.left_out_messages() {
            notice(&message, NoticeKind::Warning);
        }
    };
    let written = match checked {
        CheckedExport::None(written) => {
            say_left_out(&written);
            if !r.interactive {
                return Err(ExportError::NoShareSettled.into());
            }
            for place in written.left_out().to_vec() {
                r.shares.retype(place, None)?;
            }
            return Ok(Export::Changed);
        }
        CheckedExport::Trouble(written, trouble) => {
            say_left_out(&written);
            mend_shares(&mut r.shares, trouble, r.interactive)?;
            return Ok(Export::Changed);
        }
        CheckedExport::Written(written) => {
            say_left_out(&written);
            written
        }
    };
    let written = if output.checked.is_some() && written.forms().len() > 1 {
        written.in_form(card_form(&written.forms(), r.interactive)?)
    } else {
        written
    };
    let saved: Vec<&WrittenShare> = written.saved();
    let masked = r.mode.masked();
    if let (Some(cards), Some(first)) = (&mut output.checked, saved.first()) {
        cards.show_in(first.format);
    }
    save_shares(&saved, &mut output.parsed, output.checked.as_ref(), masked)?;
    report_renamed();
    if let Some(note) = written.copies_note() {
        notice(note, NoticeKind::Info);
    }
    // The shares come back as they were split: a page and this screen name what they hold, so that
    // a masked phrase is not taken for the wallet's.
    notice(
        if masked {
            REPAIRED_MASKED
        } else {
            REPAIRED_UNKNOWN
        },
        NoticeKind::Info,
    );
    print_shares(
        written.shown(),
        written.total(),
        masked.then_some(MASKED),
        Presentation::Backup,
    );
    Ok(Export::Done)
}

/// What comes after a share that fits several ways.
#[derive(Clone, Copy)]
enum AfterVariants {
    Again,
    More,
    Done,
}

/// Each typed share repaired from its own checks alone, as for fewer shares than the threshold. A
/// share that fits more than one way has its variants shown; on the private screen it may then be
/// typed again from another copy, or more shares added; otherwise nothing is saved. A share that
/// cannot be repaired is typed again, or ends the command.
fn repair_each(
    r: &mut Recovery,
    given: Option<ShareFormat>,
) -> Result<Result<Vec<SetShare>, Export>, Stop> {
    match r.shares.input.repair_each() {
        EachRepair::Repaired(shares) => Ok(Ok(shares)),
        EachRepair::Unreadable {
            place,
            message,
            code,
        } => {
            if !r.interactive {
                return Err(ExportError::RepairEach(message, code).into());
            }
            r.shares.retype(place, Some(message))?;
            Ok(Err(Export::Changed))
        }
        EachRepair::Variants {
            place,
            variants,
            message,
        } => {
            notice(&message, NoticeKind::Warning);
            for (index, variant) in variants.iter().enumerate() {
                print_share_block(
                    &format!("Share {place}, variant {} of {}", index + 1, variants.len()),
                    &variant.share,
                    given.unwrap_or(variant.format),
                );
            }
            if !r.interactive {
                return Ok(Err(Export::Done));
            }
            let next = after_failure(
                WHAT_NOW,
                &[
                    Choice::noted(
                        &format!("Type share {place} again"),
                        "from another copy",
                        AfterVariants::Again,
                    ),
                    add_more_shares(AfterVariants::More),
                    Choice::noted("Done", "nothing is saved", AfterVariants::Done),
                ],
                AfterFailure::default(),
            )?;
            match next {
                AfterVariants::Done => return Ok(Err(Export::Done)),
                AfterVariants::Again => r.shares.retype(place, None)?,
                AfterVariants::More => r.shares.ask_more()?,
            }
            Ok(Err(Export::Changed))
        }
    }
}

/// Shows every set that fits, with the fingerprint of the phrase it holds, its shares named by
/// `places`; none is saved. `wallet_given` says that each matched the wallet given, which then
/// cannot tell them apart.
fn show_variants(
    found: &PhrasesFound,
    places: &[usize],
    given: Option<ShareFormat>,
    wallet_given: bool,
) -> Result<(), Stop> {
    // Each with the wallet's own fingerprint, of the phrase after the dates, in the order of their
    // sets, which say what a repair filled in.
    let all = variants(found, places, given)?;
    notice(
        &variants_message(all.len(), wallet_given),
        NoticeKind::Warning,
    );
    hint("Each fingerprint is that of the phrase the shares hold, with an empty passphrase.");
    let total = places.iter().copied().max().unwrap_or(0);
    for (index, variant) in all.iter().enumerate() {
        let title = format!("Variant {} of {}", index + 1, all.len());
        let fingerprint = variant.fingerprint.clone().unwrap_or_default();
        let facts = [(ORIGINAL_FINGERPRINT, fingerprint.clone())];
        if !result_header(&title, &facts, Channel::Output) {
            print(
                Channel::Output,
                &[format!("{title}, original fingerprint {fingerprint}:")],
            );
        }
        if let Some(set) = found.sets.get(index) {
            report_repairs(set.shares(), set.unsettled(), Some(places));
        }
        for share in &variant.shares {
            let written = WrittenShare {
                share: Share::read_ur(share.record.as_str())?,
                format: share.format,
                number: share.number,
            };
            print_shares(
                std::slice::from_ref(&written),
                total,
                None,
                Presentation::Candidate,
            );
        }
    }
    Ok(())
}

/// What is chosen after too few shares for the wallet given.
#[derive(Clone, Copy)]
enum AfterFewShares {
    More,
    Without,
}

/// After too few shares to restore the phrase that the wallet given is checked against: on the
/// private screen more shares, the export without the wallet check, or Stop, which cancels;
/// otherwise the shares go back with the wallet kept, which the export decision refuses.
fn few_for_export(r: &mut Recovery, _trouble: ShareTrouble) -> Result<AfterFew, Stop> {
    if r.wallet.check.is_none() || !r.interactive {
        return Ok(AfterFew::Few);
    }
    notice(WALLET_CHECK_NEEDS_THRESHOLD, NoticeKind::Warning);
    let next = or_back_or_cancel(
        WHAT_NOW,
        &[
            add_more_shares(AfterFewShares::More),
            Choice::noted(
                "Go on without the wallet check",
                "each share alone",
                AfterFewShares::Without,
            ),
        ],
        false,
    )?;
    if matches!(next, Some(AfterFewShares::More)) {
        r.shares.ask_more()?;
        return Ok(AfterFew::Again);
    }
    r.wallet.set_evidence(None);
    Ok(AfterFew::Few)
}

/// One try with the shares as they are now.
fn export_once(r: &mut Recovery, output: &mut ExportOutput) -> Result<Export, Stop> {
    if rewrites_only(&r.shares.input, r.wallet.check.is_some()) {
        return match r.shares.input.rewritten() {
            Err(trouble) => {
                mend_shares(&mut r.shares, trouble, r.interactive)?;
                Ok(Export::Changed)
            }
            Ok(set) => {
                let places = r.shares.places();
                export_set(r, (&set, &[]), &places, output)
            }
        };
    }
    let rules = RestoreRules {
        few: few_for_export,
        one: true,
    };
    let restored = restore_phrases(r, &rules)?;
    export_restored(r, restored, output)
}

/// The step of an export that takes what the restore of the shares gave: the sets that fit, with
/// their phrases, or too few shares. One set has its shares saved and shown; several, which no
/// wallet told apart, are each shown with the fingerprint of its phrase and none is saved; what the
/// wallet check said of the matches is said after them. Too few shares are repaired each on its own,
/// and complete ones whose wallet check was dropped are only written again, on the next try.
fn export_restored(
    r: &mut Recovery,
    restored: Restoring,
    output: &mut ExportOutput,
) -> Result<Export, Stop> {
    let wallet_given = r.wallet.check.is_some();
    let found = match &restored {
        Restoring::Few if rewrites_only(&r.shares.input, wallet_given) => {
            return Ok(Export::Changed);
        }
        Restoring::Few => None,
        Restoring::Phrases(at) => Some(at),
    };
    match export_decision(found.map(|at| &at.found), wallet_given) {
        // The one trouble left here: fewer shares than the threshold with the wallet kept, off the
        // private screen. Where no phrase fits, the restore refused or asked again.
        ShareExportDecision::Trouble(message) => Err(ExportError::Few(message.to_owned()).into()),
        ShareExportDecision::Each => {
            // Fewer shares than the threshold restore no phrase; each is then repaired on its own.
            let shares = match repair_each(r, output.given)? {
                Ok(shares) => shares,
                Err(end) => return Ok(end),
            };
            let places = r.shares.places();
            export_set(r, (&shares, &[]), &places, output)
        }
        ShareExportDecision::Variants(found) => {
            let places = restored_places(&restored);
            show_variants(found, places, output.given, wallet_given)?;
            report_wallet_warnings(&found.phrases);
            Ok(Export::Done)
        }
        ShareExportDecision::Set(found, set) => {
            let places = restored_places(&restored).to_vec();
            let exported = export_set(r, (set.shares(), set.unsettled()), &places, output)?;
            if exported == Export::Done {
                report_wallet_warnings(&found.phrases);
            }
            Ok(exported)
        }
    }
}

/// The places of the shares that the restore read.
fn restored_places(restored: &Restoring) -> &[usize] {
    match restored {
        Restoring::Phrases(at) => &at.places,
        Restoring::Few => &[],
    }
}

/// Runs the command: exports the shares given, or typed on the private screen, after repairing them
/// where marked.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    // Again for the menu, which runs the command without the command line's checks.
    assert_single_values(parsed, &REPEATABLE_OPTIONS)?;
    // Without --format each share keeps the form it is written in, so that a share repaired from its
    // marked elements comes back as it was written, whole.
    let given = value(parsed, "format")
        .map(|_| share_format(parsed))
        .transpose()?;
    let checked = export_options(parsed, given.unwrap_or(ShareFormat::Colors))?;
    // Where the shares keep their own form, which is known only once they are typed: in colors,
    // which the cards of every color form print, and in Unicode codes.
    check_share_cards_printable(checked.as_ref())?;
    if let (None, Some(cards)) = (given, &checked) {
        cards
            .check_printable(ShareFormat::Unicode)
            .map_err(|refusal| ExportError::CardsOwnForm(refusal.to_string()))?;
    }
    let settings = recovery_settings(parsed)?;
    // Refused before the shares are asked.
    if let Some(refusal) = repair_refusal(settings.mode, settings.wallet.check.is_some()) {
        return Err(ExportError::Refused(refusal.to_owned()).into());
    }
    let shares = TypedShares::read(parsed)?;
    let mut r = settings.with_shares(shares, false);
    let mut output = ExportOutput {
        given,
        checked,
        parsed: parsed.clone(),
    };
    while export_once(&mut r, &mut output)? == Export::Changed {}
    Ok(())
}
