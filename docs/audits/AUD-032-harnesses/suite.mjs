// Run every current test file, serially, with one worker and one immutable receipt per file.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(root, "docs/audits/AUD-032-evidence");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const snapshot = JSON.parse(readFileSync(resolve(directory, "snapshot.json"), "utf8"));
const names = [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }).split("\0"))]
  .filter((path) => /^test\/.*\.test\.ts$/u.test(path)).sort();
if (names.length === 0) throw new Error("No tests admitted.");
const manifest = names.map((path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
for (const entry of manifest)
  if (!snapshot.files.some((file) => file.path === entry.path && file.sha256 === entry.sha256))
    throw new Error(`Test source drift: ${entry.path}`);
const manifestPath = resolve(directory, "suite-manifest.json");
if (existsSync(manifestPath)) {
  if (JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) !== JSON.stringify(manifest))
    throw new Error("Retained test manifest differs.");
} else writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
const results = [];
const excluded = [{
  path: "test/self-test-integrity.test.ts",
  outcome: "blocked",
  reason: "Creates complete disposable dist/vector installations; excluded under the explicit no-project-copy constraint. Source/assertion review remains applicable; no execution credit.",
}];
for (const [index, entry] of manifest.entries()) {
  if (excluded.some((item) => item.path === entry.path)) continue;
  const baseLabel = `suite-${String(index + 1).padStart(3, "0")}`;
  let label = baseLabel;
  let attempt = 1;
  while (!existsSync(resolve(directory, `${label}.command.json`))
    && existsSync(resolve(directory, `${label}.log`))) {
    const interrupted = resolve(directory, `${label}.interrupted.json`);
    if (!existsSync(interrupted)) {
      const bytes = readFileSync(resolve(directory, `${label}.log`));
      writeFileSync(interrupted, JSON.stringify({
        label, path: entry.path, observedAtUtc: new Date().toISOString(),
        state: "interrupted-without-receipt",
        exitCode: null, logSha256: sha(bytes),
        qualification: "No running process or complete receipt remained after the session interruption. This is not a product failure or pass.",
      }, null, 2) + "\n", { flag: "wx" });
    }
    label = `${baseLabel}-retry-${attempt++}`;
  }
  const receipt = resolve(directory, `${label}.command.json`);
  const output = resolve(directory, `${label}.vitest.json`);
  if (!existsSync(receipt)) {
    const child = spawnSync(process.execPath, [
      resolve(root, "docs/audits/AUD-032-harnesses/run.mjs"), label,
      process.execPath, resolve(root, "node_modules/vitest/vitest.mjs"), "run", entry.path,
      "--pool=threads", "--maxWorkers=1", "--no-file-parallelism",
      "--reporter=json", `--outputFile=${output}`,
    ], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
    if (child.error) throw child.error;
  }
  const record = JSON.parse(readFileSync(receipt, "utf8"));
  if (record.sourceBefore !== snapshot.sourceFingerprint || record.sourceAfter !== snapshot.sourceFingerprint)
    throw new Error(`Source identity changed during ${label}.`);
  const report = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
  const result = { label, path: entry.path, exitCode: record.exitCode, stopReason: record.stopReason,
    total: report?.numTotalTests ?? null, passed: report?.numPassedTests ?? null,
    failed: report?.numFailedTests ?? null, pending: report?.numPendingTests ?? null,
    todo: report?.numTodoTests ?? null, logSha256: record.logSha256,
    resultSha256: report === null ? null : sha(readFileSync(output)) };
  results.push(result);
  console.log(JSON.stringify(result));
  writeFileSync(resolve(directory, "suite-progress.json"), JSON.stringify(results, null, 2) + "\n");
  if (record.stopReason) throw new Error(`Resource boundary reached at ${label}; inspect before resuming.`);
}
const counts = results.reduce((sum, row) => {
  for (const key of ["total", "passed", "failed", "pending", "todo"]) sum[key] += row[key] ?? 0;
  return sum;
}, { total: 0, passed: 0, failed: 0, pending: 0, todo: 0 });
const summary = { sourceFingerprint: snapshot.sourceFingerprint,
  completedAtUtc: new Date().toISOString(), files: results.length,
  inventoriedFiles: manifest.length, excluded,
  completedFiles: results.filter((row) => row.total !== null).length,
  failedCommands: results.filter((row) => row.exitCode !== 0).map((row) => row.label),
  counts, qualification: "Disjoint test files; no totals from separate probes or reruns are added.",
  results };
writeFileSync(resolve(directory, "suite-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ files: summary.files, counts, failedCommands: summary.failedCommands }));
process.exitCode = summary.failedCommands.length || summary.completedFiles !== summary.files ? 1
  : excluded.length ? 125 : 0;
