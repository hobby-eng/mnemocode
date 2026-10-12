// Inspect runtime imports after esbuild strips TypeScript types. No project module is executed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { transformSync } from "esbuild";

const root = process.cwd();
const snapshot = JSON.parse(readFileSync("docs/audits/AUD-011-evidence/baseline-snapshot.json", "utf8"));
const paths = snapshot.source.map(([path]) => path)
  .filter((path) => path.startsWith("src/") && path.endsWith(".ts"));
const graph = new Map();
for (const path of paths) {
  const { code } = transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "esm" });
  const imports = [...code.matchAll(/\bfrom\s*"([^"]+)"|\bimport\s*\(?\s*"([^"]+)"/gu)]
    .map((match) => match[1] ?? match[2]).filter((specifier) => specifier.startsWith("."));
  const targets = imports.map((specifier) => {
    const source = resolve(dirname(path), specifier.replace(/\.js$/u, ".ts"));
    return relative(root, existsSync(source) ? source : resolve(dirname(path), specifier));
  });
  for (const target of targets) if (!existsSync(target)) throw new Error(`Unresolved: ${path} -> ${target}`);
  graph.set(path, [...new Set(targets)].sort());
}
const indices = new Map();
const lows = new Map();
const stack = [];
const active = new Set();
const cycles = [];
function visit(node) {
  const index = indices.size;
  indices.set(node, index);
  lows.set(node, index);
  stack.push(node);
  active.add(node);
  for (const target of graph.get(node) ?? []) {
    if (!graph.has(target)) continue;
    if (!indices.has(target)) {
      visit(target);
      lows.set(node, Math.min(lows.get(node), lows.get(target)));
    } else if (active.has(target)) lows.set(node, Math.min(lows.get(node), indices.get(target)));
  }
  if (lows.get(node) === indices.get(node)) {
    const component = [];
    let target;
    do {
      target = stack.pop();
      active.delete(target);
      component.push(target);
    } while (target !== node);
    if (component.length > 1 || graph.get(node).includes(node)) cycles.push(component.sort());
  }
}
for (const node of graph.keys()) if (!indices.has(node)) visit(node);
const result = { modules: graph.size, edges: [...graph.values()].reduce((sum, targets) => sum + targets.length, 0),
  cycles, graph: Object.fromEntries(graph) };
writeFileSync("docs/audits/AUD-011-evidence/runtime-graph.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ modules: result.modules, edges: result.edges, cycles }, null, 2));
