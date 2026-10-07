// Encrypts a candidate list with age (docs/CANDIDATES.md, "Encryption"), one module for every host:
// MnemoCode, the Wallet Deriver and the Discovery Scanner compile it unchanged. A list goes either
// to the Scanner's one-time X25519 key (age1…) or, as a separate file, under a passphrase through
// scrypt; never both and never to more than one key, since a file is only as strong as its weakest
// stanza and age-encryption itself would accept a mix. ListProtection, at the end, is the entry: the
// three ways to protect a list behind one interface, chosen once. It also holds the rule for the
// passphrase of a list (parseListPassphrase), so that every host accepts the same ones.
//
// From the host it needs crypto.getRandomValues and, for X25519 only, WebCrypto (crypto.subtle),
// which a browser offers only on a secure page; without it the X25519 operations refuse at once
// with one line, while the passphrase operations work, since age takes scrypt and its ciphers from
// @noble. It reads and writes no file and asks nothing; its only import is age-encryption, nothing
// of Node.js.

import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption";

/** The stanza types that the two kinds of file have, each the only one in its header. */
const X25519_STANZA = "X25519";
const SCRYPT_STANZA = "scrypt";
/** log2 of the scrypt work factor: about 1.3 s and 256 MiB, which a browser page still manages. */
export const SCRYPT_LOG_N = 18;
/** An X25519 recipient: "age1", then 58 Bech32 characters (age-encryption.org/v1). */
const X25519_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/u;
/** age's binary header starts with this line and ends with the line of its MAC. */
const AGE_FIRST_LINE = "age-encryption.org/v1";
const MAC_LINE_START = "---";
const STANZA_LINE_START = "-> ";
/** More than any header with one stanza needs. */
const MAX_HEADER_BYTES = 64 * 1024;
/** Shorter list passphrases are refused: the passphrase is all that protects the seed phrases. */
export const MIN_LIST_PASSPHRASE_LENGTH = 12;
/** U+FEFF, which an editor may put at the start of a passphrase file. */
const BYTE_ORDER_MARK = "\uFEFF";
const REDACTED_PASSPHRASE = "[PassphraseProtection: redacted]";
const NO_WEBCRYPTO =
  "An age key (X25519) needs WebCrypto (crypto.subtle), which is missing here: a browser offers it only on a secure page, opened as a file, from localhost or over https.";

/**
 * Refuses X25519 where WebCrypto is missing, as on a page served over plain http from another
 * computer. age-encryption falls back to @noble only when `crypto` is missing altogether or
 * rejects X25519 as not supported; without crypto.subtle it would fail deep inside with a bare
 * TypeError ("Cannot read properties of undefined") that tells a person nothing.
 */
function requireWebCryptoX25519(): void {
  if (typeof globalThis.crypto?.subtle?.importKey !== "function") throw new Error(NO_WEBCRYPTO);
}

/** A one-time key: the identity that opens the file, and the recipient a writer encrypts to. */
export interface SessionIdentity {
  /** AGE-SECRET-KEY-1…: keep it only for the session, never write it down. */
  readonly identity: string;
  /** age1…, 62 characters, to copy into the program that writes the list. */
  readonly recipient: string;
}

/** Makes a one-time X25519 key; X25519 explicitly, whatever age-encryption's default becomes. */
export async function createSessionIdentity(): Promise<SessionIdentity> {
  requireWebCryptoX25519();
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/**
 * The recipient as typed, pasted or read from a file: one age1… key, in any case. Its Bech32
 * checksum is checked here too, so that a typing error shows before any search.
 */
export function parseRecipient(text: string): string {
  const recipient = text.trim().toLowerCase();
  const refused = new Error(
    "The key must be one age key of 62 characters that starts with age1, as the Scanner shows it.",
  );
  if (!X25519_RECIPIENT.test(recipient)) throw refused;
  try {
    // Decodes the Bech32 text and checks its checksum and length, without encrypting anything.
    new Encrypter().addRecipient(recipient);
  } catch {
    throw refused;
  }
  return recipient;
}

/** Encrypts a list to the Scanner's one-time key. */
export async function encryptCandidates(plain: Uint8Array, recipient: string): Promise<Uint8Array> {
  requireWebCryptoX25519();
  const encrypter = new Encrypter();
  encrypter.addRecipient(parseRecipient(recipient));
  return encrypter.encrypt(plain);
}

/**
 * The passphrase of a list as docs/CANDIDATES.md defines it: the text as entered, without white
 * space at its ends; from a file also without a byte order mark. A short one is refused.
 */
export function parseListPassphrase(text: string): string {
  const passphrase = (text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text).trim();
  // Characters as a person counts them: code points, not UTF-16 units.
  if ([...passphrase].length < MIN_LIST_PASSPHRASE_LENGTH)
    throw new Error(
      `Use at least ${MIN_LIST_PASSPHRASE_LENGTH} characters for the passphrase: it is all that protects these seed phrases.`,
    );
  return passphrase;
}

/**
 * Encrypts a list under a passphrase, at the fixed scrypt work factor. The passphrase is used as
 * given: a host reads it with parseListPassphrase first.
 */
export async function encryptCandidatesWithPassphrase(
  plain: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  if (passphrase === "") throw new Error("The passphrase for the candidates is empty.");
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(SCRYPT_LOG_N);
  return encrypter.encrypt(plain);
}

/** The stanzas of a binary age file's header, each as its type followed by its arguments. */
export function ageStanzas(file: Uint8Array): string[][] {
  const header = new TextDecoder("latin1").decode(file.subarray(0, MAX_HEADER_BYTES));
  const lines = header.split("\n");
  if (lines[0] !== AGE_FIRST_LINE) throw new Error("This is not a binary age file.");
  const end = lines.findIndex((line) => line.startsWith(MAC_LINE_START));
  if (end < 0) throw new Error("The age header has no end.");
  return lines
    .slice(1, end)
    .filter((line) => line.startsWith(STANZA_LINE_START))
    .map((line) => line.slice(STANZA_LINE_START.length).split(" "));
}

/**
 * Decrypts a candidate file with the session identity or with a passphrase, after checking that
 * its header has exactly one stanza, of the kind that key opens: X25519 for an identity, scrypt at
 * the fixed work factor for a passphrase. The whole file is authenticated before it is returned.
 */
export async function decryptCandidates(
  file: Uint8Array,
  key: { readonly identity: string } | { readonly passphrase: string },
): Promise<Uint8Array> {
  if ("identity" in key) requireWebCryptoX25519();
  const stanzas = ageStanzas(file);
  const expected = "identity" in key ? X25519_STANZA : SCRYPT_STANZA;
  if (stanzas.length !== 1 || stanzas[0]![0] !== expected)
    throw new Error(`The candidate file must have exactly one ${expected} recipient.`);
  // An scrypt stanza is "scrypt <salt> <log2 of the work factor>".
  if (expected === SCRYPT_STANZA && stanzas[0]![2] !== String(SCRYPT_LOG_N))
    throw new Error(`The candidate file must use the scrypt work factor ${SCRYPT_LOG_N}.`);
  const decrypter = new Decrypter();
  if ("identity" in key) decrypter.addIdentity(key.identity);
  else decrypter.addPassphrase(key.passphrase);
  return decrypter.decrypt(file);
}

/**
 * How a candidate list file is protected: to the Scanner's key, under a passphrase, or, only on
 * the person's explicit request, not at all. Each is its own type behind this interface, so that a
 * host chooses once and then saves a list the same way whichever it is.
 */
export interface ListProtection {
  /** Whether the file is encrypted; one that is not holds seed phrases in the open. */
  readonly encrypted: boolean;
  /** How the saved file is protected, as the line that reports a save says it. */
  readonly description: string;
  /** The file to write for an encoded list (encodeCandidateList). */
  protect(list: Uint8Array): Promise<Uint8Array>;
}

/** A list encrypted to the Discovery Scanner's one-time X25519 key (age1…). */
export class ScannerKeyProtection implements ListProtection {
  readonly #recipient: string;

  /** Takes the key as typed, pasted or read from a file, and refuses one that is not an age key. */
  constructor(key: string) {
    this.#recipient = parseRecipient(key);
  }

  // Getters, not readonly fields, which a caller could overwrite at run time: what the object says
  // of the file must stay what protect does.
  get encrypted(): boolean {
    return true;
  }

  get description(): string {
    return "encrypted to the Scanner's key";
  }

  /** The key, age1… in lower case: a public key, which may be shown. */
  get recipient(): string {
    return this.#recipient;
  }

  protect(list: Uint8Array): Promise<Uint8Array> {
    return encryptCandidates(list, this.#recipient);
  }
}

/**
 * A list encrypted under a passphrase through scrypt. A class pays off here: the passphrase is
 * read by the rule of parseListPassphrase, so that a short one cannot be used, and it is kept only
 * here, never shown through toString, toJSON or Node's inspect.
 */
export class PassphraseProtection implements ListProtection {
  readonly #passphrase: string;

  /** Takes the passphrase as typed or read from a file (parseListPassphrase). */
  constructor(text: string) {
    this.#passphrase = parseListPassphrase(text);
  }

  // Getters, as in ScannerKeyProtection: they cannot be overwritten.
  get encrypted(): boolean {
    return true;
  }

  get description(): string {
    return "encrypted with the passphrase";
  }

  protect(list: Uint8Array): Promise<Uint8Array> {
    return encryptCandidatesWithPassphrase(list, this.#passphrase);
  }

  toString(): string {
    return REDACTED_PASSPHRASE;
  }

  toJSON(): string {
    return REDACTED_PASSPHRASE;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED_PASSPHRASE;
  }
}

/** A list written without encryption, only on the person's explicit request. */
export class NoProtection implements ListProtection {
  // Getters, as in ScannerKeyProtection: a list in the open must never be reported as encrypted.
  get encrypted(): boolean {
    return false;
  }

  get description(): string {
    return "NOT encrypted";
  }

  /** The list itself, the same bytes. */
  protect(list: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(list);
  }
}
