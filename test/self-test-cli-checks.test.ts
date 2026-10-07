// The command line's own checks of its self-test (src/cli/self-test.ts): they pass as the program
// is, and fail when what they check goes wrong, here made wrong by a replaced module.
import { describe, expect, it, vi } from "vitest";

const qr = vi.hoisted(() => ({ wrongName: false, acceptEmpty: false }));
vi.mock("../src/cli/qr-export.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/cli/qr-export.js")>();
  return {
    ...original,
    // A QR image saved under a name that is not its sheet's.
    saveQrBeside: async (payload: string, sheet: string, suffix?: string) => {
      const path = await original.saveQrBeside(payload, sheet, suffix);
      return qr.wrongName ? path.replace("-qr", "") : path;
    },
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
});
