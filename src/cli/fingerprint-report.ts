// The fingerprints of a result as the command line shows them: on a terminal as labelled facts with
// a note, grey where it gets colour, otherwise as plain lines for a file or a pipe. Every command builds them
// from these pieces, so that the labels, the notes and the plain lines read alike everywhere.

import { masterFingerprint } from "../bitcoin-evidence.js";
import { PHRASE_WORDS } from "../core/masking.js";
import { capitalized } from "../core/prose.js";
import {
  FINGERPRINT_NOTE,
  type Channel,
  terminalLayout,
  terminalLine,
  terminalFingerprint,
  terminalHint,
  terminalPart,
  terminalPhrase,
  terminalStatus,
} from "./terminal.js";

/** The note under one fingerprint shown on a terminal. */
export const FINGERPRINT_HINT = `Fingerprint uses an ${FINGERPRINT_NOTE}.`;
/**
 * What a phrase whose BIP39 checksum fails says: its dates or its codes are probably wrong. One
 * text, on a terminal and in plain lines.
 */
const CHECKSUM_INVALID = "invalid — dates or input may be wrong";

/**
 * A fingerprint as a plain line: of the original seed phrase, or of the encoded one, which is the
 * masked phrase where `masked`.
 */
export function plainFingerprintLine(
  kind: "original" | "encoded",
  value: string,
  masked = false,
): string {
  const phrase = kind === "original" ? "Original" : "Encoded";
  const of = masked ? " of the masked phrase" : "";
  return `${phrase} BIP32 master fingerprint${of} (${FINGERPRINT_NOTE}): ${value}`;
}

/**
 * One fingerprint under a result: on a terminal as `label` and `value` with FINGERPRINT_HINT,
 * otherwise as `plainLine` (plainFingerprintLine).
 */
export function reportFingerprint(label: string, value: string, plainLine: string): void {
  if (terminalLayout("stderr")) {
    terminalStatus(label, value);
    terminalHint(FINGERPRINT_HINT);
  } else console.error(plainLine);
}

/**
 * Whether a recovered phrase's BIP39 checksum holds, then, where it does, its original fingerprint:
 * on a terminal as a checked fact, otherwise as a plain line. Decode and re-encode report it so.
 */
export function reportChecksumAndFingerprint(mnemonic: string, checksumValid: boolean): void {
  const value = checksumValid ? "valid" : CHECKSUM_INVALID;
  if (terminalLayout("stderr")) {
    console.error("");
    terminalStatus("BIP39 checksum", value, checksumValid);
  } else console.error(`BIP39 checksum: ${value}.`);
  if (checksumValid) reportOriginalFingerprint(mnemonic);
}

/** The fingerprint of the original seed phrase `mnemonic`, as reportFingerprint shows it. */
export function reportOriginalFingerprint(mnemonic: string): void {
  const fingerprint = masterFingerprint(mnemonic);
  reportFingerprint(
    PHRASE_WORDS.originalFingerprint,
    fingerprint,
    plainFingerprintLine("original", fingerprint),
  );
}

/**
 * On a terminal: the original seed phrase under its label, numbered for writing down, then its
 * fingerprint; where its BIP39 checksum fails, that instead (Decode and a restore from shares show
 * it so).
 */
export function showOriginalPhrase(
  mnemonic: string,
  checksumValid = true,
  channel: Channel = "stdout",
): void {
  terminalPart(capitalized(PHRASE_WORDS.original), true, channel);
  terminalPhrase(mnemonic, channel);
  terminalLine(channel, "");
  if (!checksumValid) {
    terminalStatus("BIP39 checksum", CHECKSUM_INVALID, false);
    return;
  }
  terminalFingerprint(
    PHRASE_WORDS.originalFingerprint,
    masterFingerprint(mnemonic),
    FINGERPRINT_NOTE,
    channel,
  );
}
