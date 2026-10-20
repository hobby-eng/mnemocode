// A saved file that shows a backup, such as a QR image, cards or the shares as text, is wiped from
// memory once it is written or refused (wipedAfterAsync), never while it is still being written.
// The bytes handed to the real publisher are captured. Public test data only.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted((): { published: Uint8Array[] } => ({ published: [] }));

vi.mock("../src/export/private-file.js", async (original) => {
  const actual = await original<typeof import("../src/export/private-file.js")>();
  return {
    ...actual,
    publishNewPrivateFile: async (path: string, bytes: Uint8Array) => {
      captured.published.push(bytes);
      return actual.publishNewPrivateFile(path, bytes);
    },
  };
});

import { wipedAfterAsync } from "../src/core/bits.js";
import { exportQrPayload } from "../src/export/qr-image.js";
import { testFolder } from "./helpers/test-folders.js";

const wiped = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);

afterEach(() => {
  captured.published.length = 0;
});

describe("wipedAfterAsync", () => {
  it("keeps the bytes while the use runs and wipes them once it has resolved", async () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const seen = await wipedAfterAsync(bytes, async (held) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [...held];
    });
    expect(seen).toEqual([1, 2, 3]);
    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it("wipes them when the use rejects, and passes the rejection on", async () => {
    const bytes = Uint8Array.of(4, 5);
    await expect(
      wipedAfterAsync(bytes, async () => {
        throw new Error("public test refusal");
      }),
    ).rejects.toThrow("public test refusal");
    expect([...bytes]).toEqual([0, 0]);
  });
});

describe("a saved QR image of a backup", () => {
  it("is written complete, and the bytes that were written are wiped afterwards", async () => {
    const folder = await testFolder("mnemocode-saved-wiped-");
    const path = join(folder, "record-qr.png");
    await exportQrPayload(`MNC1:direct:indexes:${"1 ".repeat(11)}4`, path);
    expect((await readFile(path)).length).toBeGreaterThan(0);
    expect(captured.published).toHaveLength(1);
    expect(captured.published[0]!.length).toBeGreaterThan(0);
    expect(wiped(captured.published[0]!)).toBe(true);
  });

  it("is wiped too when the name is taken and nothing is written", async () => {
    const folder = await testFolder("mnemocode-saved-wiped-");
    const path = join(folder, "taken.png");
    await exportQrPayload("public payload", path);
    captured.published.length = 0;
    await expect(exportQrPayload("public payload", path)).rejects.toMatchObject({ code: "EEXIST" });
    expect(captured.published).toHaveLength(1);
    expect(wiped(captured.published[0]!)).toBe(true);
  });
});
