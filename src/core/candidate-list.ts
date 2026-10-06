// The candidate list (docs/CANDIDATES.md, "The list"): BIP39 entropies with optional passphrases,
// in the order of the search, padded with Padmé so that its size tells little. Encryption with
// age is a separate layer (candidate-encryption.ts). Host-neutral, like the rest of the core.

import { crc32 } from "../sskr/checksum.js";

/** "MNCL": MnemoCode candidate list. */
const MAGIC = [0x4d, 0x4e, 0x43, 0x4c] as const;
const VERSION = 1;
const GLOBAL_PASSPHRASE_FLAG = 0b01;
const RECORD_PASSPHRASE_FLAG = 0b10;
/**
 * Records in one list, 2^19. Two forgotten words of a 12-word phrase give 2048 × 2048 / 16 =
 * 262,144 checksum-valid phrases on average, and up to some thousand more when neither is the
 * last word; twice that leaves room to spare.
 */
export const MAX_CANDIDATE_RECORDS = 2 ** 19;
export const MAX_PASSPHRASE_BYTES = 256;
/** BIP39 entropy: 16 to 32 bytes for 12 to 24 words. */
const ENTROPY_LENGTHS = new Set([16, 20, 24, 28, 32]);
/** Magic, version, flags, entropy length and the 4-byte count. */
const HEADER_BYTES = 11;
const LENGTH_BYTES = 2;
const COUNT_BYTES = 4;
const CRC_BYTES = 4;

export interface CandidateRecord {
  readonly entropy: Uint8Array;
  /** The record's own BIP39 passphrase; without it, the list's. */
  readonly passphrase?: string;
}

export interface CandidateList {
  /** The BIP39 passphrase of every record without one of its own. */
  readonly passphrase?: string;
  readonly records: readonly CandidateRecord[];
}

/**
 * The padded length of `length` bytes (Padmé: Nikitin et al., PETS 2019): with E the bit length of
 * the length less one and S that of E, the low E − S bits are rounded up; at most about 12 % more.
 */
export function padmeLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < 2)
    throw new Error("Padmé needs a length of 2 or more.");
  const floorLog2 = (value: number) => {
    let bits = 0;
    while (2 ** (bits + 1) <= value) bits += 1;
    return bits;
  };
  const e = floorLog2(length);
  const step = 2 ** (e - (floorLog2(e) + 1));
  return Math.ceil(length / step) * step;
}

const encoder = new TextEncoder();

/**
 * Refuses a passphrase that no list can hold: one with a lone surrogate, which UTF-8 cannot carry,
 * or one longer than MAX_PASSPHRASE_BYTES. Callers check a BIP39 passphrase before a long search.
 */
export function assertListPassphrase(passphrase: string, what = "BIP39 passphrase"): void {
  if (/\p{Cs}/u.test(passphrase)) throw new Error(`The ${what} is not valid Unicode text.`);
  if (encoder.encode(passphrase).length > MAX_PASSPHRASE_BYTES)
    throw new Error(`The ${what} is longer than ${MAX_PASSPHRASE_BYTES} bytes.`);
}

/** A passphrase as stored; an empty one is no passphrase. */
function passphraseBytes(passphrase: string | undefined, what: string): Uint8Array | undefined {
  if (passphrase === undefined || passphrase === "") return undefined;
  assertListPassphrase(passphrase, what);
  return encoder.encode(passphrase);
}

/** Writes a list; every record must have the same entropy length. */
export function encodeCandidateList(list: CandidateList): Uint8Array {
  const count = list.records.length;
  if (count < 1 || count > MAX_CANDIDATE_RECORDS)
    throw new Error(
      `A candidate list holds 1 to ${MAX_CANDIDATE_RECORDS.toLocaleString("en-US")} records.`,
    );
  const entropyLength = list.records[0]!.entropy.length;
  if (
    !ENTROPY_LENGTHS.has(entropyLength) ||
    list.records.some((r) => r.entropy.length !== entropyLength)
  )
    throw new Error("Every candidate must be BIP39 entropy of one length, 16 to 32 bytes.");
  const global = passphraseBytes(list.passphrase, "passphrase for all candidates");
  const own = list.records.map((record, index) =>
    passphraseBytes(record.passphrase, `passphrase of candidate ${index + 1}`),
  );
  const perRecord = own.some((bytes) => bytes !== undefined);
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[4] = VERSION;
  header[5] = (global ? GLOBAL_PASSPHRASE_FLAG : 0) | (perRecord ? RECORD_PASSPHRASE_FLAG : 0);
  header[6] = entropyLength;
  new DataView(header.buffer).setUint32(HEADER_BYTES - COUNT_BYTES, count);
  parts.push(header);
  const field = (bytes: Uint8Array) => {
    const length = new Uint8Array(LENGTH_BYTES);
    new DataView(length.buffer).setUint16(0, bytes.length);
    parts.push(length, bytes);
  };
  if (global) field(global);
  list.records.forEach((record, index) => {
    parts.push(record.entropy);
    if (perRecord) field(own[index] ?? new Uint8Array());
  });
  const contentLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(padmeLength(contentLength + CRC_BYTES));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  new DataView(output.buffer).setUint32(offset, crc32(output.subarray(0, offset)));
  return output;
}

/** Reads a list, refusing it as a whole when anything in it is out of place. */
export function decodeCandidateList(bytes: Uint8Array): CandidateList {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // ignoreBOM: a passphrase is kept as stored, with a leading U+FEFF if it has one.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let offset = 0;
  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length) throw new Error("The candidate list is cut short.");
    offset += length;
    return bytes.subarray(offset - length, offset);
  };
  const uint16 = (): number => {
    take(LENGTH_BYTES);
    return view.getUint16(offset - LENGTH_BYTES);
  };
  const uint32 = (): number => {
    take(COUNT_BYTES);
    return view.getUint32(offset - COUNT_BYTES);
  };
  /** A passphrase field; undefined when it is empty. */
  const passphrase = (minimum: number): string | undefined => {
    const length = uint16();
    if (length < minimum || length > MAX_PASSPHRASE_BYTES)
      throw new Error("A passphrase in the candidate list has a wrong length.");
    if (length === 0) return undefined;
    try {
      return decoder.decode(take(length));
    } catch {
      throw new Error("A passphrase in the candidate list is not valid UTF-8 text.");
    }
  };
  const magic = take(MAGIC.length);
  if (MAGIC.some((byte, index) => magic[index] !== byte))
    throw new Error("This is not a MnemoCode candidate list.");
  const [version, flags, entropyLength] = take(3);
  if (version !== VERSION) throw new Error(`Candidate list version ${version} is not supported.`);
  if ((flags! & ~(GLOBAL_PASSPHRASE_FLAG | RECORD_PASSPHRASE_FLAG)) !== 0)
    throw new Error("The candidate list has unknown flags.");
  if (!ENTROPY_LENGTHS.has(entropyLength!))
    throw new Error("The candidate list has a wrong entropy length.");
  const count = uint32();
  if (count < 1 || count > MAX_CANDIDATE_RECORDS)
    throw new Error("The candidate list has a wrong record count.");
  const global = flags! & GLOBAL_PASSPHRASE_FLAG ? passphrase(1) : undefined;
  const records: CandidateRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const entropy = Uint8Array.from(take(entropyLength!));
    const own = flags! & RECORD_PASSPHRASE_FLAG ? passphrase(0) : undefined;
    records.push(own === undefined ? { entropy } : { entropy, passphrase: own });
  }
  const contentLength = offset;
  if (uint32() !== crc32(bytes.subarray(0, contentLength)))
    throw new Error("The candidate list is damaged: its CRC-32 does not match.");
  if (bytes.length !== padmeLength(offset) || bytes.subarray(offset).some((byte) => byte !== 0))
    throw new Error("The candidate list has wrong padding.");
  return global === undefined ? { records } : { passphrase: global, records };
}
