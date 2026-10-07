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
import type { DateShiftDate } from "../core.js";
import type { DatesAnswer } from "../core/date-search.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import {
  MISSING_CODES_TEXTS,
  MissingCodesSearch,
  type MissingCodesResult,
  type MissingCodesWay,
  type MissingCodesWaySearch,
} from "../core/missing-codes-search.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { RepairReport } from "../sskr/repair-report.js";
import { askAfterFailure, askValueUntil, askWalletEvidence, type WalletPlace } from "./ask.js";
import { askDates } from "./date-search.js";
import { choose } from "./terminal-choice.js";
import { dropTypedAhead, withCtrlCWatch } from "./terminal-input.js";
import { ProgressLine, terminalHint, terminalNotice, terminalStatus } from "./terminal.js";

/** Seconds between two progress updates of a long search. */
const PROGRESS_SECONDS = 2;

/** What the search of marked codes gave the decode that asked for it. */
export type MissingOutcome =
  /** The one set of codes that fits, to be decoded as complete codes are, with these dates. */
  | {
      readonly kind: "found";
      readonly backup: EncodedBackup;
      readonly dates?: readonly DateShiftDate[] | undefined;
      /** The dates as found by a search of their forgotten digits, to be shown with the codes. */
      readonly foundDates?: string | undefined;
    }
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
    if (search.fits("encoded")) return "encoded";
    terminalNotice(
      "--encoded-fingerprint cannot tell these codes: they keep no checksum.",
      "warning",
    );
  }
  if (answers.evidence !== undefined) return "wallet";
  if (answers.list) {
    if (search.fits("list")) return "list";
    terminalNotice(
      `--list-candidates lists at most ${MissingCodesSearch.MAX_LISTED} candidates; these codes have about ${RepairReport.counted(search.codes.expected, "candidate")}.`,
      "warning",
    );
  }
  return undefined;
}

/**
 * Says what the search filled in, the codes whole with those found, so that the written copy can
 * be corrected; the decode shows it again with its result.
 */
export function reportFound(codes: MissingCodes, backup: EncodedBackup, foundDates?: string): void {
  terminalStatus(`${MissingCodesSearch.placesText(codes.missingPlaces)} found:`, backup.text());
  if (foundDates !== undefined) terminalStatus("Dates found:", foundDates);
  terminalHint(MISSING_CODES_TEXTS.correct);
}

/**
 * Whether `way` is searched: at once, its time said from a minute, or, when the plan asks for it,
 * only when the person chooses it.
 */
async function started(way: MissingCodesWaySearch, limit: number | undefined): Promise<boolean> {
  const plan = await way.plan(limit);
  const time = plan.seconds >= 1 ? `, ${RepairReport.duration(plan.seconds)}` : "";
  if (plan.ask) {
    await dropTypedAhead();
    const start = await choose(
      `Search ${plan.size}${time}?`,
      [
        { label: "Yes", note: "Ctrl+C stops it", value: true },
        { label: "No", note: "choose another way", value: false },
      ],
      { label: "Search", quit: "goes back" },
    );
    return start === true;
  }
  if (plan.tell) terminalNotice(`The search tries ${plan.size}${time}; progress is shown.`);
  return true;
}

/** Runs `way` while Ctrl+C is read as a key, with its progress on one line. */
async function ran(way: MissingCodesWaySearch): Promise<MissingCodesResult> {
  const progress = new ProgressLine();
  let shown = Date.now();
  try {
    return await withCtrlCWatch((signal) =>
      way.run({
        signal,
        onProgress: ({ count, expected, found }) => {
          if (Date.now() - shown < PROGRESS_SECONDS * 1000) return;
          shown = Date.now();
          progress.show(
            `Checked ${count.toLocaleString("en-US")} of about ${expected.toLocaleString("en-US")}; ${found} found.`,
          );
        },
      }),
    );
  } finally {
    progress.end();
  }
}

/**
 * Asks how the right codes are told and searches them, until one set is found, the candidates are
 * listed, or the person types the codes again. The options in `answers` answer the first way and
 * its value; once that way finds nothing, the person chooses.
 */
export async function searchMissingCodes(
  codes: MissingCodes,
  answers: MissingCodesAnswers,
): Promise<MissingOutcome> {
  const search = new MissingCodesSearch(codes, masterFingerprint);
  terminalNotice(search.unreadable, "warning");
  if (search.many) terminalHint(MISSING_CODES_TEXTS.many);
  for (let given = givenWay(search, answers); ; given = undefined) {
    const way = given ?? (await askWay(search));
    if (way === undefined) return { kind: "again" };
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
async function askWay(search: MissingCodesSearch): Promise<MissingCodesWay | undefined> {
  await dropTypedAhead();
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
): Promise<MissingOutcome | undefined> {
  const fingerprint = given
    ? answers.encodedFingerprint
    : await askValueUntil(
        "Encoded fingerprint of these codes, such as 1a2b3c4d:",
        parseMasterFingerprint,
        { what: "the eight characters of the fingerprint" },
      );
  if (fingerprint === undefined) return undefined;
  const way = search.byEncodedFingerprint(fingerprint);
  if (!(await started(way, answers.maxCandidates))) return undefined;
  return outcomeOf(search, await ran(way));
}

/**
 * The codes whose phrase, with the dates, matches the wallet, the one of the options when `given`;
 * undefined asks again. Dates with ? are searched with the codes.
 */
async function byWallet(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
  given: boolean,
): Promise<MissingOutcome | undefined> {
  const dates = search.needsDates ? await askCodeDates(search, true) : undefined;
  const evidence = given ? answers.evidence : await askWallet(answers.place);
  if (evidence === undefined) return undefined;
  const way = search.byWallet(walletCheckOf(evidence, answers.passphrase)!, dates);
  if (!(await started(way, answers.maxCandidates))) return undefined;
  return outcomeOf(search, await ran(way));
}

/** The dates of the masked codes, with ? for a forgotten digit where `patterns`. */
function askCodeDates(search: MissingCodesSearch, patterns: boolean): Promise<DatesAnswer> {
  return askDates({ wordCount: search.codes.wordCount, patterns });
}

/** The wallet asked on the screen; undefined when the person goes back. */
async function askWallet(place: WalletPlace | undefined): Promise<WalletEvidence | undefined> {
  const answer = await askWalletEvidence({
    optional: false,
    ...(place === undefined ? {} : { place }),
  });
  return answer.kind === "wallet" ? answer.evidence : undefined;
}

/** Every candidate with its phrase and fingerprint, for the person to compare. */
async function listed(search: MissingCodesSearch): Promise<MissingOutcome> {
  const dates = search.needsDates ? (await askCodeDates(search, false)).known : [];
  const result = await ran(search.listed(dates));
  if (result.kind === "list")
    result.rows.forEach(({ codes, phrase, fingerprint }, index) =>
      console.log(`${index + 1}\t${codes}\t${phrase}\t${fingerprint}`),
    );
  terminalHint(MISSING_CODES_TEXTS.list);
  return { kind: "shown" };
}

/**
 * The one set of codes found, reported; none says why and asks again; several, which a
 * fingerprint leaves only by chance, are told by the wallet or the codes are typed again.
 */
async function outcomeOf(
  search: MissingCodesSearch,
  result: MissingCodesResult,
): Promise<MissingOutcome | undefined> {
  if (result.kind === "found") {
    reportFound(search.codes, result.backup, result.foundDates);
    return result;
  }
  if (result.kind === "none") {
    terminalNotice(result.message, "warning");
    return undefined;
  }
  if (result.kind !== "several") return { kind: "shown" };
  terminalNotice(result.message, "warning");
  const next = await askAfterFailure(
    "What now?",
    [
      { label: "Tell them by the wallet", value: "wallet" },
      { label: "Type the codes again", value: "again" },
    ] as const,
    { escape: "types the codes again" },
  );
  return next === "again" ? { kind: "again" } : undefined;
}
