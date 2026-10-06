// AUD-008: bounded text/PNG rejection and actual exclusive/private export publication.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedFile } from "../../../dist/cli/bounded-read.js";
import { decodeQrPngFile } from "../../../dist/cli/qr-input.js";
import { readBoundedTextFile } from "../../../dist/cli/input.js";
import { publishNewPrivateFile, replacePrivateFile } from "../../../dist/export/private-file.js";

const folder = await mkdtemp("docs/audits/AUD-008-evidence/security-files-");
const sentinel = new TextEncoder().encode("public synthetic export\n");
try {
  const destination = join(folder, "new.bin");
  await publishNewPrivateFile(destination, sentinel);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  await assert.rejects(publishNewPrivateFile(destination, new Uint8Array([7])), { code: "EEXIST" });
  assert.deepEqual(new Uint8Array(await readFile(destination)), sentinel);
  const link = join(folder, "link.bin");
  await symlink("new.bin", link);
  await assert.rejects(publishNewPrivateFile(link, new Uint8Array([7])), { code: "EEXIST" });
  await replacePrivateFile(link, new Uint8Array([7]));
  assert.deepEqual(new Uint8Array(await readFile(destination)), sentinel);
  assert.deepEqual(new Uint8Array(await readFile(link)), new Uint8Array([7]));
  assert.equal((await stat(link)).mode & 0o777, 0o600);
  assert(!(await readdir(folder)).some((name) => name.startsWith(".mnemocode-export-")));

  assert.throws(
    () => readBoundedFile("/dev/zero", 1024 * 1024, "bounded refusal"),
    /bounded refusal/,
  );
  assert.throws(
    () => readBoundedTextFile(join(folder, "synthetic-private-token")),
    /The text input could not be read. Check that the file exists and is readable./,
  );
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(8, 13);
  png.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(png.buffer).setUint32(16, 4097);
  new DataView(png.buffer).setUint32(20, 1);
  await writeFile(join(folder, "oversized.png"), png);
  await assert.rejects(decodeQrPngFile(join(folder, "oversized.png")), /safety limit/);
  console.log(
    JSON.stringify({
      privateFileModes: 2,
      overwriteAndSymlinkChecks: 4,
      stagingCleanup: true,
      boundedInputRefusals: 2,
      redactedReadError: true,
    }),
  );
} finally {
  sentinel.fill(0);
  await rm(folder, { recursive: true, force: true });
}
