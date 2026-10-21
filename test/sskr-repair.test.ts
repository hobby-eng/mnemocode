import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { markCount, markProblem, placesWithin, readRepairableShare } from "../src/sskr/repair.js";
import { MAX_REPAIR_TEXT_LENGTH } from "../src/sskr/repair-units.js";
import {
  readShare,
  writeShare,
  urToTransport,
  transportToUr,
  CHECKSUM_BYTES,
  SHARE_FORMATS,
  type ShareFormat,
} from "../src/sskr/transport.js";
import { crc32 } from "../src/sskr/checksum.js";
import { MINIMAL_BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { shareBackupVerdict } from "./helpers/share-backup-check.js";
import { joinUnits, markDigits, markUnits, shareUnits } from "./helpers/shares.js";
import { sskrVectors } from "./helpers/vectors.js";
import { LONG_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

const vectors = sskrVectors();
const FORMATS: readonly ShareFormat[] = SHARE_FORMATS;

describe("One explicit unreadable SSKR element", () => {
  for (const vector of vectors.deterministic) {
    it.each(FORMATS)(`repairs the first, middle and last %s units of ${vector.name}`, (format) => {
      const share = vector.shares[0]!;
      const length = shareUnits(share, format).length;
      for (const index of [0, Math.floor(length / 2), length - 1])
        expect(readRepairableShare(markUnits(share, format, [index]))).toMatchObject({
          ur: share,
          format,
          repaired: true,
        });
    });
  }

  it("repairs every RGB code, including the checksum, mixed header and zero padding", () => {
    for (const vector of vectors.deterministic) {
      const share = vector.shares[0]!;
      for (let index = 0; index < shareUnits(share, "colors").length; index++)
        expect(readRepairableShare(markUnits(share, "colors", [index])).ur).toBe(share);
    }
    const official = vectors.official.shares[0]!;
    for (let index = 0; index < shareUnits(official, "colors").length; index++)
      expect(readRepairableShare(markUnits(official, "colors", [index])).ur).toBe(official);
  });

  it("reads a marker inside joined Unicode, RGB and UR streams", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    expect(readRepairableShare(markUnits(share, "unicode", [4]).replaceAll(" ", "")).ur).toBe(
      share,
    );
    expect(readRepairableShare(markUnits(share, "colors", [4]).replaceAll(" ", "")).ur).toBe(share);
    expect(readRepairableShare(markUnits(share, "colors", [4]).replace("?", "#?")).ur).toBe(share);
    expect(readRepairableShare(markUnits(share, "ur", [4])).ur).toBe(share);
    expect(readRepairableShare(markUnits(share, "indexes", [4]).replaceAll(" ", ",\n")).ur).toBe(
      share,
    );
    expect(readRepairableShare(markUnits(share, "words", [4]).replaceAll(" ", "-")).ur).toBe(share);
  });

  it("repairs the supported tagged and non-minimal short CBOR length layouts", () => {
    const original = vectors.deterministic[0]!.shares[0]!;
    const cbor = urToTransport(original).subarray(0, -CHECKSUM_BYTES);
    const layouts = [
      Uint8Array.of(0x58, cbor[0]! - 0x40, ...cbor.subarray(1)),
      // Both legacy tag 309 and current registered tag 40309 are accepted by transport.ts.
      Uint8Array.of(0xd9, 0x01, 0x35, ...cbor),
      Uint8Array.of(0xd9, 0x9d, 0x75, ...cbor),
    ];
    for (const layout of layouts) {
      const bytes = new Uint8Array(layout.length + CHECKSUM_BYTES);
      bytes.set(layout);
      new DataView(bytes.buffer).setUint32(layout.length, crc32(layout));
      const share = "ur:sskr/" + Array.from(bytes, (byte) => MINIMAL_BYTEWORDS[byte]!).join("");
      const expected = transportToUr(bytes);
      for (let index = 0; index < shareUnits(share, "colors").length; index++)
        expect(readRepairableShare(markUnits(share, "colors", [index])).ur).toBe(expected);
    }
  });

  it("accepts color Unicode symbols as well as their four-digit hex codes", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    const symbols = shareUnits(share, "colors-unicode").map((code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
    expect(readShare(symbols.join(""))).toEqual({ ur: share, format: "colors-unicode" });
    symbols[3] = "?";
    expect(readRepairableShare(symbols.join(""))).toMatchObject({
      ur: share,
      format: "colors-unicode",
      repaired: true,
    });
  });
});

describe("One explicit unreadable SSKR element", () => {
  it("repairs a whole eight-digit color Unicode pair or both of its symbols", () => {
    for (const vector of vectors.deterministic) {
      const share = vector.shares[0]!;
      const pairs = shareUnits(share, "colors-unicode", "colors");
      for (const index of [0, Math.floor(pairs.length / 2), pairs.length - 1]) {
        const damaged = [...pairs];
        damaged[index] = "?";
        expect(readRepairableShare(damaged.join("")).ur).toBe(share);
        const symbols = damaged.map((pair) =>
          pair === "?"
            ? pair
            : pair
                .match(/.{4}/gu)!
                .map((code) => String.fromCodePoint(parseInt(code, 16)))
                .join(""),
        );
        expect(readRepairableShare(symbols.join("")).ur).toBe(share);
      }
    }
  });

  it("leaves intact shares unchanged, without claiming a repair", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    for (const format of FORMATS)
      expect(readRepairableShare(writeShare(share, format))).toEqual({
        ur: share,
        format,
        repaired: false,
        filled: [],
      });
  });

  it("rejects more than six marks, missing framing, excess input and an unmarked error", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    for (const format of FORMATS) {
      const parts = shareUnits(share, format);
      for (const index of [2, 3, 4, 5, 6, 7, 8]) parts[index] = "?";
      expect(() => readRepairableShare(joinUnits(parts, format))).toThrow(/at most 6/u);
    }
    // One mark, and spaces between two words: read at the longest text a repair reads, refused
    // one character over it, with the refusal of too many marks, which bounds the text too
    // (exceedsMarks).
    const marked = markUnits(share, "words", [3]);
    const spaced = (length: number) => marked.replace(" ", " ".repeat(length - marked.length + 1));
    expect(readRepairableShare(spaced(MAX_REPAIR_TEXT_LENGTH)).ur).toBe(share);
    expect(() => readRepairableShare(spaced(MAX_REPAIR_TEXT_LENGTH + 1))).toThrow(
      expect.objectContaining({ code: "sskr.repair.each-at-place" }),
    );
    expect(() => readRepairableShare("? not a share")).toThrow(/No valid share/u);
    const numbers = shareUnits(share, "indexes");
    numbers[8] = numbers[8] === "1" ? "2" : "1";
    expect(() => readRepairableShare(numbers.join(" "))).toThrow(
      expect.objectContaining({ code: "sskr.transport.sskr-transport-checksum-does-not-match" }),
    );
  });

  it("does not accept an extra wrong element merely because one hole is marked", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    const parts = shareUnits(share, "words");
    parts[3] = "?";
    parts[8] = "zzzz";
    expect(() => readRepairableShare(parts.join(" "))).toThrow(/No valid share/u);
  });

  it("still requires a quorum and rejects duplicate members after repair", async () => {
    const vector = vectors.deterministic[0]!;
    const first = markUnits(vector.shares[0]!, "indexes", [8]);
    const second = markUnits(vector.shares[1]!, "colors", [3]);
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    expect(await combineSskrShares([first, second])).toBe(expected);
    await expect(combineSskrShares([first])).rejects.toThrow(/threshold/u);
    await expect(combineSskrShares([])).rejects.toThrow(/between 1 and 256/u);
    await expect(combineSskrShares(Array(257).fill(first))).rejects.toThrow(/between 1 and 256/u);
    await expect(combineSskrShares([first, vector.shares[0]!])).rejects.toThrow(/more than once/u);
    expect(await shareBackupVerdict(expected, `${first};${second}`, "direct", "")).toBe("restores");
  });
});

describe("Several unreadable SSKR elements", () => {
  const share = vectors.deterministic[4]!.shares[0]!;

  it("fills in up to three word numbers, Unicode codes, Bytewords or UR letters, and says what", () => {
    for (const format of ["ur", "words", "indexes", "unicode"] as const) {
      const parts = shareUnits(share, format);
      const places = [1, Math.floor(parts.length / 2), parts.length - 2];
      const marked = [...parts];
      for (const place of places.slice(0, 2)) marked[place] = "?";
      const two = readRepairableShare(joinUnits(marked, format));
      expect(two.ur).toBe(share);
      expect(two.filled).toEqual(
        places.slice(0, 2).map((place) => ({ position: place + 1, value: parts[place] })),
      );
    }
    // Three: alone they may leave variants, which are listed, never chosen.
    for (const format of ["ur", "words"] as const) {
      const parts = shareUnits(share, format);
      const marked = [...parts];
      for (const place of [1, 9, parts.length - 2]) marked[place] = "?";
      expect(readRepairableShare(joinUnits(marked, format)).ur).toBe(share);
    }
  });

  it(
    "lets the secret digest pick among variants when the phrase is restored",
    async () => {
      const vector = vectors.deterministic[4]!;
      const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
      for (const format of ["indexes", "unicode", "colors", "colors-unicode"] as const) {
        const first = shareUnits(vector.shares[0]!, format);
        const second = shareUnits(vector.shares[1]!, format);
        // Colors take 24 bits each: two of them; the 11-bit forms three, in both shares.
        const places = format.startsWith("colors") ? [3, 6] : [2, 8, 14];
        for (const place of places) {
          first[place] = "?";
          second[place] = "?";
        }
        const restore = format.startsWith("colors")
          ? [joinUnits(first, format), vector.shares[1]!]
          : [joinUnits(first, format), joinUnits(second, format)];
        expect(await combineSskrShares(restore), format).toBe(expected);
      }
    },
    LONG_TEST_TIME_LIMIT_MS,
  );
});

const vector = vectors.deterministic[0]!;
const share = vector.shares[0]!;

describe("Unreadable digits inside a color or a Unicode code", () => {
  it("uses the digits read of colors: three colors missing two digits each are settled", () => {
    const colors = shareUnits(share, "colors");
    // Places 4 to 6 hold only the secret, which nothing but the checksum settles.
    const typed = markDigits(share, "colors", { 4: [4, 5], 5: [0, 3], 6: [1, 2] });
    const read = readRepairableShare(typed);
    expect(read.ur).toBe(share);
    expect(read.filled).toEqual(
      [4, 5, 6].map((place) => ({ position: place + 1, value: colors[place] })),
    );
    // The same colors marked whole leave too many open bits for one share alone.
    expect(() => readRepairableShare(markUnits(share, "colors", [4, 5, 6]))).toThrow(
      /Too many|shares fit/u,
    );
    // A lone ?, ?????? and #? are each the whole color.
    for (const whole of ["?", "??????", "#?"])
      expect(
        readRepairableShare(
          joinUnits(
            colors.map((color, place) => (place === 5 ? whole : color)),
            "colors",
          ),
        ).ur,
      ).toBe(share);
  });

  it("refuses a color or a code whose digits read are wrong, or that has too few symbols", () => {
    const colors = shareUnits(share, "colors");
    const wrong = [...colors];
    const digit = wrong[5]![1] === "0" ? "1" : "0";
    // The first digit read wrong, the last one unread: six symbols still.
    wrong[5] = `#${digit}${wrong[5]!.slice(2, 6)}?`;
    expect(() => readRepairableShare(joinUnits(wrong, "colors"))).toThrow(/No valid share/u);
    const short = [...colors];
    short[9] = `${short[9]!.slice(0, 5)}?`;
    expect(() => readRepairableShare(joinUnits(short, "colors"))).toThrow(
      "Color 10 has 5 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color.",
    );
    const codes = shareUnits(share, "unicode");
    codes[3] = `${codes[3]!.slice(0, 2)}?`;
    expect(() => readRepairableShare(joinUnits(codes, "unicode"))).toThrow(
      "Code 4 has 3 of 4 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole code.",
    );
  });

  it("tries the words whose Unicode code fits the digits read", () => {
    const codes = shareUnits(share, "unicode");
    const typed = markDigits(share, "unicode", { 4: [3], 7: [2], 9: [1], 12: [3], 15: [2] });
    const read = readRepairableShare(typed);
    expect(read.ur).toBe(share);
    expect(read.filled.map((element) => element.value)).toEqual(
      [4, 7, 9, 12, 15].map((place) => codes[place]),
    );
    // Five whole codes are more than six marks' worth of checks alone can settle without variants.
    expect(() => readRepairableShare(markUnits(share, "unicode", [4, 7, 9, 12, 15]))).toThrow(
      expect.objectContaining({ code: "sskr.repair.too-many-marks-for-form" }),
    );
  });

  it("reads a lone ? joined to a code as a whole element, as before digit marks", () => {
    const colors = shareUnits(share, "colors");
    // Spaces everywhere but at the mark, which is joined to the color after it or before it.
    for (const joined of [
      [...colors.slice(0, 4), `#?${colors[5]}`, ...colors.slice(6)],
      [...colors.slice(0, 3), `${colors[3]}#?`, ...colors.slice(5)],
    ])
      expect(readRepairableShare(joined.join(" ")).ur).toBe(share);
    const codes = shareUnits(share, "unicode");
    const glued = [...codes.slice(0, 4), `?${codes[5]}`, ...codes.slice(6)];
    expect(readRepairableShare(glued.join(" ")).ur).toBe(share);
    // A code all of whose digits are ? is the whole code.
    expect(
      readRepairableShare(
        joinUnits(
          codes.map((code, i) => (i === 5 ? "????" : code)),
          "unicode",
        ),
      ).ur,
    ).toBe(share);
  });
});

describe("Unreadable digits inside a color or a Unicode code", () => {
  it("reads a ? for a digit of a Color Unicode code written apart, and its color's candidates", () => {
    const codes = shareUnits(share, "colors-unicode").flatMap((color) => color.match(/.{4}/gu)!);
    const digit = (code: string, at: number) => `${code.slice(0, at)}?${code.slice(at + 1)}`;
    // One digit, two digits of one code, a digit beside a code that cannot be read at all.
    for (const marked of [
      codes.map((code, i) => (i === 3 ? digit(code, 2) : code)),
      codes.map((code, i) => (i === 4 ? digit(digit(code, 1), 2) : code)),
      codes.map((code, i) => (i === 6 ? "?" : i === 7 ? digit(code, 0) : code)),
      codes.map((code, i) => (i === 1 ? digit(code, 3) : i === 12 ? digit(code, 0) : code)),
    ]) {
      const repaired = readRepairableShare(marked.join(" "));
      expect(repaired.ur).toBe(share);
      // Each marked color is filled in as its two codes, by its place among the colors.
      for (const element of repaired.filled)
        expect(element.value).toBe(
          codes[(element.position - 1) * 2]! + codes[(element.position - 1) * 2 + 1]!,
        );
    }
    // A code read in part counts as one element; a digit that no code fits leaves no share.
    expect(markCount(codes.map((code, i) => (i === 3 ? digit(code, 2) : code)).join(" "))).toBe(1);
    expect(() =>
      readRepairableShare(codes.map((code, i) => (i === 3 ? "1?00" : code)).join(" ")),
    ).toThrow(expect.objectContaining({ code: "sskr.repair.no-share-fits-marks" }));
  });

  it("says what a ? means in codes run together where it marks a digit", () => {
    const codes = shareUnits(share, "colors-unicode").flatMap((color) => color.match(/.{4}/gu)!);
    const joined = codes.map((code, i) =>
      i === 3 ? `${code.slice(0, 2)}?${code.slice(3)}` : code,
    );
    expect(() => readRepairableShare(joined.join(""))).toThrow(
      "In codes run together, a ? stands for a whole code; to mark one digit, write the codes apart, as the screen shows them.",
    );
    // Written apart, the same mark is a digit.
    expect(readRepairableShare(joined.join(" ")).ur).toBe(share);
  });

  it("names a misplaced ? by the form the other codes are in", () => {
    const colors = shareUnits(share, "colors");
    const joined = colors.map((color, i) => (i === 2 ? color.slice(0, 4) + "?" : color)).join("");
    expect(markProblem(joined)).toBe(
      "color 3 has 4 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color.",
    );
    // Color Unicode codes take a ? for a digit too, but keep their four symbols.
    const colorCodes = shareUnits(share, "colors-unicode").flatMap((color) =>
      color.match(/.{4}/gu)!,
    );
    colorCodes[4] = `${colorCodes[4]!.slice(0, 2)}?`;
    expect(markProblem(colorCodes.join(" "))).toBe(
      "code 5 has 3 of 4 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole code.",
    );
    const numbers = shareUnits(share, "indexes");
    numbers[2] = `${numbers[2]!.slice(0, -1)}?`;
    expect(markProblem(numbers.join(" "))).toBe(
      "word number 3 has a ? among its digits: word numbers take only a lone ? for a whole word number.",
    );
    // Words of another kind, and texts in no form, are left to the reading.
    expect(markProblem("able ac?d zoom")).toBeUndefined();
    expect(markProblem("? ? ?")).toBeUndefined();
  });

  it("chooses the units to try as whole numbers within the limit, however large their counts", () => {
    const units = [{ count: 2 }, { count: 2 ** 60 }, { count: 3 }, { count: 2 ** 1000 }];
    expect(placesWithin(units, 6)).toEqual([{ count: 2 }, { count: 3 }]);
    expect(placesWithin(units, 1)).toEqual([]);
    expect(placesWithin([{ count: Number.MAX_SAFE_INTEGER }], 64)).toEqual([]);
  });

  it("counts a code with ? among its digits as one marked element", () => {
    expect(markCount("#B5?0?? ? #123456")).toBe(2);
    // Among codes apart, a code all of whose digits are ? is one element, as the repair reads it
    // (docs/SSKR.md); a run of ? of another width is read run together, each ? a whole element.
    expect(markCount("4E?0 4E00 ????")).toBe(2);
    expect(markCount("#B5?0?? ?????? #123456")).toBe(2);
    expect(markCount("4E00 ?????? 4E00")).toBe(6);
    expect(markCount("ur:sskr/ab??cd")).toBe(2);
    expect(markCount("able ? ? zoom")).toBe(2);
    const colors = shareUnits(share, "colors");
    const partly = (count: number) =>
      joinUnits(
        colors.map((color, place) =>
          place < count ? `${color.slice(0, 3)}??${color.slice(5)}` : color,
        ),
        "colors",
      );
    expect(markCount(partly(6))).toBe(6);
    expect(() => readRepairableShare(partly(6))).not.toThrow(/at most 6/u);
    expect(() => readRepairableShare(partly(7))).toThrow(/at most 6/u);
  });
});
