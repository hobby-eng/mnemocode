import { describe, expect, it } from "vitest";
import { SecretValue } from "../src/core/secret-value.js";

describe("A secret value's active working state", () => {
  it("preserves arbitrary signed integers and refuses later reads after disposal", () => {
    const given = [0n, -1n, 9007199254740993n, 340282366920938463463374607431768211455n];
    const value = SecretValue.bigints(given);
    using copy = value.copy();
    const before = value.value;
    given[2] = 1n;
    value.wipe();
    expect(() => value.value).toThrow("has been wiped");
    expect(before).toEqual([0n, -1n, 9007199254740993n, 340282366920938463463374607431768211455n]);
    expect(copy.value).toEqual(before);
    // A number where a bigint belongs, given on purpose as a JavaScript host could.
    expect(() => SecretValue.bigints([1 as never])).toThrow("needs bigint values");
    const sparse: bigint[] = [];
    sparse.length = 1;
    expect(() => SecretValue.bigints(sparse)).toThrow("needs bigint values");
  });

  it("closes all work after wiping its bytes even if one closure fails", () => {
    using value = SecretValue.text("public fixture");
    const failure = new Error("Synthetic cleanup failure.");
    const closed: number[] = [];
    const active = new Set<() => void>([
      () => {
        closed.push(1);
        expect(() => value.value).toThrow("has been wiped");
        expect(active.size).toBe(0);
        throw failure;
      },
      () => {
        closed.push(2);
        value.wipeAndClose(active);
      },
    ]);
    expect(() => value.wipeAndClose(active)).toThrow(failure);
    expect(closed).toEqual([1, 2]);
    value.wipeAndClose(active);
    expect(closed).toEqual([1, 2]);
  });

  it("preserves each failure when more than one closure fails", () => {
    using value = SecretValue.numbers([42]);
    const first = new Error("First synthetic cleanup failure.");
    const second = new Error("Second synthetic cleanup failure.");
    const active = new Set<() => void>([
      () => {
        throw first;
      },
      () => {
        throw second;
      },
    ]);
    let caught: unknown;
    try {
      value.wipeAndClose(active);
    } catch (error) {
      caught = error;
    }
    expect(caught).toHaveProperty("code", "core.secret-value.cleanup");
    if (!(caught instanceof Error))
      throw new Error("Both cleanup failures must be retained as the coded failure's cause.");
    expect(caught.cause).toEqual([first, second]);
    expect(Object.isFrozen(caught.cause)).toBe(true);
    expect(active.size).toBe(0);
  });
});
