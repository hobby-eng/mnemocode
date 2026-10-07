import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { markCount, markProblem, placesWithin, readRepairableShare } from "../src/sskr/repair.js";
import {
  readShare,
  writeShare,
  urToTransport,
  transportToUr,
  type ShareFormat,
} from "../src/sskr/transport.js";
import { crc32 } from "../src/sskr/checksum.js";
import { bytewords } from "../src/sskr/bytewords-list.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { checkShareBackup } from "../src/cli/backup-check.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as {
  deterministic: { name: string; entropy: string; shares: string[] }[];
  official: { shares: string[] };
};
const FORMATS: ShareFormat[] = ["ur", "words", "indexes", "unicode", "colors", "colors-unicode"];

function units(share: string, format: ShareFormat): string[] {
  const text = writeShare(share, format);
  if (format === "ur") return text.slice("ur:sskr/".length).match(/../gu)!;
  if (format === "colors-unicode") return text.match(/.{4}/gu)!;
  return text.split(" ");
}

function join(units: string[], format: ShareFormat): string {
  if (format === "ur") return "ur:sskr/" + units.join("");
  if (format === "colors-unicode") return units.join("");
  return units.join(" ");
}

function erase(share: string, format: ShareFormat, index: number): string {
  const parts = units(share, format);
  parts[index] = "?";
  return join(parts, format);
}

describe("One explicit unreadable SSKR element", () => {
  for (const vector of vectors.deterministic) {
    it.each(FORMATS)(`${vector.name}: repairs first, middle and last %s units`, (format) => {
      const share = vector.shares[0]!;
      const length = units(share, format).length;
      for (const index of [0, Math.floor(length / 2), length - 1])
        expect(readRepairableShare(erase(share, format, index))).toMatchObject({
          ur: share,
          format,
          repaired: true,
        });
    });
  }

  it("repairs every RGB code, including the checksum, mixed header and zero padding", () => {
    for (const vector of vectors.deterministic) {
      const share = vector.shares[0]!;
      for (let index = 0; index < units(share, "colors").length; index++)
        expect(readRepairableShare(erase(share, "colors", index)).ur).toBe(share);
    }
    const official = vectors.official.shares[0]!;
    for (let index = 0; index < units(official, "colors").length; index++)
      expect(readRepairableShare(erase(official, "colors", index)).ur).toBe(official);
  });

  it("reads a marker inside joined Unicode, RGB and UR streams", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    expect(readRepairableShare(erase(share, "unicode", 4).replaceAll(" ", "")).ur).toBe(share);
    expect(readRepairableShare(erase(share, "colors", 4).replaceAll(" ", "")).ur).toBe(share);
    expect(readRepairableShare(erase(share, "colors", 4).replace("?", "#?")).ur).toBe(share);
    expect(readRepairableShare(erase(share, "ur", 4)).ur).toBe(share);
    expect(readRepairableShare(erase(share, "indexes", 4).replaceAll(" ", ",\n")).ur).toBe(share);
    expect(readRepairableShare(erase(share, "words", 4).replaceAll(" ", "-")).ur).toBe(share);
  });

  it("repairs the supported tagged and non-minimal short CBOR length layouts", () => {
    const original = vectors.deterministic[0]!.shares[0]!;
    const cbor = urToTransport(original).subarray(0, -4);
    const layouts = [
      Uint8Array.of(0x58, cbor[0]! - 0x40, ...cbor.subarray(1)),
      // Both legacy tag 309 and current registered tag 40309 are accepted by transport.ts.
      Uint8Array.of(0xd9, 0x01, 0x35, ...cbor),
      Uint8Array.of(0xd9, 0x9d, 0x75, ...cbor),
    ];
    for (const layout of layouts) {
      const bytes = new Uint8Array(layout.length + 4);
      bytes.set(layout);
      new DataView(bytes.buffer).setUint32(layout.length, crc32(layout));
      const share =
        "ur:sskr/" +
        Array.from(bytes, (byte) => bytewords[byte]![0]! + bytewords[byte]![3]!).join("");
      const expected = transportToUr(bytes);
      for (let index = 0; index < units(share, "colors").length; index++)
        expect(readRepairableShare(erase(share, "colors", index)).ur).toBe(expected);
    }
  });

  it("accepts color Unicode symbols as well as their four-digit hex codes", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    const symbols = units(share, "colors-unicode").map((code) =>
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

  it("repairs a whole eight-digit color Unicode pair or both of its symbols", () => {
    for (const vector of vectors.deterministic) {
      const share = vector.shares[0]!;
      const pairs = writeShare(share, "colors-unicode").match(/.{8}/gu)!;
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
      const parts = units(share, format);
      for (const index of [2, 3, 4, 5, 6, 7, 8]) parts[index] = "?";
      expect(() => readRepairableShare(join(parts, format))).toThrow(/at most 6/u);
    }
    expect(() => readRepairableShare("?".repeat(2049))).toThrow();
    expect(() => readRepairableShare("? not a share")).toThrow(/No valid share/u);
    const numbers = units(share, "indexes");
    numbers[8] = numbers[8] === "1" ? "2" : "1";
    expect(() => readRepairableShare(numbers.join(" "))).toThrow();
  });

  it("does not accept an extra wrong element merely because one hole is marked", () => {
    const share = vectors.deterministic[0]!.shares[0]!;
    const parts = units(share, "words");
    parts[3] = "?";
    parts[8] = "zzzz";
    expect(() => readRepairableShare(parts.join(" "))).toThrow(/No valid share/u);
  });

  it("still requires a quorum and rejects duplicate members after repair", async () => {
    const vector = vectors.deterministic[0]!;
    const first = erase(vector.shares[0]!, "indexes", 8);
    const second = erase(vector.shares[1]!, "colors", 3);
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    expect(await combineSskrShares([first, second])).toBe(expected);
    await expect(combineSskrShares([first])).rejects.toThrow(/threshold/u);
    await expect(combineSskrShares([])).rejects.toThrow(/between 1 and 256/u);
    await expect(combineSskrShares(Array(257).fill(first))).rejects.toThrow(/between 1 and 256/u);
    await expect(combineSskrShares([first, vector.shares[0]!])).rejects.toThrow(/more than once/u);
    expect(await checkShareBackup(expected, `${first};${second}`, "direct", "")).toBe("restores");
  });
});

describe("Several unreadable SSKR elements", () => {
  const share = vectors.deterministic[4]!.shares[0]!;

  it("fills in up to three word numbers, Unicode codes, Bytewords or UR letters, and says what", () => {
    for (const format of ["ur", "words", "indexes", "unicode"] as const) {
      const parts = units(share, format);
      const places = [1, Math.floor(parts.length / 2), parts.length - 2];
      const marked = [...parts];
      for (const place of places.slice(0, 2)) marked[place] = "?";
      const two = readRepairableShare(join(marked, format));
      expect(two.ur).toBe(share);
      expect(two.filled).toEqual(
        places.slice(0, 2).map((place) => ({ position: place + 1, value: parts[place] })),
      );
    }
    // Three: alone they may leave variants, which are listed, never chosen.
    for (const format of ["ur", "words"] as const) {
      const parts = units(share, format);
      const marked = [...parts];
      for (const place of [1, 9, parts.length - 2]) marked[place] = "?";
      expect(readRepairableShare(join(marked, format)).ur).toBe(share);
    }
  });

  it("lets the secret digest pick among variants when the phrase is restored", async () => {
    const vector = vectors.deterministic[4]!;
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    for (const format of ["indexes", "unicode", "colors", "colors-unicode"] as const) {
      const first = units(vector.shares[0]!, format);
      const second = units(vector.shares[1]!, format);
      // Colors take 24 bits each: two of them; the 11-bit forms three, in both shares.
      const places = format.startsWith("colors") ? [3, 6] : [2, 8, 14];
      for (const place of places) {
        first[place] = "?";
        second[place] = "?";
      }
      const restore = format.startsWith("colors")
        ? [join(first, format), vector.shares[1]!]
        : [join(first, format), join(second, format)];
      expect(await combineSskrShares(restore), format).toBe(expected);
    }
  }, 120_000);
});

describe("Unreadable digits inside a color or a Unicode code", () => {
  const vector = vectors.deterministic[0]!;
  const share = vector.shares[0]!;

  /** The share in `format` with the elements at `places` marked whole. */
  function wholeMarks(format: ShareFormat, places: readonly number[]): string {
    const parts = units(share, format);
    for (const place of places) parts[place] = "?";
    return join(parts, format);
  }

  /** The share in `format` with the digits at `digits` (from 0, after any #) of each element unreadable. */
  function markDigits(format: ShareFormat, marks: Record<number, readonly number[]>): string {
    const parts = units(share, format);
    for (const [place, digits] of Object.entries(marks)) {
      const part = parts[Number(place)]!;
      const prefix = part.startsWith("#") ? "#" : "";
      const symbols = [...part.slice(prefix.length)];
      for (const digit of digits) symbols[digit] = "?";
      parts[Number(place)] = prefix + symbols.join("");
    }
    return join(parts, format);
  }

  it("uses the digits read of colors: three colors missing two digits each are settled", () => {
    const colors = units(share, "colors");
    // Places 4 to 6 hold only the secret, which nothing but the checksum settles.
    const typed = markDigits("colors", { 4: [4, 5], 5: [0, 3], 6: [1, 2] });
    const read = readRepairableShare(typed);
    expect(read.ur).toBe(share);
    expect(read.filled).toEqual(
      [4, 5, 6].map((place) => ({ position: place + 1, value: colors[place] })),
    );
    // The same colors marked whole leave too many open bits for one share alone.
    expect(() => readRepairableShare(wholeMarks("colors", [4, 5, 6]))).toThrow(
      /Too many|shares fit/u,
    );
    // A lone ?, ?????? and #? are each the whole color.
    for (const whole of ["?", "??????", "#?"])
      expect(
        readRepairableShare(
          join(
            colors.map((color, place) => (place === 5 ? whole : color)),
            "colors",
          ),
        ).ur,
      ).toBe(share);
  });

  it("refuses a color or a code whose digits read are wrong, or that has too few symbols", () => {
    const colors = units(share, "colors");
    const wrong = [...colors];
    const digit = wrong[5]![1] === "0" ? "1" : "0";
    // The first digit read wrong, the last one unread: six symbols still.
    wrong[5] = `#${digit}${wrong[5]!.slice(2, 6)}?`;
    expect(() => readRepairableShare(join(wrong, "colors"))).toThrow(/No valid share/u);
    const short = [...colors];
    short[9] = `${short[9]!.slice(0, 5)}?`;
    expect(() => readRepairableShare(join(short, "colors"))).toThrow(
      "Color 10 has 5 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color.",
    );
    const codes = units(share, "unicode");
    codes[3] = `${codes[3]!.slice(0, 2)}?`;
    expect(() => readRepairableShare(join(codes, "unicode"))).toThrow(
      "Code 4 has 3 of 4 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole code.",
    );
  });

  it("tries the words whose Unicode code fits the digits read", () => {
    const codes = units(share, "unicode");
    const typed = markDigits("unicode", { 4: [3], 7: [2], 9: [1], 12: [3], 15: [2] });
    const read = readRepairableShare(typed);
    expect(read.ur).toBe(share);
    expect(read.filled.map((element) => element.value)).toEqual(
      [4, 7, 9, 12, 15].map((place) => codes[place]),
    );
    // Five whole codes are more than six marks' worth of checks alone can settle without variants.
    expect(() => readRepairableShare(wholeMarks("unicode", [4, 7, 9, 12, 15]))).toThrow();
  });

  it("reads a lone ? joined to a code as a whole element, as before digit marks", () => {
    const colors = units(share, "colors");
    // Spaces everywhere but at the mark, which is joined to the color after it or before it.
    for (const joined of [
      [...colors.slice(0, 4), `#?${colors[5]}`, ...colors.slice(6)],
      [...colors.slice(0, 3), `${colors[3]}#?`, ...colors.slice(5)],
    ])
      expect(readRepairableShare(joined.join(" ")).ur).toBe(share);
    const codes = units(share, "unicode");
    const glued = [...codes.slice(0, 4), `?${codes[5]}`, ...codes.slice(6)];
    expect(readRepairableShare(glued.join(" ")).ur).toBe(share);
    // A code all of whose digits are ? is the whole code.
    expect(
      readRepairableShare(
        join(
          codes.map((code, i) => (i === 5 ? "????" : code)),
          "unicode",
        ),
      ).ur,
    ).toBe(share);
  });

  it("names a misplaced ? by the form the other codes are in", () => {
    const colors = units(share, "colors");
    const joined = colors.map((color, i) => (i === 2 ? color.slice(0, 4) + "?" : color)).join("");
    expect(markProblem(joined)).toBe(
      "color 3 has 4 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color.",
    );
    const colorCodes = units(share, "colors-unicode");
    colorCodes[4] = `${colorCodes[4]!.slice(0, 3)}?`;
    expect(markProblem(colorCodes.join(" "))).toBe(
      "code 5 has a ? among its digits: Color Unicode codes take only a lone ? for a whole code.",
    );
    const numbers = units(share, "indexes");
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
    // A run of ? alone counts each ?: each may stand for a whole element.
    expect(markCount("4E?0 4E00 ????")).toBe(5);
    expect(markCount("ur:sskr/ab??cd")).toBe(2);
    expect(markCount("able ? ? zoom")).toBe(2);
    const colors = units(share, "colors");
    const partly = (count: number) =>
      join(
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
