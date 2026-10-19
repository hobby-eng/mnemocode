// Deliberate copy of the original AUD-035 runner: preserve its serial default-universe procedure
// while writing only new remediation evidence; the baseline runner and records stay immutable.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const folder = "docs/audits/AUD-035-evidence/remediation-2026-10-19";
const vitest = "node_modules/vitest/vitest.mjs";
const listing = spawnSync(process.execPath, [vitest, "list", "--filesOnly", "--json"], {
  encoding: "utf8",
});
if (listing.error) throw listing.error;
if (listing.status !== 0) {
  process.stderr.write(listing.stderr);
  process.exit(listing.status ?? 1);
}
const universe = JSON.parse(listing.stdout);
const files = universe.map(({ file }) => file);
if (new Set(files).size !== files.length) throw new Error("The default file universe repeats a file.");
const inventory = `${folder}/test-universe.json`;
if (existsSync(inventory)) throw new Error("Refusing to replace a prior test-universe capture.");
writeFileSync(inventory, JSON.stringify(universe, null, 2) + "\n", { flag: "wx" });
writeFileSync(`${folder}/test-input-hashes.json`, JSON.stringify(files.map((path) => ({
  path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
})), null, 2) + "\n", { flag: "wx" });
let failed = false;
for (let index = 0; index < files.length; index += 1) {
  const label = `suite-${String(index + 1).padStart(3, "0")}`;
  const output = `${folder}/${label}.vitest.json`;
  console.log(`FILE ${index + 1}/${files.length}: ${files[index]}`);
  const run = spawnSync(process.execPath, [
    "docs/audits/AUD-035-remediation-harnesses/run.mjs", label, process.execPath, vitest, "run", files[index],
    "--pool=threads", "--maxWorkers=1", "--no-file-parallelism",
    "--reporter=json", "--outputFile", output,
  ], { stdio: "inherit" });
  if (run.error) throw run.error;
  if (run.status !== 0) failed = true;
  if ([125, 143, 241].includes(run.status)) {
    console.error("Resource/admission stop retained as incomplete; no automatic retry.");
    process.exit(run.status);
  }
}
console.log(JSON.stringify({ completedFiles: files.length, failed }));
process.exitCode = failed ? 1 : 0;
