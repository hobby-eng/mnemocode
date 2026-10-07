import { pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_WARNING,
  MasterFingerprintCheck,
  parseMasterFingerprint,
} from "../src/core/master-fingerprint.js";
import { WalletEvidenceCheck } from "../src/core/wallet-evidence.js";

// Public data only: the all-zero entropy's phrase, whose master fingerprint is 73c5da0a.
const PHRASE = `${"abandon ".repeat(11)}about`;
const FINGERPRINT = "73c5da0a";

/** BIP39's PBKDF2 as the command line passes it, and the same answering later, as WebCrypto. */
const now = (password: string, salt: string, rounds: number, bytes: number) =>
  new Uint8Array(pbkdf2Sync(password, salt, rounds, bytes, "sha512"));
const later = async (password: string, salt: string, rounds: number, bytes: number) =>
  now(password, salt, rounds, bytes);

describe("The master fingerprint on its own (core/master-fingerprint.ts)", () => {
  it("gives the published fingerprint, at once and later", async () => {
    expect(new MasterFingerprintCheck(now).fingerprint(PHRASE)).toBe(FINGERPRINT);
    expect(await new MasterFingerprintCheck(later).fingerprintAsync(PHRASE)).toBe(FINGERPRINT);
    // Another BIP39 passphrase is another wallet.
    expect(new MasterFingerprintCheck(now).fingerprint(PHRASE, "TREZOR")).not.toBe(FINGERPRINT);
  });

  it("matches an expected fingerprint, with its warning, and refuses one that cannot be", async () => {
    const check = new MasterFingerprintCheck(now);
    expect(check.match(PHRASE, " 73C5DA0A ")).toEqual({
      matched: true,
      path: "m",
      warning: FINGERPRINT_WARNING,
    });
    expect(check.match(PHRASE, "deadbeef").matched).toBe(false);
    expect(await new MasterFingerprintCheck(later).matchAsync(PHRASE, FINGERPRINT)).toMatchObject({
      matched: true,
    });
    expect(() => check.match(PHRASE, "73c5da0")).toThrow(/eight hexadecimal/u);
    expect(() => parseMasterFingerprint("xyz")).toThrow(/eight hexadecimal/u);
    // A PBKDF2 that answers later needs the Async forms, as before the split.
    expect(() => new MasterFingerprintCheck(later).fingerprint(PHRASE)).toThrow(/matchAsync/u);
  });

  it("gives what the wallet evidence check gives, which is built on it", () => {
    const evidence = new WalletEvidenceCheck(now);
    expect(evidence.fingerprint(PHRASE)).toBe(FINGERPRINT);
    expect(
      evidence.match(PHRASE, {
        kind: "master-fingerprint",
        value: FINGERPRINT,
        network: "mainnet",
      }),
    ).toEqual({
      matched: true,
      kind: "master-fingerprint",
      derived: FINGERPRINT,
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
