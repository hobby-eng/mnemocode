// Public age/BIP39 fixtures and kilobyte-sized synthetic PNGs. No exhaustion workload.
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INVALID_PNG_INPUT, PngAdmission, MAX_PNG_DIMENSION } from "../src/core/png-admission.js";
import { PNG_SIGNATURE, pngChunk, pngHeader, pngImage } from "../src/core/synthetic-png.js";
import {
  decryptCandidates,
  CandidateFileRefusedError,
  createSessionIdentity,
} from "../src/core/candidate-encryption.js";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { exportQrPayload } from "../src/export/qr-image.js";

const captured = vi.hoisted(() => ({
  limits: [] as (number | undefined)[],
  compressed: [] as Uint8Array[],
  inflated: [] as Uint8Array[],
}));
vi.mock("node:zlib", async (original) => {
  const actual = await original<typeof import("node:zlib")>();
  return {
    ...actual,
    inflateSync: (...args: Parameters<typeof actual.inflateSync>) => {
      captured.limits.push(args[1]?.maxOutputLength);
      if (args[0] instanceof Uint8Array) captured.compressed.push(args[0]);
      const bytes = actual.inflateSync(...args);
      captured.inflated.push(bytes);
      return bytes;
    },
  };
});

const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  captured.limits.length = 0;
  captured.compressed.length = 0;
  captured.inflated.length = 0;
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function pathOf(bytes?: Uint8Array): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud021-png-"));
  folders.push(folder);
  const path = join(folder, "public.png");
  if (bytes !== undefined) await writeFile(path, bytes);
  return path;
}

// The images come from the builder of the startup self-test, with real CRCs, so that corrupt
// structure reaches admission.
const WHITE_PIXEL = Buffer.from([0, 255, 255, 255, 255]);
/** The IHDR of WHITE_PIXEL's image: one pixel, RGBA (color type 6) of 8-bit samples. */
const PIXEL_HEADER = pngHeader(1, 1, 8, 6);
function image(ihdr: Uint8Array, filtered = WHITE_PIXEL, extra: Uint8Array[] = []): Buffer {
  return Buffer.from(pngImage(ihdr, ...extra, pngChunk("IDAT", deflateSync(filtered))));
}

describe("AUD-021-SEC001/SEC002: PNG admission precedes pixel allocation", () => {
  it("detects PNG bytes independently of host media labels without copying the signature rule", () => {
    const png = image(PIXEL_HEADER);
    expect(PngAdmission.hasSignature(png)).toBe(true);
    expect(PngAdmission.hasSignature(Uint8Array.from([...PNG_SIGNATURE, 0]))).toBe(true);
    for (let length = 0; length < PNG_SIGNATURE.length; length += 1)
      expect(PngAdmission.hasSignature(png.subarray(0, length))).toBe(false);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(PngAdmission.hasSignature(jpeg)).toBe(false);
    const wrong = Buffer.from(png);
    wrong[0] = 0;
    expect(PngAdmission.hasSignature(wrong)).toBe(false);
  });
  it("refuses a second valid-CRC header before pngjs can replace the admitted dimensions", async () => {
    const decode = vi.spyOn(PNG.sync, "read");
    const path = await pathOf(
      image(pngHeader(1, 1, 8, 0), Buffer.alloc(MAX_PNG_DIMENSION + 2), [
        pngHeader(MAX_PNG_DIMENSION + 1, 1, 8, 0),
      ]),
    );
    await expect(decodeQrPngFile(path)).rejects.toThrow("not a valid PNG");
    expect(decode).not.toHaveBeenCalled();
    expect(captured.limits).toEqual([]);
  });

  it.each([0, 1])("bounds surplus expansion before decoding (interlace %i)", async (interlace) => {
    const decode = vi.spyOn(PNG.sync, "read");
    const path = await pathOf(image(pngHeader(1, 1, 8, 6, interlace), Buffer.alloc(65536)));
    await expect(decodeQrPngFile(path)).rejects.toThrow("not a valid PNG");
    expect(decode).not.toHaveBeenCalled();
    expect(captured.limits).toEqual([WHITE_PIXEL.length]);
    expect(captured.compressed.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it.each([0, 1])(
    "accepts an exact tiny PNG, then wipes temporary inflation (interlace %i)",
    async (interlace) => {
      const decode = vi.spyOn(PNG.sync, "read");
      await expect(
        decodeQrPngFile(await pathOf(image(pngHeader(1, 1, 8, 6, interlace)))),
      ).rejects.toThrow("No readable QR code");
      expect(decode).toHaveBeenCalledOnce();
      expect(captured.limits).toEqual([WHITE_PIXEL.length]);
      expect(captured.inflated).toHaveLength(1);
      for (const bytes of [...captured.compressed, ...captured.inflated])
        expect(bytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("reads an actual exporter QR unchanged after admission", async () => {
    const payload = `MNC1:direct:indexes:${"1 ".repeat(11)}4`;
    const path = await pathOf();
    await exportQrPayload(payload, path);
    expect(await decodeQrPngFile(path)).toBe(payload);
    expect(captured.limits[0]).toBeGreaterThan(WHITE_PIXEL.length);
  });
});

describe("AUD-021-SEC001/SEC002: PNG admission precedes pixel allocation", () => {
  it.each([
    [
      "odd RGBA8",
      9,
      9,
      8,
      6,
      4,
      343,
      [
        [2, 2],
        [1, 2],
        [3, 1],
        [2, 3],
        [5, 2],
        [4, 5],
        [9, 4],
      ],
    ],
    [
      "packed grayscale",
      8,
      8,
      1,
      0,
      1 / 8,
      30,
      [
        [1, 1],
        [1, 1],
        [2, 1],
        [2, 2],
        [4, 2],
        [4, 4],
        [8, 4],
      ],
    ],
    [
      "RGBA16",
      8,
      8,
      16,
      6,
      8,
      527,
      [
        [1, 1],
        [1, 1],
        [2, 1],
        [2, 2],
        [4, 2],
        [4, 4],
        [8, 4],
      ],
    ],
  ] as const)(
    "decodes a valid multi-pass %s PNG with its exact budget",
    async (_, width, height, depth, color, bytesPerPixel, expected, passes) => {
      // Independently enumerated pass dimensions from W3C PNG 8.1, no production layout helper.
      // Filter 0 and maximum samples give an opaque white image in all three layouts.
      const rows = passes.flatMap(([columns, count]) =>
        Array.from({ length: count }, () =>
          Buffer.concat([Buffer.of(0), Buffer.alloc(Math.ceil(columns * bytesPerPixel), 255)]),
        ),
      );
      const filtered = Buffer.concat(rows);
      expect(filtered.length).toBe(expected);
      const bytes = image(pngHeader(width, height, depth, color, 1), filtered);
      const decoded = PNG.sync.read(bytes);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(decoded.data.every((sample) => sample === 255)).toBe(true);
      const decode = vi.spyOn(PNG.sync, "read");
      await expect(decodeQrPngFile(await pathOf(bytes))).rejects.toThrow("No readable QR code");
      expect(decode).toHaveBeenCalledOnce();
      expect(captured.limits).toEqual([expected]);
    },
  );

  it.each([
    [
      pngHeader(MAX_PNG_DIMENSION, MAX_PNG_DIMENSION, 8, 6),
      (4 * MAX_PNG_DIMENSION + 1) * MAX_PNG_DIMENSION,
    ],
    [pngHeader(8, 8, 8, 6, 1), 271],
    [pngHeader(9, 9, 8, 6, 1), 343],
    [pngHeader(8, 8, 16, 6, 1), 527],
    [pngHeader(8, 8, 1, 0, 1), 30],
    [pngHeader(8, 8, 2, 0, 1), 34],
  ] as const)("uses the independently calculated PNG scanline budget %#", (ihdr, length) => {
    // W3C PNG sections 7.2/8.1: complete pixel bytes plus one filter byte per nonempty pass row.
    const admission = PngAdmission.read(image(ihdr));
    expect(admission.filteredBytes).toBe(length);
    expect(() => admission.assertInflatedSize(length)).not.toThrow();
    expect(() => admission.assertInflatedSize(length - 1)).toThrow(INVALID_PNG_INPUT);
    expect(() => admission.assertInflatedSize(length + 1)).toThrow(INVALID_PNG_INPUT);
  });
});

describe("AUD-021-SEC001/SEC002: PNG admission precedes pixel allocation", () => {
  it("refuses dimensions above the supported side limit before inflation", () => {
    expect(() => PngAdmission.read(image(pngHeader(MAX_PNG_DIMENSION + 1, 1, 8, 6)))).toThrow(
      "dimensions exceed",
    );
  });

  it.each([
    image(PIXEL_HEADER).subarray(0, -1),
    // After IEND: a byte, too short for a chunk, and a whole chunk, which only IEND's place refuses.
    Buffer.concat([image(PIXEL_HEADER), Buffer.of(0)]),
    Buffer.concat([image(PIXEL_HEADER), pngChunk("tEXt", [65])]),
    image(PIXEL_HEADER, WHITE_PIXEL, [pngChunk("IHDR", new Uint8Array(12))]),
    image(PIXEL_HEADER, WHITE_PIXEL, [pngChunk("ABCD", [])]),
    image(pngHeader(1, 1, 8, 6, 2)),
    image(pngHeader(1, 1, 3, 6)),
    image(pngHeader(1, 1, 8, 5)),
  ])("refuses a malformed stream without a decoder %#", (bytes) => {
    // The refusal of an invalid PNG, not some other error on the way (AUD-022 observation).
    expect(() => PngAdmission.read(bytes)).toThrow(INVALID_PNG_INPUT);
  });
});

const vectors = JSON.parse(readFileSync("vectors/candidates-v1.json", "utf8")) as {
  age: { identity: string; plaintext: string; open: { name: string; file: string }[] };
};
const KEY_FILE = vectors.age.open.find((item) => !item.name.includes("passphrase"))!;
describe("AUD-021-SEC003: age identity failures disclose no private input", () => {
  it.each([
    `${vectors.age.identity.slice(0, -1)}${vectors.age.identity.endsWith("A") ? "Q" : "A"}`,
    `bad-prefix-${vectors.age.identity}`,
  ])("sanitizes malformed identity diagnostics and causes %#", async (identity) => {
    const error = await decryptCandidates(Buffer.from(KEY_FILE.file, "hex"), { identity }).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(CandidateFileRefusedError);
    expect(error).toMatchObject({
      code: "key",
      message: "This Scanner key is not a valid age identity.",
    });
    expect((error as Error).cause).toBeUndefined();
    const displayed = [String(error), inspect(error), JSON.stringify(error)].join(" ");
    expect(displayed).not.toContain(identity);
    expect(displayed).not.toContain(vectors.age.identity.slice(0, -6));
  });

  it("still opens the published candidate file with its valid identity", async () => {
    const plain = await decryptCandidates(Buffer.from(KEY_FILE.file, "hex"), {
      identity: vectors.age.identity,
    });
    try {
      expect(Buffer.from(plain).toString("hex")).toBe(vectors.age.plaintext);
    } finally {
      plain.fill(0);
    }
  });

  it("retains wrong-key refusal for a valid synthetic identity", async () => {
    const other = await createSessionIdentity();
    await expect(
      decryptCandidates(Buffer.from(KEY_FILE.file, "hex"), { identity: other.identity }),
    ).rejects.toMatchObject({ code: "key" });
  });
});
