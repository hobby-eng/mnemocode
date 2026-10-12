// Bounded baseline probes for two differences found while auditing repeated rules.
// Public synthetic inputs only; no files, wallet derivation or candidate enumeration.
import assert from "node:assert/strict";
import { parseInput } from "../../../src/core/representations.js";
import { MissingCodes } from "../../../src/core/missing-codes.js";
import { cloudServiceOf } from "../../../src/cli/cloud-folders.js";

const complete = ["0001", ...Array<string>(11).fill("1")].join(" ");
assert.deepEqual(parseInput(complete, "indexes"), Array<number>(12).fill(0));
const marked = ["0001", ...Array<string>(10).fill("1"), "?"].join(" ");
assert.throws(() => MissingCodes.read(marked, "indexes", "direct"), /Word number 1/);
// A canonical spelling still accepts the same missing last element.
assert.equal(MissingCodes.read(marked.replace("0001", "1"), "indexes", "direct").wordCount, 12);
console.log("Padded known number: complete reader accepts; marked reader refuses.");

const environment = { OneDrive: "/tmp/aud-011-synthetic-sync-root" };
const syntheticHome = "/tmp/aud-011-synthetic-home";
assert.equal(cloudServiceOf(environment.OneDrive + "/notes/export.txt", environment, syntheticHome), "OneDrive");
assert.equal(cloudServiceOf(environment.OneDrive + "/..notes/export.txt", environment, syntheticHome), undefined);
console.log("Cloud containment: ordinary descendant detected; ..notes descendant missed.");
