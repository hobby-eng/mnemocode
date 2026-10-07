import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EncodedBackupCheck, ShareBackupCheck } from "../../../src/core/backup-check.ts";
import { EncodedBackup } from "../../../src/core/encoded-backup.ts";
import { Masking } from "../../../src/core/masking.ts";
import { JointRepair } from "../../../src/sskr/joint-repair.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { configureSharePlatform } from "../../../src/sskr/share-platform.ts";
import { ShareSet } from "../../../src/sskr/share-set.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";
import { writeShare } from "../../../src/sskr/transport.ts";

const phrase = `${"abandon ".repeat(11)}about`;
const vectors = JSON.parse(readFileSync(new URL("../../../vectors/sskr-v1.json", import.meta.url)));
const failures = [];

async function check(name, run) {
  try {
    await run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL: ${name}: ${error.message}`);
  }
}

await check("ShareSet freezes and copies every published nested share field", async () => {
  const original = (await ShareSet.restore(vectors.deterministic[0].shares, nodeSharePlatform))
    .toRepairedSet();
  const mutable = {
    mnemonic: original.mnemonic,
    shares: original.shares.map((share) => ({ ...share, filled: [...share.filled] })),
    unsettled: [{ share: 1, position: 1 }],
    unchecked: [1],
  };
  const owned = ShareSet.of(mutable);
  const saved = owned.shares[0].ur;
  mutable.shares[0].ur = "synthetic replacement";
  mutable.unsettled[0].position = 99;
  mutable.unchecked[0] = 99;
  assert.equal(owned.shares[0].ur, saved);
  assert.equal(owned.unsettled[0].position, 1);
  assert.equal(owned.unchecked[0], 1);
  assert.throws(() => { owned.shares[0].ur = "synthetic replacement"; }, TypeError);
  assert.throws(() => { owned.unsettled[0].position = 99; }, TypeError);
});

await check("JointRepair uses injected services despite another configured platform", async () => {
  const records = vectors.deterministic[0].shares;
  const colors = writeShare(records[1], "colors").split(" ");
  colors[5] = "?";
  let combined = 0;
  const platform = {
    ...nodeSharePlatform,
    combineShares: async (shares) => {
      combined += 1;
      return nodeSharePlatform.combineShares(shares);
    },
  };
  const forbidden = () => { throw new Error("Unexpected configured platform use"); };
  configureSharePlatform({ hmacSha256: forbidden, combineShares: forbidden, createShares: forbidden });
  try {
    const plan = await new JointRepair(platform).plan([records[0], colors.join(" ")]);
    assert.equal(plan.assessment.reason, undefined);
    const restored = await plan.search();
    assert.equal(restored.length, 1);
    assert.ok(combined > 0);
  } finally {
    configureSharePlatform(nodeSharePlatform);
  }
});

await check("EncodedBackupCheck owns its baseline date objects", () => {
  const date = { year: 2026, month: 9, day: 23 };
  const encoded = Masking.of("seedshift").encode(phrase, [date]);
  const verifier = new EncodedBackupCheck({
    mnemonic: phrase,
    format: "indexes",
    mode: "seedshift",
    codes: encoded.shiftedIndexes,
    dates: [date],
  });
  assert.equal(verifier.compareDates([{ ...date }]), undefined);
  date.day = 24;
  assert.equal(verifier.compareDates([{ year: 2026, month: 9, day: 23 }]), undefined);
});

await check("ShareBackupCheck refuses dates that recover a different phrase after caller mutation", async () => {
  const date = { year: 2026, month: 9, day: 23 };
  const masked = Masking.of("seedshift").encode(phrase, [date]).shiftedEnglish.join(" ");
  const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7)).split(masked, 2, 3);
  const verifier = new ShareBackupCheck(
    { mnemonic: phrase, mode: "seedshift", threshold: 2, dates: [date] },
    nodeSharePlatform,
    { decodeEntry: "Decode" },
  );
  const backup = shares.slice(0, 2).join(";");
  assert.equal((await verifier.check({ backup, dates: "23-09-2026" })).verdict, "restores");
  date.day = 24;
  const actual = EncodedBackup.read(masked, "english", "seedshift")
    .decode([{ year: 2026, month: 9, day: 24 }]).recoveredMnemonic;
  assert.notEqual(actual, phrase);
  const verdict = (await verifier.check({ backup, dates: "24-09-2026" })).verdict;
  assert.notEqual(verdict, "restores", "A different restored phrase was accepted as this backup");
});

console.log(`Checks: ${4 - failures.length} passed, ${failures.length} failed.`);
process.exitCode = failures.length === 0 ? 0 : 1;
