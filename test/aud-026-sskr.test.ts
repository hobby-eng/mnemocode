import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as raw from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { CheckedSskrBridge } from "../src/sskr/bridge.js";
import { JointRepair } from "../src/sskr/joint-repair.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareRestore } from "../src/sskr/share-restore.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { writeShare } from "../src/sskr/transport.js";

describe("AUD-026 SSKR preprocessing and final cancellation", () => {
  it("assesses broad partial Color Unicode without expanding its Cartesian product", async () => {
    const codes = writeShare(sskrSetVector.shares[0]!, "colors-unicode")
      .replaceAll(" ", "")
      .match(/.{4}/gu)!;
    codes[8] = "E???";
    codes[9] = "E???";
    const plan = await new JointRepair(nodeSharePlatform).plan([
      codes.join(" "),
      sskrSetVector.shares[1]!,
    ]);
    try {
      expect(plan.assessment.verdict).toBe("determined");
      const searched = await plan.search();
      expect(searched.stopped).toBe(false);
      expect(searched.sets).toHaveLength(1);
      // Public BIP39 counting-entropy vector, independent of the share writer.
      expect(searched.sets[0]!.mnemonic).toBe(
        "abandon amount liar amount expire adjust cage candy arch gather drum buyer",
      );
    } finally {
      plan.wipe();
    }
  });

  it.each([false, true])(
    "observes cancellation in the last progress callback (%s)",
    async (abort) => {
      const colors = writeShare(sskrSetVector.shares[1]!, "colors").trim().split(/\s+/u);
      colors[5] = "?";
      const input = new ShareInput({ decodeEntry: "Decode" });
      input.add([sskrSetVector.shares[0]!, colors.join(" ")]);
      const restore = new ShareRestore(nodeSharePlatform);
      const marked = await restore.read(input);
      expect(marked.kind).toBe("marked");
      if (marked.kind !== "marked") return;
      const controller = new AbortController();
      let final = 0;
      const searched = await restore.search(marked, {
        signal: controller.signal,
        onProgress(progress) {
          if (progress.checked === progress.total) {
            final++;
            if (abort) controller.abort();
          }
        },
      });
      expect(final).toBe(1);
      expect(searched.kind).toBe(abort ? "stopped" : "sets");
    },
  );
});

describe("AUD-026 SSKR bridge admission and coded refusals", () => {
  it.each([
    [258, 259],
    [-254, 259],
    [2.5, 3],
    [2, 3.5],
    [NaN, 3],
  ])("refuses a member quorum before byte conversion (%s of %s)", async (threshold, count) => {
    const secret = new Uint8Array(16),
      seed = new Uint8Array(32);
    await expect(
      nodeSharePlatform.createShares(secret, threshold, count, seed),
    ).rejects.toMatchObject({ code: "sskr.bridge.member-quorum" });
  });
  const initialized = raw.initSync({
    module: readFileSync("sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"),
  });
  const bridge = new CheckedSskrBridge(raw);
  const occurrences = (pattern: Uint8Array) => {
    const bytes = new Uint8Array(initialized.memory.buffer);
    let count = 0;
    for (let start = 0; start <= bytes.length - pattern.length; start++)
      if (pattern.every((byte, offset) => byte === bytes[start + offset])) count++;
    return count;
  };

  it.each(["groups", "seed"])("rejects malformed %s before copying the secret to WASM", (field) => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => 0x71 + index);
    const before = occurrences(secret);
    expect(() =>
      bridge.create_sskr_shares(
        secret,
        1,
        field === "groups" ? (null as never) : Uint8Array.of(2, 3),
        field === "seed" ? (null as never) : new Uint8Array(32),
      ),
    ).toThrow(TypeError);
    expect(occurrences(secret)).toBe(before);
    expect([...secret]).toEqual(Array.from({ length: 32 }, (_, index) => 0x71 + index));
    secret.fill(0);
  });

  it.each([31, 33])("returns a stable owned error for %i seed bytes", async (length) => {
    const secret = new Uint8Array(16).fill(0x42);
    await expect(
      nodeSharePlatform.createShares(secret, 2, 3, new Uint8Array(length)),
    ).rejects.toMatchObject({
      name: "Error",
      code: "sskr.engine.randomness",
      message: "SSKR requires exactly 32 bytes of fresh randomness.",
    });
    expect(secret.every((byte) => byte === 0x42)).toBe(true);
    secret.fill(0);
  });

  it("owns intrinsic copies and refuses undefined encoding or detached arrays", () => {
    const secret = new Uint8Array(16).fill(0x42);
    const seed = new Uint8Array(32).fill(5);
    Object.defineProperty(secret, "length", {
      get: () => {
        throw Error("own length getter");
      },
    });
    expect(
      bridge.create_sskr_shares(secret, 1, Uint8Array.of(2, 3), seed).split("\n"),
    ).toHaveLength(3);
    expect(seed.every((byte) => byte === 5)).toBe(true);
    expect(() =>
      bridge.create_sskr_shares_formatted(secret, 1, Uint8Array.of(2, 3), seed, undefined as never),
    ).toThrow("Unsupported SSKR share encoding.");
    const detached = new Uint8Array(32);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => bridge.create_sskr_shares(secret, 1, Uint8Array.of(2, 3), detached)).toThrow(
      TypeError,
    );
    secret.fill(0);
    seed.fill(0);
  });
});
