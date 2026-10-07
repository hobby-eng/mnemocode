import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
let compared = 0;
function compare(path = "") {
  for (const entry of readdirSync(join("docs/audits/AUD-009-evidence/compiled", path), { withFileTypes: true })) {
    const relative = join(path, entry.name);
    if (entry.isDirectory()) compare(relative);
    else {
      assert.equal(hash(join("dist", relative)), hash(join("docs/audits/AUD-009-evidence/compiled", relative)), relative);
      compared += 1;
    }
  }
}
compare();
const integrity = JSON.parse(readFileSync("sskr-wasm/integrity.json", "utf8"));
for (const [path, expected] of Object.entries(integrity)) {
  assert.equal(hash(join("sskr-wasm", path)), expected, path);
}
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const [name, targets] of Object.entries(manifest.exports)) {
  assert.ok(existsSync(targets.import), name + " JavaScript");
  assert.ok(existsSync(targets.types), name + " declarations");
}
console.log(JSON.stringify({ compiledDistFiles: compared, exactMatch: true,
  sskrIntegrityFiles: Object.keys(integrity).length, packageExports: Object.keys(manifest.exports).length,
  executableSha256: hash("release/mnemocode-0.1.0-linux-x64") }, null, 2));
