// AUD-010 "shares" reviewer: an independent writer of SSKR shares in MnemoCode's forms, used as the
// oracle of the share-card probes. It does not import src/sskr/transport.ts or src/core/colors.ts:
// it decodes the UR with its own Bytewords table (BCR-2020-012, typed from the specification and
// checked against the published BCR-2020-011 Bytewords in vectors/sskr-v1.json by
// shares-oracle-check.ts), takes CRC-32 from node:zlib, and follows the five steps of
// docs/SSKR.md ("Share forms") for colors (version A1) and for word numbers and Unicode codes
// (version A2, 11-bit pieces), with the BIP39 English and Traditional Chinese lists of @scure/bip39.

import { crc32 } from "node:zlib";
import { wordlist as traditionalChinese } from "@scure/bip39/wordlists/traditional-chinese.js";

/** BCR-2020-012 Bytewords, byte 0x00 to 0xFF. */
export const BYTEWORDS = (
  "able acid also apex aqua arch atom aunt away axis back bald barn belt beta bias blue body " +
  "brag brew bulb buzz calm cash cats chef city claw code cola cook cost crux curl cusp cyan " +
  "dark data days deli dice diet door down draw drop drum dull duty each easy echo edge epic " +
  "even exam exit eyes fact fair fern figs film fish fizz flap flew flux foxy free frog fuel " +
  "fund gala game gear gems gift girl glow good gray grim guru gush gyro half hang hard hawk " +
  "heat help high hill holy hope horn huts iced idea idle inch inky into iris iron item jade " +
  "jazz join jolt jowl judo jugs jump junk jury keep keno kept keys kick kiln king kite kiwi " +
  "knob lamb lava lazy leaf legs liar limp lion list logo loud love luau luck lung main many " +
  "math maze memo menu meow mild mint miss monk nail navy need news next noon note numb obey " +
  "oboe omit onyx open oval owls paid part peck play plus poem pool pose puff puma purr quad " +
  "quiz race ramp real redo rich road rock roof ruby ruin runs rust safe saga scar sets silk " +
  "skew slot soap solo song stub surf swan taco task taxi tent tied time tiny toil tomb toys " +
  "trip tuna twin ugly undo unit urge user vast very veto vial vibe view visa void vows wall " +
  "wand warm wasp wave waxy webs what when whiz wolf work yank yawn yell yoga yurt zaps zero " +
  "zest zinc zone zoom"
).split(" ");

const MINIMAL = new Map(BYTEWORDS.map((word, byte) => [word[0]! + word[3]!, byte]));
/** CBOR tag 40309 (bc-tags, SSKR share) as the three bytes of a CBOR uint16 tag. */
const SSKR_TAG = [0xd9, 0x9d, 0x75];
const COLOR_VERSION = 0xa1;
const WORD_VERSION = 0xa2;

const crc = (bytes: readonly number[]): number => crc32(Uint8Array.from(bytes)) >>> 0;
const be32 = (value: number): number[] => [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);

/** The bytes of a single-part ur:sskr: the untagged CBOR and its CRC-32, checked. */
export function urBytes(ur: string): { readonly cbor: number[]; readonly checksum: number[] } {
  const body = /^ur:sskr\/([a-z]+)$/u.exec(ur)?.[1];
  if (body === undefined || body.length % 2 !== 0) throw new Error("oracle: not a ur:sskr");
  const bytes = body.match(/../gu)!.map((pair) => {
    const byte = MINIMAL.get(pair);
    if (byte === undefined) throw new Error("oracle: unknown minimal byteword");
    return byte;
  });
  const cbor = bytes.slice(0, -4);
  const checksum = bytes.slice(-4);
  if (be32(crc(cbor)).join() !== checksum.join()) throw new Error("oracle: UR checksum");
  return { cbor, checksum };
}

/** The metadata bytes of the share: identifier, group and member, from the CBOR byte string. */
export function reference(ur: string): string {
  const { cbor } = urBytes(ur);
  const payload = cbor[0] === 0x58 ? cbor.slice(2) : cbor.slice(1);
  const id = ((payload[0]! << 8) | payload[1]!).toString(16).padStart(4, "0").toUpperCase();
  return `${id}-${(payload[3]! >>> 4) + 1}-${(payload[4]! & 0x0f) + 1}`;
}

/** docs/SSKR.md steps 1 to 3: checksum first, then version, CBOR length, CBOR, mixed. */
function mixed(ur: string, version: number): number[] {
  const { cbor, checksum } = urBytes(ur);
  const body = [version, cbor.length, ...cbor];
  return [
    ...checksum,
    ...body.map((byte, index) => byte ^ (crc([...checksum, index >>> 8, index & 0xff]) & 0xff)),
  ];
}

/** The share in standard Bytewords: tag, CBOR, CRC-32 over both. */
export function oracleWords(ur: string): string[] {
  const { cbor } = urBytes(ur);
  const tagged = [...SSKR_TAG, ...cbor];
  return [...tagged, ...be32(crc(tagged))].map((byte) => BYTEWORDS[byte]!);
}

/** Version A1, zero bytes to a multiple of three, #RRGGBB. */
export function oracleColors(ur: string): string[] {
  const bytes = mixed(ur, COLOR_VERSION);
  while (bytes.length % 3 !== 0) bytes.push(0);
  const colors: string[] = [];
  for (let at = 0; at < bytes.length; at += 3)
    colors.push(
      "#" +
        bytes
          .slice(at, at + 3)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase(),
    );
  return colors;
}

/** Version A2, cut into 11-bit pieces, the last filled with zero bits; 0-based word indexes. */
function wordIndexes(ur: string): number[] {
  const bits = mixed(ur, WORD_VERSION)
    .map((byte) => byte.toString(2).padStart(8, "0"))
    .join("");
  const padded = bits.padEnd(Math.ceil(bits.length / 11) * 11, "0");
  return padded.match(/.{11}/gu)!.map((piece) => parseInt(piece, 2));
}

export function oracleIndexes(ur: string): string[] {
  return wordIndexes(ur).map((index) => String(index + 1));
}

export function oracleUnicode(ur: string): string[] {
  return wordIndexes(ur).map((index) =>
    traditionalChinese[index]!.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
  );
}

/** The codes that the cards of a share print in a labelled form; ur prints its Bytewords. */
export function oracleCodes(ur: string, form: "indexes" | "unicode" | "words" | "ur"): string[] {
  if (form === "indexes") return oracleIndexes(ur);
  if (form === "unicode") return oracleUnicode(ur);
  return oracleWords(ur);
}
