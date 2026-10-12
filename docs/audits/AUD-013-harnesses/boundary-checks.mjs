// Pure geometry and existing artifact pins only: no cards, PDF, raster or build operation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pageDimensions } from "../../../src/export/card-settings.js";
import { materialPageLayout } from "../../../src/export/material-layout.js";

assert.throws(() => pageDimensions("a6", null), /Orientation must/u);
const layout = materialPageLayout("a6", null);
assert.deepEqual([layout.width, layout.height], [148, 105]);
assert.throws(() => materialPageLayout("a6", "sideways"), /Orientation must/u);
assert.deepEqual(materialPageLayout("a6", undefined), layout);

const pins = JSON.parse(readFileSync("sskr-wasm/integrity.json", "utf8"));
for (const [path, digest] of Object.entries(pins)) {
  assert.equal(createHash("sha256").update(readFileSync("sskr-wasm/" + path)).digest("hex"), digest, path);
}
console.log(JSON.stringify({ materialOrientation: { nullAccepted: true, invalidStringRefused: true,
  sharedDimensionsRefusesNull: true }, pinsMatched: Object.keys(pins).length,
  wasmSha256: pins["generated/recovery_sskr_wasm_bg.wasm"],
  limits: "Baseline residual proof. Geometry only; no document or image was generated." }, null, 2));
