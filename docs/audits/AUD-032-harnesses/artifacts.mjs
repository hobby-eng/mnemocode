// Bind ignored outputs to this audited build without treating them as published release assets.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function filesAt(folder) {
  return readdirSync(resolve(root, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => {
      const path = relative(root, resolve(entry.parentPath, entry.name));
      return { path, bytes: statSync(resolve(root, path)).size,
        sha256: sha(readFileSync(resolve(root, path))) };
    }).sort((left, right) => left.path.localeCompare(right.path));
}
const dist = filesAt("dist");
const first = filesAt("docs/audits/AUD-032-evidence/linux-executable");
const second = filesAt("docs/audits/AUD-032-evidence/linux-executable-repeat");
assert.deepEqual(first.map(({ path, ...file }) => file), second.map(({ path, ...file }) => file));
const priorRelease = JSON.parse(readFileSync(resolve(evidence, "release-before.json"), "utf8"));
for (const file of priorRelease.artifacts)
  assert.equal(sha(readFileSync(resolve(root, file.path))), file.sha256);
const notices = readFileSync(resolve(root,
  "docs/audits/AUD-032-evidence/linux-executable/mnemocode-0.1.0-linux-x64-licenses.txt"), "utf8");
const npmNotices = [...notices.matchAll(/^npm package (.+)$/gmu)].map((match) => match[1]);
assert.ok(npmNotices.length > 0);
for (const section of ["Node.js v26.10.0", "SSKR engine", "Fonts and map data"])
  assert.ok(notices.includes(section));
const beforeImport = performance.now();
const { assertCoreSelfTest } = await import("../../../dist/cli/self-test.js");
const importMs = performance.now() - beforeImport;
const startupMs = [];
for (let index = 0; index < 5; index++) {
  const started = performance.now();
  assertCoreSelfTest();
  startupMs.push(performance.now() - started);
}
const result = {
  auditId: "AUD-032", capturedAtUtc: new Date().toISOString(),
  dist: { files: dist, fingerprint: sha(JSON.stringify(dist)) },
  linux: { first, second, sameHostByteIdentical: true,
    qualification: "Two local builds on the same installed Node/toolchain and OS; not cross-machine or cross-platform reproducibility, provenance attestation or publisher signature." },
  oldRelease: { unchanged: true, files: priorRelease.artifacts,
    qualification: "Pre-existing ignored artifact retained unchanged and not accepted as the current release candidate." },
  npmNotices,
  startup: { importMs, startupMs,
    qualification: "One current local process, separate import and five actual core assertions. Not universal end-to-end launch latency or a changed cryptographic work factor." },
};
writeFileSync(resolve(evidence, "artifacts.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ distFiles: dist.length, distFingerprint: result.dist.fingerprint,
  sameHostByteIdentical: true, executable: first.find((file) => file.path.endsWith("linux-x64")),
  bundledNpmNotices: npmNotices.length, oldReleaseUnchanged: true, startup: result.startup }));
