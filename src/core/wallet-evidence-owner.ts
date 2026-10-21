// The retained comparison made by WalletEvidenceCheck.prepare. It borrows that check's seed rule;
// its passphrase, and the parsed evidence, which is public material only, have their own ending
// lifetime, including asynchronous use. It knows nothing of the evidence: what a comparison
// answers is the type it is made with, the EvidenceMatch of wallet-evidence.ts, which imports this
// module and is not imported back.
import type { HDKey, Versions } from "@scure/bip32";
import { Bip39Seed } from "./master-fingerprint.js";
import { SecretValue } from "./secret-value.js";
import { Redacted } from "./redacted.js";
import { defined } from "./defined.js";

/** Prepared evidence, public material only, compared with a root key: its answer is a `Match`. */
interface Comparison<Match> {
  compare(root: HDKey): Match;
}

/**
 * A prepared local wallet comparison. WalletEvidenceCheck.prepare validates and transfers its
 * parsed evidence here, which holds public material only: a WIF is kept as its public key. The seed
 * rule of that check is borrowed; this owner retains independent passphrase bytes and drops the
 * evidence when it is wiped. Results are caller-owned plain views.
 * Every comparison after disposal, including a late asynchronous result, is refused with
 * core.secret-value.wiped. Earlier strings and runtime copies cannot be recalled or erased.
 */
export class PreparedWalletEvidence<Match> extends Redacted implements Disposable {
  readonly #seed: Bip39Seed;
  readonly #passphrase: SecretValue<readonly string[]>;
  readonly #versions: Versions;
  #expected: Comparison<Match> | undefined;

  /**
   * Takes validated evidence from its factory. Refuses a passphrase that is not text
   * (core.master-fingerprint.expected-string-passphrase).
   */
  constructor(
    seed: Bip39Seed,
    expected: Comparison<Match>,
    versions: Versions,
    passphrase: string,
  ) {
    super("PreparedWalletEvidence");
    Bip39Seed.assertPassphraseType(passphrase);
    this.#versions = Object.freeze({ public: versions.public, private: versions.private });
    this.#passphrase = SecretValue.utf16Texts([passphrase]);
    this.#seed = seed;
    this.#expected = expected;
  }

  /**
   * Compares one phrase using a host PBKDF2 that answers synchronously; no keys are retained.
   * Refuses the phrase and the host's answer as Bip39Seed.now refuses them
   * (core.master-fingerprint.invalid-mnemonic and the others it names), and a comparison once
   * wiped (core.secret-value.wiped).
   */
  match(mnemonic: string): Match {
    const result = this.#seed.withRoot(...this.#rootInput(mnemonic));
    this.#passphrase.assertLive();
    return result;
  }

  /**
   * The same comparison with a host PBKDF2 that may settle later; keep this owner live. Refuses
   * what Bip39Seed.later refuses (core.master-fingerprint.invalid-mnemonic and the others it
   * names), and a comparison once wiped, also one that settles after the wipe
   * (core.secret-value.wiped).
   */
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

  /** Ends this comparison; the check that made it and caller-owned input/results stay intact. */
  wipe(): void {
    this.#passphrase.wipe();
    this.#expected = undefined;
  }

  /** Ends the containing using scope after all asynchronous comparisons have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
