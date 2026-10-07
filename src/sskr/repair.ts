// Repairs a share with up to six unreadable elements, each marked with ? at its place: a word
// number, a Unicode code, a color, a Byteword or a pair of letters of a UR. Every form keeps a
// CRC32 checksum, and the mixed forms a version and a length byte (transport.ts), and all of these
// are affine over GF(2) in the bits of the share: the mixing XORs each byte with a CRC32 of the
// checksum, and CRC32 itself is affine. So the missing bits are the solutions of a system of linear
// equations, found by elimination instead of by trying every value, which for three colors would
// be 2^72 tries. Each solution is then read as an ordinary share, which checks everything again.
// More solutions than one are listed as variants, never chosen silently; unmarked errors are never
// repaired.
//
// An element may also be read in part, a ? standing for each digit that cannot be read: a color
// such as #B5?0??, whose digits are bits, adds the bits read as equations of their own. A Unicode
// code such as 4E?0, whose digits are not bits of its word number, is unknown as a whole, and the
// words whose code fits are its candidates: a solution must be one of them (fits), and where that
// shortens the search they are tried one by one, each as the code's bits (withValues).

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
/** Hexadecimal digits of a color, #RRGGBB, and of a Unicode code of a word. */
const COLOR_DIGITS = 6;
const CODE_DIGITS = 4;
const NIBBLE_BITS = 4;
/**
 * The most ? a text may hold: a ? for each digit of every color that a share may mark
 * (MAX_MARKED_ELEMENTS colors), so that marking digits one by one costs no element.
 */
const MAX_MARK_SYMBOLS = MAX_MARKED_ELEMENTS * COLOR_DIGITS;
/**
 * Readings that one share alone is tried in, one for each choice of words for its partly read
 * Unicode codes (choicesWithin), when the checksum alone leaves too many solutions.
 */
export const MAX_CODE_CHOICES = 256;
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
  /** For each marked unit read in part, the bits that were read (ReadBits). */
  readonly readBits?: readonly (ReadBits | undefined)[];
  /** For each partly read unit whose digits are no bits of it, the values that fit them. */
  readonly candidates?: readonly (readonly number[] | undefined)[];
}

/**
 * The bits of a marked unit that were read, `mask` set where `value` holds them: the digits of a
 * color that could be read, or every bit of the one word that a reading takes for a partly read
 * Unicode code.
 */
export interface ReadBits {
  readonly value: number;
  readonly mask: number;
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
 * Structures of a standard share, in Bytewords or as a UR: the checksum against the bytes before
 * it, and the rows of the layout that this length takes. Either form may carry the SSKR tag, 40309
 * or the earlier 309, or none, since transport.ts reads all of them (AUD-008-API006).
 */
function standardStructures(units: number): ShareStructure[] {
  const layouts: CborLayout[] = [[], ...SSKR_TAGS].flatMap((tagBytes) => {
    const content = units - CHECKSUM_BYTES - tagBytes.length;
    return [
      { payloadLength: content - 2, header: 2, tagBytes },
      ...(content - 1 < CBOR_SHORT_LENGTH_LIMIT
        ? [{ payloadLength: content - 1, header: 1, tagBytes }]
        : []),
    ];
  });
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

/**
 * Hexadecimal codes of `digits` digits written apart, such as colors or Unicode codes: each a lone
 * ? where none of its digits can be read, or `digits` symbols in which each ? is one digit that
 * cannot be read. Undefined when the text is not written so; a ? then stands for a whole unit.
 */
function separatedCodes(text: string, digits: number): string[] | undefined {
  const tokens = text
    .toUpperCase()
    .split(/[\s,;#]+/u)
    .filter(Boolean);
  const code = new RegExp(`^(?:\\?|[0-9A-F?]{${digits}})$`, "u");
  if (tokens.length === 0 || tokens.length > MAX_REPAIR_UNITS) return undefined;
  if (!tokens.every((token) => code.test(token))) return undefined;
  // Every digit marked is the same as the code marked as a whole.
  return tokens.map((token) => (/^\?+$/u.test(token) ? "?" : token));
}

/** Whether `code` has digits that can be read and digits that cannot. */
function readInPart(code: string): boolean {
  return code !== "?" && code.includes("?");
}

/** The digits of `code` that can be read, as ReadBits; each digit is four bits, the first highest. */
function digitBits(code: string): ReadBits {
  let value = 0;
  let mask = 0;
  for (const digit of code) {
    value = value * 2 ** NIBBLE_BITS + (digit === "?" ? 0 : parseInt(digit, 16));
    mask = mask * 2 ** NIBBLE_BITS + (digit === "?" ? 0 : 2 ** NIBBLE_BITS - 1);
  }
  return { value, mask };
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
      structures: units === undefined ? [] : standardStructures(units.length),
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
      structures: standardStructures(words.length),
      unitText: (value) => bytewords[value]!,
      separator: " ",
    });
  const compact = text.replace(/[\s,;]+/gu, "").toUpperCase();
  addUnicodeModel(models, text, compact);
  addColorModel(models, text, compact);
  addColorUnicodeModels(models, text, compact);
  return models;
}

/**
 * Unicode codes of words, read apart or run together. A code read in part, such as 4E?0, is
 * unknown as a whole; the words whose code fits it are its candidates, and a solution must take
 * one of them. A code that no word fits leaves no reading in this form.
 */
function addUnicodeModel(models: UnitModel[], text: string, compact: string): void {
  const codes = separatedCodes(text, CODE_DIGITS) ?? unitsOf(compact, /[0-9A-F]{4}/);
  if (codes === undefined) return;
  const values = codes.map((code) => (code.includes("?") ? undefined : UNICODE_INDEX.get(code)));
  if (values.some((value, index) => value === undefined && !codes[index]!.includes("?"))) return;
  const candidates = codes.map((code) => (readInPart(code) ? fittingWords(code) : undefined));
  if (candidates.some((words) => words?.length === 0)) return;
  const fitting = candidates.map((words) => (words === undefined ? undefined : new Set(words)));
  models.push({
    format: "unicode",
    unitBits: WORD_BITS,
    values,
    structures: wordStructures(codes.length),
    unitText: (value) => UNICODE_CODES[value]!,
    text: (filled) => filled.map((value) => UNICODE_CODES[value]!).join(" "),
    ...(candidates.some((words) => words !== undefined)
      ? {
          candidates,
          fits: (filled: readonly number[]) =>
            fitting.every((words, place) => words?.has(filled[place]!) ?? true),
        }
      : {}),
  });
}

/** The words of the list whose Unicode code fits `code`, any digit standing where it has a ?. */
function fittingWords(code: string): number[] {
  const pattern = new RegExp(`^${code.replace(/\?/gu, "[0-9A-F]")}$`, "u");
  return UNICODE_CODES.flatMap((written, index) => (pattern.test(written) ? [index] : []));
}

/**
 * Colors written apart, each a lone ? when it cannot be read at all, or with a ? for each digit
 * that cannot be read, whose digits read are then known bits; or colors run together, a ? standing
 * for a whole color.
 */
function addColorModel(models: UnitModel[], text: string, compact: string): void {
  const colors =
    separatedCodes(text, COLOR_DIGITS) ?? unitsOf(compact.replace(/#/gu, ""), /[0-9A-F]{6}/);
  if (colors === undefined) return;
  const partly = colors.some(readInPart);
  models.push({
    format: "colors",
    unitBits: COLOR_BITS,
    values: colors.map((color) => (color.includes("?") ? undefined : parseInt(color, 16))),
    structures: colorStructures(colors.length),
    unitText: hexColor,
    text: (filled) => filled.map(hexColor).join(" "),
    ...(partly
      ? { readBits: colors.map((color) => (readInPart(color) ? digitBits(color) : undefined)) }
      : {}),
  });
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
  /** For each marked unit read in part, the bits that were read; they are equations too. */
  readonly readBits?: readonly (ReadBits | undefined)[];
  /**
   * For each partly read unit whose digits are no bits of it, such as a Unicode code, the values
   * that fit the digits read: a solution takes one of them (fits), and withValues tries them.
   */
  readonly candidates?: readonly (readonly number[] | undefined)[];
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
      ...(model.readBits === undefined ? {} : { readBits: model.readBits }),
      ...(model.candidates === undefined ? {} : { candidates: model.candidates }),
    })),
  );
}

/**
 * `reading` with the units at the places of `chosen` taken as the values given, each one of its
 * candidates: all their bits become equations, and they are still reported as filled in.
 */
export function withValues(
  reading: MarkedReading,
  chosen: ReadonlyMap<number, number>,
): MarkedReading {
  const mask = 2 ** reading.unitBits - 1;
  const readBits = reading.values.map((_, place) => {
    const value = chosen.get(place);
    return value === undefined ? reading.readBits?.[place] : { value, mask };
  });
  return { ...reading, readBits };
}

/**
 * The candidate units to try value by value, in the order given, as many as keep the product of
 * their counts within `limit`; the others stay unknown as a whole.
 */
export function placesWithin<Unit extends { readonly count: number }>(
  units: readonly Unit[],
  limit: number,
): Unit[] {
  const chosen: Unit[] = [];
  let product = 1;
  for (const unit of units) {
    // Compared before multiplying, so that the product stays a whole number within the limit.
    if (unit.count > Math.floor(limit / product)) continue;
    product *= unit.count;
    chosen.push(unit);
  }
  return chosen;
}

/**
 * Whether the bits of the marked unit at `place` reach the SSKR metadata of the share, its first
 * METADATA_BYTES payload bytes: the identifier and the thresholds, which all shares of a set
 * carry, and the member number. Units that reach it tell the shares apart, and settle the most.
 */
export function reachesMetadata(reading: MarkedReading, place: number): boolean {
  const values = reading.values.map((value) => value ?? 0);
  const before = reading.structure.evaluate(values).payload;
  for (let bit = 0; bit < reading.unitBits; bit += 1) {
    const flipped = [...values];
    flipped[place] = values[place]! ^ (1 << bit);
    const after = reading.structure.evaluate(flipped).payload;
    for (let byte = 0; byte < METADATA_BYTES; byte += 1)
      if (after[byte] !== before[byte]) return true;
  }
  return false;
}

/**
 * Every reading of `reading` with the candidate units at `places` taken value by value
 * (withValues): one for each combination of their values.
 */
export function choicesAt(reading: MarkedReading, places: readonly number[]): MarkedReading[] {
  // Another reading of the share, such as another form, may have no candidates at these places.
  const tried = places.filter((place) => reading.candidates?.[place] !== undefined);
  if (tried.length === 0) return [reading];
  let all: Map<number, number>[] = [new Map()];
  for (const place of tried)
    all = all.flatMap((chosen) =>
      reading.candidates![place]!.map((value) => new Map(chosen).set(place, value)),
    );
  return all.map((chosen) => withValues(reading, chosen));
}

/** The candidate units of `reading`: each with its place and its number of values. */
export function candidateCounts(
  reading: MarkedReading,
): { readonly place: number; readonly count: number }[] {
  return (reading.candidates ?? []).flatMap((values, place) =>
    values === undefined ? [] : [{ place, count: values.length }],
  );
}

/**
 * The marked elements of `text`, as written: each ?, except that a code of four or six symbols
 * with ? among its digits, such as #B5?0?? or 4E?0, is one element however many digits it
 * misses. A run of ? alone counts each ?, as each may stand for a whole element.
 */
export function markCount(text: string): number {
  return text
    .split(/[\s,;#]+/u)
    .filter(Boolean)
    .reduce((marks, token) => {
      const symbols = (token.match(/\?/gu) ?? []).length;
      const code = token.length === CODE_DIGITS || token.length === COLOR_DIGITS;
      const partly = code && symbols > 0 && symbols < token.length && /^[0-9A-F?]+$/iu.test(token);
      return marks + (partly ? 1 : symbols);
    }, 0);
}

/** Code points of the Color Unicode codes (core/colors.ts), which take a ? only for a whole code. */
const COLOR_UNICODE_CODE = (token: string): boolean => {
  if (!/^[0-9A-F]{4}$/u.test(token)) return false;
  const point = parseInt(token, 16);
  return point >= COLOR_UNICODE_BASE && point < COLOR_UNICODE_BASE + COLOR_UNICODE_WIDTH;
};

/**
 * The forms written as codes apart, as markProblem tells them by the codes that can be read:
 * colors and the Unicode codes of words take a ? for a digit; Color Unicode codes and word numbers
 * only for a whole code.
 */
const CODE_FORMS: readonly {
  readonly name: string;
  readonly plural: string;
  /** The symbols of a code, where a ? may stand for one of them. */
  readonly digits?: number;
  readonly reads: (token: string) => boolean;
}[] = [
  {
    name: "color",
    plural: "colors",
    digits: COLOR_DIGITS,
    reads: (token) => /^[0-9A-F]{6}$/u.test(token),
  },
  {
    name: "code",
    plural: "Unicode codes",
    digits: CODE_DIGITS,
    reads: (token) => UNICODE_INDEX.has(token),
  },
  { name: "code", plural: "Color Unicode codes", reads: COLOR_UNICODE_CODE },
  {
    name: "word number",
    plural: "word numbers",
    reads: (token) => /^\d{1,4}$/u.test(token) && Number(token) >= 1 && Number(token) <= WORD_COUNT,
  },
];

/**
 * Why a code with a ? among its symbols cannot be read, in words that follow "Share 2: ", when the
 * text is codes written apart of one form (CODE_FORMS): in a color or a Unicode code it must keep
 * all its symbols, a ? for each digit that cannot be read; the other forms take only a lone ? for
 * a whole code. A ? joined to a whole code, as in ?4E00, is read as before and not named. It names
 * the code by its place only: the text may be shown where the screen is not private.
 */
export function markProblem(text: string): string | undefined {
  const tokens = text
    .toUpperCase()
    .split(/[\s,;#]+/u)
    .filter(Boolean);
  const read = tokens.filter((token) => !token.includes("?"));
  if (read.length === 0) return undefined;
  const form = CODE_FORMS.find((candidate) => read.every(candidate.reads));
  if (form === undefined) return undefined;
  for (const [index, token] of tokens.entries()) {
    if (!token.includes("?") || /^\?+$/u.test(token)) continue;
    const name = `${form.name} ${index + 1}`;
    if (form.digits === undefined)
      return `${name} has a ? among its digits: ${form.plural} take only a lone ? for a whole ${form.name}.`;
    // Longer than a code: a whole mark joined to a code, which the joined reading takes.
    if (token.length < form.digits)
      return `${name} has ${token.length} of ${form.digits} symbols: write a ? for each digit that cannot be read, or a lone ? for the whole ${form.name}.`;
  }
  return undefined;
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
  const unknownBits = holes.length * reading.unitBits;
  const at = (bits: bigint) => {
    const values = valuesAt(bits);
    const evaluated = reading.structure.evaluate(values);
    const { readBits } = reading;
    if (readBits === undefined) return evaluated;
    // The bits read of a partly read unit are equations too: each keeps the value it was read as.
    const read = bitFields(
      holes.map((hole) => {
        const bitsRead = readBits[hole];
        const change =
          bitsRead === undefined ? 0 : (values[hole]! ^ bitsRead.value) & bitsRead.mask;
        return [change, reading.unitBits] as const;
      }),
    );
    return { ...evaluated, residual: (evaluated.residual << BigInt(unknownBits)) | read };
  };
  const baseline = at(0n);
  // The residual is affine in the missing bits: one column per bit, from flipping it alone.
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
 * `reading` as one share alone is solved: as it is, or, when the checksum leaves more than
 * 2^freeBits solutions and it has candidate units, once for each choice of their values within
 * MAX_CODE_CHOICES (placesWithin, choicesAt).
 */
function triedReadings(reading: MarkedReading, freeBits: number): MarkedReading[] {
  const counts = candidateCounts(reading);
  if (counts.length === 0) return [reading];
  const space = readingSpace(reading);
  if (space === undefined || space.basis.length <= freeBits) return [reading];
  // The units with the fewest values first: each gains the most bits for its choices.
  const fewestFirst = [...counts].sort((a, b) => a.count - b.count);
  return choicesAt(
    reading,
    placesWithin(fewestFirst, MAX_CODE_CHOICES).map((unit) => unit.place),
  );
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
  const symbols = text.match(/\?/gu)!.length;
  if (
    text.length > MAX_REPAIR_TEXT_LENGTH ||
    symbols > MAX_MARK_SYMBOLS ||
    markCount(text) > MAX_MARKED_ELEMENTS
  )
    throw new Error(
      `Mark at most ${MAX_MARKED_ELEMENTS} unreadable elements with ?, each at its place.`,
    );
  const problem = markProblem(text);
  if (problem !== undefined)
    throw new Error(`${problem.charAt(0).toUpperCase()}${problem.slice(1)}`);
  const found = new Map<string, ReadRepairableShare>();
  let tooMany = false;
  for (const model of markedReadings(text).flatMap((reading) => triedReadings(reading, freeBits))) {
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
