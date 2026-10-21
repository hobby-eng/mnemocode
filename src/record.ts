import {
  isEncodedFormat,
  isMaskingMode,
  type EncodedFormat,
  type MaskingMode,
} from "./core/types.js";
import { defined } from "./core/defined.js";
import { ErrorCatalog } from "./core/error-catalog.js";

const ERRORS = new ErrorCatalog("record", {
  "unsupported-mode": () => "Unsupported MnemoCode record mode.",
  "unsupported-format": () => "Unsupported MnemoCode record format.",
  "empty-payload": () => "A MnemoCode record payload must not be empty.",
  "malformed-header": () => "Malformed MnemoCode record header.",
  // The version's digits stay out: they are typed text, which a message never repeats (CORE-24).
  "unsupported-version": () => "Unsupported MnemoCode record version. A newer MnemoCode reads it.",
});

/** The version of the MNC1 record that this program writes, and the only one it reads. */
export const MNEMOCODE_RECORD_VERSION = 1 as const;
/** @deprecated Use MaskingMode; kept because index.ts exports it and hosts import it. */
export type RecordMode = MaskingMode;
/** @deprecated Use EncodedFormat; kept because index.ts exports it and hosts import it. */
export type RecordFormat = EncodedFormat;

/**
 * An MNC1 record as it is read: its version, its mode, its form of codes and the codes themselves.
 */
export interface MnemoCodeRecord {
  /** The record's version: 1, the only one read (MNEMOCODE_RECORD_VERSION). */
  readonly version: typeof MNEMOCODE_RECORD_VERSION;
  /** The transformation mode that the codes were written in. */
  readonly mode: MaskingMode;
  /** The form that the codes are written in, which reads them (EncodedForm). */
  readonly format: EncodedFormat;
  /** The codes, everything after the header as it stands; never empty. */
  readonly payload: string;
}

// The version is a number without leading zeros, so "MNC01:" is malformed rather than read as 1.
// A header whose mode is none of the modes is malformed too, before its version is read.
/** What every record starts with, before its version. */
const RECORD_PREFIX = "MNC";
const RECORD_PATTERN = new RegExp(
  `^${RECORD_PREFIX}([1-9][0-9]*):([a-z-]+):([a-z-]+):([\\s\\S]+)$`,
  "u",
);

/**
 * Wraps a raw representation with enough public metadata to select its decoder later. Refuses a
 * mode or a format that is not MnemoCode's and an empty payload (record.unsupported-mode,
 * record.unsupported-format, record.empty-payload).
 */
export function serializeRecord(mode: MaskingMode, format: EncodedFormat, payload: string): string {
  if (!isMaskingMode(mode)) throw ERRORS.create("unsupported-mode", []);
  if (!isEncodedFormat(format)) throw ERRORS.create("unsupported-format", []);
  const normalized = payload.trim();
  if (normalized.length === 0) throw ERRORS.create("empty-payload", []);
  return `${RECORD_PREFIX}${MNEMOCODE_RECORD_VERSION}:${mode}:${format}:${normalized}`;
}

/**
 * Reads a versioned record, or returns undefined for legacy raw representations. Refuses a record
 * header that is malformed, of an unsupported version or of an unknown format
 * (record.malformed-header, record.unsupported-version, record.unsupported-format).
 */
export function parseRecord(value: string): MnemoCodeRecord | undefined {
  const normalized = value.trim();
  if (!normalized.startsWith(RECORD_PREFIX)) return undefined;
  const match = RECORD_PATTERN.exec(normalized);
  if (match === null || !isMaskingMode(match[2])) throw ERRORS.create("malformed-header", []);
  // The pattern admits only versions from 1 up, so any other than this one is newer.
  if (Number(match[1]) !== MNEMOCODE_RECORD_VERSION) throw ERRORS.create("unsupported-version", []);
  const format = match[3];
  if (!isEncodedFormat(format)) throw ERRORS.create("unsupported-format", []);
  return {
    version: MNEMOCODE_RECORD_VERSION,
    mode: match[2],
    format,
    payload: defined(match[4]),
  };
}
