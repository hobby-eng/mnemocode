//! What a restore of shares shows (MnemoCode TS 0.1.0's `cli/sskr-restore-command.ts`): the phrases
//! found, each with its set, what a repair filled in and what the wallet said of it.

use std::collections::BTreeSet;
use std::rc::Rc;

use mnemocode::modes::Mode;
use mnemocode::modes::phrase_words::ORIGINAL_LABEL;
use mnemocode::recovery::shares::flow::{RestoredPhrase, match_warnings};
use mnemocode::sskr::restore::{SetBackup, ShareSet};
use mnemocode::wallet::evidence::MASTER_KEY_PATH;

use super::encode::encoded_output_label;
use super::found::{report_original_fingerprint, show_original_phrase};
use super::share_repair::report_repairs;
use super::sskr_combine::{PhrasesAt, Recovery};
use crate::gate::Stop;
use crate::terminal::result::{
    FINGERPRINT_NOTE, code_lines, print, print_fingerprint, print_part, result_header,
};
use crate::terminal::{
    Channel, Chosen, NoticeKind, can_redraw, clear_private_screen, error_line, lasting_warning,
    notice, wait_for_enter,
};

/// Where a restored phrase stands among those shown, and what was already said of its set.
struct RestoredPlace<'a> {
    index: usize,
    of: usize,
    places: &'a [usize],
    /// The wallet given, in the words of its option, which the phrase matched.
    evidence: Option<&'a str>,
    set: SetSaid,
}

/// What was said of a set before.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SetSaid {
    /// An earlier phrase of the same set told its repairs.
    Said,
    /// The screen was cleared after the notes of the shares, which are then said again.
    Cleared,
    New,
}

/// Restore's output: Re-encode uses its own terminal-only confirmation instead.
pub(crate) fn show_restored_phrases(restored: &PhrasesAt, r: &Recovery) -> Result<(), Stop> {
    let phrases = &restored.found.phrases;
    // The result is a step of its own: the questions and the search are cleared away.
    let cleared = clear_private_screen();
    if phrases.len() > 1 {
        notice(
            &format!(
                "{} phrases fit these shares. Each is listed with its fingerprint: the wallet tells which is yours.",
                phrases.len()
            ),
            NoticeKind::Warning,
        );
    }
    let mut reported: BTreeSet<*const ShareSet> = BTreeSet::new();
    let mut shown = 0;
    for (index, phrase) in phrases.iter().enumerate() {
        // The private screen keeps no scrollback: there each phrase has a screen of its own, the
        // next shown on Enter, so that none scrolls out of reach.
        if index > 0 && cleared {
            let message = format!(
                "Press Enter for phrase {} of {}; Esc ends.",
                index + 1,
                phrases.len()
            );
            match wait_for_enter(&message)? {
                Chosen::One(()) => {}
                Chosen::Back => break,
                Chosen::Cancelled => return Err(Stop::Cancelled),
            }
            clear_private_screen();
        }
        let set = Rc::as_ptr(&phrase.unmasked.set);
        let said = if cleared {
            SetSaid::Cleared
        } else if reported.contains(&set) {
            SetSaid::Said
        } else {
            SetSaid::New
        };
        show_restored(
            phrase,
            r.mode,
            &RestoredPlace {
                index,
                of: phrases.len(),
                places: &restored.places,
                evidence: r.wallet.label.as_deref(),
                set: said,
            },
        )?;
        reported.insert(set);
        shown += 1;
    }
    report_wallet_warnings(&phrases[..shown]);
    Ok(())
}

/// What the wallet check said of the matches of `phrases`, each warning once, said after them.
pub(crate) fn report_wallet_warnings(phrases: &[RestoredPhrase]) {
    for warning in match_warnings(phrases) {
        lasting_warning(warning);
    }
}

/// Prints one restored phrase: what the repair of its set filled in, the backup in the form of its
/// shares, and the phrase with its dates and fingerprint. On a terminal each part stands apart under
/// its own label, the phrase numbered for writing down; elsewhere the plain lines.
fn show_restored(
    phrase: &RestoredPhrase,
    mode: Mode,
    place: &RestoredPlace<'_>,
) -> Result<(), Stop> {
    if can_redraw(Channel::Output) {
        show_restored_parts(phrase, mode, place)
    } else {
        show_restored_plain(phrase, mode, place)
    }
}

/// What is said of a set before its first phrase: a share that took no part, and the repairs; with
/// `spaced`, after a blank line when there is something to say.
fn report_set(phrase: &RestoredPhrase, place: &RestoredPlace<'_>, spaced: bool) {
    if place.set == SetSaid::Said {
        return;
    }
    let set = &phrase.unmasked.set;
    // Said before the dates too, on the screen cleared since.
    let unchecked = (place.set == SetSaid::Cleared)
        .then(|| set.unchecked_note(Some(place.places)))
        .flatten();
    if spaced && (unchecked.is_some() || !phrase.repairs.is_empty()) {
        error_line("");
    }
    if let Some(unchecked) = &unchecked {
        lasting_warning(unchecked);
    }
    report_repairs(set.shares(), set.unsettled(), Some(place.places));
}

/// ", phrase 2 of 3" after a heading when several phrases are shown.
fn numbered_of(place: &RestoredPlace<'_>) -> String {
    if place.of > 1 {
        format!(", phrase {} of {}", place.index + 1, place.of)
    } else {
        String::new()
    }
}

/// "matches the address at m/84'/0'/0'/0/3", for the wallet fact.
fn wallet_fact(phrase: &RestoredPhrase, place: &RestoredPlace<'_>) -> Option<String> {
    let evidence = place.evidence?;
    // The master key's path says nothing that the fact does not.
    let at = phrase
        .unmasked
        .matched_at
        .as_deref()
        .filter(|path| *path != MASTER_KEY_PATH)
        .map_or_else(String::new, |path| format!(" at {path}"));
    Some(format!("matches the {evidence}{at}"))
}

/// The backup under the label of its form, none where it would repeat the original phrase.
fn restored_backup(phrase: &RestoredPhrase, mode: Mode) -> Option<(String, &SetBackup)> {
    let backup = phrase.backup.as_ref()?;
    Some((encoded_output_label(backup.form, mode), backup))
}

/// A restored phrase on a terminal: the heading with the mode, the dates and the wallet; the
/// repairs; the masked phrase with its encoded fingerprint, grey; then, in bold, the original seed
/// phrase numbered for writing down, and its fingerprint.
fn show_restored_parts(
    phrase: &RestoredPhrase,
    mode: Mode,
    place: &RestoredPlace<'_>,
) -> Result<(), Stop> {
    let mut facts = vec![("Mode", mode.id().to_owned())];
    if let Some(dates) = &phrase.unmasked.dates {
        facts.push(("Dates", dates.as_str().to_owned()));
    }
    if let Some(wallet) = wallet_fact(phrase, place) {
        facts.push(("Wallet", wallet));
    }
    let title = format!("Restored from shares{}", numbered_of(place));
    result_header(&title, &facts, Channel::Output);
    report_set(phrase, place, true);
    if let Some((label, backup)) = restored_backup(phrase, mode) {
        print_part(&label, false, Channel::Output);
        // Codes written joined apart, beside the joined text; other forms wrapped at their spaces.
        print(
            Channel::Output,
            &code_lines(backup.text.as_str(), backup.form),
        );
        // Only a masked phrase has a fingerprint of its own; another form is the phrase below.
        if mode.masked()
            && let Some(bytes) = phrase.unmasked.set.fingerprint()
        {
            print_fingerprint(
                mode.encoded_fingerprint_label(),
                &mnemocode::bip32::fingerprint_hex(bytes),
                FINGERPRINT_NOTE,
                Channel::Output,
            );
        }
    }
    let text = phrase.unmasked.phrase.text();
    show_original_phrase(
        text.as_str(),
        Some(&phrase.unmasked.phrase),
        Channel::Output,
    )
}

/// A restored phrase as plain lines, for a file, a pipe or TERM=dumb.
fn show_restored_plain(
    phrase: &RestoredPhrase,
    mode: Mode,
    place: &RestoredPlace<'_>,
) -> Result<(), Stop> {
    report_set(phrase, place, false);
    let ordinal = (place.of > 1).then(|| format!("phrase {} of {}", place.index + 1, place.of));
    if let Some((label, backup)) = restored_backup(phrase, mode) {
        let suffix = ordinal
            .as_ref()
            .map_or_else(String::new, |text| format!(" ({text})"));
        print(
            Channel::Output,
            &[format!("{label}{suffix}:"), backup.text.as_str().to_owned()],
        );
    }
    let dates = phrase
        .unmasked
        .dates
        .as_ref()
        .map(|dates| format!("dates {}", dates.as_str()));
    let notes: Vec<String> = ordinal.into_iter().chain(dates).collect();
    let noted = if notes.is_empty() {
        String::new()
    } else {
        format!(" ({})", notes.join(", "))
    };
    let text = phrase.unmasked.phrase.text();
    print(
        Channel::Output,
        &[
            format!("{ORIGINAL_LABEL}{noted}:"),
            text.as_str().to_owned(),
        ],
    );
    report_original_fingerprint(&phrase.unmasked.phrase)
}
