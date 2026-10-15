import { describe, expect, it, vi } from "vitest";
import { ShareRestore } from "../src/sskr/share-restore.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { TypedAnswer } from "../src/cli/typed-answer.js";
import { WordList } from "../src/core/word-hints.js";

describe("Exceptional secret-owner cleanup", () => {
  it.each([true, false])(
    "ends the real marked plan when host limits refuse: %s",
    async (refuses) => {
      using input = new ShareInput({ decodeEntry: "The public fixture decoder" });
      input.add([sskrSetVector.colors[0]!.replace("#37B8CA", "?"), sskrSetVector.colors[1]!]);
      const entered = input.texts();
      const restore = new ShareRestore(nodeSharePlatform);
      // Observation only: the original public read operation and its real plan run unchanged.
      const read = vi.spyOn(restore, "read");
      const fault = new Error("Synthetic host limit failure.");
      let reads = 0;
      try {
        const pending = restore.restore({
          input,
          mode: "direct",
          confirmed: true,
          limits: {
            get shares() {
              reads += 1;
              if (refuses) throw fault;
              return Number.MAX_SAFE_INTEGER;
            },
          },
        });
        if (refuses) await expect(pending).rejects.toBe(fault);
        else
          await expect(pending).resolves.toMatchObject({
            kind: "phrases",
            phrases: [{ mnemonic: sskrSetVector.phrase }],
          });
        expect(input.texts()).toEqual(entered);
        expect(reads).toBeGreaterThan(0);
        expect(read).toHaveBeenCalledTimes(1);
        const observed = read.mock.results[0];
        if (observed?.type !== "return") throw new Error("The real read must return its promise.");
        const result = await observed.value;
        expect(result?.kind).toBe("marked");
        if (result?.kind !== "marked") throw new Error("The public fixture needs a marked plan.");
        try {
          await expect(result.plan.search()).rejects.toMatchObject({
            code: "sskr.joint-repair.plan-wiped",
          });
        } finally {
          result.plan.wipe();
        }
        if (refuses) {
          await expect(
            restore.restore({ input, mode: "direct", confirmed: true }),
          ).resolves.toMatchObject({
            kind: "phrases",
            phrases: [{ mnemonic: sskrSetVector.phrase }],
          });
          expect(input.texts()).toEqual(entered);
          const observedRetry = read.mock.results[1];
          if (observedRetry?.type !== "return")
            throw new Error("The real retry must return its promise.");
          const retry = await observedRetry.value;
          if (retry?.kind !== "marked")
            throw new Error("The retry must assess the same marked input.");
          try {
            await expect(retry.plan.search()).rejects.toMatchObject({
              code: "sskr.joint-repair.plan-wiped",
            });
          } finally {
            retry.plan.wipe();
          }
        }
      } finally {
        read.mockRestore();
      }
    },
  );

  it.each([true, false])(
    "erases an answer when hint cleanup output refuses: %s",
    async (refuses) => {
      const columns = Object.getOwnPropertyDescriptor(process.stderr, "columns");
      Object.defineProperty(process.stderr, "columns", { configurable: true, value: 80 });
      const fault = new Error("Synthetic terminal writer failure.");
      let failing = false;
      const writer = vi.spyOn(process.stderr, "write").mockImplementation(() => {
        if (failing) throw fault;
        return true;
      });
      const answer = new TypedAnswer(64, true, 0, WordList.BIP39);
      try {
        answer.insert(0x61);
        await answer.hintWhen(async () => true);
        const before = writer.mock.calls.length;
        failing = refuses;
        if (refuses) expect(() => answer.wipe()).toThrow(fault);
        else answer.wipe();
        expect(writer.mock.calls.length).toBeGreaterThan(before);
        expect(answer.text()).not.toContain("a");
      } finally {
        failing = false;
        answer.wipe();
        writer.mockRestore();
        if (columns === undefined) Reflect.deleteProperty(process.stderr, "columns");
        else Object.defineProperty(process.stderr, "columns", columns);
      }
    },
  );
});
