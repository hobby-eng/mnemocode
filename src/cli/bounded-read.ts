import { closeSync, openSync, readSync } from "node:fs";

/** Bytes in a mebibyte, the unit that every limit of input is named in. */
export const MEBIBYTE = 1024 * 1024;

/**
 * The largest text that a command reads: a file, standard input or an answer typed or pasted at a
 * question. No valid input is nearly that long.
 */
export const MAX_TEXT_INPUT_BYTES = MEBIBYTE;

/** A limit of `bytes`, whole mebibytes, as the messages name it, such as "1 MiB". */
export function limitName(bytes: number): string {
  return `${bytes / MEBIBYTE} MiB`;
}

/** The refusal of an input larger than its limit: "`what` exceeds the 1 MiB safety limit." */
export class InputTooLarge extends Error {
  constructor(what: string, limit: number) {
    super(`${what} exceeds the ${limitName(limit)} safety limit.`);
    this.name = "InputTooLarge";
  }
}

/**
 * Size of each read; small enough that a rejected input never occupies much more than its limit.
 */
const CHUNK_BYTES = 64 * 1024;

/**
 * Reads a file descriptor to its end, but never more than `limit` bytes: one byte more is refused
 * as InputTooLarge, naming `what`. The bound applies to what is actually read, so it also holds
 * for pipes, devices and files that grow while they are read, whose reported size says nothing.
 * The input may be a secret: every chunk read is wiped before this returns or throws, and the one
 * copy returned is the caller's to wipe.
 */
export function readBoundedDescriptor(descriptor: number, limit: number, what: string): Buffer {
  const chunks: Buffer[] = [];
  const parts: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, limit + 1 - total));
      // Kept before the read, so that a read that fails part way is wiped too.
      chunks.push(chunk);
      const length = readSync(descriptor, chunk, 0, chunk.length, null);
      if (length === 0) break;
      total += length;
      if (total > limit) throw new InputTooLarge(what, limit);
      parts.push(chunk.subarray(0, length));
    }
    return Buffer.concat(parts, total);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** Opens `path` once and reads it with the bound of `readBoundedDescriptor`. */
export function readBoundedFile(path: string, limit: number, what: string): Buffer {
  const descriptor = openSync(path, "r");
  try {
    return readBoundedDescriptor(descriptor, limit, what);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * readBoundedFile, where every other failure, a file missing or unreadable, is refused with
 * `unreadable`, which names no system detail; too large is said as such.
 */
export function readFileOrRefuse(
  path: string,
  limit: number,
  what: string,
  unreadable: string,
): Buffer {
  try {
    return readBoundedFile(path, limit, what);
  } catch (error) {
    if (error instanceof InputTooLarge) throw error;
    throw new Error(unreadable, { cause: error });
  }
}
