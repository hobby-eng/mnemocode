// Encrypts a candidate list with age (docs/CANDIDATES.md, "Encryption"), one module for every host:
// MnemoCode, the Wallet Deriver and the Discovery Scanner compile it unchanged. A list goes either
// to the Scanner's one-time X25519 key (age1…) or, as a separate file, under a passphrase through
// scrypt; never both and never to more than one key, since a file is only as strong as its weakest
// stanza and age-encryption itself would accept a mix. Its only import is age-encryption, which
// needs crypto.getRandomValues and, for X25519, crypto.subtle; nothing of Node.js.

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

/** A one-time key: the identity that opens the file, and the recipient a writer encrypts to. */
export interface SessionIdentity {
  /** AGE-SECRET-KEY-1…: keep it only for the session, never write it down. */
  readonly identity: string;
  /** age1…, 62 characters, to copy into the program that writes the list. */
  readonly recipient: string;
}

/** Makes a one-time X25519 key; X25519 explicitly, whatever age-encryption's default becomes. */
export async function createSessionIdentity(): Promise<SessionIdentity> {
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
  const encrypter = new Encrypter();
  encrypter.addRecipient(parseRecipient(recipient));
  return encrypter.encrypt(plain);
}

/** Encrypts a list under a passphrase, at the fixed scrypt work factor. */
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
