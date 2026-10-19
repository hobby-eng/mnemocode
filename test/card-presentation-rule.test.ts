// A presentation that a host gives whole is checked by the rule of every text on a card, as a
// given profile is: before anything is drawn, with a coded refusal (AUD-037-API006).

import { describe, expect, it } from "vitest";
import type { CardPresentation } from "../src/export/card-settings.js";
import { ExportDetails } from "../src/export/export-details.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";

const GIVEN: CardPresentation = {
  studioName: "  Orven Studio ",
  slogan: "",
  subtitle: "Proof set, first round.",
  footer: "Printed for review.",
  referenceLabel: "Ref.",
};

/** The presentation that an export settles from `presentation`. */
function settled(presentation: unknown): CardPresentation {
  return ExportDetails.of(nodeRenderPlatform.randomInt, {
    presentation: presentation as CardPresentation,
  }).presentation;
}

describe("a presentation given by the host", () => {
  it("is trimmed and kept, a hidden line as empty text", () => {
    expect(settled(GIVEN)).toEqual({ ...GIVEN, studioName: "Orven Studio" });
  });

  it.each([
    ["a missing text", { ...GIVEN, footer: undefined }, "card-non-empty-text-on-one-line"],
    ["blank text", { ...GIVEN, studioName: "   " }, "card-non-empty-text-on-one-line"],
    ["a line separator", { ...GIVEN, slogan: "One two" }, "card-non-empty-text-on-one-line"],
    ["a soft hyphen", { ...GIVEN, subtitle: "Proof­set" }, "card-non-empty-text-on-one-line"],
    ["too long a text", { ...GIVEN, footer: "x".repeat(101) }, "card-too-long-maximum-characters"],
  ])("refuses %s", (_, presentation, code) => {
    expect(() => settled(presentation)).toThrow(
      expect.objectContaining({ code: `export.card-settings.${code}` }),
    );
  });
});
