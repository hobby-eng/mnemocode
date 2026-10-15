// The geometry of the terminal: its size, how many columns UTF-8 text takes, wide characters
// included, and where a terminal puts it, row after row. The line editor and every screen that
// must fit its rows count them here.

import { characterLength } from "./utf8.js";
import { defined } from "../core/defined.js";

/** Terminal width when the terminal does not say. */
const DEFAULT_COLUMNS = 80;

/** The width of the terminal on standard error, at which a visible answer wraps. */
export function terminalColumns(): number {
  const columns = process.stderr.columns;
  return columns !== undefined && columns > 0 ? columns : DEFAULT_COLUMNS;
}

/** Terminal height when the terminal does not say: a VT100's 24 rows. */
const DEFAULT_ROWS = 24;

/** The height of the terminal on standard error, read anew each time, as its width. */
export function terminalRows(): number {
  const rows = process.stderr.rows;
  return rows !== undefined && rows > 0 ? rows : DEFAULT_ROWS;
}

/** A tab moves on to the next of the stops that terminals set every 8 columns. */
const TAB_STOP = 8;

/**
 * The rows that one line of plain output, such as a row of a result table, takes on a terminal
 * `columns` wide: each tab moves on to the next tab stop, then the line wraps (rowsOfText). The
 * stops are counted along the whole line, as they fall on a terminal whose width is a multiple of
 * eight, such as 80; elsewhere a tab after the first row may be a few columns off.
 */
export function rowsOfOutputLine(line: string, columns: number = terminalColumns()): number {
  const [first = "", ...rest] = line.split("\t");
  let shown = first;
  for (const part of rest) {
    const toStop = TAB_STOP - (displayWidth(shown) % TAB_STOP);
    shown += `${" ".repeat(toStop)}${part}`;
  }
  return rowsOfText(shown, columns);
}

/**
 * Where a terminal `columns` wide puts the cursor after the UTF-8 characters between `from` and
 * `to`, written from `offset`; offsets count cells from the start of a row, row after row. A
 * character goes at the cursor, except a wide one at the last column of a row, which does not fit
 * there: xterm, VTE, Konsole, Windows Terminal and tmux leave that column empty and put it whole
 * at the start of the next row. An offset at a row's end (a multiple of `columns`) is where the
 * next character goes, at the start of the next row.
 */
export function placedAfter(
  line: Buffer,
  from: number,
  to: number,
  offset: number,
  columns: number,
): number {
  let end = offset;
  for (let index = from; index < to;) {
    const size = characterSize(defined(line[index]));
    if (index + size > to) break;
    const width = codePointWidth(codePointAt(line, index, size));
    const column = end % columns;
    if (column > 0 && column + width > columns) end += columns - column;
    end += width;
    index += size;
  }
  return end;
}

/** Placement of `text` from `offset` on a terminal `columns` wide (placedAfter). */
function placedTextAfter(text: string, offset: number, columns: number): number {
  const bytes = Buffer.from(text, "utf8");
  return placedAfter(bytes, 0, bytes.length, offset, columns);
}

/**
 * The rows that one line of `text` takes on a terminal `columns` wide when it starts at the left
 * edge, wrapping a wide character whole as terminals do (placedAfter); an empty line takes one.
 * For lines without colour codes; count a list's rows with it at each redraw.
 */
export function rowsOfText(text: string, columns: number = terminalColumns()): number {
  return Math.max(1, Math.ceil(placedTextAfter(text, 0, columns) / columns));
}

/**
 * The row of the cursor after a visible answer that readLine showed after a prompt of
 * `promptWidth` columns, counted from the first row of the prompt, as readLine leaves it at Enter
 * or Escape: just after the answer's end, on the next row when it ends at the right edge. The
 * prompt is taken to hold narrow characters only, as every prompt of MnemoCode does.
 */
export function answerEndRow(
  promptWidth: number,
  answer: string,
  columns: number = terminalColumns(),
): number {
  const start = promptWidth % columns;
  return (
    Math.floor(promptWidth / columns) +
    Math.floor(placedTextAfter(answer, start, columns) / columns)
  );
}

/**
 * The bytes that the UTF-8 character starting with `first` takes (characterLength), and one for a
 * byte that starts none: a step through bytes always moves on, so that no loop over a line can
 * stop at a byte that was not valid UTF-8.
 */
export function characterSize(first: number): number {
  return Math.max(1, characterLength(first));
}

/**
 * Columns that East Asian wide characters take, such as the Chinese words of BIP39 (Unicode
 * Standard Annex 11: the main wide ranges).
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

/**
 * Unicode nonspacing marks (Mn/Me) have no advance of their own in this terminal model. Check
 * before East Asian width: that property also assigns wide ranges to some combining marks.
 * This is not a model of every emoji sequence or terminal's fallback for an isolated mark.
 */
const NONSPACING_MARK = /[\p{Mn}\p{Me}]/u;
const MAX_UNICODE_CODE_POINT = 0x10ffff;

function codePointWidth(point: number): number {
  if (point <= MAX_UNICODE_CODE_POINT && NONSPACING_MARK.test(String.fromCodePoint(point)))
    return 0;
  return WIDE_RANGES.some(([first, last]) => point >= first && point <= last) ? 2 : 1;
}

/** The code point of the UTF-8 character of `size` bytes at `index` (RFC 3629, section 3). */
function codePointAt(line: Buffer, index: number, size: number): number {
  const first = defined(line[index]);
  let point = size === 1 ? first : first & (0xff >> (size + 1));
  for (let part = 1; part < size; part += 1)
    point = (point << 6) | (defined(line[index + part]) & 0x3f);
  return point;
}

/** The columns that the UTF-8 text between `from` and `to` takes on a terminal. */
export function displayWidthOf(line: Buffer, from: number, to: number): number {
  let width = 0;
  for (let index = from; index < to;) {
    const size = characterSize(defined(line[index]));
    width += codePointWidth(codePointAt(line, index, size));
    index += size;
  }
  return width;
}

/** The columns that a prompt takes on a terminal. */
export function displayWidth(text: string): number {
  return displayWidthOf(Buffer.from(text, "utf8"), 0, Buffer.byteLength(text, "utf8"));
}
