// Bounded public-fixture baseline probe; original input/output hashes are in the report.
import assert from "node:assert/strict";
import {
  datePatternCombinationCount,
  datePatternCombinations,
  dateRecoveryCandidates,
  encodeMnemonic,
  parseDate,
} from "../../../src/core.ts";
import { DatesAnswer } from "../../../src/core/date-search.ts";
const p1 = { key: "same", years: [2026], months: [1], days: [2] };
const p2 = { key: "same", years: [2026], months: [1], days: [1] };
const publicPhrase = "abandon ".repeat(11) + "about";
const encoded = encodeMnemonic(publicPhrase, [parseDate("02-01-2026"), parseDate("01-01-2026")]);
const declaredCount = datePatternCombinationCount([p1, p2]);
const rawCombinations = [...datePatternCombinations([p1, p2])];
const rawRecoveryBatches = [
  ...dateRecoveryCandidates(encoded.shiftedIndexes, [], [p1, p2], "seedshift"),
];
let wrapperRejection;
try {
  DatesAnswer.of([], [p1, p2]);
} catch (error) {
  wrapperRejection = error.message;
}
const distinct = [p1, { ...p2, key: "different" }];
const distinctCombinations = [...datePatternCombinations(distinct)];
const distinctRecovery = [
  ...dateRecoveryCandidates(encoded.shiftedIndexes, [], distinct, "seedshift"),
];
const identical = [0, 1].map(() => ({ key: "equal", years: [2026], months: [1], days: [1, 2] }));
const identicalCount = datePatternCombinationCount(identical);
const identicalEnumeratedCount = [...datePatternCombinations(identical)].length;
const parsed = DatesAnswer.parse("02-01-2026 01-01-2026", { wordCount: 12, patterns: true });
assert.equal(declaredCount, 1);
assert.equal(rawCombinations.length, 0);
assert.equal(rawRecoveryBatches.length, 0);
assert.match(wrapperRejection, /key of an earlier one/);
assert.equal(distinctCombinations.length, 1);
assert(distinctRecovery.flat().some((x) => x.mnemonic === publicPhrase));
assert.equal(identicalCount, 3);
assert.equal(identicalEnumeratedCount, 3);
console.log(
  JSON.stringify({
    id: "CORE-NEW-002",
    conflictingPatterns: [p1, p2],
    declaredCount,
    enumeratedCount: rawCombinations.length,
    recoveryBatches: rawRecoveryBatches.length,
    protectedDatesAnswerRejection: wrapperRejection,
    distinctKeyDeclaredCount: datePatternCombinationCount(distinct),
    distinctKeyEnumeratedCount: distinctCombinations.length,
    distinctKeyRecoversPublicSource: distinctRecovery
      .flat()
      .some((x) => x.mnemonic === publicPhrase),
    identicalKeySameDomainCount: identicalCount,
    identicalKeySameDomainEnumerated: identicalEnumeratedCount,
    completeTextParseKnownDates: parsed.known.length,
  }),
);
