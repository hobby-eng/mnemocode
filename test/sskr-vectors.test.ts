import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import {
  colorsToShare,
  normalizeShare,
  shareInfo,
  shareToColors,
  transportToUr,
  urToTransport,
  validateShareSet,
} from "../src/sskr/transport.js";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
);
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const original = entropyToMnemonic(bytes(vectors.official.entropy), wordlist);
// Independent CRC writer for malformed semantic fixtures; avoids rejecting just the CRC.
function recheck(body: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (const b of body) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = new Uint8Array(body.length + 4);
  result.set(body);
  new DataView(result.buffer).setUint32(body.length, (crc ^ 0xffffffff) >>> 0);
  return result;
}
describe("Published SSKR v1 vectors", () => {
  it("matches independently computed transport bytes and RGB codes in both directions", () => {
    const v = vectors.official;
    expect(Buffer.from(urToTransport(v.shares[0])).toString("hex")).toBe(v.firstShareTransportHex);
    expect(shareToColors(v.shares[0])).toEqual(v.firstShareColors);
    expect(colorsToShare(v.firstShareColors.join(""))).toBe(v.shares[0]);
    expect(normalizeShare(v.shares[0].toUpperCase())).toBe(v.shares[0]);
  });
  it("recovers all 30 minimal official grouped quorums and tagged Bytewords", async () => {
    const s = vectors.official.shares as string[];
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++)
        for (let c = 3; c < 8; c++)
          for (let d = c + 1; d < 8; d++)
            for (let e = d + 1; e < 8; e++)
              expect(await combineSskrShares([s[a]!, s[b]!, s[c]!, s[d]!, s[e]!])).toBe(original);
    expect(await combineSskrShares(vectors.official.bytewords)).toBe(original);
  });
  it.each(vectors.official.invalidQuorums)(
    "rejects an invalid official quorum %j",
    async (...indices: number[]) => {
      await expect(
        combineSskrShares(indices.map((i) => vectors.official.shares[i])),
      ).rejects.toThrow();
    },
  );
  it.each(vectors.deterministic)("locks exact creation and every pair: $name", async (v: any) => {
    const engine = await sskrEngine();
    const actual = engine
      .create_sskr_shares(
        bytes(v.entropy),
        v.groupThreshold,
        Uint8Array.of(2, 3),
        bytes(v.testOnlySeed),
      )
      .trim()
      .split("\n");
    expect(actual).toEqual(v.shares);
    expect(actual.map(shareToColors)).toEqual(v.colors);
    const expected = entropyToMnemonic(bytes(v.entropy), wordlist);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      expect(await combineSskrShares([actual[a]!, actual[b]!])).toBe(expected);
  });
  it("rejects bad CBOR metadata even with an intact CRC", () => {
    const body = urToTransport(vectors.official.shares[0]).slice(0, -4);
    for (const [offset, value] of [
      [0, 0x80],
      [3, 0xf0],
      [4, 0xf1],
      [5, 0x10],
    ]) {
      const changed = body.slice();
      changed[offset!] = value!;
      expect(() => shareInfo(recheck(changed))).toThrow();
    }
    const badTag = Uint8Array.from([0xd9, 0, 1, ...body]);
    expect(() => shareInfo(recheck(badTag))).toThrow(/tag/u);
  });
  it("rejects nonzero padding, unknown versions, trailing colors and invalid Bytewords", () => {
    const codes = vectors.official.firstShareColors as string[];
    expect(() => colorsToShare([...codes.slice(0, -1), "#420001"].join(" "))).toThrow();
    expect(() => colorsToShare(["#A21A55", ...codes.slice(1)].join(" "))).toThrow();
    expect(() => colorsToShare([...codes, "#000000"].join(" "))).toThrow();
    for (const input of ["ur:sskr/1-2/abcd", "ur:sskr/zz", "tuna unknown", "", "#A11A5"])
      expect(() => normalizeShare(input)).toThrow();
  });
  it("rejects tampered share data after transport checksum is recomputed", async () => {
    const selected = [0, 2, 3, 5, 7].map((i) => vectors.official.shares[i]);
    const body = urToTransport(selected[0]).slice(0, -4);
    body[8]! ^= 1;
    selected[0] = transportToUr(recheck(body));
    await expect(combineSskrShares(selected)).rejects.toThrow();
  });
  it("supports the maximal 16-of-16 threshold and refuses 15 members", async () => {
    const engine = await sskrEngine();
    const entropy = new Uint8Array(32);
    const shares = engine
      .create_sskr_shares(entropy, 1, Uint8Array.of(16, 16), new Uint8Array(32))
      .trim()
      .split("\n");
    expect(await combineSskrShares(shares)).toBe(entropyToMnemonic(entropy, wordlist));
    await expect(combineSskrShares(shares.slice(1))).rejects.toThrow(/threshold/u);
  });
  it("rejects metadata conflicts before native reconstruction", () => {
    const first = vectors.official.shares[0];
    const body = urToTransport(vectors.official.shares[1]).slice(0, -4);
    for (const [offset, value] of [
      [1, 0],
      [3, 0],
      [4, 2],
    ]) {
      const changed = body.slice();
      changed[offset!] = value!;
      const altered = transportToUr(recheck(changed));
      expect(() => validateShareSet([first, altered], false)).toThrow();
    }
    expect(() => validateShareSet([])).toThrow();
    expect(() => validateShareSet(Array(257).fill(first))).toThrow();
  });
});
