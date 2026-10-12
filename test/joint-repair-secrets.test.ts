// AUD-012-SEC004: the assessment of shares wipes every array that holds a share's part of the
// secret, except those that the plan's search keeps. Public SSKR vectors only.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { planJointRepair, searchOnce } from "../src/sskr/joint-repair.js";
import { ReadingSpace } from "../src/sskr/repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { writeShare } from "../src/sskr/transport.js";

/** Every reading that the assessment solves, and what runs after each is solved. */
const solved = {
  spaces: [] as ReadingSpace[],
  after: undefined as (() => void) | undefined,
};
/** The solver itself, which the spy below watches: every reading is solved through it. */
const solve = ReadingSpace.solve.bind(ReadingSpace);

const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
  deterministic: { entropy: string; shares: string[] }[];
};
const vector = vectors.deterministic[0]!;

/** The share in words with the words at `places` marked with ?. */
function marked(share: string, places: readonly number[]): string {
  const words = writeShare(share, "words").split(" ");
  for (const place of places) words[place] = "?";
  return words.join(" ");
}

/** Whether every array of every reading solved so far is all zero. */
function allWiped(): boolean {
  return solved.spaces
    .flatMap((space) => space.secretArrays())
    .every((array) => array.every((byte) => byte === 0));
}

describe("AUD-012-SEC004: an assessment keeps only what its search needs", () => {
  beforeEach(() => {
    solved.spaces = [];
    solved.after = undefined;
    vi.spyOn(ReadingSpace, "solve").mockImplementation((reading) => {
      const space = solve(reading);
      if (space !== undefined) solved.spaces.push(space);
      solved.after?.();
      return space;
    });
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
      expect((await plan.search()).map((set) => set.mnemonic)).toEqual([mnemonic]);
  });

  it("wipes what the plan kept once its one search is over (S008)", async () => {
    const plan = await planJointRepair(
      vector.shares.map((share, index) => marked(share, [2 + index, 7 + index])),
      { platform: nodeSharePlatform },
    );
    const mnemonic = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    expect((await searchOnce(plan)).map((set) => set.mnemonic)).toEqual([mnemonic]);
    expect(allWiped()).toBe(true);
  });

  it("wipes every reading of shares that it refuses", async () => {
    // Two shares of one set cannot be its third share too: the same share twice is refused.
    const typed = marked(vector.shares[0]!, [3]);
    const plan = await planJointRepair([typed, typed], { platform: nodeSharePlatform });
    expect(["search", "determined"]).not.toContain(plan.assessment.verdict);
    expect(solved.spaces.length).toBeGreaterThan(0);
    expect(allWiped()).toBe(true);
  });

  it("wipes what it read when it is stopped between two shares", async () => {
    const stop = new AbortController();
    solved.after = () => stop.abort();
    await expect(
      planJointRepair(
        vector.shares.map((share) => marked(share, [4])),
        { platform: nodeSharePlatform, signal: stop.signal },
      ),
    ).rejects.toThrow();
    expect(solved.spaces.length).toBeGreaterThan(0);
    expect(allWiped()).toBe(true);
  });
});
