// Bounded public-fixture baseline probe; original input/output hashes are in the report.
import assert from "node:assert/strict";
import { formatEncoded, parseDate } from "../../../src/core.ts";
import { Masking } from "../../../src/core/masking.ts";
import { DatesAnswer } from "../../../src/core/date-search.ts";
import { MissingCodes } from "../../../src/core/missing-codes.ts";
import { MissingCodesSearch } from "../../../src/core/missing-codes-search.ts";
import { asksFirst, QUESTION_SECONDS } from "../../../src/core/search-turns.ts";
// Virtual calibration measures a synthetic slow host without sleeping or expensive derivation.
// Only performance.now in this disposable probe process is replaced; source is untouched.
const priorNow = Object.getOwnPropertyDescriptor(performance, "now");
let virtualMilliseconds = 0;
Object.defineProperty(performance, "now", {
  configurable: true,
  value: () => virtualMilliseconds,
});
const records = [];
try {
  for (const [mode, wordCount] of [
    ["seedshift-legacy-valid", 12],
    ["seedshift-legacy-valid", 24],
    ["seedshift", 12],
  ]) {
    const publicPhrase = "abandon ".repeat(wordCount - 1) + (wordCount === 12 ? "about" : "art");
    const date = parseDate("23-09-2026");
    const encoded = Masking.of(mode).encode(publicPhrase, [date]);
    const tokens = formatEncoded(encoded, "indexes").split(" ");
    tokens[2] = tokens[2].slice(0, -1) + "?";
    const codes = MissingCodes.read(tokens.join(" "), "indexes", mode);
    const candidates = [...codes.candidates()];
    assert(codes.combinations <= 10 && candidates.length <= 10);
    const perCheckSeconds = 1000;
    let calls = 0;
    const check = async () => {
      if (++calls > 2000) throw new Error("bounded probe callback cap exceeded");
      virtualMilliseconds += perCheckSeconds * 1000;
      return { matched: false };
    };
    const way = new MissingCodesSearch(codes, () => "00000000").byWallet(
      check,
      DatesAnswer.of([date]),
    );
    const plan = await way.plan();
    const calibrationCalls = calls;
    const limited = await way.plan(0);
    calls = 0;
    const run = await way.run({ signal: AbortSignal.timeout(5000) });
    const runWalletCalls = calls;
    const modeChecks = Masking.of(mode).checksPerCombination(wordCount);
    const projectedWalletWorkSeconds = runWalletCalls * perCheckSeconds;
    assert.equal(calibrationCalls, 3);
    assert.equal(plan.seconds, codes.expected * perCheckSeconds);
    assert.equal(run.kind, "none");
    assert.equal(runWalletCalls, candidates.length * modeChecks);
    assert.equal(limited.ask, true);
    if (mode === "seedshift-legacy-valid") {
      assert.equal(plan.ask, false);
      if (wordCount === 12) assert(projectedWalletWorkSeconds > QUESTION_SECONDS);
    }
    records.push({
      mode,
      wordCount,
      markedInput: tokens.join(" "),
      codeCombinations: codes.combinations,
      estimatedCodeCandidates: codes.expected,
      actualCodeCandidates: candidates.length,
      modeChecksPerCandidate: modeChecks,
      calibrationCalls,
      virtualPerCheckSeconds: perCheckSeconds,
      plan,
      runWalletCalls,
      projectedWalletWorkSeconds,
      thresholdSeconds: QUESTION_SECONDS,
      consentForObservedWorkload: asksFirst(plan.count, projectedWalletWorkSeconds),
      explicitLimitZeroAsks: limited.ask,
      resultKind: run.kind,
    });
  }
  // A large plan alone is O(1) here: no candidate enumeration/run is performed.
  const date = parseDate("23-09-2026");
  const encoded = Masking.of("seedshift-legacy-valid").encode("abandon ".repeat(11) + "about", [
    date,
  ]);
  const tokens = formatEncoded(encoded, "indexes").split(" ");
  tokens[0] = "?";
  tokens[1] = "?";
  const codes = MissingCodes.read(tokens.join(" "), "indexes", "seedshift-legacy-valid");
  let calibrationCalls = 0;
  const check = async () => {
    ++calibrationCalls;
    virtualMilliseconds += 1.5;
    return { matched: false };
  };
  const plan = await new MissingCodesSearch(codes, () => "00000000")
    .byWallet(check, DatesAnswer.of([date]))
    .plan();
  const projectedSecondsIncludingMode =
    codes.expected * 0.0015 * Masking.of("seedshift-legacy-valid").checksPerCombination(12);
  assert.equal(calibrationCalls, 3);
  assert.equal(codes.combinations, 4194304);
  assert.equal(plan.ask, false);
  assert(projectedSecondsIncludingMode > QUESTION_SECONDS);
  records.push({
    kind: "plan-only; candidates not enumerated; duration projected, not executed",
    mode: "seedshift-legacy-valid",
    wordCount: 12,
    codeCombinations: codes.combinations,
    estimatedCodeCandidates: codes.expected,
    syntheticPerCheckMilliseconds: 1.5,
    calibrationCalls,
    plan,
    projectedSecondsIncludingMode,
    thresholdSeconds: QUESTION_SECONDS,
    modeAwareConsent: asksFirst(plan.count, projectedSecondsIncludingMode),
  });
} finally {
  if (priorNow === undefined) delete performance.now;
  else Object.defineProperty(performance, "now", priorNow);
}
console.log(
  JSON.stringify({
    id: "CORE-NEW-004",
    clockMode:
      "virtual performance.now calibration only; no sleep; real workload <=1280 cheap callback calls per case",
    records,
  }),
);
