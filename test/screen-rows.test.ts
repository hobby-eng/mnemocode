import { describe, expect, it } from "vitest";
import { screenRows } from "../src/cli/screen-rows.js";

// What a terminal shows after what MnemoCode writes on the private screen (screen-rows.ts), the
// model that the private page reads its record with.

describe("the rows that a terminal shows", () => {
  it("wraps text at the right edge, and a line as wide as the screen takes one row", () => {
    expect(screenRows("abcdefgh\nxy\n", 4)).toEqual({
      rows: ["abcd", "efgh", "xy", ""],
      cursorRow: 3,
    });
    // A wide character that does not fit in the last column goes whole to the next row.
    expect(screenRows("abc的\n", 4).rows).toEqual(["abc", "的", ""]);
  });

  it("follows carriage returns, cursor moves and erases, as a question replaced by its answer", () => {
    const question = "Result\n\nUse Seedshift?\n› 1  Yes\n  2  No\n\nhint\n";
    // choose erases its question from the blank line above it and writes the answer there.
    const answered = `${question}\x1b[6A\r\x1b[JSeedshift  No\n`;
    expect(screenRows(answered, 40)).toEqual({
      rows: ["Result", "Seedshift  No", ""],
      cursorRow: 2,
    });
    expect(screenRows("Searching 10%\r\x1b[2KSearching 20%\n", 40).rows).toEqual([
      "Searching 20%",
      "",
    ]);
    expect(screenRows("abcdef\x1b[3D\x1b[K\n", 40).rows[0]).toBe("abc");
  });

  it("keeps the colours each character was drawn with", () => {
    const { rows } = screenRows("\x1b[1mMnemoCode\x1b[0m · \x1b[90mshare\x1b[0m\n", 40);
    expect(rows[0]).toBe("\x1b[1mMnemoCode\x1b[0m · \x1b[90mshare\x1b[0m");
  });

  it("passes over a screen switch, and tabs and marks take their columns", () => {
    expect(screenRows("\x1b[?1049h\x1b[?25lab\tc\n", 40).rows[0]).toBe("ab      c");
    expect(screenRows("éx\n", 40).rows[0]).toBe("éx");
  });
});
