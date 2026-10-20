// CRC-valid fixtures reach the share-width rule, rather than failing an unrelated checksum.
import { describe, expect, it } from "vitest";
import { restoreCompleteShares } from "../src/sskr/complete-shares.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { shareInfo } from "../src/sskr/transport.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { SEED_BYTES } from "../src/sskr/share-platform.js";
import { recheck } from "./helpers/share-transport.js";

// BIP39 entropy sizes are 128 through 256 bits in steps of 32, independently of SHARE_LENGTHS.
const SUPPORTED_BYTES = [16, 20, 24, 28, 32] as const;
const UNSUPPORTED_BYTES = [0, 15, 17, 18, 19, 21, 23, 25, 27, 29, 31, 33] as const;
const SHORT_CBOR_LENGTH = 24;
const CBOR_BYTE_STRING = 0x40;
const CBOR_ONE_BYTE_LENGTH = 0x58;
// Identifier 0x1234; one group of member threshold 2, member 0. Public synthetic metadata.
const METADATA = [0x12, 0x34, 0x00, 0x01, 0x00];

function transport(secretBytes: number): Uint8Array {
  const payload = Uint8Array.from([...METADATA, ...new Uint8Array(secretBytes)]);
  const head =
    payload.length < SHORT_CBOR_LENGTH
      ? [CBOR_BYTE_STRING + payload.length]
      : [CBOR_ONE_BYTE_LENGTH, payload.length];
  return recheck(Uint8Array.from([...head, ...payload]));
}

describe("SSKR's BIP39 entropy-width boundary", () => {
  it.each(SUPPORTED_BYTES)("accepts %i bytes of BIP39 entropy", (size) => {
    expect(shareInfo(transport(size)).secretLength).toBe(size);
  });

  it.each(UNSUPPORTED_BYTES)("refuses a CRC-valid record of %i entropy bytes", (size) => {
    expect(() => shareInfo(transport(size))).toThrow("Invalid SSKR share byte string.");
  });

  it.each(UNSUPPORTED_BYTES)(
    "refuses and wipes %i restored bytes that are not BIP39 entropy",
    async (size) => {
      const returned = new Uint8Array(size).fill(0xa5);
      await expect(
        restoreCompleteShares(sskrSetVector.shares.slice(0, 2), {
          ...nodeSharePlatform,
          combineShares: async () => returned,
        }),
      ).rejects.toThrow("Recovered SSKR secret is not BIP39 entropy.");
      expect(returned.every((byte) => byte === 0)).toBe(true);
    },
  );
});

describe("a CRC-valid share whose CBOR is cut short (AUD-024-FUN001)", () => {
  // 0xd9 starts a two-byte tag, 0xd9 0x9d 0x75 is the SSKR tag 40309; every record ends early.
  it.each([
    ["the tag byte alone", [0xd9], "Not an SSKR CBOR tag."],
    ["a tag with one of its two bytes", [0xd9, 0x01], "Not an SSKR CBOR tag."],
    ["a one-byte-length header alone", [CBOR_ONE_BYTE_LENGTH], "Invalid SSKR share byte string."],
    ["the SSKR tag without a byte string", [0xd9, 0x9d, 0x75], "Invalid SSKR share byte string."],
    [
      "the SSKR tag and a header without its length",
      [0xd9, 0x9d, 0x75, CBOR_ONE_BYTE_LENGTH],
      "Invalid SSKR share byte string.",
    ],
  ])("is refused as an invalid share: %s", (_, cbor, message) => {
    expect(() => shareInfo(recheck(Uint8Array.from(cbor)))).toThrow(message);
  });
});

describe("the raw SSKR engine refuses malformed group policies", () => {
  it.each([{ pairs: [] }, { pairs: [2] }, { pairs: [2, 3, 2] }])(
    "refuses incomplete threshold/count pairs $pairs",
    async ({ pairs }) => {
      const engine = await sskrEngine();
      expect(() =>
        engine.create_sskr_shares(
          new Uint8Array(16),
          1,
          Uint8Array.from(pairs),
          new Uint8Array(SEED_BYTES),
        ),
      ).toThrow("SSKR groups must contain threshold/count pairs.");
    },
  );

  // The engine's code and message for each policy: a member count and a member threshold share
  // their code.
  it.each([
    [0, [2, 3], "sskr.engine.specification", "SSKR group threshold is invalid"],
    [2, [2, 3], "sskr.engine.specification", "SSKR group threshold is invalid"],
    [1, [0, 3], "sskr.engine.generate", "SSKR Shamir error: invalid threshold"],
    [1, [2, 0], "sskr.engine.group", "SSKR member count is invalid"],
    [1, [4, 3], "sskr.engine.group", "SSKR member threshold is invalid"],
  ])("refuses group threshold %i with pairs %j", async (groupThreshold, pairs, code, message) => {
    const engine = await sskrEngine();
    expect(() =>
      engine.create_sskr_shares(
        new Uint8Array(16),
        groupThreshold as number,
        Uint8Array.from(pairs as number[]),
        new Uint8Array(SEED_BYTES),
      ),
    ).toThrow(expect.objectContaining({ code, message }));
  });
});
