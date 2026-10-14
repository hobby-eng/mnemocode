import { masterFingerprint } from "../bitcoin-evidence.js";
import { EncodedBackup } from "../core/encoded-backup.js";
import {
  printCodes,
  terminalColor,
  terminalHint,
  terminalMore,
  terminalResultHeader,
  terminalStatus,
} from "./terminal.js";
import { encodedOutputLabel } from "./input.js";
import type { EncodeOutcome } from "./encode-command.js";
import { Masking, PHRASE_WORDS, type MaskingMode } from "../core/masking.js";
import { FINGERPRINTS_HINT, plainFingerprintLine } from "./fingerprint-report.js";
import { defined } from "../core/defined.js";

/** Why codes of the Original Seedshift may have no fingerprint of their own. */
const NO_ENCODED_FINGERPRINT =
  "unavailable because legacy Seedshift output may have an invalid BIP39 checksum";

/**
 * The two fingerprints under a result made in `mode`: the original seed phrase's, the wallet's,
 * and the encoded one's, undefined where the codes have none (the Original Seedshift's checksum
 * usually fails). On a terminal in colour as labelled facts, otherwise as plain lines. Encode and
 * the split into shares show them so.
 */
export function printFingerprints(
  mode: MaskingMode,
  original: string,
  encoded: string | undefined,
): void {
  const masking = Masking.of(mode);
  if (terminalColor("stderr")) {
    console.error("");
    terminalStatus(PHRASE_WORDS.originalFingerprint, original);
    if (encoded === undefined)
      terminalStatus(masking.encodedFingerprintLabel, NO_ENCODED_FINGERPRINT, false);
    else terminalStatus(masking.encodedFingerprintLabel, encoded);
    terminalHint(FINGERPRINTS_HINT);
    if (masking.masked) terminalHint(PHRASE_WORDS.fingerprintRoles);
    return;
  }
  console.error(plainFingerprintLine("original", original));
  console.error(
    encoded === undefined
      ? `Encoded BIP32 master fingerprint: ${NO_ENCODED_FINGERPRINT}.`
      : plainFingerprintLine("encoded", encoded, masking.masked),
  );
}

/**
 * The codes of a backup under their header, mode, form and what they hold: Encode's result, and
 * the whole phrase that a split into shares shows beside them with --format.
 */
export function printEncodedBackup(backup: EncodedBackup): void {
  const label = encodedOutputLabel(backup.format, backup.mode);
  if (
    !terminalResultHeader("Encoded result", [
      ["Mode", backup.mode],
      ["Format", backup.format],
      ["Content", label],
    ])
  )
    console.log(`${label}:`);
  printCodes(backup.text(), backup.format);
}

/** Reporting is separate from transformation and file side effects. */
export function printEncodeResult(outcome: EncodeOutcome): void {
  const { mode, encoding } = outcome;
  const { backup, result, base, validLastWord } = encoding;
  printEncodedBackup(backup);
  // By the rule that decode and sskr-combine show it by (EncodedBackup.fingerprint): only codes
  // that are a valid BIP39 phrase have one, which the Original Seedshift's are only by chance.
  printFingerprints(
    backup.mode,
    masterFingerprint(result.sourceMnemonic),
    backup.fingerprint(masterFingerprint),
  );

  if (Masking.of(mode).withValidLastWord !== undefined) {
    if (!encoding.lastWordChanged) {
      console.error(
        "Legacy shifted phrase already has a valid BIP39 checksum; no final-word replacement is needed.",
      );
    } else if (!encoding.replaced) {
      console.error(
        `Optional checksum-valid final word: ${defined(validLastWord).shiftedEnglish.at(-1)}`,
      );
      console.error(
        `Optional checksum-valid legacy phrase: ${defined(validLastWord).shiftedEnglish.join(" ")}`,
      );
      console.error(
        "That word replaces the shifted last word; --legacy-valid-last-word records it.",
      );
      terminalMore("transformation-modes");
    } else {
      console.error(
        `Replaced legacy final word ${base.shiftedEnglish.at(-1)} with checksum-valid word ${result.shiftedEnglish.at(-1)}.`,
      );
      console.error("The shifted last word is not stored; decoding lists the candidates.");
      terminalMore("transformation-modes");
    }
  }
}
