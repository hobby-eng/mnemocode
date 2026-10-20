// Finds exports of src/ that no code path reaches (AUD-037-ARC001): an export that its own module
// does not use, that no module of src/ or scripts/ takes from it, and that is no part of a package
// entry, whose modules are public API for other hosts. It is dead when nothing takes it at all,
// and only for tests when tests alone do: production code that only a test runs belongs in the
// test or a helper of it.
//
// It reads the tokens of the code (source-tokens.mjs), in which comments, strings, regular
// expressions and the text of templates are no code, and resolves the path of each import and
// export clause to its module, so that a name counts only where a module takes it from that
// module. In a module, its own or one that imports it, a name is a use only where it refers to the
// export: not as a member (`.x`, `#x`), a key, a type member or a parameter (`x:`), or a name that
// a declaration gives. A re-export (`export { x } from`, or an import that the module exports again)
// is no use of x by its own module, and reaches x only as far as the re-export itself is reached.
// `export * from` in a package entry makes the module public as well; a name taken through
// `import * as`, `import()` or another `export *` is not followed, so the check reports it. An
// export that a host's own code takes from a module it compiles unchanged says so in its doc
// comment, "For other hosts", and is kept.
//
//   node scripts/verify-dead-exports.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokensOf } from "./source-tokens.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The files below `directory`, by their paths from the root, whose names `pattern` matches. */
function filesOf(directory, pattern) {
  return readdirSync(join(root, directory)).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(join(root, path)).isDirectory()) return filesOf(path, pattern);
    return pattern.test(path) ? [path.split("\\").join("/")] : [];
  });
}

const sources = filesOf("src", /\.ts$/u);
const production = [...sources, ...filesOf("scripts", /\.(?:mjs|ts)$/u)];
const tests = filesOf("test", /\.ts$/u);
const texts = new Map(
  [...production, ...tests].map((path) => [path, readFileSync(join(root, path), "utf8")]),
);

/** Whether the doc comment of `name` in the module at `path` says it is for other hosts. */
function forOtherHosts(path, name) {
  const text = texts.get(path);
  const at = text.search(new RegExp(`^export\\s[^\\n]*\\b${name}\\b`, "mu"));
  const before = text.slice(0, Math.max(at, 0)).trimEnd();
  return before.endsWith("*/") && /For other hosts/u.test(before.slice(before.lastIndexOf("/**")));
}

/**
 * The code of each `${…}` expression of `template`, a template token, ended where tokensOf ends
 * it: at the `}` that closes as many `${` as it has passed.
 */
function expressionsOf(template) {
  const expressions = [];
  let depth = 0;
  let from = 0;
  for (let at = 1; at < template.length - 1; at += 1) {
    if (template[at] === "\\") at += 1;
    else if (template.startsWith("${", at)) {
      if (depth === 0) from = at + 2;
      depth += 1;
    } else if (template[at] === "}" && depth > 0 && --depth === 0)
      expressions.push(template.slice(from, at));
  }
  return expressions;
}

/**
 * The keys of the tokens of `text`, without its comments. A template stays one token, which no
 * name equals, followed by the tokens of its expressions, which are code.
 */
function codeOf(text) {
  return tokensOf(text).tokens.flatMap(({ key }) =>
    key.startsWith("`") ? [key, ...expressionsOf(key).flatMap(codeOf)] : [key],
  );
}

/** Whether `key` is a word, a name or a keyword: no number, string, sign or missing token. */
const isWord = (key) => key !== undefined && /^[\p{L}_$]/u.test(key);
/** The keywords that stand between `export` and the keyword of the declaration it exports. */
const EXPORT_MODIFIERS = new Set(["declare", "async", "abstract"]);
/** The keywords whose next word is the name they declare (after `function *` for a generator). */
const DECLARING = new Set([
  "function",
  "const",
  "let",
  "var",
  "class",
  "interface",
  "type",
  "enum",
]);
/** The modifiers that TypeScript allows before the name of a class or type member. */
const MEMBER_MODIFIERS = [
  "public",
  "protected",
  "private",
  "readonly",
  "static",
  "declare",
  "abstract",
  "override",
  "accessor",
];
/**
 * The tokens after which a word followed by `:` or `?:` is a key, a type member, a label or a
 * parameter, never the export of the same name: the start of an item, or a modifier of a member.
 */
const ITEM_START = new Set(["{", "}", "[", "(", ",", ";", ...MEMBER_MODIFIERS]);

/**
 * Whether the word at `at` of `keys` refers to a name of the module's scope: not as a member
 * (`.x`, `?.x`, `#x`; `...x` is a spread), not as the name that a declaration gives, and not as a
 * key, a type member, a label or a parameter (`x:` or `x?:` at the start of an item).
 */
function isReference(keys, at) {
  const before = keys[at - 1];
  const after = keys[at + 1];
  if (before === "#" || (before === "." && keys[at - 2] !== ".")) return false;
  if (DECLARING.has(before) || (before === "*" && keys[at - 2] === "function")) return false;
  const named = after === ":" || (after === "?" && keys[at + 2] === ":");
  return !(named && ITEM_START.has(before));
}

/** The name that the declaration after `export` at `at` of `keys` gives, if one stands there. */
function declaredAt(keys, at) {
  let next = at + 1;
  while (EXPORT_MODIFIERS.has(keys[next])) next += 1;
  if (!DECLARING.has(keys[next])) return undefined;
  next += keys[next] === "function" && keys[next + 1] === "*" ? 2 : 1;
  return isWord(keys[next]) ? keys[next] : undefined;
}

/** The items of a clause's list, `a, type b, c as d`, each as [its name before, after `as`]. */
function listItems(keys) {
  const items = [];
  let item = [];
  for (const key of [...keys, ","])
    if (key !== ",") item.push(key);
    else {
      const [name, , alias] = item[0] === "type" && item.length > 1 ? item.slice(1) : item;
      if (name !== undefined) items.push([name, alias ?? name]);
      item = [];
    }
  return items;
}

/** The module that `specifier` in the file at `path` names: a path of src/, or a package. */
function moduleOf(path, specifier) {
  if (!specifier.startsWith(".")) return specifier;
  // A script may import the build of a module; .ts and .js both name the module of src/.
  return posix
    .join(posix.dirname(path), specifier)
    .replace(/^dist\//u, "src/")
    .replace(/\.js$/u, ".ts");
}

/** The specifier of `from "…"` at `at` of `keys`, without its quotes, if one stands there. */
function specifierAt(keys, at) {
  const quoted = keys[at] === "from" && /^["']/u.test(keys[at + 1] ?? "");
  return quoted ? keys[at + 1].slice(1, -1) : undefined;
}

/** `at`, or the index after it where a `;` stands there. */
const past = (keys, at) => (keys[at] === ";" ? at + 1 : at);

/**
 * The clause that starts at `at` of `keys`: its kind, its items, the specifier of its module and
 * the index after it; undefined for any other code. The kinds are `import { … } from "…"` (with
 * `type` or a default import before the list), `export { … } from "…"` (a re-export),
 * `export { … }` (a list) and `export * from "…"` (a star).
 */
function clauseAt(keys, at) {
  const keyword = keys[at];
  if ((keyword !== "import" && keyword !== "export") || keys[at - 1] === ".") return undefined;
  if (keyword === "export" && keys[at + 1] === "*") {
    const specifier = specifierAt(keys, at + 2);
    if (specifier === undefined) return undefined;
    return { kind: "star", items: [], specifier, end: past(keys, at + 4) };
  }
  let open = keys[at + 1] === "type" ? at + 2 : at + 1;
  if (keyword === "import" && isWord(keys[open]) && keys[open + 1] === ",") open += 2;
  const close = keys[open] === "{" ? keys.indexOf("}", open) : -1;
  if (close < 0) return undefined;
  const items = listItems(keys.slice(open + 1, close));
  const specifier = specifierAt(keys, close + 1);
  if (specifier !== undefined) {
    const kind = keyword === "import" ? "import" : "re-export";
    return { kind, items, specifier, end: past(keys, close + 3) };
  }
  return keyword === "export" ? { kind: "list", items, end: past(keys, close + 1) } : undefined;
}

/**
 * What the file at `path` takes from other modules and what it exports of its own. Each take is
 * the module, the name there and, for a re-export, the name it is exported as; an import counts
 * only where the file refers to it beyond the clauses. `own` maps each exported name of the
 * module's own to its local name, `used` holds the names that its code beyond the clauses refers
 * to, and `stars` the modules that `export * from` passes on whole.
 */
function factsOf(path) {
  const keys = codeOf(texts.get(path));
  const body = [];
  const clauses = [];
  const own = new Map();
  for (let at = 0; at < keys.length;) {
    const clause = clauseAt(keys, at);
    if (clause === undefined) {
      const declared = keys[at] === "export" ? declaredAt(keys, at) : undefined;
      if (declared !== undefined) own.set(declared, declared);
      body.push(keys[at]);
      at += 1;
    } else {
      const module = clause.specifier === undefined ? undefined : moduleOf(path, clause.specifier);
      clauses.push({ ...clause, module });
      at = clause.end;
    }
  }
  const used = new Set(body.filter((key, at) => isWord(key) && isReference(body, at)));
  const ofKind = (wanted) => clauses.filter(({ kind }) => kind === wanted);
  const imported = new Map(
    ofKind("import").flatMap(({ items, module }) =>
      items.map(([name, local]) => [local, { module, name }]),
    ),
  );
  const takes = [...imported].filter(([local]) => used.has(local)).map(([, at]) => at);
  for (const { items, module } of ofKind("re-export"))
    for (const [name, as] of items) takes.push({ module, name, as });
  for (const { items } of ofKind("list"))
    for (const [local, as] of items) {
      const source = imported.get(local);
      if (source === undefined) own.set(as, local);
      else takes.push({ ...source, as });
    }
  return { used, takes, own, stars: ofKind("star").map(({ module }) => module) };
}

const facts = new Map([...production, ...tests].map((path) => [path, factsOf(path)]));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entries = new Set(
  Object.values(manifest.exports).map((target) =>
    target.import.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts"),
  ),
);
// Entries added while the loop runs are read too: a module re-exported by a re-exported one.
for (const entry of entries)
  for (const module of facts.get(entry)?.stars ?? []) entries.add(module);

/** Who takes each name of each module: the file and, for a re-export, the name it passes on. */
const takers = new Map();
for (const [file, { takes }] of facts)
  for (const { module, name, as } of takes) {
    const key = `${module}\0${name}`;
    takers.set(key, [...(takers.get(key) ?? []), { file, as }]);
  }
const isProduction = (file) => !tests.includes(file);
const isTest = (file) => tests.includes(file);

/**
 * Whether a file of `audience` takes `name` from the module at `path`: by an import, or by a
 * re-export that is itself reached so, or that a package entry makes public.
 */
function reached(path, name, audience, seen = new Set()) {
  const key = `${path}\0${name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return (takers.get(key) ?? []).some(({ file, as }) =>
    as === undefined ? audience(file) : entries.has(file) || reached(file, as, audience, seen),
  );
}

const problems = [];
for (const path of sources.filter((source) => !entries.has(source))) {
  const { used, takes, own } = facts.get(path);
  const reExported = takes.flatMap(({ as }) => (as === undefined ? [] : [as]));
  for (const name of new Set([...own.keys(), ...reExported])) {
    if (used.has(own.get(name))) continue;
    if (reached(path, name, isProduction) || forOtherHosts(path, name)) continue;
    problems.push(
      `${path}: ${name} ${reached(path, name, isTest) ? "is only for tests" : "is dead"}`,
    );
  }
}
if (problems.length > 0) {
  console.error(
    `Exports that no code path reaches:\n${problems.map((line) => `  ${line}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`Every export of the ${sources.length} modules of src/ is reached.`);
