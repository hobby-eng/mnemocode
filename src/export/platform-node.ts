import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { configureRenderPlatform, type RenderPlatform } from './platform.js';

const assetRoot = new URL('../../assets/', import.meta.url);

/** Node.js host: local files, the system random source, pngjs and qrcode. */
export const nodeRenderPlatform: RenderPlatform = {
  readAsset: (path) => readFile(new URL(path, assetRoot)),
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
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    return { size: qr.modules.size, get: (row, column) => Boolean(qr.modules.get(row, column)) };
  },
};

configureRenderPlatform(nodeRenderPlatform);
