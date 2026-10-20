// recover-word: finds forgotten or missing words of a seed phrase (core/candidates.ts,
// WordCandidateSearch), or the checksum-valid last words of an exact legacy Seedshift phrase. The
// search, its limits and its numbering are the core's; this module reads the phrase, checks each
// candidate against the wallet, prints the table and asks what comes next. From the command line a
// problem ends the command. With --ask-secrets, on the private screen, the phrase is checked as
// soon as it is typed, before the list's passphrase is asked, and asked again; a search without a
// usable result, or with more candidates than the window shows, offers what to change, keeping the
// list, its protection and its passphrase.

import { wipeAll } from "../core/bits.js";
import { recoverLegacyValidLastWords, type MissingWordCandidate } from "../core.js";
import {
  MAX_SHOWN_CANDIDATES,
  NARROW_WORD_SEARCH,
  WordCandidateSearch,
  type WordCandidate,
  type WordSearchResult,
  MatchTally,
  unshownCandidatesNotice,
} from "../core/candidates.js";
import {
  candidateListHolds,
  MAX_CANDIDATE_RECORDS,
  TooManyForListError,
} from "../core/candidate-list.js";
import { englishWordlist } from "../core/words.js";
import { BackupReading } from "../core/backup-reading.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { WordList } from "../core/word-hints.js";
import { walletCheckOf, type WalletEvidence, type EvidenceMatch } from "../bitcoin-evidence.js";
import { type ParsedArguments, assertAskedNotGiven } from "./arguments.js";
import { askAfterFailure, askSecretUntil, WHAT_NOW } from "./ask.js";
import { askWalletEvidence, changeWalletAnswer, checkWalletAnswer } from "./wallet-question.js";
import { type WalletPlace, givenWallet } from "./bitcoin-options.js";
import { textInput, PHRASE_SECRET_OPTIONS } from "./input.js";
import { linesFitPrivateScreen } from "./screen-fit.js";
import {
  ProgressLine,
  SEARCH_PROGRESS_SECONDS,
  terminalNotice,
  terminalResultHeader,
  resultHeaderLines,
  noticeLines,
  moreLine,
} from "./terminal.js";
import type { Choice } from "./terminal-choice.js";
import { evidenceLabel } from "./option-copy.js";
import { CandidatesFile } from "./candidates-file.js";
import { CtrlCWatch, nodeTurn } from "./terminal-input.js";
import { wordNumberOf } from "../core/bip39-sizes.js";
import { counting } from "../core/search-plan.js";
import { rowsOf, listQuestionRows } from "./terminal-choice.js";
import { closingRows } from "./private-screen.js";
import { PrivateSteps } from "./private-steps.js";
import { PrivateSummary } from "./private-summary.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { SecretValue } from "../core/secret-value.js";

const ERRORS = new ErrorCatalog("cli.recover-word-command", {
  "codes-not-words": () => CODES_NOT_WORDS,
  "legacy-valid-last-word-missing-word-cannot-combined": () =>
    "--legacy-valid-last-word and --missing-word cannot be combined.",
  "legacy-valid-last-word-lists-replacements-not-wallets": () =>
    "--legacy-valid-last-word lists replacements, not wallets: no candidate list.",
});

/**
 * The table of the candidates of `search`: the fact of its heading that names the places searched,
 * its columns and a row maker. The search says where its words are, so that this table has no case
 * for each kind of search (CORE-06): at its unknown places, or, where it has none, at a place that
 * each candidate has on its own (placesOf), as a missing word has.
 */
function tableOf(search: WordCandidateSearch): {
  readonly place: [string, string];
  readonly heading: readonly string[];
  readonly row: (candidate: WordCandidate) => readonly string[];
} {
  const word = (index: number) => [defined(englishWordlist[index]), String(wordNumberOf(index))];
  const unknown = search.unknownPlaces;
  if (unknown.length === 0)
    return {
      place: ["Missing word", "at any position"],
      heading: ["position", "word", "word-index"],
      row: (candidate) => {
        const place = defined(search.placesOf(candidate)[0]);
        return [String(place + 1), ...word(defined(candidate.words[place]))];
      },
    };
  const positions = unknown.map((place) => place + 1).join(", ");
  if (unknown.length === 1)
    return {
      place: ["Position", positions],
      heading: ["word", "word-index", "checksum-bits"],
      row: (candidate) => [
        ...word(defined(candidate.words[defined(unknown[0])])),
        candidate.checksumBits,
      ],
    };
  return {
    place: ["Positions", positions],
    heading: ["words"],
    row: (candidate) => [
      unknown
        .map((place) => `${place + 1}:${englishWordlist[defined(candidate.words[place])]}`)
        .join(" "),
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
  try {
    return phraseOf(text, rules);
  } catch (error) {
    // Codes typed here are read by Decode, which finds those marked with ? (owner, 2026-10-13).
    if (BackupReading.isCodes(text)) throw ERRORS.create("codes-not-words", []);
    throw error;
  }
}

/** Why codes cannot be searched where the words of a seed phrase are, and where they can. */
const CODES_NOT_WORDS = `These are the codes of an encoded seed phrase, not its words: ${MENU_ENTRY_NAMES.decode.label} reads them, with ? for each unread code.`;

/** The words of `text`, searched as `rules` say; throws why they cannot be. */
function phraseOf(text: string, rules: PhraseRules): PhraseSearch {
  if (rules.legacy) {
    // recoverLegacyValidLastWords refuses a ?, which would read as an unknown word at its place.
    return { kind: "legacy", replacements: recoverLegacyValidLastWords(text) };
  }
  const search = WordCandidateSearch.parse(text, rules.missing ? "missing-word" : "unknown-words");
  try {
    const expected = search.expected;
    if (rules.listed && expected.exact && !candidateListHolds(expected.count))
      throw new TooManyForListError(NARROW_WORD_SEARCH);
    return { kind: "words", search };
  } catch (error) {
    search.wipe();
    throw error;
  }
}

/**
 * A shown row: its table columns, its phrase, the candidate's number, counting from 1, and the
 * wallet check if there was one.
 */
class Row implements Disposable {
  readonly #fields: SecretValue<readonly string[]>;
  readonly number: number;
  readonly match: EvidenceMatch | undefined;

  constructor(columns: readonly string[], mnemonic: string, number: number, match?: EvidenceMatch) {
    this.#fields = SecretValue.texts([...columns, mnemonic]);
    this.number = number;
    this.match = match;
  }

  get columns(): readonly string[] {
    return this.#fields.value.slice(0, -1);
  }

  get mnemonic(): string {
    return defined(this.#fields.value.at(-1));
  }

  wipe(): void {
    this.#fields.wipe();
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
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
  const words = tableOf(search);
  return {
    heading: words.heading,
    headerRows: [words.place, ["Combinations", counting(search.combinations)]],
  };
}

/** Where the candidates go and what they are compared with. */
interface SearchContext {
  readonly target: CandidatesFile | undefined;
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

/**
 * Runs the search of `phrase` with the core's rules (WordCandidateSearch.run): every candidate is
 * counted and compared with the wallet, the first MAX_SHOWN_CANDIDATES and every one that matched
 * are kept for the screen, and a list keeps the entropy of every candidate, so that record N is
 * candidate N; past the most that a list holds the search stops (TooManyForListError). Ctrl+C is
 * read as a key during the turns and stops it at the next one, which cancels the command
 * (CANCELLED). The replacements of a legacy last word are a short fixed list, each compared with
 * the wallet.
 */
async function collect(phrase: PhraseSearch, context: SearchContext): Promise<Found | Cancelled> {
  using walletCheck = walletCheckOf(context.evidence, context.passphrase);
  const rows: Row[] = [];
  if (phrase.kind === "legacy") {
    try {
      for (const [index, candidate] of phrase.replacements.entries()) {
        const match = walletCheck?.(candidate.mnemonic);
        rows.push(
          new Row(
            [
              candidate.word,
              String(candidate.wordIndex),
              candidate.checksumBits,
              candidate.preservesLegacyEntropy ? "preserved" : "alternative",
            ],
            candidate.mnemonic,
            index + 1,
            match,
          ),
        );
      }
      // Counted as the word search counts its candidates (MatchTally).
      const tally = new MatchTally();
      for (const row of rows) tally.add(row.match);
      return {
        rows,
        entropies: [],
        count: rows.length,
        matched: tally.matched,
        warning: tally.warning,
      };
    } catch (error) {
      for (const row of rows) row.wipe();
      throw error;
    }
  }
  const { search } = phrase;
  const table = tableOf(search);
  // The search is a step of its own: its screen shows the title and the search, no longer the
  // words typed (CORE-39).
  PrivateSteps.begin();
  const progress = new ProgressLine(SEARCH_PROGRESS_SECONDS);
  let result: WordSearchResult<EvidenceMatch> | undefined;
  try {
    try {
      await CtrlCWatch.during(async (signal) => {
        result = await search.run({
          walletCheck,
          keep: context.target === undefined ? 0 : MAX_CANDIDATE_RECORDS,
          onListFull: () => {
            throw new TooManyForListError(NARROW_WORD_SEARCH);
          },
          onProgress: ({ checked }) =>
            progress.showEvery(() => `${counting(checked)} candidates so far.`),
          signal,
          turn: nodeTurn,
        });
        // The result is owned before raw-terminal cleanup or the terminal signal can fail.
        return result;
      });
    } finally {
      progress.end();
    }
    const completed = defined(result);
    if (completed.stopped) {
      wipeAll(completed.entropies);
      return CANCELLED;
    }
    // Rows take their own byte copies before the run's transferred candidates are released.
    for (const { candidate, match } of completed.shown)
      rows.push(new Row(table.row(candidate), candidate.phrase, candidate.number, match));
    return {
      rows,
      entropies: completed.entropies,
      count: completed.count,
      matched: completed.matched,
      warning: completed.warning,
    };
  } catch (error) {
    for (const row of rows) row.wipe();
    if (result !== undefined) wipeAll(result.entropies);
    throw error;
  } finally {
    if (result !== undefined) for (const { candidate } of result.shown) candidate.wipe();
  }
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

/** Searches the forgotten words; CANCELLED when the person cancelled. */
export async function runRecoverWord(arguments_: ParsedArguments): Promise<Cancelled | undefined> {
  const legacy = arguments_["legacy-valid-last-word"] === true;
  const missing = arguments_["missing-word"] === true;
  if (legacy && missing)
    throw ERRORS.create("legacy-valid-last-word-missing-word-cannot-combined", []);
  using requestedTarget = await CandidatesFile.of(arguments_);
  let target = requestedTarget;
  // The replacements are stored phrases, not wallets: the Scanner would search the wrong ones.
  if (legacy && target !== undefined)
    throw ERRORS.create("legacy-valid-last-word-lists-replacements-not-wallets", []);
  // A wallet asked later replaces the one given.
  const { evidence: given, place, passphrase } = givenWallet(arguments_);
  let evidence = given;
  const asked = arguments_["ask-secrets"] === true;
  target?.assertListable(passphrase);
  if (asked) assertAskedNotGiven(arguments_, PHRASE_SECRET_OPTIONS);
  const prompt = legacy
    ? "Exact legacy Seedshift phrase (old final word), or text file path:"
    : missing
      ? "The words you have, in order, or text file path:"
      : "Seed phrase or text file path, ? for each forgotten word:";
  const read = async (): Promise<PhraseSearch | Cancelled> => {
    const rules = { legacy, missing, listed: target !== undefined };
    if (!asked) return parsePhrase(textInput(arguments_, "mnemonic"), rules);
    return askSecretUntil(prompt, (text) => parsePhrase(text, rules), {
      what: "the words",
      textFile: "The seed phrase file",
      hints: WordList.BIP39,
    });
  };
  let phrase = await read();
  if (phrase === CANCELLED) return CANCELLED;
  try {
    // Only once the phrase can be searched: a list passphrase typed for nothing is lost work.
    if ((await target?.prepare(passphrase)) === CANCELLED) return CANCELLED;
    for (;;) {
      const next = await searchAndShow(phrase, { target, evidence, passphrase, place }, asked);
      if (next === CANCELLED) return CANCELLED;
      if (next.kind === "done") return undefined;
      if (next.kind === "phrase") {
        const typed = await read();
        if (typed === CANCELLED) return CANCELLED;
        if (phrase.kind === "words") phrase.search.wipe();
        phrase = typed;
      } else {
        evidence = next.evidence;
        if (!next.listed) target = undefined;
      }
    }
  } finally {
    if (phrase.kind === "words") phrase.search.wipe();
  }
}

/**
 * Searches the candidates of `phrase`, shows them, saves the list, and asks what comes next;
 * CANCELLED when the person cancelled.
 */
async function searchAndShow(
  phrase: PhraseSearch,
  context: SearchContext,
  asked: boolean,
): Promise<Next | Cancelled> {
  const table = tableFor(phrase);
  let found: Found | Cancelled;
  try {
    found = await collect(phrase, context);
  } catch (error) {
    if (!(error instanceof TooManyForListError) || !asked) throw error;
    terminalNotice(error.message, "warning");
    const next = await askNext(
      [
        { label: "Type the words again", note: "with more letters", value: PHRASE },
        checkWalletAnswer(
          { kind: "wallet", evidence: undefined, listed: false } as const,
          "without a list",
        ),
        { label: "Stop", note: "no list is saved", value: DONE },
      ],
      { optional: false, place: context.place },
    );
    if (next === CANCELLED) return CANCELLED;
    if (context.target !== undefined && next.kind !== "phrase") context.target.discard();
    return next;
  }
  if (found === CANCELLED) return CANCELLED;
  try {
    return await show(phrase, table, found, context, asked);
  } finally {
    for (const row of found.rows) row.wipe();
    wipeAll(found.entropies);
  }
}

/**
 * Asks what comes next after a search; a choice of the wallet asks for it at once
 * (askWalletEvidence: at `place`, with "It cannot" only when `optional`), and Escape there asks
 * the first question again. CANCELLED when the person cancelled.
 */
async function askNext(
  choices: readonly Choice<Next>[],
  wallet: { readonly optional: boolean; readonly place: WalletPlace },
): Promise<Next | Cancelled> {
  for (;;) {
    const next = await askAfterFailure(WHAT_NOW, choices);
    if (next === CANCELLED || next.kind !== "wallet") return next;
    const answer = await askWalletEvidence(wallet);
    if (answer === CANCELLED) return CANCELLED;
    if (answer.kind === "back") continue;
    return { ...next, evidence: answer.kind === "wallet" ? answer.evidence : undefined };
  }
}

/** The line that names a saved list: up to three rows for a file name of some 80 characters. */
const SAVED_LIST_ROWS = 3;

/** A row of the table as it is printed: its fields, separated by tabs. */
function rowLine(row: Row): string {
  const fields = [String(row.number), ...row.columns];
  if (row.match !== undefined)
    fields.push(
      row.match.matched ? `matched at ${row.match.path ?? "requested evidence"}` : "not matched",
    );
  return [...fields, row.mnemonic].join("\t");
}

/** Why the candidates are not shown, and what narrows them down. */
function tooManyNotice(count: number): string {
  return unshownCandidatesNotice(
    count,
    candidateListHolds(count)
      ? "save them with --candidates-file for the Discovery Scanner"
      : undefined,
  );
}

/**
 * A line after the table: a notice of its kind, or a link to a README section (terminalMore). A
 * warning that still holds once the command has ended is `lasting` (terminalLastingWarning).
 */
type Note =
  | {
      readonly text: string;
      readonly kind: "info" | "success" | "warning";
      readonly lasting?: boolean;
    }
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
      {
        text: "A valid checksum does not prove the wallet: compare an address.",
        kind: "warning",
        lasting: true,
      },
      { more: "exact-local-recovery-checks" },
    );
  else {
    notes.push({
      text: `Matched ${found.matched} of ${counting(found.count)} candidates against the requested ${evidenceLabel(evidence)} locally.`,
      kind: found.matched === 0 ? "warning" : "success",
    });
    if (found.warning !== undefined)
      notes.push({ text: found.warning, kind: "warning", lasting: true });
  }
  if (legacy && evidence !== undefined)
    notes.push({
      text: "Evidence was compared with the replacements, not with the original legacy phrases.",
      kind: "warning",
      lasting: true,
    });
  return notes;
}

function printNote(note: Note): void {
  for (const line of noteLines(note)) console.error(line);
  if ("text" in note && note.kind === "warning" && note.lasting === true)
    PrivateSummary.add({ kind: "warning", text: note.text });
}

/** The lines of `note`, as terminalNotice and terminalMore write them. */
function noteLines(note: Note): string[] {
  return "more" in note ? [moreLine(note.more)] : noticeLines(note.text, note.kind);
}

/**
 * Shows what a search found, as from the command line, then asks what comes next if anything;
 * CANCELLED when the person cancelled.
 */
async function show(
  phrase: PhraseSearch,
  table: Table,
  found: Found,
  context: SearchContext,
  asked: boolean,
): Promise<Next | Cancelled> {
  const { target, evidence, passphrase } = context;
  const { rows, entropies, count, matched } = found;
  const headerRows = [...table.headerRows];
  headerRows.push(["Checksum-valid candidates", counting(count)]);
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
    if (next === CANCELLED || next.kind !== "done" || target === undefined) return next;
    return (await target.saveEntropies([])) ?? next;
  }
  if (evidence !== undefined) headerRows.push(["Evidence matches", String(matched)]);
  const headerLines = resultHeaderLines("Missing word recovery", headerRows);
  for (const line of headerLines) console.log(line);
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
  // The question asked after the candidates when the list is saved only once the person is done.
  const laterChoices: Choice<Next>[] = [
    { label: "Type the words again", value: PHRASE },
    changeWalletAnswer({ kind: "wallet", evidence: undefined, listed: true } as const),
    { label: "Done", ...(target === undefined ? {} : { note: "saves the list" }), value: DONE },
  ];
  // Each part measured as it is printed: the heading, the notes, and what follows the candidates.
  const beside =
    rowsOf(headerLines) +
    rowsOf(notes.flatMap(noteLines)) +
    (target !== undefined && !savedLater ? SAVED_LIST_ROWS : 0) +
    (savedLater ? listQuestionRows(WHAT_NOW, laterChoices, "stops") : closingRows());
  const everyRow =
    count <= MAX_SHOWN_CANDIDATES && linesFitPrivateScreen([heading, ...rows.map(rowLine)], beside);
  const listed = everyRow ? rows : rows.filter((row) => row.match?.matched === true);
  if (listed.length > 0) {
    console.log(heading);
    for (const row of listed) console.log(rowLine(row));
  }
  const tooManyToShow = !everyRow && evidence === undefined && target === undefined;
  if (target !== undefined) {
    if (!savedLater && (await target.saveEntropies(entropies, passphrase)) === CANCELLED)
      return CANCELLED;
  } else if (tooManyToShow) terminalNotice(tooManyNotice(count), "warning");
  for (const note of notes) printNote(note);
  if (!asked) return DONE;
  // A list cannot be saved now: the right to write files was given up at the start
  // (protection.ts), so the menu asks for the list before the search.
  if (tooManyToShow)
    return askNext(
      [
        checkWalletAnswer(
          { kind: "wallet", evidence: undefined, listed: true } as const,
          "only those that match are shown",
        ),
        { label: "Type the words again", note: "with more letters", value: PHRASE },
        { label: "Done", value: DONE },
      ],
      { optional: false, place: context.place },
    );
  if (savedLater) {
    const next = await askNext(laterChoices, { optional: true, place: context.place });
    if (next === CANCELLED || next.kind !== "done" || target === undefined) return next;
    return (await target.saveEntropies(entropies, passphrase)) ?? next;
  }
  return DONE;
}
