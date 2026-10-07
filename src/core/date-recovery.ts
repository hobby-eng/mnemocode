// Finds forgotten digits of Seedshift dates: every combination that the date patterns allow is
// tried with the known dates, and the checksum-valid phrases are kept. Only the wallet tells which
// of them is the right one, so the caller checks each against a fingerprint or an address; the
// command line and other hosts share this search and differ only in that check and in reporting.

import { datePatternCombinations, deriveShifts, sortDates } from "./dates.js";
import { Masking } from "./masking.js";
import type { Bip39WordCount, DatePattern, DateShiftDate } from "./types.js";
import { BIP39_DICTIONARY_SIZE } from "./words.js";

/** The Seedshift variants whose dates can be searched. */
export type SeedshiftMode = "seedshift" | "seedshift-legacy" | "seedshift-legacy-valid";

/** A phrase that one combination of dates gives, with the guessed dates sorted. */
export interface DateCandidate {
  readonly dates: readonly DateShiftDate[];
  readonly mnemonic: string;
}

/**
 * Tries every combination of the forgotten dates (datePatternCombinations) together with the
 * known ones. It yields once per combination, with the checksum-valid phrases that are new, so
 * that the caller can count combinations for progress and check each phrase as it comes.
 *
 * A combination that shifts every word as an earlier one did gives the same phrases, and none:
 * the same dates in another order, or a year 2,048 years later, since Seedshift adds the year to
 * a word number modulo the 2,048 words. So a forgotten year is not found four or five times over,
 * each shift is tried once, with the earliest dates that give it.
 */
export function* dateRecoveryCandidates(
  indexes: readonly number[],
  knownDates: readonly DateShiftDate[],
  patterns: readonly DatePattern[],
  mode: SeedshiftMode,
): Generator<readonly DateCandidate[]> {
  // A JavaScript host may pass any value; another mode would silently decode another way.
  if (!Masking.isMode(mode) || !Masking.of(mode).masked)
    throw new Error("Unsupported Seedshift mode.");
  const masking = Masking.of(mode);
  const seen = new Set<string>();
  for (const guessed of datePatternCombinations(patterns)) {
    const shifts = deriveShifts([...knownDates, ...guessed], indexes.length as Bip39WordCount)
      .map((shift) => shift % BIP39_DICTIONARY_SIZE)
      .join(",");
    if (seen.has(shifts)) {
      yield [];
      continue;
    }
    seen.add(shifts);
    const sorted = sortDates(guessed);
    yield masking
      .undo(indexes, [...knownDates, ...guessed])
      .filter((result) => result.checksumValid)
      .map((result) => ({ dates: sorted, mnemonic: result.recoveredMnemonic }));
  }
}
