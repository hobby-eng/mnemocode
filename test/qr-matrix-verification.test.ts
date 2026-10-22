import QRCode from "qrcode";
import { afterEach, expect, it, vi } from "vitest";
import { nodeRenderPlatform } from "../src/export/platform-node.js";

afterEach(() => vi.restoreAllMocks());

it("refuses a QR matrix with different content before it can be embedded in a document", () => {
  const wrong = QRCode.create("public wrong document payload");
  vi.spyOn(QRCode, "create").mockReturnValueOnce(wrong);
  expect(() => nodeRenderPlatform.qrModules("public expected document payload")).toThrow(
    "QR verification failed",
  );
});
