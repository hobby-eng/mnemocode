// Wallet evidence: whether a BIP39 phrase, with its BIP39 passphrase, is the wallet that one piece
// of evidence names, and the BIP32 master fingerprint of a phrase. The evidence is a master
// fingerprint, a master extended public key in any of its forms (xpub, ypub, zpub, Ypub, Zpub and
// the testnet tpub, upub, vpub, Upub, Vpub), or, in one or more of the four single-key Bitcoin
// profiles, an account extended public key at an account, or an address, a compressed public key
// or a WIF private key at an account, branch and index; on mainnet or testnet. Or it is a
// receiving address of one of the coins of core/coins.ts at an account, branch and index, compared
// on the paths where that coin's wallets put it. An address, a public key or a WIF may also be
// compared with several addresses in a row, from its index on, such as the first 20 of a wallet,
// when the person does not know which one it is. A program that checks wallets takes this module
// alone: it needs nothing about Seedshift, shares or cards.
//
// From the host it needs one function, PBKDF2-HMAC-SHA512, with which BIP39 turns a phrase into
// its seed. It may answer at once or with a promise: the command line passes node:crypto's
// pbkdf2Sync (bitcoin-evidence.ts) and calls match and fingerprint; a page passes WebCrypto's
// PBKDF2, which answers later, and calls matchAsync and fingerprintAsync, or the pbkdf2 of
// @noble/hashes/pbkdf2.js, which answers at once but is several times slower. The phrase and the
// passphrase are checked and normalized here (AUD-008-API005), so the host function gets only
// NFKD text, and the BIP39 constants stay here.
//
// It checks one phrase at a time and searches nothing; it does not contact a node or a block
// explorer, reads no file (a WIF comes as its value) and keeps nothing: every seed and private
// key it derives is wiped before it returns.
//
// The BIP39 seed rule, the master fingerprint and its check live in core/master-fingerprint.ts,
// which a host that tells wallets by their fingerprint alone takes without this module.
//
// Host-neutral: it imports only core/master-fingerprint.ts, core/coins.ts, core/coin-address-
// evidence.ts, core/address-scan.ts, core/white-space.ts, @scure/bip32, @scure/btc-signer and
// @noble/curves (test/portable-modules.test.ts).

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey, type Versions } from "@scure/bip32";
import { Address, NETWORK, TEST_NETWORK, WIF, p2pkh, p2sh, p2tr, p2wpkh } from "@scure/btc-signer";
import { addressCount, matchAtPath, scanBranch, type KeyMatch } from "./address-scan.js";
import { CoinAddressComparison } from "./coin-address-evidence.js";
import { assertAddressLocation, coinById, type AddressLocation, type CoinId } from "./coins.js";
import {
  Bip39Seed,
  FINGERPRINT_WARNING,
  fingerprintOfKey,
  MasterFingerprintCheck,
  parseMasterFingerprint,
  type Pbkdf2HmacSha512,
} from "./master-fingerprint.js";
import { trimWhiteSpace } from "./white-space.js";

// What every caller of this module used here before the split keeps working.
export { parseMasterFingerprint, type Pbkdf2HmacSha512 };
// What a caller needs to write coin-address evidence.
export type { AddressLocation, CoinId };

export type BitcoinNetworkName = "mainnet" | "testnet";
export type BitcoinProfile = "legacy" | "nested-segwit" | "native-segwit" | "taproot";
export const bitcoinProfiles: readonly BitcoinProfile[] = [
  "legacy",
  "nested-segwit",
  "native-segwit",
  "taproot",
];

export interface DerivationLocation extends AddressLocation {
  readonly network: BitcoinNetworkName;
}

// The scan's limits, under the names every caller of this module has used.
export { DEFAULT_ADDRESS_COUNT, defaultAddressCount, MAX_ADDRESS_COUNT } from "./address-scan.js";

/** Evidence of a Bitcoin wallet, in the forms that Bitcoin wallets show. */
export type BitcoinEvidence =
  | {
      readonly kind: "address";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
      /** How many addresses are compared, from the location's index on: one when left out. */
      readonly addresses?: number;
    }
  | {
      readonly kind: "compressed-public-key";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
      /** How many addresses are compared, from the location's index on: one when left out. */
      readonly addresses?: number;
    }
  | {
      readonly kind: "wif";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
      /** How many addresses are compared, from the location's index on: one when left out. */
      readonly addresses?: number;
    }
  | { readonly kind: "master-xpub"; readonly value: string; readonly network: BitcoinNetworkName }
  | {
      readonly kind: "account-xpub";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
    }
  | {
      readonly kind: "master-fingerprint";
      readonly value: string;
      readonly network: BitcoinNetworkName;
    };

/**
 * Every kind of evidence: Bitcoin's, and a receiving address of any coin of core/coins.ts, Bitcoin
 * included, whose address names its type and network.
 */
export type WalletEvidence =
  | BitcoinEvidence
  | {
      readonly kind: "coin-address";
      readonly coin: CoinId;
      readonly value: string;
      readonly location: AddressLocation;
      /** How many addresses are compared, from the location's index on: one when left out. */
      readonly addresses?: number;
    };

export interface EvidenceMatch {
  readonly matched: boolean;
  readonly kind: WalletEvidence["kind"];
  readonly derived?: string;
  readonly path?: string;
  readonly warning?: string;
}

/** BIP32 and SLIP-132 version bytes of the root keys that the comparison derives. */
const mainnetVersions: Versions = { private: 0x0488ade4, public: 0x0488b21e };
const testnetVersions: Versions = { private: 0x04358394, public: 0x043587cf };

/** The SLIP-132 forms of an extended public key, by their four-character prefix. */
const extendedKeyVersions: Readonly<
  Record<string, { readonly versions: Versions; readonly network: BitcoinNetworkName }>
> = {
  xpub: { versions: mainnetVersions, network: "mainnet" },
  ypub: { versions: { private: 0x049d7878, public: 0x049d7cb2 }, network: "mainnet" },
  zpub: { versions: { private: 0x04b2430c, public: 0x04b24746 }, network: "mainnet" },
  Ypub: { versions: { private: 0x0295b005, public: 0x0295b43f }, network: "mainnet" },
  Zpub: { versions: { private: 0x02aa7a99, public: 0x02aa7ed3 }, network: "mainnet" },
  tpub: { versions: testnetVersions, network: "testnet" },
  upub: { versions: { private: 0x044a4e28, public: 0x044a5262 }, network: "testnet" },
  vpub: { versions: { private: 0x045f18bc, public: 0x045f1cf6 }, network: "testnet" },
  Upub: { versions: { private: 0x024285b5, public: 0x024289ef }, network: "testnet" },
  Vpub: { versions: { private: 0x02575048, public: 0x02575483 }, network: "testnet" },
};

/** The BIP44, BIP49, BIP84 and BIP86 purpose of each profile. */
const derivationPurposes: Readonly<Record<BitcoinProfile, number>> = {
  legacy: 44,
  "nested-segwit": 49,
  "native-segwit": 84,
  taproot: 86,
};

/** The address types that one key of a seed phrase gives in the four profiles. */
const SINGLE_KEY_ADDRESS_TYPES: ReadonlySet<string> = new Set(["pkh", "sh", "wpkh", "tr"]);

/** A compressed secp256k1 public key: a 02 or 03 byte and the 32 bytes of x. */
const COMPRESSED_KEY_BYTES = 33;

/**
 * Compares BIP39 phrases with wallet evidence and gives their master fingerprints. A class because
 * the host's PBKDF2 is bound once and every comparison uses it; it holds nothing else, so one
 * instance serves every phrase and every caller. Each operation has two forms: match and
 * fingerprint for a PBKDF2 that answers at once, matchAsync and fingerprintAsync for one that may
 * answer later.
 */
export class WalletEvidenceCheck {
  readonly #seed: Bip39Seed;
  readonly #fingerprints: MasterFingerprintCheck;

  constructor(pbkdf2: Pbkdf2HmacSha512) {
    this.#seed = new Bip39Seed(pbkdf2);
    this.#fingerprints = new MasterFingerprintCheck(pbkdf2);
  }

  /**
   * Compares a recovered phrase with `evidence` locally. Evidence that no wallet can match is
   * refused before the seed is derived, as assertWalletEvidence refuses it.
   */
  match(mnemonic: string, evidence: WalletEvidence, passphrase = ""): EvidenceMatch {
    const expected = evidenceOf(evidence);
    return compareWith(expected, this.#seed.now(mnemonic, passphrase));
  }

  /** The same as match, with a PBKDF2 that may answer later. */
  async matchAsync(
    mnemonic: string,
    evidence: WalletEvidence,
    passphrase = "",
  ): Promise<EvidenceMatch> {
    const expected = evidenceOf(evidence);
    return compareWith(expected, await this.#seed.later(mnemonic, passphrase));
  }

  /** The standard four-byte BIP32 master fingerprint as lowercase hexadecimal. */
  fingerprint(mnemonic: string, passphrase = ""): string {
    return this.#fingerprints.fingerprint(mnemonic, passphrase);
  }

  /** The same as fingerprint, with a PBKDF2 that may answer later. */
  async fingerprintAsync(mnemonic: string, passphrase = ""): Promise<string> {
    return this.#fingerprints.fingerprintAsync(mnemonic, passphrase);
  }
}

/** The master key of `seed` on `network`; the seed is wiped, whatever happens. */
function rootOf(seed: Uint8Array, network: BitcoinNetworkName): HDKey {
  try {
    return HDKey.fromMasterSeed(seed, network === "mainnet" ? mainnetVersions : testnetVersions);
  } finally {
    // This module owns the temporary seed; the caller's mnemonic strings remain unchanged.
    seed.fill(0);
  }
}

/** Compares the wallet of `seed` with the checked evidence; every key derived is wiped. */
function compareWith(expected: Evidence, seed: Uint8Array): EvidenceMatch {
  const root = rootOf(seed, expected.network);
  try {
    return expected.compare(root);
  } finally {
    root.wipePrivateData();
  }
}

/**
 * An address as typed, in its standard form on `network`; refused, naming why, unless it is an
 * address that one key of a seed phrase gives (P2PKH, P2SH-P2WPKH, P2WPKH or P2TR). A host checks
 * an answer with it at once: no secret is needed.
 */
export function parseBitcoinAddress(value: string, network: BitcoinNetworkName): string {
  const text = trimWhiteSpace(value);
  const decoded = decodedAddress(text, network);
  if (decoded === undefined) {
    const other = network === "mainnet" ? "testnet" : "mainnet";
    throw new Error(
      decodedAddress(text, other) === undefined
        ? `The address is not valid for Bitcoin ${network}.`
        : `The address is not valid for Bitcoin ${network}; it is a ${other} address.`,
    );
  }
  if (!SINGLE_KEY_ADDRESS_TYPES.has(decoded.type))
    throw new Error(
      "This address belongs to a script, not to one key: no seed phrase gives it on its own.",
    );
  const address = Address(networkParameters(network));
  return address.encode(address.decode(text));
}

/**
 * Refuses evidence that no wallet can match, before any secret is asked: everything that a
 * comparison would refuse at its first candidate, which may come only after the secrets were typed
 * and a long search ran. Needs no seed phrase.
 */
export function assertWalletEvidence(evidence: WalletEvidence): void {
  evidenceOf(evidence);
}

/** The same check under its name from when the evidence was Bitcoin's only. */
export function assertBitcoinEvidence(evidence: WalletEvidence): void {
  assertWalletEvidence(evidence);
}

/** One piece of evidence, refused when it is built unless some wallet can match it. */
interface Evidence {
  /** The network whose versions the wallet's root key is built with. */
  readonly network: BitcoinNetworkName;
  /** The comparison with the wallet whose master key is `root`; wipes every key it derives. */
  compare(root: HDKey): EvidenceMatch;
}

/** The kinds that name one key among several addresses in a row (`addresses`). */
const SCANNED_KINDS: ReadonlySet<string> = new Set([
  "address",
  "compressed-public-key",
  "wif",
  "coin-address",
]);

/** The checked evidence of `evidence`: the one place that tells the kinds apart. */
function evidenceOf(evidence: WalletEvidence): Evidence {
  // A JavaScript caller or parsed configuration can pass any kind; an unknown one is an error, not
  // a comparison that failed, which would read as evidence against the wallet.
  if (
    !SCANNED_KINDS.has(evidence.kind) &&
    (evidence as { addresses?: unknown }).addresses !== undefined
  )
    throw new Error(
      "Only an address, a compressed public key or a WIF is compared with several addresses.",
    );
  switch (evidence.kind) {
    case "master-fingerprint":
      return new MasterFingerprintEvidence(evidence.value, evidence.network);
    case "master-xpub":
      return new MasterKeyEvidence(evidence.value, evidence.network);
    case "address":
      return new AddressEvidence(evidence);
    case "compressed-public-key":
      return new PublicKeyEvidence(evidence);
    case "wif":
      return new WifEvidence(evidence);
    case "account-xpub":
      return new AccountKeyEvidence(evidence);
    case "coin-address":
      return new CoinEvidence(evidence);
    default:
      throw new Error("Unsupported Bitcoin evidence kind.");
  }
}

/** The BIP32 master fingerprint: a filter of 32 bits, so a match carries a warning. */
class MasterFingerprintEvidence implements Evidence {
  readonly network: BitcoinNetworkName;
  readonly #expected: string;

  constructor(value: string, network: BitcoinNetworkName) {
    assertNetwork(network);
    this.#expected = parseMasterFingerprint(value);
    this.network = network;
  }

  compare(root: HDKey): EvidenceMatch {
    const derived = fingerprintOfKey(root);
    return {
      matched: derived === this.#expected,
      kind: "master-fingerprint",
      derived,
      path: "m",
      warning: FINGERPRINT_WARNING,
    };
  }
}

/** The master extended public key, in any of its forms: only the key itself is compared. */
class MasterKeyEvidence implements Evidence {
  readonly network: BitcoinNetworkName;
  readonly #expected: HDKey;

  constructor(value: string, network: BitcoinNetworkName) {
    assertNetwork(network);
    this.#expected = extendedPublicKeyOn(value, network);
    this.network = network;
  }

  compare(root: HDKey): EvidenceMatch {
    return {
      matched: sameExtendedKey(root, this.#expected),
      kind: "master-xpub",
      derived: root.publicExtendedKey,
      path: "m",
    };
  }
}

type LocatedBitcoinEvidence = Exclude<
  BitcoinEvidence,
  { kind: "master-xpub" | "master-fingerprint" }
>;

/** Where in a profile the key that a kind names sits. */
type KeyLevel = "account" | "address";

/**
 * Evidence of one key at a place of the wallet: the account key, or the key at an account, branch
 * and index, in each of the profiles given. A base class because every such kind is placed,
 * checked and searched through the profiles in the same way; a kind adds only its comparison.
 */
abstract class LocatedEvidence implements Evidence {
  readonly network: BitcoinNetworkName;
  readonly #kind: LocatedBitcoinEvidence["kind"];
  readonly #location: DerivationLocation;
  readonly #addresses: number;
  readonly #profiles: readonly BitcoinProfile[];
  readonly #level: KeyLevel;

  /** Checks the place and the profiles, before the kind checks its value. */
  constructor(evidence: LocatedBitcoinEvidence, level: KeyLevel) {
    assertLocation(evidence.location);
    this.#profiles = [...checkedProfiles(evidence.profiles)];
    const { network, account, branch, index } = evidence.location;
    this.#location = { network, account, branch, index };
    this.#addresses =
      evidence.kind === "account-xpub" ? 1 : addressCount(evidence.addresses, index);
    this.#kind = evidence.kind;
    this.#level = level;
    this.network = network;
  }

  compare(root: HDKey): EvidenceMatch {
    for (const profile of this.#profiles) {
      const matchOf: KeyMatch = (node, publicKey) => this.derivedFrom(node, publicKey, profile);
      const found =
        this.#level === "account"
          ? matchAtPath(root, this.#accountPath(profile), matchOf)
          : scanBranch(
              root,
              `${this.#accountPath(profile)}/${this.#location.branch}`,
              { first: this.#location.index, count: this.#addresses },
              matchOf,
            );
      if (found !== undefined) return { matched: true, kind: this.#kind, ...found };
    }
    return { matched: false, kind: this.#kind };
  }

  /** The derived value to show when `node`, in `profile`, is the key of the evidence. */
  protected abstract derivedFrom(
    node: HDKey,
    publicKey: Uint8Array,
    profile: BitcoinProfile,
  ): string | undefined;

  #accountPath(profile: BitcoinProfile): string {
    const { network, account } = this.#location;
    const coinType = network === "mainnet" ? 0 : 1;
    return `m/${derivationPurposes[profile]}'/${coinType}'/${account}'`;
  }
}

/** A receiving or change address of one key. */
class AddressEvidence extends LocatedEvidence {
  readonly #expected: string;

  constructor(evidence: Extract<BitcoinEvidence, { kind: "address" }>) {
    super(evidence, "address");
    this.#expected = parseBitcoinAddress(evidence.value, evidence.location.network);
  }

  protected derivedFrom(_node: HDKey, publicKey: Uint8Array, profile: BitcoinProfile) {
    const derived = paymentAddress(profile, publicKey, this.network);
    return derived === this.#expected ? derived : undefined;
  }
}

/** A compressed public key, 33 bytes in hexadecimal. */
class PublicKeyEvidence extends LocatedEvidence {
  readonly #expected: Uint8Array;

  constructor(evidence: Extract<BitcoinEvidence, { kind: "compressed-public-key" }>) {
    super(evidence, "address");
    this.#expected = parseCompressedPublicKey(evidence.value);
  }

  protected derivedFrom(_node: HDKey, publicKey: Uint8Array) {
    return equalBytes(publicKey, this.#expected) ? hex(publicKey) : undefined;
  }
}

/**
 * A WIF private key, given as its value. Only the text is kept: its key is decoded for each
 * comparison and wiped at once, as the derived key it is compared with.
 */
class WifEvidence extends LocatedEvidence {
  readonly #value: string;

  constructor(evidence: Extract<BitcoinEvidence, { kind: "wif" }>) {
    super(evidence, "address");
    this.#value = evidence.value;
    wifKey(this.#value, this.network).fill(0);
  }

  protected derivedFrom(node: HDKey) {
    // A copy of the node's key, which node.wipePrivateData() does not reach.
    const derivedKey = node.privateKey;
    if (derivedKey === null)
      throw new Error("Unable to derive the private key for WIF comparison.");
    const expected = wifKey(this.#value, this.network);
    try {
      return equalBytes(derivedKey, expected)
        ? WIF(networkParameters(this.network)).encode(derivedKey)
        : undefined;
    } finally {
      expected.fill(0);
      derivedKey.fill(0);
    }
  }
}

/** The extended public key of an account, in any of its forms. */
class AccountKeyEvidence extends LocatedEvidence {
  readonly #expected: HDKey;

  constructor(evidence: Extract<BitcoinEvidence, { kind: "account-xpub" }>) {
    super(evidence, "account");
    this.#expected = extendedPublicKeyOn(evidence.value, evidence.location.network);
  }

  protected derivedFrom(node: HDKey) {
    return sameExtendedKey(node, this.#expected) ? node.publicExtendedKey : undefined;
  }
}

/**
 * A receiving address of a coin of core/coins.ts, by its name, compared as core/coin-address-
 * evidence.ts compares an address of a coin given itself.
 */
class CoinEvidence implements Evidence {
  readonly network: BitcoinNetworkName;
  readonly #comparison: CoinAddressComparison;

  constructor(evidence: Extract<WalletEvidence, { kind: "coin-address" }>) {
    this.#comparison = new CoinAddressComparison({
      coin: coinById(evidence.coin),
      value: evidence.value,
      location: evidence.location,
      addresses: evidence.addresses,
    });
    this.network = this.#comparison.testnet ? "testnet" : "mainnet";
  }

  compare(root: HDKey): EvidenceMatch {
    return { ...this.#comparison.compare(root), kind: "coin-address" };
  }
}

function assertNetwork(network: BitcoinNetworkName): void {
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error("Bitcoin network must be mainnet or testnet.");
  }
}

function assertLocation(location: DerivationLocation): void {
  assertNetwork(location.network);
  assertAddressLocation(location);
}

function checkedProfiles(profiles: readonly BitcoinProfile[]): readonly BitcoinProfile[] {
  if (profiles.length === 0) {
    throw new Error("At least one Bitcoin address profile must be selected.");
  }
  if (profiles.some((profile) => !bitcoinProfiles.includes(profile))) {
    throw new Error("Unknown Bitcoin address profile.");
  }
  return profiles;
}

function networkParameters(network: BitcoinNetworkName): typeof NETWORK {
  return network === "mainnet" ? NETWORK : TEST_NETWORK;
}

function equalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index]! ^ right[index]!;
  return different === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function parseCompressedPublicKey(value: string): Uint8Array {
  const normalized = trimWhiteSpace(value).toLowerCase();
  if (!/^[0-9a-f]{66}$/.test(normalized))
    throw new Error(
      "A compressed public key must be exactly 33 bytes encoded as 66 hexadecimal characters.",
    );
  const bytes = new Uint8Array(COMPRESSED_KEY_BYTES);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  if (bytes[0] !== 0x02 && bytes[0] !== 0x03)
    throw new Error("A compressed public key must start with 02 or 03.");
  // Without this, a key that no wallet can have would only fail to match (AUD-008-API002).
  if (!secp256k1.utils.isValidPublicKey(bytes, true))
    throw new Error("The compressed public key is not a point of the secp256k1 curve.");
  return bytes;
}

/** A WIF's private key, refused unless it is a valid secp256k1 secret: 1 to the group order − 1. */
function wifKey(value: string, network: BitcoinNetworkName): Uint8Array {
  let key: Uint8Array;
  try {
    key = WIF(networkParameters(network)).decode(trimWhiteSpace(value));
  } catch {
    throw new Error(`The WIF is not valid for Bitcoin ${network}.`);
  }
  if (!secp256k1.utils.isValidSecretKey(key)) {
    key.fill(0);
    throw new Error("The WIF holds no valid secp256k1 private key.");
  }
  return key;
}

/** The address decoded for `network`, or undefined when it is no address there. */
function decodedAddress(
  value: string,
  network: BitcoinNetworkName,
): { readonly type: string } | undefined {
  try {
    return Address(networkParameters(network)).decode(value);
  } catch {
    return undefined;
  }
}

function paymentAddress(
  profile: BitcoinProfile,
  publicKey: Uint8Array,
  network: BitcoinNetworkName,
): string {
  const parameters = networkParameters(network);
  if (profile === "legacy") return p2pkh(publicKey, parameters).address;
  if (profile === "nested-segwit") return p2sh(p2wpkh(publicKey, parameters), parameters).address;
  if (profile === "native-segwit") return p2wpkh(publicKey, parameters).address;
  // BIP86: the key path of a Taproot output takes the 32-byte x-only key.
  return p2tr(publicKey.slice(1), undefined, parameters).address;
}

/**
 * An extended public key, refused unless its prefix is known and names `network`. Only public
 * versions are accepted, so the parsed key never holds a private key.
 */
function extendedPublicKeyOn(value: string, network: BitcoinNetworkName): HDKey {
  const prefix = trimWhiteSpace(value).slice(0, 4);
  const metadata = extendedKeyVersions[prefix];
  if (metadata === undefined)
    throw new Error(
      "Unsupported extended-key prefix. Supported public forms include xpub, ypub, zpub, Ypub, Zpub, tpub, upub, vpub, Upub, and Vpub.",
    );
  if (metadata.network !== network)
    throw new Error("The extended-key prefix does not match the selected Bitcoin network.");
  try {
    return HDKey.fromExtendedKey(trimWhiteSpace(value), metadata.versions);
  } catch {
    throw new Error("The extended public key is not valid.");
  }
}

/** Whether two extended keys are the same key, whatever versions they were written with. */
function sameExtendedKey(left: HDKey, right: HDKey): boolean {
  return (
    left.depth === right.depth &&
    left.index === right.index &&
    left.parentFingerprint === right.parentFingerprint &&
    equalBytes(left.publicKey, right.publicKey) &&
    equalBytes(left.chainCode, right.chainCode)
  );
}
