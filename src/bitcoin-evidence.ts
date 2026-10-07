// Wallet evidence for Node.js programs: the comparisons of core/wallet-evidence.ts, with
// node:crypto's PBKDF2 as the BIP39 seed function, under the names the command line and the
// package have always used, and the coins of core/coins.ts whose addresses it compares. Another
// host, such as a browser page, builds its own WalletEvidenceCheck from core/wallet-evidence.ts
// with its PBKDF2 instead of importing this file.

import { pbkdf2Sync } from "node:crypto";
import {
  WalletEvidenceCheck,
  type EvidenceMatch,
  type WalletEvidence,
} from "./core/wallet-evidence.js";

export {
  DEFAULT_ADDRESS_COUNT,
  MAX_ADDRESS_COUNT,
  defaultAddressCount,
  assertBitcoinEvidence,
  assertWalletEvidence,
  bitcoinProfiles,
  parseBitcoinAddress,
  parseMasterFingerprint,
  type AddressLocation,
  type BitcoinEvidence,
  type BitcoinNetworkName,
  type BitcoinProfile,
  type CoinId,
  type DerivationLocation,
  type EvidenceMatch,
  type WalletEvidence,
} from "./core/wallet-evidence.js";
export {
  COINS,
  coinById,
  parseCoinAddress,
  type AddressType,
  type Coin,
  type CoinAddress,
} from "./core/coins.js";

/**
 * PBKDF2-HMAC-SHA512 from Node's OpenSSL instead of pure JavaScript: SHA-512 works on 64-bit
 * words, which JavaScript has to build from pairs of 32-bit numbers, so the native code is about
 * seven times faster. The result is the same.
 */
export function nodePbkdf2HmacSha512(
  password: string,
  salt: string,
  rounds: number,
  bytes: number,
): Uint8Array {
  const key = pbkdf2Sync(password, salt, rounds, bytes, "sha512");
  return new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
}

/** One check serves every caller: it holds nothing but the PBKDF2 function. */
const walletEvidence = new WalletEvidenceCheck(nodePbkdf2HmacSha512);

/** Compares a recovered mnemonic locally. It does not contact a node or a block explorer. */
export function matchWalletEvidence(
  mnemonic: string,
  evidence: WalletEvidence,
  passphrase = "",
): EvidenceMatch {
  return walletEvidence.match(mnemonic, evidence, passphrase);
}

/** The same comparison under its name from when the evidence was Bitcoin's only. */
export function matchBitcoinEvidence(
  mnemonic: string,
  evidence: WalletEvidence,
  passphrase = "",
): EvidenceMatch {
  return matchWalletEvidence(mnemonic, evidence, passphrase);
}

/** Returns the standard four-byte BIP32 master fingerprint as lowercase hexadecimal. */
export function masterFingerprint(mnemonic: string, passphrase = ""): string {
  return walletEvidence.fingerprint(mnemonic, passphrase);
}

/**
 * The wallet check that the searches take (core/wallet-check.ts): each phrase compared with
 * `evidence` and the wallet's BIP39 `passphrase`; none without evidence, when every candidate is
 * kept.
 */
export function walletCheckOf(
  evidence: WalletEvidence | undefined,
  passphrase = "",
): ((mnemonic: string) => EvidenceMatch) | undefined {
  return evidence === undefined
    ? undefined
    : (mnemonic) => matchWalletEvidence(mnemonic, evidence, passphrase);
}
