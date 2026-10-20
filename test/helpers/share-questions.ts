// What the tests of the share questions on the private screen type: shares of the public SSKR
// vectors, and the prompts that they look for on the screen. Public test data only.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { seen } from "./question-terminal.js";
import { markUnits } from "./shares.js";
import { sskrVectors } from "./vectors.js";

const vectors = sskrVectors();

/** The shares of `set` as the three of a 2-of-3 set; any other count fails. */
function threeShares(set: readonly string[]): [string, string, string] {
  const [first, second, third, ...more] = set;
  if (first === undefined || second === undefined || third === undefined || more.length > 0)
    throw new Error(`The vector has ${set.length} shares, not the 3 of a 2-of-3 set.`);
  return [first, second, third];
}

/** A 2-of-3 set of a 12-word phrase. */
export const SHARES = threeShares(vectors.deterministic[0]!.shares);

/** The phrase that SHARES restore. */
export const PHRASE = entropyToMnemonic(
  Buffer.from(vectors.deterministic[0]!.entropy, "hex"),
  wordlist,
);

/** A share of a set of a 15-word phrase. */
export const OTHER_SET_SHARE = vectors.deterministic[1]!.shares[0]!;

/** The question for the shares. */
export const SHARES_PROMPT =
  "Shamir shares or text file path (separate shares with ;, ? for each unreadable code or digit):";

/** The second share in colours with the elements at `marks` unreadable. */
export function marked(marks: readonly number[]): string {
  return markUnits(SHARES[1], "colors", marks);
}

/** The prompts of the questions that read a line, in the order shown. */
export function promptsShown(): string[] {
  return [
    ...seen.screen.matchAll(
      /(Shamir shares[^:]*:|Share \d+ again, or its text file path:|More shares[^:]*:|Dates \([^:]*:|Original fingerprint of the wallet[^:]*:)/gu,
    ),
  ].map((match) => match[1]!);
}
