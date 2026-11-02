//! The page of the private screen (MnemoCode TS 0.1.0's `cli/private-page.ts`,
//! CAP-CLI-RESULT-PAGING): everything written to the terminal since the screen was last cleared.
//! The alternate screen keeps no scrollback, so a result longer than the terminal would lose the
//! rows that scrolled over its top edge. The page is recorded as it is written, and before a
//! question or a prompt is drawn under it, a page that does not fit with them is shown again whole,
//! by pages, until Enter or Escape. It holds the secrets shown on it, and is wiped when it ends.

use std::sync::Mutex;

use mnemocode::secret::SecretBytes;
use zeroize::Zeroize;

use crate::os::pending_signal;

use super::keys::{Interrupted, Key, Keys, read_key};
use super::private::result_stays_from_start;
use super::screen_rows::{ScreenRows, screen_rows};
use super::{
    CLEAR_SCREEN, Channel, TAB_STOP, columns, error_raw, error_raw_unrecorded, output_rows, paint,
    rows, showing_result, style, without_style,
};

/// The keys of the pages, under each page.
const NAVIGATION: [&str; 2] = [
    "↑/PgUp previous · ↓/PgDn next",
    "Home/End · Enter done · Ctrl+C cancel",
];
/// The bytes a record holds at first.
const FIRST_RECORD_BYTES: usize = 16 * 1024;
/// How often the pages look at the terminal's size while no key comes.
const RESIZE_WATCH_MS: u32 = 100;

/// What was written to the terminal since the screen was last cleared.
struct PageRecord {
    bytes: SecretBytes,
    length: usize,
    seen_rows: usize,
}

static RECORD: Mutex<Option<PageRecord>> = Mutex::new(None);

fn with_record<T>(work: impl FnOnce(&mut Option<PageRecord>) -> T) -> T {
    let mut guard = RECORD
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    work(&mut guard)
}

/// Starts recording the page.
pub(super) fn open_page() {
    with_record(|record| {
        *record = Some(PageRecord {
            bytes: SecretBytes::zeroed("the private page", FIRST_RECORD_BYTES),
            length: 0,
            seen_rows: 0,
        });
    });
}

/// Stops recording and wipes the page.
pub(super) fn close_page() {
    with_record(|record| *record = None);
}

/// Adds what was written to the terminal to the page; a clear of the screen starts a new one.
pub(super) fn record_written(text: &str) {
    with_record(|record| {
        let Some(page) = record else {
            return;
        };
        let added = match text.rfind(CLEAR_SCREEN) {
            Some(at) => {
                page.bytes.zeroize();
                page.length = 0;
                page.seen_rows = 0;
                &text[at + CLEAR_SCREEN.len()..]
            }
            None => text,
        };
        let needed = page.length + added.len();
        if needed > page.bytes.len() {
            let mut grown = SecretBytes::zeroed("the private page", needed.next_power_of_two());
            grown[..page.length].copy_from_slice(&page.bytes[..page.length]);
            page.bytes = grown;
        }
        page.bytes[page.length..needed].copy_from_slice(added.as_bytes());
        page.length = needed;
    });
}

/// The most rows the page can take on a terminal `width` wide, read from its bytes: each line
/// break, and each row that its bytes could fill, a tab moving on as many as TAB_STOP.
fn most_rows(page: &PageRecord, width: usize) -> usize {
    let bytes = &page.bytes[..page.length];
    let count = |value: u8| bytes.iter().filter(|byte| **byte == value).count();
    let widest = page.length + count(b'\t') * (TAB_STOP - 1);
    count(b'\n') + widest.div_ceil(width.max(1))
}

/// The page as rows at the width of the terminal.
fn page_rows() -> ScreenRows {
    with_record(|record| {
        let text = record
            .as_ref()
            .map(|page| String::from_utf8_lossy(&page.bytes[..page.length]).into_owned());
        let mut text = text.unwrap_or_default();
        let rows = screen_rows(&text, columns());
        text.zeroize();
        rows
    })
}

fn blank(row: &str) -> bool {
    without_style(row).trim().is_empty()
}

/// Where each page of `rows` starts: a page holds `capacity` rows, and ends after a blank row when
/// one falls in its second half, so that a block stays whole.
fn page_starts(rows: &[String], capacity: usize) -> Vec<usize> {
    let mut starts = vec![0];
    let mut start = 0;
    while start + capacity < rows.len() {
        let mut end = start + capacity;
        let mut row = end;
        while row > start + capacity / 2 {
            if blank(&rows[row - 1]) {
                end = row;
                break;
            }
            row -= 1;
        }
        starts.push(end);
        start = end;
    }
    starts
}

/// The lines under page `page`, of `count`.
fn footer(page: usize, count: usize) -> Vec<String> {
    let mut lines = vec![format!("Page {}/{count}", page + 1)];
    lines.extend(NAVIGATION.iter().map(|line| (*line).to_owned()));
    lines
}

/// Draws page `page` of `shown`; how many pages they make.
fn draw(shown: &[String], page: &mut usize, pages: usize) -> usize {
    let footer_rows: usize = footer(*page, pages)
        .iter()
        .map(|line| output_rows(line))
        .sum();
    let starts = page_starts(shown, rows().saturating_sub(footer_rows).max(1));
    let count = starts.len();
    *page = (*page).min(count - 1);
    let end = starts.get(*page + 1).copied().unwrap_or(shown.len());
    let mut lines: Vec<String> = shown[starts[*page]..end].to_vec();
    lines.extend(
        footer(*page, count)
            .iter()
            .map(|line| paint(Channel::Error, style::MUTED, line)),
    );
    error_raw_unrecorded(&format!("{CLEAR_SCREEN}{}", lines.join("\n")));
    count
}

/// The rows that the pages show, at the width of the terminal.
fn shown_rows() -> Vec<String> {
    let mut shown = page_rows().rows;
    while shown.last().is_some_and(|row| blank(row)) {
        shown.pop();
    }
    shown
}

/// Shows the page by pages, the keys under each, drawn again when the terminal's size changes,
/// until Enter or Escape; `false` at Ctrl+C.
fn show_pages() -> Result<bool, Interrupted> {
    let mut keys = Keys::open();
    let mut shown = shown_rows();
    let mut size = (columns(), rows());
    let mut page = 0;
    let mut pages = draw(&shown, &mut page, 1);
    loop {
        while !keys.more_within(RESIZE_WATCH_MS) && pending_signal().is_none() {
            if (columns(), rows()) != size {
                size = (columns(), rows());
                shown = shown_rows();
                pages = draw(&shown, &mut page, pages);
            }
        }
        let before = page;
        match read_key(&mut keys)? {
            Key::Cancel => return Ok(false),
            Key::Enter | Key::Back => return Ok(true),
            Key::Up | Key::PageUp => page = page.saturating_sub(1),
            Key::Down | Key::PageDown => page = (page + 1).min(pages - 1),
            Key::Home => page = 0,
            Key::End => page = pages - 1,
            _ => {}
        }
        if page != before {
            pages = draw(&shown, &mut page, pages);
        }
    }
}

/// [`keep_readable`] before a question of `reserve` rows under a shown result; a question on a
/// step screen of its own needs none.
pub(crate) fn before_question(reserve: usize) -> Result<bool, Interrupted> {
    if showing_result() {
        keep_readable(reserve)
    } else {
        Ok(true)
    }
}

/// Keeps the page readable before `reserve` rows are drawn under it: where what was written since
/// it was last kept does not fit with them, the whole page is shown by pages, and its last rows
/// stay above what comes next. `false` at Ctrl+C.
pub(crate) fn keep_readable(reserve: usize) -> Result<bool, Interrupted> {
    // Rows read before may scroll away, except a result that stays from its start.
    let from_start = result_stays_from_start();
    let seen = with_record(|record| {
        record
            .as_ref()
            .map(|page| if from_start { 0 } else { page.seen_rows })
            .filter(|seen| {
                record.as_ref().is_some_and(|page| {
                    most_rows(page, columns()).saturating_sub(*seen) + reserve > rows()
                })
            })
    });
    let Some(seen) = seen else {
        return Ok(true);
    };
    let page = page_rows();
    if page.cursor_row.saturating_sub(seen) + reserve <= rows() {
        mark_seen(page.cursor_row);
        return Ok(true);
    }
    if !show_pages()? {
        return Ok(false);
    }
    let page = page_rows();
    let room = rows().saturating_sub(reserve);
    let content = &page.rows[..page.cursor_row.min(page.rows.len())];
    let above = if from_start {
        &content[..room.min(content.len())]
    } else {
        &content[content.len().saturating_sub(room)..]
    };
    let lines: String = above.iter().map(|row| format!("{row}\n")).collect();
    // Written through the record: this part is the page now, and was read.
    error_raw(&format!("{CLEAR_SCREEN}{lines}"));
    mark_seen(above.len());
    Ok(true)
}

/// Notes that the rows down to `rows` were on the screen whole.
fn mark_seen(rows: usize) {
    with_record(|record| {
        if let Some(page) = record {
            page.seen_rows = rows;
        }
    });
}
