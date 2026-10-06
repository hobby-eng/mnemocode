import { bytewords } from "./bytewords-list.js";
import { crc32, shareMask } from "./checksum.js";
import { colorsToUnicode, unicodeToColorCodes } from "../core/colors.js";
import { traditionalChineseWordlist, UNICODE_INDEX, unicodeHex } from "../core/words.js";

export const CHECKSUM_BYTES = 4;
const MAX_TRANSPORT_BYTES = 128;
const CBOR_UINT16_TAG = 0xd9;
export const CBOR_TAG_BYTES = 3;
const SSKR_CBOR_TAGS = new Set([40309, 309]);
const SHARE_METADATA_BYTES = 5;
/** Metadata and secret of a share, for secrets of 16 to 32 bytes: 12- to 24-word phrases. */
export const SHARE_LENGTHS: ReadonlySet<number> = new Set([21, 25, 29, 33, 37]);
const LOW_NIBBLE_MASK = 0x0f;
export const COLOR_VERSION = 0xa1;
/** Shares written as BIP39 word numbers or Unicode codes: MnemoCode's own form, like colors. */
export const WORD_VERSION = 0xa2;
/** The version byte and the length of the CBOR, before the CBOR of a share in colors or words. */
export const SHARE_HEADER_BYTES = 2;
/** One BIP39 word stands for 11 bits: 2048 words. */
export const WORD_BITS = 11;
export const WORD_COUNT = 2 ** WORD_BITS;
export const RGB_BYTES = 3;
const MAX_COLOR_TEXT_LENGTH = 1024;
const MAX_SHARE_COUNT = 256;

const minimalBytewords = bytewords.map((word) => word[0]! + word[3]!);
const minimalBytewordValues = new Map(minimalBytewords.map((word, index) => [word, index]));
const fullBytewordValues = new Map<string, number>(bytewords.map((word, index) => [word, index]));

function validateTransportChecksum(bytes: Uint8Array): void {
  if (bytes.length < CHECKSUM_BYTES + 1 || bytes.length > MAX_TRANSPORT_BYTES) {
    throw new Error("Invalid SSKR transport length.");
  }
  const checksumOffset = bytes.length - CHECKSUM_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordedChecksum = view.getUint32(checksumOffset);
  if (crc32(bytes.subarray(0, checksumOffset)) !== recordedChecksum) {
    throw new Error("SSKR transport checksum does not match.");
  }
}

function addTransportChecksum(payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + CHECKSUM_BYTES);
  bytes.set(payload);
  new DataView(bytes.buffer).setUint32(payload.length, crc32(payload));
  return bytes;
}

/** Only the definite byte-string CBOR form used by SSKR is accepted. */
function sharePayload(transport: Uint8Array): Uint8Array {
  validateTransportChecksum(transport);
  const cbor = transport.subarray(0, -CHECKSUM_BYTES);
  let offset = 0;
  if (cbor[0] === CBOR_UINT16_TAG) {
    const tag = (cbor[1]! << 8) | cbor[2]!;
    if (!SSKR_CBOR_TAGS.has(tag)) throw new Error("Not an SSKR CBOR tag.");
    offset = CBOR_TAG_BYTES;
  }
  const header = cbor[offset++]!;
  let payloadLength = -1;
  if (header >= 0x40 && header <= 0x57) {
    payloadLength = header - 0x40;
  } else if (header === 0x58) {
    payloadLength = cbor[offset++]!;
  }
  if (payloadLength !== cbor.length - offset || !SHARE_LENGTHS.has(payloadLength)) {
    throw new Error("Invalid SSKR share byte string.");
  }
  return cbor.subarray(offset);
}

export interface ShareInfo {
  readonly identifier: number;
  readonly groupThreshold: number;
  readonly groupCount: number;
  readonly groupIndex: number;
  readonly memberThreshold: number;
  readonly memberIndex: number;
  readonly secretLength: number;
}

/** Thresholds and group count are stored minus one; member/group indexes are zero-based. */
export function shareInfo(transport: Uint8Array): ShareInfo {
  const payload = sharePayload(transport);
  const info: ShareInfo = {
    identifier: (payload[0]! << 8) | payload[1]!,
    groupThreshold: (payload[2]! >>> 4) + 1,
    groupCount: (payload[2]! & LOW_NIBBLE_MASK) + 1,
    groupIndex: payload[3]! >>> 4,
    memberThreshold: (payload[3]! & LOW_NIBBLE_MASK) + 1,
    memberIndex: payload[4]! & LOW_NIBBLE_MASK,
    secretLength: payload.length - SHARE_METADATA_BYTES,
  };
  const reservedBits = payload[4]! >>> 4;
  if (
    reservedBits !== 0 ||
    info.groupThreshold > info.groupCount ||
    info.groupIndex >= info.groupCount
  ) {
    throw new Error("Invalid SSKR share metadata.");
  }
  return info;
}

export function urToTransport(value: string): Uint8Array {
  const match = /^ur:sskr\/([a-z]+)$/iu.exec(value.trim());
  const body = match?.[1];
  if (!body || body.length % 2 !== 0 || body.length > MAX_TRANSPORT_BYTES * 2) {
    throw new Error("Expected a single-part ur:sskr record.");
  }
  const pairs = body.toLowerCase().match(/../gu)!;
  const bytes = Uint8Array.from(pairs, (pair) => {
    const byte = minimalBytewordValues.get(pair);
    if (byte === undefined) throw new Error("Unknown Bytewords pair in SSKR record.");
    return byte;
  });
  shareInfo(bytes);
  return bytes;
}

export function transportToUr(bytes: Uint8Array): string {
  shareInfo(bytes);
  // A UR's type supplies the CBOR tag. Standard Bytewords contains the tag explicitly.
  const canonicalBytes =
    bytes[0] === CBOR_UINT16_TAG
      ? addTransportChecksum(bytes.subarray(CBOR_TAG_BYTES, -CHECKSUM_BYTES))
      : bytes;
  const minimalText = Array.from(canonicalBytes, (byte) => minimalBytewords[byte]!).join("");
  return `ur:sskr/${minimalText}`;
}

/** The CBOR tag of an SSKR share registered by Blockchain Commons (bc-tags), written in Bytewords. */
const SSKR_CBOR_TAG = 40309;

/**
 * A share in standard Bytewords: one English word per byte, the CBOR tag included and a new CRC32
 * over the tagged bytes, as other SSKR tools write it. bytewordsToUr reads it back.
 */
export function urToBytewords(ur: string): string {
  const transport = urToTransport(ur);
  const cbor = transport.subarray(0, -CHECKSUM_BYTES);
  const tagged = new Uint8Array(CBOR_TAG_BYTES + cbor.length);
  tagged.set([CBOR_UINT16_TAG, SSKR_CBOR_TAG >> 8, SSKR_CBOR_TAG & 0xff]);
  tagged.set(cbor, CBOR_TAG_BYTES);
  return Array.from(addTransportChecksum(tagged), (byte) => bytewords[byte]!).join(" ");
}

export function bytewordsToUr(value: string): string {
  const words = value
    .trim()
    .toLowerCase()
    .split(/[\s-]+/u);
  if (words.length > MAX_TRANSPORT_BYTES) throw new Error("SSKR record is too long.");
  const bytes = Uint8Array.from(words, (word) => {
    const byte = fullBytewordValues.get(word);
    if (byte === undefined) throw new Error("Unknown SSKR Byteword.");
    return byte;
  });
  return transportToUr(bytes);
}

/**
 * The checksum, then the version, CBOR length and CBOR, mixed to remove the constant prefix.
 * First codes can still coincide; anyone can undo this mixing and recognize the format.
 */
function mixShare(transport: Uint8Array, version: number): number[] {
  const checksum = transport.subarray(-CHECKSUM_BYTES);
  const cbor = transport.subarray(0, -CHECKSUM_BYTES);
  const body = [version, cbor.length, ...cbor];
  return [...checksum, ...body.map((byte, index) => byte ^ shareMask(checksum, index))];
}

/**
 * Undoes mixShare on `bytes`, which may go on with zero filling: the transport bytes and how many
 * of `bytes` the share takes, or undefined when the version or the length does not fit.
 */
function unmixShare(
  bytes: readonly number[],
  version: number,
): { readonly transport: Uint8Array; readonly length: number } | undefined {
  const checksum = Uint8Array.from(bytes.slice(0, CHECKSUM_BYTES));
  const body = bytes.slice(CHECKSUM_BYTES).map((byte, index) => byte ^ shareMask(checksum, index));
  const cborLength = body[1] ?? 0;
  const bodyEnd = SHARE_HEADER_BYTES + cborLength;
  if (checksum.length < CHECKSUM_BYTES || body[0] !== version || cborLength < 1) return undefined;
  if (body.length < bodyEnd) return undefined;
  return {
    transport: Uint8Array.from([...body.slice(SHARE_HEADER_BYTES, bodyEnd), ...checksum]),
    length: CHECKSUM_BYTES + bodyEnd,
  };
}

function colorHex(bytes: readonly number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `#${hex.toUpperCase()}`;
}

/** The mixed share (mixShare, version A1), zero bytes to a whole color, three bytes per #RRGGBB. */
export function shareToColors(ur: string): string[] {
  const bytes = mixShare(urToTransport(ur), COLOR_VERSION);
  while (bytes.length % RGB_BYTES !== 0) bytes.push(0);
  const colors: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += RGB_BYTES) {
    colors.push(colorHex(bytes.slice(offset, offset + RGB_BYTES)));
  }
  return colors;
}

function parseColorBytes(value: string): Uint8Array {
  const input = value.trim();
  const prefixedCodes = /^(?:#[0-9a-f]{6}\s*)+$/iu.test(input);
  const plainCodes = /^(?:[0-9a-f]{6}\s*)+$/iu.test(input);
  if (!input || input.length > MAX_COLOR_TEXT_LENGTH || (!prefixedCodes && !plainCodes)) {
    throw new Error("Invalid SSKR RGB codes. Preserve their printed order.");
  }
  const hex = input.replace(/[#\s]/gu, "");
  return Uint8Array.from(hex.match(/../gu)!, (pair) => parseInt(pair, 16));
}

export function colorsToShare(value: string): string {
  const bytes = Array.from(parseColorBytes(value));
  const share = unmixShare(bytes, COLOR_VERSION);
  if (
    share === undefined ||
    bytes.length !== Math.ceil(share.length / RGB_BYTES) * RGB_BYTES ||
    bytes.slice(share.length).some((byte) => byte !== 0)
  ) {
    throw new Error("Unsupported or truncated SSKR color record.");
  }
  return transportToUr(share.transport);
}

/** How a share is written: the forms of an encoded seed phrase, and the short UR code. */
export type ShareFormat = "ur" | "words" | "indexes" | "unicode" | "colors" | "colors-unicode";

/** BIP39 word indexes from bytes, 11 bits each, the last one filled with zero bits. */
function bytesToWordIndexes(bytes: readonly number[]): number[] {
  const indexes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= WORD_BITS) {
      bits -= WORD_BITS;
      indexes.push((buffer >>> bits) & (WORD_COUNT - 1));
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) indexes.push((buffer << (WORD_BITS - bits)) & (WORD_COUNT - 1));
  return indexes;
}

/** Bytes from BIP39 word indexes, and the bits left over, which must be the zero filling. */
function wordIndexesToBytes(indexes: readonly number[]): { bytes: number[]; leftover: number } {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const index of indexes) {
    buffer = (buffer << WORD_BITS) | index;
    bits += WORD_BITS;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return { bytes, leftover: buffer };
}

/**
 * The share as BIP39 word indexes: the mixed share (mixShare, version A2), 11 bits per word, the
 * last word filled with zero bits. Word numbers and Unicode codes write these indexes as the
 * encoded seed phrase writes its own, so that a share looks like the form chosen for it.
 */
function shareToWordIndexes(ur: string): number[] {
  return bytesToWordIndexes(mixShare(urToTransport(ur), WORD_VERSION));
}

function wordIndexesToShare(indexes: readonly number[]): string {
  const { bytes, leftover } = wordIndexesToBytes(indexes);
  const share = unmixShare(bytes, WORD_VERSION);
  // The words hold exactly the share, and the filling is zero.
  if (
    share === undefined ||
    indexes.length !== Math.ceil((share.length * 8) / WORD_BITS) ||
    leftover !== 0 ||
    bytes.slice(share.length).some((byte) => byte !== 0)
  )
    throw new Error("Unsupported or truncated SSKR share in word numbers or Unicode codes.");
  return transportToUr(share.transport);
}

function indexesToShare(value: string): string {
  const numbers = value.trim().split(/[\s,]+/u);
  if (numbers.length > MAX_COLOR_TEXT_LENGTH || numbers.some((item) => !/^\d{1,4}$/u.test(item)))
    throw new Error("Word numbers of a share are whole numbers from 1 through 2048.");
  const indexes = numbers.map((item) => Number(item) - 1);
  if (indexes.some((index) => index < 0 || index >= WORD_COUNT))
    throw new Error("Word numbers of a share are whole numbers from 1 through 2048.");
  return wordIndexesToShare(indexes);
}

function unicodeToShare(value: string): string {
  const compact = value.replace(/\s+/gu, "").toUpperCase();
  if (compact.length > MAX_COLOR_TEXT_LENGTH || !/^(?:[0-9A-F]{4})+$/u.test(compact))
    throw new Error("Unicode codes of a share have four hexadecimal digits each.");
  const indexes = compact.match(/.{4}/gu)!.map((code) => {
    const index = UNICODE_INDEX.get(code);
    if (index === undefined) throw new Error("A Unicode code of the share is not a BIP39 word.");
    return index;
  });
  return wordIndexesToShare(indexes);
}

/** One share as text in `format`; readShare reads every one of them back. */
export function writeShare(share: string, format: ShareFormat): string {
  switch (format) {
    case "ur":
      return share;
    case "words":
      return urToBytewords(share);
    case "indexes":
      return shareToWordIndexes(share)
        .map((index) => String(index + 1))
        .join(" ");
    case "unicode":
      return shareToWordIndexes(share)
        .map((index) => unicodeHex(traditionalChineseWordlist[index]!))
        .join(" ");
    case "colors":
      return shareToColors(share).join(" ");
    case "colors-unicode":
      return colorsToUnicode(shareToColors(share));
  }
}

/**
 * The readers of each form, with what its text looks like. Text may look like more than one form,
 * such as hexadecimal digits; each form carries a version byte, a length and a checksum, so only
 * the right reader accepts it.
 */
const SHARE_READERS: readonly {
  readonly format: ShareFormat;
  readonly looks: RegExp;
  readonly read: (text: string) => string;
}[] = [
  { format: "ur", looks: /^ur:/iu, read: (text) => transportToUr(urToTransport(text)) },
  { format: "indexes", looks: /^\d+(?:[\s,]+\d+)*$/u, read: indexesToShare },
  { format: "colors", looks: /^[#0-9a-f\s]+$/iu, read: colorsToShare },
  { format: "unicode", looks: /^[0-9a-f\s]+$/iu, read: unicodeToShare },
  {
    format: "colors-unicode",
    looks: /^[0-9a-f\s,;\uE000-\uF8FF]+$/iu,
    read: (text) => colorsToShare(unicodeToColorCodes(text).join(" ")),
  },
  // Anything else is read as Bytewords, the standard form in words.
  { format: "words", looks: /[\s\S]/u, read: bytewordsToUr },
];

/** A share in any form MnemoCode writes, as its UR, and the form it was written in. */
export function readShare(value: string): { readonly ur: string; readonly format: ShareFormat } {
  const text = value.trim();
  let firstError: unknown;
  for (const reader of SHARE_READERS) {
    if (!reader.looks.test(text)) continue;
    try {
      return { ur: reader.read(text), format: reader.format };
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError instanceof Error ? firstError : new Error("This is not an SSKR share.");
}

export function normalizeShare(value: string): string {
  return readShare(value).ur;
}

/**
 * Checks that the QR code of a share card holds the share its color references print, in
 * whatever form the QR code writes it.
 */
export function assertShareQr(colors: readonly string[], payload: string): void {
  if (readShare(payload).ur !== colorsToShare(colors.join(" ")))
    throw new Error("Share QR does not match the printed references.");
}

function assertSameSet(info: ShareInfo, expected: ShareInfo): void {
  if (
    info.identifier !== expected.identifier ||
    info.groupThreshold !== expected.groupThreshold ||
    info.groupCount !== expected.groupCount ||
    info.secretLength !== expected.secretLength
  ) {
    throw new Error("SSKR shares belong to different sets.");
  }
}

/** Bound the input before parsing or searching for any missing elements. */
export function assertShareCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SHARE_COUNT) {
    throw new Error("Provide between 1 and 256 SSKR shares.");
  }
}

/** Reject mixed sets and duplicate members before asking the cryptographic engine. */
export function validateShareSet(records: readonly string[], requireQuorum = true): string[] {
  assertShareCount(records.length);
  const shares = records.map(normalizeShare);
  const infos = shares.map((share) => shareInfo(urToTransport(share)));
  const first = infos[0]!;
  const seenMembers = new Set<string>();
  const groups = new Map<number, { threshold: number; members: number }>();
  for (const info of infos) {
    assertSameSet(info, first);
    const memberKey = `${info.groupIndex}:${info.memberIndex}`;
    if (seenMembers.has(memberKey))
      throw new Error("The same SSKR member was supplied more than once.");
    seenMembers.add(memberKey);
    const group = groups.get(info.groupIndex) ?? { threshold: info.memberThreshold, members: 0 };
    if (group.threshold !== info.memberThreshold)
      throw new Error("Conflicting SSKR group thresholds.");
    group.members += 1;
    groups.set(info.groupIndex, group);
  }
  const completeGroups = [...groups.values()].filter(
    (group) => group.members >= group.threshold,
  ).length;
  if (requireQuorum && completeGroups < first.groupThreshold) {
    throw new Error("Not enough SSKR shares to meet the recorded threshold.");
  }
  return shares;
}
