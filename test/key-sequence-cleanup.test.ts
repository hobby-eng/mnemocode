import { describe, expect, it, vi } from "vitest";
import * as sequences from "../src/cli/key-sequences.js";
import { readLine } from "../src/cli/terminal-input.js";
import { ESCAPE_DELAY_MS } from "../src/cli/terminal-keys.js";

describe("Temporary key-sequence owners", () => {
  it.each([
    { name: "a full answer", limit: 1, writerFails: false },
    { name: "a failed terminal writer", limit: 64, writerFails: true },
    { name: "normal replay", limit: 64, writerFails: false },
  ])("guards transferred late replay after $name", async ({ limit, writerFails }) => {
    const source = Object.freeze([0x61, 0x1b, 0x5b, 0x31, 0x20]);
    let index = 0;
    const reader = vi.spyOn(sequences, "readLateSequence");
    const fault = Object.assign(new Error("Synthetic terminal output failure."), { code: "EIO" });
    const writer = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      if (writerFails && chunk instanceof Uint8Array && chunk.length === 1 && chunk[0] === 0x5b)
        throw fault;
      return true;
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    let transferred: number[] | undefined;
    try {
      const pending = readLine(async () => source[index++], {
        echo: true,
        limit,
        moreWithin: async (milliseconds) =>
          !(index === 2 && milliseconds === ESCAPE_DELAY_MS) && index < source.length,
      });
      if (writerFails) await expect(pending).rejects.toBe(fault);
      else if (limit === 1)
        await expect(pending).rejects.toMatchObject({ code: "answer-too-long" });
      else await expect(pending).resolves.toBe("a[1 ");
      expect(reader).toHaveBeenCalledTimes(1);
      const observed = reader.mock.results[0];
      if (observed?.type !== "return") throw new Error("The real parser must return its promise.");
      const actual = await observed.value;
      if (actual === undefined || !("readAgain" in actual))
        throw new Error("The public key sequence must return actual late replay.");
      transferred = actual.readAgain;
      expect(transferred).toEqual([0, 0]);
      expect(source).toEqual([0x61, 0x1b, 0x5b, 0x31, 0x20]);
    } finally {
      transferred?.fill(0);
      reader.mockRestore();
      writer.mockRestore();
      clock.mockRestore();
    }
  });

  it.each([false, true])(
    "propagates a failed byte reader after a partial sequence: late %s",
    async (late) => {
      const fault = new Error("Synthetic terminal reader failure.");
      const bytes = late ? [0x31] : [0x5b, 0x31];
      let index = 0;
      const next = async () => {
        if (index === bytes.length) throw fault;
        return bytes[index++];
      };
      const pending = late
        ? sequences.readLateSequence(0x5b, next, async () => true)
        : sequences.readEscapeSequence(next, async () => true);
      await expect(pending).rejects.toBe(fault);
    },
  );

  it("transfers an incomplete sequence as an independent replay array", async () => {
    const bytes = [0x5b, 0x31, 0x03];
    let index = 0;
    const result = await sequences.readEscapeSequence(
      async () => bytes[index++],
      async () => true,
    );
    expect(result).toEqual({ kind: "none", readAgain: [0x31, 0x03] });
    if (result.kind !== "none") throw new Error("The public control needs replay bytes.");
    result.readAgain.fill(0);
    expect(bytes).toEqual([0x5b, 0x31, 0x03]);
  });
});
