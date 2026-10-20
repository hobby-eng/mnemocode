// The command line's own checks of its self-test (src/cli/self-test.ts): they pass as the program
// is, and fail when what they check goes wrong, here made wrong by a replaced module.
import { rmSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { matching } from "./helpers/matchers.js";

const qr = vi.hoisted(() => ({ wrongName: false, acceptEmpty: false }));
// The removal of the self-test's temporary folders, made to fail; the folders it kept are removed
// by the test afterwards.
const removal = vi.hoisted(() => {
  const kept: string[] = [];
  return { fails: false, kept };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rm: async (path: string, options?: Parameters<typeof original.rm>[1]) => {
      if (!removal.fails) return original.rm(path, options);
      removal.kept.push(path);
      throw Object.assign(new Error("Synthetic removal fault."), { code: "EBUSY" });
    },
  };
});
vi.mock("../src/cli/qr-export.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/cli/qr-export.js")>();
  return {
    ...original,
    // A QR image saved under a name that is not its sheet's.
    saveQrBeside: async (payload: string, sheet: string, suffix?: string) => {
      const path = await original.saveQrBeside(payload, sheet, suffix);
      if (typeof path !== "string") throw Error("The QR fixture was not saved.");
      return qr.wrongName ? path.replace("-qr", "") : path;
    },
  };
});
vi.mock("../src/export/qr-image.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/export/qr-image.js")>();
  return {
    ...original,
    // An empty QR image accepted.
    exportQrPayload: async (payload: string, path: string) =>
      qr.acceptEmpty && payload === "" ? undefined : original.exportQrPayload(payload, path),
  };
});

import { QR_BESIDE_CHECK } from "../src/cli/self-test.js";

describe("The QR images beside sheets in the self-test", () => {
  it("pass as the program is", async () => {
    qr.wrongName = false;
    qr.acceptEmpty = false;
    await expect(QR_BESIDE_CHECK.run()).resolves.toBeUndefined();
  });

  it("fail when the image is not named after its sheet", async () => {
    qr.wrongName = true;
    qr.acceptEmpty = false;
    await expect(QR_BESIDE_CHECK.run()).rejects.toThrow(/QR image beside a PDF mismatch/u);
  });

  it("fail when an empty image is accepted", async () => {
    qr.wrongName = false;
    qr.acceptEmpty = true;
    await expect(QR_BESIDE_CHECK.run()).rejects.toThrow(/An empty QR image was accepted/u);
  });

  it("keep a check's failure first when its temporary folder cannot be removed either", async () => {
    qr.wrongName = true;
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
