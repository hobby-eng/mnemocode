// Actual public text-fitting function; the external font boundary supplies an ASCII-only font.
import assert from "node:assert/strict";
import { fit } from "../../../dist/export/business-render-primitives.js";

const font = {
  getCharacterSet: () => Array.from({ length: 95 }, (_, index) => index + 32),
  widthOfTextAtSize: (text, size) => text.length * size / 2,
};
const privateGlyph = String.fromCodePoint(0x1f512);
let failures = 0;
for (const [name, check] of [
  ["supported text", () => assert.equal(fit(font, "Public fixture", 10, 5, 100, "Name"), 10)],
  ["unsupported character", () => assert.throws(
    () => fit(font, "Synthetic " + privateGlyph, 10, 5, 100, "Name"),
    (error) => {
      assert.equal(error.code, "export.business-render-primitives.contains-character-not-supported-by-card-font");
      assert.ok(error.message.includes("Name"));
      assert.ok(!error.message.includes(privateGlyph), "typed character is absent from the refusal");
      return true;
    },
  )],
]) {
  try {
    check();
    console.log("PASS " + name);
  } catch (error) {
    failures += 1;
    console.log("FAIL " + name + ": " + error.message);
  }
}
console.log(JSON.stringify({ cases: 2, failures }));
if (failures > 0) process.exitCode = 1;
