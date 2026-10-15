import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { InputBytes } from "../src/cli/input-bytes.js";

describe("Owned terminal input bytes", () => {
  it("preserves a prefix spanning several blocks before an existing tail", () => {
    using queue = new InputBytes();
    queue.push(255);
    const prefix = Array.from({ length: 8359 }, (_, index) => index % 127);
    queue.prepend(prefix);
    for (const byte of prefix) expect(queue.shift()).toBe(byte);
    expect(queue.shift()).toBe(255);
    expect(queue.length).toBe(0);
  });

  it("reads each borrowed prefix octet once before inserting it", () => {
    using queue = new InputBytes();
    let reads = 0;
    const prefix = [17];
    Object.defineProperty(prefix, 0, { get: () => (++reads === 1 ? 17 : 256) });
    queue.prepend(prefix);
    expect(reads).toBe(1);
    expect(queue.shift()).toBe(17);
  });

  it("preserves a long paste across block boundaries and prefixed UTF-8 replay", () => {
    using queue = new InputBytes();
    const paste = Uint8Array.from({ length: 12301 }, (_, index) => index % 256);
    for (const byte of paste) queue.push(byte);
    for (let index = 0; index < 4137; index += 1) expect(queue.shift()).toBe(paste[index]);
    const replay = Object.freeze([0xe2, 0x82, 0xac, 3]);
    queue.prepend(replay);
    expect(queue.includes(3)).toBe(true);
    expect(replay.map(() => queue.shift())).toEqual(replay);
    expect(queue.length).toBe(paste.length - 4137);
    for (let index = 4137; index < paste.length; index += 1)
      expect(queue.shift()).toBe(paste[index]);
    expect(queue.length).toBe(0);
    expect(queue.shift()).toBeUndefined();
    expect(queue.includes(3)).toBe(false);
  });

  it("empties pending bytes on repeated cleanup and accepts the next question's bytes", () => {
    const queue = new InputBytes();
    {
      using lifetime = queue;
      lifetime.prepend([97, 98, 99]);
      expect(inspect(lifetime)).not.toContain("97");
      expect(JSON.stringify(lifetime)).not.toContain("97");
    }
    expect(queue.length).toBe(0);
    expect(queue.shift()).toBeUndefined();
    queue.wipe();
    queue.push(42);
    queue.prepend([17, 18]);
    expect([queue.shift(), queue.shift(), queue.shift()]).toEqual([17, 18, 42]);
    queue.wipe();
  });

  it.each([-1, 256, 1.5, NaN, Infinity])(
    "refuses invalid octet %s without a partial prefix",
    (byte) => {
      using queue = new InputBytes();
      queue.push(42);
      expect(() => queue.prepend([17, byte, 18])).toThrow(
        expect.objectContaining({ code: "cli.input-bytes.byte" }),
      );
      expect(() => queue.push(byte)).toThrow(TypeError);
      expect(queue.length).toBe(1);
      expect(queue.shift()).toBe(42);
    },
  );
});
