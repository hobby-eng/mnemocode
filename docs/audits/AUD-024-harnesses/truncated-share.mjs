// AUD-024-FUN001: ur:sskr records whose CBOR is cut short but whose CRC32 is valid must be refused
// as invalid input, as at 870effe ("Not an SSKR CBOR tag." / "Invalid SSKR share byte string."),
// not as a fault of MnemoCode. Run from the MnemoCode repository root after pnpm build:
//   node docs/audits/AUD-024-harnesses/truncated-share.mjs
// Exit 0 when every record is refused as input; exit 1 while any is blamed on MnemoCode.
import { urToTransport } from "../../../dist/sskr/transport.js";
import { bytewords } from "../../../dist/sskr/bytewords-list.js";
import { crc32 } from "../../../dist/sskr/checksum.js";

function ur(cbor) {
  const sum = crc32(Uint8Array.from(cbor));
  const all = [...cbor, (sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255];
  return "ur:sskr/" + all.map((b) => bytewords[b][0] + bytewords[b][3]).join("");
}
const CASES = [
  ["tag byte only", [0xd9], "Not an SSKR CBOR tag."],
  ["tag byte and one more", [0xd9, 0x01], "Not an SSKR CBOR tag."],
  ["one-byte-length header only", [0x58], "Invalid SSKR share byte string."],
  ["SSKR tag 40309 without a byte string", [0xd9, 0x9d, 0x75], "Invalid SSKR share byte string."],
  ["SSKR tag and a header without its length", [0xd9, 0x9d, 0x75, 0x58], "Invalid SSKR share byte string."],
];
let failed = 0;
for (const [name, cbor, expected] of CASES) {
  const text = ur(cbor);
  let message = "accepted";
  try {
    urToTransport(text);
  } catch (error) {
    message = error.message;
  }
  const ok = message === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${text} -> ${message}`);
}
process.exit(failed === 0 ? 0 : 1);
