import { recoverLegacyValidLastWords, recoverMissingWord } from "../core.js";
import { matchBitcoinEvidence } from "../bitcoin-evidence.js";
import { type ParsedArguments, value } from "./arguments.js";
import { bip39Passphrase, bitcoinEvidence } from "./bitcoin-options.js";
import { askSecret, textInput } from "./input.js";
import { terminalMore, terminalNotice, terminalResultHeader } from "./terminal.js";
import { optionLabel } from "./option-copy.js";

export async function runRecoverWord(arguments_: ParsedArguments): Promise<void> {
  const recoverLegacyReplacement = arguments_["legacy-valid-last-word"] === true;
  let mnemonic: string;
  if (arguments_["ask-secrets"] === true) {
    if (
      value(arguments_, "mnemonic") !== undefined ||
      value(arguments_, "mnemonic-file") !== undefined
    ) {
      throw new Error(
        "--ask-secrets cannot be combined with direct mnemonic text or a mnemonic file.",
      );
    }
    mnemonic = await askSecret(
      recoverLegacyReplacement
        ? "Exact legacy Seedshift phrase with its old final word:"
        : "Seed phrase with ? for the forgotten word:",
    );
  } else {
    mnemonic = textInput(arguments_, "mnemonic");
  }

  const candidates = recoverLegacyReplacement
    ? recoverLegacyValidLastWords(mnemonic)
    : recoverMissingWord(mnemonic);
  if (candidates.length === 0) {
    terminalResultHeader("Missing word recovery", [["Checksum-valid candidates", "0"]]);
    terminalNotice(
      "No valid phrase fits these words: check them, their order and the ? position.",
      "warning",
    );
    return;
  }
  const evidence = bitcoinEvidence(arguments_);
  const passphrase = bip39Passphrase(arguments_);
  const results = candidates.map((candidate) => {
    const match =
      evidence === undefined
        ? undefined
        : matchBitcoinEvidence(candidate.mnemonic, evidence, passphrase);
    return { candidate, match };
  });
  const matched = results.filter(({ match }) => match?.matched === true).length;

  const headerRows: [string, string][] = [
    ["Position", String(candidates[0]!.position)],
    ["Checksum-valid candidates", String(candidates.length)],
  ];
  if (recoverLegacyReplacement) {
    headerRows.unshift(["Mode", "Legacy final-word replacement"]);
    headerRows.push([
      "Entropy-preserving replacement",
      candidates.find((candidate) => candidate.preservesLegacyEntropy)?.word ?? "unavailable",
    ]);
  }
  if (evidence !== undefined) headerRows.push(["Evidence matches", String(matched)]);
  terminalResultHeader("Missing word recovery", headerRows);
  console.log(
    [
      "candidate",
      "word",
      "word-index",
      "checksum-bits",
      ...(recoverLegacyReplacement ? ["legacy-tail"] : []),
      ...(evidence === undefined ? [] : ["evidence"]),
      "mnemonic",
    ].join("\t"),
  );
  for (const [index, { candidate, match }] of results.entries()) {
    const fields = [
      String(index + 1),
      candidate.word,
      String(candidate.wordIndex),
      candidate.checksumBits,
    ];
    if (recoverLegacyReplacement) {
      fields.push(candidate.preservesLegacyEntropy ? "preserved" : "alternative");
    }
    if (match !== undefined) {
      fields.push(
        match.matched ? `matched at ${match.path ?? "requested evidence"}` : "not matched",
      );
    }
    fields.push(candidate.mnemonic);
    console.log(fields.join("\t"));
  }

  terminalNotice(
    recoverLegacyReplacement
      ? "All checksum-valid last words; the row marked preserved keeps the old word's data."
      : "All 2048 words checked; the checksum column shows each phrase's checksum bits.",
  );
  if (evidence === undefined) {
    terminalNotice("A valid checksum does not prove the wallet: compare an address.", "warning");
    terminalMore("exact-local-recovery-checks");
  } else {
    terminalNotice(
      `Matched ${matched} of ${candidates.length} candidates against the requested ${optionLabel(evidence.kind)} locally.`,
      matched === 0 ? "warning" : "success",
    );
    const warning = results.find(({ match }) => match?.warning !== undefined)?.match?.warning;
    if (warning !== undefined) terminalNotice(warning, "warning");
  }
  if (recoverLegacyReplacement && evidence !== undefined) {
    terminalNotice(
      "Evidence was compared with the replacements, not with the original legacy phrases.",
      "warning",
    );
  }
}
