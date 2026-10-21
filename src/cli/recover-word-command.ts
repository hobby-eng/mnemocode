// recover-word: finds forgotten or missing words of a seed phrase (core/candidates.ts,
// WordCandidateSearch), or the checksum-valid last words of an exact legacy Seedshift phrase. The
// search, its limits and its numbering are the core's; this module reads the phrase, checks each
// candidate against the wallet, prints the candidates and asks what comes next. From the command
// line a problem ends the command. With --ask-secrets, on the private screen, the phrase is checked
// as soon as it is typed, before the list's passphrase is asked, and asked again; a search without
// a usable result, or with more candidates than the window holds as one row each, offers what to
// change, keeping the list, its protection and its passphrase. A shorter list is shown whole, by
// pages where its candidates are taller than the window (PrivatePage).

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
import { type GivenWallet, type WalletPlace, givenWallet } from "./bitcoin-options.js";
import { textInput, PHRASE_SECRET_OPTIONS } from "./input.js";
import { candidateLines } from "./candidate-view.js";
import { linesFitPrivateScreen } from "./screen-fit.js";
import {
  ProgressLine,
  SEARCH_PROGRESS_SECONDS,
  terminalLayout,
  terminalNotice,
  terminalResultHeader,
  terminalResultNote,
  resultHeaderLines,
  resultNoteLines,
  type ResultNote,
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

/** The title of the result. */
const TITLE = "Missing word recovery";

/** A column of the candidates: its heading in the rows for a script, its label on a terminal. */
interface Column {
  readonly heading: string;
  readonly label: string;
}

/**
 * The columns of the candidates: the number of each first, then those of its kind of search, the
 * wallet check where there is one, and the phrase last.
 */
const COLUMNS = Object.freeze({
  number: { heading: "candidate", label: "Candidate" },
  position: { heading: "position", label: "Position" },
  word: { heading: "word", label: "Word" },
  wordNumber: { heading: "word-index", label: "Word number" },
  checksumBits: { heading: "checksum-bits", label: "Checksum bits" },
  legacyTail: { heading: "legacy-tail", label: "Old word's data" },
  words: { heading: "words", label: "Words" },
  wallet: { heading: "evidence", label: "Wallet" },
  phrase: { heading: "mnemonic", label: "Phrase" },
} as const) satisfies Readonly<Record<string, Column>>;

/**
 * The table of a kind of search's candidates: the facts of the result's heading that name what
 * was searched, and the columns of its own, between the number and the wallet check.
 */
interface Table {
  readonly headerRows: readonly [string, string][];
  readonly columns: readonly Column[];
}

/** A table, and the values in its columns of one candidate of a word search. */
interface WordsTable {
  readonly table: Table;
  readonly row: (candidate: WordCandidate) => readonly string[];
}

/**
 * The table of the candidates of `search`. The search says where its words are, so that this
 * table has no case for each kind of search (CORE-06): at its unknown places, or, where it has
 * none, at a place that each candidate has on its own (placesOf), as a missing word has.
 */
function wordsTable(search: WordCandidateSearch): WordsTable {
  const word = (index: number) => [defined(englishWordlist[index]), String(wordNumberOf(index))];
  const combinations: [string, string] = ["Combinations", counting(search.combinations)];
  const unknown = search.unknownPlaces;
  if (unknown.length === 0)
    return {
      table: {
        headerRows: [["Missing word", "at any position"], combinations],
        columns: [COLUMNS.position, COLUMNS.word, COLUMNS.wordNumber],
      },
      row: (candidate) => {
        const place = defined(search.placesOf(candidate)[0]);
        return [String(place + 1), ...word(defined(candidate.words[place]))];
      },
    };
  const positions = unknown.map((place) => place + 1).join(", ");
  if (unknown.length === 1)
    return {
      table: {
        headerRows: [["Position", positions], combinations],
        columns: [COLUMNS.word, COLUMNS.wordNumber, COLUMNS.checksumBits],
      },
      row: (candidate) => [
        ...word(defined(candidate.words[defined(unknown[0])])),
        candidate.checksumBits,
      ],
    };
  return {
    table: { headerRows: [["Positions", positions], combinations], columns: [COLUMNS.words] },
    row: (candidate) => [
      unknown
        .map((place) => `${place + 1}:${englishWordlist[defined(candidate.words[place])]}`)
        .join(" "),
    ],
  };
}

/**
 * What a phrase asks for, as a kind of search of its own (CORE-06): the replacements of a legacy
 * last word, or a search of words. Each kind says what its candidates are and finds them, and owns
 * what it holds of the phrase until wipe().
 */
interface PhraseSearch {
  /** The facts of the result's heading and the columns of the candidates. */
  readonly table: Table;
  /** The note after the candidates that says what they are. */
  readonly about: string;
  /** What the wallet was compared with, where it is not the phrase typed; undefined where it is. */
  readonly comparedWith: string | undefined;
  /**
   * Finds the candidates and compares each with the wallet of `context`; CANCELLED when the person
   * stopped the search.
   */
  collect(context: SearchContext): Promise<Found | Cancelled>;
  /** Erases what it holds of the phrase, as far as the runtime allows. */
  wipe(): void;
}

/**
 * The checksum-valid last words of an exact legacy Seedshift phrase (recoverLegacyValidLastWords),
 * a short fixed list, each compared with the wallet.
 */
class LegacyReplacements implements PhraseSearch {
  readonly about =
    "All checksum-valid last words; the candidate marked preserved keeps the old word's data.";
  readonly comparedWith =
    "Evidence was compared with the replacements, not with the original legacy phrases.";
  readonly #replacements: readonly MissingWordCandidate[];

  constructor(replacements: readonly MissingWordCandidate[]) {
    this.#replacements = replacements;
  }

  get table(): Table {
    const replacements = this.#replacements;
    const preserving = replacements.find((candidate) => candidate.preservesLegacyEntropy);
    return {
      headerRows: [
        ["Mode", "Legacy final-word replacement"],
        ["Position", String(replacements[0]?.position ?? "")],
        ["Entropy-preserving replacement", preserving?.word ?? "unavailable"],
      ],
      columns: [COLUMNS.word, COLUMNS.wordNumber, COLUMNS.checksumBits, COLUMNS.legacyTail],
    };
  }

  /** Each replacement compared with the wallet, counted as the word search counts (MatchTally). */
  collect(context: SearchContext): Promise<Found> {
    using walletCheck = walletCheckOf(context.evidence, context.wallet.passphrase);
    const rows: Row[] = [];
    try {
      for (const [index, candidate] of this.#replacements.entries()) {
        const match = walletCheck?.(candidate.mnemonic);
        const columns = [
          candidate.word,
          String(candidate.wordIndex),
          candidate.checksumBits,
          candidate.preservesLegacyEntropy ? "preserved" : "alternative",
        ];
        rows.push(new Row(columns, candidate.mnemonic, index + 1, match));
      }
      const tally = new MatchTally();
      for (const row of rows) tally.add(row.match);
      return Promise.resolve({
        rows,
        entropies: [],
        count: rows.length,
        matched: tally.matched,
        warning: tally.warning,
      });
    } catch (error) {
      for (const row of rows) row.wipe();
      throw error;
    }
  }

  /** Nothing to erase: the replacements are strings, which JavaScript cannot erase (TS-07). */
  wipe(): void {}
}

/**
 * A search of words (WordCandidateSearch): forgotten words at their places, or a missing word at
 * any place. It owns the search, and with it the words typed.
 */
class WordsSearch implements PhraseSearch {
  readonly about =
    "Every combination was checked; only those with a valid BIP39 checksum are candidates.";
  readonly comparedWith = undefined;
  readonly #search: WordCandidateSearch;
  readonly #words: WordsTable;

  constructor(search: WordCandidateSearch) {
    this.#search = search;
    this.#words = wordsTable(search);
  }

  get table(): Table {
    return this.#words.table;
  }

  /**
   * Runs the search with the core's rules (WordCandidateSearch.run): every candidate is counted
   * and compared with the wallet, the first MAX_SHOWN_CANDIDATES and every one that matched are
   * kept for the screen, and a list keeps the entropy of every candidate, so that record N is
   * candidate N; past the most that a list holds the search stops (TooManyForListError). Ctrl+C is
   * read as a key during the turns and stops it at the next one, which cancels the command
   * (CANCELLED).
   */
  async collect(context: SearchContext): Promise<Found | Cancelled> {
    using walletCheck = walletCheckOf(context.evidence, context.wallet.passphrase);
    // The search is a step of its own: its screen shows the title and the search, no longer the
    // words typed (CORE-39).
    PrivateSteps.begin();
    const progress = new ProgressLine(SEARCH_PROGRESS_SECONDS);
    const rows: Row[] = [];
    let result: WordSearchResult<EvidenceMatch> | undefined;
    try {
      try {
        await CtrlCWatch.during(async (signal) => {
          result = await this.#search.run({
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
        rows.push(new Row(this.#words.row(candidate), candidate.phrase, candidate.number, match));
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

  wipe(): void {
    this.#search.wipe();
  }
}

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
  // recoverLegacyValidLastWords refuses a ?, which would read as an unknown word at its place.
  if (rules.legacy) return new LegacyReplacements(recoverLegacyValidLastWords(text));
  const search = WordCandidateSearch.parse(text, rules.missing ? "missing-word" : "unknown-words");
  try {
    const expected = search.expected;
    if (rules.listed && expected.exact && !candidateListHolds(expected.count))
      throw new TooManyForListError(NARROW_WORD_SEARCH);
    return new WordsSearch(search);
  } catch (error) {
    search.wipe();
    throw error;
  }
}

/**
 * A shown candidate: its values in the columns of its kind of search, its phrase, its number,
 * counting from 1, and the wallet check if there was one.
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

  /**
   * Its values in the columns of its kind of search, then what the wallet check said, where there
   * was one, and the phrase.
   */
  get fields(): readonly string[] {
    const fields = this.#fields.value;
    if (this.match === undefined) return fields;
    const checked = this.match.matched
      ? `matched at ${this.match.path ?? "requested evidence"}`
      : "not matched";
    return [...fields.slice(0, -1), checked, defined(fields.at(-1))];
  }

  wipe(): void {
    this.#fields.wipe();
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** Where the candidates go, what they are compared with, and the wallet's passphrase. */
interface SearchContext {
  readonly target: CandidatesFile | undefined;
  /** The wallet: the one given with the options, or one asked after a search; none lists all. */
  readonly evidence: WalletEvidence | undefined;
  /**
   * The owner of the BIP39 passphrase (decoded for each call that takes it), and where a wallet
   * asked after the search is looked for.
   */
  readonly wallet: GivenWallet;
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
/** The answer that asks for the words again; the list, its protection and its passphrase are kept. */
const WORDS_AGAIN: Choice<Next> = { label: "Type the words again", value: PHRASE };
/** WORDS_AGAIN where more letters of the words would narrow the search. */
const MORE_LETTERS: Choice<Next> = { ...WORDS_AGAIN, note: "with more letters" };

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
  using wallet = givenWallet(arguments_);
  // A wallet asked later replaces the one given.
  let evidence = wallet.evidence;
  const asked = arguments_["ask-secrets"] === true;
  target?.assertListable(wallet.passphrase);
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
    if ((await target?.prepare(wallet.passphrase)) === CANCELLED) return CANCELLED;
    for (;;) {
      const next = await searchAndShow(phrase, { target, evidence, wallet }, asked);
      if (next === CANCELLED) return CANCELLED;
      if (next.kind === "done") return undefined;
      // The result was read: what comes next has a page of its own (CORE-39).
      PrivateSteps.newPage();
      if (next.kind === "phrase") {
        const typed = await read();
        if (typed === CANCELLED) return CANCELLED;
        phrase.wipe();
        phrase = typed;
      } else {
        evidence = next.evidence;
        if (!next.listed) target = undefined;
      }
    }
  } finally {
    phrase.wipe();
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
  let found: Found | Cancelled;
  try {
    found = await phrase.collect(context);
  } catch (error) {
    if (!(error instanceof TooManyForListError) || !asked) throw error;
    terminalNotice(error.message, "warning");
    const next = await askNext(
      [
        MORE_LETTERS,
        checkWalletAnswer(
          { kind: "wallet", evidence: undefined, listed: false } as const,
          "without a list",
        ),
        { label: "Stop", note: "no list is saved", value: DONE },
      ],
      { optional: false, place: context.wallet.place },
    );
    if (next === CANCELLED) return CANCELLED;
    if (context.target !== undefined && next.kind !== "phrase") context.target.discard();
    return next;
  }
  if (found === CANCELLED) return CANCELLED;
  try {
    return await show(phrase, found, context, asked);
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

/** The columns of the candidates after their number: those of `table`, the wallet's, the phrase. */
function columnsOf(table: Table, checked: boolean): Column[] {
  return [...table.columns, ...(checked ? [COLUMNS.wallet] : []), COLUMNS.phrase];
}

/**
 * The lines of `rows` on standard output, as they are printed: on a terminal each candidate as a
 * part of the result, its facts as grey labels with their values (candidateLines, CORE-36); for a
 * file, a pipe or TERM=dumb the rows of a table (tableRows). `checked` when the candidates were
 * compared with a wallet.
 */
function candidateRows(rows: readonly Row[], table: Table, checked: boolean): string[] {
  if (!terminalLayout("stdout")) return tableRows(rows, table, checked);
  const columns = columnsOf(table, checked);
  return rows.flatMap((row) => {
    const { fields } = row;
    const facts = columns.map(({ label }, index) => [label, defined(fields[index])] as const);
    return candidateLines(`${COLUMNS.number.label} ${row.number}`, facts);
  });
}

/** `rows` as a table for a script: a heading, then one row of tab-separated fields each. */
function tableRows(rows: readonly Row[], table: Table, checked: boolean): string[] {
  const columns = [COLUMNS.number, ...columnsOf(table, checked)];
  const heading = columns.map((column) => column.heading).join("\t");
  return [heading, ...rows.map((row) => [String(row.number), ...row.fields].join("\t"))];
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

/** The notes after the candidates: what they are, and what a valid checksum or the wallet says. */
function notesAfterTable(
  phrase: PhraseSearch,
  found: Found,
  evidence: WalletEvidence | undefined,
): ResultNote[] {
  const notes: ResultNote[] = [{ text: phrase.about, kind: "info" }];
  if (evidence === undefined) {
    notes.push(
      { text: "A valid checksum does not prove the wallet: compare an address.", kind: "lasting" },
      { more: "exact-local-recovery-checks" },
    );
    return notes;
  }
  notes.push({
    text: `Matched ${found.matched} of ${counting(found.count)} candidates against the requested ${evidenceLabel(evidence)} locally.`,
    kind: found.matched === 0 ? "warning" : "success",
  });
  if (found.warning !== undefined) notes.push({ text: found.warning, kind: "lasting" });
  if (phrase.comparedWith !== undefined) notes.push({ text: phrase.comparedWith, kind: "lasting" });
  return notes;
}

/**
 * Shows what a search found, as a result (terminalResultHeader), under which the question that
 * follows is asked, if anything; CANCELLED when the person cancelled.
 */
async function show(
  phrase: PhraseSearch,
  found: Found,
  context: SearchContext,
  asked: boolean,
): Promise<Next | Cancelled> {
  const { target, evidence, wallet } = context;
  const { rows, entropies, count, matched } = found;
  const headerRows: [string, string][] = [
    ...phrase.table.headerRows,
    ["Checksum-valid candidates", counting(count)],
  ];
  if (count === 0) {
    terminalResultHeader(TITLE, headerRows);
    terminalNotice(
      "No valid phrase fits these words: check them, their order and the ? places.",
      "warning",
    );
    const next = asked
      ? await askNext([WORDS_AGAIN, { label: "Stop", value: DONE }], {
          optional: false,
          place: wallet.place,
        })
      : DONE;
    if (next === CANCELLED || next.kind !== "done" || target === undefined) return next;
    return (await target.saveEntropies([])) ?? next;
  }
  if (evidence !== undefined) headerRows.push(["Evidence matches", String(matched)]);
  // When none matched the wallet, the person is asked first and the list is saved only when they
  // are done: words typed again give other candidates and another wallet the same ones, so the
  // list is saved once, for the last words.
  const savedLater = asked && evidence !== undefined && matched === 0;
  const notes = notesAfterTable(phrase, found, evidence);
  // The question asked after the candidates when the list is saved only once the person is done.
  const laterChoices: Choice<Next>[] = [
    WORDS_AGAIN,
    changeWalletAnswer({ kind: "wallet", evidence: undefined, listed: true } as const),
    { label: "Done", ...(target === undefined ? {} : { note: "saves the list" }), value: DONE },
  ];
  // Every candidate is shown when the list is short: when its rows for a script, one line each,
  // fit on the private screen with what is printed around them, each part measured as it is
  // printed: the heading, the notes, and what follows the candidates. On a terminal, where each
  // candidate is a part of its own, the screen then shows them by pages (PrivatePage). A longer
  // list shows only those that match the wallet, each with its number among all of them.
  const beside =
    rowsOf(resultHeaderLines(TITLE, headerRows)) +
    rowsOf(notes.flatMap(resultNoteLines)) +
    (target !== undefined && !savedLater ? SAVED_LIST_ROWS : 0) +
    (savedLater ? listQuestionRows(WHAT_NOW, laterChoices, "stops") : closingRows());
  const checked = evidence !== undefined;
  const everyRow =
    count <= MAX_SHOWN_CANDIDATES &&
    linesFitPrivateScreen(tableRows(rows, phrase.table, checked), beside);
  const listed = everyRow ? rows : rows.filter((row) => row.match?.matched === true);
  terminalResultHeader(TITLE, headerRows);
  if (listed.length > 0)
    for (const line of candidateRows(listed, phrase.table, checked)) console.log(line);
  const tooManyToShow = !everyRow && evidence === undefined && target === undefined;
  if (target !== undefined) {
    if (!savedLater && (await target.saveEntropies(entropies, wallet.passphrase)) === CANCELLED)
      return CANCELLED;
  } else if (tooManyToShow) terminalNotice(tooManyNotice(count), "warning");
  for (const note of notes) terminalResultNote(note);
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
        MORE_LETTERS,
        { label: "Done", value: DONE },
      ],
      { optional: false, place: wallet.place },
    );
  if (savedLater) {
    const next = await askNext(laterChoices, { optional: true, place: wallet.place });
    if (next === CANCELLED || next.kind !== "done" || target === undefined) return next;
    return (await target.saveEntropies(entropies, wallet.passphrase)) ?? next;
  }
  return DONE;
}
