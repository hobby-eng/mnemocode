// The run of a word search with the host's services, as another host such as the Deriver uses it
// (WordCandidateSearch.run): which candidates are kept to be shown, the entropy of each for a list,
// the list that fills up, the wallet check that may answer later, and a stop. Public test phrase
// only.
import { describe, expect, it, vi } from "vitest";
import { MAX_SHOWN_CANDIDATES, WordCandidateSearch } from "../src/core/candidates.js";

const ELEVEN = "abandon ".repeat(11);
const TEST_PHRASE = `${ELEVEN}about`;
/** The last word forgotten: 128 checksum-valid candidates, the test phrase among them. */
const LAST = WordCandidateSearch.parse(`${ELEVEN}?`, "unknown-words");
/** The first and the last word forgotten: 262,144 candidates, more than MAX_SHOWN_CANDIDATES. */
const FIRST_AND_LAST = WordCandidateSearch.parse(`? ${"abandon ".repeat(10)}?`, "unknown-words");

describe("WordCandidateSearch.run", () => {
  it("keeps every candidate of a small search, each with its number, and no entropy", async () => {
    const found = await LAST.run();
    expect(found.count).toBe(128);
    expect(found.shown.map(({ candidate }) => candidate.number)).toEqual(
      Array.from({ length: 128 }, (_, index) => index + 1),
    );
    expect(found.shown.some(({ candidate }) => candidate.phrase === TEST_PHRASE)).toBe(true);
    expect(found).toMatchObject({ matched: 0, warning: undefined, listFull: false, entropies: [] });
  });

  it("checks each candidate with the host's wallet, which may answer later", async () => {
    const check = vi.fn(async (mnemonic: string) => ({
      matched: mnemonic === TEST_PHRASE,
      path: "m",
      warning: "A master fingerprint is only 32 bits and is a filter, not proof of recovery.",
    }));
    const found = await LAST.run({ walletCheck: check, keep: 1_000 });
    expect(check).toHaveBeenCalledTimes(128);
    expect(found.matched).toBe(1);
    expect(found.warning).toMatch(/^A master fingerprint/u);
    const match = found.shown.find(({ match }) => match?.matched === true)!;
    expect(match.candidate.phrase).toBe(TEST_PHRASE);
    expect(match.match?.path).toBe("m");
    // Record N of a list is candidate N.
    expect(found.entropies).toHaveLength(128);
    expect(found.entropies[match.candidate.number - 1]).toEqual(match.candidate.entropy());
  });

  it("shows the first MAX_SHOWN_CANDIDATES and every later one that matched", async () => {
    // The candidates with "zoo" first, the last word of the list, come last: 128 of them.
    const found = await FIRST_AND_LAST.run({
      walletCheck: (mnemonic) => ({ matched: mnemonic.startsWith("zoo ") }),
    });
    expect(found.count).toBe(262_144);
    expect(found.matched).toBe(128);
    const first = found.shown.slice(0, MAX_SHOWN_CANDIDATES);
    expect(first.map(({ candidate }) => candidate.number)).toEqual(
      Array.from({ length: MAX_SHOWN_CANDIDATES }, (_, index) => index + 1),
    );
    const later = found.shown.slice(MAX_SHOWN_CANDIDATES);
    expect(later.map(({ candidate }) => candidate.number)).toEqual(
      Array.from({ length: 128 }, (_, index) => 262_144 - 127 + index),
    );
    expect(later.every(({ match }) => match?.matched === true)).toBe(true);
  }, 120_000);

  it("says when the list is full: a host stops there, or goes on without the list", async () => {
    const full = new Error("More than one list holds.");
    await expect(
      LAST.run({
        keep: 100,
        onListFull: () => {
          throw full;
        },
      }),
    ).rejects.toBe(full);
    const goesOn = await LAST.run({ keep: 100 });
    expect(goesOn).toMatchObject({ count: 128, listFull: true, entropies: [] });
    expect(goesOn.shown).toHaveLength(128);
  });

  it("stops at its next turn when the host's signal says so, and checks its counts", async () => {
    const stop = new AbortController();
    const turn = vi.fn(async () => {
      stop.abort(new Error("Stopped."));
    });
    await expect(
      FIRST_AND_LAST.run({ signal: stop.signal, turn, onProgress: () => undefined }),
    ).rejects.toThrow("Stopped.");
    expect(turn).toHaveBeenCalledTimes(1);
    await expect(LAST.run({ keep: -1 })).rejects.toThrow(
      "keep must be a whole number of 0 or more.",
    );
    await expect(LAST.run({ maxShown: 1.5 })).rejects.toThrow(
      "maxShown must be a whole number of 0 or more.",
    );
  });
});
