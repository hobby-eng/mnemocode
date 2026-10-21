import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it } from "vitest";
import { recoverLegacyValidLastWords } from "../src/core.js";
import { WordCandidateSearch } from "../src/core/candidates.js";
import { matchBitcoinEvidence } from "../src/bitcoin-evidence.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

/**
 * The candidates for `text`, a phrase with ? for one forgotten word, as the word search finds them:
 * each its phrase, the word at the place of the ?, its number and its checksum bits.
 */
function forgotten(text: string) {
  const search = WordCandidateSearch.parse(text, "unknown-words");
  const [place] = search.unknownPlaces;
  return [...search.candidates()].map((candidate) => ({
    position: place! + 1,
    word: wordlist[candidate.words[place!]!]!,
    wordIndex: candidate.words[place!]! + 1,
    mnemonic: candidate.phrase,
    checksumBits: candidate.checksumBits,
  }));
}

describe("forgotten BIP39 word recovery", () => {
  it.each([16, 20, 24, 28, 32])(
    "recovers the original at every missing position for %i entropy bytes",
    (entropyLength) => {
      const mnemonic = entropyToMnemonic(
        Uint8Array.from({ length: entropyLength }, (_, index) => index),
        wordlist,
      );
      const sourceWords = mnemonic.split(" ");
      const checksumLength = sourceWords.length / 3;

      for (const missingIndex of sourceWords.keys()) {
        const incomplete = [...sourceWords];
        incomplete[missingIndex] = "?";
        const candidates = forgotten(incomplete.join(" "));

        expect(candidates.map((candidate) => candidate.mnemonic)).toContain(mnemonic);
        expect(new Set(candidates.map((candidate) => candidate.word)).size).toBe(candidates.length);
        for (const candidate of candidates) {
          expect(candidate.position).toBe(missingIndex + 1);
          expect(candidate.wordIndex).toBe(wordlist.indexOf(candidate.word) + 1);
          expect(candidate.mnemonic.split(" ")[missingIndex]).toBe(candidate.word);
          expect(validateMnemonic(candidate.mnemonic, wordlist)).toBe(true);
          expect(candidate.checksumBits).toMatch(new RegExp(`^[01]{${checksumLength}}$`, "u"));
        }
      }
    },
  );

  it.each([
    [16, 128],
    [20, 64],
    [24, 32],
    [28, 16],
    [32, 8],
  ])(
    "has the exact BIP39 candidate count when the final word is missing at %i bytes",
    (entropyLength, count) => {
      const mnemonic = entropyToMnemonic(new Uint8Array(entropyLength), wordlist);
      const words = mnemonic.split(" ");
      words[words.length - 1] = "?";
      expect(forgotten(words.join(" "))).toHaveLength(count);
    },
  );

  it("reports the word index and exact checksum bits for the public zero vector", () => {
    const candidates = forgotten(TEST_PHRASE.replace(/about$/u, "?"));
    expect(candidates).toHaveLength(128);
    expect(candidates).toContainEqual({
      position: 12,
      word: "about",
      wordIndex: 4,
      mnemonic: TEST_PHRASE,
      checksumBits: "0011",
    });
  });

  it("identifies only the public zero vector from its BIP44 legacy address", () => {
    const candidates = forgotten(TEST_PHRASE.replace(/about$/u, "?"));
    const matches = candidates.filter(
      (candidate) =>
        matchBitcoinEvidence(candidate.mnemonic, {
          kind: "address",
          value: "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
          profiles: ["legacy"],
          location: { network: "mainnet", account: 0, branch: 0, index: 0 },
        }).matched,
    );
    expect(matches.map((candidate) => candidate.mnemonic)).toEqual([TEST_PHRASE]);
  });

  it("enumerates valid legacy final-word replacements and marks the entropy-preserving one", () => {
    const legacy =
      "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";
    const prefix = legacy.split(" ").slice(0, -1).join(" ");
    const candidates = recoverLegacyValidLastWords(legacy);
    expect(candidates).toHaveLength(128);
    expect(candidates.every((candidate) => candidate.position === 12)).toBe(true);
    expect(candidates.filter((candidate) => candidate.preservesLegacyEntropy)).toHaveLength(1);
    expect(
      candidates.every(
        (candidate) => candidate.mnemonic.split(" ").slice(0, -1).join(" ") === prefix,
      ),
    ).toBe(true);
  });

  it("rejects an unknown known word by its place", () => {
    expect(() =>
      forgotten(TEST_PHRASE.replace("abandon", "notaword").replace("about", "?")),
    ).toThrow(/place 1/u);
  });

  it("returns an empty set when the known words admit no checksum-valid completion", () => {
    const words = Array<string>(24).fill("abandon");
    words[4] = "?";
    words[23] = "sure";
    expect(forgotten(words.join(" "))).toEqual([]);
  });
});
