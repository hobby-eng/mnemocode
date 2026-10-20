// Finds exports of src/ that no code path reaches (AUD-037-ARC001): an export that its own module
// does not use, that no other module of src/ or scripts/ imports, and that is no part of a package
// entry, whose modules are public API for other hosts. It is dead when nothing names it at all,
// and only for tests when tests alone do: production code that only a test runs belongs in the
// test or a helper of it.
//
// It reads the code with comments removed and counts a name as a word; a re-export through
// `export * from` makes the module public as well. An export that a host's own code takes from a
// module it compiles unchanged says so in its doc comment, "For other hosts", and is kept.
//
//   node scripts/verify-dead-exports.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The files below `directory`, by their paths from the root, whose names `pattern` matches. */
function filesOf(directory, pattern) {
  return readdirSync(join(root, directory)).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(join(root, path)).isDirectory()) return filesOf(path, pattern);
    return pattern.test(path) ? [path.split("\\").join("/")] : [];
  });
}

/** `text` without its comments, so that a name in a comment counts as no use. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
}

const sources = filesOf("src", /\.ts$/u);
const production = [...sources, ...filesOf("scripts", /\.(?:mjs|ts)$/u)];
const tests = filesOf("test", /\.ts$/u);
const raw = new Map(
  [...production, ...tests].map((path) => [path, readFileSync(join(root, path), "utf8")]),
);
const texts = new Map([...raw].map(([path, text]) => [path, code(text)]));

/** Whether the doc comment of `name` in the module at `path` says it is for other hosts. */
function forOtherHosts(path, name) {
  const text = raw.get(path);
  const at = text.search(new RegExp(`^export\\s[^\\n]*\\b${name}\\b`, "mu"));
  const before = text.slice(0, Math.max(at, 0)).trimEnd();
  return before.endsWith("*/") && /For other hosts/u.test(before.slice(before.lastIndexOf("/**")));
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entries = new Set(
  Object.values(manifest.exports).map((target) =>
    target.import.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts"),
  ),
);
// Entries added while the loop runs are read too: a module re-exported by a re-exported one.
for (const entry of entries)
  for (const match of (texts.get(entry) ?? "").matchAll(/^export \* from "(\.[^"]+)";/gmu))
    entries.add(relative(root, join(root, entry, "..", match[1])).replace(/\.js$/u, ".ts"));

/** The names that `text` exports. */
function exportedNames(text) {
  const names = new Set();
  const declared =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gmu;
  for (const match of text.matchAll(declared)) names.add(match[1]);
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s+"[^"]+")?;/gmu))
    for (const item of match[1].split(","))
      if (item.trim() !== "")
        names.add(
          item
            .trim()
            .replace(/^type\s+/u, "")
            .split(/\s+as\s+/u)
            .at(-1),
        );
  return names;
}

const problems = [];
for (const path of sources.filter((source) => !entries.has(source))) {
  const text = texts.get(path);
  for (const name of exportedNames(text)) {
    const word = new RegExp(`(?<![\\w$])${name.replace(/\$/gu, "\\$")}(?![\\w$])`, "gu");
    const names = (other) => other !== path && new RegExp(word.source, "u").test(texts.get(other));
    if (production.some(names) || (text.match(word) ?? []).length > 1) continue;
    if (forOtherHosts(path, name)) continue;
    problems.push(`${path}: ${name} ${tests.some(names) ? "is only for tests" : "is dead"}`);
  }
}
if (problems.length > 0) {
  console.error(
    `Exports that no code path reaches:\n${problems.map((line) => `  ${line}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`Every export of the ${sources.length} modules of src/ is reached.`);
