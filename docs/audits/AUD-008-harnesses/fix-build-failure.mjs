// AUD-008-BLD001: execute the exact current builder with an in-memory filesystem.
// No real build, artifact write or copy of the checkout. Needs node --experimental-vm-modules.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import vm from "node:vm";

const sourcePath = path.resolve("scripts/build-executable.mjs");
const source = fs.readFileSync(sourcePath, "utf8");
const output = "/AUD008-fake-output";
const work = "/AUD008-fake-work";
const staging = path.join(output, ".staging-fake");
const name = "mnemocode-0.1.0-linux-x64";
const artifacts = [name, `${name}-licenses.txt`, `${name}.sha256`];
const phases = [
  "work",
  "staging",
  "bundle",
  "sea",
  "signing",
  "notices",
  "checksums",
  "backup-0",
  "backup-1",
  "backup-2",
  "publish-0",
  "publish-1",
  "publish-2",
  "rollback",
  "none",
];
const results = [];

for (const prior of ["complete", "absent", "partial"]) {
  for (const phase of phases) {
    if (phase === "rollback" && prior !== "complete") continue;
    if (
      phase.startsWith("backup-") &&
      (prior === "absent" || (prior === "partial" && phase !== "backup-0"))
    )
      continue;
    const originals = new Map(
      artifacts.flatMap((file, index) =>
        prior === "absent" || (prior === "partial" && index !== 0)
          ? []
          : [[path.join(output, file), Buffer.from(`old-${index}`)]],
      ),
    );
    const files = new Map(originals);
    let workExists = false;
    let stagingExists = false;
    const fail = (here) => {
      if (phase === "rollback" && here === "publish-1")
        throw new Error("AUD008 injected publication failure");
      if (phase === here) throw new Error(`AUD008 injected ${here}`);
    };
    const mockedFs = {
      mkdirSync: () => {},
      mkdtempSync: (prefix) => {
        if (prefix.startsWith(output)) {
          fail("staging");
          stagingExists = true;
          return staging;
        }
        fail("work");
        workExists = true;
        return work;
      },
      existsSync: (file) => files.has(file),
      copyFileSync: (from, to) => {
        fail(`backup-${artifacts.indexOf(path.basename(from))}`);
        assert.ok(files.has(from));
        files.set(to, Buffer.from(files.get(from)));
      },
      renameSync: (from, to) => {
        if (phase === "rollback" && path.basename(from) === "previous-0")
          throw new Error("AUD008 injected rollback failure");
        if (path.basename(from).startsWith(name))
          fail(`publish-${artifacts.indexOf(path.basename(from))}`);
        assert.ok(files.has(from), `Missing mock source: ${from}`);
        files.set(to, files.get(from));
        files.delete(from);
      },
      readFileSync: (file, encoding) =>
        files.has(file)
          ? encoding
            ? files.get(file).toString(encoding)
            : files.get(file)
          : fs.readFileSync(file, encoding),
      writeFileSync: (file, value) => {
        if (file.endsWith(".sha256")) fail("checksums");
        files.set(file, Buffer.from(value));
      },
      readdirSync: fs.readdirSync,
      statSync: fs.statSync,
      rmSync: (file) => {
        if (file === work) workExists = false;
        if (file === staging) stagingExists = false;
        for (const key of [...files.keys()])
          if (key === file || key.startsWith(`${file}/`)) files.delete(key);
      },
    };
    const context = vm.createContext({
      Buffer,
      URL,
      console: { log: () => {} },
      process: {
        argv: ["node", sourcePath, output],
        version: "v26.10.0",
        platform: "darwin",
        execPath: "/fake/node",
      },
    });
    const members = {
      "node:fs": mockedFs,
      "node:path": path,
      "node:url": url,
      "node:crypto": { createHash },
      "node:os": { tmpdir: () => "/fake/tmp" },
      "node:child_process": {
        execFileSync: (command) => {
          if (command === "codesign") fail("signing");
          else {
            fail("sea");
            files.set(path.join(staging, name), Buffer.from("new executable"));
          }
        },
      },
      esbuild: {
        build: async () => {
          fail("bundle");
          return { metafile: { inputs: {} } };
        },
      },
      "./executable-files.mjs": { executableName: () => name, noticesName: () => artifacts[1] },
      "./executable-notices.mjs": {
        executableNotices: () => {
          fail("notices");
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
      const values = members[specifier];
      assert.ok(values, specifier);
      return new vm.SyntheticModule(
        Object.keys(values),
        function () {
          for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        },
        { context },
      );
    });
    let error;
    try {
      await builder.evaluate();
    } catch (caught) {
      error = caught;
    }
    if (phase === "none") {
      assert.equal(error, undefined);
      assert.equal(files.get(path.join(output, name)).toString(), "new executable");
      assert.equal(files.get(path.join(output, artifacts[1])).toString(), "new notices");
      assert.match(files.get(path.join(output, artifacts[2])).toString(), /^[a-f0-9]{64} /u);
    } else if (phase === "rollback") {
      assert.equal(error?.name, "AggregateError");
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /backups remain/u);
      assert.deepEqual(
        files.get(path.join(staging, "previous-0")),
        originals.get(path.join(output, name)),
      );
    } else {
      assert.equal(error?.message, `AUD008 injected ${phase}`);
      for (const file of artifacts)
        assert.deepEqual(
          files.get(path.join(output, file)),
          originals.get(path.join(output, file)),
          `${prior}/${phase}/${file}`,
        );
    }
    assert.equal(workExists, false, `${prior}/${phase}: work leaked`);
    assert.equal(
      stagingExists,
      phase === "rollback",
      `${prior}/${phase}: staging cleanup or backup retention failed`,
    );
    results.push({
      prior,
      phase,
      previousSetPreserved: phase !== "none" && phase !== "rollback",
      ...(phase === "rollback" ? { backupRetainedAfterRollbackFailure: true } : {}),
      cleanupPassed: true,
    });
  }
}
console.log(
  JSON.stringify(
    {
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      noRealWritesOrBuilds: true,
      checks: results.length,
      results,
    },
    null,
    2,
  ),
);
