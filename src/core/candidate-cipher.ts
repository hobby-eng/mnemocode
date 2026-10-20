// The age operations on candidate lists (docs/CANDIDATES.md, "Encryption") without the gate of
// their self-test. candidate-encryption.ts gates them and offers them to hosts; its self-test
// (candidate-encryption-checks.ts) calls them here, since a check behind the gate would wait for
// itself. A module of their own, so that the gate and the self-test import them and not each other.
// It also holds the owner of the Scanner's one-time key (SessionIdentity), since only its
// decryption may read the private key.
//
// From the host it needs crypto.getRandomValues and, for X25519 only, WebCrypto (crypto.subtle),
// which a browser offers only on a secure page; without it the X25519 operations refuse at once
// with one line, while the passphrase operations work, since age takes scrypt and its ciphers from
// @noble. Host-neutral: its only package import is age-encryption.

import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { describeError } from "./refusal.js";
import {
  CandidateFileAdmission,
  SCRYPT_LOG_N,
  type ListFileLock,
} from "./candidate-file-admission.js";
import { CandidateFileRefusedError } from "./candidate-file-refusal.js";
import { ERRORS } from "./candidate-encryption-errors.js";
import { Redacted } from "./redacted.js";
import { bytesWhileLive, SecretValue } from "./secret-value.js";

/** An X25519 recipient: "age1", then 58 Bech32 characters (age-encryption.org/v1). */
const X25519_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/u;
/** Bound age's temporary reads: its nonce reader concatenates the input chunks it receives. */
const ENCRYPTED_READ_CHUNK_BYTES = 64 * 1024;

/**
 * Borrowed ciphertext views: age never needs a temporary copy of the entire file to read a nonce.
 */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      const end = Math.min(bytes.byteLength, offset + ENCRYPTED_READ_CHUNK_BYTES);
      if (end > offset) controller.enqueue(bytes.subarray(offset, end));
      offset = end;
      if (offset === bytes.byteLength) controller.close();
    },
  });
}

/**
 * The private key of a live session identity, decoded from its bytes for one call to
 * Decrypter.addIdentity (CandidateCipher.decrypt); refused once wiped (core.secret-value.wiped).
 * SessionIdentity's static block sets it, so that only this module reads the key: no member of the
 * class gives it to a host.
 */
let privateKeyOf: (session: SessionIdentity) => string;

/**
 * A session-only age X25519 identity, the Scanner's one-time key: the private AGE-SECRET-KEY-1 text,
 * held as bytes from the moment it is made, and the public recipient that a writer may be given. A
 * class, so that the key has an owner that wipes it when the session ends and never shows it
 * through toString, toJSON or Node.js's inspect; only the decryption of a candidate file reads it.
 */
export class SessionIdentity extends Redacted implements Disposable {
  readonly #identity: SecretValue<string>;
  readonly #recipient: string;

  static {
    privateKeyOf = (session) => session.#identity.value;
  }

  private constructor(identity: string, recipient: string) {
    super("SessionIdentity");
    this.#identity = SecretValue.text(identity);
    this.#recipient = recipient;
  }

  /**
   * The session identity of `text`, a private AGE-SECRET-KEY-1 key of X25519, such as a published
   * test key. Refuses where WebCrypto is missing (core.candidate-encryption.no-webcrypto), and
   * text that is no X25519 age identity, a post-quantum one included, without repeating the text
   * (core.candidate-file-refusal.identity-invalid).
   */
  static async fromText(text: string): Promise<SessionIdentity> {
    CandidateCipher.requireX25519();
    let recipient: string;
    try {
      // Decodes the Bech32 text and checks its checksum; the recipient tells X25519 from others.
      recipient = await identityToRecipient(text);
    } catch {
      // The decoder includes a malformed private identity in its error. Neither that diagnostic
      // nor its cause may reach a host's UI, inspection or logging.
      throw CandidateFileRefusedError.create("identity-invalid", []);
    }
    if (!X25519_RECIPIENT.test(recipient))
      throw CandidateFileRefusedError.create("identity-invalid", []);
    return new SessionIdentity(text, recipient);
  }

  /** The public age1… recipient of 62 characters, which a writer encrypts a list to. */
  get recipient(): string {
    return this.#recipient;
  }

  /**
   * Refuses a use of the key once the session has ended, also across an await
   * (core.secret-value.wiped).
   */
  assertLive(): void {
    this.#identity.assertLive();
  }

  /**
   * Overwrites the private key's bytes, as far as the runtime allows, once the session ends and
   * every decryption has settled; a later use is refused (core.secret-value.wiped).
   */
  wipe(): void {
    this.#identity.wipe();
  }

  /** Ends the session's key, also when a using scope exits through a failure. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The key that opens a candidate file: the session identity, or a passphrase. */
export type CandidateFileKey =
  | {
      /** The Scanner's session identity (createSessionIdentity or SessionIdentity.fromText). */
      readonly identity: SessionIdentity;
    }
  | {
      /** The passphrase the file was encrypted under, by the rule of parseListPassphrase. */
      readonly passphrase: string;
    };

/**
 * The age operations on candidate lists, ungated: to the Scanner's one-time X25519 key, or under a
 * passphrase through scrypt, never both and never to more than one key. A class of static methods,
 * as CandidateFileAdmission is, since the operations keep no state; a host takes them through
 * candidate-encryption.ts, which runs them only after their self-test passed.
 */
export class CandidateCipher {
  /**
   * Refuses the X25519 operations where WebCrypto (crypto.subtle) is missing
   * (core.candidate-encryption.no-webcrypto), as on a page served over plain http from another
   * computer, before any of them starts. age-encryption falls back to @noble only when `crypto` is
   * missing altogether or rejects X25519 as not supported; without crypto.subtle it would fail deep
   * inside with a bare TypeError ("Cannot read properties of undefined") that tells a person
   * nothing.
   */
  static requireX25519(): void {
    if (typeof globalThis.crypto?.subtle?.importKey !== "function")
      throw ERRORS.create("no-webcrypto", []);
  }

  /**
   * The recipient as typed, pasted or read from a file: one age1… key, in any case. Its Bech32
   * checksum is checked here too, so that a typing error shows before any search. Refuses any
   * other text (core.candidate-encryption.key-one-age-key-62-characters-starts-age1).
   */
  static parseRecipient(text: string): string {
    const recipient = text.trim().toLowerCase();
    const refused = ERRORS.create("key-one-age-key-62-characters-starts-age1", []);
    if (!X25519_RECIPIENT.test(recipient)) throw refused;
    try {
      // Decodes the Bech32 text and checks its checksum and length, without encrypting anything.
      new Encrypter().addRecipient(recipient);
    } catch {
      throw refused;
    }
    return recipient;
  }

  /**
   * Makes a one-time X25519 key; X25519 explicitly, whatever age-encryption's default becomes. Its
   * text is held by the SessionIdentity at once. Refuses where WebCrypto is missing
   * (core.candidate-encryption.no-webcrypto).
   */
  static async createSessionIdentity(): Promise<SessionIdentity> {
    CandidateCipher.requireX25519();
    return SessionIdentity.fromText(await generateX25519Identity());
  }

  /**
   * The age file of `plain`, borrowed and unchanged, to `recipient`, the Scanner's one-time key:
   * fresh bytes that the caller wipes. Refuses a list over the size limit
   * (core.candidate-file-refusal.plaintext-list-too-large), a page without WebCrypto
   * (core.candidate-encryption.no-webcrypto) and a recipient that is no age key (parseRecipient).
   */
  static async encrypt(plain: Uint8Array, recipient: string): Promise<Uint8Array> {
    CandidateFileAdmission.assertSize(plain.byteLength, "plaintext");
    CandidateCipher.requireX25519();
    const encrypter = new Encrypter();
    encrypter.addRecipient(CandidateCipher.parseRecipient(recipient));
    return encrypter.encrypt(plain);
  }

  /** Refuses an empty passphrase (core.candidate-encryption.passphrase-candidates-empty). */
  static assertPassphrase(passphrase: string): void {
    if (passphrase === "") throw ERRORS.create("passphrase-candidates-empty", []);
  }

  /**
   * The age file of `plain`, borrowed and unchanged, under `passphrase` through scrypt at work
   * factor 2^SCRYPT_LOG_N: fresh bytes that the caller wipes. The passphrase is used as given: a
   * host reads it with parseListPassphrase (candidate-encryption.ts) first. Refuses a list over the
   * size limit (core.candidate-file-refusal.plaintext-list-too-large) and an empty passphrase
   * (assertPassphrase).
   */
  static async encryptWithPassphrase(plain: Uint8Array, passphrase: string): Promise<Uint8Array> {
    CandidateFileAdmission.assertSize(plain.byteLength, "plaintext");
    CandidateCipher.assertPassphrase(passphrase);
    const encrypter = new Encrypter();
    encrypter.setPassphrase(passphrase);
    encrypter.setScryptWorkFactor(SCRYPT_LOG_N);
    return encrypter.encrypt(plain);
  }

  /**
   * Decrypts a candidate file with the session identity or with a passphrase, after checking that
   * its header has exactly one stanza, of the kind that key opens (CandidateFileAdmission). The
   * whole file is authenticated before it is returned, as fresh bytes that the caller wipes; with
   * the session identity, only while it is live. Refuses an identity that is no SessionIdentity, as
   * a JavaScript host may pass one (core.candidate-encryption.not-session-identity), and a session
   * identity wiped before or during the decryption (core.secret-value.wiped, its plaintext
   * overwritten); as CandidateFileRefusedError, a file of another form or for another kind of key
   * ("unsupported", CandidateFileAdmission.assertLock), a key that does not open the file ("key",
   * scanner-key-does-not-open, passphrase-does-not-open), contents changed or cut ("damaged",
   * contents-damaged), and contents over the size limit ("unsupported", plaintext-list-too-large,
   * CandidateFileAdmission.readPlaintext); and a key operation where WebCrypto is missing
   * (core.candidate-encryption.no-webcrypto).
   */
  static async decrypt(file: Uint8Array, key: CandidateFileKey): Promise<Uint8Array> {
    if ("identity" in key) {
      const session = key.identity;
      if (!(session instanceof SessionIdentity)) throw ERRORS.create("not-session-identity", []);
      const plain = await CandidateCipher.#open(file, "key", (decrypter) =>
        decrypter.addIdentity(privateKeyOf(session)),
      );
      return bytesWhileLive(plain, () => session.assertLive());
    }
    return CandidateCipher.#open(file, "passphrase", (decrypter) =>
      decrypter.addPassphrase(key.passphrase),
    );
  }

  /**
   * decrypt with the key that `add` gives an age Decrypter, the `given` kind of lock: admission,
   * then the header, then the contents.
   */
  static async #open(
    file: Uint8Array,
    given: ListFileLock,
    add: (decrypter: Decrypter) => void,
  ): Promise<Uint8Array> {
    CandidateFileAdmission.assertLock(file, given);
    if (given === "key") CandidateCipher.requireX25519();
    const decrypter = new Decrypter();
    add(decrypter);
    // Given bytes, age reads its output through a fetch Response, and a browser replaces any error
    // inside it with its own ("Failed to fetch", "The operation was aborted"): given a stream, it
    // returns the stream unread, and its own error, such as "invalid tag", reaches every host.
    let stream: ReadableStream<Uint8Array>;
    try {
      // The header: a key that opens no stanza fails here, and so does a stanza changed on its
      // way, which age cannot tell apart from a wrong key.
      stream = await decrypter.decrypt(streamOf(file));
    } catch (error) {
      const refusal = given === "key" ? "scanner-key-does-not-open" : "passphrase-does-not-open";
      throw CandidateFileRefusedError.create(refusal, [describeError(error)], error);
    }
    try {
      return await CandidateFileAdmission.readPlaintext(stream);
    } catch (error) {
      if (error instanceof CandidateFileRefusedError) throw error;
      // The contents: every chunk carries its own tag, so a changed or cut file fails here.
      throw CandidateFileRefusedError.create("contents-damaged", [describeError(error)], error);
    }
  }
}
