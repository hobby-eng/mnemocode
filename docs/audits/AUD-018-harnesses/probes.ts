// AUD-018 probes through production entry points, with public data only. Opt in through
// probe.config.ts; a probe that fails shows a finding that is still open, and its control shows
// that the same capture sees a correct path. Not part of the ordinary test collection.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ files: [] as Uint8Array[], pixels: [] as Uint8Array[] }));

// The bytes that the bounded reader hands its caller, which its contract makes the caller's to wipe.
vi.mock("../../../src/cli/bounded-read.js", async (original) => {
  const actual = await original<typeof import("../../../src/cli/bounded-read.js")>();
  return {
    ...actual,
    readFileOrRefuse: (...args: Parameters<typeof actual.readFileOrRefuse>) => {
      const bytes = actual.readFileOrRefuse(...args);
      captured.files.push(bytes);
      return bytes;
    },
  };
});
// The decoded pixels of a QR image: every pixel of the code, so the payload itself.
vi.mock("pngjs", async (original) => {
  const actual = await original<typeof import("pngjs")>();
  const read = (...args: Parameters<typeof actual.PNG.sync.read>) => {
    const image = actual.PNG.sync.read(...args);
    captured.pixels.push(image.data);
    return image;
  };
  const PNG = Object.assign(Object.create(actual.PNG), { sync: { ...actual.PNG.sync, read } });
  return { ...actual, PNG, default: { ...actual, PNG } };
});

import { decodeQrPngFile } from "../../../src/cli/qr-input.js";
import { readBoundedTextFile } from "../../../src/cli/input.js";
import { exportQrPayload } from "../../../src/export/qr-image.js";

/** A public record: the all-zero-entropy phrase "abandon … about" as word numbers. */
const PUBLIC_RECORD = `MNC1:direct:indexes:${"1 ".repeat(11)}4`;
const folders: string[] = [];
const wiped = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);

afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const path = await mkdtemp(join(process.cwd(), "..", "tmp", "mnemocode", "aud018-probe-"));
  folders.push(path);
  return path;
}

describe("AUD-018-SEC001: a QR image read as secret input is wiped like a text file", () => {
  it("wipes the file bytes and the decoded pixels after reading the record", async () => {
    const path = join(await folder(), "record-qr.png");
    await exportQrPayload(PUBLIC_RECORD, path);
    captured.files.length = 0;
    captured.pixels.length = 0;
    expect(await decodeQrPngFile(path)).toBe(PUBLIC_RECORD);
    expect(captured.files).toHaveLength(1);
    expect(captured.pixels).toHaveLength(1);
    expect({ fileWiped: wiped(captured.files[0]!), pixelsWiped: wiped(captured.pixels[0]!) }).toEqual(
      { fileWiped: true, pixelsWiped: true },
    );
  });

  it("control: the text reader wipes the bytes it read", async () => {
    const path = join(await folder(), "record.txt");
    await writeFile(path, `${PUBLIC_RECORD}\n`);
    captured.files.length = 0;
    expect(readBoundedTextFile(path)).toBe(`${PUBLIC_RECORD}\n`);
    expect(captured.files).toHaveLength(1);
    expect(wiped(captured.files[0]!)).toBe(true);
  });
});
