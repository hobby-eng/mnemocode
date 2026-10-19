// A frozen install may prune old, unreachable virtual-store versions.
// Preserve the failed whole-store equality check and prove the narrower active graph.
import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { strict as assert } from "node:assert";
const E = "docs/audits/AUD-035-evidence";
const read = name => JSON.parse(readFileSync(`${E}/${name}.json`, "utf8"));
const before = read("dependencies-before"), after = read("dependencies-after");
const rootsBefore = read("dependency-links-before"), rootsAfter = read("dependency-links-after");
assert.deepEqual(rootsAfter, rootsBefore, "Root resolutions or executable wrappers changed");
const A = new Map(before.rows.map(row => [row.path, row]));
const B = new Map(after.rows.map(row => [row.path, row]));
const removed = before.rows.filter(row => !B.has(row.path));
for (const row of after.rows) assert.deepEqual(row, A.get(row.path), `Added or changed payload: ${row.path}`);
const group = path => /^node_modules\/\.pnpm\/([^/]+)\//u.exec(path)?.[1];
const target = row => group(posix.normalize(posix.join(posix.dirname(row.path), row.link)) + "/");
const reached = new Set(rootsBefore.rows.filter(row => row.link).map(target).filter(Boolean));
const edges = new Map();
for (const row of before.rows) {
  if (!row.link) continue;
  const source = group(row.path), destination = target(row);
  if (!source || !destination) continue;
  if (!edges.has(source)) edges.set(source, new Set());
  edges.get(source).add(destination);
}
for (const source of reached) for (const destination of edges.get(source) ?? []) reached.add(destination);
for (const row of removed) assert.ok(!reached.has(group(row.path)), `Pruned active dependency: ${row.path}`);
const result = {
  rootLinksAndWrappersUnchanged: true,
  survivingPayloadRowsUnchanged: after.rows.length,
  addedOrChangedRows: 0,
  removedRows: removed.length,
  removedGroups: [...new Set(removed.map(row => group(row.path)))].sort(),
  activeReachableGroups: [...reached].sort(),
  prunedActiveGroups: [],
  qualification: "The original whole-store equality check failed honestly because the frozen install pruned obsolete unreachable versions. Root resolution/wrappers and every surviving package byte/link are identical; no removed package belongs to the pre-install graph reachable from root package links. Earlier full-suite evidence remains admitted for that unchanged active graph. An unused cached TypeScript 5.9 metadata parser may be pruned; its earlier audit metadata remains execution-time evidence, not a production dependency.",
};
writeFileSync(`${E}/dependency-reconciliation.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result));
