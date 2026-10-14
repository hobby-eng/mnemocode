// An answer as readLine edits it (terminal-input.ts): its bytes in a buffer that is wiped, the
// cursor, and for a visible answer what the terminal shows (ShownLine), which wraps a long answer
// onto further rows, and the hint for the word being typed below it.

import {
  characterSize,
  displayWidthOf,
  placedAfter,
  terminalColumns,
} from "./terminal-geometry.js";
import { isContinuation, STRICT_UTF8 } from "./utf8.js";
import { cursorDown, cursorUp, cursorRight, ERASE_BELOW } from "./terminal.js";
import type { WordHint, WordHints } from "../core/word-hints.js";
import { hintRows } from "./typed-hints.js";
import { defined } from "../core/defined.js";
import { KEY, UnusableAnswerError } from "./terminal-keys.js";
import { type EditKey } from "./key-sequences.js";

/**
 * The words that a hint is given: the word being typed and three before it, enough to tell the
 * form of the line, Bytewords after the codes of another share or English words among codes.
 */
const HINT_CONTEXT_WORDS = 4;

/**
 * An answer as it is typed: its bytes in a buffer reserved at the largest size and never grown, so
 * that no unwiped copy of a secret is left, the cursor, where the next character goes and always at
 * the start of a character, and, for a visible answer, what the terminal shows and the hint below.
 */
export class TypedAnswer {
  readonly #line: Buffer;
  readonly #limit: number;
  readonly #shown: ShownLine | undefined;
  /** Only where the answer shows, as in mhfe: a hint tells what is typed. */
  readonly #hints: WordHints | undefined;
  #length = 0;
  #cursor = 0;
  /** Whether the hint below the answer is behind what the answer shows. */
  #hintDue = false;

  /**
   * An answer of at most `limit` bytes, shown after a prompt `promptWidth` wide when `echo` says
   * so, with `hints` below it.
   */
  constructor(limit: number, echo: boolean, promptWidth: number, hints: WordHints | undefined) {
    this.#limit = limit;
    this.#line = Buffer.alloc(limit);
    this.#shown = echo ? new ShownLine(this.#line, promptWidth) : undefined;
    this.#hints = echo ? hints : undefined;
  }

  get length(): number {
    return this.#length;
  }

  get cursor(): number {
    return this.#cursor;
  }

  get hints(): WordHints | undefined {
    return this.#hints;
  }

  /** The row of the cursor below the first row of the prompt, where the answer shows. */
  get rowFromPrompt(): number {
    return this.#shown?.rowFromPrompt ?? 0;
  }

  /** The columns that the answer takes. */
  get columns(): number {
    return displayWidthOf(this.#line, 0, this.#length);
  }

  /** The byte before the cursor. */
  get before(): number | undefined {
    return this.#line[this.#cursor - 1];
  }

  insert(byte: number): void {
    if (this.#length === this.#limit)
      throw new UnusableAnswerError(
        `An answer is longer than ${this.#limit} bytes; no valid answer is that long.`,
      );
    this.#line.copyWithin(this.#cursor + 1, this.#cursor, this.#length);
    this.#line[this.#cursor++] = byte;
    this.#length += 1;
    this.#hintDue = this.#hints !== undefined;
    // A character of several bytes is shown once it is complete.
    if (this.#shown !== undefined && isCharacterEnd(this.#line, this.#cursor))
      this.#shown.update(this.#length, this.#cursor, this.#cursor === this.#length);
  }

  remove(from: number, to: number): void {
    this.#line.copyWithin(from, to, this.#length);
    this.#length -= to - from;
    this.#line.fill(0, this.#length, this.#length + (to - from));
    this.#cursor = from;
    this.#hintDue = this.#hints !== undefined;
    this.#shown?.update(this.#length, this.#cursor);
  }

  moveTo(position: number): void {
    this.#cursor = position;
    this.#hintDue = this.#hints !== undefined;
    this.#shown?.update(this.#length, this.#cursor);
  }

  /** As End would; nothing is drawn when the cursor is there already. */
  moveToEnd(): void {
    if (this.#cursor !== this.#length) this.moveTo(this.#length);
  }

  /** Moves the cursor or deletes as `key` says. */
  edit(key: EditKey): void {
    const line = this.#line;
    const [cursor, length] = [this.#cursor, this.#length];
    if (key === "left" && cursor > 0) this.moveTo(previousCharacter(line, cursor));
    else if (key === "right" && cursor < length) this.moveTo(nextCharacter(line, cursor, length));
    else if (key === "word-left") this.moveTo(previousWord(line, cursor));
    else if (key === "word-right") this.moveTo(nextWord(line, cursor, length));
    else if (key === "home") this.moveTo(0);
    else if (key === "end") this.moveTo(length);
    else if (key === "delete" && cursor < length)
      this.remove(cursor, nextCharacter(line, cursor, length));
  }

  /** Edits with a control key that deletes or moves: whether `byte` was one. */
  control(byte: number): boolean {
    const line = this.#line;
    const [cursor, length] = [this.#cursor, this.#length];
    if (byte === KEY.BACKSPACE || byte === KEY.DELETE) {
      if (cursor > 0) this.remove(previousCharacter(line, cursor), cursor);
    } else if (byte === KEY.CTRL_U) {
      if (cursor > 0) this.remove(0, cursor);
    } else if (byte === KEY.CTRL_A) this.moveTo(0);
    else if (byte === KEY.CTRL_E) this.moveTo(length);
    else if (byte === KEY.CTRL_K) {
      if (cursor < length) this.remove(cursor, length);
    } else if (byte === KEY.CTRL_W) {
      if (cursor > 0) this.remove(previousWord(line, cursor), cursor);
    } else return false;
    return true;
  }

  /**
   * The words before the cursor that the hint and Tab are about, while the cursor ends a word;
   * otherwise none: the word being typed and a few before it (HINT_CONTEXT_WORDS), which tell the
   * form of the line. No more of the answer, which may be a secret, becomes a string, which nothing
   * could wipe (AUD-019-SEC001).
   */
  #typedBefore(): string {
    const line = this.#line;
    if (this.#cursor < this.#length && line[this.#cursor] !== KEY.SPACE) return "";
    let start = this.#cursor;
    for (let words = 0; words < HINT_CONTEXT_WORDS && start > 0; words += 1)
      start = previousWord(line, start);
    try {
      return STRICT_UTF8.decode(line.subarray(start, this.#cursor));
    } catch {
      return "";
    }
  }

  /**
   * Tab: the letters that every word beginning like the typed one has next, and a space once one
   * word is left.
   */
  complete(completing: WordHints): void {
    const { letters, wordEnds } = completing.completion(this.#typedBefore());
    for (let at = 0; at < letters.length; at += 1) this.insert(letters.charCodeAt(at));
    if (!wordEnds) return;
    if (this.#cursor < this.#length && this.#line[this.#cursor] === KEY.SPACE)
      this.moveTo(this.#cursor + 1);
    else this.insert(KEY.SPACE);
  }

  /**
   * Draws the hint below the answer when it is behind, once `quiet` says no key follows at once.
   */
  async hintWhen(quiet: () => Promise<boolean>): Promise<void> {
    if (!this.#hintDue || !(await quiet())) return;
    defined(this.#shown).showHint(
      defined(this.#hints).hint(this.#typedBefore()),
      this.#length,
      this.#cursor,
    );
    this.#hintDue = false;
  }

  /** The answer as text; a TypeError when it holds bytes of no UTF-8 character. */
  text(): string {
    return STRICT_UTF8.decode(this.#line.subarray(0, this.#length));
  }

  /** Clears the hint and wipes the answer. */
  wipe(): void {
    // Before the answer is wiped: its width says where the hint is.
    this.#shown?.clearHint(this.#length);
    this.#line.fill(0);
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * The visible answer on the terminal, which wraps a long answer onto further rows. Every change
 * but typing at the end redraws the answer from its first row, with relative moves only, so that
 * it stays right when the screen scrolls. `cursorRow` is the row of the cursor below that first
 * row; the answer starts on it after the prompt. Positions are counted as a terminal places the
 * characters (placedAfter): a wide character that does not fit at the right edge goes whole to the
 * next row.
 */
class ShownLine {
  readonly #columns: number;
  readonly #start: number;
  /** The rows of the prompt above the row on which the answer starts. */
  readonly #promptRows: number;
  #cursorRow = 0;
  /**
   * The first `countedBytes` bytes of the answer are whole characters, after which the terminal
   * has the cursor at `countedEnd`, counted in cells from the start of the answer's first row.
   * Typing at the end counts on from them: counting the whole answer again for every key would
   * make a long paste fall behind, and a macOS pseudo-terminal, which buffers about 1 KiB each
   * way, then blocks both the terminal and this program. A redraw counts from the start.
   */
  #countedBytes = 0;
  #countedEnd: number;
  /** Whether a hint shows below the answer. */
  #hintShown = false;
  readonly #line: Buffer;

  constructor(line: Buffer, promptWidth: number) {
    this.#line = line;
    this.#columns = terminalColumns();
    this.#start = promptWidth % this.#columns;
    this.#promptRows = Math.floor(promptWidth / this.#columns);
    this.#countedEnd = this.#start;
    // A prompt that ends at the right edge leaves the cursor waiting there; this settles it.
    if (promptWidth > 0 && this.#start === 0) process.stderr.write("\r\n");
  }

  /** The row of the cursor counted from the first row of the prompt, as answerEndRow gives it. */
  get rowFromPrompt(): number {
    return this.#promptRows + this.#cursorRow;
  }

  /** Shows the answer of `length` bytes with the cursor at `cursor`; `typedAtEnd` only adds. */
  update(length: number, cursor: number, typedAtEnd = false): void {
    if (typedAtEnd) {
      const end = this.#endOf(length);
      process.stderr.write(this.#line.subarray(previousCharacter(this.#line, cursor), cursor));
      this.#cursorRow = this.#settle(end);
      return;
    }
    const out = process.stderr;
    out.write(`${cursorUp(this.#cursorRow)}\r${cursorRight(this.#start)}${ERASE_BELOW}`);
    // Erased with the answer: the next hint is drawn anew.
    this.#hintShown = false;
    out.write(this.#line.subarray(0, length));
    this.#countedBytes = 0;
    this.#countedEnd = this.#start;
    const endRow = this.#settle(this.#endOf(length));
    const target = this.#cellOf(cursor, length);
    const row = Math.floor(target / this.#columns);
    out.write(`${cursorUp(endRow - row)}\r${cursorRight(target % this.#columns)}`);
    this.#cursorRow = row;
  }

  /**
   * Shows `hint` below the answer of `length` bytes, in place of the one before, and puts the
   * cursor back at `cursor`. The rows are written from the end of the answer with line breaks, so
   * that the screen scrolls for them, and the cursor goes back up with relative moves.
   */
  showHint(hint: WordHint, length: number, cursor: number): void {
    const rows = hintRows(hint, this.#columns);
    if (rows.length === 0 && !this.#hintShown) return;
    const end = this.#endOf(length);
    const endRow = Math.floor(end / this.#columns);
    // Typing at the end needs no count from the start (endOf).
    const target = cursor === length ? end : this.#cellOf(cursor, length);
    const below = rows.map((row) => `\r\n${row}`).join("");
    process.stderr.write(
      `${this.#toEnd(end)}${ERASE_BELOW}${below}` +
        `${cursorUp(rows.length + endRow - this.#cursorRow)}\r${cursorRight(target % this.#columns)}`,
    );
    this.#hintShown = rows.length > 0;
  }

  /** Takes the hint off the screen, which leaves the cursor at the end of the answer. */
  clearHint(length: number): void {
    if (!this.#hintShown) return;
    const end = this.#endOf(length);
    process.stderr.write(`${this.#toEnd(end)}${ERASE_BELOW}`);
    this.#cursorRow = Math.floor(end / this.#columns);
    this.#hintShown = false;
  }

  /** The moves from the cursor to `end`, the cell after the answer. */
  #toEnd(end: number): string {
    return `${cursorDown(Math.floor(end / this.#columns) - this.#cursorRow)}\r${cursorRight(end % this.#columns)}`;
  }

  /**
   * The cell of the character at `cursor`, where the cursor is shown on it: after the characters
   * before it, or at the start of the next row for a wide one that the right edge pushed there.
   * At the end of the answer, where the next character would go.
   */
  #cellOf(cursor: number, length: number): number {
    const before = placedAfter(this.#line, 0, cursor, this.#start, this.#columns);
    if (cursor === length) return before;
    const end = nextCharacter(this.#line, cursor, length);
    const after = placedAfter(this.#line, cursor, end, before, this.#columns);
    return after - displayWidthOf(this.#line, cursor, end);
  }

  /**
   * Where the terminal has the cursor after the first `length` bytes, counted on from the
   * characters already counted. Only typing at the end adds bytes between two redraws, so what is
   * counted stays as it was. A character not complete yet is counted the next time.
   */
  #endOf(length: number): number {
    while (this.#countedBytes < length) {
      const size = characterSize(defined(this.#line[this.#countedBytes]));
      if (this.#countedBytes + size > length) break;
      this.#countedEnd = placedAfter(
        this.#line,
        this.#countedBytes,
        this.#countedBytes + size,
        this.#countedEnd,
        this.#columns,
      );
      this.#countedBytes += size;
    }
    return this.#countedEnd;
  }

  /**
   * The row the cursor is on after writing up to `offset`. At the right edge a terminal waits
   * before it wraps; a new line moves the cursor to where the next character would go.
   */
  #settle(offset: number): number {
    if (offset > 0 && offset % this.#columns === 0) process.stderr.write("\r\n");
    return Math.floor(offset / this.#columns);
  }
}

/** Where the UTF-8 character before `position` starts: its continuation bytes, then its first. */
function previousCharacter(line: Buffer, position: number): number {
  let start = position;
  while (start > 0 && isContinuation(defined(line[start - 1]))) start -= 1;
  return Math.max(0, start - 1);
}

/** Where the UTF-8 character at `position` ends. */
function nextCharacter(line: Buffer, position: number, length: number): number {
  let end = position + 1;
  while (end < length && isContinuation(defined(line[end]))) end += 1;
  return Math.min(end, length);
}

/** The start of the word before `position`: back over spaces, then over the word. */
function previousWord(line: Buffer, position: number): number {
  let start = position;
  while (start > 0 && line[start - 1] === KEY.SPACE) start -= 1;
  while (start > 0 && line[start - 1] !== KEY.SPACE) start -= 1;
  return start;
}

/** The end of the word after `position`: on over spaces, then over the word. */
function nextWord(line: Buffer, position: number, length: number): number {
  let end = position;
  while (end < length && line[end] === KEY.SPACE) end += 1;
  while (end < length && line[end] !== KEY.SPACE) end += 1;
  return end;
}

/** Whether the bytes up to `length` end with a complete UTF-8 character. */
function isCharacterEnd(line: Buffer, length: number): boolean {
  let start = length - 1;
  while (start > 0 && isContinuation(defined(line[start]))) start -= 1;
  return length - start === characterSize(defined(line[start]));
}
