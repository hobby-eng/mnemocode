import { masterFingerprint } from "../bitcoin-evidence.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import { EncodedForm } from "../core/encoded-form.js";
import {
  backupCodeLines,
  terminalLayout,
  terminalHint,
  terminalMore,
  terminalResultHeader,
  terminalStatus,
  terminalPhrase,
  terminalNotice,
} from "./terminal.js";
import { encodedOutputLabel } from "./input.js";
import { runningLines } from "./terminal-style.js";
import type { EncodeOutcome } from "./encode-types.js";
import { Masking, PHRASE_WORDS, type MaskingMode } from "../core/masking.js";
import { plainFingerprintLine } from "./fingerprint-report.js";
import { defined } from "../core/defined.js";
import { choiceOption, type ParsedArguments } from "./arguments.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { PrivateSteps } from "./private-steps.js";

const ERRORS = new ErrorCatalog("cli.encode-report", {
  "masked-words-need-seedshift": () => "--show-masked-words needs a Seedshift mode.",
});

/** Checks the optional display of Seedshift words before any phrase is read. */
export function maskedWordsRequested(args: ParsedArguments, mode: MaskingMode): boolean {
  const show = args["show-masked-words"] === true;
  if (show && !Masking.of(mode).masked) throw ERRORS.create("masked-words-need-seedshift", []);
  return show;
}

/** Shows the words after Seedshift, explicitly apart from the original wallet phrase. */
export function printMaskedWords(mnemonic: string, mode: MaskingMode): void {
  if (
    !terminalResultHeader("Seedshift phrase", [
      ["Mode", mode],
      ["Content", "Masked phrase (decoy)"],
    ])
  )
    console.log("Seedshift phrase (masked, not the original wallet phrase):");
  if (!terminalPhrase(mnemonic)) console.log(mnemonic);
  terminalHint("These words need the original dates to recover the wallet seed phrase.");
}

/** Why codes of the Original Seedshift may have no fingerprint of their own. */
const NO_ENCODED_FINGERPRINT =
  "unavailable because legacy Seedshift output may have an invalid BIP39 checksum";

/** The original phrase is shown only in English words, for visual checking. */
export const ORIGINAL_COPY_FORM = "words";

/** The optional original-copy form, refused before any secret is read when it is unknown. */
export function originalCopyRequested(args: ParsedArguments): boolean {
  return choiceOption(args, "show-original", [ORIGINAL_COPY_FORM]) !== undefined;
}

/**
 * Shows the original wallet phrase only as English words, for visual checking. It is never
 * converted to codes or added to the encoded exports.
 */
export function printOriginalCopy(mnemonic: string): void {
  if (
    !terminalResultHeader("Original seed phrase", [
      ["Content", "English words for visual checking"],
    ])
  )
    console.log("Original seed phrase (words for visual checking):");
  if (!terminalPhrase(mnemonic)) console.log(mnemonic);
  terminalNotice("Keep the original phrase apart from the encoded backup.", "warning");
}

/**
 * The two fingerprints under a result made in `mode`: the original seed phrase's, the wallet's,
 * and the encoded one's, undefined where the codes have none (the Original Seedshift's checksum
 * usually fails). On a terminal as labelled facts, otherwise as plain lines. Encode and
 * the split into shares show them so.
 */
export function printFingerprints(
  mode: MaskingMode,
  original: string,
  encoded: string | undefined,
): void {
  const masking = Masking.of(mode);
  if (terminalLayout("stderr")) {
    console.error("");
    terminalStatus(PHRASE_WORDS.originalFingerprint, original);
    if (encoded === undefined)
      terminalStatus(masking.encodedFingerprintLabel, NO_ENCODED_FINGERPRINT, false);
    else terminalStatus(masking.encodedFingerprintLabel, encoded);
    if (masking.masked) terminalHint(PHRASE_WORDS.fingerprintRoles);
  } else {
    console.error(plainFingerprintLine("original", original));
    console.error(
      encoded === undefined
        ? `Encoded BIP32 master fingerprint: ${NO_ENCODED_FINGERPRINT}.`
        : plainFingerprintLine("encoded", encoded, masking.masked),
    );
  }
}

/**
 * The codes of a backup under their header, mode, form and what they hold: Encode's result, and
 * the whole phrase that a split into shares shows beside them with --format.
 */
export function printEncodedBackup(backup: EncodedBackup, title = "Encoded result"): void {
  const label = encodedOutputLabel(backup.format, backup.mode);
  if (
    !terminalResultHeader(title, [
      ["Mode", backup.mode],
      ["Format", backup.format],
      ["Content", label],
    ])
  )
    console.log(`${label}:`);
  for (const line of backupCodeLines(backup.text(), backup.format)) console.log(line);
}

/** `sentence` on standard error, wrapped on a terminal (runningLines). */
function printSentence(sentence: string): void {
  for (const line of runningLines(process.stderr, sentence)) console.error(line);
}

/** Reporting is separate from transformation and file side effects. */
export function printEncodeResult(
  outcome: EncodeOutcome,
  showMaskedWords = false,
  originalCopy = false,
): void {
  // Save and retry notices follow this result; every later question retains its beginning.
  PrivateSteps.showResult("start");
  const { mode, encoding } = outcome;
  const { backup, result, base, validLastWord } = encoding;
  const legacy = Masking.of(mode).withValidLastWord !== undefined;
  if (legacy && encoding.lastWordChanged) terminalMore("transformation-modes");
  printEncodedBackup(backup);
  // Codes in words already print these words (writtenInWords).
  if (showMaskedWords && !EncodedForm.of(backup.format).writtenInWords)
    printMaskedWords(result.shiftedEnglish.join(" "), backup.mode);
  if (originalCopy) printOriginalCopy(result.sourceMnemonic);
  // By the rule that decode and sskr-combine show it by (EncodedBackup.fingerprint): only codes
  // that are a valid BIP39 phrase have one, which the Original Seedshift's are only by chance.
  printFingerprints(
    backup.mode,
    masterFingerprint(result.sourceMnemonic),
    backup.fingerprint(masterFingerprint),
  );

  if (legacy) {
    if (!encoding.lastWordChanged) {
      printSentence(
        "Legacy shifted phrase already has a valid BIP39 checksum; no final-word replacement is needed.",
      );
    } else if (!encoding.replaced) {
      printSentence(
        `Optional checksum-valid final word: ${defined(validLastWord).shiftedEnglish.at(-1)}`,
      );
      printSentence(
        `Optional checksum-valid legacy phrase: ${defined(validLastWord).shiftedEnglish.join(" ")}`,
      );
    } else {
      printSentence(
        `Replaced legacy final word ${base.shiftedEnglish.at(-1)} with checksum-valid word ${result.shiftedEnglish.at(-1)}.`,
      );
      printSentence("The shifted last word is not stored; decoding lists the candidates.");
    }
  }
}
