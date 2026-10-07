// recover-word: finds forgotten or missing words of a seed phrase (core/candidates.ts,
// WordCandidateSearch), or the checksum-valid last words of an exact legacy Seedshift phrase. The
// search, its limits and its numbering are the core's; this module reads the phrase, checks each
// candidate against the wallet, prints the table and asks what comes next. From the command line a
// problem ends the command. With --ask-secrets, on the private screen, the phrase is checked as
// soon as it is typed, before the list's passphrase is asked, and asked again; a search without a
// usable result, or with more candidates than the window shows, offers what to change, keeping the
// list, its protection and its passphrase.

import { isatty } from "node:tty";
import { recoverLegacyValidLastWords, type MissingWordCandidate } from "../core.js";
import {
  MAX_SHOWN_CANDIDATES,
  NARROW_WORD_SEARCH,
  WordCandidateSearch,
  type WordCandidate,
} from "../core/candidates.js";
import { MAX_CANDIDATE_RECORDS, TooManyForList } from "../core/candidate-list.js";
import { englishWordlist } from "../core/words.js";
import {
  assertWalletEvidence,
  walletCheckOf,
  type WalletEvidence,
  type EvidenceMatch,
} from "../bitcoin-evidence.js";
import { type ParsedArguments, value } from "./arguments.js";
import {
  askAfterFailure,
  askSecretUntil,
  askWalletEvidence,
  assertWalletPlaceUsed,
  walletPlaceOf,
  type WalletPlace,
} from "./ask.js";
import { bip39Passphrase, walletEvidence } from "./bitcoin-options.js";
import { textInput } from "./input.js";
import { onPrivateScreen } from "./private-screen.js";
import {
  ProgressLine,
  readmeLink,
  terminalMore,
  terminalNotice,
  terminalResultHeader,
  wrapText,
} from "./terminal.js";
import type { Choice } from "./terminal-choice.js";
import { evidenceLabel, optionLabel } from "./option-copy.js";
import {
  assertListable,
  candidatesTarget,
  discardCandidates,
  prepareCandidates,
  saveCandidates,
  type CandidatesTarget,
} from "./candidates-file.js";
import {
  rowsOfOutputLine,
  rowsOfText,
  terminalColumns,
  terminalRows,
  withCtrlCWatch,
} from "./terminal-input.js";

/** Seconds between two progress lines of a long wallet check. */
const PROGRESS_SECONDS = 10;

/** The table's columns for the candidates of `search`, and a row maker. */
function tableOf(search: WordCandidateSearch): {
  readonly heading: readonly string[];
  readonly row: (candidate: WordCandidate) => readonly string[];
} {
  const word = (index: number) => [englishWordlist[index]!, String(index + 1)];
  if (search.kind === "missing-word")
    return {
      heading: ["position", "word", "word-index"],
      row: (candidate) => {
        const place = search.placesOf(candidate)[0]!;
        return [String(place + 1), ...word(candidate.words[place]!)];
      },
    };
  const unknown = search.unknownPlaces;
  if (unknown.length === 1)
    return {
      heading: ["word", "word-index", "checksum-bits"],
      row: (candidate) => [...word(candidate.words[unknown[0]!]!), candidate.checksumBits],
    };
  return {
    heading: ["words"],
    row: (candidate) => [
      unknown.map((place) => `${place + 1}:${englishWordlist[candidate.words[place]!]}`).join(" "),
    ],
  };
}

/** What a phrase asks for: the replacements of a legacy last word, or a search of words. */
type PhraseSearch =
  | { readonly kind: "legacy"; readonly replacements: readonly MissingWordCandidate[] }
  | { readonly kind: "words"; readonly search: WordCandidateSearch };

/** How the phrase is read: the options that say what it holds, and whether a list is saved. */
interface PhraseRules {
  readonly legacy: boolean;
  readonly missing: boolean;
  readonly listed: boolean;
}

/**
 * Reads the phrase and refuses one that cannot be searched, before any further question: words
 * that are no BIP39 words, a wrong count, a search of more than 2^24 combinations, and one that
 * surely finds more candidates than a list holds. The messages name only places.
 */
function parsePhrase(text: string, rules: PhraseRules): PhraseSearch {
  if (rules.legacy) {
    // A ? typed out of habit would read as an unknown word at its place.
    if (text.split(/\s+/u).includes("?"))
      throw new Error("This mode needs the exact old final word: ? stands for no word here.");
    return { kind: "legacy", replacements: recoverLegacyValidLastWords(text) };
  }
  const search = WordCandidateSearch.parse(text, rules.missing ? "missing-word" : "unknown-words");
  const expected = search.expected;
  if (rules.listed && expected.exact && expected.count > MAX_CANDIDATE_RECORDS)
    throw new TooManyForList(NARROW_WORD_SEARCH);
  return { kind: "words", search };
}

/**
 * A shown row: its table columns, its phrase, the candidate's number, counting from 1, and the
 * wallet check if there was one.
 */
interface Row {
  readonly columns: readonly string[];
  readonly mnemonic: string;
  readonly number: number;
  readonly match?: EvidenceMatch;
}

/** The heading of a search's table: its columns, and the facts of its heading. */
interface Table {
  readonly heading: readonly string[];
  readonly headerRows: [string, string][];
}

/** The table of `phrase`. */
function tableFor(phrase: PhraseSearch): Table {
  if (phrase.kind === "legacy") {
    const { replacements } = phrase;
    return {
      heading: ["word", "word-index", "checksum-bits", "legacy-tail"],
      headerRows: [
        ["Mode", "Legacy final-word replacement"],
        ["Position", String(replacements[0]?.position ?? "")],
        [
          "Entropy-preserving replacement",
          replacements.find((candidate) => candidate.preservesLegacyEntropy)?.word ?? "unavailable",
        ],
      ],
    };
  }
  const { search } = phrase;
  const headerRows: [string, string][] = [];
  if (search.kind === "unknown-words") {
    const unknown = search.unknownPlaces.map((place) => place + 1);
    headerRows.push([unknown.length === 1 ? "Position" : "Positions", unknown.join(", ")]);
  } else headerRows.push(["Missing word", "at any position"]);
  headerRows.push(["Combinations", search.combinations.toLocaleString("en-US")]);
  return { heading: tableOf(search).heading, headerRows };
}

/** Where the candidates go and what they are compared with. */
interface SearchContext {
  readonly target: CandidatesTarget | undefined;
  readonly evidence: WalletEvidence | undefined;
  readonly passphrase: string;
  /** Where a wallet asked after the search is looked for. */
  readonly place: WalletPlace;
}

/** What a search found. */
interface Found {
  /** The first MAX_SHOWN_CANDIDATES candidates, and every one that matched the wallet. */
  readonly rows: Row[];
  /** The entropy of every candidate for a list, record N for candidate N; wiped after use. */
  readonly entropies: Uint8Array[];
  readonly count: number;
  readonly matched: number;
  readonly warning: string | undefined;
}

/** The next turn of Node's event loop, after the input that waits, such as Ctrl+C read as a key. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Runs the search of `phrase` with the core's rules (WordCandidateSearch.run): every candidate is
 * counted and compared with the wallet, the first MAX_SHOWN_CANDIDATES and every one that matched
 * are kept for the screen, and a list keeps the entropy of every candidate, so that record N is
 * candidate N; past the most that a list holds the search stops (TooManyForList). Ctrl+C is read as
 * a key during the turns and stops it at the next one. The replacements of a legacy last word are
 * a short fixed list, each compared with the wallet.
 */
async function collect(phrase: PhraseSearch, context: SearchContext): Promise<Found> {
  const walletCheck = walletCheckOf(context.evidence, context.passphrase);
  if (phrase.kind === "legacy") {
    const rows = phrase.replacements.map((candidate, index): Row => {
      const match = walletCheck?.(candidate.mnemonic);
      return {
        columns: [
          candidate.word,
          String(candidate.wordIndex),
          candidate.checksumBits,
          candidate.preservesLegacyEntropy ? "preserved" : "alternative",
        ],
        mnemonic: candidate.mnemonic,
        number: index + 1,
        ...(match === undefined ? {} : { match }),
      };
    });
    return {
      rows,
      entropies: [],
      count: rows.length,
      matched: rows.filter((row) => row.match?.matched === true).length,
      warning: rows.find((row) => row.match?.warning !== undefined)?.match?.warning,
    };
  }
  const { search } = phrase;
  const table = tableOf(search);
  let shown = Date.now();
  const progress = new ProgressLine();
  const result = await withCtrlCWatch((signal) =>
    search.run({
      walletCheck,
      keep: context.target === undefined ? 0 : MAX_CANDIDATE_RECORDS,
      onListFull: () => {
        throw new TooManyForList(NARROW_WORD_SEARCH);
      },
      onProgress: ({ count }) => {
        if (Date.now() - shown < PROGRESS_SECONDS * 1000) return;
        shown = Date.now();
        progress.show(`${count.toLocaleString("en-US")} candidates so far.`);
      },
      signal,
      turn: nextTurn,
    }),
  ).finally(() => progress.end());
  const rows = result.shown.map(({ candidate, match }): Row => ({
    columns: table.row(candidate),
    mnemonic: candidate.phrase,
    number: candidate.number,
    ...(match === undefined ? {} : { match: match as EvidenceMatch }),
  }));
  return {
    rows,
    entropies: result.entropies,
    count: result.count,
    matched: result.matched,
    warning: result.warning,
  };
}

function wipe(entropies: readonly Uint8Array[]): void {
  for (const entropy of entropies) entropy.fill(0);
}

/** What comes after a search on the private screen. */
type Next =
  | { readonly kind: "done" }
  /** The phrase is typed again; the list, its protection and its passphrase are kept. */
  | { readonly kind: "phrase" }
  /** The same phrase is searched again with this wallet; `listed` false leaves the list out. */
  | {
      readonly kind: "wallet";
      readonly evidence: WalletEvidence | undefined;
      readonly listed: boolean;
    };

const DONE: Next = { kind: "done" };
const PHRASE: Next = { kind: "phrase" };

export async function runRecoverWord(arguments_: ParsedArguments): Promise<void> {
  const legacy = arguments_["legacy-valid-last-word"] === true;
  const missing = arguments_["missing-word"] === true;
  if (legacy && missing)
    throw new Error("--legacy-valid-last-word and --missing-word cannot be combined.");
  let target = await candidatesTarget(arguments_);
  // The replacements are stored phrases, not wallets: the Scanner would search the wrong ones.
  if (legacy && target !== undefined)
    throw new Error("--legacy-valid-last-word lists replacements, not wallets: no candidate list.");
  let evidence = walletEvidence(arguments_);
  if (evidence !== undefined) assertWalletEvidence(evidence);
  const asked = arguments_["ask-secrets"] === true;
  assertWalletPlaceUsed(arguments_, evidence);
  // Where a wallet asked later is looked for: as the one given, if any.
  const place = walletPlaceOf(evidence, arguments_);
  const passphrase = bip39Passphrase(arguments_);
  assertListable(target, passphrase);
  if (
    asked &&
    (value(arguments_, "mnemonic") !== undefined ||
      value(arguments_, "mnemonic-file") !== undefined)
  )
    throw new Error(
      "--ask-secrets cannot be combined with direct mnemonic text or a mnemonic file.",
    );
  const prompt = legacy
    ? "Exact legacy Seedshift phrase with its old final word:"
    : missing
      ? "The words you have, in their order:"
      : "Seed phrase, ? for each forgotten word:";
  const read = async (): Promise<PhraseSearch> => {
    const rules = { legacy, missing, listed: target !== undefined };
    if (!asked) return parsePhrase(textInput(arguments_, "mnemonic"), rules);
    return askSecretUntil(prompt, (text) => parsePhrase(text, rules), { what: "the words" });
  };
  let phrase = await read();
  // Only once the phrase can be searched: a list passphrase typed for nothing is lost work.
  await prepareCandidates(target, passphrase);
  for (;;) {
    const next = await searchAndShow(phrase, { target, evidence, passphrase, place }, asked);
    if (next.kind === "done") return;
    if (next.kind === "phrase") phrase = await read();
    else {
      evidence = next.evidence;
      if (!next.listed) target = undefined;
    }
  }
}

/** Searches the candidates of `phrase`, shows them, saves the list, and asks what comes next. */
async function searchAndShow(
  phrase: PhraseSearch,
  context: SearchContext,
  asked: boolean,
): Promise<Next> {
  const table = tableFor(phrase);
  let found: Found;
  try {
    found = await collect(phrase, context);
  } catch (error) {
    if (!(error instanceof TooManyForList) || !asked) throw error;
    terminalNotice(error.message, "warning");
    const next = await askNext(
      [
        { label: "Type the words again", note: "with more letters", value: PHRASE },
        {
          label: "Check them against the wallet",
          note: "without a list",
          value: { kind: "wallet", evidence: undefined, listed: false },
        },
        { label: "Stop", note: "no list is saved", value: DONE },
      ],
      { optional: false, place: context.place },
    );
    if (context.target !== undefined && next.kind !== "phrase") discardCandidates(context.target);
    return next;
  }
  try {
    return await show(phrase, table, found, context, asked);
  } finally {
    wipe(found.entropies);
  }
}

/**
 * Asks what comes next after a search; a choice of the wallet asks for it at once
 * (askWalletEvidence: at `place`, with "It cannot" only when `optional`), and Escape there asks
 * the first question again.
 */
async function askNext(
  choices: readonly Choice<Next>[],
  wallet: { readonly optional: boolean; readonly place: WalletPlace },
): Promise<Next> {
  for (;;) {
    const next = await askAfterFailure("What now?", choices);
    if (next.kind !== "wallet") return next;
    const answer = await askWalletEvidence(wallet);
    if (answer.kind === "back") continue;
    return { ...next, evidence: answer.kind === "wallet" ? answer.evidence : undefined };
  }
}

/** The blank line and the title above the facts of a result's heading (terminalResultHeader). */
const HEADING_ROWS = 2;
/** The line that names a saved list: up to three rows for a file name of some 80 characters. */
const SAVED_LIST_ROWS = 3;
/** The blank line and "Press Enter to clear this screen." that end the private screen. */
const ENTER_ROWS = 2;
/**
 * "What now?" with three choices (askNext): a blank line, the question, the choices, a blank line,
 * the key hint, and the row under it where the cursor waits.
 */
const QUESTION_ROWS = 8;
/** terminalNotice wraps a notice after its mark and a space: the 78 columns of text less two. */
const MARKED_TEXT_WIDTH = 76;

/** A row of the table as it is printed: its fields, separated by tabs. */
function rowLine(row: Row): string {
  const fields = [String(row.number), ...row.columns];
  if (row.match !== undefined)
    fields.push(
      row.match.matched ? `matched at ${row.match.path ?? "requested evidence"}` : "not matched",
    );
  return [...fields, row.mnemonic].join("\t");
}

/**
 * Whether the lines of a table fit on the private screen with `beside` rows of what is shown
 * around them: that screen keeps no scrollback, so a row that scrolled off its top could not be
 * read. Standard output that goes to a file or a pipe takes every row, as the main screen does
 * with its scrollback.
 */
function tableFitsScreen(lines: readonly string[], beside: number): boolean {
  if (!onPrivateScreen() || !isatty(1)) return true;
  const columns = terminalColumns();
  const rows = lines.reduce((total, line) => total + rowsOfOutputLine(line, columns), beside);
  return rows <= terminalRows();
}

/** Why the candidates are not shown, and what narrows them down. */
function tooManyNotice(count: number): string {
  const counted = count.toLocaleString("en-US");
  if (count <= MAX_SHOWN_CANDIDATES)
    return `${counted} candidates do not fit on this screen: check them against the wallet's fingerprint or an address, or give a few letters of the words.`;
  return count <= MAX_CANDIDATE_RECORDS
    ? `${counted} candidates are too many to show: save them with --candidates-file for the Discovery Scanner, or check them against the wallet's fingerprint or an address.`
    : `${counted} candidates are too many to show or to save: check them against the wallet's fingerprint or an address, or give a few letters of the words.`;
}

/** A line after the table: a notice of its kind, or a link to a README section (terminalMore). */
type Note =
  | { readonly text: string; readonly kind: "info" | "success" | "warning" }
  | { readonly more: string };

/** The notes after the table: what a valid checksum proves, or what the wallet check found. */
function notesAfterTable(
  phrase: PhraseSearch,
  found: Found,
  evidence: WalletEvidence | undefined,
): Note[] {
  const legacy = phrase.kind === "legacy";
  const notes: Note[] = [
    {
      text: legacy
        ? "All checksum-valid last words; the row marked preserved keeps the old word's data."
        : "Every combination was checked; only those with a valid BIP39 checksum are candidates.",
      kind: "info",
    },
  ];
  if (evidence === undefined)
    notes.push(
      { text: "A valid checksum does not prove the wallet: compare an address.", kind: "warning" },
      { more: "exact-local-recovery-checks" },
    );
  else {
    notes.push({
      text: `Matched ${found.matched} of ${found.count.toLocaleString("en-US")} candidates against the requested ${evidenceLabel(evidence)} locally.`,
      kind: found.matched === 0 ? "warning" : "success",
    });
    if (found.warning !== undefined) notes.push({ text: found.warning, kind: "warning" });
  }
  if (legacy && evidence !== undefined)
    notes.push({
      text: "Evidence was compared with the replacements, not with the original legacy phrases.",
      kind: "warning",
    });
  return notes;
}

function printNote(note: Note): void {
  if ("more" in note) terminalMore(note.more);
  else terminalNotice(note.text, note.kind);
}

/**
 * The rows that `note` takes on a terminal `columns` wide, as terminalNotice and terminalMore write
 * it in colour; without colours a notice is one line, which takes no more rows.
 */
function noteRows(note: Note, columns: number): number {
  if ("more" in note) return rowsOfText(`More: ${readmeLink(note.more)}`, columns);
  const lines =
    note.kind === "info"
      ? wrapText(note.text)
      : wrapText(note.text, MARKED_TEXT_WIDTH).map((line) => `! ${line}`);
  return lines.reduce((rows, line) => rows + rowsOfText(line, columns), 0);
}

/** Shows what a search found, as from the command line, then asks what comes next if anything. */
async function show(
  phrase: PhraseSearch,
  table: Table,
  found: Found,
  context: SearchContext,
  asked: boolean,
): Promise<Next> {
  const { target, evidence, passphrase } = context;
  const { rows, entropies, count, matched } = found;
  const headerRows = [...table.headerRows];
  headerRows.push(["Checksum-valid candidates", count.toLocaleString("en-US")]);
  if (count === 0) {
    terminalResultHeader("Missing word recovery", headerRows);
    terminalNotice(
      "No valid phrase fits these words: check them, their order and the ? places.",
      "warning",
    );
    const next = asked
      ? await askNext(
          [
            { label: "Type the words again", value: PHRASE },
            { label: "Stop", value: DONE },
          ],
          { optional: false, place: context.place },
        )
      : DONE;
    if (next.kind === "done" && target !== undefined) await saveCandidates(target, []);
    return next;
  }
  if (evidence !== undefined) headerRows.push(["Evidence matches", String(matched)]);
  const headerShown = terminalResultHeader("Missing word recovery", headerRows);
  // When none matched the wallet, the person is asked first and the list is saved only when they
  // are done: words typed again give other candidates and another wallet the same ones, so the
  // list is saved once, for the last words.
  const savedLater = asked && evidence !== undefined && matched === 0;
  const notes = notesAfterTable(phrase, found, evidence);

  // Every candidate is shown when they are few and fit on the screen; otherwise only those that
  // match the wallet, each with its number among all of them.
  const heading = [
    "candidate",
    ...table.heading,
    ...(evidence === undefined ? [] : ["evidence"]),
    "mnemonic",
  ].join("\t");
  const columns = terminalColumns();
  const beside =
    (headerShown ? HEADING_ROWS + headerRows.length : 0) +
    notes.reduce((rows, note) => rows + noteRows(note, columns), 0) +
    (target !== undefined && !savedLater ? SAVED_LIST_ROWS : 0) +
    (savedLater ? QUESTION_ROWS : ENTER_ROWS);
  const everyRow =
    count <= MAX_SHOWN_CANDIDATES && tableFitsScreen([heading, ...rows.map(rowLine)], beside);
  const listed = everyRow ? rows : rows.filter((row) => row.match?.matched === true);
  if (listed.length > 0) {
    console.log(heading);
    for (const row of listed) console.log(rowLine(row));
  }
  const tooManyToShow = !everyRow && evidence === undefined && target === undefined;
  if (target !== undefined) {
    if (!savedLater) await saveCandidates(target, entropies, passphrase);
  } else if (tooManyToShow) terminalNotice(tooManyNotice(count), "warning");
  for (const note of notes) printNote(note);
  if (!asked) return DONE;
  // A list cannot be saved now: the right to write files was given up at the start
  // (protection.ts), so the menu asks for the list before the search.
  if (tooManyToShow)
    return askNext(
      [
        {
          label: "Check them against the wallet",
          note: "only those that match are shown",
          value: { kind: "wallet", evidence: undefined, listed: true },
        },
        { label: "Type the words again", note: "with more letters", value: PHRASE },
        { label: "Done", value: DONE },
      ],
      { optional: false, place: context.place },
    );
  if (savedLater) {
    const next = await askNext(
      [
        { label: "Type the words again", value: PHRASE },
        {
          label: "Change the wallet",
          note: "the fingerprint or the address",
          value: { kind: "wallet", evidence: undefined, listed: true },
        },
        { label: "Done", ...(target === undefined ? {} : { note: "saves the list" }), value: DONE },
      ],
      { optional: true, place: context.place },
    );
    if (next.kind === "done" && target !== undefined)
      await saveCandidates(target, entropies, passphrase);
    return next;
  }
  return DONE;
}
