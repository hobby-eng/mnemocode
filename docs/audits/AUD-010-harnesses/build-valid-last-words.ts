// AUD-010 build reviewer: validLastWordIndexes (src/core/words.ts) against an independent oracle.
//
// The startup self-test checks the last word of a 12-word phrase only (128 candidates, "about"
// at word number 4). This probe compares, for every BIP39 length (12, 15, 18, 21, 24 words) and
// three public prefixes (all "abandon"; zero entropy's prefix; the counting entropy 00 01 02 …),
// the indexes that validLastWordIndexes gives with those that @scure/bip39's validateMnemonic
// accepts out of all 2,048 last words, tried one by one: the same set, in the same order, and
// 2^(11 - words/3) of them. It also checks that recoverMissingWord (the production entry that
// uses it) gives the same words.
//
// Exits 1 when any comparison differs.
// Run: node --import tsx docs/audits/AUD-010-harnesses/build-valid-last-words.ts

import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { recoverMissingWord, validLastWordIndexes } from "../../../src/core/words.ts";

let failures = 0;
const LENGTHS = [12, 15, 18, 21, 24] as const;
for (const words of LENGTHS) {
  const entropyBytes = (words * 11 - words / 3) / 8;
  const counting = entropyToMnemonic(Uint8Array.from({ length: entropyBytes }, (_, i) => i), wordlist).split(" ");
  const prefixes: readonly (readonly [string, readonly string[]])[] = [
    ["abandon", Array.from({ length: words - 1 }, () => "abandon")],
    ["counting entropy", counting.slice(0, -1)],
    ["zz-mixed", Array.from({ length: words - 1 }, (_, i) => wordlist[(i * 389 + 7) % 2048]!)],
  ];
  for (const [label, prefix] of prefixes) {
    const oracle: number[] = [];
    for (let index = 0; index < 2048; index++)
      if (validateMnemonic([...prefix, wordlist[index]!].join(" "), wordlist)) oracle.push(index);
    const indexes = prefix.map((word) => wordlist.indexOf(word));
    const actual = validLastWordIndexes(indexes);
    const fromEntry = recoverMissingWord([...prefix, "?"].join(" ")).map((c) => c.wordIndex - 1);
    const expectedCount = 2 ** (11 - words / 3);
    const same = actual.join(",") === oracle.join(",");
    const entrySame = fromEntry.join(",") === oracle.join(",");
    console.log(
      `${words} words, ${label}: oracle ${oracle.length} (first ${oracle.slice(0, 3).join(",")}, last ${oracle.at(-1)}), validLastWordIndexes ${actual.length} same order ${same}, recoverMissingWord same ${entrySame}, expected count ${expectedCount}`,
    );
    if (!same || !entrySame || oracle.length !== expectedCount) failures += 1;
  }
}
console.log(failures === 0 ? "PASS build-valid-last-words" : `FAIL build-valid-last-words: ${failures} case(s)`);
process.exitCode = failures === 0 ? 0 : 1;
