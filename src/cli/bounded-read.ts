import { closeSync, openSync, readSync } from 'node:fs';

/** Size of each read; small enough that a rejected input never occupies much more than its limit. */
const CHUNK_BYTES = 64 * 1024;

/**
 * Reads a file descriptor to its end, but never more than `limit` bytes: one byte more is an error
 * with the message `tooLarge`. The bound applies to what is actually read, so it also holds for
 * pipes, devices and files that grow while they are read, whose reported size says nothing.
 */
export function readBoundedDescriptor(descriptor: number, limit: number, tooLarge: string): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, limit + 1 - total));
    const length = readSync(descriptor, chunk, 0, chunk.length, null);
    if (length === 0) break;
    total += length;
    if (total > limit) throw new Error(tooLarge);
    chunks.push(chunk.subarray(0, length));
  }
  return Buffer.concat(chunks, total);
}

/** Opens `path` once and reads it with the bound of `readBoundedDescriptor`. */
export function readBoundedFile(path: string, limit: number, tooLarge: string): Buffer {
  const descriptor = openSync(path, 'r');
  try {
    return readBoundedDescriptor(descriptor, limit, tooLarge);
  } finally {
    closeSync(descriptor);
  }
}
