import { describe, expect, it } from "vitest";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { WalletEvidenceCheck } from "../src/core/wallet-evidence.js";

/** The fingerprint from @scure/bip39's own seed, which bitcoin-evidence.ts computes natively. */
function scureFingerprint(mnemonic: string, passphrase: string): string {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
  return root.fingerprint.toString(16).padStart(8, "0");
}

/** The wallet check as a page builds it, with the pure JavaScript PBKDF2 of @noble/hashes. */
const pageCheck = new WalletEvidenceCheck((password, salt, rounds, bytes) =>
  pbkdf2(sha512, password, salt, { c: rounds, dkLen: bytes }),
);

describe("BIP39 seed from Node's PBKDF2", () => {
  it("gives the seed of @scure/bip39 for every length and for Unicode passphrases", () => {
    expect(masterFingerprint("abandon ".repeat(11) + "about")).toBe("73c5da0a");
    // "caf\u00e9" composed and "cafe\u0301" decomposed: both must give the NFKD salt.
    const passphrases = ["", "TREZOR", "caf\u00e9", "cafe\u0301", "ﾊﾟｽﾜｰﾄﾞ", "😀 two words"];
    for (const strength of [128, 160, 192, 224, 256])
      for (const passphrase of passphrases) {
        // Fixed synthetic entropy, a different pattern for each length.
        const entropy = Uint8Array.from(
          { length: strength / 8 },
          (_, i) => (i * 37 + strength) & 0xff,
        );
        const mnemonic = entropyToMnemonic(entropy, wordlist);
        const expected = scureFingerprint(mnemonic, passphrase);
        expect(masterFingerprint(mnemonic, passphrase)).toBe(expected);
        // The same core with a page's PBKDF2.
        expect(pageCheck.fingerprint(mnemonic, passphrase)).toBe(expected);
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
    expect(() => pageCheck.fingerprint("abandon about")).toThrow(/Invalid mnemonic/u);
  });
});
