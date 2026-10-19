// What a terminal shows after a stream of text and control sequences, row by row, as far as
// MnemoCode writes them on the private screen: text that wraps at the right edge, line breaks,
// carriage returns, tabs, cursor moves, erasing in the display and in the line, and colours, which
// each cell keeps. The private page (private-page.ts) reads its record with it, to show again
// what scrolled over the top edge of a screen that keeps no scrollback. Other escape sequences,
// such as the switch to the alternate screen, are passed over.

import { codePointWidth } from "./terminal-geometry.js";
import { SGR_RESET } from "./terminal-style.js";

/** One cell of the screen: what is drawn in it, and the colour codes it is drawn with. */
interface Cell {
  readonly text: string;
  readonly style: string;
}

/** The rows of a page from its top, and the row of the cursor. */
export interface ScreenRows {
  /** Each row from the top down to the cursor's, as text with its colour codes. */
  readonly rows: readonly string[];
  /** The row of the cursor, counted from 0: the rows above it are the ones the page fills. */
  readonly cursorRow: number;
}

/** A control sequence: ESC [, its parameters and its final character (ECMA-48 CSI). */
// oxlint-disable-next-line no-control-regex -- a control sequence begins with ESC, which it must match
const CONTROL_SEQUENCE = /\x1b\[([0-9;?]*)([@-~])/uy;
/** The columns from one tab stop to the next. */
const TAB_STOP = 8;
/** An empty cell, as an erase leaves it. */
const BLANK: Cell = { text: " ", style: "" };

/** The page that `stream` draws on a terminal `columns` wide, from its top left. */
export function screenRows(stream: string, columns: number): ScreenRows {
  const screen = new Screen(Math.max(1, columns));
  for (let at = 0; at < stream.length;) at = screen.read(stream, at);
  return screen.rows();
}

/** The cells of a page that grows downwards without limit, and its cursor. */
class Screen {
  readonly #columns: number;
  readonly #cells: Cell[][] = [[]];
  #row = 0;
  /** The cursor's column; equal to the width after the last column, until the next character. */
  #column = 0;
  #style = "";

  constructor(columns: number) {
    this.#columns = columns;
  }

  /** Reads the character or the escape sequence at `at` of `stream`; where the next one starts. */
  read(stream: string, at: number): number {
    if (stream[at] === "\x1b") {
      CONTROL_SEQUENCE.lastIndex = at;
      const sequence = CONTROL_SEQUENCE.exec(stream);
      if (sequence === null) return at + 2;
      this.#control(sequence[1] ?? "", sequence[2] ?? "");
      return at + sequence[0].length;
    }
    const point = stream.codePointAt(at) ?? 0;
    const text = String.fromCodePoint(point);
    this.#character(text, point);
    return at + text.length;
  }

  /** The rows drawn, from the top down to the cursor's. */
  rows(): ScreenRows {
    const rows = this.#cells.slice(0, this.#row + 1).map((cells) => {
      let shown = "";
      let style = "";
      for (const cell of cells) {
        if (cell.style !== style) shown += `${style === "" ? "" : SGR_RESET}${cell.style}`;
        style = cell.style;
        shown += cell.text;
      }
      return style === "" ? shown.trimEnd() : `${shown}${SGR_RESET}`;
    });
    return { rows, cursorRow: this.#row };
  }

  #character(text: string, point: number): void {
    if (text === "\n") this.#moveTo(this.#row + 1, 0);
    else if (text === "\r") this.#column = 0;
    else if (text === "\b") this.#column = Math.max(0, Math.min(this.#column, this.#columns) - 1);
    else if (text === "\t")
      this.#column = Math.min(
        this.#columns - 1,
        (Math.floor(this.#column / TAB_STOP) + 1) * TAB_STOP,
      );
    else if (point >= 0x20 && point !== 0x7f) this.#draw(text, codePointWidth(point));
  }

  /** Draws `text` at the cursor, `width` columns wide, on the next row when it does not fit. */
  #draw(text: string, width: number): void {
    const cells = this.#rowCells();
    if (width === 0) {
      // A mark joins the character before it.
      const before = Math.min(this.#column, this.#columns) - 1;
      const cell = cells[before];
      if (cell !== undefined) cells[before] = { text: cell.text + text, style: cell.style };
      return;
    }
    if (this.#column + width > this.#columns) this.#moveTo(this.#row + 1, 0);
    const row = this.#rowCells();
    while (row.length < this.#column) row.push(BLANK);
    row[this.#column] = { text, style: this.#style };
    // The second column of a wide character holds nothing of its own.
    if (width === 2) row[this.#column + 1] = { text: "", style: this.#style };
    this.#column += width;
  }

  #control(parameters: string, final: string): void {
    const count = Math.max(1, Number.parseInt(parameters, 10) || 1);
    const column = Math.min(this.#column, this.#columns - 1);
    if (final === "A") this.#moveTo(Math.max(0, this.#row - count), column);
    else if (final === "B") this.#moveTo(this.#row + count, column);
    else if (final === "C") this.#column = Math.min(this.#columns - 1, column + count);
    else if (final === "D") this.#column = Math.max(0, column - count);
    else if (final === "G") this.#column = Math.min(this.#columns - 1, count - 1);
    else if (final === "H" || final === "f") {
      const [row = "1", at = "1"] = parameters.split(";");
      this.#moveTo(Math.max(1, Number(row) || 1) - 1, Math.min(this.#columns, Number(at) || 1) - 1);
    } else if (final === "J") this.#eraseDisplay(parameters);
    else if (final === "K") this.#eraseLine(parameters);
    else if (final === "m") this.#paint(parameters);
  }

  /** ESC [ m: the colour codes of the characters drawn next; 0, or none, ends them. */
  #paint(parameters: string): void {
    const [first] = parameters.split(";");
    if (parameters === "" || parameters === "0") this.#style = "";
    else if (first === "0") this.#style = `\x1b[${parameters}m`;
    else this.#style += `\x1b[${parameters}m`;
  }

  /** ESC [ J: from the cursor to the end of the screen; 1 J: up to it; 2 J: all of it. */
  #eraseDisplay(parameters: string): void {
    if (parameters === "2" || parameters === "3") {
      for (const cells of this.#cells) cells.length = 0;
      return;
    }
    if (parameters === "1") {
      for (const cells of this.#cells.slice(0, this.#row)) cells.length = 0;
      this.#eraseLine("1");
      return;
    }
    const cells = this.#rowCells();
    cells.length = Math.min(this.#column, cells.length);
    this.#cells.length = this.#row + 1;
  }

  /** ESC [ K: from the cursor to the end of the line; 1 K: up to it; 2 K: the whole line. */
  #eraseLine(parameters: string): void {
    const cells = this.#rowCells();
    if (parameters === "2") cells.length = 0;
    else if (parameters === "1")
      for (let at = 0; at <= Math.min(this.#column, cells.length - 1); at += 1) cells[at] = BLANK;
    else cells.length = Math.min(this.#column, cells.length);
  }

  #moveTo(row: number, column: number): void {
    this.#row = row;
    this.#column = column;
    while (this.#cells.length <= row) this.#cells.push([]);
  }

  #rowCells(): Cell[] {
    while (this.#cells.length <= this.#row) this.#cells.push([]);
    return this.#cells[this.#row] ?? [];
  }
}
