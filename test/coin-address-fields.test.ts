// A parsed address keeps what its parse read (CORE-02): its coin, type, network and text are
// private, so that a write to them changes neither its paths, its description nor its check of a
// key. Public data: the first BIP44 address of "abandon … about".

import { describe, expect, it } from "vitest";
import { coinById } from "../src/core/coins.js";

/** The first legacy address of the public test phrase, at m/44'/0'/0'/0/0. */
const ADDRESS = "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA";
/** Its compressed public key, from the same published derivation. */
const PUBLIC_KEY = Buffer.from(
  "03aaeb52dd7494c361049de67cc680e83ebcbbbdbeb13637d92cd845f70308af5e",
  "hex",
);
const FIRST = { account: 0, branch: 0, index: 0 };

describe("a parsed address", () => {
  it("refuses a write to its coin, type, network or text, and still says what its parse read", () => {
    const address = coinById("bitcoin").parse(ADDRESS);
    const writes = [
      ["coin", coinById("litecoin")],
      ["type", "p2tr"],
      ["testnet", true],
      ["text", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv"],
    ] as const;
    for (const [field, value] of writes)
      expect(Reflect.set(address, field, value), field).toBe(false);
    expect(address.coin.id).toBe("bitcoin");
    expect(address.type).toBe("p2pkh");
    expect(address.testnet).toBe(false);
    expect(address.text).toBe(ADDRESS);
    expect(address.description).toBe("legacy (BIP44)");
    expect(address.pathsAt(FIRST)).toEqual(["m/44'/0'/0'/0/0"]);
    expect(address.isAddressOf(PUBLIC_KEY)).toBe(true);
  });
});
