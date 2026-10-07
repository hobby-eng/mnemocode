// The BIP32 master fingerprint of a BIP39 phrase, and whether a phrase has the fingerprint that the
// person names. A program that tells a wallet only by its fingerprint takes this module alone: it
// holds the BIP39 seed rule and the fingerprint, and nothing about addresses, extended keys or any
// coin, so a host for one coin can use it without the code of another (the multi-chain Deriver's
// Dash edition does). core/wallet-evidence.ts builds its other kinds of evidence on it.
//
// From the host it needs one function, PBKDF2-HMAC-SHA512, with which BIP39 turns a phrase into its
// seed. It may answer at once (node:crypto's pbkdf2Sync, @noble/hashes' pbkdf2) or with a promise
// (WebCrypto); the phrase and the passphrase are checked and normalized here (AUD-008-API005), so
// the host function gets only NFKD text.
//
// It keeps nothing: every seed and master key it derives is wiped before it returns.
//
// Host-neutral: it imports only @scure/bip32 and core/white-space.ts (test/portable-modules.test.ts).

import { HDKey } from "@scure/bip32";
import type { WalletMatch } from "./wallet-check.js";
import { trimWhiteSpace } from "./white-space.js";

/**
 * PBKDF2-HMAC-SHA512 of `password` under `salt`, with `rounds` iterations and `bytes` bytes of
 * output; both texts are encoded as UTF-8. It answers at once, as node:crypto's pbkdf2Sync does,
 * or with a promise, as WebCrypto's deriveBits does; the operations without "Async" need the
 * first, and the others take either.
 */
export type Pbkdf2HmacSha512 = (
  password: string,
  salt: string,
  rounds: number,
  bytes: number,
) => Uint8Array | PromiseLike<Uint8Array>;

/** BIP39 "From mnemonic to seed": PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes, this salt prefix. */
const SEED_ROUNDS = 2048;
const SEED_BYTES = 64;
const SEED_SALT_PREFIX = "mnemonic";
const BIP39_WORD_COUNTS: ReadonlySet<number> = new Set([12, 15, 18, 21, 24]);

/** The eight hexadecimal characters of a BIP32 master fingerprint. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/u;

/** What the person should know of a fingerprint that matched. */
export const FINGERPRINT_WARNING =
  "A master fingerprint is only 32 bits and is a filter, not proof of recovery.";

/**
 * A master fingerprint as typed, in lower case; refused unless it is eight hexadecimal characters.
 * A host checks an answer with it at once: no secret is needed.
 */
export function parseMasterFingerprint(value: string): string {
  const fingerprint = trimWhiteSpace(value).toLowerCase();
  if (!FINGERPRINT_PATTERN.test(fingerprint))
    throw new Error("A master fingerprint must be eight hexadecimal characters.");
  return fingerprint;
}

/** Whether the host's PBKDF2 answered with a promise rather than with the bytes. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

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
 * The phrase and the salt that BIP39 hashes into the seed, both NFKD, as @scure/bip39
 * mnemonicToSeedSync takes them; refused before any work when they cannot be a wallet's.
 */
function seedInput(
  mnemonic: string,
  passphrase: string,
): { readonly phrase: string; readonly salt: string } {
  const phrase = nfkd(mnemonic);
  if (!BIP39_WORD_COUNTS.has(phrase.split(" ").length)) throw new Error("Invalid mnemonic");
  // Checked before the template below would turn it into text.
  if (typeof passphrase !== "string") throw new TypeError("expected a string passphrase");
  return { phrase, salt: nfkd(`${SEED_SALT_PREFIX}${passphrase}`) };
}

/** The host's answer, refused unless it is a seed's 64 bytes; a wrong length is wiped first. */
function checkedSeed(seed: unknown): Uint8Array {
  if (!(seed instanceof Uint8Array)) throw new TypeError("The host's PBKDF2 gave no bytes.");
  if (seed.length !== SEED_BYTES) {
    seed.fill(0);
    throw new Error(`The host's PBKDF2 gave ${seed.length} bytes, not ${SEED_BYTES}.`);
  }
  return seed;
}

/**
 * The BIP39 seed of a phrase, from the host's PBKDF2. A class because the host's function is bound
 * once and every phrase uses it; it holds nothing else. The caller owns each seed it is given and
 * wipes it.
 */
export class Bip39Seed {
  readonly #pbkdf2: Pbkdf2HmacSha512;

  constructor(pbkdf2: Pbkdf2HmacSha512) {
    if (typeof pbkdf2 !== "function")
      throw new TypeError("A wallet check needs the host's PBKDF2-HMAC-SHA512 function.");
    this.#pbkdf2 = pbkdf2;
  }

  /** The seed from a PBKDF2 that answers at once; refused when it answers later. */
  now(mnemonic: string, passphrase: string): Uint8Array {
    const { phrase, salt } = seedInput(mnemonic, passphrase);
    const seed = this.#pbkdf2(phrase, salt, SEED_ROUNDS, SEED_BYTES);
    if (isPromiseLike(seed)) {
      // The seed that arrives later is wiped, and a refusal of it is not left unhandled.
      seed.then(
        (late) => {
          if (late instanceof Uint8Array) late.fill(0);
        },
        () => undefined,
      );
      throw new TypeError(
        "The host's PBKDF2 answers later: use matchAsync or fingerprintAsync with it.",
      );
    }
    return checkedSeed(seed);
  }

  /** The seed, as @scure/bip39 mnemonicToSeed gives it, from a PBKDF2 that may answer later. */
  async later(mnemonic: string, passphrase: string): Promise<Uint8Array> {
    const { phrase, salt } = seedInput(mnemonic, passphrase);
    return checkedSeed(await this.#pbkdf2(phrase, salt, SEED_ROUNDS, SEED_BYTES));
  }
}

/** The fingerprint of a master key as lowercase hexadecimal. */
export function fingerprintOfKey(root: HDKey): string {
  return root.fingerprint.toString(16).padStart(8, "0");
}

/**
 * The master fingerprint of `seed`, which is wiped. The fingerprint hashes the public key alone,
 * so the version bytes of the key do not change it, and the default ones serve every coin.
 */
function fingerprintOfSeed(seed: Uint8Array): string {
  let root: HDKey;
  try {
    root = HDKey.fromMasterSeed(seed);
  } finally {
    seed.fill(0);
  }
  try {
    return fingerprintOfKey(root);
  } finally {
    root.wipePrivateData();
  }
}

/**
 * The master fingerprint of BIP39 phrases, and whether a phrase has an expected one. Each
 * operation has two forms: one for a PBKDF2 that answers at once, and an Async one for one that may
 * answer later.
 */
export class MasterFingerprintCheck {
  readonly #seed: Bip39Seed;

  constructor(pbkdf2: Pbkdf2HmacSha512) {
    this.#seed = new Bip39Seed(pbkdf2);
  }

  /** The standard four-byte BIP32 master fingerprint as lowercase hexadecimal. */
  fingerprint(mnemonic: string, passphrase = ""): string {
    return fingerprintOfSeed(this.#seed.now(mnemonic, passphrase));
  }

  async fingerprintAsync(mnemonic: string, passphrase = ""): Promise<string> {
    return fingerprintOfSeed(await this.#seed.later(mnemonic, passphrase));
  }

  /**
   * Whether `mnemonic` has the fingerprint `expected`, which is checked first as
   * parseMasterFingerprint checks it. A fingerprint is only a filter, so a match carries
   * FINGERPRINT_WARNING.
   */
  match(mnemonic: string, expected: string, passphrase = ""): WalletMatch {
    const wanted = parseMasterFingerprint(expected);
    return matchOf(this.fingerprint(mnemonic, passphrase), wanted);
  }

  async matchAsync(mnemonic: string, expected: string, passphrase = ""): Promise<WalletMatch> {
    const wanted = parseMasterFingerprint(expected);
    return matchOf(await this.fingerprintAsync(mnemonic, passphrase), wanted);
  }
}

function matchOf(derived: string, expected: string): WalletMatch {
  return Object.freeze({ matched: derived === expected, path: "m", warning: FINGERPRINT_WARNING });
}
