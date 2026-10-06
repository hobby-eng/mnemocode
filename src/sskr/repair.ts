// Repairs a share with up to six unreadable elements, each marked with ? at its place: a word
// number, a Unicode code, a color, a Byteword or a pair of letters of a UR. Every form keeps a
// CRC32 checksum, and the mixed forms a version and a length byte (transport.ts), and all of these
// are affine over GF(2) in the bits of the share: the mixing XORs each byte with a CRC32 of the
// checksum, and CRC32 itself is affine. So the missing bits are the solutions of a system of linear
// equations, found by elimination instead of by trying every value, which for three colors would
// be 2^72 tries. Each solution is then read as an ordinary share, which checks everything again.
// More solutions than one are listed as variants, never chosen silently; unmarked errors are never
// repaired.

import { bytewords } from "./bytewords-list.js";
import { crc32, shareMask } from "./checksum.js";
import { solve } from "./gf2.js";
import {
  CHECKSUM_BYTES,
  COLOR_VERSION,
  readShare,
  RGB_BYTES,
  SHARE_HEADER_BYTES,
  SHARE_LENGTHS,
  WORD_BITS,
  WORD_COUNT,
  WORD_VERSION,
  type ShareFormat,
} from "./transport.js";
import { traditionalChineseWordlist, UNICODE_INDEX, unicodeHex } from "../core/words.js";
import {
  COLOR_UNICODE_BASE,
  COLOR_UNICODE_WIDTH,
  colorsToUnicode,
  unicodeToColorCodes,
} from "../core/colors.js";

/** More marked elements than this leave too few checksum bits to find them. */
export const MAX_MARKED_ELEMENTS = 6;
export const MAX_REPAIR_TEXT_LENGTH = 2048;
const MAX_REPAIR_UNITS = 128;
/**
 * Up to 2^4 solutions of one share are listed as variants. Restoring with other shares may try up
 * to 2^8 of them, since the SSKR library then keeps only the one whose secret digest fits.
 */
export const LISTED_FREE_BITS = 4;
export const RESOLVED_FREE_BITS = 16;
const BYTE_BITS = 8;
const COLOR_BITS = RGB_BYTES * BYTE_BITS;
const CRC_BITS = CHECKSUM_BYTES * BYTE_BITS;
/** A CBOR byte string of fewer than 24 bytes may also carry its length in a byte of its own. */
const CBOR_SHORT_LENGTH_LIMIT = 24;
/** The registered SSKR CBOR tag 40309, as the bytes that open a share in Bytewords. */
const SSKR_TAG_BYTES = [0xd9, 0x9d, 0x75] as const;
/** The SSKR tag 309 that earlier tools wrote. */
const SSKR_LEGACY_TAG_BYTES = [0xd9, 0x01, 0x35] as const;
/** CBOR major type 2, a byte string: its length in the low bits, or in the byte after 0x58. */
const CBOR_BYTE_STRING = 0x40;
const CBOR_BYTE_STRING_ONE_BYTE_LENGTH = 0x58;

/** An element filled in by a repair: its place, counted from 1, and what it is. */
export interface FilledElement {
  readonly position: number;
  readonly value: string;
}

export interface ReadRepairableShare {
  readonly ur: string;
  readonly format: ShareFormat;
  readonly repaired: boolean;
  /** The marked elements as the repair filled them in, in order. */
  readonly filled: readonly FilledElement[];
}

/**
 * Thrown when several shares fit the marked elements. The message names only their places: an
 * error may be shown where the screen is not private. The values are in `variants`, for the
 * caller to show where it shows secrets.
 */
export class ShareVariantsError extends Error {
  constructor(readonly variants: readonly ReadRepairableShare[]) {
    const places = variants[0]!.filled.map((element) => element.position).join(", ");
    super(
      `${variants.length} shares fit the marked elements ${places}. Use another copy of this share, or another share.`,
    );
  }
}

/**
 * One way the bytes of a share can be laid out (its secret length, CBOR header and tag), as
 * functions of its unit values, both affine over GF(2): the residual bits, zero exactly when the
 * share is well formed, and the SSKR payload, 5 metadata bytes and the share value.
 */
export interface ShareStructure {
  readonly payloadLength: number;
  readonly evaluate: (values: readonly number[]) => {
    readonly residual: bigint;
    readonly payload: Uint8Array;
  };
}

/**
 * A share read as units of one form: their values, undefined where marked, and the structures that
 * the unit count allows.
 */
interface UnitModel {
  readonly format: ShareFormat;
  readonly unitBits: number;
  readonly values: readonly (number | undefined)[];
  readonly structures: readonly ShareStructure[];
  readonly unitText: (value: number) => string;
  readonly text: (values: readonly number[]) => string;
  /** Rejects values that the written text rules out, such as a color code given half. */
  readonly fits?: (values: readonly number[]) => boolean;
}

/** Fields as one number of bits, the first field lowest: [value, width] pairs. */
function bitFields(fields: readonly (readonly [number, number])[]): bigint {
  let result = 0n;
  let shift = 0n;
  for (const [value, width] of fields) {
    result |= (BigInt(value) & ((1n << BigInt(width)) - 1n)) << shift;
    shift += BigInt(width);
  }
  return result;
}

function uint32At(bytes: readonly number[], at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  );
}

/**
 * A CBOR layout of a share: its payload length, its byte-string header in bytes, and the bytes of
 * its tag, if any.
 */
interface CborLayout {
  readonly payloadLength: number;
  readonly header: number;
  readonly tagBytes: readonly number[];
}

/** The SSKR tags that the reader accepts (transport.ts): 40309, and the earlier 309. */
const SSKR_TAGS: readonly (readonly number[])[] = [SSKR_TAG_BYTES, SSKR_LEGACY_TAG_BYTES];

/** Every CBOR layout: SSKR metadata and secret, a short or long header, each of `tags`. */
function cborLayouts(tags: readonly (readonly number[])[]): CborLayout[] {
  return [...SHARE_LENGTHS].flatMap((payloadLength) =>
    (payloadLength < CBOR_SHORT_LENGTH_LIMIT ? [1, 2] : [2]).flatMap((header) =>
      tags.map((tagBytes) => ({ payloadLength, header, tagBytes })),
    ),
  );
}

/** SSKR metadata: 2 identifier bytes, 2 bytes of thresholds and the group, then the member. */
export const METADATA_BYTES = 5;
/** The high nibble of the member byte is reserved and must be zero (sskr encoding.rs). */
const RESERVED_SHIFT = 4;

/**
 * Residual rows that every layout adds: the tag, the byte-string header for its payload length,
 * and the reserved nibble.
 */
function cborRows(cbor: ArrayLike<number>, layout: CborLayout): (readonly [number, number])[] {
  const { payloadLength, header, tagBytes } = layout;
  const tag = tagBytes.length;
  const headerBytes =
    header === 1
      ? [CBOR_BYTE_STRING + payloadLength]
      : [CBOR_BYTE_STRING_ONE_BYTE_LENGTH, payloadLength];
  return [
    ...tagBytes.map((byte, index) => [cbor[index]! ^ byte, BYTE_BITS] as const),
    ...headerBytes.map((byte, index) => [cbor[tag + index]! ^ byte, BYTE_BITS] as const),
    [cbor[tag + header + METADATA_BYTES - 1]! >>> RESERVED_SHIFT, BYTE_BITS - RESERVED_SHIFT],
  ];
}

function payloadOf(cbor: ArrayLike<number>, layout: CborLayout): Uint8Array {
  return Uint8Array.from(
    { length: layout.payloadLength },
    (_, index) => cbor[layout.tagBytes.length + layout.header + index]!,
  );
}

/** Bytes and the bits left over after the last whole byte, as written by one form. */
type Packed = { readonly bytes: readonly number[]; readonly leftover: readonly [number, number] };

/** Bytes from 11-bit word indexes (transport.ts, bytesToWordIndexes, in reverse). */
function wordBytes(values: readonly number[]): Packed {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const value of values) {
    buffer = (buffer << WORD_BITS) | value;
    bits += WORD_BITS;
    while (bits >= BYTE_BITS) {
      bits -= BYTE_BITS;
      bytes.push((buffer >>> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return { bytes, leftover: [buffer, bits] };
}

function colorBytes(values: readonly number[]): Packed {
  return {
    bytes: values.flatMap((color) => [(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff]),
    leftover: [0, 0],
  };
}

/**
 * Structures of a mixed share, in colors or words (transport.ts, mixShare), one per CBOR layout
 * whose length fits: the checksum against the unmixed CBOR, the version, the length, the filling
 * after the share, which must be zero, and the rows of the layout itself.
 */
function mixedStructures(
  version: number,
  fitsLength: (shareBytes: number) => boolean,
  toBytes: (values: readonly number[]) => Packed,
): ShareStructure[] {
  return cborLayouts([[], ...SSKR_TAGS]).flatMap((layout) => {
    const cborLength = layout.tagBytes.length + layout.header + layout.payloadLength;
    const end = CHECKSUM_BYTES + SHARE_HEADER_BYTES + cborLength;
    if (!fitsLength(end)) return [];
    return [
      {
        payloadLength: layout.payloadLength,
        evaluate: (values) => {
          const { bytes, leftover } = toBytes(values);
          const checksum = Uint8Array.from(bytes.slice(0, CHECKSUM_BYTES));
          const unmix = (index: number) =>
            bytes[CHECKSUM_BYTES + index]! ^ shareMask(checksum, index);
          const cbor = Uint8Array.from({ length: cborLength }, (_, index) =>
            unmix(SHARE_HEADER_BYTES + index),
          );
          return {
            residual: bitFields([
              [crc32(cbor) ^ uint32At(bytes, 0), CRC_BITS],
              [unmix(0) ^ version, BYTE_BITS],
              [unmix(1) ^ cborLength, BYTE_BITS],
              ...bytes.slice(end).map((byte) => [byte, BYTE_BITS] as const),
              leftover,
              ...cborRows(cbor, layout),
            ]),
            payload: payloadOf(cbor, layout),
          };
        },
      },
    ];
  });
}

/**
 * Structures of a standard share, in Bytewords (tagged) or as a UR (untagged): the checksum against
 * the bytes before it, and the rows of the layout that this length takes.
 */
function standardStructures(units: number, tagged: boolean): ShareStructure[] {
  const tags = tagged ? SSKR_TAGS : [[]];
  const content = units - CHECKSUM_BYTES - (tagged ? SSKR_TAG_BYTES.length : 0);
  const layouts: CborLayout[] = tags.flatMap((tagBytes) => [
    { payloadLength: content - 2, header: 2, tagBytes },
    ...(content - 1 < CBOR_SHORT_LENGTH_LIMIT
      ? [{ payloadLength: content - 1, header: 1, tagBytes }]
      : []),
  ]);
  return layouts
    .filter((layout) => SHARE_LENGTHS.has(layout.payloadLength))
    .map((layout) => ({
      payloadLength: layout.payloadLength,
      evaluate: (values) => {
        const cbor = values.slice(0, units - CHECKSUM_BYTES);
        return {
          residual: bitFields([
            [crc32(Uint8Array.from(cbor)) ^ uint32At(values, units - CHECKSUM_BYTES), CRC_BITS],
            ...cborRows(cbor, layout),
          ]),
          payload: payloadOf(cbor, layout),
        };
      },
    }));
}

/** Splits text into units of one pattern, with ? for an unreadable unit, or undefined. */
function unitsOf(text: string, unit: RegExp): string[] | undefined {
  const units = text.match(new RegExp(`${unit.source}|\\?`, "giu"));
  if (units === null || units.join("") !== text || units.length > MAX_REPAIR_UNITS)
    return undefined;
  return units;
}

const MINIMAL_BYTEWORDS = bytewords.map((word) => word[0]! + word[3]!);
const MINIMAL_BYTEWORD_VALUES = new Map(MINIMAL_BYTEWORDS.map((pair, value) => [pair, value]));
const BYTEWORD_VALUES = new Map<string, number>(bytewords.map((word, value) => [word, value]));
const UNICODE_CODES = traditionalChineseWordlist.map(unicodeHex);
const hexColor = (value: number) => `#${value.toString(16).toUpperCase().padStart(6, "0")}`;

/** Adds a model when every unit that is not marked has a value. */
function addModel(
  models: UnitModel[],
  units: readonly string[] | undefined,
  valueOf: (unit: string) => number | undefined,
  model: Omit<UnitModel, "values" | "text"> & { readonly separator: string },
): void {
  if (units === undefined) return;
  const values = units.map((unit) => (unit === "?" ? undefined : valueOf(unit)));
  if (values.some((value, index) => value === undefined && units[index] !== "?")) return;
  models.push({
    ...model,
    values,
    text: (filled) => filled.map(model.unitText).join(model.separator),
  });
}

/** Every way that `text` can be read as a share in one form, with marked elements. */
function unitModels(text: string): UnitModel[] {
  const models: UnitModel[] = [];
  if (/^ur:sskr\//iu.test(text)) {
    const units = unitsOf(text.slice("ur:sskr/".length).toLowerCase(), /[a-z]{2}/);
    addModel(models, units, (unit) => MINIMAL_BYTEWORD_VALUES.get(unit), {
      format: "ur",
      unitBits: BYTE_BITS,
      structures: units === undefined ? [] : standardStructures(units.length, false),
      unitText: (value) => MINIMAL_BYTEWORDS[value]!,
      separator: "",
    });
    // A UR keeps "ur:sskr/" in front.
    const model = models.pop();
    if (model !== undefined)
      models.push({ ...model, text: (filled) => `ur:sskr/${filled.map(model.unitText).join("")}` });
    return models;
  }
  const numbers = text.split(/[\s,]+/u).filter(Boolean);
  if (numbers.every((unit) => unit === "?" || /^\d{1,4}$/u.test(unit)))
    addModel(
      models,
      numbers,
      (unit) => (Number(unit) >= 1 && Number(unit) <= WORD_COUNT ? Number(unit) - 1 : undefined),
      {
        format: "indexes",
        unitBits: WORD_BITS,
        structures: wordStructures(numbers.length),
        unitText: (value) => String(value + 1),
        separator: " ",
      },
    );
  const words = text
    .toLowerCase()
    .split(/[\s-]+/u)
    .filter(Boolean);
  if (words.every((unit) => unit === "?" || /^[a-z]{4}$/u.test(unit)))
    addModel(models, words, (unit) => BYTEWORD_VALUES.get(unit), {
      format: "words",
      unitBits: BYTE_BITS,
      structures: standardStructures(words.length, true),
      unitText: (value) => bytewords[value]!,
      separator: " ",
    });
  const compact = text.replace(/[\s,;]+/gu, "").toUpperCase();
  const codes = unitsOf(compact, /[0-9A-F]{4}/);
  addModel(models, codes, (unit) => UNICODE_INDEX.get(unit), {
    format: "unicode",
    unitBits: WORD_BITS,
    structures: codes === undefined ? [] : wordStructures(codes.length),
    unitText: (value) => UNICODE_CODES[value]!,
    separator: " ",
  });
  const colors = unitsOf(compact.replace(/#/gu, ""), /[0-9A-F]{6}/);
  addModel(models, colors, (unit) => parseInt(unit, 16), {
    format: "colors",
    unitBits: COLOR_BITS,
    structures: colors === undefined ? [] : colorStructures(colors.length),
    unitText: hexColor,
    separator: " ",
  });
  addColorUnicodeModels(models, text, compact);
  return models;
}

function wordStructures(units: number): ShareStructure[] {
  return mixedStructures(
    WORD_VERSION,
    (bytes) => Math.ceil((bytes * BYTE_BITS) / WORD_BITS) === units,
    wordBytes,
  );
}

function colorStructures(units: number): ShareStructure[] {
  return mixedStructures(
    COLOR_VERSION,
    (bytes) => Math.ceil(bytes / RGB_BYTES) === units,
    colorBytes,
  );
}

/**
 * Colors written as Unicode codes, two per color: a mark may stand for one of the two codes or for
 * the whole color, and both readings are tried. A color with a mark is unknown as a whole; one with
 * one code given keeps that code (`fits`).
 */
function addColorUnicodeModels(models: UnitModel[], text: string, compact: string): void {
  const symbols = Array.from(text.replace(/\s+/gu, ""));
  const scalars = symbols.every((symbol) => symbol === "?" || /^[-]$/u.test(symbol))
    ? symbols.map((symbol) =>
        symbol === "?" ? "?" : symbol.codePointAt(0)!.toString(16).toUpperCase(),
      )
    : unitsOf(compact, /[0-9A-F]{4}/);
  if (scalars === undefined) return;
  const inRange = (code: string) => {
    const point = parseInt(code, 16);
    return point >= COLOR_UNICODE_BASE && point < COLOR_UNICODE_BASE + COLOR_UNICODE_WIDTH;
  };
  if (!scalars.every((code) => code === "?" || inRange(code))) return;
  const colorText = (value: number) => colorsToUnicode([hexColor(value)]);
  for (const wholeColor of [false, true]) {
    const expanded = scalars.flatMap((code) => (code === "?" && wholeColor ? ["?", "?"] : [code]));
    if (expanded.length % 2 !== 0) continue;
    const pairs = Array.from({ length: expanded.length / 2 }, (_, index) =>
      expanded.slice(index * 2, index * 2 + 2),
    );
    // Paired the wrong way, two codes may not make a color at all: that reading is not the one.
    let values: (number | undefined)[];
    try {
      values = pairs.map((pair) =>
        pair.includes("?")
          ? undefined
          : parseInt(unicodeToColorCodes(pair.join(""))[0]!.slice(1), 16),
      );
    } catch {
      continue;
    }
    models.push({
      format: "colors-unicode",
      unitBits: COLOR_BITS,
      values,
      structures: colorStructures(pairs.length),
      unitText: colorText,
      text: (filled) => filled.map(colorText).join(""),
      fits: (filled) =>
        pairs.every((pair, index) => {
          const written = colorText(filled[index]!).match(/.{4}/gu)!;
          return pair.every((code, half) => code === "?" || code === written[half]);
        }),
    });
  }
}

/**
 * One way to read a marked text: a form with its unit values, undefined where marked, and one
 * structure. joint-repair.ts solves several cards together from these.
 */
export interface MarkedReading {
  readonly format: ShareFormat;
  readonly unitBits: number;
  readonly values: readonly (number | undefined)[];
  readonly structure: ShareStructure;
  readonly unitText: (value: number) => string;
  readonly text: (values: readonly number[]) => string;
  readonly fits?: (values: readonly number[]) => boolean;
}

/** Every reading of `text`: each form it can be in, with each structure its length allows. */
export function markedReadings(text: string): MarkedReading[] {
  return unitModels(text).flatMap((model) =>
    model.structures.map((structure) => ({
      format: model.format,
      unitBits: model.unitBits,
      values: model.values,
      structure,
      unitText: model.unitText,
      text: model.text,
      ...(model.fits === undefined ? {} : { fits: model.fits }),
    })),
  );
}

/**
 * The solutions of one reading on its own, as an affine space over the bits of its marked units
 * (bit b of the k-th mark is bit k * unitBits + b): one solution, the basis of the rest, and the
 * payload at that solution with the change each basis vector makes to it.
 */
export interface ReadingSpace {
  readonly reading: MarkedReading;
  readonly unknownBits: number;
  readonly rank: number;
  readonly particular: bigint;
  readonly basis: readonly bigint[];
  readonly payload: Uint8Array;
  readonly payloadDeltas: readonly Uint8Array[];
  readonly valuesAt: (bits: bigint) => number[];
}

/** Solves one reading on its own; undefined when no values fit it. */
export function readingSpace(reading: MarkedReading): ReadingSpace | undefined {
  const holes = reading.values.flatMap((value, index) => (value === undefined ? [index] : []));
  const mask = (1n << BigInt(reading.unitBits)) - 1n;
  const valuesAt = (bits: bigint): number[] => {
    const values = reading.values.map((value) => value ?? 0);
    holes.forEach((hole, order) => {
      values[hole] = Number((bits >> BigInt(order * reading.unitBits)) & mask);
    });
    return values;
  };
  const at = (bits: bigint) => reading.structure.evaluate(valuesAt(bits));
  const baseline = at(0n);
  // The residual is affine in the missing bits: one column per bit, from flipping it alone.
  const unknownBits = holes.length * reading.unitBits;
  const columns = Array.from(
    { length: unknownBits },
    (_, bit) => at(1n << BigInt(bit)).residual ^ baseline.residual,
  );
  const solved = solve(columns, baseline.residual);
  if (solved === undefined) return undefined;
  const payload = at(solved.particular).payload;
  const payloadDeltas = solved.free.map((direction) =>
    at(solved.particular ^ direction).payload.map((byte, index) => byte ^ payload[index]!),
  );
  return {
    reading,
    unknownBits,
    rank: solved.rank,
    particular: solved.particular,
    basis: solved.free,
    payload,
    payloadDeltas,
    valuesAt,
  };
}

/**
 * The unit values of every solution of `reading` on its own; `tooMany` when there are more than
 * 2^freeBits of them, which are then not listed.
 */
function solutions(
  reading: MarkedReading,
  freeBits: number,
): { readonly found: number[][]; readonly tooMany: boolean } {
  const space = readingSpace(reading);
  if (space === undefined) return { found: [], tooMany: false };
  if (space.basis.length > freeBits) return { found: [], tooMany: true };
  const found: number[][] = [];
  for (let choice = 0; choice < 1 << space.basis.length; choice += 1) {
    let bits = space.particular;
    space.basis.forEach((direction, index) => {
      if (choice & (1 << index)) bits ^= direction;
    });
    found.push(space.valuesAt(bits));
  }
  return { found, tooMany: false };
}

/**
 * Every share that `value` can be, in any form, with up to MAX_MARKED_ELEMENTS elements marked with
 * ? where they are unreadable; at most 2^freeBits of them. Every candidate passes the ordinary
 * reader, so its checksum and its SSKR metadata are checked as for any share.
 */
export function repairCandidates(
  value: string,
  freeBits: number = LISTED_FREE_BITS,
): ReadRepairableShare[] {
  if (!value.includes("?")) return [{ ...readShare(value), repaired: false, filled: [] }];
  const text = value.trim();
  const marks = text.match(/\?/gu)!.length;
  if (text.length > MAX_REPAIR_TEXT_LENGTH || marks > MAX_MARKED_ELEMENTS)
    throw new Error(
      `Mark at most ${MAX_MARKED_ELEMENTS} unreadable elements with ?, each at its place.`,
    );
  const found = new Map<string, ReadRepairableShare>();
  let tooMany = false;
  for (const model of markedReadings(text)) {
    const solved = solutions(model, freeBits);
    tooMany ||= solved.tooMany;
    for (const values of solved.found) {
      if (model.fits !== undefined && !model.fits(values)) continue;
      let read;
      try {
        read = readShare(model.text(values));
      } catch {
        continue;
      }
      if (read.format !== model.format) continue;
      const filled = model.values.flatMap((known, index) =>
        known === undefined ? [{ position: index + 1, value: model.unitText(values[index]!) }] : [],
      );
      found.set(read.ur, { ur: read.ur, format: read.format, repaired: true, filled });
    }
  }
  if (found.size === 0)
    throw new Error(
      tooMany
        ? "Too many elements are marked for this form: the checksum cannot tell them. Mark fewer, or use another share."
        : "No valid share fits the marked elements. Check their places and the other elements.",
    );
  return [...found.values()];
}

/** The one share that `value` can be; several are listed as variants (ShareVariantsError). */
export function readRepairableShare(value: string): ReadRepairableShare {
  const candidates = repairCandidates(value);
  if (candidates.length > 1) throw new ShareVariantsError(candidates);
  return candidates[0]!;
}
