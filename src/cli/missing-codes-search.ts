// Decode's search for codes marked with ?, on the private screen: it asks how the right codes are
// told, with Decode's options answering the first way asked (the encoded fingerprint, the wallet
// or the list, and the limit of a long search), shows the search's progress on one line, and what
// it found. Every rule of the search is the core's MissingCodesSearch
// (core/missing-codes-search.ts); this module only asks, composes the wallet check and shows.

import {
  masterFingerprint,
  parseMasterFingerprint,
  walletCheckOf,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import type { DatesAnswer } from "../core/date-search.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import {
  MISSING_CODES_TEXTS,
  MissingCodesSearch,
  type MissingCodesResult,
  type MissingCodesWay,
  type MissingCodesWaySearch,
  type MissingCodesFound,
  type MissingCodesRow,
} from "../core/missing-codes-search.js";
import { onPrivateScreen } from "./private-screen.js";
import { PrivateSteps } from "./private-steps.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { askAfterFailure, askValueUntil, askWalletEvidence, WHAT_NOW } from "./ask.js";
import { askDates } from "./date-search.js";
import { choose } from "./terminal-choice.js";
import { askToSearch } from "./search-consent.js";
import { withCtrlCWatch, nodeTurn } from "./terminal-input.js";
import {
  FINGERPRINT_DISCLOSURE,
  ProgressLine,
  terminalHint,
  terminalNotice,
  terminalStatus,
} from "./terminal.js";
import { counted, counting } from "../core/search-plan.js";
import { type WalletPlace } from "./bitcoin-options.js";
import { lowerFirst } from "../core/prose.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";

/** Seconds between two progress updates of a long search. */
const PROGRESS_SECONDS = 2;

/** What the search of marked codes gave the decode that asked for it. */
export type MissingOutcome =
  /** The one set of codes that fits, to be decoded as complete codes are, with these dates. */
  | MissingCodesFound
  /** The phrases were shown already, as a list. */
  | { readonly kind: "shown" }
  /** The codes are to be typed again. */
  | { readonly kind: "again" };

/** What Decode's options answer in the search of marked codes, and where a wallet is looked for. */
export interface MissingCodesAnswers {
  /** Where a wallet asked here is looked for (walletPlaceOf). */
  readonly place: WalletPlace | undefined;
  /** The wallet given with the options, which answers "The wallet". */
  readonly evidence?: WalletEvidence | undefined;
  /** The wallet's BIP39 passphrase, "" for none. */
  readonly passphrase: string;
  /** --encoded-fingerprint, which answers "Encoded fingerprint". */
  readonly encodedFingerprint?: string | undefined;
  /** --list-candidates, which answers "List every candidate". */
  readonly list: boolean;
  /** --max-candidates: the combinations of codes and dates tried without asking. */
  readonly maxCandidates?: number | undefined;
}

/** The way that the options answer, where it fits the codes; undefined asks for it. */
function givenWay(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
): MissingCodesWay | undefined {
  if (answers.encodedFingerprint !== undefined) {
    const refusal = search.whyNot("encoded");
    if (refusal === undefined) return "encoded";
    terminalNotice(`--encoded-fingerprint: ${lowerFirst(refusal)}`, "warning");
  }
  if (answers.evidence !== undefined) return "wallet";
  if (answers.list) {
    const refusal = search.whyNot("list");
    if (refusal === undefined) return "list";
    terminalNotice(`--list-candidates: ${lowerFirst(refusal)}`, "warning");
  }
  return undefined;
}

/**
 * Says what the search filled in, the codes whole with those found, so that the written copy can
 * be corrected; the decode shows it again with its result.
 */
export function reportFound(
  codes: MissingCodes,
  backup: EncodedBackup,
  foundDates?: string,
  others?: number,
): void {
  terminalStatus(`${MissingCodesSearch.placesText(codes)} found:`, backup.text());
  if (foundDates !== undefined) terminalStatus("Dates found:", foundDates);
  // Other codes with other dates give the same phrase: those found need not be those written.
  if (others !== undefined)
    terminalNotice(
      `${counted(others + 1, "set")} of codes and dates give this phrase; those found are one of them, so keep the dates you used.`,
      "warning",
    );
  else terminalHint(MISSING_CODES_TEXTS.correct);
}

/**
 * Whether `way` is searched: at once, its time said from a minute, or, when the plan asks for it,
 * only when the person chooses it (askToSearch).
 */
async function started(
  way: MissingCodesWaySearch,
  limit: number | undefined,
): Promise<"yes" | "no" | Cancelled> {
  const plan = await way.plan(limit);
  if (plan.ask)
    return askToSearch(plan.question(), { note: "choose another way", quit: "goes back" });
  if (plan.tell) terminalNotice(plan.notice());
  return "yes";
}

/** What a way that ran gave: its result, or CANCELLED when Ctrl+C stopped it. */
type RanResult = Exclude<MissingCodesResult, { readonly kind: "stopped" }> | Cancelled;

/**
 * Runs `way` while Ctrl+C is read as a key, with its progress on one line; a search that Ctrl+C
 * stopped cancels the command.
 */
async function ran(way: MissingCodesWaySearch): Promise<RanResult> {
  const progress = new ProgressLine(PROGRESS_SECONDS);
  let owned: MissingCodesResult | undefined;
  try {
    try {
      await withCtrlCWatch(async (signal) => {
        owned = await way.run({
          signal,
          turn: nodeTurn,
          onProgress: ({ checked, total, found }) =>
            progress.showEvery(
              () => `Checked ${counting(checked)} of about ${counting(total)}; ${found} found.`,
            ),
        });
        // Adopt before the terminal watch's own asynchronous finalization can fail.
        return owned;
      });
    } finally {
      progress.end();
    }
    const result = defined(owned);
    // The person stopped the search with Ctrl+C.
    if (result.kind === "stopped") return CANCELLED;
    // Only after final progress output succeeds does this result belong to the next helper.
    owned = undefined;
    return result;
  } finally {
    if (owned?.kind === "found") owned.backup.wipe();
  }
}

/**
 * Asks how the right codes are told and searches them, until one set is found, the candidates are
 * listed, or the person types the codes again; CANCELLED when the command is cancelled. The
 * options in `answers` answer the first way and its value; once that way finds nothing, the
 * person chooses.
 */
export async function searchMissingCodes(
  codes: MissingCodes,
  answers: MissingCodesAnswers,
): Promise<MissingOutcome | Cancelled> {
  const search = new MissingCodesSearch(codes, masterFingerprint);
  terminalNotice(search.unreadable, "warning");
  if (search.many) terminalHint(MISSING_CODES_TEXTS.many);
  for (let given = givenWay(search, answers); ; given = undefined) {
    const way = given ?? (await askWay(search));
    if (way === undefined) return { kind: "again" };
    if (way === CANCELLED) return CANCELLED;
    const outcome =
      way === "encoded"
        ? await byEncodedFingerprint(search, answers, given === "encoded")
        : way === "wallet"
          ? await byWallet(search, answers, given === "wallet")
          : await listed(search);
    if (outcome !== undefined) return outcome;
  }
}

/** Asks how the right codes are told; undefined types the codes again. */
async function askWay(
  search: MissingCodesSearch,
): Promise<MissingCodesWay | undefined | Cancelled> {
  return choose(
    MISSING_CODES_TEXTS.question,
    search.ways.map(({ way, label, note }) => ({ label, note, value: way })),
    { label: "Codes", quit: "types the codes again" },
  );
}

/**
 * The codes whose own fingerprint is the encoded one that Encode showed, --encoded-fingerprint
 * when `given`; undefined asks again.
 */
async function byEncodedFingerprint(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
  given: boolean,
): Promise<MissingOutcome | undefined | Cancelled> {
  const fingerprint = given
    ? answers.encodedFingerprint
    : await askValueUntil(
        `Encoded fingerprint of these codes, such as 1a2b3c4d (${FINGERPRINT_DISCLOSURE}):`,
        parseMasterFingerprint,
        { what: "the eight characters of the fingerprint" },
      );
  if (fingerprint === undefined || fingerprint === CANCELLED) return fingerprint;
  using way = search.byEncodedFingerprint(fingerprint);
  return await searched(search, way, answers.maxCandidates);
}

/**
 * The codes whose phrase, with the dates, matches the wallet, the one of the options when `given`;
 * undefined asks again. Dates with ? are searched with the codes.
 */
async function byWallet(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
  given: boolean,
): Promise<MissingOutcome | undefined | Cancelled> {
  const dates = search.needsDates ? await askCodeDates(search, true) : undefined;
  if (dates === CANCELLED) return CANCELLED;
  using dateAnswer = dates;
  const evidence = given ? answers.evidence : await askWallet(answers.place);
  if (evidence === undefined || evidence === CANCELLED) return evidence;
  using walletCheck = defined(walletCheckOf(evidence, answers.passphrase));
  using way = search.byWallet(walletCheck, dateAnswer);
  return await searched(search, way, answers.maxCandidates);
}

/**
 * Searches `way` once the person allows it (started) and tells its outcome; undefined, after the
 * answer No, asks for another way.
 */
async function searched(
  search: MissingCodesSearch,
  way: MissingCodesWaySearch,
  limit: number | undefined,
): Promise<MissingOutcome | undefined | Cancelled> {
  const start = await started(way, limit);
  if (start !== "yes") return start === "no" ? undefined : start;
  const result = await ran(way);
  return result === CANCELLED ? CANCELLED : outcomeOf(search, result);
}

/**
 * The dates of the masked codes, with ? for a forgotten digit where `patterns`; CANCELLED when
 * the command is cancelled.
 */
function askCodeDates(
  search: MissingCodesSearch,
  patterns: boolean,
): Promise<DatesAnswer | Cancelled> {
  return askDates({ wordCount: search.codes.wordCount, patterns });
}

/** The wallet asked on the screen; undefined when the person goes back. */
async function askWallet(
  place: WalletPlace | undefined,
): Promise<WalletEvidence | undefined | Cancelled> {
  const answer = await askWalletEvidence({
    optional: false,
    ...(place === undefined ? {} : { place }),
  });
  if (answer === CANCELLED) return CANCELLED;
  return answer.kind === "wallet" ? answer.evidence : undefined;
}

/** Every candidate with its phrase and fingerprint, for the person to compare. */
/**
 * The candidates of a listed search: on the private screen one after another, which the page shows
 * by pages when they do not fit (PrivatePage), and elsewhere one row each, for a script.
 */
function showCandidates(rows: readonly MissingCodesRow[]): void {
  if (onPrivateScreen() && process.stdout.isTTY === true) {
    PrivateSteps.showResult();
    for (const line of [
      FINGERPRINT_DISCLOSURE,
      "",
      ...rows.flatMap(({ codes, phrase, fingerprint }, index) => [
        `Candidate ${index + 1}`,
        `Codes: ${codes}`,
        `Phrase: ${phrase}`,
        `Fingerprint: ${fingerprint}`,
        "",
      ]),
    ])
      console.log(line);
    return;
  }
  rows.forEach(({ codes, phrase, fingerprint }, index) =>
    console.log(`${index + 1}\t${codes}\t${phrase}\t${fingerprint}`),
  );
  console.error(FINGERPRINT_DISCLOSURE);
}

async function listed(search: MissingCodesSearch): Promise<MissingOutcome | Cancelled> {
  const dates = search.needsDates ? await askCodeDates(search, false) : undefined;
  if (dates === CANCELLED) return CANCELLED;
  using dateAnswer = dates;
  using way = search.listed(dateAnswer?.known ?? []);
  const result = await ran(way);
  if (result === CANCELLED) return CANCELLED;
  if (result.kind === "list") showCandidates(result.rows);
  terminalHint(MISSING_CODES_TEXTS.list);
  return { kind: "shown" };
}

/**
 * The one set of codes found, reported; none says why and asks again; several, which a
 * fingerprint leaves only by chance, are told by the wallet or the codes are typed again.
 */
async function outcomeOf(
  search: MissingCodesSearch,
  result: Exclude<RanResult, Cancelled>,
): Promise<MissingOutcome | undefined | Cancelled> {
  if (result.kind === "found") {
    try {
      reportFound(search.codes, result.backup, result.foundDates, result.others);
      return result;
    } catch (error) {
      result.backup.wipe();
      throw error;
    }
  }
  if (result.kind === "none") {
    terminalNotice(result.message, "warning");
    return undefined;
  }
  if (result.kind !== "several") return { kind: "shown" };
  terminalNotice(result.message, "warning");
  const next = await askAfterFailure(
    WHAT_NOW,
    [
      { label: "Tell them by the wallet", value: "wallet" },
      { label: "Type the codes again", value: "again" },
    ] as const,
    { escape: "types the codes again" },
  );
  if (next === CANCELLED) return CANCELLED;
  return next === "again" ? { kind: "again" } : undefined;
}
