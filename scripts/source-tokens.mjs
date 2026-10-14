// The tokens of TypeScript and JavaScript source, read with a small tokenizer of its own, so that
// the checks that read code need no package: the copy check (verify-no-copies.mjs) and the code
// rules (verify-code-rules.mjs). Not a full parser of TypeScript, but the same code always gives
// the same tokens, and strings, templates, regular expressions and comments are told apart from
// code.

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
