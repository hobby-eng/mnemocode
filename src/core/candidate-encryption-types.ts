/** A session-only age X25519 identity and the recipient that a writer may be given. */
export interface SessionIdentity {
  /** Private AGE-SECRET-KEY-1 text; its host keeps it only for the current session. */
  readonly identity: string;
  /** Public age1 recipient text, 62 characters. */
  readonly recipient: string;
}

/** The private identity or passphrase used to open a candidate file. */
export type CandidateFileKey = { readonly identity: string } | { readonly passphrase: string };

/** Ungated cipher operations used only by their feature's public-fixture known-answer verifier. */
export interface CandidateCipherOperations {
  /** Creates one synthetic session identity for the verifier. */
  readonly createSessionIdentity: () => Promise<SessionIdentity>;
  /** Encrypts the verifier's public fixture. */
  readonly encryptCandidates: (plain: Uint8Array, recipient: string) => Promise<Uint8Array>;
  /** Opens or refuses the verifier's public fixtures. */
  readonly decryptCandidates: (file: Uint8Array, key: CandidateFileKey) => Promise<Uint8Array>;
}
