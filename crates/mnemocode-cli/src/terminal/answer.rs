//! An answer as the line editor edits it (MnemoCode TS 0.1.0's `typed-answer.ts`): its bytes in a
//! locked buffer reserved at the question's limit and never grown, wiped when done; the cursor,
//! always at the start of a character; and, for a visible answer, what the terminal shows, which
//! wraps a long answer onto further rows, a wide character whole onto the next, and the hint for the
//! word being typed below it.

use mnemocode::secret::SecretBytes;
use mnemocode::text::utf8::strict_utf8;
use mnemocode::text::widths::cell_width;

use super::keys::{EditKey, key};
use super::{ERASE_BELOW, cursor_down, cursor_right, cursor_up, error_raw};

/// Hints for the word being typed, shown below a visible answer, and Tab's completion.
pub(crate) trait Hints {
    /// The rows of the hint for `typed`, the words before the cursor, on a terminal `columns` wide;
    /// none for no hint.
    fn rows(&self, typed: &str, columns: usize) -> Vec<String>;
    /// The letters that every word beginning like the typed one has next, and whether one word is
    /// left, after which a space goes.
    fn completion(&self, typed: &str) -> (String, bool);
}

/// Why a question cannot use an answer: longer than its limit, or not UTF-8.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Unusable {
    /// Longer than `limit` bytes.
    TooLong(usize),
    /// Bytes of no UTF-8 character.
    NotUtf8,
}

impl Unusable {
    /// The refusal, which says why without repeating the answer.
    pub(crate) fn message(self) -> String {
        match self {
            Self::TooLong(limit) => {
                format!("An answer is longer than {limit} bytes; no valid answer is that long.")
            }
            Self::NotUtf8 => mnemocode::text::utf8::not_utf8_text("The answer"),
        }
    }
}

/// The words that a hint is given: the word being typed and three before it.
const HINT_CONTEXT_WORDS: usize = 4;

/// Whether `byte` continues a UTF-8 character rather than starting one.
const fn is_continuation(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

/// The bytes of the UTF-8 character that `first` starts, at least one, so that a step always moves.
const fn character_size(first: u8) -> usize {
    match first {
        0x00..=0x7f => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => 1,
    }
}

/// The cells of the UTF-8 character at `index` of `size` bytes (the library's widths); one for
/// bytes that are no character.
fn width_at(line: &[u8], index: usize, size: usize) -> usize {
    line.get(index..index + size)
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .and_then(|text| text.chars().next())
        .map_or(1, cell_width)
}

/// The cells of the UTF-8 text between `from` and `to`.
fn width_of(line: &[u8], from: usize, to: usize) -> usize {
    let mut width = 0;
    let mut index = from;
    while index < to {
        let size = character_size(line.get(index).copied().unwrap_or(0));
        width += width_at(line, index, size);
        index += size;
    }
    width
}

/// Where a terminal `columns` wide puts the cursor after the characters between `from` and `to`,
/// written from `offset`: a wide character that does not fit at the end of a row goes whole to
/// the next (xterm, VTE, Konsole, Windows Terminal and tmux).
pub(super) fn placed_after(
    line: &[u8],
    from: usize,
    to: usize,
    offset: usize,
    columns: usize,
) -> usize {
    let mut end = offset;
    let mut index = from;
    while index < to {
        let size = character_size(line.get(index).copied().unwrap_or(0));
        if index + size > to {
            break;
        }
        let width = width_at(line, index, size);
        let column = end % columns;
        if column > 0 && column + width > columns {
            end += columns - column;
        }
        end += width;
        index += size;
    }
    end
}

fn previous_character(line: &[u8], position: usize) -> usize {
    let mut start = position;
    while start > 0
        && line
            .get(start - 1)
            .is_some_and(|&byte| is_continuation(byte))
    {
        start -= 1;
    }
    start.saturating_sub(1)
}

fn next_character(line: &[u8], position: usize, length: usize) -> usize {
    let mut end = position + 1;
    while end < length && line.get(end).is_some_and(|&byte| is_continuation(byte)) {
        end += 1;
    }
    end.min(length)
}

fn previous_word(line: &[u8], position: usize) -> usize {
    let mut start = position;
    while start > 0 && line.get(start - 1) == Some(&key::SPACE) {
        start -= 1;
    }
    while start > 0 && line.get(start - 1) != Some(&key::SPACE) {
        start -= 1;
    }
    start
}

fn next_word(line: &[u8], position: usize, length: usize) -> usize {
    let mut end = position;
    while end < length && line.get(end) == Some(&key::SPACE) {
        end += 1;
    }
    while end < length && line.get(end) != Some(&key::SPACE) {
        end += 1;
    }
    end
}

/// Whether the bytes up to `length` end with a complete UTF-8 character.
fn is_character_end(line: &[u8], length: usize) -> bool {
    let mut start = length.saturating_sub(1);
    while start > 0 && line.get(start).is_some_and(|&byte| is_continuation(byte)) {
        start -= 1;
    }
    length - start == character_size(line.get(start).copied().unwrap_or(0))
}

/// An answer as it is typed.
pub(crate) struct TypedAnswer<'h> {
    line: SecretBytes,
    length: usize,
    cursor: usize,
    shown: Option<ShownLine>,
    hints: Option<&'h dyn Hints>,
    hint_due: bool,
}

impl<'h> TypedAnswer<'h> {
    /// An answer of at most `limit` bytes, shown after a prompt `prompt_width` wide when `echo`
    /// says so, with `hints` below it.
    pub(crate) fn new(
        limit: usize,
        echo: bool,
        prompt_width: usize,
        hints: Option<&'h dyn Hints>,
    ) -> Self {
        Self {
            line: SecretBytes::zeroed("an answer", limit),
            length: 0,
            cursor: 0,
            shown: echo.then(|| ShownLine::new(prompt_width)),
            hints: if echo { hints } else { None },
            hint_due: false,
        }
    }

    pub(crate) const fn len(&self) -> usize {
        self.length
    }

    pub(crate) const fn cursor(&self) -> usize {
        self.cursor
    }

    pub(crate) fn hints(&self) -> Option<&'h dyn Hints> {
        self.hints
    }

    /// The row of the cursor below the first row of the prompt, where the answer shows.
    pub(crate) fn row_from_prompt(&self) -> usize {
        self.shown.as_ref().map_or(0, ShownLine::row_from_prompt)
    }

    /// The byte before the cursor.
    pub(crate) fn before(&self) -> Option<u8> {
        self.cursor
            .checked_sub(1)
            .and_then(|at| self.line.get(at).copied())
    }

    /// Inserts `byte` at the cursor; refused past the limit.
    pub(crate) fn insert(&mut self, byte: u8) -> Result<(), Unusable> {
        if self.length == self.line.len() {
            return Err(Unusable::TooLong(self.line.len()));
        }
        self.line
            .copy_within(self.cursor..self.length, self.cursor + 1);
        if let Some(slot) = self.line.get_mut(self.cursor) {
            *slot = byte;
        }
        self.cursor += 1;
        self.length += 1;
        self.hint_due = self.hints.is_some();
        // A character of several bytes is shown once it is complete.
        if is_character_end(&self.line, self.cursor) {
            let at_end = self.cursor == self.length;
            if let Some(shown) = &mut self.shown {
                shown.update(&self.line, self.length, self.cursor, at_end);
            }
        }
        Ok(())
    }

    fn remove(&mut self, from: usize, to: usize) {
        self.line.copy_within(to..self.length, from);
        let removed = to - from;
        self.length -= removed;
        if let Some(tail) = self.line.get_mut(self.length..self.length + removed) {
            tail.fill(0);
        }
        self.cursor = from;
        self.hint_due = self.hints.is_some();
        if let Some(shown) = &mut self.shown {
            shown.update(&self.line, self.length, self.cursor, false);
        }
    }

    fn move_to(&mut self, position: usize) {
        self.cursor = position;
        self.hint_due = self.hints.is_some();
        if let Some(shown) = &mut self.shown {
            shown.update(&self.line, self.length, self.cursor, false);
        }
    }

    /// As End would; nothing is drawn when the cursor is there already.
    pub(crate) fn move_to_end(&mut self) {
        if self.cursor != self.length {
            self.move_to(self.length);
        }
        if let Some(shown) = &mut self.shown {
            shown.settle_marks();
        }
    }

    /// Moves the cursor or deletes as `edit` says.
    pub(crate) fn edit(&mut self, edit: EditKey) {
        let (cursor, length) = (self.cursor, self.length);
        match edit {
            EditKey::Left if cursor > 0 => self.move_to(previous_character(&self.line, cursor)),
            EditKey::Right if cursor < length => {
                self.move_to(next_character(&self.line, cursor, length));
            }
            EditKey::WordLeft => self.move_to(previous_word(&self.line, cursor)),
            EditKey::WordRight => self.move_to(next_word(&self.line, cursor, length)),
            EditKey::Home => self.move_to(0),
            EditKey::End => self.move_to(length),
            EditKey::Delete if cursor < length => {
                self.remove(cursor, next_character(&self.line, cursor, length));
            }
            _ => {}
        }
    }

    /// Edits with a control key that deletes or moves: whether `byte` was one.
    pub(crate) fn control(&mut self, byte: u8) -> bool {
        let (cursor, length) = (self.cursor, self.length);
        match byte {
            key::BACKSPACE | key::DELETE => {
                if cursor > 0 {
                    self.remove(previous_character(&self.line, cursor), cursor);
                }
            }
            key::CTRL_U => {
                if cursor > 0 {
                    self.remove(0, cursor);
                }
            }
            key::CTRL_A => self.move_to(0),
            key::CTRL_E => self.move_to(length),
            key::CTRL_K => {
                if cursor < length {
                    self.remove(cursor, length);
                }
            }
            key::CTRL_W => {
                if cursor > 0 {
                    self.remove(previous_word(&self.line, cursor), cursor);
                }
            }
            _ => return false,
        }
        true
    }

    /// The words before the cursor that the hint and Tab are about, while the cursor ends a word;
    /// otherwise none. No more of the answer, which may be a secret, becomes a string.
    fn typed_before(&self) -> String {
        if self.cursor < self.length && self.line.get(self.cursor) != Some(&key::SPACE) {
            return String::new();
        }
        let mut start = self.cursor;
        for _ in 0..HINT_CONTEXT_WORDS {
            if start == 0 {
                break;
            }
            start = previous_word(&self.line, start);
        }
        self.line
            .get(start..self.cursor)
            .and_then(|bytes| std::str::from_utf8(bytes).ok())
            .map(str::to_owned)
            .unwrap_or_default()
    }

    /// Tab: completes the word being typed as far as the words beginning like it agree.
    pub(crate) fn complete(&mut self, hints: &dyn Hints) -> Result<(), Unusable> {
        let (letters, word_ends) = hints.completion(&self.typed_before());
        for byte in letters.bytes() {
            self.insert(byte)?;
        }
        if !word_ends {
            return Ok(());
        }
        if self.cursor < self.length && self.line.get(self.cursor) == Some(&key::SPACE) {
            self.move_to(self.cursor + 1);
            Ok(())
        } else {
            self.insert(key::SPACE)
        }
    }

    /// Draws the hint below the answer when it is behind and `quiet` says no key follows at once.
    pub(crate) fn hint_when(&mut self, quiet: impl FnOnce() -> bool) {
        if !self.hint_due || !quiet() {
            return;
        }
        let typed = self.typed_before();
        if let (Some(hints), Some(shown)) = (self.hints, &mut self.shown) {
            let rows = hints.rows(&typed, shown.columns);
            shown.show_hint(&self.line, &rows, self.length, self.cursor);
        }
        self.hint_due = false;
    }

    /// The answer, in a locked buffer at its length; refused when it is not UTF-8.
    pub(crate) fn take(&self) -> Result<SecretBytes, Unusable> {
        let bytes = self.line.get(..self.length).unwrap_or_default();
        strict_utf8(bytes, "The answer").map_err(|_| Unusable::NotUtf8)?;
        Ok(SecretBytes::copy_of("an answer", bytes))
    }
}

impl Drop for TypedAnswer<'_> {
    /// Clears the hint; the answer's buffer wipes itself.
    fn drop(&mut self) {
        if let Some(shown) = &mut self.shown {
            shown.clear_hint(&self.line, self.length);
        }
    }
}

/// The visible answer on the terminal: every change but typing at the end redraws it from its
/// first row with relative moves only, so that it stays right when the screen scrolls.
struct ShownLine {
    columns: usize,
    start: usize,
    prompt_rows: usize,
    cursor_row: usize,
    counted_bytes: usize,
    counted_end: usize,
    last_base: Option<usize>,
    marks_at_edge: bool,
    hint_shown: bool,
}

impl ShownLine {
    fn new(prompt_width: usize) -> Self {
        let columns = super::columns().max(1);
        let start = prompt_width % columns;
        // A prompt that ends at the right edge leaves the cursor waiting there; this settles it.
        if prompt_width > 0 && start == 0 {
            error_raw("\r\n");
        }
        Self {
            columns,
            start,
            prompt_rows: prompt_width / columns,
            cursor_row: 0,
            counted_bytes: 0,
            counted_end: start,
            last_base: None,
            marks_at_edge: false,
            hint_shown: false,
        }
    }

    fn row_from_prompt(&self) -> usize {
        self.prompt_rows + self.cursor_row
    }

    fn update(&mut self, line: &[u8], length: usize, cursor: usize, typed_at_end: bool) {
        if typed_at_end {
            self.append(line, length, cursor);
            return;
        }
        self.settle_marks();
        error_raw(&format!(
            "{}\r{}{ERASE_BELOW}",
            cursor_up(self.cursor_row),
            cursor_right(self.start)
        ));
        self.hint_shown = false;
        let _ignored = crate::os::write_error(line.get(..length).unwrap_or_default());
        self.counted_bytes = 0;
        self.counted_end = self.start;
        self.last_base = None;
        let end = self.end_of(line, length);
        let end_row = self.settle(end);
        let target = self.cell_of(line, cursor, length);
        let row = target / self.columns;
        error_raw(&format!(
            "{}\r{}",
            cursor_up(end_row.saturating_sub(row)),
            cursor_right(target % self.columns)
        ));
        self.cursor_row = row;
    }

    /// Adds only new bytes; a nonspacing mark after an edge wrap redraws its base once.
    fn append(&mut self, line: &[u8], length: usize, cursor: usize) {
        let before = self.counted_end;
        let end = self.end_of(line, length);
        if end == before
            && end > 0
            && end.is_multiple_of(self.columns)
            && let Some(base) = self.last_base
        {
            {
                if self.marks_at_edge {
                    let from = previous_character(line, cursor);
                    let _ignored =
                        crate::os::write_error(line.get(from..cursor).unwrap_or_default());
                } else {
                    let base_end = next_character(line, base, length);
                    let column = (end - width_of(line, base, base_end)) % self.columns;
                    error_raw(&format!("{}\r{}", cursor_up(1), cursor_right(column)));
                    let _ignored =
                        crate::os::write_error(line.get(base..length).unwrap_or_default());
                    self.marks_at_edge = true;
                }
                return;
            }
        }
        let from = previous_character(line, cursor);
        let _ignored = crate::os::write_error(line.get(from..cursor).unwrap_or_default());
        self.marks_at_edge = false;
        self.cursor_row = self.settle(end);
    }

    fn settle_marks(&mut self) {
        if self.marks_at_edge {
            error_raw("\r\n");
            self.marks_at_edge = false;
        }
    }

    fn show_hint(&mut self, line: &[u8], rows: &[String], length: usize, cursor: usize) {
        if rows.is_empty() && !self.hint_shown {
            return;
        }
        self.settle_marks();
        let end = self.end_of(line, length);
        let end_row = end / self.columns;
        let target = if cursor == length {
            end
        } else {
            self.cell_of(line, cursor, length)
        };
        let below: String = rows.iter().map(|row| format!("\r\n{row}")).collect();
        error_raw(&format!(
            "{}{ERASE_BELOW}{below}{}\r{}",
            self.to_end(end),
            cursor_up((rows.len() + end_row).saturating_sub(self.cursor_row)),
            cursor_right(target % self.columns)
        ));
        self.hint_shown = !rows.is_empty();
    }

    fn clear_hint(&mut self, line: &[u8], length: usize) {
        self.settle_marks();
        if !self.hint_shown {
            return;
        }
        let end = self.end_of(line, length);
        error_raw(&format!("{}{ERASE_BELOW}", self.to_end(end)));
        self.cursor_row = end / self.columns;
        self.hint_shown = false;
    }

    fn to_end(&self, end: usize) -> String {
        format!(
            "{}\r{}",
            cursor_down((end / self.columns).saturating_sub(self.cursor_row)),
            cursor_right(end % self.columns)
        )
    }

    fn cell_of(&self, line: &[u8], cursor: usize, length: usize) -> usize {
        let before = placed_after(line, 0, cursor, self.start, self.columns);
        if cursor == length {
            return before;
        }
        let end = next_character(line, cursor, length);
        let after = placed_after(line, cursor, end, before, self.columns);
        after - width_of(line, cursor, end)
    }

    fn end_of(&mut self, line: &[u8], length: usize) -> usize {
        while self.counted_bytes < length {
            let size = character_size(line.get(self.counted_bytes).copied().unwrap_or(0));
            if self.counted_bytes + size > length {
                break;
            }
            let end = placed_after(
                line,
                self.counted_bytes,
                self.counted_bytes + size,
                self.counted_end,
                self.columns,
            );
            if end > self.counted_end {
                self.last_base = Some(self.counted_bytes);
            }
            self.counted_end = end;
            self.counted_bytes += size;
        }
        self.counted_end
    }

    fn settle(&self, offset: usize) -> usize {
        if offset > 0 && offset.is_multiple_of(self.columns) {
            error_raw("\r\n");
        }
        offset / self.columns
    }
}

/// The row of the cursor after a visible answer shown after a prompt `prompt_width` wide, counted
/// from the prompt's first row, as the line editor leaves it at Enter or Escape.
pub(crate) fn answer_end_row(prompt_width: usize, answer: &str, columns: usize) -> usize {
    let columns = columns.max(1);
    let start = prompt_width % columns;
    prompt_width / columns
        + placed_after(answer.as_bytes(), 0, answer.len(), start, columns) / columns
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wide_character_at_the_last_column_goes_whole_to_the_next_row() {
        let text = "ab的".as_bytes();
        assert_eq!(placed_after(text, 0, text.len(), 0, 3), 5);
        assert_eq!(placed_after(text, 0, text.len(), 0, 4), 4);
        // Ending at the right edge, the cursor stands on the next row, as TS's answerEndRow says.
        assert_eq!(answer_end_row(2, "ab的", 3), 2);
        assert_eq!(answer_end_row(4, "的", 5), 1);
        assert_eq!(answer_end_row(3, "的", 5), 1);
        assert_eq!(answer_end_row(3, "a", 5), 0);
        assert_eq!(answer_end_row(5, "", 5), 1);
    }

    #[test]
    fn hidden_answers_edit_without_drawing() {
        let mut answer = TypedAnswer::new(8, false, 0, None);
        for byte in b"ab cd" {
            assert_eq!(answer.insert(*byte), Ok(()));
        }
        assert!(answer.control(key::CTRL_W));
        assert!(answer.take().is_ok_and(|text| &*text == b"ab "));
        answer.edit(EditKey::Home);
        assert_eq!(answer.cursor(), 0);
        for byte in b"123456" {
            let _inserted = answer.insert(*byte);
        }
        assert_eq!(answer.insert(b'x'), Err(Unusable::TooLong(8)));
    }

    #[test]
    fn an_answer_of_no_utf8_is_refused() {
        let mut answer = TypedAnswer::new(4, false, 0, None);
        assert_eq!(answer.insert(0xff), Ok(()));
        assert!(matches!(answer.take(), Err(Unusable::NotUtf8)));
        assert_eq!(
            Unusable::TooLong(1024).message(),
            "An answer is longer than 1024 bytes; no valid answer is that long."
        );
    }
}
