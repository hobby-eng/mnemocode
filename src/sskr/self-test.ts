// The SSKR self-test: the known answers (known-answers.ts) through a platform's SSKR library, run
// until they pass once (SskrSelfTest), and the instance of the Node.js host, whose pinned WASM
// sskrEngine checks against sskr-wasm/integrity.json as it loads it.

import { checkSskrKnownAnswers } from "./known-answers.js";
import type { ShareSplitPlatform } from "./share-platform.js";
import { nodeSharePlatform } from "./share-platform-node.js";

/**
 * The known answers of the share engine of one platform (checkSskrKnownAnswers), run until they
 * pass once. A class, so that its rule holds: a check that passed is not run again, and a check
 * that failed leaves nothing behind, so that the next call runs it again.
 */
export class SskrSelfTest {
  readonly #platform: ShareSplitPlatform;
  #passed = false;

  /** Binds the platform whose SSKR library the known answers check; nothing runs yet. */
  constructor(platform: ShareSplitPlatform) {
    this.#platform = platform;
  }

  /**
   * Runs the known answers unless they passed before; refuses, with the first answer that differs
   * or the platform's own failure, so that no share is made or restored.
   */
  async assert(): Promise<void> {
    if (this.#passed) return;
    await checkSskrKnownAnswers(this.#platform);
    this.#passed = true;
  }
}

const nodeSelfTest = new SskrSelfTest(nodeSharePlatform);

/**
 * Runs the known answers of the Node.js share engine once a process (SskrSelfTest.assert); refuses
 * where one fails, so that no share is made or restored.
 */
export function assertSskrSelfTest(): Promise<void> {
  return nodeSelfTest.assert();
}
