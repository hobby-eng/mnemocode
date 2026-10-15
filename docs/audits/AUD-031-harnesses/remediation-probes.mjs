// Exercise the actual publisher in a VM with an intercepted filesystem write edge.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";
import vm from "node:vm";
import { ErrorCatalog } from "../../../src/core/error-catalog.ts";

const root = process.cwd();
const local = path.join(root, "docs/audits/AUD-031-evidence");
const publisher = path.join(root, "docs/audits/AUD-031-harnesses/remediation.mjs");
const metadata = path.join(local, "r50-remediation-review.json");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const prior = JSON.parse(fs.readFileSync(path.join(local, "r49-remediation-review.json")));
const accepted = { status: "complete-with-limitations", acceptedFinalInputs: true,
  limitations: ["Synthetic filesystem-edge fixture; no real acceptance or publication."],
  reviewedInputs: [...new Set([...prior.reviewedInputs.map((row) => row.path),
    "docs/audits/AUD-031-harnesses/remediation-probes.mjs"])].map((file) => ({ path: file,
    sha256: sha(fs.readFileSync(path.join(root, file))) })) };
const original = ["json", "md"].map((ext) => sha(fs.readFileSync(
  path.join(root, "docs/audits/AUD-031-2026-10-15." + ext))));

async function run(name, fixture, expected, expectedWrites = 0) {
  const writes = [];
  const readEdge = (file, ...args) => String(file) === metadata
    ? Buffer.from(JSON.stringify(fixture)) : fs.readFileSync(file, ...args);
  const fileEdge = { ...fs, readFileSync: readEdge,
    existsSync: (file) => String(file) === metadata ? fixture !== null : fs.existsSync(file),
    writeFileSync: (file, bytes) => writes.push({ file: String(file), bytes }) };
  const context = vm.createContext({ process: { argv: ["node", publisher, "--publish"] },
    console: { log() {} }, Buffer, URL });
  const module = new vm.SourceTextModule(fs.readFileSync(publisher, "utf8"), {
    context, identifier: url.pathToFileURL(publisher).href,
    initializeImportMeta(meta) { meta.url = url.pathToFileURL(publisher).href; },
  });
  const dependencies = new Map([["node:crypto", crypto], ["node:fs", fileEdge],
    ["node:os", os], ["node:path", path], ["node:url", url],
    ["../../../src/core/error-catalog.ts", { ErrorCatalog }]]);
  await module.link((specifier) => {
    const dependency = dependencies.get(specifier);
    assert.ok(dependency, specifier);
    return new vm.SyntheticModule(Object.keys(dependency), function () {
      for (const [key, value] of Object.entries(dependency)) this.setExport(key, value);
    }, { context });
  });
  if (expected) await assert.rejects(module.evaluate(), (error) =>
    error.code === "audits.aud031.remediation." + expected);
  else await module.evaluate();
  assert.equal(writes.length, expectedWrites, name);
  assert.deepEqual(["json", "md"].map((ext) => sha(fs.readFileSync(
    path.join(root, "docs/audits/AUD-031-2026-10-15." + ext)))), original);
  console.log("PASS " + name);
}

await run("missing metadata acceptance refuses before writes", null, "incomplete");
await run("rejected metadata acceptance refuses before writes", {
  ...accepted, acceptedFinalInputs: false }, "incomplete");
await run("incomplete accepted bindings refuse before writes", {
  ...accepted, reviewedInputs: [] }, "incomplete");
await run("drifted accepted binding refuses before writes", { ...accepted,
  reviewedInputs: accepted.reviewedInputs.map((row, index) => index === 0
    ? { ...row, sha256: "0".repeat(64) } : row) }, "drift");
await run("complete bindings reach only intercepted writes", accepted, null, 2);
