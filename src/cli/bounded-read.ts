import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { InputTooLargeError, MEBIBYTE } from "../core/byte-units.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.bounded-read", {
  "read-file-refuse-refused": suppliedMessage,
  "regular-file-required": (what: string) => `${what} must be a regular text file.`,
});

/**
 * The largest text that a command reads: a file, standard input or an answer typed or pasted at a
 * question. No valid input is nearly that long.
 */
export const MAX_TEXT_INPUT_BYTES = MEBIBYTE;

/**
 * Size of each read; small enough that a rejected input never occupies much more than its limit.
 */
const CHUNK_BYTES = 64 * 1024;

/**
 * Reads a file descriptor to its end, but never more than `limit` bytes: one byte more is refused
 * as InputTooLargeError, naming `what`. The bound applies to what is actually read, so it also
 * holds for pipes, devices and files that grow while they are read, whose reported size says
 * nothing. The input may be a secret: every chunk read is wiped before this returns or throws, and
 * the one copy returned is the caller's to wipe.
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
      if (total > limit) throw new InputTooLargeError(what, limit);
      parts.push(chunk.subarray(0, length));
    }
    return Buffer.concat(parts, total);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

/**
 * Opens `path` once and reads it with the bound of `readBoundedDescriptor`. With regularOnly,
 * refuses directories, devices and pipes without waiting for a pipe's writer. The result remains
 * owned here until closing succeeds; a close failure wipes the unreturned bytes.
 */
export function readBoundedFile(
  path: string,
  limit: number,
  what: string,
  regularOnly = false,
): Buffer {
  // An interactive path must not block opening a pipe while no writer exists. Check the opened
  // descriptor, rather than checking a name that could change before open.
  const descriptor = openSync(path, regularOnly ? constants.O_RDONLY | constants.O_NONBLOCK : "r");
  let result: Buffer | undefined;
  try {
    try {
      if (regularOnly && !fstatSync(descriptor).isFile())
        throw ERRORS.create("regular-file-required", [what]);
      result = readBoundedDescriptor(descriptor, limit, what);
      return result;
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    result?.fill(0);
    throw error;
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
  regularOnly = false,
): Buffer {
  try {
    return readBoundedFile(path, limit, what, regularOnly);
  } catch (error) {
    if (error instanceof InputTooLargeError) throw error;
    throw ERRORS.create("read-file-refuse-refused", [unreadable], { cause: error });
  }
}
