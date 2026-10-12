// AUD-010 core probe: DateSearch's time estimate for each mode against the time the same search
// takes (src/core/date-search.ts). secondsPerCombination decodes the first combinations of a
// 24-word public phrase (PROBE_INDEXES); the Original Seedshift with a valid last word decodes
// 2^(11 - checksum bits) phrases per combination, 8 for 24 words but 128 for 12, so its estimate
// for a shorter phrase may be far too short. estimatedSeconds without a wallet check is all
// decoding, and needsQuestion asks only above twelve hours by it (README: "A search that takes
// up to 12 hours starts at once; a longer one is asked for first").
// Public fixtures only: abandon x11 about, abandon x23 art, synthetic dates. Timing-based: the
// check fails only when the measured time is more than three times the estimate.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { DatesAnswer, DateSearch } from "../../../src/core/date-search.js";
import { Masking } from "../../../src/core/masking.js";
import type { SeedshiftMode } from "../../../src/core/date-recovery.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}

const MODES: readonly SeedshiftMode[] = ["seedshift", "seedshift-legacy", "seedshift-legacy-valid"];
for (const words of [12, 24] as const) {
  const phrase = entropyToMnemonic(new Uint8Array(words === 12 ? 16 : 32), wordlist);
  for (const mode of MODES) {
    const codes = Masking.of(mode).encode(phrase, [
      { year: 2026, month: 9, day: 23 },
    ]).shiftedIndexes;
    const dates = DatesAnswer.parse("??-??-2026", { patterns: true, wordCount: words });
    const search = new DateSearch({ indexes: codes, dates, mode, maxShown: 0 });
    const pace = await search.pace();
    const estimate = search.estimatedSeconds(pace);
    const start = performance.now();
    const result = await search.run({ turn: async () => {} });
    const actual = (performance.now() - start) / 1000;
    const perCombinationPhrases = Masking.of(mode).undo(codes, [
      { year: 2026, month: 9, day: 23 },
    ]).length;
    check(
      `${words} words ${mode}: run time within three times the estimate`,
      actual <= 3 * estimate,
      {
        combinations: result.combinations,
        phrasesDecodedPerCombination: perCombinationPhrases,
        estimatedSeconds: Number(estimate.toFixed(3)),
        actualSeconds: Number(actual.toFixed(3)),
        ratio: Number((actual / estimate).toFixed(1)),
      },
    );
  }
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
