//! A list chosen with the arrow keys or a digit (MnemoCode TS 0.1.0's `cli/terminal-choice.ts`,
//! CAP-CLI-QUESTIONS), drawn on standard error: the question stands apart, wrapped, with a warning
//! above it and its explanation below; once it is answered, the question and its list are replaced
//! by one line, its label and the chosen entry.

use std::fmt::Display;
use std::sync::{Mutex, MutexGuard, PoisonError};

use mnemocode::secret::SecretText;
use mnemocode::text::space::trim;
use mnemocode::text::utf8::not_utf8_text;
use mnemocode::text::words::list_in_words;

use super::answer::{Hints, answer_end_row};
use super::keys::{Interrupted, Key, Keys, read_key};
use super::line::{LineOptions, LineOutcome, read_line};
use super::page::{before_question, keep_readable};
use super::{
    ANSWER_LABEL_WIDTH, Channel, ERASE_BELOW, NoticeKind, TEXT_WIDTH, beside_mark, columns,
    cursor_up, error_line, error_raw, fact_line, notice_lines, output_rows, paint, question_ended,
    rows, shown_width, step_begin, style,
};

/// Marker, number and the gaps before a label: "› 1  ".
const LABEL_INDENT: usize = 5;
/// The spaces between a label, padded to the longest one, and its grey note.
const NOTE_GAP: &str = "  ";
/// The entries that a digit chooses at once.
const DIGIT_PLACES: usize = 9;
/// Indents of an explanation and of its links under "More:".
const TEXT_INDENT: &str = "  ";
const LINK_INDENT: &str = "    ";

/// The digit that chooses an entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Digit {
    /// Its place in the list, the first nine.
    Place,
    /// A digit of its own, or none.
    Own(Option<u8>),
}

/// One entry of a list.
#[derive(Clone, Debug)]
pub(crate) struct Choice<T> {
    pub(crate) label: String,
    /// Grey text after the label.
    pub(crate) note: Option<String>,
    /// A grey second line under the note, such as an example.
    pub(crate) example: Option<String>,
    pub(crate) digit: Digit,
    pub(crate) value: T,
}

impl<T> Choice<T> {
    /// An entry of `label` without a note.
    pub(crate) fn new(label: &str, value: T) -> Self {
        Self {
            label: label.to_owned(),
            note: None,
            example: None,
            digit: Digit::Place,
            value,
        }
    }

    /// An entry of `label` with its grey `note`.
    pub(crate) fn noted(label: &str, note: &str, value: T) -> Self {
        Self {
            label: label.to_owned(),
            note: Some(note.to_owned()),
            example: None,
            digit: Digit::Place,
            value,
        }
    }

    /// The digit that chooses it at `place`.
    const fn digit_at(&self, place: usize) -> Option<u8> {
        match self.digit {
            Digit::Place if place < DIGIT_PLACES => Some(place as u8 + 1),
            Digit::Place => None,
            Digit::Own(digit) => digit,
        }
    }
}

/// Text shown between a question and its entries: short lines, and links under "More:".
#[derive(Clone, Debug, Default)]
pub(crate) struct Explanation {
    pub(crate) lines: Vec<String>,
    pub(crate) more: Vec<String>,
}

/// How a list is asked.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ListQuestion<'a> {
    pub(crate) question: &'a str,
    /// The label of the answer in the line it leaves.
    pub(crate) label: &'a str,
    /// What Escape does, for the key hint.
    pub(crate) quit: &'a str,
    pub(crate) explanation: Option<&'a Explanation>,
}

/// What a list gave.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Chosen<T> {
    /// The value of the entry chosen.
    One(T),
    /// Escape.
    Back,
    /// Ctrl+C.
    Cancelled,
}

/// The rows that `lines` take now; a line may hold line breaks.
pub(crate) fn rows_of(lines: &[String]) -> usize {
    lines
        .iter()
        .flat_map(|line| line.split('\n'))
        .map(output_rows)
        .sum()
}

/// A question as it is drawn: in bold, wrapped to TEXT_WIDTH.
fn shown_question(question: &str) -> String {
    beside_mark("", 0, question, &|line| {
        paint(Channel::Error, style::STRONG, line)
    })
    .join("\n")
}

/// `text` cut to `room` characters with "…" at the end, so that it cannot wrap the line.
fn shortened(text: &str, room: usize) -> String {
    if text.chars().count() <= room {
        return text.to_owned();
    }
    let kept: String = text.chars().take(room.saturating_sub(1)).collect();
    format!("{kept}…")
}

/// The width of the longest label of `choices`.
fn label_width<T>(choices: &[Choice<T>]) -> usize {
    choices
        .iter()
        .map(|choice| choice.label.chars().count())
        .max()
        .unwrap_or(0)
}

/// The characters that a note or an example has beside the longest label within TEXT_WIDTH; a
/// longer one is cut, which a list of the program must never need.
pub(crate) fn notes_room<T>(choices: &[Choice<T>]) -> usize {
    TEXT_WIDTH.saturating_sub(LABEL_INDENT + label_width(choices) + NOTE_GAP.len())
}

/// The lines of a list; the chosen entry has a cyan marker and a bold label. Where any entry has an
/// example, every entry reserves that second row so that their labels stand equally far apart.
fn list_lines<T>(choices: &[Choice<T>], selected: usize) -> Vec<String> {
    let channel = Channel::Error;
    let width = label_width(choices);
    let room = notes_room(choices);
    let has_examples = choices.iter().any(|choice| choice.example.is_some());
    let beside = " ".repeat(LABEL_INDENT + width + NOTE_GAP.len());
    choices
        .iter()
        .enumerate()
        .flat_map(|(index, choice)| {
            let digit = choice
                .digit_at(index)
                .map_or_else(|| " ".to_owned(), |digit| digit.to_string());
            let number = paint(channel, style::MUTED, &digit);
            let chosen = index == selected;
            let marker = if chosen {
                paint(channel, style::ACCENT, "›")
            } else {
                " ".to_owned()
            };
            let label = if chosen {
                paint(channel, style::STRONG, &choice.label)
            } else {
                choice.label.clone()
            };
            let first = match &choice.note {
                None => format!("{marker} {number}  {label}"),
                Some(note) => format!(
                    "{marker} {number}  {label}{}{NOTE_GAP}{}",
                    " ".repeat(width - choice.label.chars().count()),
                    paint(channel, style::MUTED, &shortened(note, room))
                ),
            };
            let mut rows = vec![first];
            if has_examples {
                rows.push(choice.example.as_ref().map_or_else(String::new, |example| {
                    let shown = paint(channel, style::MUTED, &shortened(example, room));
                    format!("{beside}{shown}")
                }));
            }
            rows
        })
        .collect()
}

/// The digits of a list in words: "1 to 9", or "7, 8, 9 or 0" where the entries that ask for a
/// secret are left out.
fn digits_in_words(digits: &[u8]) -> String {
    let lowest = digits.iter().copied().min().unwrap_or(0);
    let highest = digits.iter().copied().max().unwrap_or(0);
    if digits.len() == usize::from(highest - lowest) + 1 {
        format!("{lowest} to {highest}")
    } else {
        list_in_words(digits, "or")
    }
}

/// The keys of a list.
fn key_hint<T>(choices: &[Choice<T>], quit: &str) -> String {
    let digits: Vec<u8> = choices
        .iter()
        .enumerate()
        .filter_map(|(place, choice)| choice.digit_at(place))
        .collect();
    let range = if digits.len() > 1 {
        format!(" · {} at once", digits_in_words(&digits))
    } else {
        String::new()
    };
    format!("↑ ↓ choose · Enter selects{range} · Esc {quit}")
}

/// The lines of `explanation`: each indented and wrapped beside its indent, then the links under
/// "More:" and a blank line.
fn explanation_lines(explanation: Option<&Explanation>) -> Vec<String> {
    let Some(explanation) = explanation else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for line in &explanation.lines {
        if line.is_empty() {
            lines.push(String::new());
        } else {
            lines.extend(beside_mark(TEXT_INDENT, TEXT_INDENT.len(), line, &|text| {
                text.to_owned()
            }));
        }
    }
    if !explanation.more.is_empty() {
        lines.push(String::new());
        let grey = |text: &str| paint(Channel::Error, style::MUTED, text);
        lines.push(format!("{TEXT_INDENT}{}", grey("More:")));
        lines.extend(
            explanation
                .more
                .iter()
                .map(|link| format!("{LINK_INDENT}{}", grey(link))),
        );
    }
    lines.push(String::new());
    lines
}

/// The rows of the blank line and `question` that start a question.
fn question_rows(question: &str) -> usize {
    1 + rows_of(&[question.to_owned()])
}

/// The rows that a list asked so takes while it waits, the row of the cursor among them.
pub(crate) fn list_rows<T>(asked: &ListQuestion<'_>, choices: &[Choice<T>]) -> usize {
    let mut lines = vec![String::new(), shown_question(asked.question)];
    lines.extend(explanation_lines(asked.explanation));
    lines.extend(list_lines(choices, 0));
    lines.push(String::new());
    lines.push(key_hint(choices, asked.quit));
    lines.push(String::new());
    rows_of(&lines)
}

/// Moves the cursor up `rows` rows to the start of the line and clears to the end of the screen.
fn redraw_from(rows: usize) {
    if rows > 0 {
        error_raw(&format!("{}\r{ERASE_BELOW}", cursor_up(rows)));
    }
}

/// The line an answered question leaves: its label and the answer in cyan.
fn answer_line(label: &str, answer: &str) -> String {
    let shown = paint(Channel::Error, style::ACCENT, answer);
    fact_line(Channel::Error, label, &shown, ANSWER_LABEL_WIDTH)
}

/// The record of the answers on the screen: the lines written since it started, and how far down
/// it and the questions below it have reached, in rows from its first row to the cursor's. Where
/// that is more than the terminal has, the rows that went over its top edge are out of reach.
struct AnswerRecord {
    lines: Vec<(String, String)>,
    reached: usize,
    /// The menu heading directly above the record; zero after output from a command.
    heading_rows: usize,
    /// A width change makes the old heading's cursor position uncertain.
    heading_columns: usize,
}

static RECORD: Mutex<AnswerRecord> = Mutex::new(AnswerRecord {
    lines: Vec::new(),
    reached: 1,
    heading_rows: 0,
    heading_columns: 0,
});

/// The record; a poisoned lock holds labels and answers, which stay usable.
fn record() -> MutexGuard<'static, AnswerRecord> {
    RECORD.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The lines of the record as the screen shows them.
fn shown_answers(lines: &[(String, String)]) -> Vec<String> {
    lines
        .iter()
        .map(|(label, answer)| answer_line(label, answer))
        .collect()
}

/// Starts the record on the row of the cursor, below what the screen shows already.
pub(crate) fn start_answer_record() {
    let mut record = record();
    record.lines.clear();
    record.reached = 1;
    record.heading_rows = 0;
    record.heading_columns = 0;
}

/// A place in the record, for [`redraw_answer_record`].
pub(crate) fn answer_mark() -> usize {
    record().lines.len()
}

/// Writes one line of the record: the `label` of a question and the `answer` given.
fn write_answer(label: &str, answer: &str) {
    error_line(&answer_line(label, answer));
    record().lines.push((label.to_owned(), answer.to_owned()));
    reach_answers(1);
}

/// Notes that the screen shows `below` rows under the record, the cursor's included.
fn reach_answers(below: usize) {
    let mut record = record();
    let reached = rows_of(&shown_answers(&record.lines)) + below;
    record.reached = record.reached.max(reached);
}

/// Replaces only the menu heading and keeps the first `keep` non-secret answers. If the old
/// heading has scrolled away or the terminal width changed, appends a new block instead: clearing
/// the whole main screen would erase the completed command's summary above the menu (CORE-39).
pub(crate) fn redraw_answer_record(heading: &[String], keep: usize) {
    let (old_rows, heading_rows, reached, heading_columns, kept) = {
        let mut record = record();
        let old_rows = rows_of(&shown_answers(&record.lines));
        record.lines.truncate(keep);
        (
            old_rows,
            record.heading_rows,
            record.reached,
            record.heading_columns,
            record.lines.clone(),
        )
    };
    if heading_rows > 0 && heading_columns == columns() && heading_rows + reached <= rows() {
        redraw_from(heading_rows + old_rows);
    }
    for line in heading {
        error_line(line);
    }
    for line in shown_answers(&kept) {
        error_line(&line);
    }
    let mut record = record();
    record.reached = rows_of(&shown_answers(&kept)) + 1;
    record.heading_rows = rows_of(heading);
    record.heading_columns = columns();
}

/// Asks `asked` with `warning` above it, and lets the person choose an entry with the arrow keys
/// and Enter, or at once with its digit. Only keys pressed for it answer it.
pub(crate) fn choose<T: Clone>(
    asked: &ListQuestion<'_>,
    warning: Option<&str>,
    choices: &[Choice<T>],
) -> Result<Chosen<T>, Interrupted> {
    choose_from(asked, warning, choices, 0)
}

/// [`choose`] with the entry at `initial` selected.
pub(crate) fn choose_from<T: Clone>(
    asked: &ListQuestion<'_>,
    warning: Option<&str>,
    choices: &[Choice<T>],
    initial: usize,
) -> Result<Chosen<T>, Interrupted> {
    let warned = warning.map_or_else(Vec::new, |text| notice_lines(text, NoticeKind::Warning));
    let hint = paint(Channel::Error, style::MUTED, &key_hint(choices, asked.quit));
    let explanation = explanation_lines(asked.explanation);
    let question = shown_question(asked.question);
    let rows = list_rows(asked, choices) + rows_of(&warned);
    if !before_question(rows)? {
        return Ok(Chosen::Cancelled);
    }
    step_begin();
    let mut keys = Keys::open();
    error_raw("\n");
    for line in &warned {
        error_line(line);
    }
    error_line(&question);
    let mut selected = initial;
    // Counted at the width of each drawing: a resize moves the rows.
    let above = || rows_of(&warned) + question_rows(&question);
    let draw = |selected: usize| {
        let mut lines = explanation.clone();
        lines.extend(list_lines(choices, selected));
        lines.push(String::new());
        lines.push(hint.clone());
        error_raw(&format!("{}\n", lines.join("\n")));
        reach_answers(above() + rows_of(&lines) + 1);
        lines
    };
    let mut drawn = draw(selected);
    loop {
        let index = match read_key(&mut keys)? {
            Key::Cancel => return Ok(Chosen::Cancelled),
            Key::Back => {
                redraw_from(rows_of(&drawn) + above());
                question_ended();
                return Ok(Chosen::Back);
            }
            Key::Enter => selected,
            Key::Digit(digit) => {
                let chosen =
                    (0..choices.len()).find(|&place| choices[place].digit_at(place) == Some(digit));
                let Some(chosen) = chosen else {
                    continue;
                };
                chosen
            }
            key @ (Key::Up | Key::Down) => {
                let count = choices.len();
                selected = if key == Key::Up {
                    (selected + count - 1) % count
                } else {
                    (selected + 1) % count
                };
                redraw_from(rows_of(&drawn));
                drawn = draw(selected);
                continue;
            }
            _ => continue,
        };
        redraw_from(rows_of(&drawn) + above());
        write_answer(asked.label, &choices[index].label);
        // The lines kept for this question go with its answer.
        question_ended();
        return Ok(Chosen::One(choices[index].value.clone()));
    }
}

/// The line after an empty answer: what to type, and how the question is left instead.
pub(crate) fn type_hint(what: Option<&str>, leave: &str) -> String {
    let what = what.unwrap_or("an answer");
    let how = if leave == "stop" {
        "press Ctrl+C to stop"
    } else {
        "press Esc to go back"
    };
    format!("Type {what}, or {how}.")
}

/// How [`ask_line`] asks.
#[derive(Clone, Copy, Default)]
pub(crate) struct LineQuestion<'a> {
    /// What Enter alone takes, which the prompt names.
    pub(crate) fallback: Option<&'a str>,
    /// What Enter alone leaves out, which the prompt names; the answer is then empty.
    pub(crate) optional: Option<&'a str>,
    /// What to type, for the line after an empty answer.
    pub(crate) what: Option<&'a str>,
    /// Why the question is asked, above it.
    pub(crate) warning: Option<&'a str>,
    /// The longest answer in bytes.
    pub(crate) limit: usize,
    /// Hints below the words being typed.
    pub(crate) hints: Option<&'a dyn Hints>,
}

/// What one asking of a line question gave.
enum LineStep {
    Answer(String),
    Back,
    Cancelled,
    Refused(String),
}

/// One asking of [`ask_line`]'s question, `shown` as its prompt.
fn ask_line_once<E: Display>(
    shown: &str,
    label: &str,
    how: &LineQuestion<'_>,
    warning: Option<&str>,
    check: &mut impl FnMut(&str) -> Result<String, E>,
) -> Result<LineStep, Interrupted> {
    let prompt_width = shown_width(shown);
    let warned = warning.map_or_else(Vec::new, |text| notice_lines(text, NoticeKind::Warning));
    let mut above = vec![String::new()];
    above.extend(warned.iter().cloned());
    above.push(shown.to_owned());
    if !before_question(rows_of(&above))? {
        return Ok(LineStep::Cancelled);
    }
    step_begin();
    let mut keys = Keys::open();
    error_raw("\n");
    for line in &warned {
        error_line(line);
    }
    write_prompt(shown);
    let outcome = read_line(
        &mut keys,
        &LineOptions {
            echo: true,
            limit: how.limit,
            escape_goes_back: true,
            prompt_width,
            pasted_line_break: None,
            hints: how.hints,
        },
    )?;
    let end_of = |answer: &str| answer_end_row(prompt_width, answer, columns());
    let erase = |end_row: usize| {
        let rows = 1 + rows_of(&warned) + end_row;
        reach_answers(rows + 1);
        redraw_from(rows);
    };
    let text = match outcome {
        LineOutcome::Cancelled => return Ok(LineStep::Cancelled),
        LineOutcome::Back { row } => {
            erase(row);
            return Ok(LineStep::Back);
        }
        LineOutcome::Ended => {
            erase(end_of(""));
            return Ok(LineStep::Back);
        }
        LineOutcome::Refused { reason, row } => {
            erase(row);
            return Ok(LineStep::Refused(reason.message()));
        }
        LineOutcome::Answer(bytes) => {
            let row = end_of(&String::from_utf8_lossy(&bytes));
            match SecretText::from_bytes(bytes) {
                Ok(text) => text,
                Err(_) => {
                    erase(row);
                    return Ok(LineStep::Refused(not_utf8_text("The answer")));
                }
            }
        }
    };
    erase(end_of(&text));
    let typed = trim(&text);
    let entered = if !typed.is_empty() {
        typed
    } else if let Some(left_out) = how.optional {
        write_answer(label, left_out);
        return Ok(LineStep::Answer(String::new()));
    } else if let Some(fallback) = how.fallback {
        fallback
    } else {
        return Ok(LineStep::Refused(type_hint(how.what, "back")));
    };
    Ok(match check(entered) {
        Ok(accepted) => {
            write_answer(label, &accepted);
            LineStep::Answer(accepted)
        }
        Err(reason) => LineStep::Refused(reason.to_string()),
    })
}

/// Asks for a visible answer, such as a file name, until `check` accepts it: Enter alone takes the
/// fallback or leaves out an optional answer, and asks again with a hint where there is neither.
/// The question goes once it is answered or left, and the answer becomes a line of the record of
/// answers under `label`.
pub(crate) fn ask_line<E: Display>(
    question: &str,
    label: &str,
    how: LineQuestion<'_>,
    mut check: impl FnMut(&str) -> Result<String, E>,
) -> Result<Chosen<String>, Interrupted> {
    let shown = match how.fallback.or(how.optional) {
        None => format!("{question}: "),
        Some(enter) => format!("{question} (Enter: {enter}): "),
    };
    let mut warning = how.warning.map(str::to_owned);
    loop {
        match ask_line_once(&shown, label, &how, warning.as_deref(), &mut check)? {
            LineStep::Back => {
                question_ended();
                return Ok(Chosen::Back);
            }
            LineStep::Answer(answer) => {
                question_ended();
                return Ok(Chosen::One(answer));
            }
            LineStep::Cancelled => return Ok(Chosen::Cancelled),
            LineStep::Refused(reason) => warning = Some(reason),
        }
    }
}

/// Writes `text` as a question asks it: strong, what stands in brackets muted.
pub(crate) fn write_prompt(text: &str) {
    let split = [" (", " ["]
        .iter()
        .filter_map(|opening| text.find(opening))
        .min()
        .unwrap_or(text.len());
    let (question, notes) = text.split_at(split);
    error_raw(&format!(
        "{}{}",
        paint(Channel::Error, style::STRONG, question),
        paint(Channel::Error, style::MUTED, notes)
    ));
}

/// Waits for Enter after `message`: `Chosen::One(())`, or `Chosen::Back` for Escape. Only keys
/// pressed after the message shows count: a second Enter, pressed while a result was being worked
/// out, would otherwise clear the screen with the result before it was read.
pub(crate) fn wait_for_enter(message: &str) -> Result<Chosen<()>, Interrupted> {
    wait_after(message, Keys::open())
}

/// [`wait_for_enter`] where only Escape leaves: q or the rest of a paste meant for a command never
/// dismisses its result.
pub(crate) fn wait_for_enter_or_escape(message: &str) -> Result<Chosen<()>, Interrupted> {
    let mut keys = Keys::open();
    keys.only_escape_leaves();
    wait_after(message, keys)
}

/// Waits for Enter with `keys`.
fn wait_after(message: &str, mut keys: Keys) -> Result<Chosen<()>, Interrupted> {
    if !keep_readable(rows_of(&[message.to_owned()]))? {
        return Ok(Chosen::Cancelled);
    }
    write_prompt(message);
    loop {
        let key = read_key(&mut keys)?;
        if matches!(key, Key::Enter | Key::Back | Key::Cancel) {
            // The key itself was not shown.
            error_raw("\n");
        }
        match key {
            Key::Enter => return Ok(Chosen::One(())),
            Key::Back => return Ok(Chosen::Back),
            Key::Cancel => return Ok(Chosen::Cancelled),
            _ => {}
        }
    }
}
