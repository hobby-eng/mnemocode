import { masterFingerprint } from "../bitcoin-evidence.js";
import { EncodedBackup } from "../core/encoded-backup.js";
import {
  terminalColor,
  terminalHint,
  terminalMore,
  terminalResultHeader,
  terminalStatus,
} from "./terminal.js";
import { encodedOutputLabel } from "./input.js";
import type { EncodeOutcome } from "./encode-command.js";
import { Masking, PHRASE_WORDS } from "../core/masking.js";

/** Reporting is separate from transformation and file side effects. */
export function printEncodeResult(outcome: EncodeOutcome): void {
  const {
    mode,
    recordMode,
    format,
    encoded,
    result,
    baseResult,
    legacyAlternative,
    legacyChanged,
    useLegacyValid,
  } = outcome;
  const displayedLabel = encodedOutputLabel(format, mode);
  if (
    !terminalResultHeader("Encoded result", [
      ["Mode", recordMode],
      ["Format", format],
      ["Content", displayedLabel],
    ])
  ) {
    console.log(`${displayedLabel}:`);
  }
  console.log(encoded);
  // By the rule that decode and sskr-combine show it by (EncodedBackup.fingerprint): only codes
  // that are a valid BIP39 phrase have one, which the Original Seedshift's are only by chance.
  const encodedFingerprint = EncodedBackup.of(
    result.shiftedIndexes,
    format,
    recordMode,
  ).fingerprint(masterFingerprint);
  if (terminalColor("stderr")) {
    console.error("");
    terminalStatus("Original fingerprint", masterFingerprint(result.sourceMnemonic));
    if (encodedFingerprint === undefined) {
      terminalStatus(
        Masking.of(recordMode).encodedFingerprintLabel,
        "unavailable: legacy output may have an invalid checksum",
        false,
      );
    } else {
      terminalStatus(Masking.of(recordMode).encodedFingerprintLabel, encodedFingerprint);
    }
    terminalHint("BIP32 fingerprints above use an empty BIP39 passphrase.");
    if (mode !== "direct") terminalHint(PHRASE_WORDS.fingerprintRoles);
  } else {
    console.error(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.sourceMnemonic)}`,
    );
    if (encodedFingerprint === undefined) {
      console.error(
        "Encoded BIP32 master fingerprint: unavailable because legacy Seedshift output may have an invalid BIP39 checksum.",
      );
    } else {
      console.error(
        `Encoded BIP32 master fingerprint${Masking.of(recordMode).masked ? " of the masked phrase" : ""} (empty BIP39 passphrase): ${encodedFingerprint}`,
      );
    }
  }

  if (mode === "seedshift-legacy") {
    if (!legacyChanged) {
      console.error(
        "Legacy shifted phrase already has a valid BIP39 checksum; no final-word replacement is needed.",
      );
    } else if (!useLegacyValid) {
      console.error(
        `Optional checksum-valid final word: ${legacyAlternative!.shiftedEnglish.at(-1)}`,
      );
      console.error(
        `Optional checksum-valid legacy phrase: ${legacyAlternative!.shiftedEnglish.join(" ")}`,
      );
      console.error(
        "That word replaces the shifted last word; --legacy-valid-last-word records it.",
      );
      terminalMore("transformation-modes");
    } else {
      console.error(
        `Replaced legacy final word ${baseResult.shiftedEnglish.at(-1)} with checksum-valid word ${result.shiftedEnglish.at(-1)}.`,
      );
      console.error("The shifted last word is not stored; decoding lists the candidates.");
      terminalMore("transformation-modes");
    }
  }
}
