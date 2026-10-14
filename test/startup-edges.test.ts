// Quick startup assertions must detect wrong answers and lost refusals, not merely round-trip.
// Public fixtures only; no card/PDF renderer or full vector replay is used in this file.
import { afterEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  write: undefined as string | undefined,
  read: undefined as string | undefined,
  acceptZero: false,
  shiftWrite: false,
  shiftRead: false,
}));
vi.mock("../src/core/representations.js", async (original) => {
  const actual = await original<typeof import("../src/core/representations.js")>();
  return {
    ...actual,
    formatEncoded: (...args: Parameters<typeof actual.formatEncoded>) =>
      args[1] === fault.write ? "wrong public fixture" : actual.formatEncoded(...args),
    parseInput: (...args: Parameters<typeof actual.parseInput>) =>
      fault.acceptZero && args[1] === "indexes" && args[0].startsWith("0 ")
        ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]
        : actual.parseInput(...args),
  };
});
vi.mock("../src/core/seedshift.js", async (original) => {
  const actual = await original<typeof import("../src/core/seedshift.js")>();
  return {
    ...actual,
    decodeInputDirect: (...args: Parameters<typeof actual.decodeInputDirect>) => {
      const decoded = actual.decodeInputDirect(...args);
      return args[1] === fault.read
        ? { ...decoded, recoveredMnemonic: "wrong public fixture" }
        : decoded;
    },
    // One date fewer: another valid masked phrase, as a wrong Seedshift would give.
    encodeMnemonic: (...args: Parameters<typeof actual.encodeMnemonic>) =>
      actual.encodeMnemonic(args[0], fault.shiftWrite ? args[1].slice(1) : args[1]),
  };
});
vi.mock("../src/core/masking.js", async (original) => {
  const actual = await original<typeof import("../src/core/masking.js")>();
  return {
    ...actual,
    decodeInput: (...args: Parameters<typeof actual.decodeInput>) => {
      const decoded = actual.decodeInput(...args);
      return fault.shiftRead ? { ...decoded, recoveredMnemonic: "wrong public fixture" } : decoded;
    },
  };
});

import {
  checkRepresentationStartup,
  REPRESENTATION_ANSWERS,
  SEEDSHIFT_ANSWERS,
} from "../src/core/representations-self-test.js";
import { MnemoCodeSelfTest } from "../src/core/self-test.js";
import { ENCODED_FORMATS } from "../src/core/types.js";
import { bytesOfHex } from "../src/core/bits.js";
import {
  checkSskrKnownAnswers,
  checkSskrTransportStartup,
  sskrLongVector,
  sskrVector,
} from "../src/sskr/known-answers.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { mnemocodeVectors, sskrVectors, type MnemocodeVector } from "./helpers/vectors.js";

afterEach(() => {
  fault.write = undefined;
  fault.read = undefined;
  fault.acceptZero = false;
  fault.shiftWrite = false;
  fault.shiftRead = false;
});

/** The public vectors of vectors/mnemocode-v1.json by name. */
function publicVector(name: string): MnemocodeVector {
  return mnemocodeVectors().vectors.find((item) => item.name === name)!;
}

describe("representation startup checks", () => {
  it("checks the 12- and 24-word answers and refusals without a host", () => {
    expect(checkRepresentationStartup).not.toThrow();
  });

  it("keeps its Seedshift answers equal to the published 15-, 18- and 21-word vectors", () => {
    expect(SEEDSHIFT_ANSWERS.map(({ words }) => words)).toEqual([15, 18, 21]);
    for (const answer of SEEDSHIFT_ANSWERS) {
      const vector = publicVector(`checksum-valid-seedshift-${answer.words}`);
      expect(answer).toEqual({
        words: answer.words,
        source: vector.sourceMnemonic,
        dates: vector.dates,
        forms: {
          english: vector.english,
          indexes: vector.indexes,
          unicode: vector.unicode,
          colors: vector.colors,
          "colors-unicode": vector.colorsUnicode,
        },
      });
    }
  });

  it("fails on a wrong Seedshift forward or reverse answer", () => {
    fault.shiftWrite = true;
    expect(checkRepresentationStartup).toThrow("Seedshift 15-word english encoding mismatch.");
    fault.shiftWrite = false;
    fault.shiftRead = true;
    expect(checkRepresentationStartup).toThrow("Seedshift 15-word english decoding mismatch.");
  });

  it("keeps its 12-word answers equal to the published direct-12 vector", () => {
    const vector = publicVector("direct-12");
    const answer = REPRESENTATION_ANSWERS.find(({ words }) => words === 12)!;
    expect(answer.forms).toEqual({
      english: vector.english,
      indexes: vector.indexes,
      unicode: vector.unicode,
      colors: vector.colors,
      "colors-unicode": vector.colorsUnicode,
    });
  });

  it.each(ENCODED_FORMATS)("fails on a wrong %s forward answer", (format) => {
    fault.write = format;
    expect(checkRepresentationStartup).toThrow(`Direct 12-word ${format} encoding mismatch.`);
  });

  it.each(ENCODED_FORMATS)("fails on a wrong %s reverse answer", (format) => {
    fault.read = format;
    expect(checkRepresentationStartup).toThrow(`Direct 12-word ${format} decoding mismatch.`);
  });

  it("fails if the word-number parser starts accepting zero", () => {
    fault.acceptZero = true;
    expect(checkRepresentationStartup).toThrow("Direct word number 0 was accepted.");
  });

  it("stops core startup before optional features when a representation fails", () => {
    fault.write = "colors";
    const startup = vi.fn();
    expect(() =>
      MnemoCodeSelfTest.core([
        { startup, check: { name: "public fixture", detail: "", run: () => undefined } },
      ]),
    ).toThrow("Direct 12-word colors encoding mismatch.");
    expect(startup).not.toHaveBeenCalled();
  });
});

describe("SSKR quick and feature-first-use checks", () => {
  it("checks transport and topology without a share engine", () => {
    expect(checkSskrTransportStartup).not.toThrow();
  });

  it("checks the real engine's creation, grouped recovery, insufficient quorum and digest refusal", async () => {
    await expect(checkSskrKnownAnswers(nodeSharePlatform)).resolves.toBeUndefined();
  });

  it("fails on a wrong recovery and wipes the host's returned bytes", async () => {
    const wrong = bytesOfHex(sskrVector.entropy);
    wrong[0]! ^= 1;
    await expect(
      checkSskrKnownAnswers({
        ...nodeSharePlatform,
        combineShares: async () => wrong,
      }),
    ).rejects.toThrow("SSKR recovery self-test failed");
    expect(wrong.every((byte) => byte === 0)).toBe(true);
  });

  it("keeps its 32-byte answer equal to the published 24-word set", () => {
    const vector = sskrVectors().deterministic.find((item) => item.name === "bip39-256-2-of-3")!;
    expect(sskrLongVector.entropy).toBe(vector.entropy);
    expect(sskrLongVector.shares).toEqual(vector.shares.slice(0, 2));
  });

  it("fails on a wrong 32-byte recovery after a right 16-byte one, and wipes it", async () => {
    const wrong = bytesOfHex(sskrLongVector.entropy);
    wrong[31]! ^= 1;
    await expect(
      checkSskrKnownAnswers({
        ...nodeSharePlatform,
        combineShares: async (shares) =>
          shares[0] === sskrLongVector.shares[0] ? wrong : nodeSharePlatform.combineShares(shares),
      }),
    ).rejects.toThrow("SSKR 32-byte recovery self-test failed");
    expect(wrong.every((byte) => byte === 0)).toBe(true);
  });

  it("fails on a wrong creation and wipes entropy and seed on that refusal", async () => {
    const owned: Uint8Array[] = [];
    await expect(
      checkSskrKnownAnswers({
        ...nodeSharePlatform,
        createShares: async (secret, _threshold, _count, seed) => {
          owned.push(secret, seed);
          return ["wrong public fixture"];
        },
      }),
    ).rejects.toThrow("SSKR creation known answer mismatch.");
    expect(owned).toHaveLength(2);
    expect(owned.every((array) => array.every((byte) => byte === 0))).toBe(true);
  });

  it("fails on an engine that accepts an insufficient grouped quorum", async () => {
    const accepted: Uint8Array[] = [];
    await expect(
      checkSskrKnownAnswers({
        ...nodeSharePlatform,
        combineShares: async (records) => {
          if (records.length === sskrVector.shares.length - 1) {
            const bytes = bytesOfHex(sskrVector.entropy);
            accepted.push(bytes);
            return bytes;
          }
          return nodeSharePlatform.combineShares(records);
        },
      }),
    ).rejects.toThrow("SSKR engine incomplete quorum was accepted.");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.every((byte) => byte === 0)).toBe(true);
  });

  it("fails on an engine that returns the expected secret despite a damaged share value", async () => {
    await expect(
      checkSskrKnownAnswers({
        ...nodeSharePlatform,
        combineShares: async (records) => {
          const exact = records.every((record, index) => record === sskrVector.shares[index]);
          return records.length === sskrVector.shares.length && !exact
            ? bytesOfHex(sskrVector.entropy)
            : nodeSharePlatform.combineShares(records);
        },
      }),
    ).rejects.toThrow("SSKR engine damaged value was accepted.");
  });

  it("wipes creation inputs when the host throws before returning shares", async () => {
    const owned: Uint8Array[] = [];
    const failure = new Error("public create failure");
    await expect(
      checkSskrKnownAnswers({
        ...nodeSharePlatform,
        createShares: async (secret, _threshold, _count, seed) => {
          owned.push(secret, seed);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(owned).toHaveLength(2);
    expect(owned.every((array) => array.every((byte) => byte === 0))).toBe(true);
  });
});
