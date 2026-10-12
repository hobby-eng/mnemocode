// AUD-010 core probe: validLastWordIndexes (src/core/words.ts) equals a brute-force validation of
// all 2,048 last words with @scure/bip39 validateMnemonic, as a set and in order, for every phrase
// length and for prefixes of all zeros, all 2047s, counting and pseudo-random indexes. The same
// is checked through the production entry points that use it: recoverMissingWord with ? last,
// recoverLegacyValidLastWords, and decodeIndexesLegacyValid with a date. Public fixtures only.

import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  validLastWordIndexes,
  recoverMissingWord,
  recoverLegacyValidLastWords,
} from "../../../src/core/words.js";
import { decodeIndexesLegacyValid } from "../../../src/core/seedshift.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown>): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}

const LENGTHS = [12, 15, 18, 21, 24] as const;

/** Every last word, in list order, that @scure/bip39 accepts after `prefix`. */
function bruteForce(prefix: readonly number[]): number[] {
  const words = prefix.map((index) => wordlist[index]!).join(" ");
  const valid: number[] = [];
  for (let last = 0; last < 2048; last += 1)
    if (validateMnemonic(`${words} ${wordlist[last]!}`, wordlist)) valid.push(last);
  return valid;
}

/** A deterministic pseudo-random prefix (LCG, public constants of Numerical Recipes). */
function lcgPrefix(length: number, seed: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % 2048;
  });
}

for (const words of LENGTHS) {
  const prefixLength = words - 1;
  const prefixes: Record<string, number[]> = {
    "all zeros": Array(prefixLength).fill(0),
    "all 2047": Array(prefixLength).fill(2047),
    counting: Array.from({ length: prefixLength }, (_, index) => index),
    "counting from 2047 down": Array.from({ length: prefixLength }, (_, index) => 2047 - index),
    "alternating 0/2047": Array.from({ length: prefixLength }, (_, index) =>
      index % 2 ? 2047 : 0,
    ),
    "lcg seed 1": lcgPrefix(prefixLength, 1),
    "lcg seed 2026": lcgPrefix(prefixLength, 2026),
  };
  for (const [name, prefix] of Object.entries(prefixes)) {
    const expected = bruteForce(prefix);
    const actual = validLastWordIndexes(prefix);
    const tailBits = 11 - words / 3;
    check(
      `${words} words, prefix ${name}: validLastWordIndexes equals brute force, in order`,
      JSON.stringify(actual) === JSON.stringify(expected) && expected.length === 2 ** tailBits,
      {
        expectedCount: expected.length,
        actualCount: actual.length,
        expectedFirst: expected.slice(0, 4),
        actualFirst: actual.slice(0, 4),
        expectedLast: expected.at(-1),
        actualLast: actual.at(-1),
      },
    );
    // recoverMissingWord with ? at the last place goes through finalWordCandidates.
    const phrase = [...prefix.map((index) => wordlist[index]!), "?"].join(" ");
    const recovered = recoverMissingWord(phrase);
    const recoveredIndexes = recovered.map((candidate) => candidate.wordIndex - 1);
    const checksumBitsOk = recovered.every(
      (candidate) =>
        candidate.checksumBits ===
          (candidate.wordIndex - 1)
            .toString(2)
            .padStart(11, "0")
            .slice(-(words / 3)) &&
        candidate.position === words &&
        validateMnemonic(candidate.mnemonic, wordlist),
    );
    check(
      `${words} words, prefix ${name}: recoverMissingWord(? last) equals brute force`,
      JSON.stringify(recoveredIndexes) === JSON.stringify(expected) && checksumBitsOk,
      {
        expectedCount: expected.length,
        actualCount: recoveredIndexes.length,
        checksumBitsOk,
      },
    );
  }
  // decodeIndexesLegacyValid: container all-zero-entropy phrase, one date; the prefix is the
  // container minus the shifts, computed independently here.
  const container = [...Array(words - 1).fill(0)];
  container.push(bruteForce(container)[0]!);
  const date = { year: 2026, month: 9, day: 23 };
  const sequence = [2026, 9, 23];
  const prefix = container
    .slice(0, -1)
    .map((index, at) => (((index - sequence[at % 3]!) % 2048) + 2048) % 2048);
  const expected = bruteForce(prefix).map((last) =>
    [...prefix, last].map((i) => wordlist[i]!).join(" "),
  );
  const decoded = decodeIndexesLegacyValid(container, [date]).map(
    (result) => result.recoveredMnemonic,
  );
  check(
    `${words} words: decodeIndexesLegacyValid equals brute force over the shifted prefix`,
    JSON.stringify(decoded) === JSON.stringify(expected),
    { expected: expected.length, actual: decoded.length },
  );
  // recoverLegacyValidLastWords: flags exactly one candidate that keeps the written entropy bits.
  const written = [...prefix.map((i) => wordlist[i]!), wordlist[5]!].join(" ");
  const legacy = recoverLegacyValidLastWords(written);
  const keeps = legacy.filter((candidate) => candidate.preservesLegacyEntropy);
  check(
    `${words} words: recoverLegacyValidLastWords lists brute force and flags one entropy match`,
    JSON.stringify(legacy.map((c) => c.wordIndex - 1)) === JSON.stringify(bruteForce(prefix)) &&
      keeps.length === 1 &&
      (keeps[0]!.wordIndex - 1) >> (words / 3) === 5 >> (words / 3),
    { candidates: legacy.length, flagged: keeps.map((c) => c.wordIndex - 1) },
  );
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
