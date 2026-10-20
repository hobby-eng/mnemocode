// The options of Encode in three groups: those that both its modes take, those of a plain backup
// only, and those of a split into shares only (--sskr). Each option is placed in one group, so
// that a new option is given its mode where it is added. The command's list of options is built
// from them (command-options.ts), and each mode refuses the other's (encode-command.ts,
// sskr-split-command.ts). A module of its own, which imports no command module: the commands and
// their list of options all read it.

import { BUSINESS_OPTION_NAMES } from "./business-options.js";
import { DRAWING_OPTIONS } from "./output-options.js";

/** What Encode takes in both modes: the phrase and the dates, the outputs and the card design. */
export const ENCODE_SHARED_OPTIONS = Object.freeze([
  "mode",
  "mnemonic",
  "mnemonic-file",
  "ask-secrets",
  "date",
  "dates-file",
  "format",
  "show-masked-words",
  "output",
  "pdf",
  "heir-sheet",
  "heir-sheet-size",
  "backup-check",
  "cards-dir",
  "template",
  ...DRAWING_OPTIONS,
  ...BUSINESS_OPTION_NAMES,
] as const);

/** What only a plain backup takes: the terminal cards, its QR code, its card texts, a last word. */
export const ENCODE_PLAIN_ONLY_OPTIONS = Object.freeze([
  "cards",
  "qr",
  "legacy-valid-last-word",
  "title",
] as const);

/** What only a split into shares takes: the set, the form of the shares and their card layout. */
export const ENCODE_SSKR_ONLY_OPTIONS = Object.freeze([
  "threshold",
  "shares",
  "share-format",
  "card-layout",
  "show-original",
] as const);

/** Every option of Encode: the three groups, and --sskr, which chooses between its modes. */
export const ENCODE_OPTIONS = Object.freeze([
  ...ENCODE_SHARED_OPTIONS,
  ...ENCODE_PLAIN_ONLY_OPTIONS,
  ...ENCODE_SSKR_ONLY_OPTIONS,
  "sskr",
] as const);
