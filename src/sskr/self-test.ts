// The SSKR self-test of the Node.js host: the pinned WASM, which sskrEngine checks against
// sskr-wasm/integrity.json as it loads it, and the known answers (known-answers.ts) through it.

import { checkSskrKnownAnswers } from "./known-answers.js";
import { nodeSharePlatform } from "./share-platform-node.js";

let passed = false;
/**
 * Runs the known answers of the share engine once a process (checkSskrKnownAnswers); refuses where
 * one fails, so that no share is made or restored.
 */
export async function assertSskrSelfTest(): Promise<void> {
  if (passed) return;
  await checkSskrKnownAnswers(nodeSharePlatform);
  passed = true;
}
