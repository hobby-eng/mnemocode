// AUD-008: execute the actual executable builder with in-memory filesystem/build stubs.
// No executable is rebuilt and no filesystem mutations reach the checkout or /tmp.
// Run: node --experimental-vm-modules docs/audits/AUD-008-harnesses/devops-build-failure.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as realFs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import vm from "node:vm";

const root = process.cwd();
const sourcePath = path.join(root, "scripts/build-executable.mjs");
const source = realFs.readFileSync(sourcePath, "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const output = "/AUD-008-mocked-output";
const work = "/AUD-008-mocked-work";
const name = "mnemocode-0.1.0-linux-x64";
const previous = Buffer.from("previous validated executable");
const results = [];

for (const failureAt of ["bundle", "sea", "notices"]) {
  const files = new Map([
    [path.join(output, name), previous],
    [path.join(output, `${name}-licenses.txt`), Buffer.from("previous notices")],
    [path.join(output, `${name}.sha256`), Buffer.from("previous checksums")],
  ]);
  const events = [];
  let workExists = false;
  const syntheticFs = {
    mkdirSync: () => {},
    mkdtempSync: () => {
      workExists = true;
      events.push("work-created");
      return work;
    },
    readdirSync: (...args) => realFs.readdirSync(...args),
    statSync: (...args) => realFs.statSync(...args),
    readFileSync: (file, encoding) => {
      if (files.has(file)) return encoding ? files.get(file).toString(encoding) : files.get(file);
      return realFs.readFileSync(file, encoding);
    },
    writeFileSync: (file, value) => {
      files.set(file, Buffer.from(value));
      events.push(`write:${file}`);
    },
    rmSync: (file) => {
      if (file === work) {
        workExists = false;
        events.push("work-removed");
      } else {
        files.delete(file);
        events.push(`remove:${file}`);
      }
    },
  };
  const context = vm.createContext({
    Buffer,
    URL,
    console: { log: () => {}, error: () => {} },
    process: {
      argv: ["node", sourcePath, output],
      version: "v26.10.0",
      platform: "linux",
      execPath: "/mock/node",
    },
  });
  const exportsByModule = {
    "node:fs": syntheticFs,
    "node:path": path,
    "node:url": url,
    "node:os": { tmpdir: () => "/mock/tmp" },
    "node:crypto": { createHash },
    "node:child_process": {
      execFileSync: (_command, args) => {
        events.push(`execute:${args[0]}`);
        if (failureAt === "sea") throw new Error("AUD-008 injected SEA failure");
        files.set(path.join(output, name), Buffer.from("new executable"));
      },
    },
    esbuild: {
      build: async () => {
        events.push("bundle");
        if (failureAt === "bundle") throw new Error("AUD-008 injected bundler failure");
        return { metafile: { inputs: {} } };
      },
    },
    "./executable-files.mjs": {
      executableName: () => name,
      noticesName: () => `${name}-licenses.txt`,
    },
    "./executable-notices.mjs": {
      executableNotices: () => {
        events.push("notices");
        if (failureAt === "notices") throw new Error("AUD-008 injected missing Node LICENSE");
        return "new notices";
      },
    },
  };
  const builder = new vm.SourceTextModule(source, {
    context,
    identifier: sourcePath,
    initializeImportMeta: (meta) => {
      meta.url = url.pathToFileURL(sourcePath).href;
    },
  });
  await builder.link((specifier) => {
    const members = exportsByModule[specifier];
    assert.ok(members, `Unexpected import: ${specifier}`);
    return new vm.SyntheticModule(
      Object.keys(members),
      function () {
        for (const [key, value] of Object.entries(members)) this.setExport(key, value);
      },
      { context },
    );
  });
  let error;
  try {
    await builder.evaluate();
  } catch (caught) {
    error = caught.message;
  }
  assert.ok(
    error?.startsWith("AUD-008 injected"),
    `Expected mocked build failure; received ${error}`,
  );
  const oldExecutablePreserved = files.get(path.join(output, name))?.equals(previous) ?? false;
  const result = {
    failureAt,
    error,
    oldExecutablePreserved,
    executableExists: files.has(path.join(output, name)),
    previousNoticesPreserved:
      files.get(path.join(output, `${name}-licenses.txt`)).toString() === "previous notices",
    previousChecksumsPreserved:
      files.get(path.join(output, `${name}.sha256`)).toString() === "previous checksums",
    workDirectoryRemoved: !workExists,
    events,
  };
  assert.equal(result.oldExecutablePreserved, failureAt === "bundle");
  assert.equal(result.workDirectoryRemoved, failureAt === "notices");
  results.push(result);
}
console.log(
  JSON.stringify({ sourcePath, sourceSha256, noRealWritesOrBuilds: true, results }, null, 2),
);
// This regression harness exits nonzero while failure cleanup/publication remains non-atomic.
if (results.some((result) => !result.oldExecutablePreserved || !result.workDirectoryRemoved))
  process.exitCode = 1;
