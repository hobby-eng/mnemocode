import { expect, it } from "vitest";
import { checkSskrKnownAnswers } from "../src/sskr/known-answers.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";

// That it fails when recovery accepts the impossible group index: test/startup-edges.test.ts.
it("passes the actual host gate, whose recovery refuses an impossible group index", async () => {
  await expect(checkSskrKnownAnswers(nodeSharePlatform)).resolves.toBeUndefined();
});
