// Actual public loader with a synthetic bundled-file reader; no source or artifact mutations.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SskrRuntime } from "../../../dist/sskr/runtime.js";
import { readBundledFile } from "../../../dist/bundled-files.js";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";

const MANIFEST = "sskr-wasm/integrity.json";
const CODE = "sskr.runtime.sskr-dependency-integrity-check-failed-no-secret-was";
const MESSAGE = "SSKR dependency integrity check failed. No secret was processed.";
const pins = JSON.parse(await readFile(MANIFEST, "utf8"));
const badPin = { ...pins, "generated/recovery_sskr_wasm.js": "0".repeat(64) };
const cases = [
  ["null manifest", "null"],
  ["malformed JSON", "{\"private-fixture-token"],
  ["array manifest", "[]"],
  ["string manifest", '"private-fixture-token"'],
  ["missing pins", "{}"],
  ["incorrect digest", JSON.stringify(badPin)],
];
let failures = 0;
for (const [name, text] of cases) {
  let damaged = true;
  const runtime = new SskrRuntime((path) =>
    damaged && path === MANIFEST
      ? Promise.resolve(new TextEncoder().encode(text))
      : readBundledFile(path),
  );
  try {
    const pending = runtime.load();
    assert.equal(runtime.load(), pending, "concurrent calls share the in-flight load");
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, CODE);
      assert.equal(error.message, MESSAGE);
      assert.equal(error.cause, undefined, "untrusted syntax is not retained as a cause");
      return true;
    });
    damaged = false;
    const pendingRetry = runtime.load();
    assert.equal(runtime.load(), pendingRetry);
    const engine = await pendingRetry;
    const secret = engine.recover_sskr_shares(sskrSetVector.shares.slice(0, 2).join("\n"));
    try {
      assert.equal(Buffer.from(secret).toString("hex"), sskrSetVector.entropy);
    } finally {
      secret.fill(0);
    }
    console.log("PASS " + name + ": safe coded refusal, then healthy public-vector retry");
  } catch (error) {
    failures += 1;
    console.log("FAIL " + name + ": " + error.message);
  }
}
console.log(JSON.stringify({ cases: cases.length, failures }));
if (failures > 0) process.exitCode = 1;
