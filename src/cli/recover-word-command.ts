import { recoverLegacyValidLastWords } from "../core.js";
import {
  entropyOfWords,
  insertedPlace,
  parseMissingWord,
  parseUnknownWords,
  phraseOfWords,
  searchCandidates,
  searchCombinations,
  type CandidateWords,
  type WordSearch,
} from "../core/candidates.js";
import { englishWordlist } from "../core/words.js";
import { matchBitcoinEvidence, type EvidenceMatch } from "../bitcoin-evidence.js";
import { type ParsedArguments, value } from "./arguments.js";
import { bip39Passphrase, bitcoinEvidence } from "./bitcoin-options.js";
import { askSecret, textInput } from "./input.js";
import { terminalHint, terminalMore, terminalNotice, terminalResultHeader } from "./terminal.js";
import { optionLabel } from "./option-copy.js";
import { candidatesTarget, prepareCandidates, saveCandidates } from "./candidates-file.js";
import { MAX_CANDIDATE_RECORDS } from "../core/candidate-list.js";

/**
 * Rows shown at most: enough for a word missing at an unknown place of 12 words, about 1,500. More
 * candidates go to a candidate list, or through a wallet check.
 */
const MAX_SHOWN = 2_048;
/** Seconds between two progress lines of a long wallet check. */
const PROGRESS_SECONDS = 10;
/** Wallet checks between two turns of the event loop, about a fifth of a second, so that Ctrl+C works. */
const CHECKS_PER_TURN = 200;
/** Candidates between two turns without a wallet check: some 65,000 combinations, a fraction of a second. */
const CANDIDATES_PER_TURN = 4_096;
const BIP39_INDEX_BITS = 11;

/** The checksum bits at the end of the last word, as the table shows them. */
function checksumBits(words: CandidateWords): string {
  return words
    .at(-1)!
    .toString(2)
    .padStart(BIP39_INDEX_BITS, "0")
    .slice(-words.length / 3);
}

/** The table's columns for the candidates of `search`, and a row maker. */
function tableOf(search: WordSearch): {
  readonly heading: readonly string[];
  readonly row: (words: CandidateWords) => readonly string[];
} {
  const word = (index: number) => [englishWordlist[index]!, String(index + 1)];
  if (search.kind === "missing-word")
    return {
      heading: ["position", "word", "word-index"],
      row: (words) => {
        const place = insertedPlace(search.written, words);
        return [String(place + 1), ...word(words[place]!)];
      },
    };
  const unknown = search.places.flatMap((place, index) => (place.length > 1 ? [index] : []));
  if (unknown.length === 1)
    return {
      heading: ["word", "word-index", "checksum-bits"],
      row: (words) => [...word(words[unknown[0]!]!), checksumBits(words)],
    };
  return {
    heading: ["words"],
    row: (words) => [
      unknown.map((place) => `${place + 1}:${englishWordlist[words[place]!]}`).join(" "),
    ],
  };
}

/** The phrase as typed or read, and what it asks for. */
async function phraseInput(args: ParsedArguments, prompt: string): Promise<string> {
  if (args["ask-secrets"] !== true) return textInput(args, "mnemonic");
  if (value(args, "mnemonic") !== undefined || value(args, "mnemonic-file") !== undefined)
    throw new Error(
      "--ask-secrets cannot be combined with direct mnemonic text or a mnemonic file.",
    );
  return askSecret(prompt);
}

/** A candidate as the search gives it: its table columns, its phrase, and its words if known. */
interface Candidate {
  readonly columns: readonly string[];
  readonly mnemonic: string;
  readonly words?: CandidateWords;
}

/** A shown row: the candidate's number, counting from 1, and the wallet check if there was one. */
interface Row extends Candidate {
  readonly number: number;
  readonly match?: EvidenceMatch;
}

export async function runRecoverWord(arguments_: ParsedArguments): Promise<void> {
  const legacy = arguments_["legacy-valid-last-word"] === true;
  const missing = arguments_["missing-word"] === true;
  if (legacy && missing)
    throw new Error("--legacy-valid-last-word and --missing-word cannot be combined.");
  const target = await candidatesTarget(arguments_);
  // The replacements are stored phrases, not wallets: the Scanner would search the wrong ones.
  if (legacy && target !== undefined)
    throw new Error("--legacy-valid-last-word lists replacements, not wallets: no candidate list.");
  const evidence = bitcoinEvidence(arguments_);
  const passphrase = bip39Passphrase(arguments_);
  const text = await phraseInput(
    arguments_,
    legacy
      ? "Exact legacy Seedshift phrase with its old final word:"
      : missing
        ? "The words you have, in their order:"
        : "Seed phrase, ? for each forgotten word:",
  );
  await prepareCandidates(target, passphrase);

  let heading: readonly string[];
  let candidates: Iterable<Candidate>;
  const headerRows: [string, string][] = [];
  if (legacy) {
    const replacements = recoverLegacyValidLastWords(text);
    heading = ["word", "word-index", "checksum-bits", "legacy-tail"];
    candidates = replacements.map((candidate) => ({
      columns: [
        candidate.word,
        String(candidate.wordIndex),
        candidate.checksumBits,
        candidate.preservesLegacyEntropy ? "preserved" : "alternative",
      ],
      mnemonic: candidate.mnemonic,
    }));
    headerRows.push(
      ["Mode", "Legacy final-word replacement"],
      ["Position", String(replacements[0]?.position ?? "")],
      [
        "Entropy-preserving replacement",
        replacements.find((candidate) => candidate.preservesLegacyEntropy)?.word ?? "unavailable",
      ],
    );
  } else {
    const search = missing ? parseMissingWord(text) : parseUnknownWords(text);
    const table = tableOf(search);
    heading = table.heading;
    candidates = (function* () {
      for (const words of searchCandidates(search))
        yield { columns: table.row(words), mnemonic: phraseOfWords(words), words };
    })();
    if (search.kind === "unknown-words") {
      const unknown = search.places.flatMap((place, index) =>
        place.length > 1 ? [index + 1] : [],
      );
      headerRows.push([unknown.length === 1 ? "Position" : "Positions", unknown.join(", ")]);
    } else headerRows.push(["Missing word", "at any position"]);
    headerRows.push(["Combinations", searchCombinations(search).toLocaleString("en-US")]);
  }

  // The first MAX_SHOWN candidates are kept for the screen, and every one that matches the
  // wallet; a list keeps the entropy of every candidate, so that record N is candidate N.
  const rows: Row[] = [];
  const entropies: Uint8Array[] = [];
  let count = 0;
  let matched = 0;
  let warning: string | undefined;
  let shown = Date.now();
  for (const candidate of candidates) {
    count += 1;
    if (target !== undefined && count > MAX_CANDIDATE_RECORDS)
      throw new Error(
        `More than ${MAX_CANDIDATE_RECORDS.toLocaleString("en-US")} candidates, more than one list holds: give more of the words, or a few letters of them.`,
      );
    const match =
      evidence === undefined
        ? undefined
        : matchBitcoinEvidence(candidate.mnemonic, evidence, passphrase);
    if (match?.matched === true) matched += 1;
    warning ??= match?.warning;
    if (target !== undefined) entropies.push(entropyOfWords(candidate.words!));
    if (count <= MAX_SHOWN || match?.matched === true)
      rows.push({
        columns: candidate.columns,
        mnemonic: candidate.mnemonic,
        number: count,
        ...(match === undefined ? {} : { match }),
      });
    // Ctrl+C and progress get a turn now and then; a wallet check takes about a millisecond.
    if (count % (evidence === undefined ? CANDIDATES_PER_TURN : CHECKS_PER_TURN) === 0) {
      await new Promise((resolve) => setImmediate(resolve));
      if (Date.now() - shown >= PROGRESS_SECONDS * 1000) {
        shown = Date.now();
        terminalHint(`${count.toLocaleString("en-US")} candidates so far.`);
      }
    }
  }
  headerRows.push(["Checksum-valid candidates", count.toLocaleString("en-US")]);
  if (count === 0) {
    terminalResultHeader("Missing word recovery", headerRows);
    terminalNotice(
      "No valid phrase fits these words: check them, their order and the ? places.",
      "warning",
    );
    if (target !== undefined) await saveCandidates(target, []);
    return;
  }
  if (evidence !== undefined) headerRows.push(["Evidence matches", String(matched)]);
  terminalResultHeader("Missing word recovery", headerRows);

  // Every candidate is shown when they are few; otherwise only those that match the wallet,
  // each with its number among all of them.
  const listed = count <= MAX_SHOWN ? rows : rows.filter((row) => row.match?.matched === true);
  if (listed.length > 0) {
    console.log(
      ["candidate", ...heading, ...(evidence === undefined ? [] : ["evidence"]), "mnemonic"].join(
        "\t",
      ),
    );
    for (const row of listed) {
      const fields = [String(row.number), ...row.columns];
      if (row.match !== undefined)
        fields.push(
          row.match.matched
            ? `matched at ${row.match.path ?? "requested evidence"}`
            : "not matched",
        );
      console.log([...fields, row.mnemonic].join("\t"));
    }
  }
  if (target !== undefined) {
    try {
      await saveCandidates(target, entropies, passphrase);
    } finally {
      for (const entropy of entropies) entropy.fill(0);
    }
  } else if (count > MAX_SHOWN && evidence === undefined)
    terminalNotice(
      count <= MAX_CANDIDATE_RECORDS
        ? `${count.toLocaleString("en-US")} candidates are too many to show: save them with --candidates-file for the Discovery Scanner, or check them against the wallet's fingerprint or an address.`
        : `${count.toLocaleString("en-US")} candidates are too many to show or to save: check them against the wallet's fingerprint or an address, or give a few letters of the words.`,
      "warning",
    );

  if (legacy)
    terminalNotice(
      "All checksum-valid last words; the row marked preserved keeps the old word's data.",
    );
  else
    terminalNotice(
      "Every combination was checked; only those with a valid BIP39 checksum are candidates.",
    );
  if (evidence === undefined) {
    terminalNotice("A valid checksum does not prove the wallet: compare an address.", "warning");
    terminalMore("exact-local-recovery-checks");
  } else {
    terminalNotice(
      `Matched ${matched} of ${count.toLocaleString("en-US")} candidates against the requested ${optionLabel(evidence.kind)} locally.`,
      matched === 0 ? "warning" : "success",
    );
    if (warning !== undefined) terminalNotice(warning, "warning");
  }
  if (legacy && evidence !== undefined)
    terminalNotice(
      "Evidence was compared with the replacements, not with the original legacy phrases.",
      "warning",
    );
}
