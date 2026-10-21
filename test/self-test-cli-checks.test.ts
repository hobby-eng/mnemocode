// The command line's own checks of its self-test (src/cli/self-test.ts): they pass as the program
// is, and fail when what they check goes wrong, here made wrong by the files the check meets; the
// refusal of an empty image, which no file reaches, by a replaced module.
import { rmSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { matching } from "./helpers/matchers.js";

const qr = vi.hoisted(() => ({ nameTaken: false, acceptEmpty: false }));
// The self-test's temporary folders: each new one already holds a file named as the QR image of
// the check's sheet, cards-qr.png, while `qr.nameTaken` says so. Their removal, made to fail; the
// folders it kept are removed by the test afterwards.
const removal = vi.hoisted(() => {
  const kept: string[] = [];
  return { fails: false, kept };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdtemp: async (prefix: string) => {
      const folder = await original.mkdtemp(prefix);
      const { join } = await import("node:path");
      if (qr.nameTaken) await original.writeFile(join(folder, "cards-qr.png"), "not the QR image");
      return folder;
    },
    rm: async (path: string, options?: Parameters<typeof original.rm>[1]) => {
      if (!removal.fails) return original.rm(path, options);
      removal.kept.push(path);
      throw Object.assign(new Error("Synthetic removal fault."), { code: "EBUSY" });
    },
  };
});
// Fault: the export of a QR image takes an empty payload while `qr.acceptEmpty` is set, which the
// self-test's check of the QR images must refuse.
vi.mock("../src/export/qr-image.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/export/qr-image.js")>();
  return {
    ...original,
    exportQrPayload: async (payload: string, path: string) =>
      qr.acceptEmpty && payload === "" ? undefined : original.exportQrPayload(payload, path),
  };
});

import { QR_BESIDE_CHECK } from "../src/cli/self-test.js";

describe("The QR images beside sheets in the self-test", () => {
  it("pass as the program is", async () => {
    qr.nameTaken = false;
    qr.acceptEmpty = false;
    await expect(QR_BESIDE_CHECK.run()).resolves.toBeUndefined();
  });

  it("fail when the image is not named after its sheet", async () => {
    // The name is taken: the image gets the next free one, cards-qr-1.png.
    qr.nameTaken = true;
    qr.acceptEmpty = false;
    await expect(QR_BESIDE_CHECK.run()).rejects.toThrow(/QR image beside a PDF mismatch/u);
  });

  it("fail when an empty image is accepted", async () => {
    qr.nameTaken = false;
    qr.acceptEmpty = true;
    await expect(QR_BESIDE_CHECK.run()).rejects.toThrow(/An empty QR image was accepted/u);
  });

  it("keep a check's failure first when its temporary folder cannot be removed either", async () => {
    qr.nameTaken = true;
    qr.acceptEmpty = false;
    removal.fails = true;
    try {
      await expect(QR_BESIDE_CHECK.run()).rejects.toMatchObject({
        code: "core.refusal.cleanup-failed-after-failure",
        message: matching(/^QR image beside a PDF.*; the cleanup .*Synthetic removal fault\.$/u),
        cause: { message: matching(/^QR image beside a PDF/u) },
        cleanup: { code: "EBUSY" },
      });
    } finally {
      removal.fails = false;
      for (const folder of removal.kept.splice(0)) rmSync(folder, { recursive: true, force: true });
    }
  });
});
