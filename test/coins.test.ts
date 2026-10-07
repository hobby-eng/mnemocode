// The coins of src/core/coins.ts and the "coin-address" evidence of src/core/wallet-evidence.ts:
// where the wallets of the public test phrase put each address, what is refused and why, the case
// rules and the standard forms. Public test phrases and public or independently computed vectors
// only.
import { pbkdf2Sync } from "node:crypto";
import { HDKey } from "@scure/bip32";
import { bech32, bech32m } from "@scure/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COINS, coinById, parseCoinAddress, type CoinId } from "../src/core/coins.js";
import {
  WalletEvidenceCheck,
  assertBitcoinEvidence,
  assertWalletEvidence,
  type AddressLocation,
  type Pbkdf2HmacSha512,
  type WalletEvidence,
} from "../src/core/wallet-evidence.js";
import { matchBitcoinEvidence, walletCheckOf } from "../src/bitcoin-evidence.js";

/** The public BIP39 test phrase of BIP84, BIP86 and many wallets. */
const ABANDON = "abandon ".repeat(11) + "about";
/** The BIP39 test vector of entropy ff…ff: another wallet. */
const ZOO = "zoo ".repeat(11) + "wrong";

const nodePbkdf2: Pbkdf2HmacSha512 = (password, salt, rounds, bytes) =>
  Uint8Array.from(pbkdf2Sync(password, salt, rounds, bytes, "sha512"));
const check = new WalletEvidenceCheck(nodePbkdf2);

/**
 * Where the wallets of the public test phrase put each address: coin, BIP39 passphrase, path,
 * address. The Bitcoin mainnet values at index 0 are the published vectors of BIP44, BIP49, BIP84
 * and BIP86, and the Dash Platform ones the official DIP17/DIP18 vectors, receiving key class 0'
 * and change key class 1'. The other Bitcoin values were computed independently with Python's
 * hashlib and agree with BIP49's testnet vector; the other coins were computed independently with
 * @scure/bip32, @noble/hashes, @noble/curves and @scure/base, and ethers for EIP-55, at the first
 * address and at account 3, change branch, index 7.
 */
const ADDRESSES: readonly (readonly [CoinId, string, string, string])[] = [
  ["bitcoin", "", "m/44'/0'/0'/0/0", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"],
  ["bitcoin", "", "m/49'/0'/0'/0/0", "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf"],
  ["bitcoin", "", "m/84'/0'/0'/0/0", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"],
  ["bitcoin", "", "m/84'/0'/0'/0/1", "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"],
  ["bitcoin", "", "m/84'/0'/0'/1/0", "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"],
  [
    "bitcoin",
    "",
    "m/86'/0'/0'/0/0",
    "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  ],
  [
    "bitcoin",
    "",
    "m/86'/0'/0'/1/0",
    "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
  ],
  ["bitcoin", "", "m/44'/0'/3'/1/7", "12DCYXCcRpBJ5VoWDvSijepPu8mshEihvX"],
  ["bitcoin", "", "m/49'/0'/3'/1/7", "3K7gGbTWfdq3kyBgkVTMbhfftnrhxB6jpW"],
  ["bitcoin", "", "m/84'/0'/3'/1/7", "bc1q8r4wsa3nye5qypv80vpfg4sh99uf02u5mmh5ry"],
  [
    "bitcoin",
    "",
    "m/86'/0'/3'/1/7",
    "bc1preq6saz8z9zrn3clx9eaen0dcsynwseakek7nwqlrj52wd2dsfsqlfsyut",
  ],
  ["bitcoin", "", "m/44'/1'/0'/0/0", "mkpZhYtJu2r87Js3pDiWJDmPte2NRZ8bJV"],
  ["bitcoin", "", "m/49'/1'/0'/0/0", "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2"],
  ["bitcoin", "", "m/84'/1'/0'/0/0", "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl"],
  [
    "bitcoin",
    "",
    "m/86'/1'/0'/0/0",
    "tb1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqlqt9zj",
  ],
  ["bitcoin", "TREZOR", "m/84'/0'/0'/0/0", "bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu"],
  ["ethereum", "", "m/44'/60'/0'/0/0", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"],
  ["ethereum", "", "m/44'/60'/3'/1/7", "0xc1A30611797762aea209daC2aC7E900f0cE95f9e"],
  ["xrp", "", "m/44'/144'/0'/0/0", "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3"],
  ["xrp", "", "m/44'/144'/3'/1/7", "rnU3BdqhZk8DL3FKjQcaAyf3DJSoUZD8eM"],
  ["tron", "", "m/44'/195'/0'/0/0", "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH"],
  ["tron", "", "m/44'/195'/3'/1/7", "TTD7MudE8L26nvnrEf2LHzXm6stKRpFZH1"],
  ["zcash", "", "m/44'/133'/0'/0/0", "t1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F"],
  ["zcash", "", "m/44'/133'/3'/1/7", "t1Pii1UXFrpcFucY5NBEFa664pymr7boHq4"],
  ["dogecoin", "", "m/44'/3'/0'/0/0", "DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC"],
  ["dogecoin", "", "m/44'/3'/3'/1/7", "DNuJKZiVoQ6t67t8dE4NuBDhd2FNpMBsg6"],
  [
    "bitcoin-cash",
    "",
    "m/44'/145'/0'/0/0",
    "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6",
  ],
  [
    "bitcoin-cash",
    "",
    "m/44'/145'/3'/1/7",
    "bitcoincash:qrhejavdmlfh9eajjxra3s3mn8gxls9hkvsq2yd62y",
  ],
  ["bitcoin-cash", "", "m/44'/145'/0'/0/0", "1mW6fDEMjKrDHvLvoEsaeLxSCzZBf3Bfg"],
  // A Bitcoin Cash wallet on Bitcoin's coin type, found on the second path.
  ["bitcoin-cash", "", "m/44'/0'/0'/0/0", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"],
  ["litecoin", "", "m/44'/2'/0'/0/0", "LUWPbpM43E2p7ZSh8cyTBEkvpHmr3cB8Ez"],
  ["litecoin", "", "m/49'/2'/0'/0/0", "M7wtsL7wSHDBJVMWWhtQfTMSYYkyooAAXM"],
  ["litecoin", "", "m/84'/2'/3'/1/7", "ltc1qnnphcvq5zgyf4f0uepust6d7gyt2zl69vftnz2"],
  ["ethereum-classic", "", "m/44'/61'/0'/0/0", "0xFA22515E43658ce56A7682B801e9B5456f511420"],
  // An Ethereum Classic wallet on Ethereum's coin type, found on the second path.
  ["ethereum-classic", "", "m/44'/60'/0'/0/0", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"],
  ["cosmos", "", "m/44'/118'/0'/0/0", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4"],
  ["cosmos", "", "m/44'/118'/3'/1/7", "cosmos1j8dc8g9sux68h924yj646shrsjmkd7g6fwevky"],
  ["injective", "", "m/44'/60'/0'/0/0", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz"],
  ["dash", "", "m/44'/5'/0'/0/0", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5"],
  ["dash", "", "m/44'/5'/3'/1/7", "XbAei18dD6mdL9LR6sTmbFJTQAJBcpxuxL"],
  ["dash", "", "m/9'/5'/17'/0'/0'/0", "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs"],
  ["dash", "", "m/9'/5'/17'/0'/0'/1", "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw"],
  ["dash", "", "m/9'/5'/17'/0'/1'/0", "dash1kpkeye606ez89g7lelp7hnldwwpt76va0v3j6x28"],
];

/** The account, branch and index of a path: its last three steps, DIP17's hardened ones too. */
function locationOf(path: string): AddressLocation {
  const [account, branch, index] = path
    .split("/")
    .slice(-3)
    .map((step) => Number.parseInt(step, 10));
  return { account: account!, branch: branch!, index: index! };
}

function coinAddress(coin: string, value: string, location: AddressLocation): WalletEvidence {
  return { kind: "coin-address", coin: coin as CoinId, value, location };
}

/** The message of what `run` throws. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Nothing was refused.");
}

describe("addresses of every coin, where the wallets of the public phrase put them", () => {
  it("are the 43 vectors", () => {
    expect(ADDRESSES).toHaveLength(43);
    expect(new Set(ADDRESSES.map(([coin]) => coin))).toEqual(new Set(COINS.map(({ id }) => id)));
  });

  it.each(ADDRESSES)("%s %j at %s: %s", (coin, passphrase, path, address) => {
    const evidence = coinAddress(coin, address, locationOf(path));
    expect(check.match(ABANDON, evidence, passphrase)).toEqual({
      matched: true,
      kind: "coin-address",
      derived: address,
      path,
    });
  });

  it("are found by the Node.js module and with a PBKDF2 that answers later", async () => {
    const [coin, , path, address] = ADDRESSES[34]!;
    const evidence = coinAddress(coin, address, locationOf(path));
    const expected = { matched: true, kind: "coin-address", derived: address, path };
    expect(matchBitcoinEvidence(ABANDON, evidence)).toEqual(expected);
    expect(walletCheckOf(evidence)!(ABANDON)).toEqual(expected);
    const later = new WalletEvidenceCheck(async (...parameters) => nodePbkdf2(...parameters));
    await expect(later.matchAsync(ABANDON, evidence)).resolves.toEqual(expected);
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
    // Computed independently with Python's hashlib.
    const evidence = coinAddress("bitcoin", "bc1q4du7e3vw34vsflf76xf9h8gktms9wzqcl7vlh5", {
      account: 2,
      branch: 1,
      index: 19,
    });
    expect(check.match(ABANDON, evidence).path).toBe("m/84'/0'/2'/1/19");
  });

  it("are found among several addresses in a row, from the location's index on", () => {
    // The DIP17/DIP18 vector of the second receiving key, and the one deep in account 2 above.
    const platform = "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw";
    const first = { account: 0, branch: 0, index: 0 };
    expect(check.match(ABANDON, coinAddress("dash", platform, first)).matched).toBe(false);
    expect(
      check.match(ABANDON, { ...coinAddress("dash", platform, first), addresses: 20 }).path,
    ).toBe("m/9'/5'/17'/0'/0'/1");
    const deep = "bc1q4du7e3vw34vsflf76xf9h8gktms9wzqcl7vlh5";
    const account2 = { account: 2, branch: 1, index: 0 };
    expect(
      check.match(ABANDON, { ...coinAddress("bitcoin", deep, account2), addresses: 20 }).path,
    ).toBe("m/84'/0'/2'/1/19");
    expect(
      check.match(ABANDON, { ...coinAddress("bitcoin", deep, account2), addresses: 19 }).matched,
    ).toBe(false);
    expect(() =>
      assertWalletEvidence({ ...coinAddress("bitcoin", deep, account2), addresses: 0 }),
    ).toThrow("The number of addresses compared must be an integer");
  });

  it("are not found elsewhere, with another passphrase or in another wallet", () => {
    const address = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
    const notFound = { matched: false, kind: "coin-address" };
    const first = { account: 0, branch: 0, index: 0 };
    for (const location of [
      { ...first, index: 1 },
      { ...first, branch: 1 },
      { ...first, account: 1 },
    ])
      expect(check.match(ABANDON, coinAddress("bitcoin", address, location))).toEqual(notFound);
    expect(check.match(ABANDON, coinAddress("bitcoin", address, first), "TREZOR")).toEqual(
      notFound,
    );
    for (const [coin, , path, text] of ADDRESSES.filter(([, passphrase]) => passphrase === ""))
      expect(check.match(ZOO, coinAddress(coin, text, locationOf(path))), text).toEqual(notFound);
  });

  it("are compared on the paths of their type, coin types and network", () => {
    const paths = (coin: CoinId, text: string, location = { account: 3, branch: 1, index: 7 }) =>
      coinById(coin).parse(text).pathsAt(location);
    expect(paths("bitcoin-cash", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA")).toEqual([
      "m/44'/145'/3'/1/7",
      "m/44'/0'/3'/1/7",
    ]);
    expect(paths("ethereum-classic", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94")).toEqual([
      "m/44'/61'/3'/1/7",
      "m/44'/60'/3'/1/7",
    ]);
    expect(paths("bitcoin", "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2")).toEqual(["m/49'/1'/3'/1/7"]);
    expect(paths("injective", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz")).toEqual([
      "m/44'/60'/3'/1/7",
    ]);
    expect(paths("dash", "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs")).toEqual([
      "m/9'/5'/17'/3'/1'/7",
    ]);
  });
});

describe("the comparison", () => {
  afterEach(() => vi.restoreAllMocks());

  it("wipes the seed and every key it derives, on the way to each address too", async () => {
    const seeds: Uint8Array[] = [];
    const host: Pbkdf2HmacSha512 = (...parameters) => {
      const seed = nodePbkdf2(...parameters);
      seeds.push(seed);
      return seed;
    };
    const now = new WalletEvidenceCheck(host);
    const later = new WalletEvidenceCheck(async (...parameters) => host(...parameters));
    const roots = vi.spyOn(HDKey, "fromMasterSeed");
    const children = vi.spyOn(HDKey.prototype, "deriveChild");
    const [, , platformPath, platformAddress] = ADDRESSES[42]!;
    // Found on the second of Bitcoin Cash's two paths of five steps, and on DIP17's six steps.
    const evidence = [
      coinAddress("bitcoin-cash", ADDRESSES[29]![3], { account: 0, branch: 0, index: 0 }),
      coinAddress("dash", platformAddress, locationOf(platformPath)),
    ];
    for (const each of evidence) {
      expect(now.match(ABANDON, each).matched).toBe(true);
      expect((await later.matchAsync(ABANDON, each)).matched).toBe(true);
    }
    const nodes = [...roots.mock.results, ...children.mock.results].map(
      ({ value }) => value as HDKey,
    );
    // Each comparison twice: a root and 2 × 5 steps, then a root and 6 steps.
    expect(nodes).toHaveLength(2 * (1 + 10 + 1 + 6));
    for (const node of nodes) expect(node.privateKey).toBeNull();
    expect(seeds).toHaveLength(4);
    for (const seed of seeds) expect(seed.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses evidence that no wallet can match before the host's PBKDF2 is called", () => {
    const calls: unknown[] = [];
    const recording = new WalletEvidenceCheck((...parameters) => {
      calls.push(parameters);
      return nodePbkdf2(...parameters);
    });
    const first = { account: 0, branch: 0, index: 0 };
    const address = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
    const refused: readonly [WalletEvidence, string][] = [
      [coinAddress("solana", address, first), 'Unknown coin "solana"; the coins are bitcoin,'],
      [
        coinAddress("litecoin", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA", first),
        "it is not an address of Litecoin",
      ],
      [coinAddress("bitcoin", `${address.slice(0, -1)}v`, first), "checksum or format"],
      [coinAddress("bitcoin", address, { ...first, index: -1 }), "index must be an integer"],
      [
        coinAddress("dash", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5", { ...first, branch: 2 ** 31 }),
        "branch must be an integer from 0 through 2147483647.",
      ],
      [
        coinAddress("ethereum", ADDRESSES[16]![3], { ...first, account: 1.5 }),
        "account must be an integer from 0 through 2147483647.",
      ],
      [coinAddress("ethereum", address, first), "not an address of Ethereum"],
    ];
    for (const [evidence, reason] of refused) {
      expect(refusal(() => recording.match(ABANDON, evidence))).toContain(reason);
      expect(() => assertWalletEvidence(evidence)).toThrow();
      expect(() => assertBitcoinEvidence(evidence)).toThrow();
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
    expect(parseCoinAddress("zcash", "t1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F")).toBe(
      "t1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F",
    );
  });

  it("are refused for scripts and several keys, naming why", () => {
    for (const [coin, text, reason] of [
      // P2WSH, a script rather than a single key.
      [
        "bitcoin",
        "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        "only single-key addresses (bc1q with 42 characters, bc1p or ltc1q) can be checked",
      ],
      // A P2SH CashAddr address.
      [
        "bitcoin-cash",
        "bitcoincash:pqkh9ahfj069qv8l6eysyufazpe4fdjq3u4hna323j",
        "only single-key addresses (bitcoincash:q…) can be checked",
      ],
      // Zcash's P2SH "t3…".
      ["zcash", "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd", "it is not an address of Zcash (t1…)"],
    ] as const)
      expect(refusal(() => parseCoinAddress(coin, text))).toContain(reason);
  });

  it("are refused for Dash Orchard and other Platform types, and need the one encoding", () => {
    const encoded = (payload: Uint8Array) => bech32m.encode("dash", bech32m.toWords(payload));
    const payment = Uint8Array.of(0xb0, ...new Array<number>(20).fill(0x11));
    expect(refusal(() => parseCoinAddress("dash", encoded(payment.subarray(0, 20))))).toContain(
      "it has the wrong length",
    );
    // Another type byte, such as a script's, is not a single key's payment address.
    const script = Uint8Array.of(0x80, ...payment.subarray(1));
    expect(refusal(() => parseCoinAddress("dash", encoded(script)))).toContain(
      "it is not the Platform payment address of a single key",
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
      expect(bech32m.decode(malformed as `${string}1${string}`).prefix).toBe("dash");
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

  it("are refused for Cosmos SDK accounts with a Bech32m checksum or the wrong length", () => {
    // The public Cosmos and Injective vectors re-encoded with a Bech32m checksum.
    for (const [coin, text] of [
      ["cosmos", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0afua36h"],
      ["injective", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55k94rgq"],
    ] as const)
      expect(refusal(() => parseCoinAddress(coin, text))).toContain("checksum or format");
    // A valid account of another chain's prefix is not this coin's address.
    expect(
      refusal(() => parseCoinAddress("injective", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4")),
    ).toContain("it is not an address of Injective (inj1…)");
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
      expect(bech32.decode(text as `${string}1${string}`).words).toHaveLength(33);
      for (const input of [text, text.toUpperCase()])
        expect(refusal(() => parseCoinAddress(coin, input))).toContain("it has the wrong length");
    }
  });

  it("are refused as damaged past Bech32's limits: 1023 characters, a prefix of 83", () => {
    const payment = Uint8Array.of(0xb0, ...new Array<number>(20).fill(0x11));
    for (const [coin, checksum, prefix, words, name] of [
      ["cosmos", bech32, "cosmos", bech32.toWords(new Uint8Array(20).fill(7)), "Cosmos"],
      ["dash", bech32m, "dash", bech32m.toWords(payment), "Dash"],
    ] as const) {
      // Zero groups after the data, to `length` with the prefix, its separator and the checksum.
      const atLength = (length: number) => {
        const zeros = new Array<number>(length - prefix.length - 7 - words.length).fill(0);
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
      ["bitcoin", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv"], // checksum changed
      ["bitcoin", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabB"], // checksum changed
      ["bitcoin", "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"], // P2WSH
      ["bitcoin", "ltc1qcr8te4kr609gcawutmrza0j4xv80jy8zkvrefp"], // another coin
      ["bitcoin", "LUWPbpM43E2p7ZSh8cyTBEkvpHmr3cB8Ez"], // another coin
      ["litecoin", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"], // another coin
      ["tron", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"], // another coin
      ["ethereum", "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH"], // another coin
      ["ethereum", "0x9858EfFD232B4033E47d90003D41EC34EcaEda"], // too short
      ["xrp", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"], // another alphabet
      ["cosmos", "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz"], // another chain
      ["bitcoin-cash", "bitcoincash:pqkh9ahfj069qv8l6eysyufazpe4fdjq3u4hna323j"], // P2SH
      ["bitcoin-cash", "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q7"], // checksum changed
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
      ["bitcoin", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"],
      ["bitcoin", "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr"],
      ["bitcoin", "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl"],
      ["litecoin", "ltc1qnnphcvq5zgyf4f0uepust6d7gyt2zl69vftnz2"],
      ["cosmos", "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4"],
      ["bitcoin-cash", "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6"],
    ] as const) {
      const upper = lower.toUpperCase();
      expect(parseCoinAddress(coin, upper)).toBe(lower);
      const mixed = upper.slice(0, 14) + lower.slice(14);
      expect(() => parseCoinAddress(coin, mixed), mixed).toThrow();
    }
  });

  it("may leave out the CashAddr prefix, for the same key as the legacy form", () => {
    const withoutPrefix = "qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6";
    expect(parseCoinAddress("bitcoin-cash", withoutPrefix.toUpperCase())).toBe(
      `bitcoincash:${withoutPrefix}`,
    );
    const first = { account: 0, branch: 0, index: 0 };
    for (const text of [withoutPrefix, "1mW6fDEMjKrDHvLvoEsaeLxSCzZBf3Bfg"])
      expect(check.match(ABANDON, coinAddress("bitcoin-cash", text, first)).path).toBe(
        "m/44'/145'/0'/0/0",
      );
  });

  it("is checked by EIP-55 in mixed case only", () => {
    const checksummed = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
    for (const same of [
      checksummed.toLowerCase(),
      `0x${checksummed.slice(2).toUpperCase()}`,
      `0X${checksummed.slice(2)}`,
    ])
      expect(parseCoinAddress("ethereum", same), same).toBe(checksummed);
    // One capital made small breaks the checksum.
    expect(
      refusal(() => parseCoinAddress("ethereum", "0x9858efFD232B4033E47d90003D41EC34EcaEda94")),
    ).toContain("its EIP-55 checksum, the mix of capital and small letters, is wrong");
  });
});

describe("parseCoinAddress", () => {
  it("gives each address in its standard form", () => {
    for (const [coin, typed, standard] of [
      ["bitcoin", "  BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU\n", ADDRESSES[2]![3]],
      ["bitcoin", ` ${ADDRESSES[0]![3]} `, ADDRESSES[0]![3]],
      ["ethereum-classic", "0xfa22515e43658ce56a7682b801e9b5456f511420", ADDRESSES[33]![3]],
      ["dash", ADDRESSES[40]![3].toUpperCase(), ADDRESSES[40]![3]],
      ["injective", ADDRESSES[37]![3].toUpperCase(), ADDRESSES[37]![3]],
      ["xrp", `\t${ADDRESSES[18]![3]}`, ADDRESSES[18]![3]],
    ] as const)
      expect(parseCoinAddress(coin, typed)).toBe(standard);
  });

  it("trims Unicode white space only", () => {
    const address = ADDRESSES[2]![3];
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
    expect(refusal(() => parseCoinAddress("litecoin", ADDRESSES[0]![3]))).toBe(
      "The address cannot be used for the check: it is not an address of Litecoin (L…, M…, 3… or ltc1q…).",
    );
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
      'Unknown coin "solana"; the coins are bitcoin, bitcoin-cash, cosmos, dash, dogecoin, ethereum, ethereum-classic, injective, litecoin, tron, xrp, zcash.',
    );
  });

  it("name the type of an address where they have several", () => {
    const described = (coin: CoinId, text: string) => coinById(coin).parse(text).description;
    expect(described("bitcoin", "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf")).toBe(
      "nested SegWit (BIP49)",
    );
    expect(described("bitcoin", "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl")).toBe(
      "testnet, native SegWit (BIP84)",
    );
    expect(described("litecoin", "LUWPbpM43E2p7ZSh8cyTBEkvpHmr3cB8Ez")).toBe("legacy (BIP44)");
    expect(described("zcash", "t1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F")).toBe("transparent");
    expect(described("ethereum", "0x9858effd232b4033e47d90003d41ec34ecaeda94")).toBeUndefined();
    expect(described("dash", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5")).toBe("Core (BIP44)");
    expect(described("dash", "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs")).toBe(
      "Platform payment (DIP17)",
    );
  });
});
