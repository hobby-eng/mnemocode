// One admission policy for every host: reject the announced size before reading a file, read
// only a bounded age header before asking for a key, and bound decrypted bytes before allocation.
// A host supplies the prefix reader; this module performs no file I/O and needs no Node.js globals.

import { base64nopad } from "@scure/base";
import { wipeAll } from "./bits.js";
import { MAX_CANDIDATE_LIST_BYTES, OpenedCandidateList } from "./candidate-list.js";
import { assertCandidateFileSize, CandidateFileRefusedError } from "./candidate-file-refusal.js";
import { defined } from "./defined.js";
import { ErrorCatalog } from "./error-catalog.js";

const ERRORS = new ErrorCatalog("core.candidate-file-admission", {
  "invalid-supported-header": () => "invalid supported header",
});

/** More than any supported single-stanza binary age header needs. */
const MAX_HEADER_BYTES = 64 * 1024;
/** age v1 STREAM: 64 KiB plaintext per chunk, a 16-byte tag per chunk, and a 16-byte nonce. */
const AGE_CHUNK_BYTES = 64 * 1024;
const AGE_TAG_BYTES = 16;
const AGE_NONCE_BYTES = 16;
/** age v1: X25519 public keys and SHA-256 header MACs are 32 bytes; scrypt's salt is 16. */
const X25519_KEY_BYTES = 32;
const HEADER_MAC_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
/** Both supported stanzas wrap a 16-byte age file key with a 16-byte AEAD tag. */
const WRAPPED_KEY_BYTES = 16 + AGE_TAG_BYTES;
/** Version, stanza arguments, one body line, then the MAC line (zero-based index 3). */
const MAC_LINE_INDEX = 3;
/** log2 of scrypt's work factor: fixed at 18 for candidate files, about 256 MiB. */
export const SCRYPT_LOG_N = 18;
const AGE_FIRST_LINE = "age-encryption.org/v1";
const MAC_LINE_START = "--- ";
const STANZA_LINE_START = "-> ";
const LOCK_STANZAS = Object.freeze({ key: "X25519", passphrase: "scrypt" });
/** How an encrypted list file is locked: with an age key (X25519) or with a passphrase (scrypt). */
export type ListFileLock = keyof typeof LOCK_STANZAS;
/**
 * age v1 recipient stanzas, as their fields after "-> ": `X25519 <share>` and
 * `scrypt <salt> <log2 N>`. The places of the fields, counted from 0.
 */
const STANZA_FIELD = Object.freeze({ type: 0, shareOrSalt: 1, workFactor: 2 });
/** The fields of each lock's stanza, its type included: up to its last field. */
const STANZA_FIELD_COUNTS = Object.freeze({
  key: STANZA_FIELD.shareOrSalt + 1,
  passphrase: STANZA_FIELD.workFactor + 1,
}) satisfies Readonly<Record<ListFileLock, number>>;
/** The form of a candidate file: the plain list, or the list encrypted with age. */
export type CandidateFileForm = "plaintext" | "age";

const PARAMETERS = Object.freeze({
  headerBytes: MAX_HEADER_BYTES,
  plaintextBytes: MAX_CANDIDATE_LIST_BYTES,
  encryptedBytes:
    MAX_HEADER_BYTES +
    AGE_NONCE_BYTES +
    MAX_CANDIDATE_LIST_BYTES +
    AGE_TAG_BYTES * Math.max(1, Math.ceil(MAX_CANDIDATE_LIST_BYTES / AGE_CHUNK_BYTES)),
});

/** Returns fresh bytes owned by admission, exactly the requested prefix length. */
export type CandidatePrefixReader = (length: number) => Promise<Uint8Array>;

/** Size and header checks that a page, worker, or command-line reader delegates to unchanged. */
export class CandidateFileAdmission {
  /** Whether `value` names a lock (ListFileLock); a JavaScript host may pass anything. */
  static isLock(value: unknown): value is ListFileLock {
    return typeof value === "string" && Object.hasOwn(LOCK_STANZAS, value);
  }

  /** Shared immutable limits for the header, plaintext and ciphertext, all in bytes. */
  static parameters(): typeof PARAMETERS {
    return PARAMETERS;
  }

  /**
   * An announced file size, in bytes, checked before a host reads any bytes. Zero is not format
   * validation. Refuses, as CandidateFileRefusedError "unsupported", a size that is no whole
   * number of 0 or more (core.candidate-file-refusal.size-not-whole), one over the limit of its
   * `form` (parameters(); plaintext-list-too-large, encrypted-file-too-large), and another form
   * (form-unsupported).
   */
  static assertSize(size: number, form: CandidateFileForm): void {
    if (form === "plaintext") OpenedCandidateList.assertSize(size);
    else if (form === "age")
      assertCandidateFileSize(size, PARAMETERS.encryptedBytes, "encrypted-file-too-large");
    else throw CandidateFileRefusedError.create("form-unsupported", []);
  }

  /**
   * Checks an encrypted file before full buffering or a key prompt. For a browser File, pass its
   * size and a reader of file.slice(0, length); admission wipes the reader's returned prefix.
   * The host must still bound the subsequent read and validate the bytes actually obtained.
   * Refuses, as CandidateFileRefusedError, a size that assertSize refuses and a header that lock
   * refuses ("unsupported"), and a prefix that is not as long as asked for ("damaged",
   * core.candidate-file-refusal.header-read-short). A failure of `readPrefix` passes on.
   */
  static async inspect(size: number, readPrefix: CandidatePrefixReader): Promise<ListFileLock> {
    this.assertSize(size, "age");
    const length = Math.min(size, MAX_HEADER_BYTES);
    const prefix = await readPrefix(length);
    try {
      if (prefix.byteLength !== length)
        throw CandidateFileRefusedError.create("header-read-short", []);
      return this.#lock(prefix);
    } finally {
      prefix.fill(0);
    }
  }

  /**
   * The same checks for bytes that a host has already read, without taking ownership of them.
   * Refuses, as CandidateFileRefusedError "unsupported", a size that assertSize refuses, and a
   * header that is no age file's (core.candidate-file-refusal.not-age-file), has no end
   * (header-without-end), has a stanza of no lock (recipient-unsupported), several stanzas
   * (several-recipients), a scrypt stanza at another work factor than SCRYPT_LOG_N
   * (scrypt-work-factor-unsupported), or another shape than one such stanza (header-malformed).
   */
  static lock(file: Uint8Array): ListFileLock {
    this.assertSize(file.byteLength, "age");
    return this.#lock(file.subarray(0, MAX_HEADER_BYTES));
  }

  /**
   * Refuses what lock refuses, and a supported header that needs another kind of key than `given`
   * (core.candidate-file-refusal.recipient-of-another-key).
   */
  static assertLock(file: Uint8Array, given: ListFileLock): void {
    if (this.lock(file) !== given)
      throw CandidateFileRefusedError.create("recipient-of-another-key", [LOCK_STANZAS[given]]);
  }

  /**
   * Fully consumes authenticated output; owned chunks are wiped on success and every refusal.
   * Refuses, as CandidateFileRefusedError "unsupported", output over MAX_CANDIDATE_LIST_BYTES
   * (core.candidate-file-refusal.plaintext-list-too-large) as soon as it is; a failure of the
   * stream passes on.
   */
  static async readPlaintext(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    let length = 0;
    let complete = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        length += value.byteLength;
        this.assertSize(length, "plaintext");
      }
      const whole = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        whole.set(chunk, offset);
        offset += chunk.byteLength;
      }
      complete = true;
      return whole;
    } finally {
      // Wipe before awaiting cancellation; a slow source must not prolong the chunks' lifetime.
      wipeAll(chunks);
      // Cancellation must not replace the original refusal, even when an upstream source fails.
      if (!complete) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  static #lock(prefix: Uint8Array): ListFileLock {
    const lines = new TextDecoder("latin1").decode(prefix).split("\n");
    if (lines[0] !== AGE_FIRST_LINE) throw CandidateFileRefusedError.create("not-age-file", []);
    const end = lines.findIndex((line) => line.startsWith(MAC_LINE_START));
    // A partial MAC line at the prefix boundary is not an end; age would keep reading past it.
    if (end < 0 || end === lines.length - 1)
      throw CandidateFileRefusedError.create("header-without-end", []);
    const stanzas = lines
      .slice(1, end)
      .filter((line) => line.startsWith(STANZA_LINE_START))
      .map((line) => line.slice(STANZA_LINE_START.length).split(" "));
    const type = stanzas[0]?.[STANZA_FIELD.type];
    const lock = Object.keys(LOCK_STANZAS).find(
      (kind): kind is ListFileLock =>
        CandidateFileAdmission.isLock(kind) && LOCK_STANZAS[kind] === type,
    );
    if (lock === undefined)
      throw CandidateFileRefusedError.create("recipient-unsupported", [
        Object.values(LOCK_STANZAS).join(" or "),
      ]);
    if (stanzas.length !== 1)
      throw CandidateFileRefusedError.create("several-recipients", [LOCK_STANZAS[lock]]);
    if (
      lock === "passphrase" &&
      defined(stanzas[0])[STANZA_FIELD.workFactor] !== String(SCRYPT_LOG_N)
    )
      throw CandidateFileRefusedError.create("scrypt-work-factor-unsupported", [SCRYPT_LOG_N]);
    // These recipients wrap a 16-byte file key with a 16-byte tag: one 32-byte body line.
    // Checking that shape also keeps a false MAC marker from hiding a later, unbounded header.
    try {
      const stanza = defined(stanzas[0]);
      const passphrase = lock === "passphrase";
      if (
        end !== MAC_LINE_INDEX ||
        !defined(lines[1]).startsWith(STANZA_LINE_START) ||
        stanza.length !== STANZA_FIELD_COUNTS[lock] ||
        base64nopad.decode(defined(stanza[STANZA_FIELD.shareOrSalt])).length !==
          (passphrase ? SCRYPT_SALT_BYTES : X25519_KEY_BYTES) ||
        base64nopad.decode(defined(lines[2])).length !== WRAPPED_KEY_BYTES ||
        base64nopad.decode(defined(lines[end]).slice(MAC_LINE_START.length)).length !==
          HEADER_MAC_BYTES
      )
        throw ERRORS.create("invalid-supported-header", []);
    } catch {
      throw CandidateFileRefusedError.create("header-malformed", []);
    }
    return lock;
  }
}
