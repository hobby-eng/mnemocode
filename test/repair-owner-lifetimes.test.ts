import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  MarkedReading,
  ReadingSpace,
  readRepairableShare,
  repairCandidates,
  ShareVariantsError,
} from "../src/sskr/repair.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { writeShare } from "../src/sskr/transport.js";
import { endLifetimeIfPresent as wipeIfPresent } from "./helpers/owner-lifetime.js";

// Public vectors from sskr-v1.json/known-answers.ts; expected units are independent literals.
const SHARE = "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf";
const COLORS = "#8B0C06 #B0D4F5 #0CF800 #FA41D6 #37B8CA #1F9121 #DB206C #4FD8A1 #1BF322 #750000";
const OFFICIAL_UNICODE =
  "9805 968E 70AE 555F 4E?D 7642 6751 7686 7709 75C7 5354 77FD 97CB 964D 670D 5E7E 7FA4 5410 4EF2 6CB3 5BEC";
const ONE_MARK = COLORS.replace("#37B8CA", "?");
const PARTLY_READ = ONE_MARK.replace("#1F9121", "#1F9???");
const THREE_MARKS = "#8B0C06 #B0D4F5 #0CF800 #FA41D6 ? ? ? #4FD8A1 #1BF322 #750000";

function disposeIfPresent(owner: object): void {
  if (!wipeIfPresent(owner, "dispose")) wipeIfPresent(owner);
}

function readingOf(text: string, format: "colors" | "unicode"): MarkedReading {
  const readings = MarkedReading.of(text);
  const selected = readings.find((reading) => reading.format === format);
  for (const reading of readings) if (reading !== selected) wipeIfPresent(reading);
  if (selected === undefined) throw new Error("The public fixture needs its stated reading.");
  return selected;
}

describe("Owned marked-reading lifetimes", () => {
  it.each([
    { format: "colors", text: PARTLY_READ, first: 0x8b0c06, chosen: 0x37b8ca, mask: 0xffffff },
    { format: "unicode", text: OFFICIAL_UNICODE, first: 526, chosen: 4, mask: 2047 },
  ] as const)(
    "refuses retained $format data after disposal and keeps derived owners live",
    (test) => {
      const reading = readingOf(test.text, test.format);
      const chosen = reading.withValues(new Map([[4, test.chosen]]));
      try {
        const earlier = reading.values;
        expect(earlier[0]).toBe(test.first);
        if (test.format === "colors") {
          expect(reading.readBits?.[5]).toEqual({ value: 0x1f9000, mask: 0xfff000 });
        } else {
          expect(reading.candidates?.[4]).toContain(4);
        }
        disposeIfPresent(reading);
        expect(chosen.readBits?.[4]).toEqual({ value: test.chosen, mask: test.mask });
        expect(chosen.values[0]).toBe(test.first);
        expect(() => reading.values).toThrow("has been wiped");
        expect(() => reading.readBits).toThrow("has been wiped");
        expect(() => reading.candidates).toThrow("has been wiped");
        expect(() => reading.zeroFilled()).toThrow("has been wiped");
        expect(() => reading.withValues(new Map())).toThrow("has been wiped");
        expect(earlier[0]).toBe(test.first);
        wipeIfPresent(reading);
      } finally {
        disposeIfPresent(chosen);
        disposeIfPresent(reading);
      }
    },
  );
});

describe("Owned reading-space lifetimes", () => {
  it("owns its reading and full-width affine bits and refuses all secret reads after wiping", () => {
    const reading = readingOf(THREE_MARKS, "colors");
    const space = ReadingSpace.solve(reading);
    expect(space).toBeDefined();
    if (space === undefined) throw new Error("The public share must have an affine space.");
    try {
      expect(space.unknownBits).toBe(72);
      const basis = space.basis;
      expect(basis.some((direction) => direction > 0x1fffffffffffffn)).toBe(true);
      const direction = basis.at(-1)!;
      // The ordinary transport reader checks this solution's CRC independently of elimination.
      const candidate = space.reading.solvedShare(space.valuesAt(space.particular ^ direction));
      expect(candidate?.format).toBe("colors");
      expect(candidate?.ur).toMatch(/^ur:sskr\//u);
      const arrays = space.secretArrays();
      const earlier = space.payloadAt(0n);
      try {
        wipeIfPresent(reading);
        expect(space.reading.values[0]).toBe(0x8b0c06);
        expect(space.basis).toEqual(basis);
        expect(space.reading).not.toBe(reading);
        space.wipe();
        expect(arrays.every((array) => array.every((byte) => byte === 0))).toBe(true);
        expect(() => space.particular).toThrow("has been wiped");
        expect(() => space.basis).toThrow("has been wiped");
        expect(() => space.payloadAt(0n)).toThrow("has been wiped");
        expect(() => space.valuesAt(0n)).toThrow("has been wiped");
        expect(() => space.reading.values).toThrow("has been wiped");
      } finally {
        earlier.fill(0);
      }
      disposeIfPresent(space);
    } finally {
      space.wipe();
      disposeIfPresent(reading);
    }
  });

  it("closes an escaped temporary space when its callback throws without consuming its reading", () => {
    const reading = readingOf(ONE_MARK, "colors");
    const failure = new Error("Synthetic host callback failure.");
    let escaped: ReadingSpace | undefined;
    try {
      expect(() =>
        reading.withSpace((space) => {
          expect(space).toBeDefined();
          escaped = space;
          throw failure;
        }),
      ).toThrow(failure);
      expect(reading.values[0]).toBe(0x8b0c06);
      expect(escaped).toBeDefined();
      expect(() => escaped!.particular).toThrow("has been wiped");
      expect(() => escaped!.payloadAt(0n)).toThrow("has been wiped");
    } finally {
      escaped?.wipe();
      disposeIfPresent(reading);
    }
  });
});

describe("Share variants travel through result values", () => {
  it("keeps ambiguity metadata in errors and delivers the actual variants through repair results", () => {
    expect(readRepairableShare(ONE_MARK).ur).toBe(SHARE);
    // The existing public 128-bit vector has four repairs for these three unread word numbers.
    const words = writeShare(SHARE, "indexes").split(" ");
    for (const place of [5, 9, 13]) words[place] = "?";
    const text = words.join(" ");
    const variants = repairCandidates(text);
    expect(variants).toHaveLength(4);
    expect(variants.map((variant) => variant.ur)).toContain(SHARE);
    const input = new ShareInput({ decodeEntry: "Decode" });
    try {
      input.add([text]);
      const each = input.repairEach();
      expect(each).toMatchObject({ kind: "variants", place: 1 });
      expect(each.kind === "variants" && each.variants).toEqual(variants);
      let error: unknown;
      try {
        readRepairableShare(text);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ShareVariantsError);
      if (!(error instanceof ShareVariantsError))
        throw new Error("The repair must refuse ambiguity.");
      expect(error.code).toBe("share-variants");
      expect(error.message).toBe(
        "4 shares fit the marked elements 6, 10, 14. Use another copy of this share, or another share.",
      );
      const serialized = JSON.stringify(error);
      const inspected = inspect(error, { showHidden: true, getters: true, depth: null });
      for (const variant of variants) {
        expect(serialized).not.toContain(variant.ur);
        expect(inspected).not.toContain(variant.ur);
      }
      expect(error).not.toHaveProperty("variants");
    } finally {
      disposeIfPresent(input);
    }
  });
});
