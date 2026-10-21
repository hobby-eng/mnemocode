// The wallet that the options give (bitcoin-options.ts, givenWallet) owns its secrets for one
// command (CORE-24): the BIP39 passphrase of --bip39-passphrase-file and the text of a WIF of
// --wif-file are kept as bytes, read as text only for each call that takes them, and refused once
// the command has wiped them. Public test data only: BIP84's first receiving key of the public
// BIP39 test phrase, and a synthetic passphrase.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walletCheckOf } from "../src/bitcoin-evidence.js";
import { givenWallet } from "../src/cli/bitcoin-options.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

// BIP84's first receiving key for the public BIP39 test phrase.
const WIF = "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d";
const PASSPHRASE = "public synthetic passphrase";
const WIPED = "This secret value has been wiped.";
const REDACTED = "[GivenWallet: redacted]";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "mnemocode-given-wallet-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** A file of `text` in the test's folder. */
function fileWith(name: string, text: string): string {
  const path = join(folder, name);
  writeFileSync(path, text);
  return path;
}

describe("the wallet given with the options", () => {
  it("reads its passphrase and a WIF's text for each use, and refuses both once wiped", () => {
    const wallet = givenWallet({
      "wif-file": fileWith("public.wif", WIF),
      "bip39-passphrase-file": fileWith("public-passphrase.txt", `${PASSPHRASE}\n`),
      "bitcoin-profile": "native-segwit",
    });
    expect(wallet.withPassphrase).toBe(true);
    expect(wallet.passphrase).toBe(PASSPHRASE);
    expect(wallet.evidence).toMatchObject({ kind: "wif", profiles: ["native-segwit"] });
    expect(wallet.evidence?.value).toBe(WIF);
    // The wallet check takes the text for its own owner (the test phrase's wallet, no passphrase).
    using check = walletCheckOf(wallet.evidence, "");
    expect(check?.(TEST_PHRASE).path).toBe("m/84'/0'/0'/0/0");
    // Neither secret is shown by the owner nor by the evidence it gives.
    for (const shown of [String(wallet), inspect(wallet)]) expect(shown).toBe(REDACTED);
    expect(JSON.stringify(wallet)).toBe(JSON.stringify(REDACTED));
    for (const shown of [JSON.stringify(wallet.evidence), inspect(wallet.evidence)])
      expect(shown).not.toContain(WIF);
    wallet.wipe();
    expect(() => wallet.passphrase).toThrow(WIPED);
    expect(() => wallet.evidence?.value).toThrow(WIPED);
  });

  it("gives other evidence as it is, and no passphrase without the option", () => {
    using wallet = givenWallet({ "master-fingerprint": TEST_FINGERPRINT });
    expect(wallet.withPassphrase).toBe(false);
    expect(wallet.passphrase).toBe("");
    expect(wallet.evidence).toEqual({
      kind: "master-fingerprint",
      value: TEST_FINGERPRINT,
      network: "mainnet",
    });
  });
});
