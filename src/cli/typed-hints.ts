// The rows of a hint below a line being typed (core/word-hints.ts), as mhfe draws them
// (src/bin/mhfe/typed_line.rs): the words in columns, at most HINT_ROWS rows of them and how many
// more on a row of its own, a count in grey, and a warning where no word of the list begins like
// the one typed. Every row is narrower than the terminal, so that none wraps onto the row that the
// typed line comes back to; a terminal narrower than NARROWEST_FOR_HINTS gets none.

import type { WordHint } from "../core/word-hints.js";
import { paint, STYLE } from "./terminal-style.js";

/** Rows of words at most below the line; the rest is counted on a row of its own. */
const HINT_ROWS = 3;
/** Columns between two words of a hint. */
const WORD_GAP = 2;
/** Narrower terminals get no hints, which would not fit beside their indent. */
const NARROWEST_FOR_HINTS = 24;
/** The indent of a hint row, as for the hints of a step. */
const INDENT = "  ";

/** The rows that show `hint` on a terminal `columns` wide, painted, without line breaks. */
export function hintRows(hint: WordHint, columns: number): string[] {
  if (columns < NARROWEST_FOR_HINTS) return [];
  // All but the last column, where a terminal would move on to the next row. Every hint is ASCII:
  // list words, numbers and fixed text.
  const room = columns - 1 - INDENT.length;
  const row = (code: string, text: string): string =>
    `${INDENT}${paint(process.stderr, code, text.slice(0, room))}`;
  switch (hint.kind) {
    case "nothing":
      return [];
    case "count":
      return [row(STYLE.muted, hint.text)];
    case "no-word":
      return [row(STYLE.warning, `! ${hint.text}`)];
    case "words":
      return wordRows(hint.words, room).map((text) => row(STYLE.muted, text));
  }
}

/** `words` in columns that fit in `room`, at most HINT_ROWS rows, and how many more. */
function wordRows(words: readonly string[], room: number): string[] {
  const cell = Math.max(...words.map((word) => word.length)) + WORD_GAP;
  const perRow = Math.max(1, Math.floor(room / cell));
  const shown = Math.min(words.length, perRow * HINT_ROWS);
  const rows: string[] = [];
  for (let start = 0; start < shown; start += perRow) {
    const cells = words
      .slice(start, Math.min(start + perRow, shown))
      .map((word) => word.padEnd(cell));
    rows.push(cells.join("").trimEnd());
  }
  if (shown < words.length) rows.push(`and ${words.length - shown} more`);
  return rows;
}
