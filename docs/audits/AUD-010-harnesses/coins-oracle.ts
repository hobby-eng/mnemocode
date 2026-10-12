// AUD-010 coins reviewer: an independent oracle for the addresses of the public test phrase.
//
// It shares no code with src/: BIP39 seeds, BIP32 child keys, HASH160, Base58Check, Bech32,
// Bech32m, CashAddr, EIP-55, BIP86 Taproot tweaks and the DIP18 Platform address are written here
// from their specifications. Primitives come from node:crypto (OpenSSL: PBKDF2-HMAC-SHA512,
// HMAC-SHA512, SHA-256, RIPEMD-160, secp256k1 point multiplication through ECDH) and, for
// Ethereum-style accounts only, Keccak-256 from @noble/hashes (node:crypto's sha3-256 is the
// FIPS-202 padding, not Keccak). Nothing from @scure/* is used.

import { createECDH, createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const ABANDON =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** secp256k1 group order and field prime (SEC 2). */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HARDENED = 0x80000000;

export const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const bytesOf = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const big = (bytes: Uint8Array): bigint => BigInt("0x" + (hexOf(bytes) || "0"));
const ser256 = (value: bigint): Uint8Array => bytesOf(value.toString(16).padStart(64, "0"));
const ser32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
};
const concat = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(Buffer.concat(parts));

export const sha256 = (bytes: Uint8Array): Uint8Array =>
  Uint8Array.from(createHash("sha256").update(bytes).digest());
export const hash160 = (bytes: Uint8Array): Uint8Array =>
  Uint8Array.from(createHash("ripemd160").update(sha256(bytes)).digest());
const hmac512 = (key: Uint8Array | string, data: Uint8Array): Uint8Array =>
  Uint8Array.from(createHmac("sha512", key).update(data).digest());

/** BIP39: PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic"+passphrase, both NFKD. */
export function seedOf(mnemonic: string, passphrase = ""): Uint8Array {
  return Uint8Array.from(
    pbkdf2Sync(
      mnemonic.normalize("NFKD"),
      ("mnemonic" + passphrase).normalize("NFKD"),
      2048,
      64,
      "sha512",
    ),
  );
}

/** k·G as a compressed or uncompressed SEC1 point, through OpenSSL's ECDH. */
export function pointOf(k: bigint, compressed = true): Uint8Array {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(ser256(k)));
  return Uint8Array.from(ecdh.getPublicKey(undefined, compressed ? "compressed" : "uncompressed"));
}

export interface Node {
  readonly key: bigint;
  readonly chain: Uint8Array;
}

/** BIP32 master node: HMAC-SHA512 with key "Bitcoin seed". */
export function masterOf(seed: Uint8Array): Node {
  const I = hmac512("Bitcoin seed", seed);
  return { key: big(I.subarray(0, 32)), chain: I.subarray(32) };
}

/** BIP32 CKDpriv. */
export function child(node: Node, index: number): Node {
  const data =
    index >= HARDENED
      ? concat(Uint8Array.of(0), ser256(node.key), ser32(index))
      : concat(pointOf(node.key), ser32(index));
  const I = hmac512(node.chain, data);
  const tweak = big(I.subarray(0, 32));
  if (tweak >= N) throw new Error("BIP32: I_L >= n (not met with these vectors)");
  const key = (tweak + node.key) % N;
  if (key === 0n) throw new Error("BIP32: child key is zero");
  return { key, chain: I.subarray(32) };
}

/** Path such as m/84'/0'/0'/0/0. */
export function derive(seed: Uint8Array, path: string): Node {
  let node = masterOf(seed);
  for (const step of path.split("/").slice(1)) {
    const hardened = step.endsWith("'");
    const index = Number.parseInt(step, 10) + (hardened ? HARDENED : 0);
    node = child(node, index);
  }
  return node;
}

/** BIP32 fingerprint of a node: first four bytes of HASH160 of its compressed public key. */
export function fingerprintOf(node: Node): string {
  return hexOf(hash160(pointOf(node.key)).subarray(0, 4));
}

// ---------------------------------------------------------------- Base58Check
export const BITCOIN_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const XRP_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

export function base58(bytes: Uint8Array, alphabet = BITCOIN_ALPHABET): string {
  let value = big(bytes);
  let out = "";
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = alphabet[0] + out;
  }
  return out;
}

export function base58Decode(text: string, alphabet = BITCOIN_ALPHABET): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("not base58");
    value = value * 58n + BigInt(digit);
  }
  let hex = value === 0n ? "" : value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let zeros = 0;
  for (const char of text) {
    if (char !== alphabet[0]) break;
    zeros += 1;
  }
  return concat(new Uint8Array(zeros), bytesOf(hex));
}

export function base58check(payload: Uint8Array, alphabet = BITCOIN_ALPHABET): string {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58(concat(payload, checksum), alphabet);
}

// ---------------------------------------------------------------- Bech32 / Bech32m (BIP173, BIP350)
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk = (chk ^ GEN[i]!) >>> 0;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  return [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
}

export function convertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  return out;
}

export function bech32Encode(hrp: string, data: number[], variant: "bech32" | "bech32m"): string {
  const constant = variant === "bech32" ? BECH32_CONST : BECH32M_CONST;
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ constant;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}

export function segwitAddress(hrp: string, version: number, program: Uint8Array): string {
  return bech32Encode(hrp, [version, ...convertBits(program, 8, 5, true)], version === 0 ? "bech32" : "bech32m");
}

// ---------------------------------------------------------------- CashAddr (Bitcoin Cash spec)
function cashPolymod(values: number[]): bigint {
  const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i += 1) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i]!;
  }
  return c ^ 1n;
}

/** CashAddr with version byte `versionByte` (0 = P2PKH 160-bit, 8 = P2SH 160-bit). */
export function cashAddress(prefix: string, versionByte: number, hash: Uint8Array): string {
  const payload = convertBits(concat(Uint8Array.of(versionByte), hash), 8, 5, true);
  const prefixData = [...prefix].map((c) => c.charCodeAt(0) & 31);
  const mod = cashPolymod([...prefixData, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checksum = Array.from({ length: 8 }, (_, i) => Number((mod >> BigInt(5 * (7 - i))) & 31n));
  return prefix + ":" + [...payload, ...checksum].map((d) => CHARSET[d]).join("");
}

// ---------------------------------------------------------------- Ethereum-style accounts
export function keccakAccount(key: bigint): Uint8Array {
  const uncompressed = pointOf(key, false);
  return keccak_256(uncompressed.subarray(1)).subarray(12);
}

/** EIP-55 mixed-case checksum. */
export function eip55(account: Uint8Array): string {
  const lower = hexOf(account);
  const hash = hexOf(keccak_256(new TextEncoder().encode(lower)));
  return (
    "0x" +
    [...lower].map((c, i) => (Number.parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c)).join("")
  );
}

// ---------------------------------------------------------------- BIP86 Taproot
function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  return sha256(concat(tagHash, tagHash, data));
}

/** BIP86 output key x-only: tweak the even-Y private key by t = H_TapTweak(P_x). */
export function taprootOutputKey(key: bigint): Uint8Array {
  const P = pointOf(key);
  const even = P[0] === 0x02 ? key : N - key;
  const xOnly = P.subarray(1);
  const t = big(taggedHash("TapTweak", xOnly));
  if (t >= N) throw new Error("BIP341 tweak out of range");
  const q = (even + t) % N;
  return pointOf(q).subarray(1);
}

// ---------------------------------------------------------------- Addresses per coin
export type Kind =
  | "p2pkh"
  | "p2sh-p2wpkh"
  | "p2wpkh"
  | "p2tr"
  | "evm"
  | "tron"
  | "xrp"
  | "cashaddr"
  | "cosmos"
  | "injective"
  | "dash-platform";

export interface CoinSpec {
  readonly kind: Kind;
  /** Base58 version bytes for p2pkh / p2sh-p2wpkh, or the HRP for Bech32 kinds. */
  readonly version?: number[];
  readonly hrp?: string;
}

/** The address of `node` written as `spec` says. */
export function addressOf(node: Node, spec: CoinSpec): string {
  const pub = pointOf(node.key);
  switch (spec.kind) {
    case "p2pkh":
      return base58check(concat(Uint8Array.from(spec.version!), hash160(pub)));
    case "p2sh-p2wpkh":
      return base58check(
        concat(Uint8Array.from(spec.version!), hash160(concat(Uint8Array.of(0x00, 0x14), hash160(pub)))),
      );
    case "p2wpkh":
      return segwitAddress(spec.hrp!, 0, hash160(pub));
    case "p2tr":
      return segwitAddress(spec.hrp!, 1, taprootOutputKey(node.key));
    case "evm":
      return eip55(keccakAccount(node.key));
    case "tron":
      return base58check(concat(Uint8Array.of(0x41), keccakAccount(node.key)));
    case "xrp":
      return base58check(concat(Uint8Array.of(0x00), hash160(pub)), XRP_ALPHABET);
    case "cashaddr":
      return cashAddress("bitcoincash", 0, hash160(pub));
    case "cosmos":
      return bech32Encode(spec.hrp!, convertBits(hash160(pub), 8, 5, true), "bech32");
    case "injective":
      return bech32Encode("inj", convertBits(keccakAccount(node.key), 8, 5, true), "bech32");
    case "dash-platform":
      // DIP18: type byte 0xb0 (P2PKH payment) followed by HASH160 of the key, Bech32m.
      return bech32Encode(spec.hrp!, convertBits(concat(Uint8Array.of(0xb0), hash160(pub)), 8, 5, true), "bech32m");
  }
}

/** Decodes an extended private key (BIP32 serialization) into its node. */
export function nodeOfXprv(xprv: string): { node: Node; depth: number; fingerprint: string } {
  const raw = base58Decode(xprv);
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  if (hexOf(sha256(sha256(payload)).subarray(0, 4)) !== hexOf(checksum)) throw new Error("bad xprv checksum");
  return {
    depth: payload[4]!,
    fingerprint: hexOf(payload.subarray(5, 9)),
    node: { chain: payload.subarray(13, 45), key: big(payload.subarray(46, 78)) },
  };
}
