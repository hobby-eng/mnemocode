// Independent CRC-32 framing for semantic refusal fixtures. The polynomial is the reflected
// IEEE 802.3 value; production's CRC implementation is intentionally not used as the oracle.
const CRC32_BYTES = 4;
const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_INITIAL = 0xffffffff;

export function recheck(body: Uint8Array): Uint8Array {
  let crc = CRC32_INITIAL;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? CRC32_POLYNOMIAL : 0);
  }
  const result = new Uint8Array(body.length + CRC32_BYTES);
  result.set(body);
  new DataView(result.buffer).setUint32(body.length, (crc ^ CRC32_INITIAL) >>> 0);
  return result;
}
