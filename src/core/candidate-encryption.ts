// Encrypts a candidate list with age (docs/CANDIDATES.md, "Encryption"), one module for every host:
// MnemoCode, the Wallet Deriver and the Discovery Scanner compile it unchanged. A list goes either
// to the Scanner's one-time X25519 key (age1…) or, as a separate file, under a passphrase through
// scrypt; never both and never to more than one key, since a file is only as strong as its weakest
// stanza and age-encryption itself would accept a mix. ListProtection, at the end, is the entry:
// the three ways to protect a list behind one interface, chosen once. It also holds the rule for
// the passphrase of a list (parseListPassphrase), so that every host accepts the same ones.
//
// The age operations themselves are candidate-cipher.ts's; this module runs them only after their
// self-test passed (candidate-encryption-checks.ts), once per kind of lock and again where a host
// asks. From the host it needs what they need: crypto.getRandomValues and, for X25519 only,
// WebCrypto (crypto.subtle), without which the X25519 operations refuse at once with one line,
// while the passphrase operations work. It reads and writes no file and asks nothing; it imports
// no package itself, and its shared admission policy is host-neutral too.

import { Redacted } from "./redacted.js";
import { bytesWhileLive, SecretValue } from "./secret-value.js";
import { withoutByteOrderMark } from "./white-space.js";
import { listInWords } from "./places.js";
import { CandidateFileAdmission, type ListFileLock } from "./candidate-file-admission.js";
import {
  CandidateCipher,
  type CandidateFileKey,
  type SessionIdentity,
} from "./candidate-cipher.js";
import { ERRORS } from "./candidate-encryption-errors.js";
import { CandidateEncryptionChecks } from "./candidate-encryption-checks.js";

/**
 * For other hosts: the owner of the Scanner's one-time key, which createSessionIdentity makes and
 * decryptCandidates takes as `{ identity }`; SessionIdentity.fromText takes a published test key.
 */
export { SessionIdentity } from "./candidate-cipher.js";

// Keep the existing import paths valid for hosts that already use this module.
export { CandidateFileRefusedError, type CandidateFileProblem } from "./candidate-file-refusal.js";
export { SCRYPT_LOG_N, type ListFileLock } from "./candidate-file-admission.js";

/**
 * The fewest characters, counted as Unicode code points (not UTF-16 units), that a list passphrase
 * may have; parseListPassphrase refuses a shorter one, since the passphrase is all that protects
 * the seed phrases.
 */
export const MIN_LIST_PASSPHRASE_LENGTH = 12;

/**
 * The recipient as typed, pasted or read from a file: one age1… key, in any case, its Bech32
 * checksum checked, so that a typing error shows before any search. Refuses any other text
 * (core.candidate-encryption.key-one-age-key-62-characters-starts-age1). The cipher's rule,
 * retained under the original public function name.
 */
export function parseRecipient(text: string): string {
  return CandidateCipher.parseRecipient(text);
}

/**
 * The passphrase of a list as docs/CANDIDATES.md defines it: the text as entered, without white
 * space at its ends; from a file also without a byte order mark. One shorter than
 * MIN_LIST_PASSPHRASE_LENGTH characters is refused
 * (core.candidate-encryption.use-at-least-characters-passphrase-all-protects-seed).
 */
export function parseListPassphrase(text: string): string {
  const passphrase = withoutByteOrderMark(text).trim();
  // Characters as a person counts them: code points, not UTF-16 units.
  if (Array.from(passphrase).length < MIN_LIST_PASSPHRASE_LENGTH)
    throw ERRORS.create("use-at-least-characters-passphrase-all-protects-seed", [
      `${MIN_LIST_PASSPHRASE_LENGTH}`,
    ]);
  return passphrase;
}

/**
 * How a host chooses to protect a list: to the Scanner's key, under a passphrase, or not at all.
 */
export type ListProtectionChoice =
  | {
      /** To the Scanner's key (ScannerKeyProtection). */
      readonly kind: "key";
      /** The Scanner's one-time key, age1…, as typed, pasted or read (parseRecipient). */
      readonly recipient: string;
    }
  | {
      /** Under a passphrase (PassphraseProtection). */
      readonly kind: "passphrase";
      /** The passphrase as typed or read from a file (parseListPassphrase). */
      readonly passphrase: string;
    }
  | {
      /** Not at all, only on the person's explicit request (NoProtection). */
      readonly kind: "none";
    };

/**
 * The shared admission policy, retained under the original public function name: how `file` is
 * locked. Refuses, as CandidateFileRefusedError, what CandidateFileAdmission.lock refuses
 * (core.candidate-file-refusal.not-age-file and the others it names).
 */
export function listFileLock(file: Uint8Array): ListFileLock {
  return CandidateFileAdmission.lock(file);
}

/** One asynchronous feature check, shared by concurrent calls and retried after a failed check. */
class CipherHealth {
  readonly #check: () => Promise<void>;
  #pending: Promise<void> | undefined;
  #failureEpoch = Symbol();

  constructor(check: () => Promise<void>) {
    this.#check = check;
  }

  ready(): Promise<void> {
    return this.#pending ?? this.refresh();
  }

  refresh(after?: Promise<void>): Promise<void> {
    const pending = Promise.resolve(after).then(this.#check);
    this.#pending = pending;
    void pending.catch(() => {
      if (this.#pending === pending) {
        this.#failureEpoch = Symbol();
        this.#pending = undefined;
      }
    });
    return pending;
  }

  current(pending: Promise<void>): boolean {
    return this.#pending === pending;
  }

  failureEpoch(): symbol {
    return this.#failureEpoch;
  }
}

const SYMMETRIC_HEALTH = new CipherHealth(() => CandidateEncryptionChecks.symmetric());
const KEY_HEALTH = new CipherHealth(() => CandidateEncryptionChecks.quick());

interface CipherState {
  readonly symmetric: Promise<void>;
  readonly key: Promise<void> | undefined;
  readonly symmetricEpoch: symbol;
  readonly keyEpoch: symbol | undefined;
}

function assertNoCipherFailure(state: CipherState): void {
  if (
    SYMMETRIC_HEALTH.failureEpoch() !== state.symmetricEpoch ||
    (state.keyEpoch !== undefined && KEY_HEALTH.failureEpoch() !== state.keyEpoch)
  )
    throw ERRORS.create("self-test-failed", []);
}

function currentCipher(state: CipherState): boolean {
  return (
    SYMMETRIC_HEALTH.current(state.symmetric) &&
    (state.key === undefined || KEY_HEALTH.current(state.key))
  );
}

async function cipherState(kind: ListFileLock): Promise<CipherState> {
  if (!CandidateFileAdmission.isLock(kind)) throw ERRORS.create("unsupported-lock", []);
  if (kind === "key") CandidateCipher.requireX25519();
  try {
    for (;;) {
      const symmetric = SYMMETRIC_HEALTH.ready();
      await symmetric;
      const key = kind === "key" ? KEY_HEALTH.ready() : undefined;
      if (key !== undefined) await key;
      const state = {
        symmetric,
        key,
        symmetricEpoch: SYMMETRIC_HEALTH.failureEpoch(),
        keyEpoch: key === undefined ? undefined : KEY_HEALTH.failureEpoch(),
      };
      if (currentCipher(state)) return state;
    }
  } catch {
    throw ERRORS.create("self-test-failed", []);
  }
}

/** A forced recheck is a barrier before work and before publishing its asynchronous result. */
async function withCipherHealth<Value>(
  kind: ListFileLock,
  use: () => Promise<Value>,
  retire?: (value: Value) => void,
): Promise<Value> {
  for (;;) {
    const state = await cipherState(kind);
    if (!currentCipher(state)) continue;
    const value = await use();
    try {
      for (;;) {
        // A later successful retry may admit fresh work, but cannot rehabilitate this result.
        assertNoCipherFailure(state);
        const checked = await cipherState(kind);
        assertNoCipherFailure(state);
        if (currentCipher(checked)) return value;
      }
    } catch (error) {
      retire?.(value);
      throw error;
    }
  }
}

/**
 * Fast lazy integrity gate before a host enables candidate encryption controls. Passphrase
 * operations need only the symmetric check; key operations additionally require WebCrypto and
 * X25519 known answers. Successful checks are cached; failures leave the feature unavailable.
 * Refuses a `kind` that is no lock (core.candidate-encryption.unsupported-lock), "key" where
 * WebCrypto is missing (no-webcrypto), and a failed check (self-test-failed).
 */
export async function assertCandidateEncryptionReady(kind: ListFileLock): Promise<void> {
  for (;;) {
    const state = await cipherState(kind);
    if (currentCipher(state)) return;
  }
}

/**
 * Reruns all fast known answers explicitly, without scrypt or the first-use cache. Fails as the
 * first failed check fails (CandidateEncryptionChecks.symmetric and quick:
 * core.self-test-check.mismatch and the others they name); the feature stays unavailable until a
 * later check passes.
 */
export async function checkCandidateEncryptionQuick(): Promise<void> {
  // Publish both barriers synchronously: new operations cannot reuse an earlier successful run.
  const symmetric = SYMMETRIC_HEALTH.refresh();
  const key = KEY_HEALTH.refresh(symmetric);
  await Promise.all([symmetric, key]);
}

/**
 * Generates a session identity only after the fast key feature checks pass: the owner of its
 * private key, which the host keeps for the session and then wipes (SessionIdentity). Refuses where
 * WebCrypto is missing (core.candidate-encryption.no-webcrypto) and where a check failed
 * (self-test-failed).
 */
export async function createSessionIdentity(): Promise<SessionIdentity> {
  return withCipherHealth("key", () => CandidateCipher.createSessionIdentity());
}

/**
 * Encrypts borrowed plaintext to a validated Scanner key after the fast key integrity gate.
 * Refuses a plaintext over the size limit (core.candidate-file-refusal.plaintext-list-too-large),
 * a `recipient` that is no age key
 * (core.candidate-encryption.key-one-age-key-62-characters-starts-age1), a page without WebCrypto
 * (no-webcrypto) and a failed check (self-test-failed).
 */
export async function encryptCandidates(plain: Uint8Array, recipient: string): Promise<Uint8Array> {
  CandidateFileAdmission.assertSize(plain.byteLength, "plaintext");
  const checked = parseRecipient(recipient);
  return withCipherHealth(
    "key",
    () => CandidateCipher.encrypt(plain, checked),
    (bytes) => bytes.fill(0),
  );
}

/**
 * Encrypts borrowed plaintext with fixed-cost scrypt after the fast symmetric integrity gate.
 * Refuses a plaintext over the size limit (core.candidate-file-refusal.plaintext-list-too-large),
 * an empty passphrase (core.candidate-encryption.passphrase-candidates-empty) and a failed check
 * (self-test-failed).
 */
export async function encryptCandidatesWithPassphrase(
  plain: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  CandidateFileAdmission.assertSize(plain.byteLength, "plaintext");
  CandidateCipher.assertPassphrase(passphrase);
  return withCipherHealth(
    "passphrase",
    () => CandidateCipher.encryptWithPassphrase(plain, passphrase),
    (bytes) => bytes.fill(0),
  );
}

/**
 * Authenticates borrowed file bytes after admission and the appropriate fast feature gate, with
 * `key`: `{ identity }`, the live session identity, or `{ passphrase }`. The plaintext is fresh
 * bytes that the caller wipes, returned only while the session identity is live. Refuses, as
 * CandidateFileRefusedError, a file that is not one for `key`
 * (CandidateFileAdmission.assertLock: core.candidate-file-refusal.recipient-of-another-key and the
 * others it names) and what CandidateCipher.decrypt refuses (scanner-key-does-not-open,
 * passphrase-does-not-open, contents-damaged, plaintext-list-too-large); an identity that is no
 * SessionIdentity (core.candidate-encryption.not-session-identity), and one wiped before the
 * plaintext is returned (core.secret-value.wiped, the plaintext overwritten); and, for an
 * identity, a page without WebCrypto (core.candidate-encryption.no-webcrypto), and a failed check
 * (self-test-failed).
 */
export async function decryptCandidates(
  file: Uint8Array,
  key: CandidateFileKey,
): Promise<Uint8Array> {
  // Read once: a host's object may answer differently when it is read again (AUD-015).
  const owned: CandidateFileKey =
    "identity" in key ? { identity: key.identity } : { passphrase: key.passphrase };
  const kind = "identity" in owned ? "key" : "passphrase";
  CandidateFileAdmission.assertLock(file, kind);
  const plain = await withCipherHealth(
    kind,
    () => CandidateCipher.decrypt(file, owned),
    (bytes) => bytes.fill(0),
  );
  // The session may end while the gate rechecks its cipher: its list is then not handed out.
  return "identity" in owned ? bytesWhileLive(plain, () => owned.identity.assertLive()) : plain;
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
  /** The file to write: fresh owned bytes or `list` itself; the caller copies and wipes them. */
  protect(list: Uint8Array): Promise<Uint8Array>;
}

/** A protection created by this module; its owning caller disposes it after all uses settle. */
export interface OwnedListProtection extends ListProtection, Disposable {
  /** Overwrites any retained secret state; public-key/open-list adapters keep no secret. */
  wipe(): void;
}

/** A list encrypted to the Discovery Scanner's one-time X25519 key (age1…). */
export class ScannerKeyProtection implements OwnedListProtection {
  readonly #recipient: string;

  /**
   * Takes the key as typed, pasted or read from a file, and refuses one that is not an age key
   * (core.candidate-encryption.key-one-age-key-62-characters-starts-age1, parseRecipient).
   */
  constructor(key: string) {
    this.#recipient = parseRecipient(key);
  }

  // Getters, not readonly fields, which a caller could overwrite at run time: what the object says
  // of the file must stay what protect does.
  /** Always true: the file is encrypted to the key. */
  get encrypted(): boolean {
    return true;
  }

  /** "encrypted to the Scanner's key", as the line that reports a save says it. */
  get description(): string {
    return "encrypted to the Scanner's key";
  }

  /** The key, age1… in lower case: a public key, which may be shown. */
  get recipient(): string {
    return this.#recipient;
  }

  /**
   * The age file of `list`, borrowed and unchanged, to the key: fresh bytes that the caller wipes.
   * Refuses a list over the size limit (core.candidate-file-refusal.plaintext-list-too-large), a
   * page without WebCrypto (core.candidate-encryption.no-webcrypto) and a cipher whose self-test
   * failed (core.candidate-encryption.self-test-failed).
   */
  protect(list: Uint8Array): Promise<Uint8Array> {
    return encryptCandidates(list, this.#recipient);
  }

  /** This adapter retains only a public recipient key; there is no secret allocation to erase. */
  wipe(): void {}

  /** Ends its owning scope; public metadata needs no erasure. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * A list encrypted under a passphrase through scrypt. A class pays off here: the passphrase is
 * read by the rule of parseListPassphrase, so that a short one cannot be used, and it is kept only
 * here, never shown through toString, toJSON or Node's inspect.
 */
export class PassphraseProtection extends Redacted implements OwnedListProtection {
  readonly #passphrase: SecretValue<string>;

  /**
   * Takes the passphrase as typed or read from a file, refused when it is too short
   * (parseListPassphrase,
   * core.candidate-encryption.use-at-least-characters-passphrase-all-protects-seed).
   */
  constructor(text: string) {
    super("PassphraseProtection");
    this.#passphrase = SecretValue.text(parseListPassphrase(text));
  }

  // Getters, as in ScannerKeyProtection: they cannot be overwritten.
  /** Always true: the file is encrypted under the passphrase. */
  get encrypted(): boolean {
    return true;
  }

  /** "encrypted with the passphrase", as the line that reports a save says it. */
  get description(): string {
    return "encrypted with the passphrase";
  }

  /**
   * The age file of `list`, borrowed and unchanged, under the passphrase through scrypt at work
   * factor 2^SCRYPT_LOG_N: fresh bytes that the caller wipes. Refuses a list over the size limit
   * (core.candidate-file-refusal.plaintext-list-too-large), a cipher whose self-test failed
   * (core.candidate-encryption.self-test-failed), and a call once wiped
   * (core.secret-value.wiped).
   */
  async protect(list: Uint8Array): Promise<Uint8Array> {
    this.#passphrase.assertLive();
    const bytes = await withCipherHealth(
      "passphrase",
      () => CandidateCipher.encryptWithPassphrase(list, this.#passphrase.value),
      (held) => held.fill(0),
    );
    return bytesWhileLive(bytes, () => this.#passphrase.assertLive());
  }

  /** Erases retained passphrase bytes after all protect calls have settled. */
  wipe(): void {
    this.#passphrase.wipe();
  }

  /** Ends the owning scope's passphrase lifetime. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** A list written without encryption, only on the person's explicit request. */
export class NoProtection implements OwnedListProtection {
  // Getters, as in ScannerKeyProtection: a list in the open must never be reported as encrypted.
  /** Always false: the file holds the seed phrases in the open. */
  get encrypted(): boolean {
    return false;
  }

  /** "NOT encrypted", in capitals, as the line that reports a save says it. */
  get description(): string {
    return "NOT encrypted";
  }

  /**
   * The list itself, the same bytes. Refuses a list over the size limit
   * (core.candidate-file-refusal.plaintext-list-too-large).
   */
  protect(list: Uint8Array): Promise<Uint8Array> {
    CandidateFileAdmission.assertSize(list.byteLength, "plaintext");
    return Promise.resolve(list);
  }

  /** This stateless adapter retains no secret; its caller wipes each returned list. */
  wipe(): void {}

  /** Ends its owning scope; list bytes belong to each protect caller. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The fields of each kind of ListProtectionChoice besides its kind, each a string. */
const CHOICE_FIELDS = Object.freeze({
  key: ["recipient"],
  passphrase: ["passphrase"],
  none: [],
} as const) satisfies Readonly<Record<ListProtectionChoice["kind"], readonly string[]>>;

/** Each kind of choice as a host writes it, such as `{ kind: "key", recipient }`. */
const CHOICE_SHAPES = Object.entries(CHOICE_FIELDS).map(
  ([kind, fields]) => `{ kind: "${kind}"${fields.map((field) => `, ${field}`).join("")} }`,
);

/** The choices, as the refusal of anything else names them; it repeats nothing given. */
const PROTECTION_CHOICES = listInWords(CHOICE_SHAPES, "or");

/**
 * `choice` as ListProtectionChoice, or a TypeError: a JavaScript or parsed host may pass a kind
 * that is misspelt, missing or inherited, or fields of another kind, and none of these may fall
 * through to a list in the open (AUD-014-SEC001). Only an own kind of CHOICE_FIELDS is taken, with
 * exactly its own fields, each a string. The choice is copied once and the copy is checked and
 * returned: a host's object may answer differently when it is read again (AUD-015).
 */
function checkedChoice(given: unknown): ListProtectionChoice {
  if (typeof given !== "object" || given === null)
    throw ERRORS.create("not-protection-choice", [PROTECTION_CHOICES]);
  const choice: Readonly<Record<string, unknown>> = { ...given };
  const kind = Object.hasOwn(choice, "kind") ? choice["kind"] : undefined;
  // Only an own kind of CHOICE_FIELDS: neither another value nor an inherited name such as
  // "toString" is found among its entries.
  const wanted: readonly string[] | undefined = Object.entries(CHOICE_FIELDS).find(
    ([name]) => name === kind,
  )?.[1];
  if (wanted === undefined) throw ERRORS.create("not-protection-choice", [PROTECTION_CHOICES]);
  // Own enumerable names, as many as the kind has and each one of them: no field is missing, and
  // none of another kind, such as a passphrase beside "none", comes along unread.
  const names = Object.keys(choice);
  if (
    names.length !== wanted.length + 1 ||
    !names.every((name) => name === "kind" || wanted.includes(name)) ||
    !wanted.every((name) => typeof choice[name] === "string")
  )
    throw ERRORS.create("not-protection-choice", [PROTECTION_CHOICES]);
  // The checks above proved the shape: an own kind of CHOICE_FIELDS with exactly its fields, each
  // a string.
  return choice as ListProtectionChoice;
}

/**
 * The protection that a host's `choice` names (ListProtectionChoice); a list in the open only for
 * an explicit `{ kind: "none" }`. Anything else that is not one of the three is refused as a
 * TypeError (core.candidate-encryption.not-protection-choice), and so is what the protection's
 * constructor refuses: a key that is no age key (key-one-age-key-62-characters-starts-age1) or a
 * passphrase too short (use-at-least-characters-passphrase-all-protects-seed).
 */
export function protectionFor(choice: ListProtectionChoice): OwnedListProtection {
  const checked = checkedChoice(choice);
  switch (checked.kind) {
    case "key":
      return new ScannerKeyProtection(checked.recipient);
    case "passphrase":
      return new PassphraseProtection(checked.passphrase);
    case "none":
      return new NoProtection();
  }
}
