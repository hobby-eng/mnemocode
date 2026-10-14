// AUD-018-SEC001: a QR image read as secret input is wiped like a text input. The bytes that the
// bounded reader hands over and the pixels that pngjs decodes are captured through the real
// modules; the image itself is written by the real QR exporter. Public test data only.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ files: [] as Uint8Array[], pixels: [] as Uint8Array[] }));

vi.mock("../src/cli/bounded-read.js", async (original) => {
  const actual = await original<typeof import("../src/cli/bounded-read.js")>();
  return {
    ...actual,
    readFileOrRefuse: (...args: Parameters<typeof actual.readFileOrRefuse>) => {
      const bytes = actual.readFileOrRefuse(...args);
      captured.files.push(bytes);
      return bytes;
    },
  };
});
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

import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { readBoundedTextFile } from "../src/cli/text-file.js";
import { exportQrPayload } from "../src/export/qr-image.js";

/** The all-zero-entropy phrase "abandon … about" as a record of word numbers. */
const PUBLIC_RECORD = `MNC1:direct:indexes:${"1 ".repeat(11)}4`;
const folders: string[] = [];
const wiped = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);

afterEach(async () => {
  captured.files.length = 0;
  captured.pixels.length = 0;
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function newPath(name: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud018-"));
  folders.push(folder);
  return join(folder, name);
}

/** Every captured buffer held something, and holds nothing now. */
function expectAllWiped(): void {
  expect(captured.files).toHaveLength(1);
  expect(captured.pixels).toHaveLength(1);
  for (const bytes of [...captured.files, ...captured.pixels]) {
    expect(bytes.length).toBeGreaterThan(0);
    expect(wiped(bytes)).toBe(true);
  }
}

describe("AUD-018-SEC001: a QR image read as secret input is wiped", () => {
  it("wipes the file bytes and the decoded pixels after reading the record", async () => {
    const path = await newPath("record-qr.png");
    await exportQrPayload(PUBLIC_RECORD, path);
    captured.files.length = 0;
    expect(await decodeQrPngFile(path)).toBe(PUBLIC_RECORD);
    expectAllWiped();
  });

  it("wipes them too when the image holds no QR code", async () => {
    const path = await newPath("blank.png");
    // The real PNG writer: the module above is the capturing stand-in.
    const { PNG } = await vi.importActual<typeof import("pngjs")>("pngjs");
    const blank = new PNG({ width: 64, height: 64 });
    blank.data.fill(255);
    await writeFile(path, PNG.sync.write(blank));
    captured.pixels.length = 0;
    await expect(decodeQrPngFile(path)).rejects.toThrow("No readable QR code");
    expectAllWiped();
  });

  it("wipes the file bytes of an image it refuses before decoding", async () => {
    const path = await newPath("not-a-png.png");
    await writeFile(path, "public text, not an image");
    await expect(decodeQrPngFile(path)).rejects.toThrow("The QR input is not a PNG file.");
    expect(captured.files).toHaveLength(1);
    expect(wiped(captured.files[0]!)).toBe(true);
    expect(captured.pixels).toHaveLength(0);
  });

  it("keeps the text reader's wiping as it was", async () => {
    const path = await newPath("record.txt");
    await writeFile(path, `${PUBLIC_RECORD}\n`);
    expect(readBoundedTextFile(path)).toBe(`${PUBLIC_RECORD}\n`);
    expect(captured.files).toHaveLength(1);
    expect(wiped(captured.files[0]!)).toBe(true);
  });
});
