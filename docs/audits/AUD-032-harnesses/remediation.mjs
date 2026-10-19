// Records the authorized three-finding follow-up without rewriting baseline evidence.
// Run normally to record it, then with --check to verify the same report bytes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const arguments_ = process.argv.slice(2);
assert.ok(
  arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--check"),
  "Usage: node docs/audits/AUD-032-harnesses/remediation.mjs [--check]",
);
const checkOnly = arguments_[0] === "--check";
const names = {
  markdown: "AUD-032-2026-10-16.md",
  json: "AUD-032-2026-10-16.json",
};
const baselineHashes = {
  markdown: "ac511e8f0a1cae9c66260e249c089b7e942584009810708d8b14fd8a1b612388",
  json: "0409f8b841962d3e28f0b147e149767a7717901553930d499d5802989f4c584c",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const baseline = {};
for (const [kind, name] of Object.entries(names)) {
  const saved = resolve(evidence, `accepted-baseline-${name}`);
  const bytes = readFileSync(existsSync(saved) ? saved : resolve(root, "docs/audits", name));
  assert.equal(digest(bytes), baselineHashes[kind], `The accepted ${kind} baseline changed.`);
  baseline[kind] = bytes;
  if (!checkOnly && !existsSync(saved)) writeFileSync(saved, bytes, { flag: "wx" });
}

const reviewPath = resolve(evidence, "remediation-review.json");
const review = readJson(reviewPath);
assert.equal(review.accepted, true);
const snapshotPath = resolve(root, "docs/audits/AUD-033-evidence/snapshot.json");
const snapshot = readJson(snapshotPath);
const sourceFingerprint = review.snapshot.sourceFingerprint;
assert.equal(sourceFingerprint, snapshot.sourceFingerprint);
const source = snapshot.files.filter((file) => !file.path.startsWith("docs/audits/"));
const currentPaths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter((path) => path && !path.startsWith("docs/audits/")).sort();
assert.deepEqual(currentPaths, source.map((file) => file.path).sort());
for (const file of source)
  assert.equal(digest(readFileSync(resolve(root, file.path))), file.sha256, file.path);
for (const input of review.reviewedInputs)
  assert.equal(digest(readFileSync(resolve(root, input.path))), input.sha256, input.path);

const labels = [
  "remediation-format",
  "remediation-targeted",
  "remediation-fast-gates",
  "remediation-linux-build",
  "remediation-linux-verify",
];
const executions = labels.map((label) => {
  const receiptPath = resolve(evidence, `${label}.command.json`);
  const receipt = readJson(receiptPath);
  assert.equal(receipt.exitCode, 0, label);
  assert.equal(receipt.sourceBefore, sourceFingerprint, label);
  assert.equal(receipt.sourceAfter, sourceFingerprint, label);
  assert.equal(digest(readFileSync(resolve(evidence, `${label}.log`))), receipt.logSha256, label);
  const { memorySamples: _samples, sourceBefore: _before, sourceAfter: _after, ...summary } = receipt;
  return { label, ...summary, receiptSha256: digest(readFileSync(receiptPath)) };
});

const binaryPath = "release/aud032-fixed/mnemocode-0.1.0-linux-x64";
const binaryHash = createHash("sha256");
for await (const chunk of createReadStream(resolve(root, binaryPath))) binaryHash.update(chunk);
const artifact = {
  path: binaryPath,
  sha256: binaryHash.digest("hex"),
  bytes: statSync(resolve(root, binaryPath)).size,
  verification: "remediation-linux-verify",
};
assert.equal(artifact.sha256, "9b4fd843fda76768359856c24cb3a8af5aa9712a3744b3b45e67c343c32d52a3");
const current = readJson(resolve(root, "docs/audits", names.json));
const recordedAtUtc = current.remediationContext?.recordedAtUtc ?? new Date().toISOString();
const report = JSON.parse(baseline.json.toString("utf8"));
const records = [
  {
    id: "AUD-032-BLD001",
    status: "fixed",
    evidence: "The independent literal inventory now includes all 28 current Redacted labels; display controls remain. Targeted verification passes; the original full-suite acceptance has not been repeated.",
  },
  {
    id: "AUD-032-BLD002",
    status: "fixed",
    evidence: "The literal success text matches the current CLI; three actual share PNGs and exact member-1/member-3 recovery remain required. Decode and restore additionally require exit 0. Targeted verification passes; the original full-suite acceptance has not been repeated.",
  },
  {
    id: "AUD-032-DOC001",
    status: "verified",
    evidence: "SECURITY.md names crypto.randomFillSync, matching the unchanged production adapter. Independent source review and the fresh executable's actual SSKR self-test pass.",
  },
];
report.remediation = records.map((record) => ({
  ...record,
  fixCommit: null,
  verificationCommit: null,
  evidence: {
    description: record.evidence,
    localOnly: true,
    review: "Local-only: docs/audits/AUD-032-evidence/remediation-review.json",
    commands: labels,
  },
}));
report.remediationContext = {
  recordedAtUtc,
  authorization: "The owner requested fixing all three findings, then a local Linux executable.",
  baselineReportHashes: baselineHashes,
  baselineFieldsRemainHistorical: ["snapshot", "findings", "checks", "testResults", "releaseVerification"],
  sourceFingerprint,
  nonAuditInputCount: source.length,
  changedInputs: review.reviewedInputs.filter((input) =>
    ["CHANGELOG.md", "SECURITY.md", "test/scan-fixes-s006-s061.test.ts", "test/sskr-cli-export.test.ts"].includes(input.path)),
  productCodeChanged: false,
  independentReviewSha256: digest(readFileSync(reviewPath)),
  executions,
  artifact,
  targetedResult: "52 tests passed in 3 files; pnpm check and Linux executable verification exit 0.",
  fullSuiteRepeated: false,
  releaseAcceptance: "INCOMPLETE. BLD001/BLD002 are source-fixed and targeted-verified, not a new mandatory-full-suite or cross-platform acceptance. Original platform/browser/host and no-copy/skip limitations remain. This is not publication approval.",
  coreConformance: "The separately requested whole-repository CORE review is not established by these three bounded corrections.",
  operationsNotPerformed: ["commit", "push", "tag", "release publication", "artifact upload", "CI dispatch"],
};

const notice = "> **Baseline record:** The findings, failures and verdict below describe the original snapshot. See the dated remediation addendum for the authorized corrections; historical evidence is not rewritten.\n\n";
const originalMarkdown = baseline.markdown.toString("utf8");
const firstBreak = originalMarkdown.indexOf("\n\n") + 2;
const markdown = originalMarkdown.slice(0, firstBreak) + notice + originalMarkdown.slice(firstBreak)
  + `\n## Remediation addendum — ${recordedAtUtc.slice(0, 10)} UTC\n\n`
  + `The owner authorized correcting all three findings and building a local Linux executable. No production library, CLI, native/generated engine or dependency code changed. The current ${source.length}-file non-audit fingerprint is \`${sourceFingerprint}\`.\n\n`
  + "| Finding | Current disposition | Verification boundary |\n| --- | --- | --- |\n"
  + records.map((record) => `| ${record.id} | ${record.status} | ${record.evidence} |`).join("\n")
  + "\n\n**Executed after the corrections:** 52 tests passed in three files (exit 0); `pnpm check`, the four-file format check, fresh Linux executable build and empty-folder executable verification all exited 0. The latter runs the full embedded self-test, socket-denial control, encoding, re-encoding, 2-of-3 restoration, embedded-artwork PDF, help and notices. These are not additional disjoint whole-suite totals.\n\n"
  + `**Linux executable:** \`${artifact.path}\`; ${artifact.bytes} bytes; SHA-256 \`${artifact.sha256}\`. The pre-existing root release artifacts were not overwritten.\n\n`
  + "**Independent review:** Local-only: docs/audits/AUD-032-evidence/remediation-review.json. Its exact changed-source and command/log bindings were checked; the reviewer accepted the bounded three-finding corrections, not universal CORE conformance or release publication.\n\n"
  + "**Historical evidence:** The originally accepted pair is retained unchanged locally under accepted-baseline-AUD-032-2026-10-16.md/.json. Original SHA256SUMS and report-validation.json still describe that baseline, not this addendum. A separate remediation validation binds the updated pair.\n\n"
  + "**Still incomplete:** The full mandatory suite has not been repeated after these test/documentation-only changes; BLD001/BLD002 therefore remain fixed with scoped verification, not a new full-suite acceptance. All earlier no-copy, configured-skip, native-platform and external browser/host limits remain. The historical FAIL is not silently changed into a release approval. No commit, push, tag, CI dispatch, upload or publication occurred.\n";

const outputs = {
  markdown: Buffer.from(markdown),
  json: Buffer.from(JSON.stringify(report, null, 2).replaceAll(homedir(), "/home/user") + "\n"),
};
for (const [kind, bytes] of Object.entries(outputs)) {
  const path = resolve(root, "docs/audits", names[kind]);
  const actual = readFileSync(path);
  assert.ok(digest(actual) === baselineHashes[kind] || actual.equals(bytes), `Unexpected concurrent ${kind} edit.`);
  if (checkOnly) assert.ok(actual.equals(bytes), `The recorded ${kind} addendum differs.`);
  else if (!actual.equals(bytes)) writeFileSync(path, bytes);
}
console.log(JSON.stringify({
  sourceFingerprint,
  sourceFiles: source.length,
  independentReviewAccepted: true,
  fullSuiteRepeated: false,
  artifact,
  reportHashes: Object.fromEntries(Object.entries(outputs).map(([kind, bytes]) => [kind, digest(bytes)])),
  checkOnly,
}));
