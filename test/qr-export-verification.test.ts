import QRCode from "qrcode";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportQrPayload } from "../src/export/qr-image.js";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { saveQrInside } from "../src/cli/qr-export.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { testFolder } from "./helpers/test-folders.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (original) => harness.replacedTty(await original()));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);

questionsOnPrivateScreen();
afterEach(() => vi.restoreAllMocks());

const PAYLOAD = "public expected QR payload";
const OTHER_PAYLOAD = "public wrong QR payload";

describe("automatic QR verification", () => {
  it.each(["wrong", "unreadable"] as const)(
    "refuses a %s QR image without publishing it or exposing its payload",
    async (kind) => {
      const folder = await testFolder("mnemocode-qr-verify-");
      const png =
        kind === "wrong" ? await QRCode.toBuffer(OTHER_PAYLOAD) : Buffer.from("broken PNG");
      vi.spyOn(QRCode, "toBuffer").mockImplementationOnce(async () => png);
      const failure = exportQrPayload(PAYLOAD, join(folder, "qr.png"));
      await expect(failure).rejects.toMatchObject({
        code: "export.qr-image.qr-verification-failed",
      });
      await expect(failure).rejects.toThrow("QR verification failed");
      await expect(failure).rejects.not.toThrow(PAYLOAD);
      await expect(failure).rejects.not.toThrow(OTHER_PAYLOAD);
      expect(png.every((byte) => byte === 0)).toBe(true);
      expect(await readdir(folder)).toEqual([]);
    },
  );

  it("offers to regenerate a mismatching image and reports verification only after success", async () => {
    const folder = await testFolder("mnemocode-qr-retry-");
    const wrong = await QRCode.toBuffer(OTHER_PAYLOAD);
    const draw = vi.spyOn(QRCode, "toBuffer").mockImplementationOnce(async () => wrong);
    terminal.choices = ["Try again"];
    const path = await saveQrInside(PAYLOAD, folder);
    expect(path).toBe(join(folder, "qr.png"));
    expect(draw).toHaveBeenCalledTimes(2);
    expect(await decodeQrPngFile(join(folder, "qr.png"))).toBe(PAYLOAD);
    expect(seen.notices.join("\n")).toContain("QR verification failed");
    expect(seen.notices.join("\n")).toContain("QR code verified");
    expect(seen.notices.join("\n")).not.toContain(OTHER_PAYLOAD);
  });

  it("never reports verification when the failed image is skipped", async () => {
    const folder = await testFolder("mnemocode-qr-skip-");
    const wrong = await QRCode.toBuffer(OTHER_PAYLOAD);
    vi.spyOn(QRCode, "toBuffer").mockImplementationOnce(async () => wrong);
    terminal.choices = ["Skip"];
    expect(await saveQrInside(PAYLOAD, folder)).toBeUndefined();
    expect(seen.notices.join("\n")).not.toContain("QR code verified");
    expect(await readdir(folder)).toEqual([]);
  });
});
