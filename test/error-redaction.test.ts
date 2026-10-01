import { describe, expect, it } from "vitest";
import { encodeMnemonic, parseInput, parseDate } from "../src/core.js";

describe("Errors identify the position without echoing unrecognized input", () => {
  it.each(["private-user-token", "\u001b[31msecret", "very-personal@example.com"])(
    "does not disclose an invalid mnemonic token %#",
    (token) => {
      let message = "";
      try {
        encodeMnemonic(`abandon abandon ${token} ${"abandon ".repeat(8)}about`, [
          parseDate("23-09-2026"),
        ]);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("position 3");
      expect(message).not.toContain(token);
      expect(message).not.toContain("\u001b");
    },
  );

  it("does not echo an unmapped Unicode value", () => {
    expect(() => parseInput("DEAD", "unicode")).toThrow("Unicode code point at position 1");
    try {
      parseInput("DEAD", "unicode");
    } catch (error) {
      expect((error as Error).message).not.toContain("DEAD");
    }
  });
});
