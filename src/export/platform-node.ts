import { randomInt } from "node:crypto";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { readBundledFile } from "../bundled-files.js";
import { type RenderPlatform, QR_ERROR_CORRECTION_LEVEL } from "./platform.js";
import { ASSETS_FOLDER } from "../bundled-file-paths.js";
import { CardRenderer } from "./card-renderer.js";

/** Node.js host: local files, the system random source, pngjs and qrcode. */
export const nodeRenderPlatform: RenderPlatform = {
  readAsset: (path) => readBundledFile(`${ASSETS_FOLDER}${path}`),
  randomInt: (upperExclusive) => randomInt(upperExclusive),
  decodePng: (bytes) => {
    const image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { width: image.width, height: image.height, data: image.data };
  },
  encodePng: (image, deflateLevel) => {
    const output = new PNG({ width: image.width, height: image.height });
    output.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    return PNG.sync.write(output, { deflateLevel });
  },
  qrModules: (payload) => {
    const qr = QRCode.create(payload, { errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL });
    return { size: qr.modules.size, get: (row, column) => Boolean(qr.modules.get(row, column)) };
  },
};

/**
 * The card renderer of the Node.js front ends, which they pass to every render: one for the
 * process, so that its prepared artwork serves every export. Not for other hosts, which build
 * their own CardRenderer with their platform.
 */
export const nodeCardRenderer = new CardRenderer(nodeRenderPlatform);
