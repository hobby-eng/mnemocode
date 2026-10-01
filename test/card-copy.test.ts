import { describe, expect, it, vi } from "vitest";
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
    expect(cardSlogans).toHaveLength(30);
    expect(cardSubtitles).toHaveLength(5);
    expect(cardFooters).toHaveLength(6);
  });
  it("draws sheet copy independently without changing the business-card identity", () => {
    const choose = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(29)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(5);
    const resolved = resolveCardPresentation({ name: "José Smith" }, {}, choose);
    expect(choose.mock.calls).toEqual([[37], [30], [5], [6]]);
    expect(resolved.profile).toEqual({
      name: "José Smith",
    });
    expect(resolved.presentation).toEqual({
      studioName: "Alder & Vale",
      slogan: cardSlogans[29],
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
    const profile = {
      name: "Alex Morgan",
      company: "Chosen Studio",
      email: "team@chosen.com",
      website: "https://chosen.com",
      role: "Director",
    };
    const resolved = resolveCardPresentation(
      profile,
      {
        studioName: "Print Studio",
        slogan: "-",
        subtitle: "Custom subtitle",
        footer: "-",
        referenceLabel: "-",
      },
      choose,
    );
    expect(choose).not.toHaveBeenCalled();
    expect(resolved.profile).toEqual(profile);
    expect(resolved.presentation).toEqual({
      studioName: "Print Studio",
      slogan: "",
      subtitle: "Custom subtitle",
      footer: "",
      referenceLabel: "",
    });
  });
  it.each(["", " ", "Two\nlines", "Hidden\u200btext", "x".repeat(101)])(
    "rejects invalid optional copy %j",
    (value) => {
      expect(() =>
        resolveCardPresentation({ company: "Studio" }, { slogan: value }, () => 0),
      ).toThrow();
    },
  );
  it.each([-1, 37, 0.5, NaN])("refuses an invalid injected random choice %s", (index) => {
    expect(() => resolveCardPresentation({}, {}, () => index)).toThrow();
  });
});
