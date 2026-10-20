// One refusal condition, one code (AUD-037-API009): a host chooses its own words from the code
// alone, so that two conditions never share one. Public test data only.

import { describe, expect, it } from "vitest";
import { addressCount } from "../src/core/address-scan.js";
import { parseColors } from "../src/core/colors.js";
import { errorCode } from "../src/core/refusal.js";
import { sskrSetVector, sskrVector } from "../src/sskr/known-answers.js";
import { Share } from "../src/sskr/transport.js";
import { wrongValue } from "./helpers/shares.js";

/** The code of what `run` throws. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return errorCode(error);
  }
  return undefined;
}

describe("the codes of refusals", () => {
  it("tell a wrong first index from a wrong number of addresses", () => {
    expect(codeOf(() => addressCount(1, -1))).toBe("core.address-scan.first-index-refused");
    expect(codeOf(() => addressCount(0, 0))).toBe("core.address-scan.address-count-refused");
  });

  it("tell colours with # from colours run together", () => {
    expect(codeOf(() => parseColors("#12345 #000000"))).toBe("core.colors.hashed-colors-refused");
    expect(codeOf(() => parseColors("12345"))).toBe("core.colors.joined-colors-refused");
  });

  it("give each kind of set conflict its own code", () => {
    const [first, second] = sskrSetVector.shares;
    expect(codeOf(() => Share.readSet([first, sskrVector.shares[0]], false))).toBe(
      "sskr.transport.shares-of-different-sets",
    );
    expect(codeOf(() => Share.readSet([first, wrongValue(first), second], false))).toBe(
      "sskr.transport.member-given-twice",
    );
  });
});
