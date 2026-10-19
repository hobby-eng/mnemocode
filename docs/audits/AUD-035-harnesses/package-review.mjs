// Read the complete final package dry-run; generated exports/private evidence never ship.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
const E = "docs/audits/AUD-035-evidence";
const label = process.argv[2] ?? "package-final";
const path = `${E}/${label}.log`, text = readFileSync(path, "utf8");
const pack = JSON.parse(text)[0], names = pack.files.map(row => row.path);
const baseline = JSON.parse(readFileSync(`${E}/snapshot.json`, "utf8"));
const nativeSources = new Set(baseline.source.map(row => row.path).filter(path => path.startsWith("sskr-wasm/rust/")));
const permitted = path => /^(?:README\.md|CHANGELOG\.md|LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md|SECURITY\.md|package\.json)$/u.test(path)
  || /^(?:dist|assets|docs|vectors)\//u.test(path)
  || /^sskr-wasm\/(?:generated\/|integrity\.json$|LICENSE$|NOTICE\.md$|UPSTREAM_NOTICES\.md$)/u.test(path)
  || nativeSources.has(path);
const unexpected = names.filter(path => !permitted(path));
const privatePath = path => /(?:^|\/)(?:node_modules|\.git|\.env|output|release)(?:\/|$)|(?:^|\/)export-[^/]+\/|AUD-\d+-evidence/u.test(path);
assert.ok(privatePath("export-test/card.pdf") && privatePath("output/test.png") && privatePath("docs/audits/AUD-035-evidence/private.json"));
assert.ok(!privatePath("dist/export/export-details.js") && !privatePath("docs/audits/AUD-012-harnesses/export-probe.ts"));
const forbidden = names.filter(privatePath);
assert.deepEqual(unexpected, [], "Unexpected package path; inspect before altering the allowlist");
assert.deepEqual(forbidden, [], "Private/generated output escaped package boundary");
const reports = JSON.parse(readFileSync(`${E}/report-paths.json`, "utf8"));
for (const name of [reports.markdown, reports.json]) assert.ok(names.includes(name));
const result = { files: names.length, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, unexpected, forbidden, packageLogSha256: createHash("sha256").update(text).digest("hex"), names, qualification: "Every listed path was evaluated against the documented package boundary; successful allowlist/schema checks do not mean every historical harness is semantically replayed." };
const resultName = process.argv[3] ?? "package-review.json";
assert.ok(/^[a-z0-9-]+\.json$/u.test(resultName));
writeFileSync(`${E}/${resultName}`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ files: names.length, unexpected, forbidden }));
