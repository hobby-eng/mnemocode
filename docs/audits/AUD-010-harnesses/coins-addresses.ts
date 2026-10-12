// AUD-010 coins reviewer, probe "coins-addresses": every coin and address type of MnemoCode,
// compared with published vectors and with the independent oracle of coins-oracle.ts, through the
// production entry points matchWalletEvidence (src/bitcoin-evidence.ts, node:crypto PBKDF2) and
// Coin.parse (src/core/coins.ts).
//
// Run: node --import tsx docs/audits/AUD-010-harnesses/coins-addresses.ts
// Exit code: 0 when every comparison holds, 1 otherwise. Every compared value is printed.

import { matchWalletEvidence, masterFingerprint } from "../../../src/bitcoin-evidence.js";
import { coinById, COINS, type CoinId } from "../../../src/core/coins.js";
import {
  ABANDON,
  addressOf,
  base58check,
  base58Decode,
  bech32Encode,
  cashAddress,
  convertBits,
  derive,
  eip55,
  fingerprintOf,
  hexOf,
  masterOf,
  nodeOfXprv,
  seedOf,
  segwitAddress,
  XRP_ALPHABET,
  type CoinSpec,
} from "./coins-oracle.js";

let failures = 0;
let checks = 0;
/** JSON with object keys sorted, so that key order does not decide a comparison. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );
}
function same(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = canonical(actual) === canonical(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n     actual:   ${JSON.stringify(actual)}\n     expected: ${JSON.stringify(expected)}`);
}

const seed = seedOf(ABANDON);
const trezorSeed = seedOf(ABANDON, "TREZOR");

console.log("== 1. The oracle first reproduces published vectors ==");
// BIP39 vectors.json (trezor/python-mnemonic), first entry: seed with passphrase TREZOR.
same(
  "BIP39 vector 1 seed (passphrase TREZOR)",
  hexOf(trezorSeed),
  "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04",
);
// BIP39 vectors.json, first entry: bip32_xprv of that seed.
{
  const published = nodeOfXprv(
    "xprv9s21ZrQH143K3h3fDYiay8mocZ3afhfULfb5GX8kCBdno77K4HiA15Tg23wpbeF1pLfs1c5SPmYHrEpTuuRhxMwvKDwqdKiGJS9XFKzUsAF",
  ).node;
  const mine = masterOf(trezorSeed);
  same("BIP39 vector 1 bip32_xprv master key", mine.key.toString(16), published.key.toString(16));
  same("BIP39 vector 1 bip32_xprv chain code", hexOf(mine.chain), hexOf(published.chain));
}
// BIP84 test vectors: rootpriv of "abandon ... about", empty passphrase.
{
  const published = nodeOfXprv(
    "xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu",
  ).node;
  const mine = masterOf(seed);
  same("BIP84 rootpriv master key", mine.key.toString(16), published.key.toString(16));
  same("BIP84 rootpriv chain code", hexOf(mine.chain), hexOf(published.chain));
  same("Master fingerprint 73c5da0a (oracle)", fingerprintOf(mine), "73c5da0a");
}
const PUBLISHED: readonly [string, string, CoinSpec, string][] = [
  // [source, path, spec, address]
  ["BIP84 vector", "m/84'/0'/0'/0/0", { kind: "p2wpkh", hrp: "bc" }, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"],
  ["BIP84 vector", "m/84'/0'/0'/0/1", { kind: "p2wpkh", hrp: "bc" }, "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"],
  ["BIP84 vector", "m/84'/0'/0'/1/0", { kind: "p2wpkh", hrp: "bc" }, "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"],
  ["BIP86 vector", "m/86'/0'/0'/0/0", { kind: "p2tr", hrp: "bc" }, "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr"],
  ["BIP86 vector", "m/86'/0'/0'/0/1", { kind: "p2tr", hrp: "bc" }, "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh"],
  ["BIP86 vector", "m/86'/0'/0'/1/0", { kind: "p2tr", hrp: "bc" }, "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7"],
  ["BIP49 vector (testnet)", "m/49'/1'/0'/0/0", { kind: "p2sh-p2wpkh", version: [0xc4] }, "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2"],
  ["widely published BIP44 first address", "m/44'/0'/0'/0/0", { kind: "p2pkh", version: [0x00] }, "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"],
  ["widely published Ethereum first account (EIP-55)", "m/44'/60'/0'/0/0", { kind: "evm" }, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"],
];
for (const [source, path, spec, address] of PUBLISHED)
  same(`oracle reproduces ${source} ${path}`, addressOf(derive(seed, path), spec), address);
// BIP173 / BIP350 encodings of known programs.
same(
  "oracle Bech32 = BIP173 P2WPKH example",
  segwitAddress("bc", 0, Uint8Array.from(Buffer.from("751e76e8199196d454941c45d1b3a323f1433bd6", "hex"))),
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
);
same(
  "oracle Bech32m = BIP350 P2TR example",
  segwitAddress("bc", 1, Uint8Array.from(Buffer.from("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "hex"))),
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
);
// CashAddr specification, test vectors of legacy and CashAddr pairs.
for (const [legacy, cash] of [
  ["1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu", "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a"],
  ["1KXrWXciRDZUpQwQmuM1DbwsKDLYAYsVLR", "bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy"],
  ["16w1D5WRVKJuZUsSRzdLp9w3YGcgoxDXb", "bitcoincash:qqq3728yw0y47sqn6l2na30mcw6zm78dzqre909m2r"],
] as const) {
  const hash = base58Decode(legacy).subarray(1, 21);
  same(`oracle CashAddr = spec vector ${legacy}`, cashAddress("bitcoincash", 0, hash), cash);
}
// XRP Ledger: the genesis account and its published account ID.
same(
  "oracle XRP alphabet = genesis account rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  base58check(Uint8Array.from(Buffer.from("00b5f762798a53d543a014caf8b297cff8f2f937e8", "hex")), XRP_ALPHABET),
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
);
// EIP-55 published examples.
for (const vector of [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
])
  same(`oracle EIP-55 = published ${vector}`, eip55(Uint8Array.from(Buffer.from(vector.slice(2), "hex"))), vector);

// Dash Platform testnet addresses of a public Dash Desktop test phrase (cited in
// test/coins.test.ts): the oracle's own DIP17 path and DIP18 encoding must give them.
{
  const phrase = "deliver frame tomato ring tool second dream mutual fade sponsor visa teach";
  const desktop = [
    "tdash1kr0xt5wj85ht5u464rfysjrq75rewz9mysjwf59p",
    "tdash1kqgy7ngm2wf0zsv20k4mc62s5rapw26yeg6em4jq",
    "tdash1kzlatzl0u06uxrqz8hkc7naz9d2g3v8g7gw83ew3",
  ];
  desktop.forEach((address, index) =>
    same(
      `oracle DIP17/DIP18 testnet = Dash Desktop vector ${index}`,
      addressOf(derive(seedOf(phrase), `m/9'/1'/17'/0'/0'/${index}`), { kind: "dash-platform", hrp: "tdash" }),
      address,
    ),
  );
}

console.log("\n== 2. Production master fingerprint ==");
same("masterFingerprint(abandon … about) = 73c5da0a", masterFingerprint(ABANDON), "73c5da0a");
same("masterFingerprint(abandon … about, TREZOR) = oracle", masterFingerprint(ABANDON, "TREZOR"), fingerprintOf(masterOf(trezorSeed)));

console.log("\n== 3. Every coin and address type through matchWalletEvidence (coin-address) ==");
interface Case {
  readonly coin: CoinId;
  readonly spec: CoinSpec;
  /** Path prefix down to the branch level, with "{a}" for the account and "{b}" for the branch. */
  readonly branchPath: string;
  readonly label: string;
}
const CASES: readonly Case[] = [
  { coin: "bitcoin", label: "BIP44 legacy", spec: { kind: "p2pkh", version: [0x00] }, branchPath: "m/44'/0'/{a}'/{b}" },
  { coin: "bitcoin", label: "BIP49 nested SegWit", spec: { kind: "p2sh-p2wpkh", version: [0x05] }, branchPath: "m/49'/0'/{a}'/{b}" },
  { coin: "bitcoin", label: "BIP84 native SegWit", spec: { kind: "p2wpkh", hrp: "bc" }, branchPath: "m/84'/0'/{a}'/{b}" },
  { coin: "bitcoin", label: "BIP86 Taproot", spec: { kind: "p2tr", hrp: "bc" }, branchPath: "m/86'/0'/{a}'/{b}" },
  { coin: "bitcoin", label: "testnet BIP44", spec: { kind: "p2pkh", version: [0x6f] }, branchPath: "m/44'/1'/{a}'/{b}" },
  { coin: "bitcoin", label: "testnet BIP49", spec: { kind: "p2sh-p2wpkh", version: [0xc4] }, branchPath: "m/49'/1'/{a}'/{b}" },
  { coin: "bitcoin", label: "testnet BIP84", spec: { kind: "p2wpkh", hrp: "tb" }, branchPath: "m/84'/1'/{a}'/{b}" },
  { coin: "bitcoin", label: "testnet BIP86", spec: { kind: "p2tr", hrp: "tb" }, branchPath: "m/86'/1'/{a}'/{b}" },
  { coin: "bitcoin-cash", label: "CashAddr q", spec: { kind: "cashaddr" }, branchPath: "m/44'/145'/{a}'/{b}" },
  { coin: "bitcoin-cash", label: "legacy 1 on coin type 145", spec: { kind: "p2pkh", version: [0x00] }, branchPath: "m/44'/145'/{a}'/{b}" },
  { coin: "bitcoin-cash", label: "CashAddr on Bitcoin's coin type", spec: { kind: "cashaddr" }, branchPath: "m/44'/0'/{a}'/{b}" },
  { coin: "cosmos", label: "cosmos1", spec: { kind: "cosmos", hrp: "cosmos" }, branchPath: "m/44'/118'/{a}'/{b}" },
  { coin: "dash", label: "Core X", spec: { kind: "p2pkh", version: [0x4c] }, branchPath: "m/44'/5'/{a}'/{b}" },
  { coin: "dash", label: "Platform dash1k (DIP17 key class {b}')", spec: { kind: "dash-platform", hrp: "dash" }, branchPath: "m/9'/5'/17'/{a}'/{b}'" },
  { coin: "dash", label: "Platform testnet tdash1k", spec: { kind: "dash-platform", hrp: "tdash" }, branchPath: "m/9'/1'/17'/{a}'/{b}'" },
  { coin: "dogecoin", label: "D", spec: { kind: "p2pkh", version: [0x1e] }, branchPath: "m/44'/3'/{a}'/{b}" },
  { coin: "ethereum", label: "0x EIP-55", spec: { kind: "evm" }, branchPath: "m/44'/60'/{a}'/{b}" },
  { coin: "ethereum-classic", label: "0x on coin type 61", spec: { kind: "evm" }, branchPath: "m/44'/61'/{a}'/{b}" },
  { coin: "ethereum-classic", label: "0x on Ethereum's coin type 60", spec: { kind: "evm" }, branchPath: "m/44'/60'/{a}'/{b}" },
  { coin: "injective", label: "inj1 (Keccak account)", spec: { kind: "injective" }, branchPath: "m/44'/60'/{a}'/{b}" },
  { coin: "litecoin", label: "L", spec: { kind: "p2pkh", version: [0x30] }, branchPath: "m/44'/2'/{a}'/{b}" },
  { coin: "litecoin", label: "M", spec: { kind: "p2sh-p2wpkh", version: [0x32] }, branchPath: "m/49'/2'/{a}'/{b}" },
  { coin: "litecoin", label: "old 3 form of nested SegWit", spec: { kind: "p2sh-p2wpkh", version: [0x05] }, branchPath: "m/49'/2'/{a}'/{b}" },
  { coin: "litecoin", label: "ltc1q", spec: { kind: "p2wpkh", hrp: "ltc" }, branchPath: "m/84'/2'/{a}'/{b}" },
  { coin: "tron", label: "T (0x41 Keccak)", spec: { kind: "tron" }, branchPath: "m/44'/195'/{a}'/{b}" },
  { coin: "xrp", label: "r (XRP alphabet)", spec: { kind: "xrp" }, branchPath: "m/44'/144'/{a}'/{b}" },
  { coin: "zcash", label: "t1", spec: { kind: "p2pkh", version: [0x1c, 0xb8] }, branchPath: "m/44'/133'/{a}'/{b}" },
];
const LOCATIONS = [
  { account: 0, branch: 0, index: 0 },
  { account: 0, branch: 0, index: 1 },
  { account: 0, branch: 1, index: 0 },
  { account: 3, branch: 1, index: 7 },
];
const covered = new Set<string>();
for (const { coin, spec, branchPath, label } of CASES) {
  covered.add(coin);
  for (const location of LOCATIONS) {
    const path =
      branchPath.replace("{a}", String(location.account)).replace("{b}", String(location.branch)) +
      `/${location.index}`;
    const expected = addressOf(derive(seed, path), spec);
    const result = matchWalletEvidence(ABANDON, {
      kind: "coin-address",
      coin,
      value: expected,
      location,
    });
    same(`${coin} ${label} at ${path}`, result, { matched: true, kind: "coin-address", derived: expected, path });
    // The same address one index later must not match when exactly one address is compared.
    const away = matchWalletEvidence(ABANDON, {
      kind: "coin-address",
      coin,
      value: expected,
      location: { ...location, index: location.index + 1 },
      addresses: 1,
    });
    same(`${coin} ${label} at ${path}, given one index later`, away, { matched: false, kind: "coin-address" });
  }
}
same("every coin of COINS is covered", [...covered].sort(), COINS.map((c) => c.id).sort());

console.log("\n== 4. Bitcoin evidence kind 'address' with each profile (matchWalletEvidence) ==");
const PROFILES = [
  ["legacy", { kind: "p2pkh", version: [0x00] }, 44],
  ["nested-segwit", { kind: "p2sh-p2wpkh", version: [0x05] }, 49],
  ["native-segwit", { kind: "p2wpkh", hrp: "bc" }, 84],
  ["taproot", { kind: "p2tr", hrp: "bc" }, 86],
] as const;
for (const [profile, spec, purpose] of PROFILES)
  for (const location of LOCATIONS) {
    const path = `m/${purpose}'/0'/${location.account}'/${location.branch}/${location.index}`;
    const expected = addressOf(derive(seed, path), spec as CoinSpec);
    const result = matchWalletEvidence(ABANDON, {
      kind: "address",
      value: expected,
      profiles: [profile],
      location: { network: "mainnet", ...location },
      addresses: 1,
    });
    same(`bitcoin address ${profile} at ${path}`, result, { matched: true, kind: "address", derived: expected, path });
  }

console.log("\n== 5. Standard forms returned by Coin.parse ==");
const ethereum = addressOf(derive(seed, "m/44'/60'/0'/0/0"), { kind: "evm" });
same("ethereum lower case -> EIP-55", coinById("ethereum").parse(ethereum.toLowerCase()).text, ethereum);
same("ethereum upper-case digits -> EIP-55", coinById("ethereum").parse("0x" + ethereum.slice(2).toUpperCase()).text, ethereum);
const bc = addressOf(derive(seed, "m/84'/0'/0'/0/0"), { kind: "p2wpkh", hrp: "bc" });
same("bitcoin bech32 upper case -> lower case", coinById("bitcoin").parse(bc.toUpperCase()).text, bc);
const cash = addressOf(derive(seed, "m/44'/145'/0'/0/0"), { kind: "cashaddr" });
same("bitcoin-cash without prefix -> with prefix", coinById("bitcoin-cash").parse(cash.slice("bitcoincash:".length)).text, cash);
same("bitcoin-cash upper case -> lower case", coinById("bitcoin-cash").parse(cash.toUpperCase()).text, cash);
const platform = addressOf(derive(seed, "m/9'/5'/17'/0'/0'/0"), { kind: "dash-platform", hrp: "dash" });
same("dash platform upper case -> lower case", coinById("dash").parse(platform.toUpperCase()).text, platform);
const cosmos = bech32Encode("cosmos", convertBits(Uint8Array.from(Buffer.from("00".repeat(20), "hex")), 8, 5, true), "bech32");
same("cosmos all-zero account accepted as itself", coinById("cosmos").parse(cosmos).text, cosmos);
// Published XRP special accounts: ACCOUNT_ZERO and ACCOUNT_ONE.
same("xrp ACCOUNT_ZERO", coinById("xrp").parse("rrrrrrrrrrrrrrrrrrrrrhoLvTp").text, "rrrrrrrrrrrrrrrrrrrrrhoLvTp");
same("xrp ACCOUNT_ONE", coinById("xrp").parse("rrrrrrrrrrrrrrrrrrrrBZbvji").text, "rrrrrrrrrrrrrrrrrrrrBZbvji");
for (const vector of [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  "0x52908400098527886E0F7030069857D2E4169EE7",
  "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
  "0xde709f2102306220921060314715629080e2fb77",
  "0x27b1fdb04752bbc536007a920d24acb045561c26",
])
  same(`ethereum parse(EIP-55 published ${vector})`, coinById("ethereum").parse(vector).text, vector);
same(
  "bitcoin parse(BIP173 upper-case P2WPKH example)",
  coinById("bitcoin").parse("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4").text,
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
);
same(
  "bitcoin parse(BIP350 P2TR example) description",
  coinById("bitcoin").parse("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0").description,
  "Taproot (BIP86)",
);
same(
  "bitcoin-cash parse(spec vector bitcoincash:qpm2…)",
  coinById("bitcoin-cash").parse("bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a").text,
  "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
);
same(
  "xrp parse(genesis account)",
  coinById("xrp").parse("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh").text,
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
);

console.log("\n== 6. BIP32 limits of the account, branch and index ==");
{
  const LAST = 2147483647;
  for (const [coin, spec, template] of [
    ["dash", { kind: "p2pkh", version: [0x4c] }, "m/44'/5'/{a}'/{b}/{i}"],
    ["dash", { kind: "dash-platform", hrp: "dash" }, "m/9'/5'/17'/{a}'/{b}'/{i}"],
    ["ethereum", { kind: "evm" }, "m/44'/60'/{a}'/{b}/{i}"],
  ] as const) {
    const location = { account: LAST, branch: LAST, index: LAST };
    const path = template.replace("{a}", String(LAST)).replace("{b}", String(LAST)).replace("{i}", String(LAST));
    const expected = addressOf(derive(seed, path), spec as CoinSpec);
    same(
      `${coin} at ${path}`,
      matchWalletEvidence(ABANDON, { kind: "coin-address", coin, value: expected, location }),
      { matched: true, kind: "coin-address", derived: expected, path },
    );
  }
  const x0 = addressOf(derive(seed, "m/44'/5'/0'/0/0"), { kind: "p2pkh", version: [0x4c] });
  for (const [name, bad] of [
    ["account", 2147483648],
    ["branch", -1],
    ["index", 1.5],
    ["index", Number.NaN],
    ["account", "0"],
    ["branch", 2 ** 53],
  ] as const) {
    let message = "accepted";
    try {
      matchWalletEvidence(ABANDON, {
        kind: "coin-address",
        coin: "dash",
        value: x0,
        location: { account: 0, branch: 0, index: 0, [name]: bad } as never,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    same(`location ${name}=${typeof bad === "string" ? JSON.stringify(bad) : String(bad)} refused`, message, `${name} must be an integer from 0 through 2147483647.`);
  }
}

console.log("\n== 7. 256 consecutive addresses, including keys with leading zero bytes ==");
{
  const branch = "m/84'/0'/0'/0";
  let leadingZeroKeys = 0;
  let mismatches = 0;
  const examples: string[] = [];
  for (let index = 0; index < 256; index += 1) {
    const node = derive(seed, `${branch}/${index}`);
    const hex = node.key.toString(16).padStart(64, "0");
    if (hex.startsWith("00")) {
      leadingZeroKeys += 1;
      if (examples.length < 3) examples.push(`index ${index}`);
    }
    const expected = addressOf(node, { kind: "p2wpkh", hrp: "bc" });
    const result = matchWalletEvidence(ABANDON, {
      kind: "coin-address",
      coin: "bitcoin",
      value: expected,
      location: { account: 0, branch: 0, index },
      addresses: 1,
    });
    if (!result.matched || result.derived !== expected || result.path !== `${branch}/${index}`) mismatches += 1;
  }
  same(
    `production = oracle at ${branch}/0..255 (keys with a leading zero byte: ${leadingZeroKeys}, such as ${examples.join(", ")})`,
    { mismatches, leadingZeroKeysCovered: leadingZeroKeys > 0 },
    { mismatches: 0, leadingZeroKeysCovered: true },
  );
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
