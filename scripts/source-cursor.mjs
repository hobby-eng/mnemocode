// A cursor over the text of a source file for the scanners that tell its code from its comments:
// the lines of code of CORE-15 (lines-of-code.mjs) and the quoting of shell scripts
// (shell-source.mjs). It knows the line it stands on and which lines hold code.

/** The characters that never make a line hold code. */
const BLANKS = new Set([" ", "\t", "\r", "\f", "\v", "\n"]);

/** Reads a text from its start, one piece at a time. */
export class SourceCursor {
  /** The numbers, from 1, of the lines that hold code. */
  code = new Set();
  #text;
  #at = 0;
  #line = 1;

  constructor(text) {
    this.#text = text;
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

  /** The rest of the current line, without its line break. */
  restOfLine() {
    const end = this.#text.indexOf("\n", this.#at);
    return this.#text.slice(this.#at, end < 0 ? this.#text.length : end);
  }

  /**
   * Moves past `count` characters. Each line where one of them is not blank holds code, unless
   * they are a comment.
   */
  take(count = 1, comment = false) {
    const end = Math.min(this.#at + count, this.#text.length);
    for (; this.#at < end; this.#at += 1) {
      const character = this.#text[this.#at];
      if (character === "\n") this.#line += 1;
      else if (!comment && !BLANKS.has(character)) this.code.add(this.#line);
    }
  }

  /** Moves past the rest of the current line, not its line break. */
  takeLine(comment = false) {
    this.take(this.restOfLine().length, comment);
  }

  /** Moves as far as the end of the first `closer` ahead, or the end of the text. */
  takePast(closer, comment = false) {
    const end = this.#text.indexOf(closer, this.#at);
    this.take(end < 0 ? this.#text.length - this.#at : end - this.#at + closer.length, comment);
  }
}
