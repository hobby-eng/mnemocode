// A presentation that a host gives whole is checked by the rule of every text on a card, as a
// given profile is: before anything is drawn, with a coded refusal (AUD-037-API006). The rule
// measures a text as it is drawn, in NFC and trimmed, so that a text it settled passes again.

import { describe, expect, it } from "vitest";
import { renderCards, selectTemplate, type CardContent } from "../src/cards.js";
import { businessOptions } from "../src/cli/business-options.js";
import { parseArguments } from "../src/cli/arguments.js";
import { indexesToColors } from "../src/core.js";
import {
  MAX_CARD_TEXT_LENGTH,
  type CardPresentation,
  type CardSettings,
} from "../src/export/card-settings.js";
import { ExportDetails } from "../src/export/export-details.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";

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
    // Some presentations below have a type that none allows, such as a missing text: fed on
    // purpose as a JavaScript host could.
    presentation: presentation as CardPresentation,
  }).presentation;
}

/** The code of the refusal of a card text longer than MAX_CARD_TEXT_LENGTH. */
const TOO_LONG = "export.card-settings.card-too-long-maximum-characters";

/** The card settings of a command line with `option` set to `text`. */
function options(option: string, text: string) {
  return businessOptions(parseArguments([option, text]));
}

/**
 * Pieces of text that NFC makes longer (U+0344, U+FB2C, U+0958), shorter (e with a combining acute,
 * Hangul jamo) or keeps as long (U+212B), and a space that is trimmed (U+2000).
 */
const PIECES = ["\u0344", "\uFB2C", "\u0958", "e\u0301", "\u1100\u1161", "\u212B", "\u2000"];
/** Texts about as long as a card text may be, each piece at the end or start, spaces around. */
const NEAR_THE_LIMIT = PIECES.flatMap((piece) =>
  Array.from({ length: 6 }, (_, index) => "b".repeat(MAX_CARD_TEXT_LENGTH - 5 + index)).flatMap(
    (letters) => [`${letters}${piece}`, `${piece}${letters}`, ` ${letters}${piece} `],
  ),
);
/** One code point of U+0344 that NFC writes as two, U+0308 U+0301. */
const LONGER_IN_NFC = "\u0344";

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
  ])("is refused with %s", (_, presentation, code) => {
    expect(() => settled(presentation)).toThrow(
      expect.objectContaining({ code: `export.card-settings.${code}` }),
    );
  });

  it("is none where a JavaScript host gives null, as where it gives none", () => {
    const first = () => 0;
    // A null presentation, which no type allows, fed on purpose as a JavaScript host could.
    expect(
      ExportDetails.of(first, { presentation: null as unknown as CardPresentation }).presentation,
    ).toEqual(ExportDetails.of(first, {}).presentation);
  });

  it("of a later design is the export's where a JavaScript host gives null", async () => {
    const colors = indexesToColors(Array.from({ length: 12 }, (_, index) => index * 7));
    const content: CardContent = { kind: "colors", colors, payload: colors.join(" ") };
    const template = selectTemplate("business-it", "colors");
    // A null presentation, which no type allows, fed on purpose as a JavaScript host could.
    const later = { ...content, presentation: null as unknown as CardPresentation };
    const pdf = await renderCards(nodeCardRenderer, [
      { template, content },
      { template, content: later },
    ]);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
  });
});

describe("a card text, measured as it is drawn", () => {
  it.each([
    ["--card-subtitle", (settings: CardSettings) => settings.presentation?.subtitle],
    ["--card-company", (settings: CardSettings) => settings.profile?.company],
  ])("is counted in NFC where %s gives it", (option, drawn) => {
    expect(() => options(option, `${"b".repeat(99)}${LONGER_IN_NFC}`)).toThrow(
      expect.objectContaining({ code: TOO_LONG }),
    );
    expect(drawn(options(option, `${"b".repeat(98)}${LONGER_IN_NFC}`))).toBe(
      `${"b".repeat(98)}\u0308\u0301`,
    );
  });

  it("passes again as the options settled it, from any text that they accept", () => {
    let accepted = 0;
    for (const text of NEAR_THE_LIMIT) {
      let presentation: CardPresentation | undefined;
      try {
        ({ presentation } = options("--card-subtitle", text));
      } catch (error) {
        expect(error, JSON.stringify(text)).toMatchObject({ code: TOO_LONG });
        continue;
      }
      accepted += 1;
      expect(Array.from(presentation?.subtitle ?? "").length).toBeLessThanOrEqual(
        MAX_CARD_TEXT_LENGTH,
      );
      expect(settled(presentation), JSON.stringify(text)).toEqual(presentation);
    }
    expect(accepted).toBeGreaterThan(0);
  });
});
