// Reuse frozen executors with new evidence paths; never overwrite earlier audit results.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const suite = process.argv[2] === "--suite";
const previous = "docs/audits/AUD-035-remediation-harnesses";
const oldEvidence = "docs/audits/AUD-035-evidence/remediation-2026-10-19";
const run = process.env.AUD036_RUN;
assert.ok(run === undefined || /^[a-z0-9][a-z0-9-]{0,47}$/u.test(run), "Use a short run name.");
const evidence = `docs/audits/AUD-036-evidence${run === undefined ? "" : `/${run}`}`;
const runner = "docs/audits/AUD-036-harnesses/run.mjs";
let source = readFileSync(`${previous}/${suite ? "suite" : "run"}.mjs`, "utf8");
assert.ok(source.includes(oldEvidence), "The retained executor's output path changed.");
source = source.replaceAll(oldEvidence, evidence);
if (suite) {
  assert.ok(source.includes(`${previous}/run.mjs`), "The retained suite runner changed.");
  source = source.replaceAll(`${previous}/run.mjs`, runner);
}
mkdirSync(evidence, { recursive: true });
const result = spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", source, "aud036", ...process.argv.slice(suite ? 3 : 2)],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
