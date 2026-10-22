import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLines, listQuestionRows, type Choice } from "../src/cli/terminal-choice.js";
import { drawnList } from "./helpers/drawn-list.js";

beforeEach(() => vi.stubEnv("NO_COLOR", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("spacing of terminal choices", () => {
  it.each([0, 1, 2])(
    "reserves the example row for every entry when entry %i has an example",
    (exampleAt) => {
      const choices: Choice<number>[] = ["One", "Two", "Three"].map((label, index) => ({
        label,
        note: "note",
        ...(index === exampleAt ? { example: "sample" } : {}),
        value: index,
      }));
      expect(listLines(choices, 1)).toEqual([
        "  1  One    note",
        exampleAt === 0 ? "            sample" : "",
        "› 2  Two    note",
        exampleAt === 1 ? "            sample" : "",
        "  3  Three  note",
        exampleAt === 2 ? "            sample" : "",
      ]);
      expect(listQuestionRows("Choose", choices)).toBe(11);
    },
  );

  it("keeps lists without examples compact", () => {
    expect(
      listLines(
        [
          { label: "One", value: 1 },
          { label: "Two", value: 2 },
        ],
        0,
      ),
    ).toEqual(["› 1  One", "  2  Two"]);
    expect(listLines([], 0)).toEqual([]);
  });

  it("reads every entry across empty example rows without losing its example or selection", () => {
    const list = drawnList(
      [
        "",
        "Choose",
        "  1  One    first",
        "",
        "› 2  Two    second",
        "            sample",
        "  3  Three  third",
        "",
        "",
        "↑ ↓ choose · Enter selects · 1 to 3 at once · Esc goes back",
        "",
      ].join("\n"),
    );
    expect(list).toEqual({
      question: "Choose",
      entries: [
        { label: "One", note: "first", example: undefined, digit: 1 },
        { label: "Two", note: "second", example: "sample", digit: 2 },
        { label: "Three", note: "third", example: undefined, digit: 3 },
      ],
      selected: 1,
      escape: "goes back",
    });
  });
});
