// Observe actual production allocations, without substituting the color rule.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
const { rgbBytes, rgbChannels } = await import("../../../src/export/color-math.ts");
const original = Uint8Array.from;
const allocations = [];
Uint8Array.from = function (...args) {
  const bytes = Reflect.apply(original, this, args);
  allocations.push(bytes);
  return bytes;
};
let result;
try {
  const rgb = rgbBytes("#123456");
  const channels = rgbChannels("#ABCDEF");
  assert.deepEqual(rgb, [0x12,0x34,0x56]);
  assert.deepEqual(channels, [0xAB/255,0xCD/255,0xEF/255]);
  assert.equal(allocations.length,2);
  result = { input: "Public synthetic colors", resultUnchanged:true, allocations:allocations.map(bytes=>({bytes:Array.from(bytes),allZero:bytes.every(value=>value===0)})), qualification:"Observer retains real first-party scratch allocations. This proves missing explicit cleanup, not exploitation or physical memory erasure." };
} finally {
  Uint8Array.from = original;
  for(const bytes of allocations) bytes.fill(0);
}
writeFileSync(process.argv[2] ?? "docs/audits/AUD-035-evidence/color-scratch.json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(result));
