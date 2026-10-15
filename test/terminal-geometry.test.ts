import { describe, expect, it } from "vitest";
import {
  answerEndRow,
  displayWidth,
  displayWidthOf,
  placedAfter,
  rowsOfText,
} from "../src/cli/terminal-geometry.js";

describe("Nonspacing marks in terminal geometry", () => {
  it("adds no cells for nonspacing or enclosing marks, including those in a wide range", () => {
    for (const [text, width] of [
      ["e\u0301", 1],
      ["A\u20dd", 1],
      ["\u0301", 0],
      ["的\u0301", 2],
      ["x\u302a", 1],
      ["é", 1],
      // A spacing combining mark is not a nonspacing mark.
      ["क\u093e", 2],
    ] as const) {
      const bytes = Buffer.from(text);
      expect(displayWidth(text)).toBe(width);
      expect(displayWidthOf(bytes, 0, bytes.length)).toBe(width);
      expect(placedAfter(bytes, 0, bytes.length, 0, 80)).toBe(width);
    }
  });

  it("keeps a mark with its base at the right edge without adding a row", () => {
    const bytes = Buffer.from("e\u0301");
    expect(placedAfter(bytes, 0, bytes.length, 4, 5)).toBe(5);
    expect(rowsOfText("abcde\u0301", 5)).toBe(1);
    expect(answerEndRow(4, "e\u0301", 5)).toBe(1);
    expect(rowsOfText("abcd的\u0301", 5)).toBe(2);
  });

  it("keeps walking a malformed four-byte sequence without converting it to a Unicode scalar", () => {
    const bytes = Buffer.from([0xf4, 0xbf, 0xbf, 0xbf, 0x61]);
    expect(displayWidthOf(bytes, 0, bytes.length)).toBe(2);
    expect(placedAfter(bytes, 0, bytes.length, 0, 80)).toBe(2);
  });
});
