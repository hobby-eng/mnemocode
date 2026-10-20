// What the share tests make of a share: a copy with a wrong value whose checksum still holds, and
// its units as a form writes them, some marked with ? as unreadable. One copy for every test file,
// so that each damages a share the same way. Public test data only: the shares come from the tests.

import type { RepairedSet } from "../../src/sskr/joint-results.js";
import { MINIMAL_BYTEWORD_LETTERS } from "../../src/sskr/bytewords-list.js";
import { unrepairedShare } from "../../src/sskr/repair.js";
import { splitSskrMnemonic } from "../../src/sskr/shares.js";
import { crc32 } from "../../src/sskr/checksum.js";
import {
  CHECKSUM_BYTES,
  transportToUr,
  UR_SSKR_PREFIX,
  urToTransport,
  writeShare,
  type ShareFormat,
} from "../../src/sskr/transport.js";
import {
  COLOR_UNICODE_CODE_POINT_DIGITS,
  COLOR_UNICODE_POINTS_PER_COLOR,
} from "../../src/core/colors.js";
import { TEST_PHRASE } from "./test-phrase.js";

/** A byte of the share value: the header, identifier and member numbers come before it. */
export const VALUE_BYTE = 10;

/** `share` with one value byte flipped and its CRC-32 written anew: valid, but wrong. */
export function wrongValue(share: string): string {
  const transport = urToTransport(share);
  transport[VALUE_BYTE]! ^= 1;
  new DataView(transport.buffer, transport.byteOffset, transport.byteLength).setUint32(
    transport.length - CHECKSUM_BYTES,
    crc32(transport.slice(0, -CHECKSUM_BYTES)),
  );
  return transportToUr(transport);
}

/** The letters of one byte in a UR: a minimal Byteword (BCR-2020-012). */
const UR_BYTE = new RegExp(`.{${MINIMAL_BYTEWORD_LETTERS}}`, "gu");
/** One code point of Color Unicode, as its hexadecimal digits. */
const COLOR_UNICODE_CODE = new RegExp(`.{${COLOR_UNICODE_CODE_POINT_DIGITS}}`, "gu");
/** One color of Color Unicode: its code points together. */
const COLOR_UNICODE_COLOR = new RegExp(
  `.{${COLOR_UNICODE_CODE_POINT_DIGITS * COLOR_UNICODE_POINTS_PER_COLOR}}`,
  "gu",
);

/**
 * How a share in Color Unicode is cut: into its code points, one of which a mark may stand for,
 * or into its colors, the units that SHARE_UNITS reads. The repair accepts a mark of either.
 */
export type ColorUnicodeCut = "codes" | "colors";

/** The units of `share` as `format` writes them, each as written. */
export function shareUnits(
  share: string,
  format: ShareFormat,
  cut: ColorUnicodeCut = "codes",
): string[] {
  const text = writeShare(share, format);
  if (format === "ur") return text.slice(UR_SSKR_PREFIX.length).match(UR_BYTE)!;
  if (format === "colors-unicode")
    return text.match(cut === "codes" ? COLOR_UNICODE_CODE : COLOR_UNICODE_COLOR)!;
  return text.split(" ");
}

/** The text of a share in `format` made of `units`, joined as the form writes them. */
export function joinUnits(units: readonly string[], format: ShareFormat): string {
  if (format === "ur") return UR_SSKR_PREFIX + units.join("");
  if (format === "colors-unicode") return units.join("");
  return units.join(" ");
}

/** `share` in `format` with the units at `places` marked with ?. */
export function markUnits(
  share: string,
  format: ShareFormat,
  places: readonly number[],
  cut: ColorUnicodeCut = "codes",
): string {
  const units = shareUnits(share, format, cut);
  for (const place of places) units[place] = "?";
  return joinUnits(units, format);
}

/**
 * `share` in `format` with ? at some digits of some elements: for each place of `marks`, the
 * digits it lists, counted from 0 after any #.
 */
export function markDigits(
  share: string,
  format: ShareFormat,
  marks: Readonly<Record<number, readonly number[]>>,
): string {
  const units = shareUnits(share, format);
  for (const [place, digits] of Object.entries(marks)) {
    const unit = units[Number(place)]!;
    const prefix = unit.startsWith("#") ? "#" : "";
    const symbols = Array.from(unit.slice(prefix.length));
    for (const digit of digits) symbols[digit] = "?";
    units[Number(place)] = prefix + symbols.join("");
  }
  return joinUnits(units, format);
}

/**
 * Two shares of a new 2-of-3 split of TEST_PHRASE, read as typed: a second set beside another,
 * where a test needs two sets that fit.
 */
export async function testPhraseSet(): Promise<RepairedSet> {
  const shares = (await splitSskrMnemonic(TEST_PHRASE, 2, 3)).slice(0, 2);
  return { mnemonic: TEST_PHRASE, shares: shares.map(unrepairedShare), unsettled: [] };
}
