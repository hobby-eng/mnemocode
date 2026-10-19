// The options of Re-encode: those of the old backup, read as Decode reads its own, and those of the
// new one, which are Encode's, the phrase's own left out, since the phrase comes from the old
// backup. The mode, the form and the dates of the old backup take the prefix "old-", so that the
// encode options keep their names; the others have none in Encode and keep Decode's. A module of
// its own, which imports no command module: the command and its list of options both read it.

import { WALLET_EVIDENCE_OPTIONS } from "./bitcoin-options.js";
import { ENCODE_OPTIONS } from "./encode-option-groups.js";
import { PHRASE_SECRET_OPTIONS } from "./input.js";
import { OLD_DATES_KEY, type ParsedArguments } from "./arguments.js";

/**
 * The option that answers the question below the phrase shown, as "Yes, I recognise it" does: the
 * person confirms it. A wallet option confirms it otherwise, as the wallet check does.
 */
export const RECOGNISED_OPTION = "recognised";

/**
 * The option that gives the last word of the original seed phrase, which picks the phrase of a
 * backup made with the Original Seedshift with a valid last word (ReEncoding.of).
 */
export const LAST_WORD_OPTION = "last-word";

/**
 * The options of the old backup, each with the name Decode reads it by: its source, its mode, form
 * and dates, how many words its codes stand for, and the wallet that confirms its phrase.
 */
export const OLD_BACKUP_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  input: "input",
  "input-file": "input-file",
  "qr-file": "qr-file",
  words: "words",
  "old-mode": "mode",
  "old-format": "format",
  [OLD_DATES_KEY]: "date",
  "old-dates-file": "dates-file",
  [LAST_WORD_OPTION]: LAST_WORD_OPTION,
  "last-word-file": "last-word-file",
  ...Object.fromEntries(WALLET_EVIDENCE_OPTIONS.map((key) => [key, key])),
});

/**
 * Every option of Re-encode: the old backup's, its confirmation, then Encode's but the phrase's
 * own.
 */
export const RE_ENCODE_OPTIONS = Object.freeze([
  ...Object.keys(OLD_BACKUP_OPTIONS),
  RECOGNISED_OPTION,
  ...ENCODE_OPTIONS.filter((key) => !(PHRASE_SECRET_OPTIONS as readonly string[]).includes(key)),
]);

/**
 * Whether the new backup is asked on the private screen once the phrase is confirmed: with
 * --ask-secrets and no option of the new backup. Given one, the options make it as Encode's do.
 */
export function asksNewBackup(args: ParsedArguments): boolean {
  if (args["ask-secrets"] !== true) return false;
  return Object.keys(args).every(
    (key) =>
      key === "ask-secrets" || key === RECOGNISED_OPTION || Object.hasOwn(OLD_BACKUP_OPTIONS, key),
  );
}
