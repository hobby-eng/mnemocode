// Supply the retained independent Python oracle's public word-list input and compare real APIs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { EncodedBackup } from "../../../dist/core/encoded-backup.js";
import { parseDate } from "../../../dist/core/dates.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const path = resolve(root, "docs/audits/AUD-032-evidence/public-english-words.json");
const wordlistHash = createHash("sha256").update(wordlist.join("\n") + "\n").digest("hex");
assert.equal(wordlistHash, "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
writeFileSync(path, JSON.stringify(wordlist) + "\n", { flag: "wx" });
const text = execFileSync("python3", ["-B", "docs/audits/AUD-026-harnesses/legacy-valid-oracles.py", path], {
  cwd: root, encoding: "utf8",
});
const [control, ...rows] = text.trim().split("\n").map((line) => JSON.parse(line));
assert.equal(control.publishedControls, 1);
assert.equal(rows.length, 5);
const dates = [parseDate("23-09-2026")];
for (const row of rows) {
  const encoding = EncodedBackup.encode(row.source, dates, "english", "seedshift-legacy", {
    validLastWord: true,
  });
  using backup = encoding.backup;
  assert.equal(backup.text(), row.stored);
  const candidates = backup.candidates(dates);
  assert.equal(candidates.length, row.candidates);
  assert.ok(candidates.some((candidate) => candidate.recoveredMnemonic === row.source));
}
console.log(JSON.stringify({ publicWordlistSha256: wordlistHash,
  publishedLegacyControls: control.publishedControls,
  independentLegacyValidLengths: rows.map((row) => row.words),
  exactOutputsAndCandidateCounts: "passed" }));
