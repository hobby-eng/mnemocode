// Codes written apart and run together (owner, 2026-10-13): every reader that takes typed codes
// takes both where they can be told apart, and says how to write them where they cannot. Public
// data only: the phrases "abandon x11 about" and "abandon x23 art", and the repository's SSKR
// vectors.

import { describe, expect, it } from "vitest";
import { WrittenCodes } from "../src/core/backup-check.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { JOINED_MARKS_HINT } from "../src/core/code-text.js";
import { colorsToUnicode } from "../src/core/colors.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import type { EncodedFormat } from "../src/core/types.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { WORD_NUMBERS_RUN_TOGETHER } from "../src/core/words.js";
import { BYTEWORD_LETTERS, BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { bytewordUnits } from "../src/sskr/share-units.js";
import { readShare, writeShare } from "../src/sskr/transport.js";
import { TEST_INDEXES } from "./helpers/test-phrase.js";
import { sskrVectors } from "./helpers/vectors.js";

const PHRASES = [[...TEST_INDEXES], [...Array<number>(23).fill(0), 102]] as const;
const RULES = { seedshiftOnly: false, shareReader: "sskr-combine" } as const;
const SHARES = sskrVectors().deterministic[0]!.shares;
const FIRST = SHARES[0]!;
const SECOND = SHARES[1]!;

/** The codes of `indexes` in `format`, one element each: a code, a color or a code point. */
function unitsOf(format: "unicode" | "colors" | "colors-unicode", indexes: readonly number[]) {
  const written = EncodedForm.of(format).codes(indexes);
  return format === "colors" ? written.split(" ") : EncodedForm.of(format).apartCodes(written)!;
}

/** Every way of writing `units` that a reader takes: apart, joined, and with other spacing. */
function writings(units: readonly string[]): Record<string, string> {
  return {
    apart: units.join(" "),
    joined: units.join(""),
    spaces: units.join("   "),
    lines: units.join("\n"),
    commas: units.join(", "),
    lower: units.join(" ").toLowerCase(),
    lowerJoined: units.join("").toLowerCase(),
    // A terminal that copies a wrapped row with a line break may cut a code in two.
    cut: [units[0]!.slice(0, 2), units[0]!.slice(2), ...units.slice(1)].join(" "),
  };
}

/** The indexes that Decode and the check of a written copy read from `text` in `format`. */
function readBoth(text: string, format: EncodedFormat): [string, string] {
  const reading = BackupReading.of(text, RULES);
  expect(reading.formats()).toContain(format);
  const decoded = reading.codes(format).indexes.join(",");
  const checked = WrittenCodes.read(text, format, "direct").indexes.join(",");
  return [decoded, checked];
}

describe("codes of an encoded seed phrase, apart or run together", () => {
  for (const format of ["unicode", "colors", "colors-unicode"] as const)
    it(`reads ${format} however they are spaced, in Decode and in the check`, () => {
      for (const indexes of PHRASES) {
        const want = indexes.join(",");
        const units = unitsOf(format, indexes);
        const ways = writings(units);
        if (format === "colors") {
          const bare = units.map((unit) => unit.replace("#", ""));
          ways.bareApart = bare.join(" ");
          ways.bareJoined = bare.join("");
        }
        if (format === "colors-unicode")
          ways.symbols = colorsToUnicode(EncodedForm.of("colors").codes(indexes).split(" "));
        for (const [way, text] of Object.entries(ways))
          expect(readBoth(text, format), `${indexes.length} ${way}`).toEqual([want, want]);
      }
    });

  it("reads a ? for a whole code apart and run together, a ? for a digit only apart", () => {
    for (const format of ["unicode", "colors-unicode"] as const) {
      const units = unitsOf(format, PHRASES[1]);
      const whole = units.map((unit, place) => (place === 2 ? "?" : unit));
      const digit = units.map((unit, place) => (place === 2 ? `${unit.slice(0, 3)}?` : unit));
      for (const text of [whole.join(" "), whole.join(""), digit.join(" ")]) {
        const reading = BackupReading.of(text, RULES);
        expect(reading.marked, text).toBe(true);
        expect(reading.markedFormats(), text).toContain(format);
      }
      // Run together, a ? stands for a whole code: the refusal says how to mark one digit.
      expect(() => BackupReading.of(digit.join(""), RULES).markedFormats()).toThrow(
        JOINED_MARKS_HINT,
      );
    }
  });

  it("names the words that a color leaves open, and the codes of other forms", () => {
    const colorCodes = unitsOf("colors-unicode", PHRASES[1]).map((unit, place) =>
      place === 13 ? "?" : unit,
    );
    const colors = BackupReading.of(colorCodes.join(" "), RULES).missingCodes("colors-unicode");
    expect(MissingCodesSearch.placesText(colors)).toBe("Words 10 and 11");
    const unicode = unitsOf("unicode", PHRASES[0]).map((unit, place) => (place === 2 ? "?" : unit));
    const codes = BackupReading.of(unicode.join(" "), RULES).missingCodes("unicode");
    expect(MissingCodesSearch.placesText(codes)).toBe("Code 3");
  });

  it("takes word numbers only apart, and says so for numbers run together", () => {
    const numbers = EncodedForm.of("indexes").codes(PHRASES[0]).split(" ");
    expect(readBoth(numbers.join(", "), "indexes")).toEqual([
      PHRASES[0].join(","),
      PHRASES[0].join(","),
    ]);
    // 1 1 1 … 4 run together could be any numbers: refused with the way to write them.
    expect(() => BackupReading.of(numbers.join(""), RULES).formats()).toThrow(
      WORD_NUMBERS_RUN_TOGETHER,
    );
    // Run together with a ? among them, as marked codes: the same.
    expect(() => BackupReading.of("1111111111?4", RULES).missingCodes("indexes")).toThrow(
      WORD_NUMBERS_RUN_TOGETHER,
    );
    // Leading zeros keep one number one number.
    expect(readBoth([...Array<string>(11).fill("00001"), "0004"].join(" "), "indexes")[0]).toBe(
      PHRASES[0].join(","),
    );
  });

  it("tells codes typed in place of words from words with marks", () => {
    const codes = unitsOf("colors-unicode", PHRASES[1]);
    expect(BackupReading.isCodes(codes.join(" "))).toBe(true);
    expect(BackupReading.isCodes(codes.map((unit, place) => (place ? unit : "?")).join(" "))).toBe(
      true,
    );
    expect(BackupReading.isCodes(EncodedForm.of("indexes").codes(PHRASES[0]))).toBe(true);
    for (const words of ["abandon ? about", "ab* abandon abandon", "rich|rice abandon"])
      expect(BackupReading.isCodes(words), words).toBe(false);
  });
});

describe("shares, apart or run together", () => {
  it("reads a share in every form of fixed width however it is spaced", () => {
    for (const format of ["unicode", "colors", "colors-unicode"] as const) {
      const text = writeShare(FIRST, format);
      const units =
        format === "colors" ? text.split(" ") : EncodedForm.of(format).apartCodes(text)!;
      for (const [way, written] of Object.entries(writings(units)))
        expect(readShare(written).ur, `${format} ${way}`).toBe(FIRST);
    }
  });

  it("reads Bytewords apart, run together, with dashes or commas, and cut by a line break", () => {
    expect(BYTEWORDS.every((word) => word.length === BYTEWORD_LETTERS)).toBe(true);
    const words = writeShare(FIRST, "words").split(" ");
    for (const [way, written] of Object.entries({
      ...writings(words),
      dashes: words.join("-"),
    }))
      expect(readShare(written).ur, way).toBe(FIRST);
    // A word that no Byteword is stays apart, so that the refusal names a word it does not know.
    expect(bytewordUnits("tuna xxxx acid")).toEqual(["tuna", "xxxx", "acid"]);
    expect(() => readShare(`${words.slice(0, 3).join("")}xxxx${words.slice(3).join("")}`)).toThrow(
      "Unknown SSKR Byteword.",
    );
    expect(bytewordUnits("tunaacid?draw")).toEqual(["tuna", "acid", "?", "draw"]);
  });

  it("repairs a share in Bytewords run together, a ? for a whole word", async () => {
    const words = writeShare(FIRST, "words").split(" ");
    const marked = words.map((word, place) => (place === 3 ? "?" : word)).join("");
    const plan = await planJointRepair([marked, writeShare(SECOND, "words")], {
      platform: nodeSharePlatform,
    });
    expect(plan.assessment.verdict).toBe("determined");
    const [set] = (await plan.search()).sets;
    expect(set!.shares.map((share) => share.ur)).toContain(FIRST);
  });

  it("takes the word numbers of a share only apart, and says so for numbers run together", () => {
    const numbers = writeShare(FIRST, "indexes").split(" ");
    expect(readShare(numbers.join(", ")).ur).toBe(FIRST);
    expect(() => readShare(numbers.join(""))).toThrow(WORD_NUMBERS_RUN_TOGETHER);
  });
});
