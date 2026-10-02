// AUD-007: read-only checks on the relocated bridge and the installed public API.
// Public zero/counting entropy only. Run after pnpm build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { splitSskrMnemonic, combineSskrShares } from "../../../dist/sskr/index.js";
import { chooseMaterialSamples } from "../../../dist/export/material-artwork.js";
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const bridge = join(root, "sskr-wasm");
const manifest = JSON.parse(readFileSync(join(bridge, "integrity.json"), "utf8"));
for (const [file, hash] of Object.entries(manifest)) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(bridge, file)))
      .digest("hex"),
    hash,
    file,
  );
}
const walk = (dir, prefix = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = prefix + entry.name;
    return entry.isDirectory() ? walk(join(dir, entry.name), p + "/") : [p];
  });
assert.deepEqual(
  Object.keys(manifest).sort(),
  [
    ...walk(join(bridge, "rust"), "rust/").filter((s) => !s.startsWith("rust/target/")),
    ...walk(join(bridge, "generated"), "generated/"),
  ].sort(),
);
const glue = readFileSync(join(bridge, "generated/recovery_sskr_wasm.js"), "utf8");
assert(!/\bfetch\s*\(|import\.meta|__wbg_load|\b__wbg_init\b/u.test(glue));
let recovered = 0;
for (const bytes of [16, 20, 24, 28, 32]) {
  const phrase = entropyToMnemonic(
    Uint8Array.from({ length: bytes }, (_, i) => i),
    wordlist,
  );
  // Concurrency exercises lazy initialization through real public entry points.
  const [first, second] = await Promise.all([
    splitSskrMnemonic(phrase, 2, 3),
    splitSskrMnemonic(phrase, 2, 3),
  ]);
  assert.notDeepEqual(first, second);
  for (const set of [first, second]) {
    for (const pair of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      assert.equal(await combineSskrShares(pair.map((i) => set[i])), phrase);
      recovered++;
    }
    await assert.rejects(combineSskrShares([set[0]]));
    await assert.rejects(combineSskrShares([set[0], set[0]]));
  }
}
console.log(
  JSON.stringify({
    pinnedFiles: Object.keys(manifest).length,
    networkLoaderAbsent: true,
    recoveredQuorums: recovered,
    belowThresholdAndDuplicateChecks: 20,
  }),
);
// An observation only: sheet-wide assignment need not be stable across different sets.
const codes = ["#000000", "#000001", "#000002", "#FFFFFF", "#FFFFFE"];
for (const code of codes) {
  const alone = chooseMaterialSamples("vehicle", [code])[0].label;
  const together = chooseMaterialSamples("vehicle", codes)[codes.indexOf(code)].label;
  if (alone !== together) {
    console.log(
      JSON.stringify({ observation: "sample depends on other references", code, alone, together }),
    );
    break;
  }
}
