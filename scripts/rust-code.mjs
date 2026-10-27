// Rust source read as far as the code rules need it (verify-code-rules.mjs): the text with its
// comments and the contents of its strings and characters blanked, so that a `crate::` or an
// `unsafe` inside a comment or a string is not taken for code, and the lines of its unit-test
// modules. Line and column positions stay as in the file. Not a parser: the same file always
// gives the same reading, which is all the checks need.

/** A sticky match of a raw string's opening: r"…", r#"…"#, br"…" or cr"…". */
const RAW_STRING = /(?<![\p{L}\p{N}_])[bc]?r(#*)"/uy;
/** A sticky match of a string's opening, a byte string's and a C string's included. */
const STRING = /(?:(?<![\p{L}\p{N}_])[bc])?"/uy;
/** A sticky match of a character literal: 'x', '\n', '\x7f', '\u{1F600}' or b'x'. */
const CHARACTER =
  /(?:(?<![\p{L}\p{N}_])b)?'(?:\\(?:x[\da-fA-F]{2}|u\{[\da-fA-F_]{1,8}\}|[^\n])|[^'\\\n])'/uy;
/** A sticky match of a word: a name, a raw name such as r#type, or a number. */
const WORD = /r#[\p{L}_][\p{L}\p{N}_]*|[\p{L}\p{N}_]+/uy;
/** The attribute and item that open a module of unit tests. */
const TEST_MODULE =
  /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[\p{L}_][\p{L}\p{N}_]*\s*\{/gu;

/** `chars` with every character from `from` up to `to` blanked, line breaks kept. */
function blank(chars, from, to) {
  for (let at = from; at < to; at += 1) if (chars[at] !== "\n") chars[at] = " ";
}

/** Where a block comment that opens at `at` ends, after its last character; comments nest. */
function blockCommentEnd(text, at) {
  let depth = 0;
  let index = at;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else index += 1;
  }
  return text.length;
}

/** Where a string whose content starts at `at` closes: the index of its closing quote. */
function stringEnd(text, at) {
  let index = at;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return Math.min(index, text.length);
}

/** Matches the sticky `pattern` at `at`, or undefined. */
function stickyAt(pattern, text, at) {
  pattern.lastIndex = at;
  return pattern.exec(text) ?? undefined;
}

/** `text` with comments and the insides of strings and characters replaced by spaces. */
export function blankRust(text) {
  const chars = [...text];
  // Positions below are of UTF-16 code units; work on a string with one unit per character.
  const plain = chars.map((char) => (char.length > 1 ? "x" : char)).join("");
  const out = plain.split("");
  let at = 0;
  while (at < plain.length) {
    if (plain.startsWith("//", at)) {
      const end = plain.indexOf("\n", at);
      const stop = end < 0 ? plain.length : end;
      blank(out, at, stop);
      at = stop;
      continue;
    }
    if (plain.startsWith("/*", at)) {
      const end = blockCommentEnd(plain, at);
      blank(out, at, end);
      at = end;
      continue;
    }
    const raw = stickyAt(RAW_STRING, plain, at);
    if (raw !== undefined) {
      const open = at + raw[0].length;
      const close = plain.indexOf(`"${raw[1]}`, open);
      const end = close < 0 ? plain.length : close;
      blank(out, open, end);
      at = end + 1 + raw[1].length;
      continue;
    }
    const string = stickyAt(STRING, plain, at);
    if (string !== undefined) {
      const open = at + string[0].length;
      const end = stringEnd(plain, open);
      blank(out, open, end);
      at = end + 1;
      continue;
    }
    const character = stickyAt(CHARACTER, plain, at);
    if (character !== undefined) {
      blank(out, at + character[0].indexOf("'") + 1, at + character[0].length - 1);
      at += character[0].length;
      continue;
    }
    const word = stickyAt(WORD, plain, at);
    at += word === undefined ? 1 : word[0].length;
  }
  return out.join("");
}

/** The number, from 1, of the line that index `at` of `text` stands on. */
export function lineAt(text, at) {
  let line = 1;
  for (
    let index = text.indexOf("\n");
    index >= 0 && index < at;
    index = text.indexOf("\n", index + 1)
  )
    line += 1;
  return line;
}

/** Where the brace group that opens at `open` closes, after its closing brace. */
function braceGroupEnd(code, open) {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === "{") depth += 1;
    else if (code[at] === "}") {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return code.length;
}

/** The [first, last] line ranges of the unit-test modules of the blanked `code`. */
export function testModuleLines(code) {
  const ranges = [];
  for (const match of code.matchAll(TEST_MODULE)) {
    const open = match.index + match[0].length - 1;
    ranges.push([lineAt(code, match.index), lineAt(code, braceGroupEnd(code, open))]);
  }
  return ranges;
}
