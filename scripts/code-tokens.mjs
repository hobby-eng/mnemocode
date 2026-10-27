// The tokens of Rust and JavaScript source, read with a small tokenizer of its own, so that the
// gate scripts need no package: the copy check (verify-no-copies.mjs) and the lines of code of
// CORE-15 (lines-of-code.mjs, verify-code-rules.mjs). The tokenizer is mhfe's (its
// scripts/verify-no-copies.mjs reads both languages); afterGroup is MnemoCode TS's
// (scripts/source-tokens.mjs). Not a full parser of either language, but the same code always
// gives the same tokens.

/** The marker of a deliberate copy, in a comment in or just above the copied lines. */
export const DELIBERATE = /deliberate copy/iu;

/** After these JavaScript tokens a slash starts a regular expression, not a division. */
const BEFORE_REGEX = new Set([
  ..."(,=:[!&|?{};+-*%<>~^",
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

/** A Rust character literal at the start of the text: 'a', '\n', '\'', '\u{1F600}'. */
const RUST_CHAR = /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/u;
/** A Rust raw string at the start of the text, with any prefix: r"…", r#"…"#, br##"…"##. */
const RUST_RAW = /^(?:b|c)?r(#*)"/u;

/**
 * The tokens of `text`, white space and comments left out, each with the line it starts on: words
 * and numbers whole, every string, character, template and regular expression as one token, and
 * every other character as a token of its own. Not a full parser of either language, but the same
 * code always gives the same tokens, which is all that finding copies needs. `rust` reads Rust:
 * nested block comments, raw and byte strings, and lifetimes told apart from characters. Also
 * gives the lines on which a comment marks a deliberate copy: only a comment marks one, never a
 * string that holds the words (AUD-013-ARC002); and every comment with its first and last line.
 */
export function tokensOf(text, rust) {
  const tokens = [];
  const markedLines = new Set();
  /** Every comment with the lines it spans, for the checks that read markers such as `long:`. */
  const comments = [];
  let line = 1;
  /** Records the comment `from`..`at`, and its lines when it marks a deliberate copy. */
  const comment = (from) => {
    const body = text.slice(from, at);
    comments.push({ text: body, first: line, last: line + body.split("\n").length - 1 });
    if (!DELIBERATE.test(body)) return;
    // Every line of the comment, so that its last line counts as the line above the copy.
    body.split("\n").forEach((_, offset) => markedLines.add(line + offset));
  };
  let at = 0;
  const push = (from) => {
    const key = text.slice(from, at);
    tokens.push({ key, line });
    line += key.split("\n").length - 1;
  };
  /** Moves past a string whose opening quote is at `at`, as far as its closing `quote`. */
  const skipQuoted = (quote) => {
    at += 1;
    while (at < text.length && text[at] !== quote) at += text[at] === "\\" ? 2 : 1;
    at += 1;
  };
  while (at < text.length) {
    const char = text[at];
    const rest = text.slice(at, at + 16);
    if (char === "\n") {
      line += 1;
      at += 1;
    } else if (/\s/u.test(char)) at += 1;
    else if (text.startsWith("//", at)) {
      const from = at;
      while (at < text.length && text[at] !== "\n") at += 1;
      comment(from);
    } else if (text.startsWith("/*", at)) {
      const from = at;
      if (rust) {
        // Rust nests block comments.
        let depth = 0;
        while (at < text.length) {
          if (text.startsWith("/*", at)) {
            depth += 1;
            at += 2;
          } else if (text.startsWith("*/", at)) {
            depth -= 1;
            at += 2;
            if (depth === 0) break;
          } else at += 1;
        }
      } else {
        const close = text.indexOf("*/", at + 2);
        at = close < 0 ? text.length : close + 2;
      }
      comment(from);
      line += text.slice(from, at).split("\n").length - 1;
    } else if (rust && RUST_RAW.test(rest)) {
      const [opening, hashes] = RUST_RAW.exec(rest);
      const from = at;
      const close = text.indexOf(`"${hashes}`, at + opening.length);
      at = close < 0 ? text.length : close + 1 + hashes.length;
      push(from);
    } else if (rust && (rest.startsWith('b"') || rest.startsWith('c"'))) {
      const from = at;
      at += 1;
      skipQuoted('"');
      push(from);
    } else if (rust && rest.startsWith("b'") && RUST_CHAR.test(rest.slice(1))) {
      const from = at;
      at += 1 + RUST_CHAR.exec(rest.slice(1))[0].length;
      push(from);
    } else if (rust && char === "'") {
      // A character literal, or a lifetime or label: the quote and its name.
      const from = at;
      const literal = RUST_CHAR.exec(text.slice(at, at + 16));
      if (literal) at += literal[0].length;
      else {
        at += 1;
        while (at < text.length && /[\p{L}\p{N}_]/u.test(text[at])) at += 1;
      }
      push(from);
    } else if (/[\p{L}_$]/u.test(char)) {
      const from = at;
      while (at < text.length && /[\p{L}\p{N}_$]/u.test(text[at])) at += 1;
      push(from);
    } else if (/\d/u.test(char)) {
      const from = at;
      while (at < text.length && /[\w.]/u.test(text[at]) && !text.startsWith("..", at)) at += 1;
      push(from);
    } else if (char === '"' || (!rust && char === "'")) {
      const from = at;
      skipQuoted(char);
      push(from);
    } else if (!rust && char === "`") {
      // A template with its expressions, as far as the backtick that closes it.
      const from = at;
      at += 1;
      let depth = 0;
      while (at < text.length && !(text[at] === "`" && depth === 0)) {
        if (text[at] === "\\") at += 1;
        else if (text.startsWith("${", at)) depth += 1;
        else if (text[at] === "}" && depth > 0) depth -= 1;
        at += 1;
      }
      at += 1;
      push(from);
    } else if (
      !rust &&
      char === "/" &&
      (tokens.length === 0 || BEFORE_REGEX.has(tokens.at(-1).key))
    ) {
      const from = at;
      at += 1;
      let inClass = false;
      while (at < text.length && (text[at] !== "/" || inClass) && text[at] !== "\n") {
        if (text[at] === "\\") at += 1;
        else if (text[at] === "[") inClass = true;
        else if (text[at] === "]") inClass = false;
        at += 1;
      }
      at += 1;
      while (at < text.length && /[a-z]/u.test(text[at])) at += 1;
      push(from);
    } else {
      const from = at;
      at += 1;
      push(from);
    }
  }
  return { tokens, markedLines, comments };
}

/** The bracket that closes each opening one. */
const CLOSING = { "(": ")", "[": "]", "{": "}" };

/**
 * The index of the token after the bracket that closes the one at `open`, a `(`, `[` or `{`, in
 * any list of tokens with a `key`; the length of the list when it never closes.
 */
export function afterGroup(tokens, open) {
  const opening = tokens[open].key;
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    if (tokens[at].key === opening) depth += 1;
    else if (tokens[at].key === CLOSING[opening] && --depth === 0) return at + 1;
  }
  return tokens.length;
}
