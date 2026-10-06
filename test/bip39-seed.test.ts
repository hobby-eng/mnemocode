import { describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { masterFingerprint } from "../src/bitcoin-evidence.js";

/** The fingerprint from @scure/bip39's own seed, which bitcoin-evidence.ts computes natively. */
function scureFingerprint(mnemonic: string, passphrase: string): string {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
  return root.fingerprint.toString(16).padStart(8, "0");
}

describe("BIP39 seed from Node's PBKDF2", () => {
  it("gives the seed of @scure/bip39 for every length and for Unicode passphrases", () => {
    expect(masterFingerprint("abandon ".repeat(11) + "about")).toBe("73c5da0a");
    const passphrases = ["", "TREZOR", "café", "café", "ﾊﾟｽﾜｰﾄﾞ", "😀 two words"];
    for (const strength of [128, 160, 192, 224, 256])
      for (const passphrase of passphrases) {
        // Fixed synthetic entropy, a different pattern for each length.
        const entropy = Uint8Array.from(
          { length: strength / 8 },
          (_, i) => (i * 37 + strength) & 0xff,
        );
        const mnemonic = entropyToMnemonic(entropy, wordlist);
        expect(masterFingerprint(mnemonic, passphrase)).toBe(
          scureFingerprint(mnemonic, passphrase),
        );
      }
  });

  it("refuses what @scure/bip39 refuses", () => {
    expect(() => masterFingerprint("abandon about")).toThrow(/Invalid mnemonic/u);
    expect(() => masterFingerprint("abandon ".repeat(11) + "about", "\ud800")).toThrow(
      /well-formed/u,
    );
    expect(() => scureFingerprint("abandon ".repeat(11) + "about", "\ud800")).toThrow(
      /well-formed/u,
    );
  });
});
