// What Encode makes, and the encode that its checked options prepare: the types that the modules
// Encode runs (encode-report.ts, encode-export.ts and, for --sskr, sskr-split-command.ts) share
// with encode-command.ts, which imports them all. Here, so that none of them imports it back.

import type { DateShiftDate } from "../core.js";
import type { Encoding } from "../core/encoded-backup.js";
import type { MaskingMode } from "../core/types.js";
import type { Cancelled } from "./terminal-keys.js";

/** What Encode made: the library's encoding, with the mode as asked and the dates as typed. */
export interface EncodeOutcome {
  /** The codes and the mode their record names, as EncodedBackup.encode made them. */
  readonly encoding: Encoding;
  /** The mode as asked, before any replacement of the last word (Encoding.replaced). */
  readonly mode: MaskingMode;
  readonly enteredDates: readonly DateShiftDate[];
}

/**
 * Encode once its options are checked: it asks for the phrase, or reads it, unless it is `known`,
 * which Re-encode decoded and confirmed, then its dates, and makes and saves the backup.
 * CANCELLED when the person cancelled it.
 */
export type PreparedEncode = (known?: string) => Promise<Cancelled | undefined>;
