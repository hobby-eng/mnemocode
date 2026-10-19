// A cursor over the text of a source file for the scanners that tell its code from its comments:
// the lines of code of CORE-15 (lines-of-code.mjs) and the quoting of shell scripts
// (shell-source.mjs). It knows the line it stands on and which lines hold code.

/** The characters that never make a line hold code. */
const BLANKS = new Set([" ", "\t", "\r", "\f", "\v", "\n"]);

/** Reads a text from its start, one piece at a time. */
export class SourceCursor {
  #text;
  #at = 0;
  #line = 1;
  #code = new Set();

  constructor(text) {
    this.#text = text;
  }

  /** The numbers, from 1, of the lines that hold code so far, as a set of the caller's own. */
  get code() {
    return new Set(this.#code);
  }

  /** Whether the whole text has been read. */
  get done() {
    return this.#at >= this.#text.length;
  }

  /** The number, from 1, of the line that the cursor stands on. */
  get line() {
    return this.#line;
  }

  /** The character `offset` characters from the cursor (-1 is the one before it), or "". */
  peek(offset = 0) {
    return this.#text[this.#at + offset] ?? "";
  }

  /** Whether the text goes on with `prefix`. */
  sees(prefix) {
    return this.#text.startsWith(prefix, this.#at);
  }

  /** The match of the sticky `pattern` at the cursor, or undefined. */
  match(pattern) {
    pattern.lastIndex = this.#at;
    return pattern.exec(this.#text) ?? undefined;
  }

  /** The current line up to the cursor. */
  lineSoFar() {
    return this.#text.slice(this.#text.lastIndexOf("\n", this.#at - 1) + 1, this.#at);
  }

  /** The rest of the current line, without its line break. */
  restOfLine() {
    const end = this.#text.indexOf("\n", this.#at);
    return this.#text.slice(this.#at, end < 0 ? this.#text.length : end);
  }

  /** Moves past `count` characters of code: each line where one of them is not blank holds code. */
  take(count = 1) {
    this.#move(count, true);
  }

  /** Moves past `count` characters of a comment, which make no line hold code. */
  takeComment(count) {
    this.#move(count, false);
  }

  /** Moves past the rest of the current line, not its line break. */
  takeLine() {
    this.take(this.restOfLine().length);
  }

  /** Moves past a comment that runs to the end of the line, not its line break. */
  takeCommentLine() {
    this.takeComment(this.restOfLine().length);
  }

  /** Moves as far as the end of the first `closer` ahead, or the end of the text. */
  takePast(closer) {
    const end = this.#text.indexOf(closer, this.#at);
    this.take(end < 0 ? this.#text.length - this.#at : end - this.#at + closer.length);
  }

  /**
   * Moves past the rest of a string as far as its `closer`: past a backslash and the character it
   * escapes where it `escapes`, and only to the end of its line, closed or not, where it
   * `endsAtLine`. A string that is a `comment`, such as a docstring, makes no line hold code.
   */
  takeString(closer, { escapes = true, endsAtLine = false, comment = false } = {}) {
    while (!this.done && !this.sees(closer) && !(endsAtLine && this.peek() === "\n"))
      this.#move(escapes && this.peek() === "\\" ? 2 : 1, !comment);
    if (this.sees(closer)) this.#move(closer.length, !comment);
  }

  #move(count, code) {
    const end = Math.min(this.#at + count, this.#text.length);
    for (; this.#at < end; this.#at += 1) {
      const character = this.#text[this.#at];
      if (character === "\n") this.#line += 1;
      else if (code && !BLANKS.has(character)) this.#code.add(this.#line);
    }
  }
}
