// AUD-010 build reviewer: exports that nothing uses (CHECK-ARC-002), for review.
//
// For every `export function|const|let|class|interface|type|enum <Name>` and every name in an
// `export { ... }` list of a module under src/, the probe counts the files under src/, test/ and
// scripts/ other than the module itself whose code (comments removed) names <Name> as a word.
// An export of a package entry (package.json "exports", whose modules are public API for other
// hosts) is reported apart, since another program may use it.
//
// An unreferenced export is "dead" when its own module does not use the name either (the name
// occurs once there, in its declaration): no code path reaches it. Otherwise it is only exported
// without need. It prints every unreferenced export with that distinction, and fails (exit 1)
// only for a dead export outside the package entries: code that nothing can run.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(directory, pattern) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(path) ? [path] : [];
  });
}
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
const sources = files("src", /\.ts$/u).map((path) => path.split("\\").join("/"));
const others = [...files("test", /\.ts$/u), ...files("scripts", /\.(mjs|ts)$/u)].map((p) => p.split("\\").join("/"));
const texts = new Map([...sources, ...others].map((path) => [path, code(readFileSync(path, "utf8"))]));
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const entries = new Set(
  Object.values(manifest.exports).map((target) => target.import.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts")),
);
// A module that an entry re-exports whole (export * from) is public API as well.
for (const entry of [...entries])
  for (const match of (texts.get(entry) ?? "").matchAll(/^export \* from "(\.[^"]+)";/gmu))
    entries.add(join(entry, "..", match[1]).split("\\").join("/").replace(/\.js$/u, ".ts"));

const unreferenced = { cli: [], entry: [], library: [] };
let deadOutsideEntries = 0;
for (const path of sources) {
  const text = texts.get(path);
  const names = new Set();
  for (const match of text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gmu))
    names.add(match[1]);
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s+"[^"]+")?;/gmu))
    for (const item of match[1].split(","))
      if (item.trim() !== "") names.add(item.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u).at(-1));
  for (const name of names) {
    const word = new RegExp(`(?<![\\w$])${name.replace(/\$/gu, "\\$")}(?![\\w$])`, "u");
    const users = [...texts.entries()].filter(([other, otherText]) => other !== path && word.test(otherText));
    if (users.length > 0) continue;
    const ownUses = (text.match(new RegExp(word.source, "gu")) ?? []).length;
    const dead = ownUses <= 1;
    const row = `${path}: ${name}${dead ? " (DEAD: not used in its module either)" : " (used in its module)"}`;
    if (dead && !entries.has(path)) deadOutsideEntries += 1;
    if (path.startsWith("src/cli/")) unreferenced.cli.push(row);
    else if (entries.has(path)) unreferenced.entry.push(row);
    else unreferenced.library.push(row);
  }
}
console.log(`Modules scanned: ${sources.length}; other files searched: ${others.length}`);
console.log(`Unreferenced exports of package entries (public API, review only): ${unreferenced.entry.length}`);
for (const row of unreferenced.entry) console.log(`  ${row}`);
console.log(`Unreferenced exports of other library modules (review only): ${unreferenced.library.length}`);
for (const row of unreferenced.library) console.log(`  ${row}`);
console.log(`Unreferenced exports of src/cli/: ${unreferenced.cli.length}`);
for (const row of unreferenced.cli) console.log(`  ${row}`);
console.log(`Dead exports outside the package entries: ${deadOutsideEntries}`);
console.log(deadOutsideEntries === 0 ? "PASS build-dead-exports" : `FAIL build-dead-exports: ${deadOutsideEntries} dead export(s)`);
process.exitCode = deadOutsideEntries === 0 ? 0 : 1;
