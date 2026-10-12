// AUD-010 core probe: the memory of a date search (src/core/date-recovery.ts). dateRecoveryCandidates
// keeps the shift vector of every distinct combination in one Set for the whole search, while
// DatesAnswer allows searches up to HARD_MAX_COMBINATIONS = 2^31 ("about a month"). V8 refuses a
// Set of more than 2^24 entries ("RangeError: Set maximum size exceeded"), so a search of more than
// 16,777,216 distinct shift vectors would fail part way, after hours of work.
//
// Bounded by default (about a minute, under 1 GiB):
//   1. the V8 limit itself, in a child process: a Set of 2^24 + 1 integers;
//   2. a search of 39,445,920 combinations that DatesAnswer and DateSearch accept and that,
//      without a wallet check, starts without being asked (under twelve hours by its estimate);
//   3. the first 300,000 combinations of that search through the production generator, with the
//      heap retained after garbage collection measured every 100,000.
// With --to-failure it runs that whole search through DateSearch.run until it ends or fails
// (about half an hour and 1.5 to 2 GiB of heap): for the coordinator to schedule, not by default.
// Run with node --expose-gc --import tsx. Public fixtures only: abandon x11 about, synthetic dates.

import { spawnSync } from "node:child_process";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { dateRecoveryCandidates } from "../../../src/core/date-recovery.js";
import { DatesAnswer, DateSearch, HARD_MAX_COMBINATIONS } from "../../../src/core/date-search.js";
import { QUESTION_SECONDS } from "../../../src/core/search-turns.js";
import { Masking } from "../../../src/core/masking.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}
const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) {
  console.log("Run with node --expose-gc --import tsx.");
  process.exit(2);
}

// 1. The V8 limit.
{
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "const s=new Set();let i=0;try{for(;i<2**24+1;i++)s.add(i);console.log('added '+i)}catch(e){console.log('failed at '+i+': '+e)}",
    ],
    { encoding: "utf8" },
  );
  const line = child.stdout.trim();
  check(
    "V8: a Set holds at most 2^24 = 16,777,216 entries",
    line === "failed at 16777216: RangeError: Set maximum size exceeded",
    { child: line, node: process.version },
  );
}

// 2. A search beyond 2^24 combinations that is accepted and starts at once.
const PHRASE = entropyToMnemonic(new Uint8Array(16), wordlist);
const TRUE_DATES = [
  { year: 1975, month: 6, day: 15 },
  { year: 2004, month: 3, day: 7 },
];
const LINE = "?-?-19?? 0?-?-200?";
const codes = Masking.of("seedshift-legacy").encode(PHRASE, TRUE_DATES).shiftedIndexes;
const dates = DatesAnswer.parse(LINE, { patterns: true, wordCount: 12 });
const search = new DateSearch({ indexes: codes, dates, mode: "seedshift-legacy", maxShown: 10 });
const pace = await search.pace();
const seconds = search.estimatedSeconds(pace);
check(
  `DatesAnswer accepts "${LINE}" with more than 2^24 and at most 2^31 combinations`,
  dates.combinations > 2 ** 24 && dates.combinations <= HARD_MAX_COMBINATIONS,
  {
    combinations: dates.combinations,
    setLimit: 2 ** 24,
    hardMax: HARD_MAX_COMBINATIONS,
  },
);
console.log(
  JSON.stringify({
    info: "without a wallet check the search starts without a question",
    estimatedHours: Number((seconds / 3600).toFixed(2)),
    questionAboveHours: QUESTION_SECONDS / 3600,
    needsQuestion: search.needsQuestion(pace),
  }),
);

// 3. Heap retained by the production generator, combination by combination.
{
  gc();
  const base = process.memoryUsage().heapUsed;
  const generator = dateRecoveryCandidates(codes, dates.known, dates.patterns, "seedshift-legacy");
  const samples: { combinations: number; retainedBytes: number }[] = [];
  let combinations = 0;
  const started = performance.now();
  for (const step of generator) {
    void step;
    combinations += 1;
    if (combinations % 100_000 === 0) {
      gc();
      samples.push({ combinations, retainedBytes: process.memoryUsage().heapUsed - base });
      if (combinations === 300_000) break;
    }
  }
  const perCombination =
    (samples.at(-1)!.retainedBytes - samples[0]!.retainedBytes) /
    (samples.at(-1)!.combinations - samples[0]!.combinations);
  const secondsPerCombination = (performance.now() - started) / 1000 / combinations;
  check("the generator's memory does not grow with every combination", perCombination < 8, {
    samples,
    retainedBytesPerCombination: Math.round(perCombination),
    projectedRetainedAtSetLimitMiB: Math.round((perCombination * 2 ** 24) / 2 ** 20),
    projectedMinutesToSetLimit: Math.round((secondsPerCombination * 2 ** 24) / 60),
  });
}

// 4. Optional: the whole search, to its end or its failure.
if (process.argv.includes("--to-failure")) {
  let checked = 0;
  const started = Date.now();
  try {
    const result = await search.run({
      progressEvery: 1_000_000,
      onProgress: (progress) => {
        checked = progress.checked;
        console.log(
          JSON.stringify({
            progress: progress.checked,
            heapMiB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
            minutes: Math.round((Date.now() - started) / 60000),
          }),
        );
      },
    });
    check("the whole search ends", true, {
      combinations: result.combinations,
      matchCount: result.matchCount,
    });
  } catch (error) {
    check("the whole search ends", false, {
      error: String(error),
      lastProgress: checked,
      minutes: Math.round((Date.now() - started) / 60000),
    });
  }
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
