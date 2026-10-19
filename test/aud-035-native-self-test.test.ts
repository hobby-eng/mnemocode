import { expect, it } from "vitest";
import { checkSskrKnownAnswers } from "../src/sskr/known-answers.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";

it("passes the actual host gate only when recovery refuses an impossible group index", async () => {
  await expect(checkSskrKnownAnswers(nodeSharePlatform)).resolves.toBeUndefined();
});
