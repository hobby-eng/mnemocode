import { describe, expect, it } from "vitest";
import { encodeMnemonic, parseInput, parseDate } from "../src/core.js";
import { DATE, replacedAt, TEST_PHRASE } from "./helpers/test-phrase.js";

describe("Errors identify the position without echoing unrecognized input", () => {
  it.each(["private-user-token", "\u001b[31msecret", "very-personal@example.com"])(
    "does not disclose an invalid mnemonic token %#",
    (token) => {
      let message = "";
      try {
        encodeMnemonic(replacedAt(TEST_PHRASE, { 3: token }), [parseDate(DATE)]);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        message = error.message;
      }
      expect(message).toContain("position 3");
      expect(message).not.toContain(token);
      expect(message).not.toContain("\u001b");
    },
  );

  it("does not echo an unmapped Unicode value", () => {
    // The one message of a Unicode code that names no word (S011): its place, never its value.
    expect(() => parseInput("DEAD", "unicode")).toThrow("Unicode code 1 is not a BIP39 word.");
    try {
      parseInput("DEAD", "unicode");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error.message).not.toContain("DEAD");
    }
  });
});
