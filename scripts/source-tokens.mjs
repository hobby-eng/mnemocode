// The tokens of TypeScript and JavaScript source, read with a small tokenizer of its own, so that
// the checks that read code need no package: the copy check (verify-no-copies.mjs), the code
// rules (verify-code-rules.mjs) and the check of dead exports (verify-dead-exports.mjs). Not a
// full parser of TypeScript, but the same code always gives the same tokens, and strings,
// templates, regular expressions and comments are told apart from code. afterGroup finds a closing
// bracket in these tokens and in any others with a `key`, such as the Rust tokens of
// lines-of-code.mjs, and MEMBER_MODIFIERS names the words that may stand before a member's name.

/** After these tokens a slash starts a regular expression, not a division. */
const BEFORE_REGEX = new Set([
  ...Array.from("(,=:[!&|?{};+-*%<>~^"),
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

/**
 * The tokens of `text`, white space and comments left out, each with the line it starts on: words
 * and numbers whole, every string, template and regular expression as one token, and every other
 * character as a token of its own. Not a full parser of TypeScript, but the same code always gives
 * the same tokens, which is all that finding copies needs.
 */
export function tokensOf(text) {
  const tokens = [];
  // The comments, each with the lines it spans: only a comment may mark a deliberate copy.
  const comments = [];
  let line = 1;
  let at = 0;
  const push = (from) => {
    const key = text.slice(from, at);
    tokens.push({ key, line });
    line += key.split("\n").length - 1;
  };
  while (at < text.length) {
    const char = text[at];
    if (char === "\n") {
      line += 1;
      at += 1;
    } else if (/\s/u.test(char)) at += 1;
    else if (text.startsWith("//", at)) {
      const from = at;
      while (at < text.length && text[at] !== "\n") at += 1;
      comments.push({ text: text.slice(from, at), first: line, last: line });
    } else if (text.startsWith("/*", at)) {
      const close = text.indexOf("*/", at + 2);
      const end = close < 0 ? text.length : close + 2;
      const body = text.slice(at, end);
      const lines = body.split("\n").length - 1;
      comments.push({ text: body, first: line, last: line + lines });
      line += lines;
      at = end;
    } else if (/[\p{L}_$]/u.test(char)) {
      const from = at;
      while (at < text.length && /[\p{L}\p{N}_$]/u.test(text[at])) at += 1;
      push(from);
    } else if (/\d/u.test(char)) {
      const from = at;
      while (at < text.length && /[\w.]/u.test(text[at])) at += 1;
      push(from);
    } else if (char === '"' || char === "'") {
      const from = at;
      at += 1;
      while (at < text.length && text[at] !== char) at += text[at] === "\\" ? 2 : 1;
      at += 1;
      push(from);
    } else if (char === "`") {
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
    } else if (char === "/" && (tokens.length === 0 || BEFORE_REGEX.has(tokens.at(-1).key))) {
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
  return { tokens, comments };
}

/**
 * The modifiers that TypeScript allows before the name of a class or type member, each of which may
 * also be a name itself. The code rules read a member's name after them, and the check of dead
 * exports tells a key or a type member from a use of an export by them.
 */
export const MEMBER_MODIFIERS = Object.freeze([
  "public",
  "protected",
  "private",
  "readonly",
  "static",
  "declare",
  "abstract",
  "override",
  "accessor",
]);

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
