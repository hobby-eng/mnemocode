// The refusal checks of every self-test (src/core/self-test-check.ts): a case passes only when it
// is refused for the reason given, a pattern that the message matches or the whole message as
// text, word for word; a case accepted, or refused for another reason, fails with its own code.
import { describe, expect, it } from "vitest";
import { expectRefused, expectRefusedLater } from "../src/core/self-test-check.js";

const MESSAGE = "These codes and dates give no seed phrase with a valid checksum.";

function refuse(): never {
  throw new Error(MESSAGE);
}

/** The refusal of a self-test case with `code` of core.self-test-check. */
function failure(code: string): unknown {
  return expect.objectContaining({ code: `core.self-test-check.${code}` });
}

describe("a case that must be refused", () => {
  it("passes for its whole message as text, or a pattern that the message matches", async () => {
    expect(() => expectRefused(refuse, MESSAGE, "Case")).not.toThrow();
    expect(() => expectRefused(refuse, /valid checksum/u, "Case")).not.toThrow();
    await expect(expectRefusedLater(async () => refuse(), MESSAGE, "Case")).resolves.toBe(
      undefined,
    );
  });

  it("fails when text is only a part of the message: the text must be all of it", async () => {
    for (const part of [MESSAGE.slice(0, 40), MESSAGE.slice(1), `${MESSAGE} `]) {
      expect(() => expectRefused(refuse, part, "Case")).toThrow(
        failure("was-refused-another-reason"),
      );
      await expect(expectRefusedLater(async () => refuse(), part, "Case")).rejects.toThrow(
        failure("was-refused-another-reason"),
      );
    }
  });

  it("fails when it is accepted", async () => {
    expect(() => expectRefused(() => undefined, MESSAGE, "Case")).toThrow(failure("was-accepted"));
    await expect(expectRefusedLater(async () => undefined, MESSAGE, "Case")).rejects.toThrow(
      failure("was-accepted"),
    );
  });
});
