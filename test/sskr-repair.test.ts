import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { readRepairableShare } from "../src/sskr/repair.js";
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
