// The path and the warning of a host's WalletMatch, which a host shows as they are: other than
// text, each is refused by its own code, as a match that is no true or false is (AUD-037-SEC004).
// Synthetic answers and the public test phrase only.

import { describe, expect, it } from "vitest";
import { WordCandidateSearch } from "../src/core/candidates.js";
import { askWallet, type WalletMatch } from "../src/core/wallet-check.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

describe("a wallet's match", () => {
  it.each([
    ["path", null, "malformed-wallet-path"],
    ["path", 84, "malformed-wallet-path"],
    ["warning", null, "malformed-wallet-warning"],
    ["warning", 1, "malformed-wallet-warning"],
  ] as const)(
    "is refused with a %s of %s, by that field's own code",
    async (field, value, code) => {
      for (const matched of [true, false])
        await expect(askWallet(() => ({ matched, [field]: value }), TEST_PHRASE)).rejects.toThrow(
          expect.objectContaining({ name: "TypeError", code: `core.wallet-check.${code}` }),
        );
    },
  );

  it("takes its path and its warning as text, or without them", async () => {
    const answers = [
      { matched: true },
      { matched: true, path: undefined, warning: undefined },
      { matched: true, path: "m", warning: "public warning" },
    ];
    for (const answer of answers)
      expect(await askWallet(() => answer, TEST_PHRASE)).toEqual(answer);
  });

  it("is refused with a warning of null before a search shows it", async () => {
    const search = WordCandidateSearch.parse(`${"abandon ".repeat(11)}?`, "unknown-words");
    // A warning of null, which no WalletMatch has, given on purpose as a JavaScript host could.
    const walletCheck = (phrase: string) =>
      ({ matched: phrase === TEST_PHRASE, warning: null }) as unknown as WalletMatch;
    await expect(search.run({ walletCheck })).rejects.toThrow(
      expect.objectContaining({ code: "core.wallet-check.malformed-wallet-warning" }),
    );
  });
});
