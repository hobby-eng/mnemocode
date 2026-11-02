//! How the commands show what a search or a decoding found (MnemoCode TS 0.1.0's
//! `cli/candidate-view.ts` and `fingerprint-report.ts`): each candidate on a terminal as a part of
//! the result, its facts as grey labels with their values; a recovered phrase with its checksum and
//! its fingerprint, as labelled facts on a terminal and as plain lines for a file or a pipe.

use mnemocode::bip39::phrase::Phrase;
use mnemocode::modes::phrase_words::ORIGINAL_FINGERPRINT;
use mnemocode::wallet::evidence::MASTER_KEY_PATH;

use super::encode::fingerprint_of;
use crate::gate::Stop;
use crate::terminal::result::{
    FINGERPRINT_NOTE, part_line, plain_fingerprint_line, print, print_fingerprint, print_part,
    print_phrase,
};
use crate::terminal::{self, Channel, can_redraw, fact_line, hint_lines, status_line};

/// What a phrase whose BIP39 checksum fails says, on a terminal and in plain lines.
const CHECKSUM_INVALID: &str = "invalid — dates or input may be wrong";

/// The label of the part of candidate `number`, from 1.
pub(crate) fn candidate_label(number: u64) -> String {
    format!("Candidate {number}")
}

/// What the wallet check says of a candidate that matched, for a script.
pub(crate) fn matched_at(path: Option<&str>) -> String {
    format!("matched at {}", path.unwrap_or("requested evidence"))
}

/// What it says for a person on a terminal: a master fingerprint's match by its name, and the
/// master key's path as the BIP32 root key, which a bare "m" leaves unexplained.
pub(crate) fn matched_on_terminal(path: Option<&str>, fingerprint: bool) -> String {
    if fingerprint {
        return "master fingerprint matched".to_owned();
    }
    let at = matched_at(path);
    if path == Some(MASTER_KEY_PATH) {
        format!("{at}, the BIP32 root key")
    } else {
        at
    }
}

/// The lines of one candidate: `label`, grey, after a blank line, then its `facts`, the labels in
/// one column as wide as the longest.
pub(crate) fn candidate_lines(label: &str, facts: &[(&str, String)]) -> Vec<String> {
    let width = facts.iter().map(|(name, _)| name.len()).max().unwrap_or(0);
    let mut lines = vec![part_line(label, false, Channel::Output)];
    lines.extend(
        facts
            .iter()
            .map(|(name, value)| fact_line(Channel::Output, name, value, width)),
    );
    lines
}

/// The lines of one fingerprint under a result: on a terminal a labelled fact with its note,
/// otherwise its plain line.
pub(crate) fn report_fingerprint(label: &str, value: &str, plain: &str) -> Vec<String> {
    if !can_redraw(Channel::Error) {
        return vec![plain.to_owned()];
    }
    let mut lines = vec![status_line(label, value, true)];
    lines.extend(hint_lines(
        Channel::Error,
        &format!("Fingerprint uses an {FINGERPRINT_NOTE}."),
    ));
    lines
}

/// The fingerprint of the original phrase, under a result.
pub(crate) fn report_original_fingerprint(phrase: &Phrase) -> Result<(), Stop> {
    let fingerprint = fingerprint_of(phrase)?;
    let plain = plain_fingerprint_line(true, &fingerprint, false);
    print(
        Channel::Error,
        &report_fingerprint(ORIGINAL_FINGERPRINT, &fingerprint, &plain),
    );
    Ok(())
}

/// Whether a recovered phrase's checksum holds, then, where it does, its fingerprint.
pub(crate) fn report_checksum(phrase: Option<&Phrase>) -> Result<(), Stop> {
    let value = if phrase.is_some() {
        "valid"
    } else {
        CHECKSUM_INVALID
    };
    if can_redraw(Channel::Error) {
        terminal::error_line("");
        terminal::status("BIP39 checksum", value, phrase.is_some());
    } else {
        terminal::error_line(&format!("BIP39 checksum: {value}."));
    }
    phrase.map_or(Ok(()), report_original_fingerprint)
}

/// On a terminal: the original phrase under its label, numbered for writing down, then its
/// fingerprint; where its checksum fails, that instead. `phrase` is that of `words`, where valid.
pub(crate) fn show_original_phrase(
    words: &str,
    phrase: Option<&Phrase>,
    channel: Channel,
) -> Result<(), Stop> {
    print_part("The original seed phrase, the wallet's", true, channel);
    print_phrase(words, channel);
    print(channel, &[String::new()]);
    match phrase {
        None => terminal::status("BIP39 checksum", CHECKSUM_INVALID, false),
        Some(phrase) => print_fingerprint(
            ORIGINAL_FINGERPRINT,
            &fingerprint_of(phrase)?,
            FINGERPRINT_NOTE,
            channel,
        ),
    }
    Ok(())
}
