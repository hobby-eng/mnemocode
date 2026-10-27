// Gate `code-rules` of docs/design/architect/GATES.md: the coding rules that no compiler lint
// checks, each in its part, all read from module-map.json where the design states them:
//
// - layers (CORE-04, RUST-15): every module a Rust file reaches through `crate::`, `super::` or
//   `self::` paths, braced groups included, and every library module the cards crate reaches
//   through `mnemocode::`, against module-map.json; both ways for the library's listed edges;
// - deps (CORE-25, CORE-47): each crate's direct and test dependencies, pinned with =x.y.z; no crate
//   of `refusedInTree` in the resolve of the executable or the binding on any release target; the
//   bc-crypto stand-in in Cargo.lock without a registry source; every vendored file byte-equal to
//   its UPSTREAM.json; every recorded vector byte-equal to its PROVENANCE.json (DOC-04);
// - lints (RUST-07, CORE-09): `unsafe_code` allowed only in the files module-map.json names; the
//   disallowed std methods and types expected only at the top of the CLI's I/O modules, never in a
//   crate root; no lint group (`clippy::all`, `clippy::style`, `warnings`, …) allowed anywhere;
//   `cfg_attr(…)` read as the attribute it may become;
// - manifests (RUST-01, RUST-12): `[lints] workspace = true` in every crate but the vendored ones,
//   `#![forbid(unsafe_code)]` in the roots module-map.json marks, the release profile exactly;
// - size (CORE-15): at most 800 lines of code per file, a Rust file's inline test module left out,
//   and at most 150 per JavaScript function, unless a `long: <reason>` comment stands above it;
// - tests (CORE-32, CORE-34): test names of three words or more; fakes only of the Random port and
//   mhfe's Probes, in inline test modules and in test files alike;
// - tooling: TOOL-02 for shell scripts, TOOL-03 for Python, TOOL-05 and exact pins for the tooling
//   package.
//
//   node scripts/verify-code-rules.mjs               exit 1 with one line per problem
//   node scripts/verify-code-rules.mjs --self-test   the parts against cases each must catch
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterGroup, tokensOf } from "./code-tokens.mjs";
import { trackedOrNewFiles } from "./git-top-level.mjs";
import { linesOfCode } from "./lines-of-code.mjs";
import { blankRust, lineAt, testModuleLines } from "./rust-code.mjs";
import { attributesOf, crateUses, externalUses, modulePathOf } from "./rust-uses.mjs";
import { isShellScript, readShell } from "./shell-source.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
/** CORE-15: lines of code per file, and per JavaScript function. */
const MAX_FILE_LINES = 800;
const MAX_FUNCTION_LINES = 150;
/** CORE-34: words in a test's name. */
const MIN_TEST_WORDS = 3;
/** The release targets of the executable, and the binding's (ARCHITECTURE.md §1). */
const EXECUTABLE_TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-pc-windows-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];
const WASM_TARGET = "wasm32-unknown-unknown";
/** The crates whose Rust files the lint and test parts read, by folder: the workspace's own. */
const OWN_CRATES = {
  "crates/mnemocode": "mnemocode",
  "crates/mnemocode-cards": "mnemocode-cards",
  "crates/mnemocode-cli": "mnemocode-cli",
  "crates/mnemocode-wasm": "mnemocode-wasm",
  "shims/bc-crypto": "bc-crypto",
};
/** The lints of clippy's disallowed std items, which only the CLI's I/O modules may expect. */
const IO_LINTS = new Set(["clippy::disallowed_methods", "clippy::disallowed_types"]);
/** Lint groups: allowing one would silence the gated lints in it. */
const LINT_GROUPS = new Set([
  "warnings",
  "clippy::all",
  "clippy::style",
  "clippy::complexity",
  "clippy::correctness",
  "clippy::perf",
  "clippy::suspicious",
  "clippy::pedantic",
  "clippy::restriction",
  "clippy::nursery",
  "clippy::cargo",
]);
/** The only traits a test may fake (CORE-32). */
const FAKEABLE = new Set(["Random", "Probes"]);
/** The release profile of RUST-12, value by key. */
const RELEASE_PROFILE = { panic: '"abort"', lto: "true", "codegen-units": "1" };
/** Lockfiles of the package managers other than pnpm (TOOL-05). */
const OTHER_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb"];

/** A gate run: the problems found, each with its place and rule. */
class Problems {
  list = [];
  report(path, line, rule, message) {
    this.list.push(`${path}:${line}: ${rule}: ${message}`);
  }
}

// layers ------------------------------------------------------------------------------------

/** The top module of a file under a crate's `src/`, "lib" or "main" for the crate root. */
function topModuleOf(inside) {
  const path = modulePathOf(inside);
  return path.length === 0 ? inside.replace(/\.rs$/u, "") : path[0];
}

/** The modules a module may use, or "*" for every one, by the crate's entry of module-map.json. */
function allowedFor(crate, entry, map, module) {
  if (module === "lib" || module === "main") return "*";
  if (crate === "mnemocode") {
    const listed = entry.modules[module];
    if (listed === "*") return "*";
    const foundation = entry.foundation.includes(module) ? [] : entry.foundation;
    return new Set([module, ...foundation, ...(listed ?? [])]);
  }
  if (entry.order !== undefined)
    return new Set([module, ...entry.order.slice(0, Math.max(entry.order.indexOf(module), 0))]);
  return new Set([module, ...(entry.modules?.[module] ?? [])]);
}

/** Whether `module` is a module of `entry`. */
function knownModule(crate, entry, module) {
  if (module === "lib" || module === "main") return true;
  if (crate === "mnemocode") return entry.foundation.includes(module) || module in entry.modules;
  return (entry.order ?? Object.keys(entry.modules ?? {})).includes(module);
}

/** The layers part over `sources` ({ path, text }), every listed library edge used where its module exists. */
function checkLayers(problems, sources, map) {
  const uses = new Set();
  const existing = new Set();
  for (const { path, text } of sources) {
    const crateDir = Object.keys(OWN_CRATES).find((dir) => path.startsWith(`${dir}/src/`));
    const crate = OWN_CRATES[crateDir];
    if (crate === undefined || !path.endsWith(".rs") || crate === "bc-crypto") continue;
    const entry = map.crates[crate];
    const inside = path.slice(crateDir.length + "/src/".length);
    const module = topModuleOf(inside);
    if (!knownModule(crate, entry, module)) {
      problems.report(path, 1, "CORE-04", `module ${module} is not in module-map.json`);
      continue;
    }
    if (crate === "mnemocode") existing.add(module);
    const code = blankRust(text);
    const may = allowedFor(crate, entry, map, module);
    for (const [used, line] of crateUses(code, modulePathOf(inside))) {
      if (may !== "*" && !may.has(used))
        problems.report(
          path,
          line,
          "CORE-04",
          `${module} may not use crate::${used} (module-map.json)`,
        );
      if (crate === "mnemocode") uses.add(`${module}>${used}`);
    }
    if (crate === "mnemocode-cards") {
      const listed = entry.library.flatMap((name) =>
        name === "foundation" ? map.crates.mnemocode.foundation : [name],
      );
      for (const [used, line] of externalUses(code, "mnemocode"))
        if (!listed.includes(used))
          problems.report(
            path,
            line,
            "CORE-04",
            `the cards crate may not use mnemocode::${used} (module-map.json)`,
          );
    }
  }
  for (const [module, listed] of Object.entries(map.crates.mnemocode.modules)) {
    if (!existing.has(module) || listed === "*") continue;
    for (const target of listed)
      if (!uses.has(`${module}>${target}`))
        problems.report(
          "module-map.json",
          1,
          "CORE-04",
          `${module} lists ${target}, which its code never uses`,
        );
  }
}

// lints, manifests ----------------------------------------------------------------------------

/** Whether `path` lies in a file or folder of `allowedIn`, paths relative to `crateDir`. */
function inAllowed(path, crateDir, allowedIn) {
  const inside = path.slice(crateDir.length + 1);
  return (allowedIn ?? []).some((allowed) =>
    allowed.endsWith("/") ? inside.startsWith(allowed) : inside === allowed,
  );
}

/** The lints part for one Rust file of the workspace's own crates. */
function checkLints(problems, path, text, map) {
  const crateDir = Object.keys(OWN_CRATES).find((dir) => path.startsWith(`${dir}/`));
  const entry = map.crates[OWN_CRATES[crateDir]];
  const isRoot = /\/src\/(?:lib|main)\.rs$/u.test(path);
  for (const attribute of attributesOf(blankRust(text))) {
    for (const { level, lints } of attribute.levels) {
      if (level === "deny" || level === "forbid") continue;
      for (const lint of lints) {
        if (LINT_GROUPS.has(lint))
          problems.report(
            path,
            attribute.line,
            "RUST-05",
            `${level}(${lint}) would silence the gated lints of its group`,
          );
        if (lint === "unsafe_code" && !inAllowed(path, crateDir, entry.unsafe.allowedIn))
          problems.report(
            path,
            attribute.line,
            "RUST-07",
            `${level}(unsafe_code) only where module-map.json allows it`,
          );
        if (IO_LINTS.has(lint)) {
          const ioModule = inAllowed(path, crateDir, entry.ioModules);
          if (isRoot || !ioModule || !attribute.atTop || level !== "expect")
            problems.report(
              path,
              attribute.line,
              "CORE-09",
              `${lint} is expected only at the top of the CLI's I/O modules (module-map.json ioModules)`,
            );
        }
      }
    }
  }
}

/** The manifests part: lints tables, forbid roots and the release profile. */
function checkManifests(problems, files, read, map) {
  for (const manifest of files.filter(
    (path) => path.endsWith("Cargo.toml") && path !== "Cargo.toml",
  )) {
    if (manifest.startsWith("vendor/")) continue;
    if (!/^\[lints\]\nworkspace = true$/mu.test(read(manifest)))
      problems.report(manifest, 1, "RUST-01", "needs [lints] workspace = true");
  }
  for (const [crateDir, crate] of Object.entries(OWN_CRATES)) {
    if (map.crates[crate].unsafe.level !== "forbid") continue;
    const rootFile = [`${crateDir}/src/lib.rs`, `${crateDir}/src/main.rs`].find((path) =>
      files.includes(path),
    );
    const forbids =
      rootFile !== undefined &&
      attributesOf(blankRust(read(rootFile))).some(
        (attribute) =>
          attribute.inner &&
          attribute.levels.some(
            ({ level, lints }) => level === "forbid" && lints.includes("unsafe_code"),
          ),
      );
    if (!forbids)
      problems.report(
        rootFile ?? crateDir,
        1,
        "RUST-07",
        "the crate root needs #![forbid(unsafe_code)]",
      );
  }
  checkReleaseProfile(problems, read("Cargo.toml"));
}

/** RUST-12: each key of the release profile with exactly its value, comments left out. */
function checkReleaseProfile(problems, manifest) {
  const section = /^\[profile\.release\]\n((?:[^[\n][^\n]*\n|\n)*)/mu.exec(manifest)?.[1] ?? "";
  const values = new Map(
    section
      .split("\n")
      .map((line) => line.replace(/#.*$/u, "").trim())
      .filter((line) => line.includes("="))
      .map((line) => line.split("=").map((part) => part.trim())),
  );
  for (const [key, value] of Object.entries(RELEASE_PROFILE))
    if (values.get(key) !== value)
      problems.report("Cargo.toml", 1, "RUST-12", `the release profile needs ${key} = ${value}`);
}

// size, tests ---------------------------------------------------------------------------------

/** The functions of a JavaScript module longer than CORE-15 allows without a `long:` comment above. */
function longFunctions(text) {
  const { tokens, comments } = tokensOf(text, false);
  const long = [];
  for (let at = 0; at < tokens.length; at += 1) {
    if (tokens[at].key !== "function") continue;
    const parameters = tokens.findIndex((token, index) => index > at && token.key === "(");
    if (parameters < 0) break;
    const open = tokens.findIndex(
      (token, index) => index >= afterGroup(tokens, parameters) && token.key === "{",
    );
    if (open < 0) break;
    const lines = new Set(tokens.slice(open, afterGroup(tokens, open)).map((token) => token.line));
    const first = tokens[at].line;
    const marked = comments.some(
      (comment) =>
        comment.last >= first - 1 && comment.last <= first && /long:\s*\S/u.test(comment.text),
    );
    if (lines.size > MAX_FUNCTION_LINES && !marked) long.push({ line: first, lines: lines.size });
  }
  return long;
}

function checkSizes(problems, files, read) {
  for (const path of files) {
    if (/^(?:vendor|vectors|docs)\//u.test(path) || path.endsWith(".md") || path.endsWith(".json"))
      continue;
    const text = read(path);
    const javascript = path.endsWith(".mjs") || path.endsWith(".js");
    const code = javascript
      ? [...new Set(tokensOf(text, false).tokens.map((token) => token.line))]
      : linesOfCode(path, text);
    if (code === undefined) continue;
    const exempt = /^\s*[^\w\s]+\s*long:\s*\S/u.test(text.split("\n")[0] ?? "");
    if (code.length > MAX_FILE_LINES && !exempt)
      problems.report(
        path,
        code[MAX_FILE_LINES],
        "CORE-15",
        `${code.length} lines of code, more than ${MAX_FILE_LINES}`,
      );
    if (javascript)
      for (const { line, lines } of longFunctions(text))
        problems.report(
          path,
          line,
          "CORE-15",
          `a function of ${lines} lines of code, more than ${MAX_FUNCTION_LINES}`,
        );
  }
}

/** The Rust files that `#[cfg(test)] mod name;` declarations make test files. */
function testFiles(sources) {
  const tests = new Set();
  for (const { path, text } of sources) {
    if (!path.endsWith(".rs")) continue;
    const folder = /\/(?:lib|main|mod)\.rs$/u.test(path) ? dirname(path) : path.slice(0, -3);
    for (const match of blankRust(text).matchAll(
      /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([\p{L}_][\p{L}\p{N}_]*)\s*;/gu,
    ))
      for (const candidate of [`${folder}/${match[1]}.rs`, `${folder}/${match[1]}/`])
        for (const { path: other } of sources)
          if (other === candidate || other.startsWith(candidate)) tests.add(other);
  }
  return tests;
}

function checkTests(problems, sources) {
  const rust = sources.filter(({ path }) => path.endsWith(".rs"));
  const ownTraits = new Set();
  for (const { text } of rust)
    for (const match of blankRust(text).matchAll(/\btrait\s+([\p{L}_][\p{L}\p{N}_]*)/gu))
      ownTraits.add(match[1]);
  const separate = testFiles(sources);
  for (const { path, text } of rust) {
    const code = blankRust(text);
    const ranges = testModuleLines(code);
    const wholeFile = /\/tests\//u.test(path) || separate.has(path);
    for (const match of code.matchAll(/#\[test\][\s\S]*?\bfn\s+([\p{L}_][\p{L}\p{N}_]*)/gu)) {
      const words = match[1].split("_").filter((word) => word !== "");
      if (words.length < MIN_TEST_WORDS)
        problems.report(
          path,
          lineAt(code, match.index),
          "CORE-34",
          `test ${match[1]} needs a name of ${MIN_TEST_WORDS} words or more`,
        );
    }
    const fake =
      /\bimpl(?:<[^>]*>)?\s+(?:[\p{L}_][\p{L}\p{N}_]*::)*([\p{L}_][\p{L}\p{N}_]*)(?:<[^>]*>)?\s+for\b/gu;
    for (const match of code.matchAll(fake)) {
      const line = lineAt(code, match.index);
      const inTest = wholeFile || ranges.some(([first, last]) => line >= first && line <= last);
      if (inTest && ownTraits.has(match[1]) && !FAKEABLE.has(match[1]))
        problems.report(
          path,
          line,
          "CORE-32",
          `a test fake of ${match[1]}: only Random and Probes are faked`,
        );
    }
  }
}

// deps, vendor, vectors ---------------------------------------------------------------------------

function metadata(...args) {
  return JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

function checkDirectDependencies(problems, data, map) {
  const members = new Set(data.workspace_members);
  for (const pkg of data.packages.filter((candidate) => members.has(candidate.id))) {
    const entry = map.crates[pkg.name];
    const manifest = relative(root, pkg.manifest_path);
    if (entry === undefined) {
      problems.report(manifest, 1, "CORE-25", `${pkg.name} is not in module-map.json`);
      continue;
    }
    for (const dependency of pkg.dependencies) {
      const where = dependency.target ?? "all";
      if (dependency.kind === "dev") {
        if (!(entry.devDependencies ?? []).includes(dependency.name))
          problems.report(
            manifest,
            1,
            "CORE-25",
            `${dependency.name} is not a dev dependency module-map.json allows`,
          );
      } else if (dependency.kind !== null)
        problems.report(
          manifest,
          1,
          "CORE-25",
          `${dependency.name} is a ${dependency.kind} dependency`,
        );
      else if (!(entry.dependencies?.[where] ?? []).includes(dependency.name))
        problems.report(
          manifest,
          1,
          "CORE-25",
          `${dependency.name} (${where}) is not allowed by module-map.json`,
        );
      const local =
        dependency.path !== undefined && dependency.path.startsWith(root.replace(/\/$/u, ""));
      if (!local && !dependency.req.startsWith("="))
        problems.report(
          manifest,
          1,
          "CORE-25",
          `${dependency.name} is not pinned exactly: ${dependency.req}`,
        );
    }
  }
}

/** The packages reachable from `start` through normal dependencies in a resolve. */
function reachable(data, start) {
  const nodes = new Map(data.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const queue = data.packages
    .filter((pkg) => start.includes(pkg.name) && data.workspace_members.includes(pkg.id))
    .map((pkg) => pkg.id);
  while (queue.length > 0) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? [])
      if (dep.dep_kinds.some((kind) => kind.kind === null)) queue.push(dep.pkg);
  }
  const names = new Map(data.packages.map((pkg) => [pkg.id, pkg.name]));
  return new Set([...seen].map((id) => names.get(id)));
}

function checkRefusedInTree(problems, map) {
  const artifacts = [
    ...EXECUTABLE_TARGETS.map((target) => [target, ["mnemocode-cli"]]),
    [WASM_TARGET, ["mnemocode-wasm"]],
  ];
  for (const [target, start] of artifacts) {
    const tree = reachable(metadata("--all-features", "--filter-platform", target), start);
    for (const name of map.refusedInTree.crates)
      if (tree.has(name))
        problems.report("Cargo.lock", 1, "RUST-10", `${name} is in the ${target} tree of ${start}`);
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Every file of `folder` (but `record`) and its SHA-256 in `hashes`, both ways. */
function checkHashes(problems, files, folder, record, hashes, rule) {
  const present = files.filter((path) => path.startsWith(`${folder}/`) && path !== record);
  for (const path of present) {
    const name = relative(folder, path);
    const actual = sha256(readFileSync(join(root, path)));
    if (hashes[name] === undefined) problems.report(path, 1, rule, `not listed in ${record}`);
    else if (hashes[name] !== actual)
      problems.report(path, 1, rule, `differs from its SHA-256 in ${record}`);
  }
  for (const name of Object.keys(hashes))
    if (!present.includes(`${folder}/${name}`))
      problems.report(record, 1, rule, `${name} is missing`);
}

function checkLockVendorVectors(problems, files, read) {
  const entry = /\[\[package\]\]\nname = "bc-crypto"\n(?:[^[\n][^\n]*\n)*/u.exec(
    read("Cargo.lock"),
  );
  if (entry === null || /^source = /mu.test(entry[0]))
    problems.report(
      "Cargo.lock",
      1,
      "CORE-47",
      "bc-crypto must be the workspace stand-in, without a registry source",
    );
  for (const upstream of files.filter((path) => /^vendor\/[^/]+\/UPSTREAM\.json$/u.test(path)))
    checkHashes(
      problems,
      files,
      dirname(upstream),
      upstream,
      JSON.parse(read(upstream)).downstreamSourceSha256,
      "CORE-47",
    );
  const recorded = JSON.parse(read("vectors/ts-0.1.0/PROVENANCE.json"));
  checkHashes(
    problems,
    files,
    "vectors/ts-0.1.0",
    "vectors/ts-0.1.0/PROVENANCE.json",
    recorded.files,
    "DOC-04",
  );
  checkHashes(
    problems,
    files,
    "parity/recorders",
    "vectors/ts-0.1.0/PROVENANCE.json",
    recorded.recorders,
    "DOC-04",
  );
  const carried = JSON.parse(read("vectors/PROVENANCE.json"));
  const own = Object.fromEntries(
    Object.entries(carried.files).map(([name, file]) => [name, file.sha256]),
  );
  checkHashes(
    problems,
    files.filter((path) => !path.startsWith("vectors/ts-0.1.0/")),
    "vectors",
    "vectors/PROVENANCE.json",
    own,
    "DOC-04",
  );
}

// tooling -----------------------------------------------------------------------------------------

function pythonStandardLibrary() {
  const run = spawnSync(
    "python3",
    ["-I", "-c", "import json, sys; print(json.dumps(sorted(sys.stdlib_module_names)))"],
    {
      encoding: "utf8",
    },
  );
  if (run.status !== 0)
    throw new Error("code-rules needs Python 3.10 or later as python3 (TOOL-03)");
  return new Set(JSON.parse(run.stdout));
}

function checkPython(problems, files, read) {
  const scripts = files.filter((path) => path.endsWith(".py"));
  if (scripts.length === 0) return;
  const standard = pythonStandardLibrary();
  const local = new Set(scripts.map((path) => path.split("/").pop().slice(0, -3)));
  for (const path of scripts) {
    const requirements = files
      .filter((file) => dirname(file) === dirname(path) && /requirements.*\.txt$/u.test(file))
      .map((file) => read(file))
      .join("\n");
    read(path)
      .split("\n")
      .forEach((line, index) => {
        const match =
          /^\s*(?:from\s+([A-Za-z_]\w*)[\w.]*\s+import\b|import\s+([A-Za-z_]\w*))/u.exec(line);
        const name = match?.[1] ?? match?.[2];
        if (name === undefined || standard.has(name) || local.has(name)) return;
        if (
          !new RegExp(`^${name.replace(/_/gu, "[-_]")}==\\S+.*--hash=sha256:`, "imu").test(
            requirements,
          )
        )
          problems.report(
            path,
            index + 1,
            "TOOL-03",
            `imports ${name}, which no requirements file beside it pins with a hash`,
          );
      });
  }
}

function checkTooling(problems, files, read) {
  for (const path of files) {
    const text = read(path);
    if (!isShellScript(path, text)) continue;
    const shell = readShell(text);
    const first = Math.min(...shell.code);
    if (!/^set -euo pipefail\s*(?:#.*)?$/u.test(text.split("\n")[first - 1]?.trim() ?? ""))
      problems.report(
        path,
        Number.isFinite(first) ? first : 1,
        "TOOL-02",
        "a shell script starts with `set -euo pipefail`",
      );
    for (const line of new Set(shell.unquoted))
      problems.report(path, line, "TOOL-02", 'an expansion outside quotes: write "$name"');
  }
  checkPython(problems, files, read);
  const manifest = JSON.parse(read("package.json"));
  if (!/^pnpm@\d+\.\d+\.\d+$/u.test(manifest.packageManager ?? ""))
    problems.report("package.json", 1, "TOOL-05", "packageManager names pnpm at one exact version");
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }))
    if (!/^\d+\.\d+\.\d+$/u.test(version))
      problems.report("package.json", 1, "CORE-25", `${name} is not pinned exactly: ${version}`);
  if (!files.includes("pnpm-lock.yaml"))
    problems.report("pnpm-lock.yaml", 1, "TOOL-05", "the repository needs pnpm-lock.yaml");
  for (const lockfile of OTHER_LOCKFILES)
    if (files.some((path) => path.split("/").pop() === lockfile))
      problems.report(lockfile, 1, "TOOL-05", "pnpm-lock.yaml is the only lockfile");
}

// run ---------------------------------------------------------------------------------------------

/** The parts that read only source text, over `sources`: what the self-test runs too. */
function checkSources(problems, sources, map) {
  checkLayers(problems, sources, map);
  for (const { path, text } of sources)
    if (path.endsWith(".rs") && Object.keys(OWN_CRATES).some((dir) => path.startsWith(`${dir}/`)))
      checkLints(problems, path, text, map);
  checkTests(
    problems,
    sources.filter(({ path }) => Object.keys(OWN_CRATES).some((dir) => path.startsWith(`${dir}/`))),
  );
}

/** The parts against cases each must catch, and one it must pass (CORE-28). */
async function selfTest() {
  const { CASES } = await import("./code-rules-cases.mjs");
  const map = JSON.parse(readFileSync(join(root, "module-map.json"), "utf8"));
  const failed = [];
  for (const { name, sources, manifest, expect } of CASES) {
    const problems = new Problems();
    if (sources !== undefined) checkSources(problems, sources, map);
    if (manifest !== undefined) checkReleaseProfile(problems, manifest);
    const caught = problems.list.some((line) => line.includes(expect ?? "\u0000"));
    if (expect === undefined ? problems.list.length > 0 : !caught)
      failed.push(`${name}: ${problems.list.join(" | ") || "nothing caught"}`);
  }
  if (failed.length > 0) {
    process.stderr.write(`${failed.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`code-rules: the self-test catches all ${CASES.length} cases.\n`);
}

function run() {
  const map = JSON.parse(readFileSync(join(root, "module-map.json"), "utf8"));
  const read = (path) => readFileSync(join(root, path), "utf8");
  const files = trackedOrNewFiles(root)
    .filter((path) => statSync(join(root, path)).isFile())
    .sort();
  const problems = new Problems();
  const sources = files
    .filter((path) => path.endsWith(".rs") && !path.startsWith("vendor/"))
    .map((path) => ({ path, text: read(path) }));
  checkSources(problems, sources, map);
  checkDirectDependencies(problems, metadata(), map);
  checkRefusedInTree(problems, map);
  checkLockVendorVectors(problems, files, read);
  checkManifests(problems, files, read, map);
  checkSizes(problems, files, read);
  checkTooling(problems, files, read);
  if (problems.list.length > 0) {
    process.stderr.write(`${problems.list.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`code-rules: ${files.length} files checked\n`);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") await selfTest();
else if (args.length === 0) run();
else {
  process.stderr.write("usage: node scripts/verify-code-rules.mjs [--self-test]\n");
  process.exit(2);
}
