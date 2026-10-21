// What the tests of encode, decode and the backup check on the private screen compare with: the
// backup that the test phrase masked with a date is, and where prompts appear on the screen. The
// public test data itself is in test-phrase.ts.

import { parseDate } from "../../src/core.js";
import { promptsMatching } from "./question-terminal.js";
import { DATE, MASKED_INDEXES, TEST_PHRASE } from "./test-phrase.js";

/** The backup that MASKED is: what a check of it compares with. */
export const ORIGINAL = {
  mnemonic: TEST_PHRASE,
  format: "indexes" as const,
  mode: "seedshift" as const,
  codes: [...MASKED_INDEXES],
  dates: [parseDate(DATE)],
};

/** Where each of `prompts` appears on the screen, in order. */
export function promptsShown(...prompts: string[]): string[] {
  return promptsMatching(
    new RegExp(
      prompts.map((prompt) => prompt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|"),
      "gu",
    ),
  );
}
