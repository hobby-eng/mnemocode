// What the tests of encode, decode and the backup check on the private screen type: the test
// phrase masked with a date, and where prompts appear on the screen. Public test data only.

import { encodeMnemonic, parseDate } from "../../src/core.js";
import { seen } from "./question-terminal.js";
import { TEST_PHRASE } from "./test-phrase.js";

/** The date that the test phrase is masked with. */
export const DATE = "23-09-2026";

/** The test phrase masked with MnemoCode Seedshift and DATE, as word numbers. */
export const MASKED = "2027 10 24 2027 10 24 2027 10 24 2027 10 377";

/** The test phrase masked with MnemoCode Seedshift and DATE. */
export const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);

/** The backup that MASKED is: what a check of it compares with. */
export const ORIGINAL = {
  mnemonic: TEST_PHRASE,
  format: "indexes" as const,
  mode: "seedshift" as const,
  codes: masked.shiftedIndexes,
  dates: [parseDate(DATE)],
};

/** Where each of `prompts` appears on the screen, in order. */
export function promptsShown(...prompts: string[]): string[] {
  const pattern = new RegExp(
    prompts.map((prompt) => prompt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|"),
    "gu",
  );
  return [...seen.screen.matchAll(pattern)].map((match) => match[0]);
}
