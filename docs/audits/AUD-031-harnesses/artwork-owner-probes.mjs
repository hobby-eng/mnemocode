// Actual artwork and Node PNG encoder; only the host encoder boundary is observed or refused.
import assert from "node:assert/strict";
import { BusinessArtwork } from "../../../dist/export/business-artwork.js";
import { nodeRenderPlatform } from "../../../dist/export/platform-node.js";

let failures = 0;
for (const refuses of [false, true]) {
  let pixels;
  const fault = new Error("Synthetic encoder refusal.");
  const artwork = new BusinessArtwork({
    ...nodeRenderPlatform,
    encodePng(image, level) {
      pixels = image.data;
      assert.ok(pixels.some((byte) => byte !== 0), "encoder receives prepared pixels");
      if (refuses) throw fault;
      return nodeRenderPlatform.encodePng(image, level);
    },
  });
  try {
    const pending = artwork.recoloured("it", "8B0C06");
    if (refuses) await assert.rejects(pending, (error) => error === fault);
    else {
      const png = await pending;
      try {
        assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.ok(png.length > 8, "returned PNG remains intact after scratch retirement");
      } finally {
        png.fill(0);
      }
    }
    assert.ok(pixels instanceof Uint8Array);
    assert.ok(pixels.every((byte) => byte === 0), "derived artwork scratch is wiped");
    console.log("PASS " + (refuses ? "encoder refusal" : "healthy encoder"));
  } catch (error) {
    failures += 1;
    console.log("FAIL " + (refuses ? "encoder refusal" : "healthy encoder") + ": " + error.message);
  } finally {
    pixels?.fill(0);
  }
}
console.log(JSON.stringify({ cases: 2, failures }));
if (failures > 0) process.exitCode = 1;
