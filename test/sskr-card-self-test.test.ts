// Runs the full self-test's actual planning checks with public shares, without rendering a PDF.
// Image codecs refuse every call: planning must not decode or generate an image either.
import { expect, it } from "vitest";
import { CardRenderer } from "../src/export/card-renderer.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { shareCardPlanSelfTest } from "../src/export/sskr-render-self-test.js";

it("checks the full self-test's share plans without drawing a PDF or an image", async () => {
  const refuseImage = (): never => {
    throw new Error("The share planning self-test must not render an image.");
  };
  const drawing = new CardRenderer({
    ...nodeRenderPlatform,
    decodePng: refuseImage,
    encodePng: refuseImage,
  });
  const cards = await shareCardPlanSelfTest(drawing);
  expect(cards.layout).toBe("qr");
  expect(cards.shares).toHaveLength(2);
});
