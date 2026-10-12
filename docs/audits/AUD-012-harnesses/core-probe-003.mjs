// Bounded public-fixture baseline probe; original input/output hashes are in the report.
import assert from "node:assert/strict";
import {
  placeCombinations,
  searchCandidates,
  WordCandidateSearch,
} from "../../../src/core/candidates.ts";
const snapshots = (places, count) => {
  const iterator = placeCombinations(places);
  return Array.from({ length: count }, () => {
    const item = iterator.next();
    return {
      done: item.done === true,
      values: item.value?.map((v) => (v === undefined ? "undefined" : v)),
    };
  });
};
const emptyLast = snapshots([[0], []], 3);
const emptyFirst = snapshots([[], [0]], 3);
const valid = [
  ...placeCombinations([
    [0, 1],
    [2, 3],
  ]),
].map((x) => [...x]);
// Above deliberately exposes documented array reuse: take proper snapshots during iteration.
const properSnapshots = [];
for (const x of placeCombinations([
  [0, 1],
  [2, 3],
]))
  properSnapshots.push([...x]);
const invalidPlaces = Array.from({ length: 12 }, (_, i) => (i === 11 ? [] : [0]));
const refusals = {};
for (const [name, invoke] of [
  [
    "searchCandidates",
    () => searchCandidates({ kind: "unknown-words", places: invalidPlaces }).next(),
  ],
  [
    "WordCandidateSearch",
    () => WordCandidateSearch.of({ kind: "unknown-words", places: invalidPlaces }),
  ],
]) {
  try {
    invoke();
  } catch (error) {
    refusals[name] = error.message;
  }
}
assert(emptyLast.every((x) => !x.done && x.values.includes("undefined")));
assert(emptyFirst.every((x) => !x.done && x.values.includes("undefined")));
assert.deepEqual(properSnapshots, [
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
]);
assert.equal(Object.keys(refusals).length, 2);
console.log(
  JSON.stringify({
    id: "CORE-NEW-003",
    iteratorStepsPerInvalidInput: 3,
    emptyLast,
    emptyFirst,
    validSnapshotCount: properSnapshots.length,
    validSnapshots: properSnapshots,
    guardedBoundaryRefusals: refusals,
    reusedArrayIsDocumented: true,
  }),
);
