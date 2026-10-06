// Finds forgotten digits of Seedshift dates: every combination that the date patterns allow is
// tried with the known dates, and the checksum-valid phrases are kept. Only the wallet tells which
// of them is the right one, so the caller checks each against a fingerprint or an address; the
// command line and other hosts share this search and differ only in that check and in reporting.

import { datePatternCombinations, formatDate, sortDates } from "./dates.js";
import { decodeIndexes, decodeIndexesLegacy, decodeIndexesLegacyValid } from "./seedshift.js";
import type { DatePattern, DateShiftDate, DecodedResult } from "./types.js";

/** The Seedshift variants whose dates can be searched. */
export type SeedshiftMode = "seedshift" | "seedshift-legacy" | "seedshift-legacy-valid";

/** A phrase that one combination of dates gives, with the guessed dates sorted. */
export interface DateCandidate {
  readonly dates: readonly DateShiftDate[];
  readonly mnemonic: string;
}

const SEEDSHIFT_MODES: ReadonlySet<string> = new Set<SeedshiftMode>([
  "seedshift",
  "seedshift-legacy",
  "seedshift-legacy-valid",
]);

/** The phrases that `dates` give in `mode`; the legacy-valid variant can give several. */
function decodeWith(
  indexes: readonly number[],
  dates: readonly DateShiftDate[],
  mode: SeedshiftMode,
): DecodedResult[] {
  switch (mode) {
    case "seedshift":
      return [decodeIndexes(indexes, dates)];
    case "seedshift-legacy":
      return [decodeIndexesLegacy(indexes, dates)];
    case "seedshift-legacy-valid":
      return decodeIndexesLegacyValid(indexes, dates);
  }
}

/**
 * Tries every combination of the forgotten dates (datePatternCombinations) together with the
 * known ones. It yields once per combination, with the checksum-valid phrases that are new, so
 * that the caller can count combinations for progress and check each phrase as it comes.
 */
export function* dateRecoveryCandidates(
  indexes: readonly number[],
  knownDates: readonly DateShiftDate[],
  patterns: readonly DatePattern[],
  mode: SeedshiftMode,
): Generator<readonly DateCandidate[]> {
  // A JavaScript host may pass any value; another mode would silently decode another way.
  if (!SEEDSHIFT_MODES.has(mode as string)) throw new Error("Unsupported Seedshift mode.");
  // Two combinations may name the same dates in another order; each result is kept once.
  const seen = new Set<string>();
  for (const guessed of datePatternCombinations(patterns)) {
    const sorted = sortDates(guessed);
    const key = sorted.map(formatDate).join(" ");
    const fresh: DateCandidate[] = [];
    decodeWith(indexes, [...knownDates, ...guessed], mode).forEach((result, index) => {
      if (!result.checksumValid || seen.has(`${key}\0${index}`)) return;
      seen.add(`${key}\0${index}`);
      fresh.push({ dates: sorted, mnemonic: result.recoveredMnemonic });
    });
    yield fresh;
  }
}
