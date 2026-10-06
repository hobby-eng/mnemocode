import { afterEach, describe, expect, it, vi } from "vitest";

const input = vi.hoisted(() => ({ widths: [] as number[], keys: [] as string[] }));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-input.js")>()),
  withRawTerminal: async (operation: (next: unknown, more: unknown) => Promise<unknown>) =>
    operation(undefined, undefined),
  readKey: async () => {
    process.stderr.columns = input.widths.shift()!;
    return { kind: input.keys.shift()! };
  },
}));
import { choose, rowsOf } from "../src/cli/terminal-choice.js";

describe("AUD-008-UI001: resizing before a menu key", () => {
  const originalColumns = process.stderr.columns;
  afterEach(() => {
    vi.restoreAllMocks();
    process.stderr.columns = originalColumns;
  });

  it.each([
    [120, 40],
    [40, 120],
  ])("recounts the previous lines after %i-to-%i reflow", async (from, to) => {
    process.stderr.columns = from;
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    input.widths = [to, to];
    input.keys = ["down", "enter"];
    const result = await choose(
      "Choose",
      [
        { label: "The first choice has a long label that spans several terminal rows", value: 1 },
        { label: "The second choice also needs more than forty columns to show", value: 2 },
      ],
      { label: "Choice" },
    );
    expect(result).toBe(2);
    const firstLines = writes[1]!.split("\n").slice(0, -1);
    expect(writes[2]).toBe(`\x1b[${rowsOf(firstLines)}A\r\x1b[J`);
    const nextLines = writes[3]!.split("\n").slice(0, -1);
    expect(writes[4]).toBe(`\x1b[${rowsOf(nextLines) + 1 + rowsOf(["Choose"])}A\r\x1b[J`);
  });
});
