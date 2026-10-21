// AUD-012-SEC004: the assessment of shares wipes every array that holds a share's part of the
// secret, except those that the plan's search keeps. Public SSKR vectors only.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { planJointRepair, searchOnce } from "../src/sskr/joint-repair.js";
import { ReadingSpace } from "../src/sskr/repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { writeShare } from "../src/sskr/transport.js";
import { sskrVectors } from "./helpers/vectors.js";

/** The solver, watched only: every reading of the assessment is solved through it (beforeEach). */
let solve: MockInstance<typeof ReadingSpace.solve>;

const vector = sskrVectors().deterministic[0]!;

/** The share in words with the words at `places` marked with ?. */
function marked(share: string, places: readonly number[]): string {
  const words = writeShare(share, "words").split(" ");
  for (const place of places) words[place] = "?";
  return words.join(" ");
}

/** Every reading that the assessment solved so far, as the solver returned it. */
function solvedSpaces(): ReadingSpace[] {
  return solve.mock.results.flatMap((result) =>
    result.type === "return" && result.value !== undefined ? [result.value] : [],
  );
}

/** Whether every array of every reading solved so far is all zero. */
function allWiped(): boolean {
  return solvedSpaces()
    .flatMap((space) => space.secretArrays())
    .every((array) => array.every((byte) => byte === 0));
}

describe("AUD-012-SEC004: an assessment keeps only what its search needs", () => {
  beforeEach(() => {
    solve = vi.spyOn(ReadingSpace, "solve");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the readings of a plan that searches, which finds the phrase twice", async () => {
    const plan = await planJointRepair(
      vector.shares.map((share, index) => marked(share, [2 + index, 7 + index])),
      { platform: nodeSharePlatform },
    );
    expect(plan.assessment.verdict).toBe("determined");
    expect(allWiped()).toBe(false);
    const mnemonic = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    for (let time = 0; time < 2; time += 1)
      expect((await plan.search()).sets.map((set) => set.mnemonic)).toEqual([mnemonic]);
  });

  it("wipes what the plan kept once its one search is over (S008)", async () => {
    const plan = await planJointRepair(
      vector.shares.map((share, index) => marked(share, [2 + index, 7 + index])),
      { platform: nodeSharePlatform },
    );
    const mnemonic = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    expect((await searchOnce(plan)).sets.map((set) => set.mnemonic)).toEqual([mnemonic]);
    expect(allWiped()).toBe(true);
  });

  it("wipes every reading of shares that it refuses", async () => {
    // Two shares of one set cannot be its third share too: the same share twice is refused.
    const typed = marked(vector.shares[0]!, [3]);
    const plan = await planJointRepair([typed, typed], { platform: nodeSharePlatform });
    expect(["search", "determined"]).not.toContain(plan.assessment.verdict);
    expect(solvedSpaces().length).toBeGreaterThan(0);
    expect(allWiped()).toBe(true);
  });

  it("wipes what it read when it is stopped between two shares", async () => {
    const stop = new AbortController();
    // The host stops at its turn once a share is read: the turn between the first two shares.
    const turn = async () => {
      if (solve.mock.calls.length > 0) stop.abort();
    };
    // A stop is a result, not an error (CORE-22): the plan says "stopped" and keeps nothing.
    const plan = await planJointRepair(
      vector.shares.map((share) => marked(share, [4])),
      { platform: nodeSharePlatform, signal: stop.signal, turn },
    );
    expect(plan.assessment.verdict).toBe("stopped");
    expect(solvedSpaces().length).toBeGreaterThan(0);
    expect(allWiped()).toBe(true);
  });
});
