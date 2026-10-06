import { terminalMore, terminalNotice, terminalResultHeader } from "./terminal.js";
import {
  datePatternCombinationCount,
  dateRecoveryCandidates,
  formatDate,
  parseDate,
  parseDatePattern,
  parseInput,
} from "../core.js";
import { matchBitcoinEvidence } from "../bitcoin-evidence.js";
import { parseRecord } from "../record.js";
import { integerOption, type ParsedArguments, value, values } from "./arguments.js";
import { bip39Passphrase, bitcoinEvidence } from "./bitcoin-options.js";
import {
  encodedInput,
  promptedRecoveryInputs,
  recordedInputFormat,
  transformMode,
} from "./input.js";
import { optionLabel } from "./option-copy.js";
import { candidatesTarget, prepareCandidates, saveCandidates } from "./candidates-file.js";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { MAX_CANDIDATE_RECORDS } from "../core/candidate-list.js";

const DEFAULT_MAX_CANDIDATES = 1_000_000;
const HARD_MAX_CANDIDATES = 10_000_000;
const MAX_INCOMPLETE_DATES = 3;

/**
 * Checksum-valid Seedshift gives a valid phrase for every date, so only the wallet can tell the
 * right dates: without a fingerprint, an address, a public key or a WIF there is nothing to search.
 */
function assertWalletEvidence(mode: string, evidence: unknown): void {
  if ((mode === "seedshift" || mode === "seedshift-legacy-valid") && evidence === undefined)
    throw new Error(
      "This recovery mode can produce checksum-valid candidates for every date. Provide a master fingerprint, address, public key, extended public key, or WIF to identify the intended wallet.",
    );
}

export async function runRecoverDate(arguments_: ParsedArguments): Promise<void> {
  const maxResults = integerOption(arguments_, "max-results", {
    defaultValue: 100,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const progressEvery = integerOption(arguments_, "progress-every", {
    defaultValue: 1000,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const maxCandidates = integerOption(arguments_, "max-candidates", {
    defaultValue: DEFAULT_MAX_CANDIDATES,
    min: 1,
    max: HARD_MAX_CANDIDATES,
  });
  const target = await candidatesTarget(arguments_);
  // Checked before any secret is asked when --mode names the mode; a record file names its own.
  const givenMode = value(arguments_, "mode");
  if (givenMode !== undefined)
    assertWalletEvidence(transformMode(arguments_), bitcoinEvidence(arguments_));
  const prompted = await promptedRecoveryInputs(arguments_, (record) =>
    assertWalletEvidence(transformMode(arguments_, record?.mode), bitcoinEvidence(arguments_)),
  );
  const rawEncoded = prompted !== undefined ? prompted.encoded : await encodedInput(arguments_);
  const record = parseRecord(rawEncoded);
  if (record?.mode === "direct")
    throw new Error("Date recovery is available only for records created with Seedshift.");
  const recoveryMode = transformMode(arguments_, record?.mode);
  if (recoveryMode === "direct")
    throw new Error("Date recovery is available only when a Seedshift mode is selected.");
  const encoded = record?.payload ?? rawEncoded;
  const format = await recordedInputFormat(arguments_, encoded, record);
  const encryptedIndexes = parseInput(encoded, format);
  const dateValues = prompted?.dateValues ?? values(arguments_, "date");
  if (dateValues.length === 0)
    throw new Error("Provide dates, including at least one pattern containing ? digits.");
  if (dateValues.length > encryptedIndexes.length / 3)
    throw new Error(
      `${encryptedIndexes.length}-word phrases support at most ${encryptedIndexes.length / 3} dates.`,
    );
  const patternValues = dateValues.filter((item) => item.includes("?"));
  if (patternValues.length === 0)
    throw new Error("At least one date must contain a forgotten digit represented by ?.");
  if (patternValues.length > MAX_INCOMPLETE_DATES)
    throw new Error(`Date recovery supports at most ${MAX_INCOMPLETE_DATES} incomplete dates.`);
  const patterns = patternValues.map(parseDatePattern);
  const candidateCount = datePatternCombinationCount(patterns, HARD_MAX_CANDIDATES);
  if (candidateCount > HARD_MAX_CANDIDATES) {
    throw new Error(
      `The date patterns produce more than ${HARD_MAX_CANDIDATES.toLocaleString("en-US")} combinations, which exceeds the safety limit. Narrow at least one pattern.`,
    );
  }
  if (candidateCount > maxCandidates) {
    const formattedCandidateCount = candidateCount.toLocaleString("en-US");
    throw new Error(
      `The date patterns produce ${formattedCandidateCount} combinations. Increase the candidate search limit to at least ${formattedCandidateCount} to continue.`,
    );
  }
  const knownDates = dateValues.filter((item) => !item.includes("?")).map(parseDate);
  const evidence = bitcoinEvidence(arguments_);
  assertWalletEvidence(recoveryMode, evidence);
  const passphrase = bip39Passphrase(arguments_);
  await prepareCandidates(target, passphrase);

  terminalNotice(
    `Recovery search contains ${candidateCount.toLocaleString("en-US")} date combinations.`,
  );
  if (candidateCount >= 100_000)
    terminalNotice("This is a large local search and may take hours. Progress will be reported.");
  const found: { readonly dates: string; readonly mnemonic: string; readonly evidence?: string }[] =
    [];
  // Every match, for a candidate list; the screen shows the first maxResults of them.
  const kept: string[] = [];
  let checked = 0;
  let foundCount = 0;
  for (const candidates of dateRecoveryCandidates(
    encryptedIndexes,
    knownDates,
    patterns,
    recoveryMode,
  )) {
    checked += 1;
    for (const candidate of candidates) {
      const match =
        evidence === undefined
          ? undefined
          : matchBitcoinEvidence(candidate.mnemonic, evidence, passphrase);
      if (match !== undefined && !match.matched) continue;
      foundCount += 1;
      if (target !== undefined && kept.length <= MAX_CANDIDATE_RECORDS)
        kept.push(candidate.mnemonic);
      if (found.length < maxResults)
        found.push({
          dates: candidate.dates.map(formatDate).join(" "),
          mnemonic: candidate.mnemonic,
          evidence: match?.path,
        });
    }
    if (checked % progressEvery === 0 || checked === candidateCount) {
      terminalNotice(
        `Checked ${checked}/${candidateCount} date combinations; found ${foundCount} ${foundCount === 1 ? "match" : "matches"}.`,
      );
    }
  }
  terminalResultHeader("Date recovery", [
    ["Mode", recoveryMode],
    ["Matches", String(foundCount)],
  ]);
  if (foundCount === 0) {
    console.log("No candidate with a valid BIP39 checksum was found.");
    return;
  }
  for (const candidate of found) {
    console.log(
      `${candidate.dates}\t${candidate.mnemonic}${candidate.evidence === undefined ? "" : `\tmatched at ${candidate.evidence}`}`,
    );
  }
  if (foundCount > maxResults)
    terminalNotice(`Displayed ${maxResults} of ${foundCount} checksum-valid candidates.`);
  if (target !== undefined) {
    if (foundCount > MAX_CANDIDATE_RECORDS)
      throw new Error(
        `${foundCount.toLocaleString("en-US")} candidates are more than one list holds (${MAX_CANDIDATE_RECORDS.toLocaleString("en-US")}): narrow the dates, or give the wallet's fingerprint.`,
      );
    await saveCandidates(
      target,
      kept.map((phrase) => mnemonicToEntropy(phrase, wordlist)),
      passphrase,
    );
  }
  if (evidence === undefined) {
    terminalNotice("A valid checksum does not prove the date: compare an address.");
    terminalMore("exact-local-recovery-checks");
  } else
    terminalNotice(
      `Each displayed candidate matched the requested ${optionLabel(evidence.kind)} locally.`,
    );
}
