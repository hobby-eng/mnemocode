// The forms of an SSKR share and their transport: the UR with its CBOR and CRC-32, standard
// Bytewords, and MnemoCode's own forms that look like an encoded seed phrase (BIP39 word numbers,
// Unicode codes, RGB colors and colors as Unicode codes), each read back by its own checks; a
// share's metadata (its set, group and member); and the checks of a set before the SSKR library
// sees it. The units of each form are written through share-units.ts, and the mixed layout of the
// colors and words through mixed-layout.ts, which the repair of marked shares takes too.
//
// Share, at the end, is the entry: one share as read, with its metadata, written in any form, and
// Share.readSet, the shares of one set checked together. The library's own modules ask it. The
// free functions before it (shareInfo, urToTransport, transportToUr, urToBytewords, bytewordsToUr,
// shareToColors, colorsToShare, readShare, normalizeShare, writeShare, validateShareSet) stay for
// the hosts that already call them.
//
// Needs from the host: nothing.
// Does not: split, restore or repair shares (split.ts, share-set.ts, repair.ts, joint-repair.ts).
// Its messages never repeat a share.

import { codeTokens, completeHexUnits, elementsFit } from "../core/code-text.js";
import {
  byteStringHeads,
  CBOR_BYTE_STRING,
  CBOR_BYTE_STRING_ONE_BYTE_LENGTH,
  CBOR_SHORT_LENGTH_LIMIT,
  CBOR_TAG_BYTES,
  CBOR_UINT16_TAG,
  GROUP_BYTE,
  IDENTIFIER_BYTES,
  LOW_NIBBLE,
  MEMBER_BYTE,
  MEMBER_THRESHOLD_BYTE,
  NIBBLE_BITS,
  MAX_GROUPS,
  MAX_GROUP_MEMBERS,
  SHARE_LENGTHS,
  SHARE_METADATA_BYTES,
  SSKR_CBOR_TAG,
  SSKR_CBOR_TAGS,
  storedCount,
  tagBytes,
  type ShareInfo,
} from "./share-layout.js";
import { checksumAt, CRC32_BYTES, crc32 } from "./checksum.js";
import { SET_CONFLICT_CODES, SET_CONFLICT_TEXTS, SetTopology } from "./set-topology.js";
import {
  COLOR_FORM,
  mixedTransport,
  mixShare,
  ownUnitCount,
  WORD_FORM,
  type MixedForm,
} from "./mixed-layout.js";
import {
  BYTEWORD_SEPARATORS,
  bytewordUnits,
  SHARE_FORMATS,
  SHARE_UNITS,
  shareWordIndex,
  UR_SSKR_PREFIX,
  UR_SSKR_START,
  type ShareFormat,
  type ShareUnits,
} from "./share-units.js";
import {
  RGB_HEX_DIGITS,
  rgbHex,
  unicodeToColorCodes,
  COLOR_UNICODE_SYMBOL_CLASS,
} from "../core/colors.js";
import { runTogetherNumbers, unicodeIndexesOf, WORD_NUMBERS_RUN_TOGETHER } from "../core/words.js";
import { WORD_NUMBERS_SPAN, WORD_NUMBERS_THROUGH } from "../core/bip39-sizes.js";
import { Redacted } from "../core/redacted.js";
import { SecretValue } from "../core/secret-value.js";
import { BITS_PER_BYTE, wipedAfter } from "../core/bits.js";
import { type EncodedFormat } from "../core/types.js";
import { EncodedForm } from "../core/encoded-form.js";
import { WordList } from "../core/word-hints.js";
import { BYTEWORD_LETTERS, BYTEWORDS, MINIMAL_BYTEWORD_LETTERS } from "./bytewords-list.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("sskr.transport", {
  "invalid-sskr-transport-length": () => "Invalid SSKR transport length.",
  "sskr-transport-checksum-does-not-match": () => "SSKR transport checksum does not match.",
  "not-sskr-cbor-tag": () => "Not an SSKR CBOR tag.",
  "invalid-sskr-share-byte-string": () => "Invalid SSKR share byte string.",
  "invalid-sskr-share-metadata": () => "Invalid SSKR share metadata.",
  "decoded-bytes-refused": suppliedMessage,
  "expected-single-part-ur-sskr-record": () => "Expected a single-part ur:sskr record.",
  "sskr-record-too-long": () => "SSKR record is too long.",
  "mixed-share-refused": suppliedMessage,
  "invalid-sskr-rgb-codes-preserve-their-printed-order": () =>
    "Invalid SSKR RGB codes. Preserve their printed order.",
  "share-format-one": (value0: string) => `The share format must be one of: ${value0}.`,
  "shares-written-as-no-cards-cards-print-shares": (value0: string) =>
    `Shares written as ${value0} have no cards: cards print shares in colors or in Unicode codes.`,
  "word-numbers-run-together": () => WORD_NUMBERS_RUN_TOGETHER,
  "word-numbers-share-whole-numbers-from": (value0: string) =>
    `Word numbers of a share are whole numbers from ${value0}.`,
  "unicode-codes-share-too-long": () => "The Unicode codes of a share are too long.",
  "not-sskr-share": () => "This is not an SSKR share.",
  "share-qr-does-not-match-printed-references": () =>
    "Share QR does not match the printed references.",
  "assert-share-count-refused": suppliedMessage,
  "shares-of-different-sets": () => SET_CONFLICT_TEXTS.set.refusal,
  "member-given-twice": () => SET_CONFLICT_TEXTS.member.refusal,
  "group-thresholds-conflict": () => SET_CONFLICT_TEXTS.threshold.refusal,
  "not-enough-sskr-shares-meet-recorded-threshold": () =>
    "Not enough SSKR shares to meet the recorded threshold.",
});

/** The bytes of the CRC32 checksum at the end of a share's bytes. */
export const CHECKSUM_BYTES = CRC32_BYTES;
/** The most bytes that a share's transport may have, its checksum included. */
export const MAX_TRANSPORT_BYTES = 128;
/** A single-part UR of a share: the prefix and bytewords, in any case, as the prefix is matched. */
const UR_SSKR = new RegExp(`${UR_SSKR_START.source}([a-z]+)$`, UR_SSKR_START.flags);
/** The minimal Bytewords of a UR's body, one after the other. */
const MINIMAL_BYTEWORD = new RegExp(`.{${MINIMAL_BYTEWORD_LETTERS}}`, "gu");
// The layout of a share, here too for the modules that take it with the transport; the forms, the
// UR's prefix, the reader of a word number and the mixed layout's facts too.
export { CBOR_TAG_BYTES, SHARE_LENGTHS };
export { SHARE_FORMATS, shareWordIndex, UR_SSKR_PREFIX, type ShareFormat };
export {
  COLOR_VERSION,
  RGB_BYTES,
  SHARE_HEADER_BYTES,
  WORD_VERSION,
  wordIndexesToBytes,
} from "./mixed-layout.js";
import { isOneOf } from "../core/one-of.js";
const MAX_COLOR_TEXT_LENGTH = 1024;
/** The shares of one set at most: every member of every group. */
const MAX_SET_SHARES = MAX_GROUPS * MAX_GROUP_MEMBERS;

function validateTransportChecksum(bytes: Uint8Array): void {
  if (bytes.length < CHECKSUM_BYTES + 1 || bytes.length > MAX_TRANSPORT_BYTES) {
    throw ERRORS.create("invalid-sskr-transport-length", []);
  }
  const checksumOffset = bytes.length - CHECKSUM_BYTES;
  if (crc32(bytes.subarray(0, checksumOffset)) !== checksumAt(bytes, checksumOffset)) {
    throw ERRORS.create("sskr-transport-checksum-does-not-match", []);
  }
}

function addTransportChecksum(payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + CHECKSUM_BYTES);
  bytes.set(payload);
  new DataView(bytes.buffer).setUint32(payload.length, crc32(payload));
  return bytes;
}

/**
 * Only the definite byte-string CBOR form used by SSKR is accepted. The checksum bounds the CBOR
 * to one byte at least, so every later byte is read as input that may be missing: a record cut
 * short is an invalid share, not a fault of MnemoCode (AUD-024-FUN001).
 */
function sharePayload(transport: Uint8Array): Uint8Array {
  validateTransportChecksum(transport);
  const cbor = transport.subarray(0, -CHECKSUM_BYTES);
  let offset = 0;
  if (cbor[0] === CBOR_UINT16_TAG) {
    const high = cbor[1];
    const low = cbor[2];
    if (high === undefined || low === undefined || !SSKR_CBOR_TAGS.includes((high << 8) | low)) {
      throw ERRORS.create("not-sskr-cbor-tag", []);
    }
    offset = CBOR_TAG_BYTES;
  }
  const header = cbor[offset++];
  let payloadLength = -1;
  if (
    header !== undefined &&
    header >= CBOR_BYTE_STRING &&
    header < CBOR_BYTE_STRING + CBOR_SHORT_LENGTH_LIMIT
  ) {
    payloadLength = header - CBOR_BYTE_STRING;
  } else if (header === CBOR_BYTE_STRING_ONE_BYTE_LENGTH) {
    payloadLength = cbor[offset++] ?? -1;
  }
  if (payloadLength !== cbor.length - offset || !SHARE_LENGTHS.has(payloadLength)) {
    throw ERRORS.create("invalid-sskr-share-byte-string", []);
  }
  return cbor.subarray(offset);
}

// The metadata of a share, which shareInfo reads, as the layout of a share names it.
export type { ShareInfo };

/**
 * The metadata of the share whose transport is `transport`. Thresholds and group count are stored
 * minus one; member/group indexes are zero-based. Refuses a transport of a wrong length
 * (sskr.transport.invalid-sskr-transport-length) or checksum
 * (sskr.transport.sskr-transport-checksum-does-not-match), a CBOR tag of no share
 * (sskr.transport.not-sskr-cbor-tag), a byte string of no share's length
 * (sskr.transport.invalid-sskr-share-byte-string), and metadata of no share: a reserved bit set,
 * or a group threshold or index beyond the groups (sskr.transport.invalid-sskr-share-metadata).
 */
export function shareInfo(transport: Uint8Array): ShareInfo {
  const payload = sharePayload(transport);
  const info: ShareInfo = {
    // Its bytes, big-endian.
    identifier: payload
      .subarray(0, IDENTIFIER_BYTES)
      .reduce((value, byte) => (value << BITS_PER_BYTE) | byte, 0),
    groupThreshold: storedCount(defined(payload[GROUP_BYTE]) >>> NIBBLE_BITS),
    groupCount: storedCount(defined(payload[GROUP_BYTE]) & LOW_NIBBLE),
    groupIndex: defined(payload[MEMBER_THRESHOLD_BYTE]) >>> NIBBLE_BITS,
    memberThreshold: storedCount(defined(payload[MEMBER_THRESHOLD_BYTE]) & LOW_NIBBLE),
    memberIndex: defined(payload[MEMBER_BYTE]) & LOW_NIBBLE,
    secretLength: payload.length - SHARE_METADATA_BYTES,
  };
  const reservedBits = defined(payload[MEMBER_BYTE]) >>> NIBBLE_BITS;
  if (
    reservedBits !== 0 ||
    info.groupThreshold > info.groupCount ||
    info.groupIndex >= info.groupCount
  ) {
    throw ERRORS.create("invalid-sskr-share-metadata", []);
  }
  return info;
}

/**
 * `tokens` as new bytes, each read by `units` (a UR pair or a Bytewords word), which are the
 * caller's. A token that is none is refused with `unknown`, and what was read before it is wiped
 * first: Uint8Array.from would leave its half-filled array behind (AUD-015-SEC001, AUD-016).
 */
function decodedBytes(tokens: readonly string[], units: ShareUnits, unknown: string): Uint8Array {
  const bytes = new Uint8Array(tokens.length);
  for (const [index, token] of tokens.entries()) {
    const byte = units.valueOf(token);
    if (byte === undefined) {
      bytes.fill(0);
      throw ERRORS.create("decoded-bytes-refused", [unknown]);
    }
    bytes[index] = byte;
  }
  return bytes;
}

/**
 * The bytes of the share `value` written as a UR, its checksum checked; refuses a text that is no
 * UR of a share, too long or with a wrong checksum.
 */
export function urToTransport(value: string): Uint8Array {
  const match = UR_SSKR.exec(value.trim());
  const body = match?.[1];
  if (
    !body ||
    body.length % MINIMAL_BYTEWORD_LETTERS !== 0 ||
    body.length > MAX_TRANSPORT_BYTES * MINIMAL_BYTEWORD_LETTERS
  ) {
    throw ERRORS.create("expected-single-part-ur-sskr-record", []);
  }
  const pairs = defined(body.toLowerCase().match(MINIMAL_BYTEWORD));
  const bytes = decodedBytes(pairs, SHARE_UNITS.ur, "Unknown Bytewords pair in SSKR record.");
  // The bytes are the caller's once they are checked; a share refused here is wiped first.
  try {
    shareInfo(bytes);
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
  return bytes;
}

/**
 * The CBOR of a checked share without its checksum and without its tag, current or earlier, if it
 * has one, its byte string written with the shortest head (byteStringHeads): the bytes that every
 * form of a share writes, each adding the tag it needs. A share read with a longer head, which
 * sharePayload accepts, is written again so, because the SSKR library, which decodes
 * deterministic CBOR, refuses any other head (AUD-014-FUN001); the payload stays the same.
 */
function canonicalCbor(transport: Uint8Array): Uint8Array {
  const payload = sharePayload(transport);
  const head = defined(byteStringHeads(payload.length)[0]);
  const cbor = new Uint8Array(head.length + payload.length);
  cbor.set(head);
  cbor.set(payload, head.length);
  return cbor;
}

/**
 * `cbor`, prefixed with `prefix`, with its CRC-32, in the units of `units`. The bytes made here,
 * which hold the share's secret, are wiped once written; `cbor` too, which its caller made.
 */
function writtenCbor(units: ShareUnits, prefix: readonly number[], cbor: Uint8Array): string {
  const framed = new Uint8Array(prefix.length + cbor.length);
  framed.set(prefix);
  framed.set(cbor, prefix.length);
  const bytes = addTransportChecksum(framed);
  const values = Array.from(bytes);
  try {
    return units.text(values);
  } finally {
    for (const array of [cbor, framed, bytes, values]) array.fill(0);
  }
}

/** The share of `bytes` written as a UR; refuses bytes that are no share. */
export function transportToUr(bytes: Uint8Array): string {
  shareInfo(bytes);
  // A UR's type supplies the CBOR tag. Standard Bytewords contains the tag explicitly.
  return writtenCbor(SHARE_UNITS.ur, [], canonicalCbor(bytes));
}

/**
 * A share in standard Bytewords: one English word per byte, the CBOR tag included and a new CRC32
 * over the tagged bytes, as other SSKR tools write it. bytewordsToUr reads it back. Refuses what
 * urToTransport refuses: a `ur` that is no single-part UR of a share or too long
 * (sskr.transport.expected-single-part-ur-sskr-record), a pair of letters of no byte
 * (sskr.transport.decoded-bytes-refused), and bytes of no share, such as a wrong checksum
 * (shareInfo).
 */
export function urToBytewords(ur: string): string {
  // A UR may carry a tag already, which is replaced by the registered one, never doubled; the
  // registered tag is written in Bytewords as other SSKR tools write it.
  return wipedAfter(urToTransport(ur), (transport) =>
    writtenCbor(SHARE_UNITS.words, tagBytes(SSKR_CBOR_TAG), canonicalCbor(transport)),
  );
}

/**
 * The share of `value` written in Bytewords, as a UR; refuses words that are no Bytewords, too many
 * and a wrong checksum.
 */
export function bytewordsToUr(value: string): string {
  const words = bytewordUnits(value);
  if (words.length > MAX_TRANSPORT_BYTES) throw ERRORS.create("sskr-record-too-long", []);
  return wipedAfter(
    decodedBytes(words, SHARE_UNITS.words, "Unknown SSKR Byteword."),
    transportToUr,
  );
}

/**
 * The units of the mixed share `ur` in `form`: its word indexes or its colors (mixed-layout.ts).
 */
function mixedUnits(ur: string, form: MixedForm): number[] {
  return wipedAfter(urToTransport(ur), (transport) => {
    const mixed = mixShare(transport, form.version);
    try {
      return form.unpack(mixed);
    } finally {
      mixed.fill(0);
    }
  });
}

/**
 * The share that `values`, units of a mixed share in `form`, start with, as its UR: the units after
 * its own length, such as the decoys of its cards, are left out (ownUnitCount). Refused with the
 * form's reason when they hold none (mixedTransport).
 */
function mixedToShare(form: MixedForm, values: readonly number[]): string {
  const own = values.slice(0, ownUnitCount(form, values) ?? values.length);
  const transport = mixedTransport(form, form.pack(own), own.length);
  if (transport === undefined) throw ERRORS.create("mixed-share-refused", [form.refusal]);
  return wipedAfter(transport, transportToUr);
}

/**
 * The mixed share (mixShare, version A1), zero bytes to a whole color, three bytes per #RRGGBB.
 * Refuses what urToTransport refuses: a `ur` that is no single-part UR of a share or too long
 * (sskr.transport.expected-single-part-ur-sskr-record), a pair of letters of no byte
 * (sskr.transport.decoded-bytes-refused), and bytes of no share, such as a wrong checksum
 * (shareInfo).
 */
export function shareToColors(ur: string): string[] {
  return mixedUnits(ur, COLOR_FORM).map(rgbHex);
}

/** The colors of a share as written, each as its value, in their printed order. */
function parseColorValues(value: string): number[] {
  const codes =
    value.length > MAX_COLOR_TEXT_LENGTH ? undefined : completeHexUnits(value, RGB_HEX_DIGITS);
  if (codes === undefined)
    throw ERRORS.create("invalid-sskr-rgb-codes-preserve-their-printed-order", []);
  return codes.map((code) => defined(SHARE_UNITS.colors.valueOf(code)));
}

/** The share of `value` written in colors, as a UR; refuses colors that are no share. */
export function colorsToShare(value: string): string {
  return mixedToShare(COLOR_FORM, parseColorValues(value));
}

/** The form of shares when none is chosen: the standard UR. */
export const DEFAULT_SHARE_FORMAT: ShareFormat = SHARE_FORMATS[0];

/** Whether `value` names a form of shares; an option or a host may pass anything. */
export function isShareFormat(value: unknown): value is ShareFormat {
  return isOneOf(SHARE_FORMATS, value);
}

/**
 * Refuses `value` unless it names a form of shares, with the list of them: an option, a host or an
 * untyped caller of a writer may pass anything, such as a typo, null or a number.
 */
export function assertShareFormat(value: unknown): asserts value is ShareFormat {
  if (!isShareFormat(value))
    throw ERRORS.create("share-format-one", [`${SHARE_FORMATS.join(", ")}`]);
}

/** `value` as a form of shares; refused with the list of them (assertShareFormat). */
export function parseShareFormat(value: string): ShareFormat {
  assertShareFormat(value);
  return value;
}

function indexesToShare(value: string): string {
  const numbers = codeTokens(value);
  if (numbers.some(runTogetherNumbers)) throw ERRORS.create("word-numbers-run-together", []);
  const indexes = numbers.map(shareWordIndex);
  if (
    numbers.length > MAX_COLOR_TEXT_LENGTH ||
    !indexes.every((index): index is number => index !== undefined)
  )
    throw ERRORS.create("word-numbers-share-whole-numbers-from", [`${WORD_NUMBERS_THROUGH}`]);
  return mixedToShare(WORD_FORM, indexes);
}

function unicodeToShare(value: string): string {
  if (value.length > MAX_COLOR_TEXT_LENGTH) throw ERRORS.create("unicode-codes-share-too-long", []);
  return mixedToShare(WORD_FORM, unicodeIndexesOf(value));
}

/**
 * The writer of one of MnemoCode's own forms, `format`: the units of the mixed layout that the
 * form holds (SHARE_UNITS), written as the form writes them.
 */
function mixedWriter(format: ShareFormat): (ur: string) => string {
  const { mixed, text } = SHARE_UNITS[format];
  const form = defined(mixed);
  return (ur) => text(mixedUnits(ur, form));
}

/** Elements of a share in hexadecimal digits: colors, Unicode codes or Color Unicode codes. */
const HEX_ELEMENT = /^[0-9A-F]+$/u;
/** Elements of a share in Color Unicode, its codes in digits or the Private Use symbols. */
const COLOR_UNICODE_ELEMENT = new RegExp(`^[0-9A-F${COLOR_UNICODE_SYMBOL_CLASS}]+$`, "u");

/**
 * What one share form is, past the units it writes (SHARE_UNITS): its name, the form of a seed
 * phrase that it looks like, and how its text looks, is read and is written. The repair of marked
 * shares, which this module cannot import, keeps what it knows of each form in REPAIR_FORMS
 * (repair-models.ts).
 */
interface ShareFormVariant {
  /** Its name as a person reads it (SHARE_FORMAT_NAMES). */
  readonly name: string;
  /**
   * The form of an encoded seed phrase that it looks like (MIRRORED_FORM): restoring shares shows
   * the phrase in it, and a phrase in it is split into shares of that look.
   */
  readonly mirrored: EncodedFormat;
  /**
   * Whether a seed phrase in `mirrored` is split into this form unless one is chosen
   * (shareFormatMirroring): exactly one share form of each encoded form is.
   */
  readonly mirrorsPhrase: boolean;
  /**
   * Its place among the readers, the lowest first (readShare). Text may look like more than one
   * form, such as hexadecimal digits; each form carries a version byte, a length and a checksum,
   * so only the right reader accepts it, and a text that none reads is refused with the refusal of
   * the first it looks like. Bytewords, which take any text, come last.
   */
  readonly readOrder: number;
  /**
   * Whether `text`, trimmed, looks like a share in this form. Each look takes the elements as the
   * readers and the repair split them (core/code-text.ts, elementsFit), so that a text that one of
   * them reads is not turned away by its look.
   */
  readonly looks: (text: string) => boolean;
  /** The share of `text`, trimmed, as its UR; refuses a text that is no share in this form. */
  readonly read: (text: string) => string;
  /** The share `ur` written in this form. */
  readonly write: (ur: string) => string;
  /** The list that the form's words are typed from, for the hints below a share being typed. */
  readonly words?: WordList;
}

/**
 * Every share form. A new form is one more variant here, one in SHARE_UNITS and one in
 * REPAIR_FORMS, and the compiler asks for each; the readers, the writer, the names and the
 * questions below ask the form.
 */
const SHARE_FORMS: Readonly<Record<ShareFormat, ShareFormVariant>> = Object.freeze({
  ur: {
    name: "Compact UR",
    mirrored: "english",
    // English words give standard Bytewords rather than the UR, which other SSKR tools read as
    // well and a person reads more easily.
    mirrorsPhrase: false,
    readOrder: 0,
    looks: (text) => /^ur:/iu.test(text),
    read: (text) => wipedAfter(urToTransport(text), transportToUr),
    write: (ur) => ur,
  },
  words: {
    name: "Bytewords",
    mirrored: "english",
    mirrorsPhrase: true,
    // Any other text is read as Bytewords, the standard form in words.
    readOrder: 5,
    looks: (text) => text.length > 0,
    read: bytewordsToUr,
    write: urToBytewords,
    // Hinted as bytewordUnits reads them: apart at any separator of Bytewords, or run together.
    words: new WordList({ one: "Byteword", many: "Bytewords" }, BYTEWORDS, {
      separators: BYTEWORD_SEPARATORS,
      runTogether: BYTEWORD_LETTERS,
    }),
  },
  indexes: {
    name: `BIP39 word numbers (${WORD_NUMBERS_SPAN})`,
    mirrored: "indexes",
    mirrorsPhrase: true,
    readOrder: 1,
    looks: (text) => elementsFit(text, /^\d+$/u),
    read: indexesToShare,
    write: mixedWriter("indexes"),
  },
  unicode: {
    name: "Unicode codes",
    mirrored: "unicode",
    mirrorsPhrase: true,
    readOrder: 3,
    looks: (text) => elementsFit(text, HEX_ELEMENT),
    read: unicodeToShare,
    write: mixedWriter("unicode"),
  },
  colors: {
    name: "RGB hexadecimal codes (ordered)",
    mirrored: "colors",
    mirrorsPhrase: true,
    readOrder: 2,
    looks: (text) => elementsFit(text, HEX_ELEMENT),
    read: colorsToShare,
    write: mixedWriter("colors"),
  },
  "colors-unicode": {
    name: "Colors as Unicode codes",
    mirrored: "colors-unicode",
    mirrorsPhrase: true,
    readOrder: 4,
    looks: (text) => elementsFit(text, COLOR_UNICODE_ELEMENT),
    read: (text) => colorsToShare(unicodeToColorCodes(text).join(" ")),
    write: mixedWriter("colors-unicode"),
  },
});

/** The share forms in the order that their readers try a text (readOrder). */
const READ_ORDER: readonly ShareFormat[] = Object.freeze(
  [...SHARE_FORMATS].sort((a, b) => SHARE_FORMS[a].readOrder - SHARE_FORMS[b].readOrder),
);

/** Whether `facts` holds a fact for every share form, as byForm fills it. */
function hasEveryForm<T>(facts: Partial<Record<ShareFormat, T>>): facts is Record<ShareFormat, T> {
  return SHARE_FORMATS.every((format) => facts[format] !== undefined);
}

/** One fact of every share form (SHARE_FORMS), by form: the tables below are views of the forms. */
function byForm<T>(fact: (form: ShareFormVariant) => T): Readonly<Record<ShareFormat, T>> {
  const facts: Partial<Record<ShareFormat, T>> = {};
  for (const format of SHARE_FORMATS) facts[format] = fact(SHARE_FORMS[format]);
  return Object.freeze(defined(hasEveryForm(facts) ? facts : undefined));
}

/** The share forms as a person reads their names (ShareFormVariant name). */
export const SHARE_FORMAT_NAMES: Readonly<Record<ShareFormat, string>> = byForm(
  (form) => form.name,
);

/**
 * The form of an encoded seed phrase that each share form looks like (ShareFormVariant mirrored):
 * restoring shares shows the phrase in it, and a phrase in it is split into shares of that look.
 * Shares in Bytewords or as a UR give the phrase back as words.
 */
export const MIRRORED_FORM: Readonly<Record<ShareFormat, EncodedFormat>> = byForm(
  (form) => form.mirrored,
);

/**
 * The share form that a seed phrase in `form` is split into unless one is chosen: the one that
 * looks like it (ShareFormVariant mirrorsPhrase), standard Bytewords for English words. A form
 * that names none is refused by the encoded forms' own rule (EncodedForm.of), as a host may pass
 * anything at run time (AUD-001-API001).
 */
export function shareFormatMirroring(form: EncodedFormat): ShareFormat {
  EncodedForm.of(form);
  return defined(
    SHARE_FORMATS.find(
      (format) => SHARE_FORMS[format].mirrorsPhrase && SHARE_FORMS[format].mirrored === form,
    ),
  );
}

/**
 * Whether a share in `format` is its colors, as the form of a seed phrase that it looks like is
 * (EncodedForm writtenInColors): its cards print them, not codes beside them.
 */
export function isColorShareFormat(format: ShareFormat): boolean {
  return EncodedForm.of(SHARE_FORMS[format].mirrored).writtenInColors;
}

/**
 * The share forms written in colors (isColorShareFormat), as --format writes a seed phrase in
 * colors.
 */
export const COLOR_SHARE_FORMATS: readonly ShareFormat[] = Object.freeze(
  SHARE_FORMATS.filter(isColorShareFormat),
);

/**
 * Whether shares in `format` have cards: those that look like a form of a seed phrase with cards
 * (EncodedForm cardKind), its colors or its Unicode codes. Word numbers, Bytewords and the UR have
 * none (owner, 2026-10-13). A format that names none is refused (assertShareFormat).
 */
export function shareFormatHasCards(format: ShareFormat): boolean {
  assertShareFormat(format);
  return EncodedForm.of(SHARE_FORMS[format].mirrored).cardKind !== undefined;
}

/** Refuses cards of shares written in `format` where it has none (shareFormatHasCards). */
export function assertShareFormatHasCards(format: ShareFormat): void {
  if (!shareFormatHasCards(format))
    throw ERRORS.create("shares-written-as-no-cards-cards-print-shares", [`${format}`]);
}

/**
 * One share as text in `format`; readShare reads every one of them back. A format that is none is
 * refused (assertShareFormat), so that no writer gives undefined for it (AUD-001-API001).
 */
export function writeShare(share: string, format: ShareFormat): string {
  assertShareFormat(format);
  return SHARE_FORMS[format].write(share);
}

/**
 * The list that a share typed so far is written in the words of: Bytewords where the share looks
 * like no other form, as readShare takes it; none for a share in codes, colors or a UR.
 */
export function shareWordList(share: string): WordList | undefined {
  const text = share.trim();
  const format = READ_ORDER.find((candidate) => SHARE_FORMS[candidate].looks(text));
  return format === undefined ? undefined : SHARE_FORMS[format].words;
}

/** A share as read (readShare): its UR and the form it was written in. */
export interface ReadShare {
  /** The share as a UR, ur:sskr/ and its bytewords; it holds a part of the secret. */
  readonly ur: string;
  /** The form that the share was written in. */
  readonly format: ShareFormat;
}

/**
 * A share in any form MnemoCode writes, as its UR, and the form it was written in. Refuses text
 * that is no share, with the refusal of the first form it looks like (readOrder), or
 * not-sskr-share.
 */
export function readShare(value: string): ReadShare {
  const text = value.trim();
  let firstError: unknown;
  for (const format of READ_ORDER) {
    const form = SHARE_FORMS[format];
    if (!form.looks(text)) continue;
    try {
      return { ur: form.read(text), format };
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError instanceof Error ? firstError : ERRORS.create("not-sskr-share", []);
}

/** The share of `value`, in any form, as a UR; refuses a text that is no share. */
export function normalizeShare(value: string): string {
  return readShare(value).ur;
}

/**
 * Refuses a share QR code that holds another share than the cards beside it print: the share of
 * the colors, or, where the cards print `labels`, the share's codes in another form, the share
 * that those spell.
 */
export function assertShareQr(
  colors: readonly string[],
  payload: string,
  labels?: readonly string[],
): void {
  const printed =
    labels === undefined ? colorsToShare(colors.join(" ")) : readShare(labels.join(" ")).ur;
  if (readShare(payload).ur !== printed)
    throw ERRORS.create("share-qr-does-not-match-printed-references", []);
}

/**
 * Why `count` shares are not a set to read, or undefined when they may be one: none, or more than
 * a set has. A host-neutral reader that returns its trouble, such as ShareInput with no share left
 * (AUD-014-API009), says this; assertShareCount throws it.
 */
export function shareCountProblem(count: number): string | undefined {
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_SET_SHARES
    ? undefined
    : `Provide between 1 and ${MAX_SET_SHARES} SSKR shares.`;
}

/**
 * Bound the input before parsing or searching for any missing elements: refuses a `count` that is
 * not a whole number from 1 to the shares of a whole set (sskr.transport.assert-share-count-refused,
 * with the text of shareCountProblem).
 */
export function assertShareCount(count: number): void {
  const problem = shareCountProblem(count);
  if (problem !== undefined) throw ERRORS.create("assert-share-count-refused", [problem]);
}

/**
 * Reject mixed sets and duplicate members before asking the cryptographic engine: the URs of
 * Share.readSet.
 */
export function validateShareSet(records: readonly string[], requireQuorum = true): string[] {
  const shares = Share.readSet(records, requireQuorum);
  try {
    return shares.map((share) => share.ur);
  } finally {
    for (const share of shares) share.wipe();
  }
}

/**
 * One SSKR share, as read from any of its forms: its UR, the form it was written in, and its
 * metadata. A class, so that a share exists only once it reads, its own checks holding; it writes
 * itself in any form; it never changes; and, being part of a secret, it never shows through
 * toString, toJSON or Node.js's inspect.
 */
export class Share extends Redacted {
  readonly #ur: SecretValue<string>;
  readonly #format: ShareFormat;
  /** Read once, with the share: every question about its set, group and member is asked of it. */
  readonly #info: ShareInfo;

  private constructor(ur: string, format: ShareFormat) {
    super("Share");
    this.#format = format;
    this.#info = Object.freeze(wipedAfter(urToTransport(ur), shareInfo));
    this.#ur = SecretValue.text(ur);
  }

  /** The forms that a share is written in (SHARE_FORMATS). */
  static readonly FORMATS: readonly ShareFormat[] = SHARE_FORMATS;

  /** Reads a share in any of its forms; throws why it cannot be read, without repeating it. */
  static read(text: string): Share {
    const { ur, format } = readShare(text);
    return new Share(ur, format);
  }

  /**
   * The shares of one set, each read in any of its forms, checked together before the SSKR
   * library sees them: as many as a set may have, none of another set, no member twice, one
   * threshold for each group, and, with `requireQuorum`, enough of them for the set's threshold.
   * Refuses a count that assertShareCount refuses, a share that Share.read refuses, shares of
   * different sets (sskr.transport.shares-of-different-sets), a member given twice
   * (sskr.transport.member-given-twice), two thresholds for a group
   * (sskr.transport.group-thresholds-conflict) and too few shares for the threshold
   * (sskr.transport.not-enough-sskr-shares-meet-recorded-threshold); the shares read before a
   * refusal are wiped first.
   */
  static readSet(records: readonly string[], requireQuorum = true): Share[] {
    assertShareCount(records.length);
    const shares: Share[] = [];
    try {
      for (const record of records) shares.push(Share.read(record));
      const infos = shares.map((share) => share.info);
      const conflict = SetTopology.firstConflict(infos);
      if (conflict !== undefined) throw ERRORS.create(SET_CONFLICT_CODES[conflict.kind], []);
      if (requireQuorum && !new SetTopology(infos).enough)
        throw ERRORS.create("not-enough-sskr-shares-meet-recorded-threshold", []);
      return shares;
    } catch (error) {
      for (const share of shares) share.wipe();
      throw error;
    }
  }

  /** Whether `text` reads as a whole share: its own checksum makes other text pass one in 2^32. */
  static reads(text: string): boolean {
    try {
      readShare(text);
      return true;
    } catch {
      return false;
    }
  }

  /** The share as its UR, ur:sskr/…, the form that the SSKR library takes. */
  get ur(): string {
    return this.#ur.value;
  }

  /** The form the share was written in. */
  get format(): ShareFormat {
    return this.#format;
  }

  /** What the share's metadata says: its set, its group and its member. */
  get info(): ShareInfo {
    return this.#info;
  }

  /** The share written in `format`, by default the one it was read in. */
  write(format: ShareFormat = this.#format): string {
    return writeShare(this.#ur.value, format);
  }

  /** Whether `other` is the same share, however either of them was written. */
  sameAs(other: Share): boolean {
    return other.#ur.value === this.#ur.value;
  }
  /** Overwrites this share's retained UR bytes; returned text copies cannot be recalled. */
  wipe(): void {
    this.#ur.wipe();
  }

  /** Ends this share's lifetime in its owning scope. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
