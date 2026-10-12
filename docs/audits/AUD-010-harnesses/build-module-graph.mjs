// AUD-010 build reviewer: the resolved runtime import graph of src/, from esbuild's bundler
// (relative and side-effect imports, dynamic imports, .js specifiers resolved to .ts), independent
// of the regular expression in test/portable-modules.test.ts.
//
// Checks, each printed with its values:
// 1. every PART and SHARED module of test/portable-modules.test.ts reaches no Node.js built-in
//    (node:* or a bare built-in name), no src/cli/ module and no src/index.ts, src/cards.ts or
//    src/sskr/index.ts;
// 2. no module under src/core/, src/sskr/ or src/export/ imports a module under src/cli/;
// 3. import cycles (strongly connected components of size > 1, or a module that imports itself):
//    none may include a library module; a cycle inside src/cli/ is listed, and each of its modules
//    is loaded first from dist/ in a fresh process, which must succeed (no binding used before it
//    is initialised);
// 4. composition: the library's self-test (core/self-test.ts) reaches no module of the features a
//    host builds in or leaves out (core/coins/, coins-self-test, wallet-evidence*, export/), and the
//    Dash family's self-test reaches no other coin family's module;
// 5. listed for the coordinator, not failing: host-neutral modules outside src/cli/ that no
//    listed PART or SHARED module reaches, and modules that use Node.js directly.
// Exits 1 when check 1, 2, 3 or 4 fails. Run from the repository root.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const named = (path) => relative(root, path).split("\\").join("/");
function sources(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}
const entries = sources("src").map(named).sort();
const result = await build({
  entryPoints: entries,
  bundle: true,
  write: false,
  metafile: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "aud010-unwritten",
  logLevel: "silent",
  loader: { ".json": "json", ".wasm": "file" },
});
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
/** For each input: the src modules it imports at run time, and the packages / built-ins. */
const graph = new Map();
for (const [input, { imports }] of Object.entries(result.metafile.inputs)) {
  const internal = [];
  const external = [];
  for (const edge of imports) {
    if (edge.external) external.push(edge.path);
    else internal.push(edge.path);
  }
  graph.set(input, { internal, external });
}
console.log(`Modules in the resolved graph: ${graph.size} (src entries ${entries.length})`);

function reach(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path) || !graph.has(path)) continue;
    seen.add(path);
    pending.push(...graph.get(path).internal);
  }
  return seen;
}

const portable = readFileSync("test/portable-modules.test.ts", "utf8");
const block = (from, to) => portable.slice(portable.indexOf(from), portable.indexOf(to));
const parts = [...block("const PARTS", "const SHARED_MODULES").matchAll(/^  "(src\/[^"]+\.ts)": \{/gmu)].map((m) => m[1]);
const shared = [...block("const SHARED_MODULES", "const NEVER_REACHED").matchAll(/^  "(src\/[^"]+\.ts)": /gmu)].map((m) => m[1]);
console.log(`Listed: ${parts.length} parts, ${shared.length} shared modules`);

const NEVER = ["src/index.ts", "src/cards.ts", "src/sskr/index.ts"];
let failures = 0;
const reachedByListed = new Set();
for (const entry of [...parts, ...shared]) {
  const modules = reach(entry);
  modules.forEach((module) => reachedByListed.add(module));
  const packages = new Set();
  const nodeUses = [];
  const forbidden = [];
  for (const module of modules) {
    for (const specifier of graph.get(module).external) {
      if (builtins.has(specifier)) nodeUses.push(`${module} -> ${specifier}`);
      else packages.add(specifier);
    }
    if (module.startsWith("src/cli/") || NEVER.includes(module)) forbidden.push(module);
  }
  const ok = nodeUses.length === 0 && forbidden.length === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${entry}: ${modules.size} modules; packages [${[...packages].sort().join(", ")}]` +
      `; Node.js built-ins [${nodeUses.join(", ")}]; forbidden [${forbidden.join(", ")}]`,
  );
}

// 2. Library directories never import the command line.
const libraryToCli = [];
for (const [module, { internal }] of graph)
  if (/^src\/(core|sskr|export)\//u.test(module))
    for (const target of internal) if (target.startsWith("src/cli/")) libraryToCli.push(`${module} -> ${target}`);
console.log(`Library modules importing src/cli/: ${libraryToCli.length} [${libraryToCli.join(", ")}]`);
if (libraryToCli.length > 0) failures += 1;

// 3. Cycles: Tarjan's strongly connected components over the src/ modules.
const nodes = [...graph.keys()].filter((path) => path.startsWith("src/"));
let counter = 0;
const index = new Map();
const low = new Map();
const stack = [];
const onStack = new Set();
const components = [];
function connect(node) {
  index.set(node, counter);
  low.set(node, counter);
  counter += 1;
  stack.push(node);
  onStack.add(node);
  for (const next of graph.get(node).internal.filter((path) => path.startsWith("src/"))) {
    if (!index.has(next)) {
      connect(next);
      low.set(node, Math.min(low.get(node), low.get(next)));
    } else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
  }
  if (low.get(node) === index.get(node)) {
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    const selfLoop = graph.get(node).internal.includes(node);
    if (component.length > 1 || selfLoop) components.push(component.sort());
  }
}
for (const node of nodes) if (!index.has(node)) connect(node);
console.log(`Runtime import cycles: ${components.length}`);
for (const component of components) {
  console.log(`  cycle: ${component.join(" <-> ")}`);
  if (component.some((module) => !module.startsWith("src/cli/"))) {
    failures += 1;
    console.log("  FAIL a library module is in an import cycle");
    continue;
  }
  for (const module of component) {
    const compiled = `./${module.replace(/^src\//u, "dist/").replace(/\.ts$/u, ".js")}`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(compiled)})`], { encoding: "utf8" });
    console.log(`  ${compiled} loaded first: exit ${result.status}`);
    if (result.status !== 0) failures += 1;
  }
}

// 4. Composition gates.
const gates = [
  ["src/core/self-test.ts", /^src\/(core\/coins\/|core\/coins(-self-test)?\.ts|core\/wallet-evidence|core\/coin-address-evidence|export\/)/u],
  ["src/core/coins/dash-self-test.ts", /^src\/core\/coins\/(bitcoin-like|bitcoin-cash|cosmos|evm|xrp)(-self-test)?\.ts$/u],
];
for (const [entry, forbidden] of gates) {
  const reached = [...reach(entry)].filter((module) => forbidden.test(module));
  console.log(`composition: ${entry} reaches ${reach(entry).size} modules; of other features [${reached.join(", ")}]`);
  if (reached.length > 0) failures += 1;
}

// 5. For the coordinator: Node.js users, and host-neutral modules outside the lists' reach.
const directNode = nodes.filter((module) => graph.get(module).external.some((s) => builtins.has(s)));
console.log(`Modules that import Node.js built-ins directly (${directNode.length}): ${directNode.join(", ")}`);
const nodeReaching = new Set(nodes.filter((module) => [...reach(module)].some((m) => directNode.includes(m))));
const unlisted = nodes.filter(
  (module) =>
    !module.startsWith("src/cli/") &&
    !NEVER.includes(module) &&
    module !== "src/mnemocode.ts" &&
    !nodeReaching.has(module) &&
    !reachedByListed.has(module),
);
console.log(`Host-neutral modules no listed part or shared module reaches (${unlisted.length}): ${unlisted.join(", ")}`);

console.log(failures === 0 ? "PASS build-module-graph" : `FAIL build-module-graph: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
