// Planning only, with the real renderer/platform and public fixtures; no PDF or image export.
import assert from "node:assert/strict";
import { ShareCardSet } from "../../../dist/export/sskr-render.js";
import { nodeCardRenderer } from "../../../dist/export/platform-node.js";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";
import { EncodedBackup } from "../../../dist/core/encoded-backup.js";
import { EncodeCardExport } from "../../../dist/cli/encode-export.js";

const CODE = "core.secret-value.wiped";
const phrase = "abandon ".repeat(11) + "about";
const checks = [];
async function check(name, run) {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, reason: error.message });
  }
}

await check("share QR plan has an ending secret lifetime", async () => {
  const set = await ShareCardSet.create(nodeCardRenderer, [sskrSetVector.shares[0]], {
    style: "it", layout: "qr",
  });
  try {
    const before = set.qrCodes;
    assert.equal(before.length, 1);
    assert.ok(before[0].payload.includes("#8B0C06"));
    assert.equal(typeof set.wipe, "function", "ShareCardSet has no ending-lifetime API");
    set.wipe();
    assert.throws(() => set.qrCodes, { code: CODE });
    assert.throws(() => set.printedCodes(0), { code: CODE });
    assert.ok(before[0].payload.includes("#8B0C06"), "earlier caller views stay independent");
  } finally { set.wipe?.(); }
});

await check("converted card plans have independent lifetimes", async () => {
  const set = await ShareCardSet.create(nodeCardRenderer, [sskrSetVector.shares[0]], {
    style: "it", layout: "collection", cardQr: true,
  });
  let cards;
  try {
    cards = set.forIndividualCards();
    const before = cards.printedCodes(0);
    assert.equal(before[0], "8B0C06");
    assert.equal(typeof set.wipe, "function", "ShareCardSet has no ending-lifetime API");
    set.wipe();
    assert.deepEqual(cards.printedCodes(0), before);
    cards.wipe();
    assert.throws(() => cards.printedCodes(0), { code: CODE });
  } finally { cards?.wipe?.(); set.wipe?.(); }
});

await check("Encode card cache ends without wiping the borrowed backup", async () => {
  const encoding = EncodedBackup.encode(phrase, [], "colors", "direct");
  const outcome = { encoding, mode: "direct", enteredDates: [] };
  const cards = new EncodeCardExport({ template: "business-it", "page-size": "business" }, outcome);
  try {
    const before = await cards.job();
    assert.equal(before.content.payload, encoding.backup.text());
    assert.equal(typeof cards.wipe, "function", "EncodeCardExport has no ending-lifetime API");
    cards.wipe();
    assert.equal(encoding.backup.text(), before.content.payload);
    await assert.rejects(cards.job(), { code: CODE });
  } finally { cards.wipe?.(); encoding.backup.wipe(); }
});

console.log(JSON.stringify({ checks, failed: checks.filter((row) => !row.passed).length }, null, 2));
if (checks.some((row) => !row.passed)) process.exitCode = 1;
