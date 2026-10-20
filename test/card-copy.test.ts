import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { businessOptions } from "../src/cli/business-options.js";
import { parseArguments } from "../src/cli/arguments.js";
import {
  cardFooters,
  cardSlogans,
  cardSubtitles,
  studioNames,
  resolveCardPresentation,
} from "../src/export/card-copy.js";

describe("export-level card presentation", () => {
  it("keeps the deduplicated union and the complete independent text pools", () => {
    expect(studioNames).toHaveLength(37);
    expect(new Set(studioNames).size).toBe(37);
    expect(studioNames).toContain("Alder & Vale");
    expect(studioNames).toContain("Fallow & Reed");
    expect(cardSlogans).toHaveLength(29);
    expect(cardSubtitles).toHaveLength(5);
    expect(cardFooters).toHaveLength(6);
  });
  it("is counted in docs/card-identities.md as the pools are (AUD-022-DOC002)", () => {
    const text = readFileSync("docs/card-identities.md", "utf8");
    const numbers: Readonly<Record<string, number>> = { five: 5, six: 6 };
    const counted = (what: string) => {
      const written = new RegExp(`(\\d+|five|six) ${what}`, "u").exec(text)?.[1];
      return written === undefined ? undefined : (numbers[written] ?? Number(written));
    };
    expect(counted("studio names")).toBe(studioNames.length);
    expect(counted("slogans")).toBe(cardSlogans.length);
    expect(counted("subtitles")).toBe(cardSubtitles.length);
    expect(counted("footers")).toBe(cardFooters.length);
  });
  it("draws the sheet copy in its order, one choice for each text", () => {
    const choose = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(28)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(5);
    const presentation = resolveCardPresentation(choose, {});
    expect(choose.mock.calls).toEqual([[37], [29], [5], [6]]);
    expect(presentation).toEqual({
      studioName: "Alder & Vale",
      slogan: cardSlogans[28],
      subtitle: cardSubtitles[4],
      footer: cardFooters[5],
      referenceLabel: "Ref.",
    });
  });
  it("resolves once across validation and multiple export destinations", () => {
    const args = parseArguments(["--card-name", "John Smith", "--card-qr"]);
    const first = businessOptions(args);
    const second = businessOptions(args);
    expect(second.profile).toBe(first.profile);
    expect(second.presentation).toBe(first.presentation);
    expect(first.cardQr).toBe(true);
    expect(businessOptions({}).cardQr).toBe(false);
  });
  it("preserves overrides and supports deliberately hiding optional copy", () => {
    const choose = vi.fn();
    const presentation = resolveCardPresentation(choose, {
      studioName: "Print Studio",
      slogan: "-",
      subtitle: "Custom subtitle",
      footer: "-",
      referenceLabel: "-",
    });
    expect(choose).not.toHaveBeenCalled();
    expect(presentation).toEqual({
      studioName: "Print Studio",
      slogan: "",
      subtitle: "Custom subtitle",
      footer: "",
      referenceLabel: "",
    });
  });
  const notOneLine = "export.card-settings.card-non-empty-text-on-one-line";
  it.each([
    ["", notOneLine],
    [" ", notOneLine],
    ["Two\nlines", notOneLine],
    ["Hidden\u200btext", notOneLine],
    ["x".repeat(101), "export.card-settings.card-too-long-maximum-characters"],
  ])("rejects invalid optional copy %j", (value, code) => {
    expect(() => resolveCardPresentation(() => 0, { slogan: value })).toThrow(
      expect.objectContaining({ code }),
    );
  });
  it.each([-1, 37, 0.5, NaN])("refuses an invalid injected random choice %s", (index) => {
    expect(() => resolveCardPresentation(() => index, {})).toThrow(
      expect.objectContaining({ code: "export.platform.checked-choice-refused" }),
    );
  });
});
