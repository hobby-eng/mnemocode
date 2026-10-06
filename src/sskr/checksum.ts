const CRC32_INITIAL = 0xffffffff;
const CRC32_REFLECTED_POLYNOMIAL = 0xedb88320;

/** Bytewords transport checksum; error detection, not authentication. */
export function crc32(bytes: Uint8Array): number {
  let crc = CRC32_INITIAL;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      const polynomial = crc & 1 ? CRC32_REFLECTED_POLYNOMIAL : 0;
      crc = (crc >>> 1) ^ polynomial;
    }
  }
  return (crc ^ CRC32_INITIAL) >>> 0;
}

/** Public, reversible mixing used by the color and word share layouts; not encryption. */
export function shareMask(checksum: Uint8Array, index: number): number {
  return crc32(Uint8Array.of(...checksum, index >>> 8, index & 0xff)) & 0xff;
}
