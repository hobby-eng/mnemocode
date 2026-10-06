import { publishNewPrivateFile } from "../export/private-file.js";
import QRCode from "qrcode";

export async function exportQrPayload(payload: string, path: string): Promise<void> {
  if (payload.length === 0) throw new Error("QR payload must not be empty.");
  const png = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    type: "png",
    width: 720,
  });
  await publishNewPrivateFile(path, png);
}
