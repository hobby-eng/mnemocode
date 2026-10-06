import { pbkdf2Sync } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey, type Versions } from "@scure/bip32";
import { Address, NETWORK, TEST_NETWORK, WIF, p2pkh, p2sh, p2tr, p2wpkh } from "@scure/btc-signer";

export type BitcoinNetworkName = "mainnet" | "testnet";
export type BitcoinProfile = "legacy" | "nested-segwit" | "native-segwit" | "taproot";
export const bitcoinProfiles: readonly BitcoinProfile[] = [
  "legacy",
  "nested-segwit",
  "native-segwit",
  "taproot",
];

export interface DerivationLocation {
  readonly network: BitcoinNetworkName;
  readonly account: number;
  readonly branch: number;
  readonly index: number;
}

export type BitcoinEvidence =
  | {
      readonly kind: "address";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
    }
  | {
      readonly kind: "compressed-public-key";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
    }
  | {
      readonly kind: "wif";
      readonly value: string;
      readonly profiles: readonly BitcoinProfile[];
      readonly location: DerivationLocation;
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

export interface EvidenceMatch {
  readonly matched: boolean;
  readonly kind: BitcoinEvidence["kind"];
  readonly derived?: string;
  readonly path?: string;
  readonly warning?: string;
}

const mainnetVersions: Versions = { private: 0x0488ade4, public: 0x0488b21e };
const testnetVersions: Versions = { private: 0x04358394, public: 0x043587cf };

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

function equalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index]! ^ right[index]!;
  return different === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function parseHex(value: string): Uint8Array {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{66}$/.test(normalized))
    throw new Error(
      "A compressed public key must be exactly 33 bytes encoded as 66 hexadecimal characters.",
    );
  const bytes = new Uint8Array(33);
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
function wifKey(evidence: Extract<BitcoinEvidence, { kind: "wif" }>): Uint8Array {
  const network = evidence.location.network === "mainnet" ? NETWORK : TEST_NETWORK;
  let key: Uint8Array;
  try {
    key = WIF(network).decode(evidence.value.trim());
  } catch {
    throw new Error(`The WIF is not valid for Bitcoin ${evidence.location.network}.`);
  }
  if (!secp256k1.utils.isValidSecretKey(key)) {
    key.fill(0);
    throw new Error("The WIF holds no valid secp256k1 private key.");
  }
  return key;
}

/**
 * Refuses evidence that no wallet can match before any wallet is derived: a malformed key would
 * otherwise read as evidence against every candidate.
 */
function assertEvidenceValue(evidence: LocatedEvidence): void {
  if (evidence.kind === "compressed-public-key") parseHex(evidence.value);
  if (evidence.kind === "wif") wifKey(evidence).fill(0);
}

function assertNetwork(network: BitcoinNetworkName): void {
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error("Bitcoin network must be mainnet or testnet.");
  }
}

function assertLocation(location: DerivationLocation): void {
  assertNetwork(location.network);
  for (const name of ["account", "branch", "index"] as const) {
    const value = location[name];
    if (!Number.isSafeInteger(value) || value < 0 || value >= 0x80000000) {
      throw new Error(`${name} must be an integer from 0 through 2147483647.`);
    }
  }
}

function coinType(network: BitcoinNetworkName): number {
  return network === "mainnet" ? 0 : 1;
}

const derivationPurposes: Readonly<Record<BitcoinProfile, number>> = {
  legacy: 44,
  "nested-segwit": 49,
  "native-segwit": 84,
  taproot: 86,
};

function purpose(profile: BitcoinProfile): number {
  return derivationPurposes[profile];
}

function path(profile: BitcoinProfile, location: DerivationLocation): string {
  return `m/${purpose(profile)}'/${coinType(location.network)}'/${location.account}'/${location.branch}/${location.index}`;
}

function accountPath(profile: BitcoinProfile, location: DerivationLocation): string {
  return `m/${purpose(profile)}'/${coinType(location.network)}'/${location.account}'`;
}

function paymentAddress(
  profile: BitcoinProfile,
  publicKey: Uint8Array,
  network: BitcoinNetworkName,
): string {
  const parameters = network === "mainnet" ? NETWORK : TEST_NETWORK;
  if (profile === "legacy") return p2pkh(publicKey, parameters).address;
  if (profile === "nested-segwit") return p2sh(p2wpkh(publicKey, parameters), parameters).address;
  if (profile === "native-segwit") return p2wpkh(publicKey, parameters).address;
  return p2tr(publicKey.slice(1), undefined, parameters).address;
}

function extendedMetadata(value: string): {
  readonly versions: Versions;
  readonly network: BitcoinNetworkName;
} {
  const prefix = value.trim().slice(0, 4);
  const metadata = extendedKeyVersions[prefix];
  if (metadata === undefined)
    throw new Error(
      "Unsupported extended-key prefix. Supported public forms include xpub, ypub, zpub, Ypub, Zpub, tpub, upub, vpub, Upub, and Vpub.",
    );
  return metadata;
}

function parseExtendedPublicKey(value: string, versions: Versions): HDKey {
  try {
    return HDKey.fromExtendedKey(value.trim(), versions);
  } catch {
    throw new Error("The extended public key is not valid.");
  }
}

function sameExtendedKey(left: HDKey, right: HDKey): boolean {
  return (
    left.depth === right.depth &&
    left.index === right.index &&
    left.parentFingerprint === right.parentFingerprint &&
    equalBytes(left.publicKey, right.publicKey) &&
    equalBytes(left.chainCode, right.chainCode)
  );
}

/** BIP39 "From mnemonic to seed": PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes. */
const SEED_ROUNDS = 2048;
const SEED_BYTES = 64;
const BIP39_WORD_COUNTS: ReadonlySet<number> = new Set([12, 15, 18, 21, 24]);

/**
 * The NFKD form that BIP39 hashes; refused, as by @scure/bip39, when it is not text or not well
 * formed: a JavaScript caller could pass null or a number, which would otherwise become the salt of
 * another wallet as "null" or "123" (AUD-008-API005).
 */
function nfkd(text: string): string {
  if (typeof text !== "string") throw new TypeError("expected a string");
  // With the u flag, a surrogate on its own is a code point of its own; a pair is not.
  if (/\p{Cs}/u.test(text)) throw new TypeError("expected well-formed Unicode string");
  return text.normalize("NFKD");
}

/**
 * The BIP39 seed, as @scure/bip39 mnemonicToSeedSync gives it, from Node's OpenSSL instead of
 * pure JavaScript: SHA-512 works on 64-bit words, which JavaScript has to build from pairs of
 * 32-bit numbers, so the native code is about seven times faster. The result is the same.
 */
function bip39Seed(mnemonic: string, passphrase: string): Uint8Array {
  const phrase = nfkd(mnemonic);
  if (!BIP39_WORD_COUNTS.has(phrase.split(" ").length)) throw new Error("Invalid mnemonic");
  // Checked before the template below would turn it into text.
  if (typeof passphrase !== "string") throw new TypeError("expected a string passphrase");
  const seed = pbkdf2Sync(phrase, nfkd(`mnemonic${passphrase}`), SEED_ROUNDS, SEED_BYTES, "sha512");
  return new Uint8Array(seed.buffer, seed.byteOffset, seed.byteLength);
}

function rootForMnemonic(mnemonic: string, passphrase: string, network: BitcoinNetworkName): HDKey {
  assertNetwork(network);
  const seed = bip39Seed(mnemonic, passphrase);
  try {
    return HDKey.fromMasterSeed(seed, network === "mainnet" ? mainnetVersions : testnetVersions);
  } finally {
    // This function owns the temporary byte buffer; caller-owned mnemonic strings remain unchanged.
    seed.fill(0);
  }
}

/** Returns the standard four-byte BIP32 master fingerprint as lowercase hexadecimal. */
export function masterFingerprint(mnemonic: string, passphrase = ""): string {
  const root = rootForMnemonic(mnemonic, passphrase, "mainnet");
  try {
    return root.fingerprint.toString(16).padStart(8, "0");
  } finally {
    root.wipePrivateData();
  }
}

function candidates(profiles: readonly BitcoinProfile[]): readonly BitcoinProfile[] {
  if (profiles.length === 0) {
    throw new Error("At least one Bitcoin address profile must be selected.");
  }
  if (profiles.some((profile) => !bitcoinProfiles.includes(profile))) {
    throw new Error("Unknown Bitcoin address profile.");
  }
  return profiles;
}

type LocatedEvidence = Exclude<BitcoinEvidence, { kind: "master-xpub" | "master-fingerprint" }>;

function matchingWif(
  node: HDKey,
  evidence: Extract<BitcoinEvidence, { kind: "wif" }>,
): string | undefined {
  const derivedKey = node.privateKey;
  if (derivedKey === null) throw new Error("Unable to derive the private key for WIF comparison.");
  const coder = WIF(evidence.location.network === "mainnet" ? NETWORK : TEST_NETWORK);
  const expected = wifKey(evidence);
  try {
    return equalBytes(derivedKey, expected) ? coder.encode(derivedKey) : undefined;
  } finally {
    expected.fill(0);
  }
}

function matchingAccountKey(
  node: HDKey,
  evidence: Extract<BitcoinEvidence, { kind: "account-xpub" }>,
): string | undefined {
  const metadata = extendedMetadata(evidence.value);
  if (metadata.network !== evidence.location.network) {
    throw new Error("The extended-key prefix does not match the selected Bitcoin network.");
  }
  const expected = parseExtendedPublicKey(evidence.value, metadata.versions);
  try {
    return sameExtendedKey(node, expected) ? node.publicExtendedKey : undefined;
  } finally {
    expected.wipePrivateData();
  }
}

function matchDerivedNode(
  node: HDKey,
  evidence: LocatedEvidence,
  profile: BitcoinProfile,
): string | undefined {
  if (node.publicKey === null) throw new Error("Unable to derive the public key.");
  switch (evidence.kind) {
    case "address": {
      const derived = paymentAddress(profile, node.publicKey, evidence.location.network);
      const network = evidence.location.network === "mainnet" ? NETWORK : TEST_NETWORK;
      const address = Address(network);
      let expected: string;
      try {
        expected = address.encode(address.decode(evidence.value.trim()));
      } catch {
        throw new Error(`The address is not valid for Bitcoin ${evidence.location.network}.`);
      }
      return derived === expected ? derived : undefined;
    }
    case "compressed-public-key": {
      const matches = equalBytes(node.publicKey, parseHex(evidence.value));
      return matches ? hex(node.publicKey) : undefined;
    }
    case "wif":
      return matchingWif(node, evidence);
    case "account-xpub":
      return matchingAccountKey(node, evidence);
    default:
      // Unreachable for typed callers; matchBitcoinEvidence rejects other kinds first.
      throw new Error("Unsupported Bitcoin evidence kind.");
  }
}

/** Every kind of evidence this module can compare. */
const EVIDENCE_KINDS: ReadonlySet<string> = new Set<BitcoinEvidence["kind"]>([
  "address",
  "compressed-public-key",
  "wif",
  "master-xpub",
  "account-xpub",
  "master-fingerprint",
]);

/** Compares a recovered mnemonic locally. It does not contact a node or a block explorer. */
export function matchBitcoinEvidence(
  mnemonic: string,
  evidence: BitcoinEvidence,
  passphrase = "",
): EvidenceMatch {
  // A JavaScript caller or parsed configuration can pass any kind; an unknown one is an error, not
  // a comparison that failed, which would read as evidence against the wallet.
  if (!EVIDENCE_KINDS.has((evidence as { readonly kind?: unknown }).kind as string)) {
    throw new Error("Unsupported Bitcoin evidence kind.");
  }
  if (evidence.kind === "master-xpub") {
    const metadata = extendedMetadata(evidence.value);
    if (metadata.network !== evidence.network)
      throw new Error("The extended-key prefix does not match the selected Bitcoin network.");
    const expected = parseExtendedPublicKey(evidence.value, metadata.versions);
    const root = rootForMnemonic(mnemonic, passphrase, evidence.network);
    try {
      return {
        matched: sameExtendedKey(root, expected),
        kind: evidence.kind,
        derived: root.publicExtendedKey,
        path: "m",
      };
    } finally {
      root.wipePrivateData();
      expected.wipePrivateData();
    }
  }

  if (evidence.kind === "master-fingerprint") {
    if (!/^[0-9a-fA-F]{8}$/.test(evidence.value))
      throw new Error("A master fingerprint must be eight hexadecimal characters.");
    const root = rootForMnemonic(mnemonic, passphrase, evidence.network);
    try {
      const derived = root.fingerprint.toString(16).padStart(8, "0");
      return {
        matched: derived === evidence.value.toLowerCase(),
        kind: evidence.kind,
        derived,
        path: "m",
        warning: "A master fingerprint is only 32 bits and is a filter, not proof of recovery.",
      };
    } finally {
      root.wipePrivateData();
    }
  }

  assertLocation(evidence.location);
  const profiles = candidates(evidence.profiles);
  assertEvidenceValue(evidence);
  const root = rootForMnemonic(mnemonic, passphrase, evidence.location.network);
  try {
    for (const profile of profiles) {
      const derivationPath =
        evidence.kind === "account-xpub"
          ? accountPath(profile, evidence.location)
          : path(profile, evidence.location);
      const node = root.derive(derivationPath);
      try {
        const derived = matchDerivedNode(node, evidence, profile);
        if (derived !== undefined) {
          return { matched: true, kind: evidence.kind, derived, path: derivationPath };
        }
      } finally {
        node.wipePrivateData();
      }
    }
    return { matched: false, kind: evidence.kind };
  } finally {
    root.wipePrivateData();
  }
}
