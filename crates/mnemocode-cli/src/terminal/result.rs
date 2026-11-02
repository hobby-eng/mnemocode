//! Results as the command line shows them (MnemoCode TS 0.1.0's phrase and code layouts of
//! `cli/terminal.ts` and its `fingerprint-report.ts`, CAP-CLI-RESULT-PRESENTATION): on a terminal,
//! a phrase's words numbered four to a row and the phrase on one line for copying, codes in a
//! block to save with their joined form for copying, fingerprints as status lines; for a file, a
//! pipe or TERM=dumb, each as plain lines a script reads.

use mnemocode::forms::Form;
use mnemocode::text::codes::compact_code;

use super::{
    Channel, NoticeKind, can_redraw, lasting_warning, more_line, notice, notice_lines, paint,
    result_lines, show_result, style, wrap_text,
};

/// Words a row of a phrase.
const WORDS_PER_ROW: usize = 4;
/// The letters of the longest BIP39 word, which the columns of a phrase are padded to.
const LONGEST_WORD: usize = 8;
/// Spaces between two numbered words.
const WORD_GAP: usize = 3;
/// The cells of a word's number and its point.
const NUMBER_CELL: usize = 5;
/// What every row of a phrase begins with.
const ROW_INDENT: &str = "  ";
/// What the fingerprints are computed with.
pub(crate) const FINGERPRINT_NOTE: &str = "empty BIP39 passphrase";

/// Writes `lines` to `channel`.
pub(crate) fn print(channel: Channel, lines: &[String]) {
    for line in lines {
        match channel {
            Channel::Output => super::result_line(line),
            Channel::Error => super::error_line(line),
        }
    }
}

/// The heading of a result and its facts on a terminal, marking the result as shown on the private
/// screen; whether there was a terminal to show them on.
pub(crate) fn result_header(title: &str, facts: &[(&str, String)], channel: Channel) -> bool {
    show_result();
    if !can_redraw(channel) {
        return false;
    }
    print(channel, &result_lines(channel, title, facts));
    true
}

/// The words of `phrase` numbered in rows, then the phrase on one line for copying; none where
/// `channel` is no terminal.
pub(crate) fn phrase_lines(phrase: &str, channel: Channel) -> Option<Vec<String>> {
    if !can_redraw(channel) {
        return None;
    }
    let words: Vec<&str> = phrase.split(' ').collect();
    let mut lines: Vec<String> = words
        .chunks(WORDS_PER_ROW)
        .enumerate()
        .map(|(row, items)| {
            let cells: Vec<String> = items
                .iter()
                .enumerate()
                .map(|(column, item)| {
                    let place = row * WORDS_PER_ROW + column + 1;
                    let number = paint(
                        channel,
                        style::MUTED,
                        &format!("{place:>width$}.", width = NUMBER_CELL - 2),
                    );
                    // The last item of a row needs no padding to line up the next one.
                    let padded = if column + 1 == items.len() {
                        (*item).to_owned()
                    } else {
                        format!("{item:<LONGEST_WORD$}")
                    };
                    format!("{number} {}", paint(channel, style::STRONG, &padded))
                })
                .collect();
            format!("{ROW_INDENT}{}", cells.join(&" ".repeat(WORD_GAP)))
        })
        .collect();
    lines.push(paint(channel, style::MUTED, "On one line, for copying:"));
    lines.push(phrase.to_owned());
    Some(lines)
}

/// Prints `phrase` as [`phrase_lines`] lays it out, or as it is where `channel` is no terminal.
pub(crate) fn print_phrase(phrase: &str, channel: Channel) {
    print(
        channel,
        &phrase_lines(phrase, channel).unwrap_or_else(|| vec![phrase.to_owned()]),
    );
}

/// The codes `text` of `form` wrapped, apart where the form writes them joined, and their joined
/// form for copying.
fn code_parts(text: &str, form: Form) -> (Vec<String>, Vec<String>) {
    let apart = form.apart_codes(text).ok().flatten();
    let shown = apart
        .as_ref()
        .map_or_else(|| text.to_owned(), |codes| codes.join(" "));
    let data = wrap_text(&shown, super::TEXT_WIDTH)
        .iter()
        .map(|line| paint(Channel::Output, style::STRONG, line))
        .collect();
    let copy = if apart.is_some() {
        vec![
            paint(Channel::Output, style::MUTED, "Joined, for copying:"),
            paint(Channel::Output, style::STRONG, &compact_code(text)),
        ]
    } else {
        Vec::new()
    };
    (data, copy)
}

/// Codes as a result shows them: wrapped on a terminal, with their joined form; as they are
/// otherwise.
pub(crate) fn code_lines(text: &str, form: Form) -> Vec<String> {
    if !can_redraw(Channel::Output) {
        return vec![text.to_owned()];
    }
    let (mut data, copy) = code_parts(text, form);
    data.extend(copy);
    data
}

/// The codes of a backup or a share, `kind`, in the block to save: a heading, the codes in order
/// and where they end, then their joined form; as they are where standard output is no terminal.
pub(crate) fn backup_code_lines(text: &str, form: Form, kind: &str) -> Vec<String> {
    if !can_redraw(Channel::Output) {
        return vec![text.to_owned()];
    }
    let (data, copy) = code_parts(text, form);
    let mut lines = vec![
        String::new(),
        paint(
            Channel::Output,
            style::HEADING,
            &format!("SAVE THIS {}", kind.to_uppercase()),
        ),
        paint(
            Channel::Output,
            style::STRONG,
            "Copy the entire block below in this exact order.",
        ),
    ];
    lines.extend(data);
    lines.push(paint(
        Channel::Output,
        style::MUTED,
        &format!("End of {kind}."),
    ));
    lines.extend(copy);
    lines.push(String::new());
    lines
}

/// The label of a part of a result, after a blank line: bold where `strong`, otherwise grey.
pub(crate) fn part_line(label: &str, strong: bool, channel: Channel) -> String {
    let code = if strong { style::STRONG } else { style::MUTED };
    format!("\n{}", paint(channel, code, label))
}

/// Writes the label of a part of a result.
pub(crate) fn print_part(label: &str, strong: bool, channel: Channel) {
    print(channel, &[part_line(label, strong, channel)]);
}

/// A fingerprint on one line: its label, its value and its note.
pub(crate) fn print_fingerprint(label: &str, value: &str, note: &str, channel: Channel) {
    let line = format!(
        "{}  {}  {}",
        paint(channel, style::MUTED, label),
        paint(channel, style::STRONG, value),
        paint(channel, style::MUTED, &format!("({note})"))
    );
    print(channel, &[line]);
}

/// A note after a result: a notice, a warning that still holds once the command has ended, or a
/// link to read more.
pub(crate) enum ResultNote {
    Notice(String, NoticeKind),
    Lasting(String),
    More(&'static str),
}

/// The lines that [`print_note`] writes, for a check of the room on the screen.
pub(crate) fn note_lines(note: &ResultNote) -> Vec<String> {
    match note {
        ResultNote::Notice(text, kind) => notice_lines(text, *kind),
        ResultNote::Lasting(text) => notice_lines(text, NoticeKind::Warning),
        ResultNote::More(anchor) => vec![more_line(anchor)],
    }
}

/// Writes `note` as its kind says.
pub(crate) fn print_note(note: &ResultNote) {
    match note {
        ResultNote::Notice(text, kind) => notice(text, *kind),
        ResultNote::Lasting(text) => lasting_warning(text),
        ResultNote::More(anchor) => super::error_line(&more_line(anchor)),
    }
}

/// A fingerprint as a plain line for a script: the original's, or the encoded one, of the masked
/// phrase where `masked`.
pub(crate) fn plain_fingerprint_line(original: bool, value: &str, masked: bool) -> String {
    let phrase = if original { "Original" } else { "Encoded" };
    let of = if masked { " of the masked phrase" } else { "" };
    format!("{phrase} BIP32 master fingerprint{of} ({FINGERPRINT_NOTE}): {value}")
}

/// Running text of a secret result: wrapped on a terminal, on one line otherwise.
pub(crate) fn print_sentence(sentence: &str) {
    let channel = super::secret_channel();
    let lines = if can_redraw(channel) {
        wrap_text(sentence, super::TEXT_WIDTH)
    } else {
        vec![sentence.to_owned()]
    };
    print(channel, &lines);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fingerprint_line_names_its_phrase() {
        assert_eq!(
            plain_fingerprint_line(false, "0d05289e", true),
            "Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): 0d05289e"
        );
        assert_eq!(
            plain_fingerprint_line(true, "73c5da0a", false),
            "Original BIP32 master fingerprint (empty BIP39 passphrase): 73c5da0a"
        );
    }
}
