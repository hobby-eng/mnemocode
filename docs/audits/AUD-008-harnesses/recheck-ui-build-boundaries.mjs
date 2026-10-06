// AUD-008-BLD001 follow-up: extend the existing in-memory builder probe to publication and
// staging-allocation failures and the macOS signing branch. No build or filesystem mock writes
// reach the checkout. The production script is evaluated byte for byte by the original probe.
// Run from the repository root:
// node --experimental-vm-modules docs/audits/AUD-008-harnesses/recheck-ui-build-boundaries.mjs
// A failed preservation/cleanup assertion prints its complete result and exits nonzero.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const harnessPath = resolve("docs/audits/AUD-008-harnesses/remediation-build-failure.mjs");
let source = readFileSync(harnessPath, "utf8");
const harnessSha256 = createHash("sha256").update(source).digest("hex");

// Refuse to run if the reviewed helper changes; never silently apply a different injection.
function replaceOnce(before, after) {
  assert.equal(source.split(before).length, 2, `Expected one helper match: ${before}`);
  source = source.replace(before, after);
}

replaceOnce(
  '["bundle", "sea", "notices", "checksums", "none"]',
  '["staging-create", "publish-notices", "publish-checksums", "signing", "none"]',
);
replaceOnce(
  "if (prefix.startsWith(output)) {",
  "if (prefix.startsWith(output)) {\n" +
    '        if (failureAt === "staging-create")\n' +
    '          throw new Error("AUD-008 injected staging allocation failure");',
);
replaceOnce(
  "renameSync: (from, to) => {",
  "renameSync: (from, to) => {\n" +
    '      if ((failureAt === "publish-notices" && to.endsWith("-licenses.txt")) ||\n' +
    '          (failureAt === "publish-checksums" && to.endsWith(".sha256")))\n' +
    '        throw new Error("AUD-008 injected publication rename failure");',
);
replaceOnce('platform: "linux",', 'platform: failureAt === "signing" ? "darwin" : "linux",');
replaceOnce(
  "events.push(`execute:${args[0]}`);",
  "events.push(`execute:${args[0]}`);\n" +
    '        if (failureAt === "signing" && args[0] === "--sign")\n' +
    '          throw new Error("AUD-008 injected signing failure");',
);
replaceOnce(
  "assert.ok(result.oldExecutablePreserved && result.previousNoticesPreserved && " +
    "result.previousChecksumsPreserved, failureAt);",
  "// Print failed preservation cases before setting the final exit code below.",
);
replaceOnce(
  "assert.ok(result.workDirectoryRemoved && result.stagingRemoved, failureAt);",
  "// Print failed cleanup cases before setting the final exit code below.",
);
replaceOnce(
  "(!result.oldExecutablePreserved || !result.workDirectoryRemoved || !result.stagingRemoved)",
  "(!result.oldExecutablePreserved || !result.previousNoticesPreserved || " +
    "!result.previousChecksumsPreserved || !result.workDirectoryRemoved || !result.stagingRemoved)",
);

console.log(JSON.stringify({ harnessPath, harnessSha256, helperInjectionsOnly: true }));
await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
