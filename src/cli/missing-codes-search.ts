// Decode's search for codes marked with ?, on the private screen: how the right codes are told
// (the encoded fingerprint that Encode showed for them, the wallet once the dates have decoded a
// candidate, or every candidate listed where they are few), the search itself with its progress
// on one line, and what it found. Decode's options may answer the first way asked: the encoded
// fingerprint, the wallet or the list, and the limit of a long search. The codes and the search
// are the core's MissingCodes (core/missing-codes.ts); this module only asks, composes the check
// and shows.

import {
  masterFingerprint,
  parseMasterFingerprint,
  walletCheckOf,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { parseDate, type DateShiftDate } from "../core.js";
import type { SeedshiftMode } from "../core/date-recovery.js";
import { DateSearch, type DatesAnswer } from "../core/date-search.js";
import { QUESTION_SECONDS } from "../core/search-turns.js";
import type { WalletCheck } from "../core/wallet-check.js";
import { EncodedBackup } from "../core/encoded-backup.js";
import { Masking } from "../core/masking.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { englishWordlist } from "../core/words.js";
import { askAfterFailure, askValueUntil, askWalletEvidence, type WalletPlace } from "./ask.js";
import { askDates } from "./date-search.js";
import { RepairReport } from "../sskr/repair-report.js";
import { choose, type Choice } from "./terminal-choice.js";
import { dropTypedAhead, withCtrlCWatch } from "./terminal-input.js";
import { ProgressLine, terminalHint, terminalNotice, terminalStatus } from "./terminal.js";

/** Candidates that are listed for the person to compare, rather than told by a fingerprint. */
const MAX_LISTED = 16;
/** Seconds between two progress updates of a long search. */
const PROGRESS_SECONDS = 2;
/** A search expected to take at least this long has its time said before it starts. */
const LONG_SEARCH_SECONDS = 60;

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

/** How the right codes are told. */
type Way = "encoded" | "wallet" | "list";

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
function givenWay(codes: MissingCodes, answers: MissingCodesAnswers): Way | undefined {
  const ways = waysFor(codes).map((way) => way.value);
  if (answers.encodedFingerprint !== undefined) {
    // Codes without Seedshift are not offered the way, since their encoded fingerprint is the
    // wallet's own; given, it tells them all the same, as for every set that keeps a checksum.
    if (codes.checksummed) return "encoded";
    terminalNotice(
      "--encoded-fingerprint cannot tell these codes: they keep no checksum.",
      "warning",
    );
  }
  if (answers.evidence !== undefined) return "wallet";
  if (answers.list) {
    if (ways.includes("list")) return "list";
    terminalNotice(
      `--list-candidates lists at most ${MAX_LISTED} candidates; these codes have about ${RepairReport.counted(codes.expected, "candidate")}.`,
      "warning",
    );
  }
  return undefined;
}

/** "Code 6", "Codes 6 and 9", "Codes 2, 6 and 9". */
function placesText(places: readonly number[]): string {
  if (places.length === 1) return `Code ${places[0]}`;
  return `Codes ${places.slice(0, -1).join(", ")} and ${places.at(-1)}`;
}

/** The ways that fit the codes: the encoded fingerprint only where the codes keep a checksum. */
function waysFor(codes: MissingCodes): Choice<Way>[] {
  const masked = Masking.of(codes.mode).masked;
  const ways: Choice<Way>[] = [];
  if (masked && codes.checksummed)
    ways.push({
      label: "Encoded fingerprint",
      note: "the one Encode showed; no dates needed",
      value: "encoded",
    });
  ways.push({
    label: "The wallet",
    note: masked
      ? "its fingerprint or an address, after the dates"
      : "its fingerprint or an address",
    value: "wallet",
  });
  if (codes.expected <= MAX_LISTED)
    ways.push({ label: "List every candidate", note: "compare them yourself", value: "list" });
  return ways;
}

/**
 * Searches `codes` with `check` while Ctrl+C is read as a key, with its progress on one line, and
 * returns the sets of codes that passed.
 */
async function searched(
  codes: MissingCodes,
  check: (indexes: readonly number[]) => boolean | Promise<boolean>,
): Promise<readonly EncodedBackup[]> {
  const progress = new ProgressLine();
  let shown = Date.now();
  try {
    const result = await withCtrlCWatch((signal) =>
      codes.run({
        check,
        signal,
        onProgress: ({ count, found }) => {
          if (Date.now() - shown < PROGRESS_SECONDS * 1000) return;
          shown = Date.now();
          progress.show(
            `Checked ${count.toLocaleString("en-US")} of about ${codes.expected.toLocaleString("en-US")}; ${found} found.`,
          );
        },
      }),
    );
    return result.found;
  } finally {
    progress.end();
  }
}

/** The phrase of codes as English words, which a fingerprint is taken of. */
function phraseOf(indexes: readonly number[]): string {
  return indexes.map((index) => englishWordlist[index]!).join(" ");
}

/**
 * Says what the search filled in, the codes whole with those found, so that the written copy can
 * be corrected; the decode shows it again with its result.
 */
export function reportFound(codes: MissingCodes, backup: EncodedBackup, foundDates?: string): void {
  terminalStatus(`${placesText(codes.missingPlaces)} found:`, backup.text());
  if (foundDates !== undefined) terminalStatus("Dates found:", foundDates);
  terminalHint("Correct the written copy; then check the wallet that comes back.");
}

/** The dates of a masked phrase, which may hold ? as a date search takes them; none without. */
async function askCodeDates(codes: MissingCodes): Promise<DatesAnswer | undefined> {
  if (!Masking.of(codes.mode).masked) return undefined;
  return askDates({ wordCount: codes.wordCount, patterns: true });
}

/**
 * Whether a search of `size`, `count` combinations about `seconds` long here, is made: up to
 * twelve hours, or up to `limit` combinations (--max-candidates), at once, its time said from a
 * minute; longer only when the person chooses it.
 */
async function startSearch(
  size: string,
  seconds: number,
  count: number,
  limit: number | undefined,
): Promise<boolean> {
  const time = seconds >= 1 ? `, ${RepairReport.duration(seconds)}` : "";
  if (limit !== undefined ? count > limit : seconds > QUESTION_SECONDS) {
    await dropTypedAhead();
    const start = await choose(
      `Search ${size}${time}?`,
      [
        { label: "Yes", note: "Ctrl+C stops it", value: true },
        { label: "No", note: "choose another way", value: false },
      ],
      { label: "Search", quit: "goes back" },
    );
    return start === true;
  }
  if (seconds >= LONG_SEARCH_SECONDS)
    terminalNotice(`The search tries ${size}${time}; progress is shown.`);
  return true;
}

/** Seconds of one fingerprint here, from a few of the public test phrase. */
async function secondsPerFingerprint(): Promise<number> {
  return DateSearch.secondsPerCheck((mnemonic) => ({
    matched: masterFingerprint(mnemonic) === "",
    path: "m",
  }));
}

/** The phrases that `backup` gives with `dates` and that pass their own checksum. */
function phrasesOf(backup: EncodedBackup, dates: readonly DateShiftDate[]): string[] {
  return backup
    .candidates(dates)
    .filter((result) => result.checksumValid)
    .map((result) => result.recoveredMnemonic);
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
  const missing = codes.missingPlaces;
  terminalNotice(
    `${placesText(missing)} cannot be read: ${RepairReport.counted(codes.combinations, "combination")}, about ${RepairReport.counted(codes.expected, "candidate")}.`,
    "warning",
  );
  if (codes.expected > MAX_LISTED)
    terminalHint("A fingerprint or an address tells the right codes among them.");
  for (let given = givenWay(codes, answers); ; given = undefined) {
    const way = given ?? (await askWay(codes));
    if (way === undefined) return { kind: "again" };
    const outcome =
      way === "encoded"
        ? await byEncodedFingerprint(codes, answers, given === "encoded")
        : way === "wallet"
          ? await byWallet(codes, answers, given === "wallet")
          : await listed(codes);
    if (outcome !== undefined) return outcome;
  }
}

/** Asks how the right codes are told; undefined types the codes again. */
async function askWay(codes: MissingCodes): Promise<Way | undefined> {
  await dropTypedAhead();
  return choose("How can MnemoCode tell the right codes?", waysFor(codes), {
    label: "Codes",
    quit: "types the codes again",
  });
}

/**
 * The codes whose own fingerprint is the encoded one that Encode showed, --encoded-fingerprint
 * when `given`; undefined asks again.
 */
async function byEncodedFingerprint(
  codes: MissingCodes,
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
  const seconds = codes.expected * (await secondsPerFingerprint());
  const size = RepairReport.counted(codes.expected, "candidate");
  if (!(await startSearch(size, seconds, codes.expected, answers.maxCandidates))) return undefined;
  const found = await searched(
    codes,
    (indexes) => masterFingerprint(phraseOf(indexes)) === fingerprint,
  );
  return foundOne(codes, found, "No codes fit this fingerprint: check it, and the codes.");
}

/**
 * The codes whose phrase, with the dates, matches the wallet, the one of the options when
 * `given`; undefined asks again. Dates with ? are searched for each candidate of the codes, as a
 * date search does (DateSearch), so that codes and dates are found together.
 */
async function byWallet(
  codes: MissingCodes,
  answers: MissingCodesAnswers,
  given: boolean,
): Promise<MissingOutcome | undefined> {
  const dates = await askCodeDates(codes);
  const evidence = given ? answers.evidence : await askWallet(answers.place);
  if (evidence === undefined) return undefined;
  const walletCheck = walletCheckOf(evidence, answers.passphrase)!;
  const nothing = "No codes give this wallet: check the dates, the wallet and the codes.";
  if (dates === undefined || !dates.hasForgottenDigits) {
    const known = dates?.known ?? [];
    const seconds = codes.expected * (await DateSearch.secondsPerCheck(walletCheck));
    const size = RepairReport.counted(codes.expected, "candidate");
    if (!(await startSearch(size, seconds, codes.expected, answers.maxCandidates)))
      return undefined;
    const found = await searched(codes, (indexes) =>
      phrasesOf(EncodedBackup.of(indexes, codes.format, codes.mode), known).some(
        (phrase) => walletCheck(phrase).matched,
      ),
    );
    const outcome = await foundOne(codes, found, nothing);
    return outcome?.kind === "found" ? { ...outcome, dates: known } : outcome;
  }
  return byWalletAndDates(codes, dates, walletCheck, nothing, answers.maxCandidates);
}

/** The wallet asked on the screen; undefined when the person goes back. */
async function askWallet(place: WalletPlace | undefined): Promise<WalletEvidence | undefined> {
  const answer = await askWalletEvidence({
    optional: false,
    ...(place === undefined ? {} : { place }),
  });
  return answer.kind === "wallet" ? answer.evidence : undefined;
}

/** Codes and dates found together: a date search for each candidate of the codes. */
async function byWalletAndDates(
  codes: MissingCodes,
  dates: DatesAnswer,
  walletCheck: WalletCheck,
  nothing: string,
  limit: number | undefined,
): Promise<MissingOutcome | undefined> {
  const mode = codes.mode as SeedshiftMode;
  const searchOf = (indexes: readonly number[]) =>
    new DateSearch({ indexes, dates, mode, walletCheck, maxShown: 1 });
  const first = codes.candidates().next();
  if (first.done === true) return foundOne(codes, [], nothing);
  const probe = searchOf(first.value);
  const seconds = codes.expected * probe.estimatedSeconds(await probe.pace());
  const size = `${RepairReport.counted(codes.expected, "candidate")} with ${RepairReport.counted(dates.combinations, "date combination")} each`;
  const count = codes.expected * dates.combinations;
  if (!(await startSearch(size, seconds, count, limit))) return undefined;
  // The dates of each set of codes that matched, by its codes, to decode them as they are.
  const matchedDates = new Map<string, string>();
  const found = await searched(codes, async (indexes) => {
    const result = await searchOf(indexes).run();
    const match = result.shown[0];
    if (match === undefined) return false;
    matchedDates.set(indexes.join(" "), match.dates);
    return true;
  });
  // Reported below with the dates found.
  const outcome = await foundOne(codes, found, nothing, false);
  if (outcome?.kind !== "found") return outcome;
  const foundDates = matchedDates.get(outcome.backup.indexes.join(" "))!;
  reportFound(codes, outcome.backup, foundDates);
  return { ...outcome, dates: foundDates.split(" ").map(parseDate), foundDates };
}

/** Every candidate with its phrase and fingerprint, for the person to compare. */
async function listed(codes: MissingCodes): Promise<MissingOutcome> {
  const dates = Masking.of(codes.mode).masked
    ? (await askDates({ wordCount: codes.wordCount, patterns: false })).known
    : [];
  const found = await searched(codes, () => true);
  let number = 0;
  for (const backup of found)
    for (const phrase of phrasesOf(backup, dates)) {
      number += 1;
      console.log(`${number}\t${backup.text()}\t${phrase}\t${masterFingerprint(phrase)}`);
    }
  terminalHint(
    "Each line: the codes, the seed phrase they give, and its fingerprint with an empty BIP39 passphrase. Compare the fingerprint with your wallet.",
  );
  return { kind: "shown" };
}

/**
 * The one set of codes found, reported; none says `nothing` and asks again; several, which a
 * fingerprint leaves only by chance, are listed and told by the wallet.
 */
async function foundOne(
  codes: MissingCodes,
  found: readonly EncodedBackup[],
  nothing: string,
  report = true,
): Promise<MissingOutcome | undefined> {
  if (found.length === 0) {
    terminalNotice(nothing, "warning");
    return undefined;
  }
  if (found.length === 1) {
    if (report) reportFound(codes, found[0]!);
    return { kind: "found", backup: found[0]! };
  }
  terminalNotice(`${found.length} sets of codes fit; the wallet tells which is yours.`, "warning");
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
