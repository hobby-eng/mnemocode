// Validate historical record structure without re-executing or rewriting historical evidence.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const snapshot = JSON.parse(readFileSync(resolve(evidence, "snapshot.json"), "utf8"));
const schema = resolve(root, "../multi-chain-wallet-tools/docs/audit-report.schema.json");
const files = snapshot.files.filter((file) =>
  /^docs\/audits\/AUD-\d{3,}-\d{4}-\d{2}-\d{2}\.json$/u.test(file.path));
const script = `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result
def load(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=unique)
validator = Draft202012Validator(load(sys.argv[1]))
rows = []
for path in sys.argv[2:]:
    record = load(path)
    problems = [error.message for error in validator.iter_errors(record)]
    ids = [item["id"] for item in record["findings"]]
    if len(ids) != len(set(ids)):
        problems.append("Duplicate finding IDs within record")
    markdown = Path(path).with_suffix(".md").read_text()
    for finding in record["findings"]:
        if finding["id"] not in markdown:
            problems.append("Finding absent from Markdown: " + finding["id"])
    rows.append({"path": path, "auditId": record["auditId"],
                 "findingCount": len(ids), "problems": problems})
print(json.dumps(rows))
sys.exit(1 if any(row["problems"] for row in rows) else 0)
`;
const output = execFileSync("python3", ["-B", "-c", script, schema, ...files.map((file) => file.path)], {
  cwd: root, encoding: "utf8",
});
const rows = JSON.parse(output);
const history = snapshot.files.filter((file) => file.path.startsWith("docs/audits/"));
const result = {
  auditId: "AUD-032", checkedAtUtc: new Date().toISOString(),
  schemaSha256: createHash("sha256").update(readFileSync(schema)).digest("hex"),
  pairs: rows.length, historicalPaths: history.length, rows,
  files: history.map((file) => ({
    ...file, method: "Frozen identity plus retained historical assessment and current pair/schema/index structure",
    depth: "Historical evidence/structure; no new semantic review of every harness body or original command replay",
  })),
  missingNumber: { auditId: "AUD-023",
    reason: "Explicitly abandoned baseline; published harnesses retained, no report claimed." },
  currentDispositionAdmission: {
    source: "AUD-029, AUD-030 and AUD-031 final dated producer follow-ups, not their initial open-status tables.",
    producerCodeCommit: "d4776f76ed5030c295604192608e8b250067975f",
    producerSourceFingerprint: snapshot.sourceFingerprint,
    currentProducerFindings: "Prior producer dispositions are verified within their stated scopes.",
    externalHost: "Cached-plan/borrower adaptation and browser acceptance remain separate and unexecuted here.",
  },
  limitations: [
    "Schema and ID agreement do not establish that every historical execution or conclusion was correct.",
    "Old commands retain their original source/artifact snapshots and failures; no new execution credit.",
    "This audit does not rewrite historical reports, claim complete transitive review or fetch every external link.",
  ],
};
writeFileSync(resolve(evidence, "history-review.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ pairs: rows.length, historicalPaths: history.length,
  problems: rows.flatMap((row) => row.problems) }));
