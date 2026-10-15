import { pbkdf2Sync } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { walletCheckOf } from "../src/bitcoin-evidence.js";
import { WalletEvidenceCheck, type WalletEvidence } from "../src/core/wallet-evidence.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { TEST_PHRASE as PHRASE } from "./helpers/test-phrase.js";

// BIP84's first receiving key and address for the public BIP39 test phrase.
const WIF = "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d";
const FIRST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const evidence = (): WalletEvidence => ({
  kind: "wif",
  value: WIF,
  profiles: ["native-segwit"],
  location: { network: "mainnet", account: 0, branch: 0, index: 0 },
});
const pbkdf2 = (password: string, salt: string, rounds: number, bytes: number) =>
  pbkdf2Sync(password, salt, rounds, bytes, "sha512");

describe("A retained wallet comparison's lifetime", () => {
  it("ends the Node callback without changing its callable contract", () => {
    const check = walletCheckOf(evidence())!;
    expect(check(PHRASE)).toMatchObject({ matched: true, derived: WIF, path: "m/84'/0'/0'/0/0" });
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
    expect(check(PHRASE)).toMatchObject({ matched: true, derived: WIF });
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
    const service = new WalletEvidenceCheck(pbkdf2, [BITCOIN]);
    using first = service.prepare(evidence());
    using other = service.prepare(evidence());
    first.wipe();
    expect(() => first.match(PHRASE)).toThrow("has been wiped");
    await expect(first.matchAsync(PHRASE)).rejects.toThrow("has been wiped");
    expect(other.match(PHRASE)).toMatchObject({ matched: true, derived: WIF });
    await expect(other.matchAsync(PHRASE)).resolves.toMatchObject({ matched: true, derived: WIF });
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
    const service = new WalletEvidenceCheck(
      async (...parameters) => {
        entered!();
        await ready;
        returned = pbkdf2(...parameters);
        return returned;
      },
      [BITCOIN],
    );
    using owner = service.prepare(evidence());
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
      value: FIRST_ADDRESS,
      profiles: ["native-segwit"],
      location: { network: "mainnet", account: 0, branch: 0, index: 0 },
    })!;
    expect(noPassphrase(PHRASE)).toMatchObject({ matched: true, derived: FIRST_ADDRESS });
  });
});
