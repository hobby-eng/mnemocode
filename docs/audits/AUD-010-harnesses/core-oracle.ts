// AUD-010 core probes: independent oracles shared by core-representations.ts and
// core-missing-codes.ts. Nothing here imports MnemoCode code: only @scure/bip39, its English and
// Traditional Chinese word lists, and @noble/hashes. The packings follow README "Formats":
//   indexes        - the 1-based number of each word (Seedshift numbering);
//   unicode        - the four-digit code of the Traditional Chinese BIP39 word at the same number;
//   colors         - BIP39Colors: four decimal digits per 1-based word number, six digits per
//                    color behind a decimal order tag (position, doubled for 12 words), as hex;
//   colors-unicode - each color value v as two Private Use code points E000 + floor(v / 0x1900)
//                    and E000 + v mod 0x1900, four hex digits each.

import { sha256 } from "@noble/hashes/sha2.js";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { wordlist as chinese } from "@scure/bip39/wordlists/traditional-chinese.js";

export const LENGTHS = [12, 15, 18, 21, 24] as const;
export type Format = "english" | "indexes" | "unicode" | "colors" | "colors-unicode";
export const FORMATS: readonly Format[] = [
  "english",
  "indexes",
  "unicode",
  "colors",
  "colors-unicode",
];

export const englishWords = english;

export function oracleUnicode(index: number): string {
  return chinese[index]!.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
}

export function oracleColors(indexes: readonly number[]): string[] {
  const digits = indexes.map((index) => String(index + 1).padStart(4, "0")).join("");
  const colors: string[] = [];
  for (let position = 0; position * 6 < digits.length; position += 1) {
    const tag = indexes.length === 12 ? position * 2 : position;
    const value = Number(`${tag}${digits.slice(position * 6, position * 6 + 6)}`);
    colors.push(`#${value.toString(16).toUpperCase().padStart(6, "0")}`);
  }
  return colors;
}

export function oracleColorUnicode(colors: readonly string[]): string[] {
  return colors.flatMap((color) => {
    const value = Number.parseInt(color.slice(1), 16);
    return [0xe000 + Math.floor(value / 0x1900), 0xe000 + (value % 0x1900)].map((point) =>
      point.toString(16).toUpperCase(),
    );
  });
}

/** The text of `indexes` in `format`, as elements (words, numbers, codes or colors). */
export function oracleElements(indexes: readonly number[], format: Format): string[] {
  switch (format) {
    case "english":
      return indexes.map((index) => english[index]!);
    case "indexes":
      return indexes.map((index) => String(index + 1));
    case "unicode":
      return indexes.map(oracleUnicode);
    case "colors":
      return oracleColors(indexes);
    case "colors-unicode":
      return oracleColorUnicode(oracleColors(indexes));
  }
}

/** Whether the last bits of the last word are the SHA-256 checksum of the entropy (BIP39). */
export function oracleChecksumValid(indexes: readonly number[]): boolean {
  const checksumBits = indexes.length / 3;
  // All 11-bit words written into a byte array, most significant bit first.
  const packed = new Uint8Array(Math.ceil((indexes.length * 11) / 8));
  let bit = 0;
  for (const index of indexes)
    for (let shift = 10; shift >= 0; shift -= 1, bit += 1)
      if ((index >> shift) & 1) packed[bit >> 3]! |= 0x80 >> (bit & 7);
  const entropy = packed.subarray(0, (indexes.length * 11 - checksumBits) / 8);
  const expected = sha256(entropy)[0]! >>> (8 - checksumBits);
  return (indexes.at(-1)! & ((1 << checksumBits) - 1)) === expected;
}

/** Entropy for each length: all zeros, all 0xFF, counting bytes. */
export function publicEntropies(words: number): Record<string, Uint8Array> {
  const bytes = (words * 11 - words / 3) / 8;
  return {
    zeros: new Uint8Array(bytes),
    ones: new Uint8Array(bytes).fill(0xff),
    counting: Uint8Array.from({ length: bytes }, (_, index) => index),
  };
}
