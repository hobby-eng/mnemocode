// The wallet check that a search takes from its host: whether one checksum-valid phrase is the
// wallet that the person named, by a fingerprint, an address or a key. The date search, the word
// search and the restore of masked shares take it in this shape; the command line passes its
// Bitcoin evidence check (bitcoin-evidence.ts), a page its own derivation, which may answer later.
// Types only: it needs nothing and does nothing.

/** What the host's wallet check says of one phrase. */
export interface WalletMatch {
  readonly matched: boolean;
  /** Where the wallet matched, such as m or m/84'/0'/0'/0/0. */
  readonly path?: string | undefined;
  /** What the person should know of a match, such as that a fingerprint is only a filter. */
  readonly warning?: string | undefined;
}

/**
 * Compares a checksum-valid phrase with the wallet; it may answer at once or later, as a page's
 * WebCrypto derivation does.
 */
export type WalletCheck = (mnemonic: string) => WalletMatch | PromiseLike<WalletMatch>;
