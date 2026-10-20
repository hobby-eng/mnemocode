import { afterEach, describe, expect, it, vi } from "vitest";
import type { Key } from "../src/cli/terminal-input.js";
import type { MoreWithin, NextByte } from "../src/cli/terminal-keys.js";

/** A key that is no digit, as the tests queue them by kind. */
type KindOfKey = Exclude<Key, { kind: "digit" }>["kind"];

// The keys of a list are read from this queue; the terminal itself is not touched.
const input = vi.hoisted((): { keys: KindOfKey[] } => ({ keys: [] }));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  class ListedKeys extends actual.TerminalKeys {
    // readKey below answers without reading the terminal.
    static override async withRawMode<T>(
      operation: (next: NextByte, more: MoreWithin) => Promise<T>,
    ): Promise<T> {
      return operation(
        async () => undefined,
        async () => false,
      );
    }

    static override async readKey(): Promise<Key> {
      return { kind: input.keys.shift()! };
    }
  }
  return { ...actual, TerminalKeys: ListedKeys };
});
import { choose } from "../src/cli/terminal-choice.js";

/** The hint below a list of entries with `digits`, as it is written to the screen. */
async function hintOf(digits: readonly (number | null)[]): Promise<string> {
  const writes: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  input.keys = ["enter"];
  await choose(
    "Choose",
    digits.map((digit, value) => ({ label: `Entry ${value}`, digit, value })),
    { label: "Choice" },
  );
  return writes.join("");
}

describe("AUD-022 observation: the menu hint names the digits that the list has", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names a range where every digit between is there", async () => {
    expect(await hintOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, null])).toContain("0 to 9 at once");
    expect(await hintOf([1, 2, 3])).toContain("1 to 3 at once");
  });

  it("names each digit where entries are left out, as without the secret entries", async () => {
    const hint = await hintOf([7, 8, 9, 0, null]);
    expect(hint).toContain("7, 8, 9 or 0 at once");
    expect(hint).not.toContain("0 to 9");
  });
});
