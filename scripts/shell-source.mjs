// A shell script read as bash reads it, as far as the code rules need it: which lines hold code
// (CORE-15) and which expansions stand outside quotes (TOOL-02). The whole text is read at once,
// as quotes, command substitutions and here-documents may span lines, and each opens a context of
// its own: in "$(dirname "$0")" both expansions are quoted, while in "$(basename $file)" the inner
// one is not. The body of a here-document is text, not code: a command substitution in it is not
// checked. A `case` pattern's `)` inside a command substitution is not told apart from the one
// that closes it.

import { SourceCursor } from "./source-cursor.mjs";

/** A character after which a word starts, so that a `#` there starts a comment. */
const WORD_BREAK = /[\s;&|()<>]/u;
/** What makes a `$` an expansion: a name, a digit or a special parameter; `${` and `$(` aside. */
const PARAMETER = /[\p{L}_0-9@*#?!$-]/u;
/** The operators of an extended pattern before its parentheses, such as @(a|b) and +(a). */
const PATTERN_OPERATORS = new Set(["?", "*", "+", "@"]);
/** A here-document's operator and its delimiter: <<EOF, <<-'EOF', << "EOF", <<\EOF. */
const HERE_DOCUMENT = /<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([\w.-]+))/uy;

/**
 * Whether `text` is a shell script: by its name, or by a first line that runs sh, bash, dash or
 * zsh.
 */
export function isShellScript(path, text) {
  return (
    path.endsWith(".sh") ||
    /^#!\s*\/(?:usr\/)?bin\/(?:env\s+(?:-S\s+)?)?(?:ba|da|z)?sh\b/u.test(text)
  );
}

/**
 * The lines of a shell script that hold code, and the line of every expansion outside quotes, in
 * order.
 */
export function readShell(text) {
  const cursor = new SourceCursor(text);
  const reader = new ShellReader(cursor);
  while (!cursor.done) reader.step();
  return { code: cursor.code, unquoted: reader.unquoted };
}

/**
 * Reads one piece of a shell script at a time, in the context that the pieces before opened:
 * code, a double-quoted string, an arithmetic expression or a backtick substitution.
 */
class ShellReader {
  /** The line of every expansion outside quotes. */
  unquoted = [];
  #cursor;
  /**
   * The open contexts, innermost last: `kind`; the `closer` of a command substitution's code, ")";
   * for code and arithmetic the `depth` of the parentheses open in it; for code the `tests` open
   * in it, [[ … ]].
   */
  #contexts = [{ kind: "code", closer: undefined, depth: 0, tests: 0 }];
  /** The here-documents whose bodies start after the current line: their delimiters. */
  #pending = [];

  constructor(cursor) {
    this.#cursor = cursor;
  }

  /** Reads the next piece in the innermost context. */
  step() {
    const context = this.#contexts.at(-1);
    if (context.kind === "double") this.#double();
    else if (context.kind === "arithmetic") this.#arithmetic(context);
    else this.#code(context);
  }

  /** Code, outside quotes: where every expansion is reported, and comments and here-documents. */
  #code(context) {
    const cursor = this.#cursor;
    const character = cursor.peek();
    if (character === "\\") cursor.take(2);
    else if (character === "\n") {
      cursor.take();
      this.#hereDocumentBodies();
    } else if (character === "#" && this.#wordStarts()) cursor.takeCommentLine();
    else if (character === "'") {
      cursor.take();
      cursor.takeString("'", { escapes: false });
    } else if (cursor.sees("$'")) {
      // $'…', a string whose backslashes escape, its own quote included.
      cursor.take(2);
      cursor.takeString("'");
    } else if (character === '"' || cursor.sees('$"'))
      this.#open("double", cursor.sees("$") ? 2 : 1);
    else if (character === "$" || character === "`") this.#expansion(context, true);
    // [[ … ]] holds patterns, in which parentheses group: ^((a|b)c)$ after =~ is no arithmetic.
    else if (cursor.sees("[[") && this.#wordStarts()) this.#test(context, 1);
    else if (cursor.sees("]]") && context.tests > 0) this.#test(context, -1);
    // (( … )) is arithmetic, also in while((…)), in a case arm and after time, but for the group of
    // an extended pattern, @((a|b)c), and parentheses inside [[ … ]].
    else if (cursor.sees("((") && context.tests === 0 && !PATTERN_OPERATORS.has(cursor.peek(-1)))
      this.#open("arithmetic", 2);
    else if (character === "(" || character === ")") this.#parenthesis(context);
    // A here-string, <<< word, is code; only << opens a here-document.
    else if (cursor.sees("<<<")) cursor.take(3);
    else if (cursor.sees("<<")) this.#hereDocument();
    else cursor.take();
  }

  /** A double-quoted string: expansions in it are quoted, command substitutions are code. */
  #double() {
    const cursor = this.#cursor;
    const character = cursor.peek();
    if (character === "\\") cursor.take(2);
    else if (character === '"') this.#close(1);
    else if (character === "$" || character === "`") this.#expansion(undefined, false);
    else cursor.take();
  }

  /** An arithmetic expression, $(( … )) or (( … )): names in it are never split into words. */
  #arithmetic(context) {
    const cursor = this.#cursor;
    if (cursor.sees("$(") && !cursor.sees("$((")) this.#open("code", 2, ")");
    else if (cursor.peek() === "(") {
      context.depth += 1;
      cursor.take();
    } else if (cursor.sees("))") && context.depth === 0) this.#close(2);
    else if (cursor.peek() === ")") {
      context.depth -= 1;
      cursor.take();
    } else cursor.take();
  }

  /**
   * A `$` or a backtick: an expansion, reported when it stands in code. Its own contexts open:
   * $(( … )), $( … ) and ` … `; ${ … } is read whole.
   */
  #expansion(context, inCode) {
    const cursor = this.#cursor;
    const report = () => {
      if (inCode) this.unquoted.push(cursor.line);
    };
    if (cursor.peek() === "`" && context?.kind === "backtick") this.#close(1);
    else if (cursor.peek() === "`") {
      report();
      this.#open("backtick", 1);
    } else if (cursor.sees("$((")) {
      report();
      this.#open("arithmetic", 3);
    } else if (cursor.sees("$(")) {
      report();
      this.#open("code", 2, ")");
    } else if (cursor.sees("${")) {
      report();
      this.#braces();
    } else if (PARAMETER.test(cursor.peek(1))) {
      report();
      cursor.take(2);
    } else cursor.take();
  }

  /** ${ … } as far as its closing brace, past the quotes and braces inside it. */
  #braces() {
    const cursor = this.#cursor;
    cursor.take(2);
    for (let depth = 1; depth > 0 && !cursor.done;) {
      const character = cursor.peek();
      if (character === "\\") cursor.take(2);
      else if (character === "'" || character === '"') {
        cursor.take();
        cursor.takeString(character);
      } else {
        if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
        cursor.take();
      }
    }
  }

  /** A parenthesis in code: it closes a command substitution only at the depth it opened at. */
  #parenthesis(context) {
    const cursor = this.#cursor;
    if (cursor.peek() === ")" && context.closer === ")" && context.depth === 0) this.#close(1);
    else {
      context.depth += cursor.peek() === "(" ? 1 : -1;
      cursor.take();
    }
  }

  /** A here-document's operator: its body starts after the current line. */
  #hereDocument() {
    const cursor = this.#cursor;
    const operator = cursor.match(HERE_DOCUMENT);
    if (operator === undefined) cursor.take(2);
    else {
      const [whole, tabs, single, double, bare] = operator;
      this.#pending.push({ delimiter: single ?? double ?? bare, tabs: tabs === "-" });
      cursor.take(whole.length);
    }
  }

  /** The bodies of the here-documents opened on the line just ended: text, up to each delimiter. */
  #hereDocumentBodies() {
    const cursor = this.#cursor;
    for (const { delimiter, tabs } of this.#pending.splice(0))
      while (!cursor.done) {
        // A script with Windows line ends has its delimiter before a carriage return.
        const line = cursor.restOfLine().replace(/\r$/u, "");
        cursor.takeLine();
        cursor.take();
        if ((tabs ? line.replace(/^\t+/u, "") : line) === delimiter) break;
      }
  }

  /** Whether a word starts at the cursor: at the text's start, or after a break. */
  #wordStarts() {
    const before = this.#cursor.peek(-1);
    return before === "" || WORD_BREAK.test(before);
  }

  /** Opens a context of `kind` after its `length` opening characters. */
  #open(kind, length, closer) {
    this.#cursor.take(length);
    this.#contexts.push({ kind, closer, depth: 0, tests: 0 });
  }

  /** A test's [[ (`change` 1) or its ]] (-1) in the code of `context`. */
  #test(context, change) {
    context.tests += change;
    this.#cursor.take(2);
  }

  /** Closes the innermost context after its `length` closing characters. */
  #close(length) {
    this.#cursor.take(length);
    if (this.#contexts.length > 1) this.#contexts.pop();
  }
}
