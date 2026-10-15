// Public-fixture acceptance probes. Exit 1 records a reproduced contract defect, not remediation.
import { MissingCodes } from "../../../dist/core/missing-codes.js";
import { WordTable } from "../../../dist/core/word-table.js";
import { displayWidth } from "../../../dist/cli/terminal-geometry.js";
import { shareKeepingNote } from "../../../dist/export/sskr-keeping-text.js";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";
import { sskrEngine } from "../../../dist/sskr/runtime.js";
import { planJointRepair } from "../../../dist/sskr/joint-repair.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { validateShareSet } from "../../../dist/sskr/transport.js";

const rows = [];
function check(name, actual, expected) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  rows.push({ name, actual, expected, passed });
  if (!passed) process.exitCode = 1;
}

const missing = MissingCodes.read("abandon ".repeat(11) + "?", "english", "direct");
const total = [...missing.candidates()].length;
for (const cancel of [false, true]) {
  const controller = new AbortController();
  let ticks = 0;
  const result = await missing.run({
    check: () => false,
    signal: controller.signal,
    now: () => (ticks += 100),
    turn: async () => {},
    onProgress: ({ checked }) => {
      if (cancel && checked === total) controller.abort();
    },
  });
  try {
    check("MissingCodes final progress, cancel=" + cancel, result.stopped, cancel);
    check("MissingCodes candidate-count control", result.count, 128);
  } finally {
    for (const backup of result.found) backup.wipe();
  }
}

for (const [symbol, expected] of [["\uD800", "refused"], ["\uDC00", "refused"], ["的", "7684"], ["\u{1F600}", "1F600"]]) {
  let actual;
  try { actual = WordTable.unicodeHex(symbol); }
  catch { actual = "refused"; }
  check("Unicode scalar " + symbol.codePointAt(0), actual, expected);
}
// U+0301 has zero terminal cell width; the separate libc wcwidth probe is the local oracle.
check("Combining-mark terminal width", displayWidth("e\u0301"), 1);
check("ASCII terminal-width control", displayWidth("e"), 1);

const duplicated = [sskrSetVector.shares[0], sskrSetVector.shares[0]];
let refused = false;
try { validateShareSet(duplicated); } catch { refused = true; }
check("Duplicate-member validation control", refused, true);
check("Duplicate records are not described as a sufficient quorum",
  shareKeepingNote(duplicated, "files", false).startsWith("All 2 shares are needed"), false);
check("Distinct two-member quorum control",
  shareKeepingNote(sskrSetVector.shares.slice(0, 2), "files", false).startsWith("All 2 shares are needed"), true);

const token = "private-user-token";
const engine = await sskrEngine();
let diagnostic = "";
try {
  const bytes = engine.recover_sskr_shares(sskrSetVector.shares[0].replace("ur:sskr/", "ur:" + token + "/"));
  bytes.fill(0);
} catch (error) { diagnostic = error instanceof Error ? error.message : String(error); }
check("Raw checked bridge refuses wrong type", diagnostic.length > 0, true);
check("Wrong UR type is absent from diagnostic", diagnostic.includes(token), false);

for (const cancel of [false, true]) {
  const controller = new AbortController();
  let armed = false;
  const platform = { ...nodeSharePlatform, combineShares: async (records) => {
    const bytes = await nodeSharePlatform.combineShares(records);
    if (armed && cancel) controller.abort();
    return bytes;
  } };
  const plan = await planJointRepair(sskrSetVector.shares.slice(0, 2), { platform });
  try {
    armed = true;
    const result = await plan.search({ signal: controller.signal });
    check("Joint search cancellation flag, cancel=" + cancel, result.stopped, cancel);
    check("Joint search excludes post-stop confirmation, cancel=" + cancel, result.sets.length, cancel ? 0 : 1);
  } finally { plan.wipe(); }
}
console.log(JSON.stringify({ rows, failed: rows.filter((row) => !row.passed).length }, null, 2));
