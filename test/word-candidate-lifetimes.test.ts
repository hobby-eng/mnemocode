import { describe, expect, it, vi } from "vitest";
import { WordCandidate, WordCandidateSearch } from "../src/core/candidates.js";
import type { WalletMatch } from "../src/core/wallet-check.js";
import { endLifetimeIfPresent as endLifetime } from "./helpers/owner-lifetime.js";

// Public BIP39/candidates-v1.json answers, fixed independently of the search under test.
const ELEVEN = "abandon ".repeat(11);
const FIRST_PHRASE = `${ELEVEN}about`;
const SMALL_SEARCH = `${ELEVEN}about|actual`;
const WIPED_CODE = "core.secret-value.wiped";

describe("Owned word-candidate lifetimes", () => {
  it.each(["wipe", "dispose"] as const)(
    "refuses secret reads after %s while preserving a caller's earlier snapshot",
    (method) => {
      const words = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3];
      const candidate = new WordCandidate(2, words);
      try {
        words[1] = 2047;
        const snapshot = candidate.words;
        expect(candidate.phrase).toBe(
          "abandon ability abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        );
        expect(candidate.checksumBits).toBe("0011");
        const entropy = candidate.entropy();
        try {
          expect(Array.from(entropy)).toEqual([0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        } finally {
          entropy.fill(0);
        }
        endLifetime(candidate, method);
        expect(() => candidate.words).toThrow("has been wiped");
        expect(() => candidate.phrase).toThrow("has been wiped");
        expect(() => candidate.entropy()).toThrow("has been wiped");
        expect(() => candidate.checksumBits).toThrow("has been wiped");
        expect(snapshot).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
        endLifetime(candidate);
        endLifetime(candidate, "dispose");
      } finally {
        endLifetime(candidate);
      }
    },
  );

  it.each(["unknown-words", "missing-word"] as const)(
    "ends a %s search without taking back a candidate already transferred to its caller",
    (kind) => {
      const search = WordCandidateSearch.parse(
        kind === "unknown-words" ? SMALL_SEARCH : `${"abandon ".repeat(10)}about`,
        kind,
      );
      const candidates = search.candidates();
      const first = candidates.next();
      expect(first.done).toBe(false);
      if (first.done) throw new Error("The public vector must yield its first candidate.");
      const candidate = first.value;
      try {
        expect(candidate.number).toBe(1);
        expect(candidate.phrase).toBe(FIRST_PHRASE);
        expect(search.placesOf(candidate)).toEqual(kind === "unknown-words" ? [11] : [0]);
        endLifetime(search, "dispose");
        expect(() => search.expected).toThrow("has been wiped");
        expect(() => search.placesOf(candidate)).toThrow("has been wiped");
        expect(() => candidates.next()).toThrow("has been wiped");
        expect(() => search.candidates().next()).toThrow("has been wiped");
        expect(candidate.phrase).toBe(FIRST_PHRASE);
        endLifetime(candidate);
        expect(() => candidate.phrase).toThrow("has been wiped");
        endLifetime(search);
      } finally {
        candidates.return(undefined);
        endLifetime(candidate);
        endLifetime(search);
      }
    },
  );

  it("refuses a wallet answer that arrives after its search owner was wiped", async () => {
    const search = WordCandidateSearch.parse(SMALL_SEARCH, "unknown-words");
    let finish: ((match: WalletMatch) => void) | undefined;
    const answer = new Promise<WalletMatch>((resolve) => {
      finish = resolve;
    });
    const walletCheck = vi.fn(() => answer);
    const onProgress = vi.fn();
    const pending = search.run({ walletCheck, keep: 2, onProgress, now: () => 0 });
    try {
      expect(walletCheck).toHaveBeenCalledExactlyOnceWith(FIRST_PHRASE);
      endLifetime(search);
      finish!({ matched: true, path: "m" });
      await expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
      expect(walletCheck).toHaveBeenCalledTimes(1);
      expect(onProgress).not.toHaveBeenCalled();
      await expect(search.run()).rejects.toHaveProperty("code", WIPED_CODE);
    } finally {
      finish!({ matched: false });
      endLifetime(search);
    }
  });

  it("publishes no progress or result after disposal during the host's awaited turn", async () => {
    const search = WordCandidateSearch.parse(SMALL_SEARCH, "unknown-words");
    let finish: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const turn = vi.fn(() => waiting);
    const onProgress = vi.fn();
    let now = 0;
    const pending = search.run({
      keep: 2,
      maxShown: 2,
      turn,
      onProgress,
      now: () => (now += 50),
    });
    try {
      expect(turn).toHaveBeenCalledTimes(1);
      endLifetime(search, "dispose");
      finish!();
      await expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
      expect(onProgress).not.toHaveBeenCalled();
      expect(turn).toHaveBeenCalledTimes(1);
    } finally {
      finish!();
      endLifetime(search);
    }
  });
});
