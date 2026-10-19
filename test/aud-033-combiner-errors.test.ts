import { describe, expect, it } from "vitest";
import { ShareSet } from "../src/sskr/share-set.js";
import { JointRepair, searchOnce } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { sskrVectors } from "./helpers/vectors.js";
import { markUnits } from "./helpers/shares.js";
import { ShareCombineRefusalError } from "../src/sskr/share-platform.js";
import { ErrorCatalog } from "../src/core/error-catalog.js";

const SHARES = sskrVectors().deterministic[0]!.shares;

describe("expected SSKR refusals versus operational host failures", () => {
  it("matches selected catalog codes with one read and no message-based fallback", () => {
    const catalog = new ErrorCatalog("fixture", {
      absent: () => "No fixture matched.",
      failed: () => "The fixture host failed.",
    });
    let reads = 0;
    const outside = new Error("The same text cannot turn a failure into a result.");
    Object.defineProperty(outside, "code", {
      get: () => {
        reads += 1;
        return "fixture.absent";
      },
    });
    expect(catalog.matches(outside, ["absent", "failed"])).toBe(true);
    expect(reads).toBe(1);
    expect(catalog.matches(new Error("No fixture matched."), ["absent"])).toBe(false);
    expect(catalog.matches({ code: "fixture.absent" }, ["absent"])).toBe(false);
    const inherited = Object.assign(new Error("Synthetic inherited code."), {
      code: "fixture.constructor",
    });
    const matched: unknown = Reflect.apply(catalog.matches.bind(catalog), catalog, [
      inherited,
      ["constructor"],
    ]);
    expect(matched).toBe(false);
    expect(ShareCombineRefusalError.is(new ShareCombineRefusalError())).toBe(true);
    expect(ShareCombineRefusalError.is(new Error("The SSKR shares do not restore a secret."))).toBe(
      false,
    );
  });

  it.each([undefined, "sskr.runtime.unavailable"])(
    "propagates an operational engine failure with code %s instead of blaming valid shares",
    async (code) => {
      const fault = new Error("Synthetic engine unavailable.");
      if (code !== undefined) Object.assign(fault, { code });
      await expect(
        ShareSet.restore(SHARES.slice(0, 2), {
          combineShares: async () => {
            throw fault;
          },
        }),
      ).rejects.toBe(fault);
    },
  );

  it("keeps a declared engine combination refusal as an invalid-quorum outcome", async () => {
    const refusal = Object.assign(new Error("Synthetic invalid quorum."), {
      code: "sskr.engine.combine",
    });
    await expect(
      ShareSet.restore(SHARES.slice(0, 2), {
        combineShares: async () => {
          throw refusal;
        },
      }),
    ).rejects.toHaveProperty("code", "sskr.complete-shares.no-secret");
  });

  it("propagates a failed surplus check and still overwrites already restored entropy", async () => {
    const fault = new Error("Synthetic surplus host failure.");
    let entropy: Uint8Array | undefined;
    let calls = 0;
    const result = await ShareSet.restore(SHARES, {
      combineShares: async (records) => {
        calls += 1;
        if (calls > 1) throw fault;
        entropy = await nodeSharePlatform.combineShares(records);
        return entropy;
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(calls).toBe(2);
    expect(entropy?.every((byte) => byte === 0)).toBe(true);
    expect(result).toBe(fault);
  });

  it("does not turn a joint confirmation's operational failure into an absent candidate", async () => {
    const fault = new Error("Synthetic joint engine failure.");
    const repair = new JointRepair({
      ...nodeSharePlatform,
      combineShares: async () => {
        throw fault;
      },
    });
    const plan = await repair.plan([SHARES[0]!, markUnits(SHARES[1]!, "colors", [5])]);
    await expect(searchOnce(plan)).rejects.toBe(fault);
  });
});
