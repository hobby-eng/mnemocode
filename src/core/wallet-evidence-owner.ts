// The retained comparison made by WalletEvidenceCheck.prepare. Its service is borrowed; its
// parsed evidence and passphrase have their own ending lifetime, including asynchronous use. It
// knows nothing of the evidence: what a comparison answers is the type it is made with, the
// EvidenceMatch of wallet-evidence.ts, which imports this module and is not imported back.
import type { HDKey, Versions } from "@scure/bip32";
import { Bip39Seed } from "./master-fingerprint.js";
import { SecretValue } from "./secret-value.js";
import { Redacted } from "./redacted.js";
import { defined } from "./defined.js";

/** Prepared evidence, compared with a root key: its answer is a `Match`. */
interface Comparison<Match> {
  compare(root: HDKey): Match;
  wipe(): void;
}

/**
 * A prepared local wallet comparison. WalletEvidenceCheck.prepare validates and transfers its
 * parsed evidence here. The service is borrowed; this owner retains independent passphrase
 * bytes and disposes the evidence, including a WIF key. Results are caller-owned plain views.
 * Every comparison after disposal, including a late asynchronous result, is refused with
 * core.secret-value.wiped. Earlier strings and runtime copies cannot be recalled or erased.
 */
export class PreparedWalletEvidence<Match> extends Redacted implements Disposable {
  readonly #seed: Bip39Seed;
  readonly #passphrase: SecretValue<readonly string[]>;
  readonly #versions: Versions;
  #expected: Comparison<Match> | undefined;

  /** Takes validated evidence from its factory; closes that evidence if construction fails. */
  constructor(
    seed: Bip39Seed,
    expected: Comparison<Match>,
    versions: Versions,
    passphrase: string,
  ) {
    super("PreparedWalletEvidence");
    try {
      Bip39Seed.assertPassphraseType(passphrase);
      this.#versions = Object.freeze({ public: versions.public, private: versions.private });
      this.#passphrase = SecretValue.utf16Texts([passphrase]);
    } catch (error) {
      expected.wipe();
      throw error;
    }
    this.#seed = seed;
    this.#expected = expected;
  }

  /** Compares one phrase using a host PBKDF2 that answers synchronously; no keys are retained. */
  match(mnemonic: string): Match {
    const result = this.#seed.withRoot(...this.#rootInput(mnemonic));
    this.#passphrase.assertLive();
    return result;
  }

  /** The same comparison with a host PBKDF2 that may settle later; keep this owner live. */
  async matchAsync(mnemonic: string): Promise<Match> {
    const result = await this.#seed.withRootLater(...this.#rootInput(mnemonic));
    this.#passphrase.assertLive();
    return result;
  }

  #live(): Comparison<Match> {
    this.#passphrase.assertLive();
    return defined(this.#expected);
  }

  #rootInput(mnemonic: string) {
    return [
      mnemonic,
      defined(this.#passphrase.value[0]),
      (root: HDKey) => this.#live().compare(root),
      this.#versions,
    ] as const;
  }

  /** Ends this comparison without disposing its service or caller-owned input/results. */
  wipe(): void {
    this.#passphrase.wipe();
    const expected = this.#expected;
    this.#expected = undefined;
    expected?.wipe();
  }

  /** Ends the containing using scope after all asynchronous comparisons have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
