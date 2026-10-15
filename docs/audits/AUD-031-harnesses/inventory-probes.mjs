// Exercise the unchanged inventory entry against synthetic filesystem/process boundaries.
// No checkout, installation copy, real inventory output or product execution is created.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import { ErrorCatalog } from "../../../src/core/error-catalog.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const subject = resolve(root, "docs/audits/AUD-031-harnesses/inventory.mjs");
const source = readFileSync(subject, "utf8");
const evidence = resolve(root, "docs/audits/AUD-031-evidence");
const snapshot = resolve(evidence, "snapshot.json");
const ownPrefix = "docs/audits/AUD-031";
const declarationFixture = `
export interface Callable {
  (value: string): boolean;
  new(value: string): object;
  [key: string]: unknown;
  named(): void;
}
export class Owner {
  constructor() {}
  #secret = 0;
  run(): void {}
}
export type Owned = ((value: string) => boolean) & Disposable;
`;
const importFixture = `
await import("../src/core.js");
const load = (path) => import(pathToFileURL(resolve(moduleRoot, path)).href);
`;
const fixturePaths = ["src/inventory-fixture.ts", "scripts/inventory-fixture.mjs"];
const fixturePatch = "diff --git a/src/example.ts b/src/example.ts\nGIT binary patch\n";

function refusal(code) {
  return Object.assign(new Error("Synthetic inventory filesystem/process refusal."), { code });
}

function fixture() {
  const files = new Map([
    [resolve(root, fixturePaths[0]), declarationFixture],
    [resolve(root, fixturePaths[1]), importFixture],
    [resolve(root, "docs/audits/AUD-030-evidence/snapshot.json"), '{"files":[]}'],
  ]);
  const writes = [];
  const state = { files, writes, failCompanion: false, failDiff: false,
    failMarker: false, diffArguments: [] };
  state.fs = {
    existsSync: (path) => String(path).startsWith(evidence)
      ? files.has(String(path)) : files.has(String(path)) || existsSync(path),
    readFileSync: (path, encoding) => {
      const value = files.get(String(path));
      if (value === undefined) {
        if (String(path).startsWith(evidence)) throw refusal("ENOENT");
        return readFileSync(path, encoding);
      }
      return encoding === undefined ? Buffer.from(value) : value;
    },
    mkdirSync: () => undefined,
    writeFileSync: (path, value) => {
      if (state.failCompanion && String(path).endsWith("/public-contracts.json"))
        throw refusal("EISDIR");
      if (state.failMarker && (String(path) === snapshot || String(path).includes("/.snapshot-"))) {
        files.set(String(path), '{"partial":');
        throw refusal("EIO");
      }
      files.set(String(path), String(value));
      writes.push(String(path));
    },
    linkSync: (from, to) => {
      if (files.has(String(to))) throw refusal("EEXIST");
      if (!files.has(String(from))) throw refusal("ENOENT");
      files.set(String(to), files.get(String(from)));
      writes.push(String(to));
    },
    unlinkSync: (path) => files.delete(String(path)),
  };
  state.git = (_command, args) => {
    if (args[0] === "ls-files") return fixturePaths.join("\0") + "\0";
    if (args[0] === "rev-parse") return "0".repeat(40) + "\n";
    if (args[0] === "branch") return "main\n";
    if (args[0] === "status") return " M src/inventory-fixture.ts\n";
    if (args[0] === "diff") {
      state.diffArguments = args;
      if (state.failDiff) throw refusal("EACCES");
      return fixturePatch;
    }
    throw refusal("UNEXPECTED_COMMAND");
  };
  return state;
}

async function capture(state) {
  const context = createContext({ Buffer, URL, console: { log: () => undefined }, process });
  const module = new SourceTextModule(source, {
    context,
    identifier: pathToFileURL(subject).href,
    initializeImportMeta: (meta) => { meta.url = pathToFileURL(subject).href; },
    importModuleDynamically: () => { throw refusal("INPUT_IMPORT_MUST_NOT_EXECUTE"); },
  });
  await module.link(async (specifier) => {
    const namespace = specifier.startsWith("node:")
      ? await import(specifier) : { ErrorCatalog };
    const overrides = specifier === "node:fs" ? state.fs
      : specifier === "node:child_process" ? { execFileSync: state.git } : {};
    const bindings = { ...namespace, ...overrides };
    return new SyntheticModule(Object.keys(bindings), function () {
      for (const [name, value] of Object.entries(bindings)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
}

const cases = [
  ["a companion write failure leaves no admitted snapshot and permits a corrected retry", async () => {
    const state = fixture();
    state.failCompanion = true;
    await assert.rejects(capture(state), (error) => error.code === "EISDIR");
    assert.equal(state.files.has(snapshot), false);
    state.failCompanion = false;
    await capture(state);
    assert.equal(state.files.has(snapshot), true);
  }],
  ["a diff refusal leaves no admitted snapshot and permits a corrected retry", async () => {
    const state = fixture();
    state.failDiff = true;
    await assert.rejects(capture(state), (error) => error.code === "EACCES");
    assert.equal(state.files.has(snapshot), false);
    state.failDiff = false;
    await capture(state);
    assert.equal(state.files.has(snapshot), true);
  }],
  ["a complete capture refuses a second invocation without modifying retained bytes", async () => {
    const state = fixture();
    await capture(state);
    const before = JSON.stringify([...state.files]);
    await assert.rejects(capture(state), (error) => error.code === "audits.aud031.inventory.retained");
    assert.equal(JSON.stringify([...state.files]), before);
  }],
  ["a partial marker write stays unadmitted and permits a corrected retry", async () => {
    const state = fixture();
    state.failMarker = true;
    await assert.rejects(capture(state), (error) => error.code === "EIO");
    assert.equal(state.files.has(snapshot), false);
    state.failMarker = false;
    await capture(state);
    assert.equal(typeof JSON.parse(state.files.get(snapshot)).sourceFingerprint, "string");
  }],
  ["interface signatures and public class constructors survive the inventory", async () => {
    const state = fixture();
    await capture(state);
    const contracts = JSON.parse(state.files.get(resolve(evidence, "public-contracts.json"))).contracts;
    const callable = contracts.find((item) => item.name === "Callable");
    assert.deepEqual(callable.members.map((member) => member.kind), [
      "CallSignature", "ConstructSignature", "IndexSignature", "MethodSignature",
    ]);
    const owner = contracts.find((item) => item.name === "Owner");
    assert.deepEqual(owner.members.map((member) => member.name), ["constructor", "run"]);
    assert.equal(callable.review, "unreviewed");
  }],
  ["literal and computed imports both remain explicit unreviewed edges", async () => {
    const state = fixture();
    await capture(state);
    const captured = JSON.parse(state.files.get(snapshot));
    const file = captured.files.find((item) => item.path === fixturePaths[1]);
    assert.equal(file.dependencies.length, 2);
    assert.equal(file.dependencies[0].specifier, "../src/core.js");
    assert.equal(file.dependencies[1].unresolved, true);
    assert.match(file.dependencies[1].expression, /pathToFileURL/u);
    assert.equal(file.dependencies[1].review, "manual-review-required");
  }],
  ["the binary tracked diff requests the same own-audit exclusion as the file inventory", async () => {
    const state = fixture();
    await capture(state);
    assert.ok(state.diffArguments.includes("--binary"));
    assert.ok(state.diffArguments.includes(`:(exclude)${ownPrefix}*`));
    assert.equal(state.files.get(resolve(evidence, "tracked-baseline.patch")), fixturePatch);
  }],
  ["the real Git pathspec excludes this audit while retaining admitted source paths", async () => {
    const listed = (...pathspec) => new Set(execFileSync("git", [
      "ls-files", "-co", "--exclude-standard", "-z", "--", ".", ...pathspec,
    ], { cwd: root, encoding: "utf8" }).split("\0"));
    const own = `${ownPrefix}-harnesses/inventory.mjs`;
    assert.equal(listed().has(own), true);
    const filtered = listed(`:(exclude)${ownPrefix}*`);
    assert.equal(filtered.has(own), false);
    assert.equal(filtered.has("src/core/secret-value.ts"), true);
  }],
];
let failures = 0;
for (const [name, run] of cases) {
  try { await run(); console.log("PASS " + name); }
  catch (error) { failures += 1; console.log("FAIL " + name + ": " + error.message); }
}
console.log(JSON.stringify({ cases: cases.length, failures,
  boundary: "Unmodified subject module; synthetic filesystem/git edges, real existing TypeScript parser and ErrorCatalog; no real baseline or project copy." }));
if (failures !== 0) process.exitCode = 1;
