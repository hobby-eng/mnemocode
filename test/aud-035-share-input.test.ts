import { describe, expect, it } from "vitest";
import { ShareInput } from "../src/sskr/share-input.js";
import { ShareCombineRefusalError } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { wrongValue } from "./helpers/shares.js";
import { sskrVectors } from "./helpers/vectors.js";

const SHARES = SSKR_SET_VECTOR.shares;

describe("complete input diagnosis keeps host failures distinct (AUD-033-API003)", () => {
  it.each(["selective", "total", "omission"] as const)(
    "propagates the same operational failure during %s restoration",
    async (mode) => {
      using input = new ShareInput({ decodeEntry: "The Decode tab" });
      input.add(SHARES);
      const fault = Object.assign(new Error("Synthetic host unavailable."), {
        code: "sskr.runtime.unavailable",
      });
      let calls = 0;
      const combineShares = async (records: readonly string[]): Promise<Uint8Array> => {
        calls += 1;
        if (mode === "omission" && calls === 1) throw new ShareCombineRefusalError();
        if (mode !== "selective" || records.includes(SHARES[0]!)) throw fault;
        return nodeSharePlatform.combineShares(records);
      };
      await expect(input.restoreComplete({ combineShares })).rejects.toBe(fault);
      expect(calls).toBe(mode === "omission" ? 2 : 1);
      expect(input.texts()).toEqual(SHARES);
    },
  );

  it("propagates an uncoded operational Error without interpreting its text", async () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add(SHARES);
    const fault = new Error("The SSKR shares do not restore a secret.");
    await expect(
      input.restoreComplete({
        combineShares: async () => {
          throw fault;
        },
      }),
    ).rejects.toBe(fault);
  });

  it("keeps a declared invalid-quorum refusal as a share-trouble result", async () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add(SHARES);
    let calls = 0;
    const result = await input.restoreComplete({
      combineShares: async () => {
        calls += 1;
        throw new ShareCombineRefusalError();
      },
    });
    expect(result).toMatchObject({ outcome: { kind: "trouble", trouble: { kind: "refused" } } });
    expect(calls).toBe(4);
  });

  it("still identifies a genuinely damaged share instead of hiding its input refusal", async () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add([wrongValue(SHARES[0]!), ...SHARES.slice(1)]);
    const result = await input.restoreComplete(nodeSharePlatform);
    expect(result).toMatchObject({
      outcome: { kind: "trouble", trouble: { kind: "odd", place: 1 } },
    });
  });

  it("keeps a declared refusal of a minimum quorum as trouble without trying insufficient subsets", async () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add(SHARES.slice(0, 2));
    let calls = 0;
    const result = await input.restoreComplete({
      combineShares: async () => {
        calls += 1;
        throw new ShareCombineRefusalError();
      },
    });
    expect(result).toMatchObject({ outcome: { kind: "trouble", trouble: { kind: "refused" } } });
    expect(calls).toBe(1);
  });

  it("reports a genuinely damaged minimum quorum through the actual native engine", async () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add([wrongValue(SHARES[0]!), SHARES[1]!]);
    const result = await input.restoreComplete(nodeSharePlatform);
    expect(result).toMatchObject({ outcome: { kind: "trouble", trouble: { kind: "refused" } } });
  });

  it.each([false, true])(
    "keeps an insufficient multi-group diagnostic subset as trouble with native engine %s",
    async (native) => {
      const vector = sskrVectors().official;
      const records = vector.validQuorums[0]!.map((index) => vector.shares[index]!);
      using input = new ShareInput({ decodeEntry: "The Decode tab" });
      input.add([wrongValue(records[0]!), ...records.slice(1)]);
      let calls = 0;
      const result = await input.restoreComplete({
        combineShares: async (quorum) => {
          calls += 1;
          if (native) return nodeSharePlatform.combineShares(quorum);
          throw new ShareCombineRefusalError();
        },
      });
      expect(result).toMatchObject({ outcome: { kind: "trouble", trouble: { kind: "refused" } } });
      expect(calls).toBe(1);
    },
  );

  it("does not try an empty diagnostic subset after a one-of-one refusal", async () => {
    const entropy = new Uint8Array(16).fill(0x24);
    const seed = new Uint8Array(32).fill(0x24);
    try {
      const records = await nodeSharePlatform.createShares(entropy, 1, 1, seed);
      using input = new ShareInput({ decodeEntry: "The Decode tab" });
      input.add(records);
      let calls = 0;
      const result = await input.restoreComplete({
        combineShares: async () => {
          calls += 1;
          throw new ShareCombineRefusalError();
        },
      });
      expect(result).toMatchObject({ outcome: { kind: "trouble", trouble: { kind: "refused" } } });
      expect(calls).toBe(1);
    } finally {
      entropy.fill(0);
      seed.fill(0);
    }
  });
});
