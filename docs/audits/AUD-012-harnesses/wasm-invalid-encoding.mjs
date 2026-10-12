// One synthetic/public deterministic create call, never a WASM rebuild or a vector replay.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as engine from "../../../sskr-wasm/generated/recovery_sskr_wasm.js";
import { urToTransport } from "../../../src/sskr/transport.ts";

const pins = JSON.parse(readFileSync("sskr-wasm/integrity.json", "utf8"));
for (const [path, digest] of Object.entries(pins))
  assert.equal(
    createHash("sha256")
      .update(readFileSync("sskr-wasm/" + path))
      .digest("hex"),
    digest,
    path,
  );
const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
const wasm = engine.initSync({
  module: readFileSync("sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"),
});
let error;
try {
  engine.create_sskr_shares_formatted(
    Uint8Array.from(Buffer.from(vector.entropy, "hex")),
    1,
    new Uint8Array([2, 3]),
    Uint8Array.from(Buffer.from(vector.testOnlySeed, "hex")),
    2,
  );
} catch (failure) {
  error = String(failure);
}
assert.match(error, /Unsupported SSKR share encoding/u);
const memory = Buffer.from(wasm.memory.buffer);
const retained = vector.shares.map((share, index) => {
  const transport = urToTransport(share);
  assert.equal(transport[0], 0x55); // Public 16-byte secret plus five metadata bytes, short CBOR head.
  const payload = Buffer.from(transport.subarray(1, -4));
  let count = 0;
  for (let at = memory.indexOf(payload); at >= 0; at = memory.indexOf(payload, at + 1)) count += 1;
  return { shareIndex: index, exactPayloadOccurrences: count };
});
console.log(
  JSON.stringify(
    {
      error,
      wasmSha256: pins["generated/recovery_sskr_wasm_bg.wasm"],
      memoryBytes: memory.length,
      retained,
      limits:
        "Public fixture only; remaining payload bytes are observable, not evidence of an external attacker or reliable OS erasure.",
    },
    null,
    2,
  ),
);
assert.ok(
  retained.slice(1).some((item) => item.exactPayloadOccurrences > 0),
  "Baseline expected at least one unvisited generated-share payload to remain in WASM memory.",
);
