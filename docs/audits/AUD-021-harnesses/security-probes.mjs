// Bounded synthetic PNGs and published age data. Never enlarge the decompression fixture.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { PNG } from "pngjs";
import { crc32 } from "../../../dist/sskr/checksum.js";
import { decodeQrPngFile } from "../../../dist/cli/qr-input.js";
import { decryptCandidates } from "../../../dist/core/candidate-encryption.js";

const vectors = JSON.parse(await readFile(new URL("../../../vectors/candidates-v1.json", import.meta.url), "utf8"));
const identity = vectors.age.identity;
const changed = identity.slice(0, -1) + (identity.endsWith("Q") ? "A" : "Q");
let error;
try {
  await decryptCandidates(Buffer.from(vectors.age.open[0].file, "hex"), { identity: changed });
} catch (caught) {
  error = caught;
}
assert.ok(error instanceof Error);
assert.ok(error.message.includes(changed));

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, checksum]);
}
function header(width, height, color, interlace = 0) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = color;
  data[12] = interlace;
  return chunk("IHDR", data);
}

const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud021-png-"));
const originalRead = PNG.sync.read;
const originalInflate = zlib.inflateSync;
const dimensions = [];
const inflated = [];
try {
  const duplicate = Buffer.concat([
    signature, header(1, 1, 0), header(4097, 1, 0),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(4098))), chunk("IEND", Buffer.alloc(0)),
  ]);
  const interlaced = Buffer.concat([
    signature, header(1, 1, 6, 1),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(65_536))), chunk("IEND", Buffer.alloc(0)),
  ]);
  await writeFile(join(folder, "duplicate.png"), duplicate);
  await writeFile(join(folder, "interlaced.png"), interlaced);
  PNG.sync.read = (...args) => {
    const decoded = originalRead(...args);
    dimensions.push({ width: decoded.width, height: decoded.height });
    return decoded;
  };
  await assert.rejects(decodeQrPngFile(join(folder, "duplicate.png")), /No readable QR/u);
  assert.deepEqual(dimensions[0], { width: 4097, height: 1 });
  zlib.inflateSync = (...args) => {
    const result = originalInflate(...args);
    inflated.push({ bytes: result.length, maxOutputLength: args[1]?.maxOutputLength ?? null });
    return result;
  };
  await assert.rejects(decodeQrPngFile(join(folder, "interlaced.png")));
  assert.equal(inflated[0].bytes, 65_536);
  assert.equal(inflated[0].maxOutputLength, null);
  console.log(JSON.stringify({
    malformedPublicIdentityInError: true,
    duplicateHeaderDecodedWidth: dimensions[0].width,
    interlacedInflatedBytes: inflated[0].bytes,
    suppliedInflateBound: inflated[0].maxOutputLength,
    largestSyntheticExpansionBytes: 65_536,
    oomOrExternalLeakAttempted: false,
  }));
} finally {
  PNG.sync.read = originalRead;
  zlib.inflateSync = originalInflate;
  await rm(folder, { recursive: true, force: true });
}
