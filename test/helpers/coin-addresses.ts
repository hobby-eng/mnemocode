// The addresses of the public test phrase "abandon … about" that the tests compare with, each
// written once: where its wallets put each address in each coin, and the answers of the menu's
// address questions. Public test data only.

import { COINS, type CoinId } from "../../src/core/coins.js";
import { TEST_ADDRESS } from "./test-phrase.js";

/** BIP84's second receiving address of the test phrase, m/84'/0'/0'/0/1 (BIP-0084's vectors). */
export const SECOND_RECEIVING_ADDRESS = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";

/** BIP84's first change address of the test phrase, m/84'/0'/0'/1/0 (BIP-0084's vectors). */
export const FIRST_CHANGE_ADDRESS = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el";

/** BIP86's first receiving address of the test phrase, m/86'/0'/0'/0/0 (BIP-0086's vectors). */
export const TAPROOT_ADDRESS = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

/** BIP49's first receiving address of the test phrase on testnet, m/49'/1'/0'/0/0 (BIP-0049). */
export const TESTNET_NESTED_ADDRESS = "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2";

/** The first native SegWit address of the test phrase with the BIP39 passphrase TREZOR. */
export const TREZOR_ADDRESS = "bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu";

/** DIP17's first Dash Platform address of the test phrase, key class 0', m/9'/5'/17'/0'/0'/0. */
export const PLATFORM_ADDRESS = "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs";

/** Bitcoin Cash's first receiving address of the test phrase, m/44'/145'/0'/0/0, in legacy form. */
export const BITCOIN_CASH_LEGACY_ADDRESS = "1mW6fDEMjKrDHvLvoEsaeLxSCzZBf3Bfg";

/**
 * Where the wallets of the public test phrase put each address: coin, BIP39 passphrase, path,
 * address. The Bitcoin mainnet values at index 0 are the published vectors of BIP44, BIP49, BIP84
 * and BIP86, and the Dash Platform ones the official DIP17/DIP18 vectors, receiving key class 0'
 * and change key class 1'. The other Bitcoin values were computed independently with Python's
 * hashlib and agree with BIP49's testnet vector; the other coins were computed independently with
 * @scure/bip32, @noble/hashes, @noble/curves and @scure/base, and ethers for EIP-55, at the first
 * address and at account 3, change branch, index 7. Each coin's first row on BIP44's path is its
 * first receiving address (firstReceivingOf).
 */
export const ADDRESSES: readonly (readonly [CoinId, string, string, string])[] = [
  ["bitcoin", "", "m/44'/0'/0'/0/0", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"],
  ["bitcoin", "", "m/49'/0'/0'/0/0", "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf"],
  ["bitcoin", "", "m/84'/0'/0'/0/0", TEST_ADDRESS],
  ["bitcoin", "", "m/84'/0'/0'/0/1", SECOND_RECEIVING_ADDRESS],
  ["bitcoin", "", "m/84'/0'/0'/1/0", FIRST_CHANGE_ADDRESS],
  ["bitcoin", "", "m/86'/0'/0'/0/0", TAPROOT_ADDRESS],
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
  ["bitcoin", "", "m/49'/1'/0'/0/0", TESTNET_NESTED_ADDRESS],
  ["bitcoin", "", "m/84'/1'/0'/0/0", "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl"],
  [
    "bitcoin",
    "",
    "m/86'/1'/0'/0/0",
    "tb1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqlqt9zj",
  ],
  ["bitcoin", "TREZOR", "m/84'/0'/0'/0/0", TREZOR_ADDRESS],
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
  ["bitcoin-cash", "", "m/44'/145'/0'/0/0", BITCOIN_CASH_LEGACY_ADDRESS],
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
  ["dash", "", "m/9'/5'/17'/0'/0'/0", PLATFORM_ADDRESS],
  ["dash", "", "m/9'/5'/17'/0'/0'/1", "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw"],
  ["dash", "", "m/9'/5'/17'/0'/1'/0", "dash1kpkeye606ez89g7lelp7hnldwwpt76va0v3j6x28"],
];

/** A path of BIP44's first receiving address on any coin type, m/44'/<coin type>'/0'/0/0. */
const FIRST_ON_BIP44 = /^m\/44'\/\d+'\/0'\/0\/0$/u;

/** The address of the first row of ADDRESSES that `found` accepts; a test fails without one. */
function addressWhere(
  found: (row: readonly [CoinId, string, string, string]) => boolean,
  what: string,
): string {
  const row = ADDRESSES.find(found);
  if (row === undefined) throw new Error(`ADDRESSES holds no ${what}.`);
  return row[3];
}

/** The address of the test phrase in `coin` at `path` without a passphrase, from ADDRESSES. */
export function addressAt(coin: CoinId, path: string): string {
  return addressWhere(
    ([each, passphrase, at]) => each === coin && passphrase === "" && at === path,
    `address of ${coin} at ${path}`,
  );
}

/**
 * The first receiving address of the test phrase in `coin` on BIP44's path,
 * m/44'/<coin type>'/0'/0/0: for Bitcoin its legacy address, beside BIP84's TEST_ADDRESS, and for
 * Bitcoin Cash its CashAddr form.
 */
export function firstReceivingOf(coin: CoinId): string {
  return addressWhere(
    ([each, passphrase, path]) => each === coin && passphrase === "" && FIRST_ON_BIP44.test(path),
    `first receiving address of ${coin}`,
  );
}

/**
 * The answers to the menu's address question of each coin besides Bitcoin, by its prompt, such
 * as "Address (Dash, one of the first receiving ones)".
 */
export const COIN_ADDRESS_ANSWERS: Readonly<Record<string, string>> = Object.fromEntries(
  COINS.filter(({ id }) => id !== "bitcoin").map(({ id, name }) => [
    `Address (${name}, one of the first receiving ones)`,
    firstReceivingOf(id),
  ]),
);
