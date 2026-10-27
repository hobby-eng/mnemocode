// Which modules a Rust file uses and which attributes it carries, read from its blanked code
// (rust-code.mjs), for the layers and the lint parts of verify-code-rules.mjs:
//
// - every path that starts with `crate::`, `super::` or `self::`, braced groups included
//   (`use crate::{bip39, wallet::Coin}` uses bip39 and wallet), resolved against the file's module
//   path and the inline modules around it, gives the top module it reaches; and every path that
//   starts with an outside crate's name, such as `mnemocode::`, gives that crate's top module;
// - every attribute, `#[…]` or `#![…]` with its brackets balanced, and the lints it allows,
//   expects, warns, denies or forbids, those inside `cfg_attr(…)` included.

import { lineAt } from "./rust-code.mjs";

const NAME = "[\\p{L}_][\\p{L}\\p{N}_]*";

/** Where the group that opens at `open` (a bracket of `pairs`) closes: the index after it. */
function groupEnd(code, open, opening = "{", closing = "}") {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === opening) depth += 1;
    else if (code[at] === closing) {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return code.length;
}

/** The module path of a file under a crate's `src/`: [] for lib.rs and main.rs, ["text", "words"] for text/words.rs. */
export function modulePathOf(inside) {
  const parts = inside.replace(/\.rs$/u, "").split("/");
  return parts.length === 1 && (parts[0] === "lib" || parts[0] === "main") ? [] : parts;
}

/** The inline module blocks of blanked code: each `mod name {` with where it opens and closes. */
function inlineModules(code) {
  return [...code.matchAll(new RegExp(`\\bmod\\s+(${NAME})\\s*\\{`, "gu"))].map((match) => {
    const open = match.index + match[0].length - 1;
    return { name: match[1], open, close: groupEnd(code, open) };
  });
}

/** The first name of each item of the braced group that opens at `open`: `{a, b::c, d::{e}}` gives a, b and d. */
function groupItems(code, open) {
  const end = groupEnd(code, open) - 1;
  const items = [];
  let depth = 0;
  let start = open + 1;
  for (let at = open + 1; at <= end; at += 1) {
    const char = code[at];
    if (char === "{") depth += 1;
    else if (char === "}" && depth > 0) depth -= 1;
    else if ((char === "," && depth === 0) || at === end) {
      const name = new RegExp(`^\\s*(${NAME})`, "u").exec(code.slice(start, at));
      if (name !== null) items.push(name[1]);
      start = at + 1;
    }
  }
  return items;
}

/**
 * The top modules that blanked `code` reaches through `crate::`, `super::` and `self::` paths,
 * each with the line of its first use. `filePath` is the file's module path (modulePathOf). A path
 * that reaches no top module (a glob or `self` at the crate root) is left out.
 */
export function crateUses(code, filePath) {
  const used = new Map();
  const add = (name, at) => {
    if (name !== "self" && name !== "super" && name !== "crate" && !used.has(name))
      used.set(name, lineAt(code, at));
  };
  const blocks = inlineModules(code);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_$:])((?:crate|self|super)(?:::super)*)::(?:(${NAME})|\\{)`,
    "gu",
  );
  for (const match of code.matchAll(pattern)) {
    const head = match[1].split("::");
    const around = [
      ...filePath,
      ...blocks
        .filter((block) => block.open < match.index && match.index < block.close)
        .map((block) => block.name),
    ];
    let base;
    if (head[0] === "crate") base = [];
    else if (head[0] === "self") base = around;
    else base = around.slice(0, Math.max(around.length - head.length, 0));
    if (head[0] === "super" && head.length > around.length) continue;
    const names =
      match[2] !== undefined ? [match[2]] : groupItems(code, match.index + match[0].length - 1);
    for (const name of names) add(base.length > 0 ? base[0] : name, match.index);
  }
  return used;
}

/** The top modules of the outside crate `crate` (as Rust names it, such as mnemocode) that `code` uses. */
export function externalUses(code, crate) {
  const used = new Map();
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_$:])${crate}::(?:(${NAME})|\\{)`, "gu");
  for (const match of code.matchAll(pattern)) {
    const names =
      match[1] !== undefined ? [match[1]] : groupItems(code, match.index + match[0].length - 1);
    for (const name of names)
      if (name !== "self" && !used.has(name)) used.set(name, lineAt(code, match.index));
  }
  return used;
}

/** The lints a lint-level attribute names: `allow(unsafe_code, reason = "…")` gives unsafe_code. */
function lintNames(list) {
  return list
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "" && !item.startsWith("reason"));
}

/**
 * Every attribute of blanked `code`: whether it is inner (`#![…]`), its line, whether it stands at
 * the top of the file (only inner attributes before it), and the lint levels it sets, those inside
 * `cfg_attr` included, each as { level, lints }.
 */
export function attributesOf(code) {
  const attributes = [];
  let onlyInnerSoFar = true;
  for (const match of code.matchAll(/#(!?)\[/gu)) {
    const open = match.index + match[0].length - 1;
    const end = groupEnd(code, open, "[", "]");
    const body = code.slice(open + 1, end - 1);
    const inner = match[1] === "!";
    const before = code.slice(0, match.index).replace(/#!\[[^\]]*\]/gu, "");
    const atTop = inner && onlyInnerSoFar && /^\s*$/u.test(before);
    if (!atTop) onlyInnerSoFar = false;
    const levels = [];
    for (const call of body.matchAll(/\b(allow|expect|warn|deny|forbid)\s*\(/gu)) {
      const listOpen = call.index + call[0].length - 1;
      levels.push({
        level: call[1],
        lints: lintNames(body.slice(listOpen + 1, groupEnd(body, listOpen, "(", ")") - 1)),
      });
    }
    attributes.push({ inner, atTop, line: lineAt(code, match.index), levels });
  }
  return attributes;
}
