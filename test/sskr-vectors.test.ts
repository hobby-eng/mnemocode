import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import {
  CHECKSUM_BYTES,
  colorsToShare,
  normalizeShare,
  shareInfo,
  shareToColors,
  transportToUr,
  urToTransport,
  validateShareSet,
} from "../src/sskr/transport.js";
import { MAX_SHARES } from "../src/sskr/split.js";
import { SEED_BYTES } from "../src/sskr/share-platform.js";
import { recheck } from "./helpers/share-transport.js";
import { hexBytes, sskrVectors } from "./helpers/vectors.js";
const vectors = sskrVectors();
const original = entropyToMnemonic(hexBytes(vectors.official.entropy), wordlist);
describe("Published SSKR v1 vectors", () => {
  it("matches independently computed transport bytes and RGB codes in both directions", () => {
    const v = vectors.official;
    expect(Buffer.from(urToTransport(v.shares[0]!)).toString("hex")).toBe(v.firstShareTransportHex);
    expect(shareToColors(v.shares[0]!)).toEqual(v.firstShareColors);
    expect(colorsToShare(v.firstShareColors.join(""))).toBe(v.shares[0]!);
    expect(normalizeShare(v.shares[0]!.toUpperCase())).toBe(v.shares[0]!);
  });
  it("recovers all 30 minimal official grouped quorums and tagged Bytewords", async () => {
    const s = vectors.official.shares;
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++)
        for (let c = 3; c < 8; c++)
          for (let d = c + 1; d < 8; d++)
            for (let e = d + 1; e < 8; e++)
              expect(await combineSskrShares([s[a]!, s[b]!, s[c]!, s[d]!, s[e]!])).toBe(original);
    expect(await combineSskrShares(vectors.official.bytewords)).toBe(original);
  });
  /** The refusal of each invalid official quorum, by its indexes: too few shares, or one twice. */
  const quorumRefusals: Readonly<Record<string, string>> = {
    "[0,1]": "sskr.transport.not-enough-sskr-shares-meet-recorded-threshold",
    "[0,1,3,4]": "sskr.transport.not-enough-sskr-shares-meet-recorded-threshold",
    "[0,0,3,5,7]": "sskr.transport.member-given-twice",
  };
  it.each(vectors.official.invalidQuorums)(
    "rejects an invalid official quorum %j",
    async (...indices: number[]) => {
      const code = quorumRefusals[JSON.stringify(indices)];
      expect(code, "a quorum of the vectors that this test names").toBeDefined();
      await expect(
        combineSskrShares(indices.map((i) => vectors.official.shares[i]!)),
      ).rejects.toMatchObject({ code });
    },
  );
  it.each(vectors.deterministic)("locks exact creation and every pair: $name", async (v) => {
    const engine = await sskrEngine();
    const actual = engine
      .create_sskr_shares(
        hexBytes(v.entropy),
        v.groupThreshold,
        Uint8Array.of(2, 3),
        hexBytes(v.testOnlySeed),
      )
      .trim()
      .split("\n");
    expect(actual).toEqual(v.shares);
    expect(actual.map(shareToColors)).toEqual(v.colors);
    const expected = entropyToMnemonic(hexBytes(v.entropy), wordlist);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const)
      expect(await combineSskrShares([actual[a]!, actual[b]!])).toBe(expected);
  });
  it("rejects bad CBOR metadata even with an intact CRC", () => {
    const body = urToTransport(vectors.official.shares[0]!).slice(0, -CHECKSUM_BYTES);
    // The first byte is the CBOR header of the byte string; the others are the share's metadata.
    for (const [offset, value, code] of [
      [0, 0x80, "sskr.transport.invalid-sskr-share-byte-string"],
      [3, 0xf0, "sskr.transport.invalid-sskr-share-metadata"],
      [4, 0xf1, "sskr.transport.invalid-sskr-share-metadata"],
      [5, 0x10, "sskr.transport.invalid-sskr-share-metadata"],
    ] as const) {
      const changed = body.slice();
      changed[offset] = value;
      expect(() => shareInfo(recheck(changed)), String(offset)).toThrow(
        expect.objectContaining({ code }),
      );
    }
    const badTag = Uint8Array.from([0xd9, 0, 1, ...body]);
    expect(() => shareInfo(recheck(badTag))).toThrow(/tag/u);
  });
  it("rejects nonzero padding, unknown versions and invalid Bytewords; leaves out trailing colors", () => {
    const codes = vectors.official.firstShareColors;
    const refused = { code: "sskr.transport.mixed-share-refused" };
    // The last color is the share's last byte, 67, and two bytes of padding.
    expect(() => colorsToShare([...codes.slice(0, -1), "#670001"].join(" "))).toThrow(
      expect.objectContaining(refused),
    );
    // The second color's middle byte is the version's, mixed: A1 becomes A0.
    expect(() => colorsToShare([codes[0], "#42D0F0", ...codes.slice(2)].join(" "))).toThrow(
      expect.objectContaining(refused),
    );
    // A color after the share's own length, such as a decoy of its cards, belongs to no share.
    expect(colorsToShare([...codes, "#000000"].join(" "))).toBe(colorsToShare(codes.join(" ")));
    for (const [input, code] of [
      ["ur:sskr/1-2/abcd", "sskr.transport.expected-single-part-ur-sskr-record"],
      ["ur:sskr/zz", "sskr.transport.decoded-bytes-refused"],
      ["tuna unknown", "sskr.transport.decoded-bytes-refused"],
      ["", "sskr.transport.not-sskr-share"],
      ["#A11A5", "sskr.transport.invalid-sskr-rgb-codes-preserve-their-printed-order"],
    ] as const)
      expect(() => normalizeShare(input), input).toThrow(expect.objectContaining({ code }));
  });
});

describe("Published SSKR v1 vectors", () => {
  it("rejects tampered share data after transport checksum is recomputed", async () => {
    const selected = [0, 2, 3, 5, 7].map((i) => vectors.official.shares[i]!);
    const body = urToTransport(selected[0]!).slice(0, -CHECKSUM_BYTES);
    body[8]! ^= 1;
    selected[0] = transportToUr(recheck(body));
    await expect(combineSskrShares(selected)).rejects.toMatchObject({
      code: "sskr.complete-shares.no-secret",
    });
  });
  it("supports the maximal 16-of-16 threshold and refuses 15 members", async () => {
    const engine = await sskrEngine();
    const entropy = new Uint8Array(32);
    const shares = engine
      .create_sskr_shares(
        entropy,
        1,
        Uint8Array.of(MAX_SHARES, MAX_SHARES),
        new Uint8Array(SEED_BYTES),
      )
      .trim()
      .split("\n");
    expect(shares).toHaveLength(MAX_SHARES);
    expect(await combineSskrShares(shares)).toBe(entropyToMnemonic(entropy, wordlist));
    await expect(combineSskrShares(shares.slice(1))).rejects.toThrow(/threshold/u);
  });
  // G1-004: the engine itself refuses one member more than MAX_SHARES, which split.ts checks first.
  it("refuses one member more than MAX_SHARES in the engine itself", async () => {
    const engine = await sskrEngine();
    expect(() =>
      engine.create_sskr_shares(
        new Uint8Array(16),
        1,
        Uint8Array.of(2, MAX_SHARES + 1),
        new Uint8Array(SEED_BYTES),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "sskr.engine.group",
        message: "SSKR member count is invalid",
      }),
    );
  });
  // G1-005: SEED_BYTES is a copy of the engine's seed length, kept in step here.
  it("takes a seed of SEED_BYTES and refuses one byte less or more", async () => {
    const engine = await sskrEngine();
    const split = (seedBytes: number) =>
      engine.create_sskr_shares(
        new Uint8Array(16),
        1,
        Uint8Array.of(2, 3),
        new Uint8Array(seedBytes),
      );
    expect(split(SEED_BYTES).trim().split("\n")).toHaveLength(3);
    expect(() => split(SEED_BYTES - 1)).toThrow(/32 bytes/u);
    expect(() => split(SEED_BYTES + 1)).toThrow(/32 bytes/u);
  });
  it("rejects metadata conflicts before native reconstruction", () => {
    const first = vectors.official.shares[0]!;
    const body = urToTransport(vectors.official.shares[1]!).slice(0, -CHECKSUM_BYTES);
    const otherSet = "sskr.transport.shares-of-different-sets";
    for (const [offset, value, code] of [
      [1, 0, otherSet],
      [3, 0, otherSet],
      [4, 2, "sskr.transport.group-thresholds-conflict"],
    ] as const) {
      const changed = body.slice();
      changed[offset] = value;
      const altered = transportToUr(recheck(changed));
      expect(() => validateShareSet([first, altered], false)).toThrow(
        expect.objectContaining({ code }),
      );
    }
    const count = { code: "sskr.transport.assert-share-count-refused" };
    expect(() => validateShareSet([])).toThrow(expect.objectContaining(count));
    expect(() => validateShareSet(Array(257).fill(first))).toThrow(expect.objectContaining(count));
  });
});
