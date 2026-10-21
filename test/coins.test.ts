// The coins of src/core/coins.ts and the "coin-address" evidence of src/core/wallet-evidence.ts:
// where the wallets of the public test phrase put each address, what is refused and why, the case
// rules and the standard forms. Public test phrases and public or independently computed vectors
// only.
import { readFileSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { bech32, bech32m } from "@scure/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COINS, coinById, parseCoinAddress, type CoinId } from "../src/core/coins.js";
import {
  WalletEvidenceCheck,
  assertWalletEvidence,
  type AddressLocation,
  type Pbkdf2HmacSha512,
  type WalletEvidence,
} from "../src/core/wallet-evidence.js";
import {
  matchBitcoinEvidence,
  nodePbkdf2HmacSha512,
  walletCheckOf,
  assertBitcoinEvidence,
} from "../src/bitcoin-evidence.js";
import { locationOf } from "../src/core/coins/coin-self-test.js";
import { allWiped } from "./helpers/made-arrays.js";
import { matching } from "./helpers/matchers.js";
import {
  ADDRESSES,
  BITCOIN_CASH_LEGACY_ADDRESS,
  PLATFORM_ADDRESS,
  TAPROOT_ADDRESS,
  TESTNET_NESTED_ADDRESS,
  addressAt,
  firstReceivingOf,
} from "./helpers/coin-addresses.js";
import { DAMAGED_ADDRESS, TEST_ADDRESS, TEST_PHRASE } from "./helpers/test-phrase.js";

/** The BIP39 test vector of entropy ff…ff: another wallet. */
const ZOO = "zoo ".repeat(11) + "wrong";
/**
 * The native SegWit address of the public phrase deep in an account, m/84'/0'/2'/1/19: account 2,
 * change branch, index 19. Computed independently with Python's hashlib.
 */
const DEEP_ADDRESS = "bc1q4du7e3vw34vsflf76xf9h8gktms9wzqcl7vlh5";
/** The first legacy address of the test phrase, m/44'/0'/0'/0/0 (BIP44's vectors). */
const LEGACY_ADDRESS = firstReceivingOf("bitcoin");
/** The first Ethereum address of the test phrase, m/44'/60'/0'/0/0. */
const ETHEREUM_ADDRESS = firstReceivingOf("ethereum");

const check = new WalletEvidenceCheck(nodePbkdf2HmacSha512, COINS);

function coinAddress(
  coin: CoinId,
  value: string,
  location: AddressLocation,
): Extract<WalletEvidence, { kind: "coin-address" }> {
  return { kind: "coin-address", coin, value, location };
}

/** The message of what `run` throws. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
  throw new Error("Nothing was refused.");
}

describe("the forms of a coin's addresses", () => {
  it("are those of the test network where they differ there, and the main network's otherwise", () => {
    const bitcoin = coinById("bitcoin");
    expect(bitcoin.addressFormsOn(false)).toBe("1…, 3…, bc1q… or bc1p…");
    expect(bitcoin.addressFormsOn(true)).toBe("m…, n…, 2…, tb1q… or tb1p…");
    expect(coinById("litecoin").addressFormsOn(true)).toBe("L…, M…, 3… or ltc1q…");
  });
});

describe("the coins that a host offers (a host of one coin family)", () => {
  const ethereum = ADDRESSES.find(([coin]) => coin === "ethereum")!;
  const evidence = coinAddress(ethereum[0], ethereum[3], locationOf(ethereum[2]));

  it("compares an address of an offered coin only", () => {
    const bitcoinOnly = new WalletEvidenceCheck(nodePbkdf2HmacSha512, [coinById("bitcoin")]);
    expect(() => bitcoinOnly.assert(evidence)).toThrow("Unknown coin; the coins are bitcoin.");
    expect(() => assertWalletEvidence(evidence, [coinById("bitcoin")])).toThrow("Unknown coin");
    const offered = [coinById("bitcoin"), coinById("ethereum")];
    expect(
      new WalletEvidenceCheck(nodePbkdf2HmacSha512, offered).match(
        TEST_PHRASE,
        evidence,
        ethereum[1],
      ),
    ).toMatchObject({
      matched: true,
      path: ethereum[2],
    });
    expect(() => assertWalletEvidence(evidence, offered)).not.toThrow();
    expect(() =>
      new WalletEvidenceCheck(nodePbkdf2HmacSha512, [coinById("dash")]).assert(evidence),
    ).toThrow("the coins are dash.");
  });

  it("refuses a list that holds no coin or a coin twice", () => {
    // An object that is no coin, fed on purpose as a JavaScript host could.
    expect(
      () => new WalletEvidenceCheck(nodePbkdf2HmacSha512, [{ id: "ethereum" } as never]),
    ).toThrow(TypeError);
    expect(() => new WalletEvidenceCheck(nodePbkdf2HmacSha512, [COINS[0]!, COINS[0]!])).toThrow(
      "each be given once",
    );
  });
});

describe("addresses of every coin, where the wallets of the public phrase put them", () => {
  it("are the 43 vectors", () => {
    expect(ADDRESSES).toHaveLength(43);
    expect(new Set(ADDRESSES.map(([coin]) => coin))).toEqual(new Set(COINS.map(({ id }) => id)));
  });

  it.each(ADDRESSES)(
    "matches %s with passphrase %j at %s to %s",
    (coin, passphrase, path, address) => {
      const evidence = coinAddress(coin, address, locationOf(path));
      expect(check.match(TEST_PHRASE, evidence, passphrase)).toEqual({
        matched: true,
        kind: "coin-address",
        derived: address,
        path,
      });
    },
  );

  it("are found by the Node.js module and with a PBKDF2 that answers later", async () => {
    // An Ethereum Classic wallet on Ethereum's coin type, found on the second path.
    const path = "m/44'/60'/0'/0/0";
    const address = addressAt("ethereum-classic", path);
    const evidence = coinAddress("ethereum-classic", address, locationOf(path));
    const expected = { matched: true, kind: "coin-address", derived: address, path };
    expect(matchBitcoinEvidence(TEST_PHRASE, evidence)).toEqual(expected);
    using ownedCheck = walletCheckOf(evidence)!;
    expect(ownedCheck(TEST_PHRASE)).toEqual(expected);
    const later = new WalletEvidenceCheck(
      async (...parameters) => nodePbkdf2HmacSha512(...parameters),
      COINS,
    );
    await expect(later.matchAsync(TEST_PHRASE, evidence)).resolves.toEqual(expected);
  });

  it("include Dash Platform testnet addresses, on coin type 1", () => {
    // The Platform address vector of Dash Desktop, a public test phrase.
    const phrase = "deliver frame tomato ring tool second dream mutual fade sponsor visa teach";
    const addresses = [
      "tdash1kr0xt5wj85ht5u464rfysjrq75rewz9mysjwf59p",
      "tdash1kqgy7ngm2wf0zsv20k4mc62s5rapw26yeg6em4jq",
      "tdash1kzlatzl0u06uxrqz8hkc7naz9d2g3v8g7gw83ew3",
    ];
    addresses.forEach((address, index) => {
      expect(coinById("dash").parse(address).description).toBe("testnet, Platform payment (DIP17)");
      const evidence = coinAddress("dash", address, { account: 0, branch: 0, index });
      expect(check.match(phrase, evidence).path).toBe(`m/9'/1'/17'/0'/0'/${index}`);
    });
  });

  it("include one deep in an account: account 2, change branch, index 19", () => {
    const evidence = coinAddress("bitcoin", DEEP_ADDRESS, {
      account: 2,
      branch: 1,
      index: 19,
    });
    expect(check.match(TEST_PHRASE, evidence).path).toBe("m/84'/0'/2'/1/19");
  });

  it("are found among several addresses in a row, from the location's index on", () => {
    // The DIP17/DIP18 vector of the second receiving key, and the one deep in account 2 above.
    const platform = addressAt("dash", "m/9'/5'/17'/0'/0'/1");
    const first = { account: 0, branch: 0, index: 0 };
    expect(check.match(TEST_PHRASE, coinAddress("dash", platform, first)).matched).toBe(false);
    expect(
      check.match(TEST_PHRASE, { ...coinAddress("dash", platform, first), addresses: 20 }).path,
    ).toBe("m/9'/5'/17'/0'/0'/1");
    const deep = DEEP_ADDRESS;
    const account2 = { account: 2, branch: 1, index: 0 };
    expect(
      check.match(TEST_PHRASE, { ...coinAddress("bitcoin", deep, account2), addresses: 20 }).path,
    ).toBe("m/84'/0'/2'/1/19");
    expect(
      check.match(TEST_PHRASE, { ...coinAddress("bitcoin", deep, account2), addresses: 19 })
        .matched,
    ).toBe(false);
    expect(() =>
      assertWalletEvidence({ ...coinAddress("bitcoin", deep, account2), addresses: 0 }, COINS),
    ).toThrow("The number of addresses compared must be an integer");
  });
});

describe("addresses of every coin, where the wallets of the public phrase put them", () => {
  it("are not found elsewhere, with another passphrase or in another wallet", () => {
    const address = TEST_ADDRESS;
    const notFound = { matched: false, kind: "coin-address" };
    const first = { account: 0, branch: 0, index: 0 };
    for (const location of [
      { ...first, index: 1 },
      { ...first, branch: 1 },
      { ...first, account: 1 },
    ])
      expect(check.match(TEST_PHRASE, coinAddress("bitcoin", address, location))).toEqual(notFound);
    expect(check.match(TEST_PHRASE, coinAddress("bitcoin", address, first), "TREZOR")).toEqual(
      notFound,
    );
    for (const [coin, , path, text] of ADDRESSES.filter(([, passphrase]) => passphrase === ""))
      expect(check.match(ZOO, coinAddress(coin, text, locationOf(path))), text).toEqual(notFound);
  });

  it("are compared on the paths of their type, coin types and network", () => {
    // The paths of the branch that holds the address at index 7.
    const paths = (coin: CoinId, text: string, location = { account: 3, branch: 1, index: 7 }) =>
      coinById(coin).parse(text).branchPathsAt(location);
    expect(paths("bitcoin-cash", LEGACY_ADDRESS)).toEqual(["m/44'/145'/3'/1", "m/44'/0'/3'/1"]);
    expect(paths("ethereum-classic", ETHEREUM_ADDRESS)).toEqual([
      "m/44'/61'/3'/1",
      "m/44'/60'/3'/1",
    ]);
    expect(paths("bitcoin", TESTNET_NESTED_ADDRESS)).toEqual(["m/49'/1'/3'/1"]);
    expect(paths("injective", firstReceivingOf("injective"))).toEqual(["m/44'/60'/3'/1"]);
    expect(paths("dash", PLATFORM_ADDRESS)).toEqual(["m/9'/5'/17'/3'/1'"]);
  });
});

describe("the comparison", () => {
  afterEach(() => vi.restoreAllMocks());

  it("wipes the seed and every key it derives, on the way to each address too", async () => {
    const seeds: Uint8Array[] = [];
    const host: Pbkdf2HmacSha512 = (...parameters) => {
      const seed = nodePbkdf2HmacSha512(...parameters);
      seeds.push(seed);
      return seed;
    };
    const now = new WalletEvidenceCheck(host, COINS);
    const later = new WalletEvidenceCheck(async (...parameters) => host(...parameters), COINS);
    const roots = vi.spyOn(HDKey, "fromMasterSeed");
    const children = vi.spyOn(HDKey.prototype, "deriveChild");
    const platformPath = "m/9'/5'/17'/0'/1'/0";
    // Found on the second of Bitcoin Cash's two paths of five steps, and on DIP17's six steps.
    const evidence = [
      coinAddress("bitcoin-cash", LEGACY_ADDRESS, { account: 0, branch: 0, index: 0 }),
      coinAddress("dash", addressAt("dash", platformPath), locationOf(platformPath)),
    ];
    for (const each of evidence) {
      expect(now.match(TEST_PHRASE, each).matched).toBe(true);
      expect((await later.matchAsync(TEST_PHRASE, each)).matched).toBe(true);
    }
    const nodes = [...roots.mock.results, ...children.mock.results].map((result) => {
      if (result.type !== "return") throw new Error("Expected every derivation to return a key.");
      return result.value;
    });
    // Each comparison twice: a root and 2 × 5 steps, then a root and 6 steps.
    expect(nodes).toHaveLength(2 * (1 + 10 + 1 + 6));
    for (const node of nodes) expect(node.privateKey).toBeNull();
    expect(seeds).toHaveLength(4);
    expect(allWiped(seeds)).toBe(true);
  });

  it("refuses evidence that no wallet can match before the host's PBKDF2 is called", () => {
    const calls: unknown[] = [];
    const recording = new WalletEvidenceCheck((...parameters) => {
      calls.push(parameters);
      return nodePbkdf2HmacSha512(...parameters);
    }, COINS);
    const first = { account: 0, branch: 0, index: 0 };
    const address = TEST_ADDRESS;
    // Each refusal's code: one for each condition.
    const place = "core.coins.coin.assert-address-location-refused";
    const refused: readonly [WalletEvidence, string, string][] = [
      [
        // A coin that no type allows, fed on purpose as a JavaScript host could.
        coinAddress("solana" as CoinId, address, first),
        "Unknown coin; the coins are bitcoin,",
        "core.coins.coin.unknown-coin-coins",
      ],
      [
        coinAddress("litecoin", LEGACY_ADDRESS, first),
        "it is not an address of Litecoin",
        "core.coins.coin.address-not-this-coin",
      ],
      [
        coinAddress("bitcoin", DAMAGED_ADDRESS, first),
        "checksum or format",
        "core.coins.coin.address-damaged",
      ],
      [coinAddress("bitcoin", address, { ...first, index: -1 }), "index must be an integer", place],
      [
        coinAddress("dash", firstReceivingOf("dash"), { ...first, branch: 2 ** 31 }),
        "branch must be an integer from 0 through 2147483647.",
        place,
      ],
      [
        coinAddress("ethereum", ETHEREUM_ADDRESS, { ...first, account: 1.5 }),
        "account must be an integer from 0 through 2147483647.",
        place,
      ],
      [
        coinAddress("ethereum", address, first),
        "not an address of Ethereum",
        "core.coins.coin.address-not-this-coin",
      ],
    ];
    for (const [evidence, reason, code] of refused) {
      expect(refusal(() => recording.match(TEST_PHRASE, evidence))).toContain(reason);
      for (const check of [
        () => assertWalletEvidence(evidence, COINS),
        () => assertBitcoinEvidence(evidence),
      ]) {
        expect(check).toThrow(expect.objectContaining({ code }));
        expect(check).toThrow(reason);
      }
    }
    expect(calls).toEqual([]);
  });
});

describe("addresses out of reach", () => {
  it("are refused for shielded Zcash, naming the transparent form", () => {
    // Only the prefix matters: the address is refused before it is decoded.
    for (const text of [
      "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
      "u1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      "zcU1Cd6zYyZCd2VJF8yKgmzjxdiiU1rgTTjEwoN1CGUWCziPkUTXUjXmX7TMqdMNsTfuiGN1jQoVN4kGxUR4sAPN4XZ7pxb",
      "ZS1Z7REJLPSA98S2RRRFKWMAXU53E4UE0ULCRW0H4X5G8JL04TAK0D3MM47VDTAHATQRLKNGH9SLYA",
    ])
      expect(refusal(() => parseCoinAddress("zcash", text))).toBe(
        "The address cannot be used for the check: it is shielded; use a transparent t1… address of the same wallet.",
      );
    const transparent = firstReceivingOf("zcash");
    expect(parseCoinAddress("zcash", transparent)).toBe(transparent);
  });

  it("are refused for scripts and several keys, naming why", () => {
    for (const [coin, text, reason] of [
      // P2WSH, a script rather than a single key.
      [
        "bitcoin",
        "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        "it is not the address of a single key; only bc1q with 42 characters or bc1p can be checked",
      ],
      // A P2SH CashAddr address.
      [
        "bitcoin-cash",
        "bitcoincash:pqkh9ahfj069qv8l6eysyufazpe4fdjq3u4hna323j",
        "it is not the address of a single key; only bitcoincash:q… or 1… can be checked",
      ],
      // Zcash's P2SH "t3…".
      ["zcash", "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd", "it is not an address of Zcash (t1…)"],
    ] as const)
      expect(refusal(() => parseCoinAddress(coin, text))).toContain(reason);
  });

  it("are refused for Dash Orchard and other Platform types, and need the one encoding", () => {
    const encoded = (payload: Uint8Array) => bech32m.encode("dash", bech32m.toWords(payload));
    const payment = Uint8Array.of(0xb0, ...Array.from({ length: 20 }, () => 0x11));
    expect(refusal(() => parseCoinAddress("dash", encoded(payment.subarray(0, 20))))).toContain(
      "it has the wrong length",
    );
    // Another type byte, such as a script's, is not a single key's payment address.
    const script = Uint8Array.of(0x80, ...payment.subarray(1));
    expect(refusal(() => parseCoinAddress("dash", encoded(script)))).toContain(
      "it is not the address of a single key; only X… or dash1k… can be checked",
    );
    // DIP18 uses Bech32m; the same data with a Bech32 checksum is refused.
    const withBech32 = bech32.encode("dash", bech32.toWords(payment));
    expect(refusal(() => parseCoinAddress("dash", withBech32))).toContain("checksum or format");
    // A group added at the end, or padding bits set, keep a valid checksum and the same leading
    // bytes; only the one encoding of the 21 bytes is an address.
    const canonical = encoded(payment);
    expect(parseCoinAddress("dash", canonical.toUpperCase())).toBe(canonical);
    const groups = bech32m.toWords(payment);
    const longer = bech32m.encode("dash", [...groups, 0]);
    const padded = bech32m.encode("dash", [...groups.slice(0, -1), groups.at(-1)! | 1]);
    for (const malformed of [longer, padded]) {
      expect(bech32m.decode(malformed).prefix).toBe("dash");
      for (const input of [malformed, malformed.toUpperCase()])
        expect(refusal(() => parseCoinAddress("dash", input))).toContain("checksum or format");
    }
    // A testnet Orchard address.
    const orchard =
      "tdash1zrhflqt5ly4r7q64wrktl6tf466x7h30vjkknaudxsckc3l28rp0qzzm27yta0683nnnd2qum8gyq";
    expect(refusal(() => parseCoinAddress("dash", orchard))).toContain(
      "it is shielded; use a Dash Core X… or Platform dash1k… address of the same wallet",
    );
    expect(refusal(() => parseCoinAddress("dash", "dash1qqqqqq"))).toContain("checksum or format");
  });
});

describe("addresses out of reach", () => {
  it("are refused for Cosmos SDK accounts with a Bech32m checksum or the wrong length", () => {
    // The public Cosmos and Injective vectors re-encoded with a Bech32m checksum.
    for (const [coin, text] of [
      ["cosmos", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0afua36h"],
      ["injective", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55k94rgq"],
    ] as const)
      expect(refusal(() => parseCoinAddress(coin, text))).toContain("checksum or format");
    // A valid account of another chain's prefix is not this coin's address.
    expect(refusal(() => parseCoinAddress("injective", firstReceivingOf("cosmos")))).toContain(
      "it is not an address of Injective (inj1…)",
    );
    // Valid Bech32 strings of the right prefix whose data is not a 20-byte hash.
    for (const length of [19, 21, 32]) {
      const text = bech32.encode("cosmos", bech32.toWords(new Uint8Array(length).fill(7)));
      expect(
        refusal(() => parseCoinAddress("cosmos", text)),
        `${length}`,
      ).toContain("it has the wrong length");
    }
    // The public vectors with a valid checksum over an extra data group.
    for (const [coin, text] of [
      ["cosmos", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0aqyjnds4"],
      ["cosmos", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0apey8cd8"],
      ["injective", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55qhk6md7"],
      ["injective", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55p2qwwsv"],
    ] as const) {
      expect(bech32.decode(text).words).toHaveLength(33);
      for (const input of [text, text.toUpperCase()])
        expect(refusal(() => parseCoinAddress(coin, input))).toContain("it has the wrong length");
    }
  });

  it("are refused as damaged past Bech32's limits: 1023 characters, a prefix of 83", () => {
    const payment = Uint8Array.of(0xb0, ...Array.from({ length: 20 }, () => 0x11));
    for (const [coin, checksum, prefix, words, name] of [
      ["cosmos", bech32, "cosmos", bech32.toWords(new Uint8Array(20).fill(7)), "Cosmos"],
      ["dash", bech32m, "dash", bech32m.toWords(payment), "Dash"],
    ] as const) {
      // Zero groups after the data, to `length` with the prefix, its separator and the checksum.
      const atLength = (length: number) => {
        const zeros = Array.from({ length: length - prefix.length - 7 - words.length }, () => 0);
        return checksum.encode(prefix, [...words, ...zeros], false);
      };
      expect(atLength(1023)).toHaveLength(1023);
      expect(refusal(() => parseCoinAddress(coin, atLength(1023)))).toContain(
        "it has the wrong length",
      );
      expect(refusal(() => parseCoinAddress(coin, atLength(1024)))).toContain("checksum or format");
      // A valid checksum under a longer prefix than BIP173 allows is no address of any coin.
      const prefixed = (length: number) =>
        checksum.encode(`${prefix}1`.padEnd(length, "q"), words, false);
      expect(refusal(() => parseCoinAddress(coin, prefixed(83)))).toContain(
        `it is not an address of ${name}`,
      );
      expect(refusal(() => parseCoinAddress(coin, prefixed(84)))).toContain("checksum or format");
    }
  });

  it("are refused when damaged, too short or of another coin", () => {
    for (const [coin, text] of [
      ["bitcoin", DAMAGED_ADDRESS], // checksum changed
      ["bitcoin", `${LEGACY_ADDRESS.slice(0, -1)}B`], // checksum changed
      ["bitcoin", "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"], // P2WSH
      ["bitcoin", "ltc1qcr8te4kr609gcawutmrza0j4xv80jy8zkvrefp"], // another coin
      ["bitcoin", firstReceivingOf("litecoin")], // another coin
      ["litecoin", TEST_ADDRESS], // another coin
      ["tron", ETHEREUM_ADDRESS], // another coin
      ["ethereum", firstReceivingOf("tron")], // another coin
      ["ethereum", ETHEREUM_ADDRESS.slice(0, -2)], // too short
      ["xrp", LEGACY_ADDRESS], // another alphabet
      ["cosmos", firstReceivingOf("injective")], // another chain
      ["bitcoin-cash", "bitcoincash:pqkh9ahfj069qv8l6eysyufazpe4fdjq3u4hna323j"], // P2SH
      ["bitcoin-cash", `${firstReceivingOf("bitcoin-cash").slice(0, -1)}7`], // checksum changed
      ["zcash", "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd"], // P2SH
      ["dash", ""],
    ] as const)
      expect(() => parseCoinAddress(coin, text), `${coin} ${text}`).toThrow(
        /^The address cannot be used for the check: .+\.$/u,
      );
  });
});

describe("the case of an address", () => {
  it("may be all capitals for Bech32 and CashAddr, never mixed", () => {
    for (const [coin, lower] of [
      ["bitcoin", TEST_ADDRESS],
      ["bitcoin", TAPROOT_ADDRESS],
      ["bitcoin", addressAt("bitcoin", "m/84'/1'/0'/0/0")],
      ["litecoin", addressAt("litecoin", "m/84'/2'/3'/1/7")],
      ["cosmos", firstReceivingOf("cosmos")],
      ["bitcoin-cash", firstReceivingOf("bitcoin-cash")],
    ] as const) {
      const upper = lower.toUpperCase();
      expect(parseCoinAddress(coin, upper)).toBe(lower);
      const mixed = upper.slice(0, 14) + lower.slice(14);
      // Bech32 cannot read it at all; CashAddr names its rule of one case.
      const code = coin === "bitcoin-cash" ? "address-mixed-case" : "address-damaged";
      expect(() => parseCoinAddress(coin, mixed), mixed).toThrow(
        expect.objectContaining({ code: `core.coins.coin.${code}` }),
      );
    }
  });

  it("may leave out the CashAddr prefix, for the same key as the legacy form", () => {
    const cashAddress = firstReceivingOf("bitcoin-cash");
    const withoutPrefix = cashAddress.replace("bitcoincash:", "");
    expect(parseCoinAddress("bitcoin-cash", withoutPrefix.toUpperCase())).toBe(cashAddress);
    const first = { account: 0, branch: 0, index: 0 };
    for (const text of [withoutPrefix, BITCOIN_CASH_LEGACY_ADDRESS])
      expect(check.match(TEST_PHRASE, coinAddress("bitcoin-cash", text, first)).path).toBe(
        "m/44'/145'/0'/0/0",
      );
  });

  it("is checked by EIP-55 in mixed case only", () => {
    const checksummed = ETHEREUM_ADDRESS;
    for (const same of [
      checksummed.toLowerCase(),
      `0x${checksummed.slice(2).toUpperCase()}`,
      `0X${checksummed.slice(2)}`,
    ])
      expect(parseCoinAddress("ethereum", same), same).toBe(checksummed);
    // One capital made small, the first, breaks the checksum.
    expect(refusal(() => parseCoinAddress("ethereum", checksummed.replace("E", "e")))).toContain(
      "its EIP-55 checksum, the mix of capital and small letters, is wrong",
    );
  });
});

describe("parseCoinAddress", () => {
  it("gives each address in its standard form", () => {
    const classic = firstReceivingOf("ethereum-classic");
    const injective = firstReceivingOf("injective");
    const xrp = firstReceivingOf("xrp");
    for (const [coin, typed, standard] of [
      ["bitcoin", `  ${TEST_ADDRESS.toUpperCase()}\n`, TEST_ADDRESS],
      ["bitcoin", ` ${LEGACY_ADDRESS} `, LEGACY_ADDRESS],
      ["ethereum-classic", classic.toLowerCase(), classic],
      ["dash", PLATFORM_ADDRESS.toUpperCase(), PLATFORM_ADDRESS],
      ["injective", injective.toUpperCase(), injective],
      ["xrp", `\t${xrp}`, xrp],
    ] as const)
      expect(parseCoinAddress(coin, typed)).toBe(standard);
  });

  it("trims Unicode white space only", () => {
    const address = TEST_ADDRESS;
    // NEL (U+0085) and the ideographic space (U+3000) are white space; a byte order mark is not.
    expect(parseCoinAddress("bitcoin", `\u0085${address}\u3000`)).toBe(address);
    for (const text of [`\ufeff${address}`, `${address}\ufeff`])
      expect(refusal(() => parseCoinAddress("bitcoin", text))).toBe(
        "The address cannot be used for the check: its checksum or format is wrong.",
      );
    expect(coinById("\u0085bitcoin\u2028").id).toBe("bitcoin");
    expect(refusal(() => coinById("\ufeffbitcoin"))).toContain("Unknown coin");
  });

  it("names the coin's forms when the address is another coin's", () => {
    expect(refusal(() => parseCoinAddress("litecoin", LEGACY_ADDRESS))).toBe(
      "The address cannot be used for the check: it is not an address of Litecoin (L…, M…, 3… or ltc1q…).",
    );
  });

  it("gives each condition of a refused address its own code (TS-06, CORE-23)", () => {
    const refused: readonly (readonly [CoinId, string, string])[] = [
      // A changed checksum character.
      ["bitcoin", DAMAGED_ADDRESS, "core.coins.coin.address-damaged"],
      // One capital, the first after the prefix.
      [
        "bitcoin-cash",
        firstReceivingOf("bitcoin-cash").replace(":q", ":Q"),
        "core.coins.coin.address-mixed-case",
      ],
      [
        "cosmos",
        bech32.encode("cosmos", bech32.toWords(new Uint8Array(21).fill(7))),
        "core.coins.coin.address-wrong-length",
      ],
      ["litecoin", LEGACY_ADDRESS, "core.coins.coin.address-not-this-coin"],
      // P2WSH, a script's.
      [
        "bitcoin",
        "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        "core.coins.coin.address-not-single-key",
      ],
      [
        "zcash",
        "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
        "core.coins.coin.address-shielded",
      ],
      // 39 digits, one short.
      ["ethereum", ETHEREUM_ADDRESS.slice(0, -1), "core.coins.ethereum.address-not-hex-account"],
      // One capital made small, the first.
      [
        "ethereum",
        ETHEREUM_ADDRESS.replace("E", "e"),
        "core.coins.ethereum.address-wrong-eip55-checksum",
      ],
    ];
    for (const [coin, text, code] of refused)
      expect(() => parseCoinAddress(coin, text), `${coin} ${text}`).toThrow(
        expect.objectContaining({
          code,
          message: matching(/^The address cannot be used for the check: .+\.$/u),
        }),
      );
    expect(new Set(refused.map(([, , code]) => code)).size).toBe(refused.length);
  });
});

describe("the coins", () => {
  it("are listed by their names in alphabetical order, with their address forms", () => {
    expect(COINS.map(({ id, name, addressForms }) => [id, name, addressForms])).toEqual([
      ["bitcoin", "Bitcoin", "1…, 3…, bc1q… or bc1p…"],
      ["bitcoin-cash", "Bitcoin Cash", "bitcoincash:q… or 1…"],
      ["cosmos", "Cosmos", "cosmos1…"],
      ["dash", "Dash", "X… or dash1k…"],
      ["dogecoin", "Dogecoin", "D…"],
      ["ethereum", "Ethereum and EVM networks", "0x…"],
      ["ethereum-classic", "Ethereum Classic", "0x…"],
      ["injective", "Injective", "inj1…"],
      ["litecoin", "Litecoin", "L…, M…, 3… or ltc1q…"],
      ["tron", "Tron", "T…"],
      ["xrp", "XRP", "r…"],
      ["zcash", "Zcash", "t1…"],
    ]);
    const names = COINS.map(({ name }) => name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("are found by their identifiers, in either case", () => {
    for (const coin of COINS) expect(coinById(coin.id)).toBe(coin);
    expect(coinById(" Bitcoin-Cash ").id).toBe("bitcoin-cash");
    expect(refusal(() => coinById("solana"))).toBe(
      "Unknown coin; the coins are bitcoin, bitcoin-cash, cosmos, dash, dogecoin, ethereum, ethereum-classic, injective, litecoin, tron, xrp, zcash.",
    );
  });

  it("name the type of an address where they have several", () => {
    const described = (coin: CoinId, text: string) => coinById(coin).parse(text).description;
    const nestedSegwit = addressAt("bitcoin", "m/49'/0'/0'/0/0");
    expect(described("bitcoin", nestedSegwit)).toBe("nested SegWit (BIP49)");
    expect(described("bitcoin", addressAt("bitcoin", "m/84'/1'/0'/0/0"))).toBe(
      "testnet, native SegWit (BIP84)",
    );
    expect(described("litecoin", firstReceivingOf("litecoin"))).toBe("legacy (BIP44)");
    expect(described("zcash", firstReceivingOf("zcash"))).toBe("transparent");
    expect(described("ethereum", ETHEREUM_ADDRESS.toLowerCase())).toBeUndefined();
    expect(described("dash", firstReceivingOf("dash"))).toBe("Core (BIP44)");
    expect(described("dash", PLATFORM_ADDRESS)).toBe("Platform payment (DIP17)");
  });
});

describe("an address of another coin (AUD-010-API003)", () => {
  /**
   * One valid address of each coin, from the coins' own self-test vectors: its first receiving
   * address and the other forms that a coin has.
   */
  const SAMPLES: Readonly<Record<CoinId, readonly string[]>> = {
    bitcoin: [LEGACY_ADDRESS, addressAt("bitcoin", "m/49'/0'/0'/0/0"), TEST_ADDRESS],
    "bitcoin-cash": [firstReceivingOf("bitcoin-cash")],
    cosmos: [firstReceivingOf("cosmos")],
    dash: [firstReceivingOf("dash"), addressAt("dash", "m/9'/5'/17'/0'/0'/1")],
    dogecoin: [firstReceivingOf("dogecoin")],
    ethereum: [
      ETHEREUM_ADDRESS,
      // Mixed case whose small letters all fit CashAddr's alphabet.
      "0x7f0d20e7C84e6f66D83de2c004434D9A522A62FD",
    ],
    "ethereum-classic": [firstReceivingOf("ethereum-classic")],
    injective: [firstReceivingOf("injective")],
    litecoin: [firstReceivingOf("litecoin"), addressAt("litecoin", "m/84'/2'/3'/1/7")],
    tron: [firstReceivingOf("tron")],
    // The second fits the alphabet of CashAddr in small letters, so Bitcoin Cash met its case rule.
    xrp: [firstReceivingOf("xrp"), "rwRxAXgcHjLz6exJdcQ9ugkk8xhNNvNFHP"],
    zcash: [firstReceivingOf("zcash")],
  };
  /**
   * Addresses that two coins share by design: Bitcoin's legacy 1… is Bitcoin Cash's too, a 3… is
   * Litecoin's old form, the 0x of Ethereum and Ethereum Classic is the same account, and a 3…
   * on Bitcoin Cash is a script, refused as one.
   */
  const SHARED = (address: string, coin: CoinId): boolean =>
    (address.startsWith("1") && coin === "bitcoin-cash") ||
    (address.startsWith("3") && (coin === "litecoin" || coin === "bitcoin-cash")) ||
    (address.startsWith("0x") && (coin === "ethereum" || coin === "ethereum-classic"));

  it("is refused by every other coin as not its own, never as damaged", () => {
    for (const { id: owner } of COINS)
      for (const address of SAMPLES[owner]) {
        expect(coinById(owner).parse(address).text.toLowerCase()).toBe(address.toLowerCase());
        for (const coin of COINS) {
          if (coin.id === owner || SHARED(address, coin.id)) continue;
          expect(() => coin.parse(address), `${address} as ${coin.id}`).toThrow(
            `it is not an address of ${coin.name}`,
          );
        }
      }
  });

  it("is still refused as damaged where its checksum fails", () => {
    // Dash's first address with its last character changed.
    const damagedDash = `${firstReceivingOf("dash").slice(0, -1)}6`;
    expect(() => coinById("dash").parse(damagedDash)).toThrow("its checksum or format is wrong");
    expect(() => coinById("xrp").parse(DAMAGED_ADDRESS)).toThrow("its checksum or format is wrong");
    const nestedSegwit = addressAt("bitcoin", "m/49'/0'/0'/0/0");
    expect(() => coinById("bitcoin-cash").parse(nestedSegwit)).toThrow(
      "it is not the address of a single key",
    );
    // Bitcoin Cash's own address with one capital is still refused for its case.
    const oneCapital = firstReceivingOf("bitcoin-cash").replace(":q", ":Q");
    expect(() => coinById("bitcoin-cash").parse(oneCapital)).toThrow(
      "it mixes capital and small letters, which CashAddr does not allow",
    );
  });
});

describe("the known answers of Ethereum alone (a host of one coin family)", () => {
  it("pass for Ethereum, for Ethereum Classic and Tron, and for the three together", async () => {
    const { ETHEREUM_ADDRESS_SELF_TEST } = await import("../src/core/coins/ethereum-self-test.js");
    const { ETHEREUM_CLASSIC_AND_TRON_ADDRESS_SELF_TEST, EVM_ADDRESS_SELF_TEST } =
      await import("../src/core/coins/evm-self-test.js");
    for (const feature of [
      ETHEREUM_ADDRESS_SELF_TEST,
      ETHEREUM_CLASSIC_AND_TRON_ADDRESS_SELF_TEST,
      EVM_ADDRESS_SELF_TEST,
    ]) {
      feature.startup();
      await feature.check.run();
    }
    expect(ETHEREUM_ADDRESS_SELF_TEST.check.name).toBe("Ethereum addresses");
  });

  it("carry no vector of Ethereum Classic or Tron in Ethereum's module", () => {
    const ethereumOnly = readFileSync("src/core/coins/ethereum-self-test.ts", "utf8");
    for (const other of ["0xFA22515E", "TUEZSdKs", "TTD7MudE", "ETHEREUM_CLASSIC", "TRON"])
      expect(ethereumOnly).not.toContain(other);
  });

  it("fails when a known answer is wrong", async () => {
    const { coinFamilySelfTest } = await import("../src/core/coins/coin-self-test.js");
    const ethereum = coinById("ethereum");
    const wrong = coinFamilySelfTest({
      name: "Ethereum addresses",
      vectors: [
        // The second address given at the first one's path.
        {
          coin: ethereum,
          passphrase: "",
          path: "m/44'/60'/0'/0/0",
          address: addressAt("ethereum", "m/44'/60'/3'/1/7"),
        },
      ],
      startup: [0],
      elsewhere: 0,
      refused: [],
    });
    expect(() => wrong.startup()).toThrow("mismatch");
  });
});
