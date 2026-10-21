import { describe, expect, it } from "vitest";
import { Base58Coin } from "../src/core/coins/base58.js";
import { CoinList } from "../src/core/coins/coin.js";
import type { AddressType } from "../src/core/coins/address-types.js";
import { firstReceivingOf } from "./helpers/coin-addresses.js";

// BIP44's first receiving address of the public abandon/about BIP39 test phrase.
const ADDRESS = firstReceivingOf("bitcoin");
const DESCRIPTION = {
  id: "bitcoin",
  name: "Bitcoin",
  addressForms: "1…",
  coinTypes: [0],
} as const;

describe("Coin configuration ownership", () => {
  it("keeps the admitted address policy when the host changes its version records", () => {
    const prefix = [0];
    const version = { prefix, type: "p2pkh", testnet: false } as const;
    const versions = [version];
    const coin = new Base58Coin({ ...DESCRIPTION, versions });
    expect(coin.parse(ADDRESS).testnet).toBe(false);

    prefix[0] = 111;
    Reflect.set(version, "type", "p2wpkh");
    Reflect.set(version, "testnet", true);
    versions.length = 0;

    const address = coin.parse(ADDRESS);
    expect(address.type).toBe("p2pkh");
    expect(address.testnet).toBe(false);
    expect(address.branchPathsAt({ account: 0, branch: 0, index: 0 })).toEqual(["m/44'/0'/0'/0"]);
  });

  it("reads each version field once while admitting its policy", () => {
    const reads = { prefix: 0, type: 0, testnet: 0 };
    const coin = new Base58Coin({
      ...DESCRIPTION,
      versions: [
        {
          get prefix() {
            reads.prefix += 1;
            return [0];
          },
          get type(): AddressType {
            reads.type += 1;
            return "p2pkh";
          },
          get testnet() {
            reads.testnet += 1;
            return false;
          },
        },
      ],
    });
    expect(coin.parse(ADDRESS).type).toBe("p2pkh");
    expect(coin.parse(ADDRESS).testnet).toBe(false);
    expect(reads).toEqual({ prefix: 1, type: 1, testnet: 1 });
  });

  it("keeps the registry identity and path policy read-only at runtime", () => {
    const coin = new Base58Coin({
      ...DESCRIPTION,
      versions: [{ prefix: [0], type: "p2pkh", testnet: false }],
    });
    const coins = new CoinList([coin]);
    expect(Reflect.set(coin, "id", "dash")).toBe(false);
    expect(Reflect.set(coin, "name", "Another coin")).toBe(false);
    expect(Reflect.set(coin, "addressForms", "X…")).toBe(false);
    // The coin types live in a private field: a property of that name does not reach the paths.
    Reflect.set(coin, "coinTypes", [5]);
    expect(coins.byId("bitcoin")).toBe(coin);
    expect(coin.name).toBe("Bitcoin");
    expect(coin.addressFormsOn(false)).toBe("1…");
    expect(coin.parse(ADDRESS).branchPathsAt({ account: 0, branch: 0, index: 0 })).toEqual([
      "m/44'/0'/0'/0",
    ]);
  });
});
