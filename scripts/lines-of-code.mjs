// The lines of code of a file that the linter does not measure, for CORE-15 of the coding guide: a
// line that holds nothing but a comment, in the comment syntax of the file's language, and a blank
// line are left out, and so are the lines of a Rust file's #[cfg(test)] modules. Each language is
// read with its strings, so that a comment marker inside a string, a raw string or a Markdown code
// block is text, and text that starts with "#" or "/*" stays code.

import { basename, extname } from "node:path";
import { SourceCursor } from "./source-cursor.mjs";
import { isShellScript, readShell } from "./shell-source.mjs";
import { afterGroup } from "./source-tokens.mjs";

/** A sticky match of a Rust raw string's opening: r"…", r#"…"#, br"…" or cr"…". */
const RUST_RAW_STRING = /(?<![\w])[bc]?r(#*)"/uy;
/** A sticky match of a Rust string's opening, a byte string's and a C string's included. */
const RUST_STRING = /(?:(?<![\w])[bc])?"/uy;
/** A sticky match of a Rust character literal: 'x', '\n', '\x7f', '\u{1F600}' or b'x'. */
const RUST_CHARACTER =
  /(?:(?<![\w])b)?'(?:\\(?:x[\da-fA-F]{2}|u\{[\da-fA-F_]{1,8}\}|[^\n])|[^'\\\n])'/uy;
/** A sticky match of a Rust word: a name, a raw name such as r#type, or a number. */
const RUST_WORD = /r#[\p{L}_][\p{L}\p{N}_]*|[\p{L}\p{N}_]+/uy;
/** The attribute that marks a Rust module of unit tests, as its tokens. */
const TEST_ATTRIBUTE = ["#", "[", "cfg", "(", "test", ")", "]"];
/** A sticky match of a Markdown code fence that starts a line, and the rest of that line. */
const FENCE = /( {0,3})(`{3,}|~{3,})([^\n]*)/uy;

/**
 * Reads the code of each language whose files this check measures; the linter measures TypeScript
 * and JavaScript.
 */
const READERS = {
  ".md": markdownCode,
  ".py": (text) => hashCode(text, ['"', "'"]),
  ".rs": rustCode,
  ".sh": (text) => readShell(text).code,
  // TOML's literal strings, '…', take no escapes.
  ".toml": (text) => hashCode(text, ['"']),
  ".txt": hashLineCode,
  ".yaml": hashLineCode,
  ".yml": hashLineCode,
};

/**
 * The numbers, in order, of the lines of `path` that hold code, or undefined for a file that this
 * check does not measure.
 */
export function linesOfCode(path, text) {
  const name = basename(path);
  let read = Object.hasOwn(READERS, extname(name)) ? READERS[extname(name)] : undefined;
  if (name.startsWith("Dockerfile")) read = hashLineCode;
  else if (read === undefined && isShellScript(path, text)) read = READERS[".sh"];
  return read === undefined ? undefined : [...read(text)].sort((a, b) => a - b);
}

/**
 * The lines of code of a language whose comments run from "#" to the end of the line, with strings
 * in single, double and tripled quotes that may span lines (Python, TOML); `escaping` lists the
 * quotes whose strings take backslash escapes.
 */
function hashCode(text, escaping) {
  const cursor = new SourceCursor(text);
  while (!cursor.done) {
    const character = cursor.peek();
    if (character === "#") cursor.takeLine(true);
    else if (character === '"' || character === "'") {
      const closer = cursor.sees(character.repeat(3)) ? character.repeat(3) : character;
      cursor.take(closer.length);
      // A string in single quotes ends at its line, closed or not.
      while (!cursor.done && !cursor.sees(closer) && (closer.length > 1 || cursor.peek() !== "\n"))
        cursor.take(escaping.includes(character) && cursor.peek() === "\\" ? 2 : 1);
      if (cursor.sees(closer)) cursor.take(closer.length);
    } else cursor.take();
  }
  return cursor.code;
}

/**
 * The lines of code of a file whose comments are whole lines that start with "#" (YAML, requirement
 * files, Dockerfiles). A block of YAML text is read the same way: what it holds is a script whose
 * comments start with "#" too, such as a workflow's `run: |`.
 */
function hashLineCode(text) {
  const code = new Set();
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) code.add(index + 1);
  });
  return code;
}

/**
 * The lines of code of Markdown: a line of a fenced code block is code whatever it holds, and so is
 * a span of inline code; an HTML comment, <!-- … -->, is the only comment.
 */
function markdownCode(text) {
  const cursor = new SourceCursor(text);
  let fence;
  let inComment = false;
  while (!cursor.done) {
    const fenceLine = cursor.match(FENCE);
    if (inComment) inComment = markdownProse(cursor, true);
    else if (fence !== undefined) {
      const [, , marker, rest] = fenceLine ?? [];
      if (marker?.[0] === fence[0] && marker.length >= fence.length && rest.trim() === "")
        fence = undefined;
      cursor.takeLine();
      cursor.take();
    } else if (
      fenceLine !== undefined &&
      !(fenceLine[2][0] === "`" && fenceLine[3].includes("`"))
    ) {
      fence = fenceLine[2];
      cursor.takeLine();
      cursor.take();
    } else inComment = markdownProse(cursor, false);
  }
  return cursor.code;
}

/**
 * One line of Markdown prose from the cursor, or from inside an HTML comment when `inComment`:
 * whether a comment is still open at the line's end.
 */
function markdownProse(cursor, inComment) {
  let open = inComment;
  while (!cursor.done && cursor.peek() !== "\n") {
    if (open) {
      const end = cursor.restOfLine().indexOf("-->");
      cursor.take(end < 0 ? cursor.restOfLine().length : end + 3, true);
      open = end < 0;
    } else if (cursor.sees("<!--")) {
      cursor.take(4, true);
      open = true;
    } else if (cursor.peek() === "`") {
      // A span of inline code ends at the next run of as many backticks on its line.
      const run = cursor.match(/`+/uy)[0];
      const rest = cursor.restOfLine().slice(run.length);
      const close = new RegExp(`(?<!\`)${run}(?!\`)`, "u").exec(rest);
      cursor.take(close === null ? run.length : run.length + close.index + run.length);
    } else cursor.take();
  }
  cursor.take();
  return open;
}

/**
 * The lines of code of Rust, the lines of its #[cfg(test)] modules left out (CORE-15). Comments
 * nest, strings and raw strings may span lines, and a quote starts a character literal or a
 * lifetime.
 */
function rustCode(text) {
  const cursor = new SourceCursor(text);
  const tokens = [];
  while (!cursor.done) {
    const line = cursor.line;
    if (cursor.sees("//")) cursor.takeLine(true);
    else if (cursor.sees("/*")) rustComment(cursor);
    else if (/\s/u.test(cursor.peek())) cursor.take();
    else tokens.push({ key: rustToken(cursor), line });
  }
  const tests = rustTestModules(tokens);
  return new Set(
    [...cursor.code].filter(
      (line) => !tests.some(([first, last]) => line >= first && line <= last),
    ),
  );
}

/** A Rust block comment, with the block comments nested in it. */
function rustComment(cursor) {
  let depth = 0;
  do {
    if (cursor.sees("/*")) depth += 1;
    else if (cursor.sees("*/")) depth -= 1;
    cursor.take(cursor.sees("/*") || cursor.sees("*/") ? 2 : 1, true);
  } while (depth > 0 && !cursor.done);
}

/**
 * Reads one Rust token at the cursor and gives its key: a word, a punctuation mark, or '""' for a
 * string and "''" for a character literal, whose text the search for test modules never needs.
 */
function rustToken(cursor) {
  const raw = cursor.match(RUST_RAW_STRING);
  const string = cursor.match(RUST_STRING);
  const literal = cursor.match(RUST_CHARACTER);
  const word = cursor.match(RUST_WORD);
  if (raw !== undefined) {
    // A raw string ends at a quote followed by as many hashes as it opened with; it has no escapes.
    cursor.take(raw[0].length);
    cursor.takePast(`"${raw[1]}`);
    return '""';
  }
  if (string !== undefined) {
    rustString(cursor, string[0].length);
    return '""';
  }
  // A quote that starts no character literal starts a lifetime or a label, 'a.
  const key = (literal ?? word)?.[0] ?? cursor.peek();
  cursor.take(key.length);
  return literal === undefined ? key : "''";
}

/** A Rust string after its `opening` characters, as far as its closing quote, past escapes. */
function rustString(cursor, opening) {
  cursor.take(opening);
  while (!cursor.done && cursor.peek() !== '"') cursor.take(cursor.peek() === "\\" ? 2 : 1);
  cursor.take();
}

/**
 * The first and last lines of each module of unit tests: `#[cfg(test)]`, other attributes and
 * comments, then `mod name { … }`, public or not.
 */
function rustTestModules(tokens) {
  const modules = [];
  for (let at = 0; at < tokens.length; at += 1) {
    if (!TEST_ATTRIBUTE.every((key, offset) => tokens[at + offset]?.key === key)) continue;
    let next = at + TEST_ATTRIBUTE.length;
    while (tokens[next]?.key === "#" && tokens[next + 1]?.key === "[")
      next = afterGroup(tokens, next + 1);
    if (tokens[next]?.key === "pub")
      next = tokens[next + 1]?.key === "(" ? afterGroup(tokens, next + 1) : next + 1;
    if (tokens[next]?.key !== "mod" || tokens[next + 2]?.key !== "{") continue;
    const end = afterGroup(tokens, next + 2);
    modules.push([tokens[at].line, tokens[end - 1].line]);
    at = end - 1;
  }
  return modules;
}
