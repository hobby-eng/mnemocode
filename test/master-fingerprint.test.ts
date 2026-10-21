import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nodePbkdf2HmacSha512 } from "../src/bitcoin-evidence.js";
import {
  FINGERPRINT_WARNING,
  MasterFingerprintCheck,
  parseMasterFingerprint,
} from "../src/core/master-fingerprint.js";
import { WalletEvidenceCheck } from "../src/core/wallet-evidence.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

// Public data only: the all-zero entropy's phrase, whose master fingerprint is 73c5da0a.

/** BIP39's PBKDF2 as the command line passes it, answering later, as WebCrypto does. */
const later = async (password: string, salt: string, rounds: number, bytes: number) =>
  nodePbkdf2HmacSha512(password, salt, rounds, bytes);

describe("The master fingerprint on its own (core/master-fingerprint.ts)", () => {
  it("gives the published fingerprint, at once and later", async () => {
    expect(new MasterFingerprintCheck(nodePbkdf2HmacSha512).fingerprint(TEST_PHRASE)).toBe(
      TEST_FINGERPRINT,
    );
    expect(await new MasterFingerprintCheck(later).fingerprintAsync(TEST_PHRASE)).toBe(
      TEST_FINGERPRINT,
    );
    // Another BIP39 passphrase is another wallet.
    expect(
      new MasterFingerprintCheck(nodePbkdf2HmacSha512).fingerprint(TEST_PHRASE, "TREZOR"),
    ).not.toBe(TEST_FINGERPRINT);
  });

  it("matches an expected fingerprint, with its warning, and refuses one that cannot be", async () => {
    const check = new MasterFingerprintCheck(nodePbkdf2HmacSha512);
    expect(check.match(TEST_PHRASE, ` ${TEST_FINGERPRINT.toUpperCase()} `)).toEqual({
      matched: true,
      path: "m",
      warning: FINGERPRINT_WARNING,
    });
    expect(check.match(TEST_PHRASE, "deadbeef").matched).toBe(false);
    expect(
      await new MasterFingerprintCheck(later).matchAsync(TEST_PHRASE, TEST_FINGERPRINT),
    ).toMatchObject({
      matched: true,
    });
    expect(() => check.match(TEST_PHRASE, TEST_FINGERPRINT.slice(0, -1))).toThrow(
      /eight hexadecimal/u,
    );
    expect(() => parseMasterFingerprint("xyz")).toThrow(/eight hexadecimal/u);
    // A PBKDF2 that answers later needs the Async forms, as before the split.
    expect(() => new MasterFingerprintCheck(later).fingerprint(TEST_PHRASE)).toThrow(/matchAsync/u);
  });

  it("gives what the wallet evidence check gives, which is built on it", () => {
    const evidence = new WalletEvidenceCheck(nodePbkdf2HmacSha512, [BITCOIN]);
    expect(evidence.fingerprint(TEST_PHRASE)).toBe(TEST_FINGERPRINT);
    expect(
      evidence.match(TEST_PHRASE, {
        kind: "master-fingerprint",
        value: TEST_FINGERPRINT,
        network: "mainnet",
      }),
    ).toEqual({
      matched: true,
      kind: "master-fingerprint",
      derived: TEST_FINGERPRINT,
      path: "m",
      warning: FINGERPRINT_WARNING,
    });
  });

  it("holds no code or text of one coin, so that a host for another can take it", () => {
    const source = readFileSync(
      new URL("../src/core/master-fingerprint.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/bitcoin|btc-signer|bip(?:44|49|84|86)|segwit|taproot/iu);
  });
});
