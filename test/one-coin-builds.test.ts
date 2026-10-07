import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// A host of one coin, such as the Dash edition of the multi-chain Deriver, carries the code and
// words of no other coin: its build refuses them, comments aside. The modules it takes for an
// address of Dash, its check and its self-test are bundled here as such a host bundles them, and
// what they hold is looked for.

/** The words the Dash edition's build refuses (multi-chain-wallet-tools' composition gate). */
const OTHER_COINS = [
  /\bbitcoin\b/iu,
  /\bethereum\b/iu,
  /litecoin/iu,
  /dogecoin/iu,
  /P2WPKH/u,
  /P2TR/u,
  /BIP49/u,
  /BIP84/u,
  /BIP86/u,
  /EIP-55/u,
];
/**
 * The key with which BIP32 makes a master key from a seed, "Bitcoin seed", which every wallet of
 * BIP32 uses whatever its coin: @scure/bip32 holds it, and so does a fingerprint of a Dash wallet.
 */
const BIP32_SEED_KEY = "Bitcoin seed";

/** The modules a host of Dash alone takes for an address of Dash. */
const DASH_MODULES = [
  "src/core/coins/dash.ts",
  "src/core/coin-address-evidence.ts",
  "src/core/coins/dash-self-test.ts",
];

/** `entry` and all it reaches as one module without comments, as a page bundles it. */
async function bundled(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    legalComments: "none",
    minifyWhitespace: true,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text.replaceAll(BIP32_SEED_KEY, "");
}

describe("a host of Dash alone", () => {
  for (const entry of DASH_MODULES)
    it(`carries no other coin in ${entry}`, async () => {
      const text = await bundled(entry);
      for (const word of OTHER_COINS) expect(text, `${entry}: ${word}`).not.toMatch(word);
    });

  it("is told apart from a host of every coin, which carries them", async () => {
    const every = await bundled("src/core/coins.ts");
    expect(every).toMatch(OTHER_COINS[0]!);
    expect(every).toMatch(OTHER_COINS[1]!);
  });
});
