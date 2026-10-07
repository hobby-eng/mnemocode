// The SSKR self-test of the Node.js host: the pinned WASM, which sskrEngine checks against
// sskr-wasm/integrity.json as it loads it, and the known answers (known-answers.ts) through it.

import { checkSskrKnownAnswers } from "./known-answers.js";
import { nodeSharePlatform } from "./share-platform-node.js";

// The vector stays reachable here for the callers that took it from this module.
export { sskrVector } from "./known-answers.js";

let passed = false;
export async function assertSskrSelfTest(): Promise<void> {
  if (passed) return;
  await checkSskrKnownAnswers(nodeSharePlatform);
  passed = true;
}
