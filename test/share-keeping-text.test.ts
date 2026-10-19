import { describe, expect, it } from "vitest";
import { shareKeepingNote } from "../src/export/sskr-keeping-text.js";
import { sskrSetVector, sskrVector } from "../src/sskr/known-answers.js";
import { PHRASE_WORDS } from "../src/core/masking.js";
import { defined } from "../src/core/defined.js";

describe("Keeping distinct SSKR members", () => {
  const [first, second, third] = sskrSetVector.shares;

  it("counts two prints of one member as fewer shares than the threshold", () => {
    expect(shareKeepingNote([first, first], "files", false)).toBe(
      "These shares are fewer than the 2 needed for recovery; repeated copies count as one share; each file is one share. Store the shares apart.",
    );
  });

  it("never says any pair of printed files works when a member was printed twice", () => {
    expect(shareKeepingNote([first, second, second], "files", false)).toBe(
      "All 2 distinct shares are needed for recovery; repeated copies count as one share; each file is one share. Store the shares apart.",
    );
    expect(shareKeepingNote([first, second, third, third], "folders", false)).toBe(
      "Any 2 of the 3 distinct shares are enough for recovery; repeated copies count as one share; each folder is one share and needs all its cards. Store the shares apart.",
    );
  });

  it("preserves the ordinary distinct-member, masked-goal and multiple-group guidance", () => {
    expect(shareKeepingNote([first, second], "files", false)).toBe(
      "All 2 shares are needed for recovery; each file is one share. Store the shares apart.",
    );
    expect(shareKeepingNote([first, first], "pages", true)).toContain(
      `fewer than the 2 needed to restore ${PHRASE_WORDS.masked}`,
    );
    expect(shareKeepingNote(sskrVector.shares, "file", false)).toBe(
      "These shares belong to 2 groups, each needing enough of its own for recovery; the file holds every share. Store the shares apart.",
    );
  });

  it("refuses shares of different sets and a packaging it does not name (AUD-037-API007)", () => {
    expect(() => shareKeepingNote([first, defined(sskrVector.shares[0])], "files", false)).toThrow(
      expect.objectContaining({ code: "export.sskr-keeping-text.shares-not-one-set" }),
    );
    expect(() => shareKeepingNote([first, second], "boxes" as never, false)).toThrow(
      expect.objectContaining({ code: "export.sskr-keeping-text.packaging-unknown" }),
    );
  });
});
