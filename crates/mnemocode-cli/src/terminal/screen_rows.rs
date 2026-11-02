//! What a terminal shows after a stream of text and control sequences, row by row, as far as
//! MnemoCode writes them on the private screen (MnemoCode TS 0.1.0's `cli/screen-rows.ts`): text
//! that wraps at the right edge, line breaks, carriage returns, tabs, cursor moves, erasing in the
//! display and in the line, and colours, which each cell keeps. The private page reads its record
//! with it, to show again what scrolled over the top of a screen that keeps no scrollback.

use mnemocode::text::widths::text_width;

use super::{SGR_RESET, TAB_STOP};

/// One cell of the screen: what is drawn in it, and the colour codes it is drawn with.
#[derive(Clone, Debug, Default)]
struct Cell {
    text: String,
    style: String,
}

impl Cell {
    /// An empty cell, as an erase leaves it.
    fn blank() -> Self {
        Self {
            text: " ".to_owned(),
            style: String::new(),
        }
    }
}

/// The rows of a page from its top, and the row of the cursor.
#[derive(Debug)]
pub(super) struct ScreenRows {
    /// Each row from the top down to the cursor's, as text with its colour codes.
    pub(super) rows: Vec<String>,
    /// The row of the cursor, from 0: the rows above it are the ones the page fills.
    pub(super) cursor_row: usize,
}

/// The cells of a page that grows downwards without limit, and its cursor.
struct Screen {
    columns: usize,
    cells: Vec<Vec<Cell>>,
    row: usize,
    /// The cursor's column; equal to the width after the last column, until the next character.
    column: usize,
    style: String,
}

/// The page that `stream` draws on a terminal `columns` wide, from its top left.
pub(super) fn screen_rows(stream: &str, columns: usize) -> ScreenRows {
    let mut screen = Screen {
        columns: columns.max(1),
        cells: vec![Vec::new()],
        row: 0,
        column: 0,
        style: String::new(),
    };
    let mut rest = stream;
    while let Some(character) = rest.chars().next() {
        if character == '\x1b' {
            rest = screen.escape(rest);
        } else {
            screen.character(character);
            rest = &rest[character.len_utf8()..];
        }
    }
    screen.finished()
}

impl Screen {
    /// Reads the escape sequence that starts `stream`, ESC [, its parameters and its final
    /// character; what follows it.
    fn escape<'a>(&mut self, stream: &'a str) -> &'a str {
        let after = stream.get(2..).unwrap_or_default();
        if !stream[1..].starts_with('[') {
            return after;
        }
        let end = after.find(|character: char| !matches!(character, '0'..='9' | ';' | '?'));
        let Some(end) = end else {
            return "";
        };
        let last = after[end..].chars().next().unwrap_or(' ');
        if !('@'..='~').contains(&last) {
            return after;
        }
        self.control(&after[..end], last);
        &after[end + last.len_utf8()..]
    }

    /// The rows drawn, from the top down to the cursor's.
    fn finished(self) -> ScreenRows {
        let rows = self.cells[..=self.row]
            .iter()
            .map(|cells| {
                let mut shown = String::new();
                let mut style = "";
                for cell in cells {
                    if cell.style != style {
                        if !style.is_empty() {
                            shown.push_str(SGR_RESET);
                        }
                        shown.push_str(&cell.style);
                    }
                    style = &cell.style;
                    shown.push_str(&cell.text);
                }
                if style.is_empty() {
                    shown.trim_end().to_owned()
                } else {
                    format!("{shown}{SGR_RESET}")
                }
            })
            .collect();
        ScreenRows {
            rows,
            cursor_row: self.row,
        }
    }

    fn character(&mut self, character: char) {
        match character {
            '\n' => self.move_to(self.row + 1, 0),
            '\r' => self.column = 0,
            '\u{8}' => self.column = self.column.min(self.columns).saturating_sub(1),
            '\t' => {
                let next = (self.column / TAB_STOP + 1) * TAB_STOP;
                self.column = next.min(self.columns - 1);
            }
            _ if character < ' ' || character == '\u{7f}' => {}
            _ => self.draw(character),
        }
    }

    /// Draws `character` at the cursor, on the next row when it does not fit.
    fn draw(&mut self, character: char) {
        let mut buffer = [0; 4];
        let text: &str = character.encode_utf8(&mut buffer);
        let width = text_width(text);
        if width == 0 {
            // A mark joins the character before it.
            let before = self.column.min(self.columns).wrapping_sub(1);
            if let Some(cell) = self.cells[self.row].get_mut(before) {
                cell.text.push(character);
            }
            return;
        }
        if self.column + width > self.columns {
            self.move_to(self.row + 1, 0);
        }
        let (column, style) = (self.column, self.style.clone());
        let row = &mut self.cells[self.row];
        if row.len() < column {
            row.resize(column, Cell::blank());
        }
        let cell = Cell {
            text: text.to_owned(),
            style: style.clone(),
        };
        if row.len() == column {
            row.push(cell);
        } else {
            row[column] = cell;
        }
        // The second column of a wide character holds nothing of its own.
        if width == 2 {
            let empty = Cell {
                text: String::new(),
                style,
            };
            if row.len() == column + 1 {
                row.push(empty);
            } else {
                row[column + 1] = empty;
            }
        }
        self.column += width;
    }

    fn control(&mut self, parameters: &str, last: char) {
        let count = parameters
            .parse::<usize>()
            .ok()
            .filter(|count| *count > 0)
            .unwrap_or(1);
        let column = self.column.min(self.columns - 1);
        match last {
            'A' => self.move_to(self.row.saturating_sub(count), column),
            'B' => self.move_to(self.row + count, column),
            'C' => self.column = (self.columns - 1).min(column + count),
            'D' => self.column = column.saturating_sub(count),
            'G' => self.column = (self.columns - 1).min(count - 1),
            'H' | 'f' => {
                let mut parts = parameters.split(';');
                let mut part = || {
                    parts
                        .next()
                        .and_then(|text| text.parse::<usize>().ok())
                        .filter(|value| *value > 0)
                        .unwrap_or(1)
                };
                let (row, at) = (part(), part());
                self.move_to(row - 1, at.min(self.columns) - 1);
            }
            'J' => self.erase_display(parameters),
            'K' => self.erase_line(parameters),
            'm' => self.paint(parameters),
            _ => {}
        }
    }

    /// ESC [ m: the colour codes of the characters drawn next; 0, or none, ends them.
    fn paint(&mut self, parameters: &str) {
        if parameters.is_empty() || parameters == "0" {
            self.style.clear();
        } else if parameters.split(';').next() == Some("0") {
            self.style = format!("\x1b[{parameters}m");
        } else {
            self.style.push_str(&format!("\x1b[{parameters}m"));
        }
    }

    /// ESC [ J: from the cursor to the end of the screen; 1 J: up to it; 2 J: all of it.
    fn erase_display(&mut self, parameters: &str) {
        match parameters {
            "2" | "3" => self.cells.iter_mut().for_each(Vec::clear),
            "1" => {
                self.cells[..self.row].iter_mut().for_each(Vec::clear);
                self.erase_line("1");
            }
            _ => {
                self.cells[self.row].truncate(self.column);
                self.cells.truncate(self.row + 1);
            }
        }
    }

    /// ESC [ K: from the cursor to the end of the line; 1 K: up to it; 2 K: the whole line.
    fn erase_line(&mut self, parameters: &str) {
        let column = self.column;
        let cells = &mut self.cells[self.row];
        match parameters {
            "2" => cells.clear(),
            "1" => cells
                .iter_mut()
                .take(column + 1)
                .for_each(|cell| *cell = Cell::blank()),
            _ => cells.truncate(column),
        }
    }

    fn move_to(&mut self, row: usize, column: usize) {
        self.row = row;
        self.column = column;
        if self.cells.len() <= row {
            self.cells.resize(row + 1, Vec::new());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stream_is_read_as_a_terminal_draws_it() {
        let page = screen_rows("ab\ncd\x1b[1A\rx", 10);
        assert_eq!(page.rows, ["xb"]);
        assert_eq!(page.cursor_row, 0);
        let wrapped = screen_rows("abcd", 3);
        assert_eq!(wrapped.rows, ["abc", "d"]);
        let painted = screen_rows("\x1b[1mab\x1b[0m\nc", 10);
        assert_eq!(
            painted.rows,
            [format!("\x1b[1mab{SGR_RESET}"), "c".to_owned()]
        );
        assert_eq!(screen_rows("ab\r\x1b[J", 10).rows, [""]);
    }
}
