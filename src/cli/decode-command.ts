import {
  decodeIndexesLegacyValid,
  decodeInput,
  decodeInputDirect,
  decodeInputLegacy,
  parseDate,
  parseInput,
  type DateShiftDate,
} from "../core.js";
import { masterFingerprint } from "../bitcoin-evidence.js";
import { parseRecord } from "../record.js";
import { type ParsedArguments, value, values } from "./arguments.js";
import {
  askSecret,
  dates,
  encodedInput,
  recordedInputFormat,
  transformMode,
  type EncodedFormat,
  type TransformMode,
} from "./input.js";
import { terminalColor, terminalHint, terminalResultHeader, terminalStatus } from "./terminal.js";

export async function runDecode(arguments_: ParsedArguments): Promise<void> {
  let rawEncoded: string;
  let promptedDates: readonly DateShiftDate[] | undefined;
  if (arguments_["ask-secrets"] === true) {
    if (
      value(arguments_, "input") !== undefined ||
      value(arguments_, "input-file") !== undefined ||
      value(arguments_, "qr-file") !== undefined ||
      values(arguments_, "date").length > 0
    ) {
      throw new Error(
        "Hidden input cannot be combined with direct encoded text, an encoded input file, a QR input file, or command-line dates.",
      );
    }
    rawEncoded = askSecret("Encoded record:");
    const embedded = parseRecord(rawEncoded);
    const promptedMode = transformMode(arguments_, embedded?.mode);
    promptedDates =
      promptedMode === "direct"
        ? []
        : askSecret("Date list (DD-MM-YYYY, separated by spaces):")
            .split(/\s+/u)
            .filter(Boolean)
            .map(parseDate);
  } else {
    rawEncoded = await encodedInput(arguments_);
  }
  const record = parseRecord(rawEncoded);
  const mode = transformMode(arguments_, record?.mode);
  const enteredDates = promptedDates ?? dates(arguments_);
  if (mode === "direct" && enteredDates.length > 0)
    throw new Error("Dates cannot be used in direct mode.");
  if (mode !== "direct" && enteredDates.length === 0)
    throw new Error(`${mode} requires at least one date.`);
  const encoded = record?.payload ?? rawEncoded;
  const format = await recordedInputFormat(arguments_, encoded, record);
  if (mode === "seedshift-legacy-valid") {
    const candidates = decodeIndexesLegacyValid(parseInput(encoded, format), enteredDates);
    for (const [index, candidate] of candidates.entries()) {
      console.log(
        `${index + 1}\t${candidate.recoveredMnemonic}\t${masterFingerprint(candidate.recoveredMnemonic)}`,
      );
    }
    console.error(
      `Recovered ${candidates.length} checksum-valid candidates. The final column is the BIP32 master fingerprint for an empty BIP39 passphrase.`,
    );
    return;
  }
  const result = decodeByMode(encoded, format, enteredDates, mode);
  terminalResultHeader("Recovered result", [
    ["Mode", mode],
    ["Input format", format],
    ["Words", String(result.recoveredIndexes.length)],
  ]);
  console.log(result.recoveredMnemonic);
  if (terminalColor("stderr")) {
    console.error("");
    if (result.checksumValid) terminalStatus("BIP39 checksum", "valid");
    else terminalStatus("BIP39 checksum", "invalid - dates or input may be wrong", false);
    if (result.checksumValid) {
      terminalStatus("Recovered fingerprint", masterFingerprint(result.recoveredMnemonic));
      terminalHint("Fingerprint uses an empty BIP39 passphrase.");
    }
  } else {
    console.error(
      result.checksumValid
        ? "BIP39 checksum: valid."
        : "BIP39 checksum: invalid — dates or input may be wrong.",
    );
    if (result.checksumValid)
      console.error(
        `Recovered BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.recoveredMnemonic)}`,
      );
  }
}

function decodeByMode(
  encoded: string,
  format: EncodedFormat,
  dates: readonly DateShiftDate[],
  mode: TransformMode,
) {
  if (mode === "direct") return decodeInputDirect(encoded, format);
  if (mode === "seedshift-legacy") return decodeInputLegacy(encoded, format, dates);
  return decodeInput(encoded, format, dates);
}
