import { inspect } from "node:util";
import { HDKey } from "@scure/bip32";
import { describe, expect, it, vi } from "vitest";
import { nodePbkdf2HmacSha512, walletCheckOf } from "../src/bitcoin-evidence.js";
import { WalletEvidenceCheck, type WalletEvidence } from "../src/core/wallet-evidence.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { OTHER_PHRASE, TEST_ADDRESS, TEST_PHRASE as PHRASE } from "./helpers/test-phrase.js";

// BIP84's first receiving key for the public BIP39 test phrase.
const WIF = "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d";
// The public key of that WIF's key, which a match gives instead of the private key.
const PUBLIC_KEY = "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c";
const evidence = (): WalletEvidence => ({
  kind: "wif",
  value: WIF,
  profiles: ["native-segwit"],
  location: { network: "mainnet", account: 0, branch: 0, index: 0 },
});

describe("A retained wallet comparison's lifetime", () => {
  it("compares a WIF by its public key and reads no private key of a derived wallet", () => {
    // A spy that calls through: @scure/bip32 itself never reads this getter, only a comparison
    // that takes a derived node's private key does (CORE-49).
    const privateKeyReads = vi.spyOn(HDKey.prototype, "privateKey", "get");
    try {
      using owner = new WalletEvidenceCheck(nodePbkdf2HmacSha512, [BITCOIN]).prepare({
        kind: "wif",
        value: WIF,
        profiles: ["native-segwit", "legacy"],
        location: { network: "mainnet", account: 0, branch: 0, index: 0 },
        addresses: 20,
      });
      expect(owner.match(PHRASE)).toEqual({
        matched: true,
        kind: "wif",
        derived: PUBLIC_KEY,
        path: "m/84'/0'/0'/0/0",
      });
      expect(owner.match(OTHER_PHRASE)).toEqual({ matched: false, kind: "wif" });
      expect(privateKeyReads).not.toHaveBeenCalled();
    } finally {
      privateKeyReads.mockRestore();
    }
  });

  it("ends the Node callback without changing its callable contract", () => {
    const check = walletCheckOf(evidence())!;
    expect(check(PHRASE)).toMatchObject({
      matched: true,
      derived: PUBLIC_KEY,
      path: "m/84'/0'/0'/0/0",
    });
    check.wipe();
    check[Symbol.dispose]();
    expect(() => check(PHRASE)).toThrow("has been wiped");
    expect(inspect(check, { showHidden: true, getters: true })).not.toContain(WIF);
    expect(walletCheckOf(undefined, "TREZOR")).toBeUndefined();
  });

  it("snapshots a borrowed WIF before the caller changes its input", () => {
    const source = evidence();
    using check = walletCheckOf(source)!;
    Object.assign(source, { value: "synthetic invalid replacement" });
    expect(check(PHRASE)).toMatchObject({ matched: true, derived: PUBLIC_KEY });
  });

  it("ends an escaped callback when its caller fails", () => {
    const check = walletCheckOf(evidence())!;
    const failure = new Error("Synthetic terminal failure.");
    expect(() => {
      using owned = check;
      expect(owned(PHRASE).matched).toBe(true);
      throw failure;
    }).toThrow(failure);
    expect(() => check(PHRASE)).toThrow("has been wiped");
  });

  it("keeps the host-neutral prepared comparison independent of another owner", async () => {
    const check = new WalletEvidenceCheck(nodePbkdf2HmacSha512, [BITCOIN]);
    using first = check.prepare(evidence());
    using other = check.prepare(evidence());
    first.wipe();
    expect(() => first.match(PHRASE)).toThrow("has been wiped");
    await expect(first.matchAsync(PHRASE)).rejects.toThrow("has been wiped");
    expect(other.match(PHRASE)).toMatchObject({ matched: true, derived: PUBLIC_KEY });
    await expect(other.matchAsync(PHRASE)).resolves.toMatchObject({
      matched: true,
      derived: PUBLIC_KEY,
    });
  });

  it("refuses a comparison that settles after disposal and wipes its host seed", async () => {
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let returned: Uint8Array | undefined;
    const check = new WalletEvidenceCheck(
      async (...parameters) => {
        entered!();
        await ready;
        returned = nodePbkdf2HmacSha512(...parameters);
        return returned;
      },
      [BITCOIN],
    );
    using owner = check.prepare(evidence());
    const pending = owner.matchAsync(PHRASE);
    try {
      await started;
      owner.wipe();
      release!();
      await expect(pending).rejects.toThrow("has been wiped");
      expect(returned).toBeDefined();
      expect(returned!.every((byte) => byte === 0)).toBe(true);
    } finally {
      release!();
    }
  });

  it("retains the supplied BIP39 passphrase for the exact independent address", () => {
    // The existing independent coin vector for this phrase with TREZOR at BIP84's first path.
    using check = walletCheckOf(
      {
        kind: "address",
        value: "bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu",
        profiles: ["native-segwit"],
        location: { network: "mainnet", account: 0, branch: 0, index: 0 },
      },
      "TREZOR",
    )!;
    expect(check(PHRASE)).toMatchObject({ matched: true, path: "m/84'/0'/0'/0/0" });
    using noPassphrase = walletCheckOf({
      kind: "address",
      value: TEST_ADDRESS,
      profiles: ["native-segwit"],
      location: { network: "mainnet", account: 0, branch: 0, index: 0 },
    })!;
    expect(noPassphrase(PHRASE)).toMatchObject({ matched: true, derived: TEST_ADDRESS });
  });
});
