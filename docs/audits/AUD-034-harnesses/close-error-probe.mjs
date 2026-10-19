// Observe a real file read; only the OS close result is faulted, with public data only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedFile } from "../../../dist/cli/bounded-read.js";

const fixture = Buffer.from("PUBLIC-AUD034-CLOSE-FAILURE");
const resultPath = process.argv[2] ?? "docs/audits/AUD-034-evidence/close-error-probe.json";
const directory = fs.mkdtempSync(join(tmpdir(), "mnemocode-public-close-check-"));
const path = join(directory, "public.txt");
fs.writeFileSync(path, fixture, { mode: 0o600 });
const originalConcat = Buffer.concat;
const originalClose = fs.closeSync;
const allocated = [];
const failure = Object.assign(new Error("Synthetic OS close failure."), { code: "EIO" });
let closeCalls = 0;
try {
  const healthy = readBoundedFile(path, 1024, "Public fixture");
  assert.deepEqual(healthy, fixture);
  healthy.fill(0);
  Buffer.concat = function (parts, length) {
    const result = Reflect.apply(originalConcat, this, [parts, length]);
    allocated.push(result);
    return result;
  };
  fs.closeSync = function (descriptor) {
    originalClose(descriptor);
    closeCalls += 1;
    throw failure;
  };
  syncBuiltinESMExports();
  assert.throws(() => readBoundedFile(path, 1024, "Public fixture"), (error) => error === failure);
  assert.equal(closeCalls, 1);
  assert.equal(allocated.length, 1);
  Buffer.concat = originalConcat;
  fs.closeSync = originalClose;
  syncBuiltinESMExports();
  const liveBytes = allocated[0].filter((byte) => byte !== 0).length;
  const result = {
    healthyControl: "passed; exact public bytes returned and caller-wiped",
    faultBoundary: "Actual descriptor is closed, then the OS close adapter throws EIO.",
    exceptionPropagated: true,
    unreturnedOwnedBufferBytes: allocated[0].length,
    nonzeroBytesAfterRefusal: liveBytes,
    expectedNonzeroBytes: 0,
    source: "src/cli/bounded-read.ts:46-65",
    limitation: "Synthetic OS-error injection, not a claim that this filesystem emitted EIO naturally.",
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log("CLOSE_ERROR_CLEANUP_ASSERTION_REACHED");
  console.log(JSON.stringify(result));
  assert.equal(liveBytes, 0, "A close failure must retire the owned result that cannot reach its caller.");
} finally {
  Buffer.concat = originalConcat;
  fs.closeSync = originalClose;
  syncBuiltinESMExports();
  for (const bytes of allocated) bytes.fill(0);
  fixture.fill(0);
  fs.rmSync(directory, { recursive: true });
}
