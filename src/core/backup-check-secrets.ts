// The two backup checks share only the ownership of their reference phrase and complete dates.
// Decoded values are transient views; the retained representation consists of mutable bytes.
import { ownedDates } from "./dates.js";
import { defined } from "./defined.js";
import { SecretValue } from "./secret-value.js";
import type { DateShiftDate } from "./types.js";
import type { MaskingMode } from "./types.js";
import { Masking } from "./masking.js";
import { englishTokens } from "./english-words.js";

/** Internal reference material; snapshots inputs and refuses access after its owner wipes it. */
export class BackupCheckSecrets<Mode extends MaskingMode> implements Disposable {
  readonly #mnemonic: SecretValue<string>;
  readonly #dates: SecretValue<readonly (readonly number[])[]>;
  readonly #hasDates: boolean;
  readonly #mode: Mode;
  readonly #wordCount: number;

  /**
   * Snapshots `mnemonic` and `dates` (undefined: the reference has none) as wipeable bytes;
   * `wordCount` is the number of the reference's codes, its phrase's words when undefined. Refuses
   * a mode that names none (core.masking.unsupported-mode), a date that the calendar does not have
   * (core.dates codes) and a phrase that is not text (core.secret-value.text).
   */
  constructor(
    mnemonic: string,
    dates: readonly DateShiftDate[] | undefined,
    mode: Mode,
    wordCount?: number,
  ) {
    Masking.of(mode);
    const snapshot = dates === undefined ? undefined : ownedDates(dates);
    const phrase = SecretValue.text(mnemonic);
    try {
      this.#dates = SecretValue.numberLists(
        (snapshot ?? []).map(({ year, month, day }) => [year, month, day]),
      );
      this.#mnemonic = phrase;
      this.#hasDates = snapshot !== undefined;
      this.#mode = mode;
      this.#wordCount = wordCount ?? englishTokens(phrase.value).length;
    } catch (error) {
      phrase.wipe();
      throw error;
    }
  }

  /** The checked mode of the original reference, shared by every comparison. */
  get mode(): Mode {
    return this.#mode;
  }

  /** Whether checking this reference asks for dates. */
  get dated(): boolean {
    return Masking.of(this.#mode).masked;
  }

  /** Words of the reference's codes or phrase, available as metadata after disposal. */
  get wordCount(): number {
    return this.#wordCount;
  }

  /** A transient phrase view for comparison; no immutable phrase is retained. */
  get mnemonic(): string {
    return this.#mnemonic.value;
  }

  /** Complete date views; undefined preserves the distinction between unknown and no dates. */
  get dates(): readonly DateShiftDate[] | undefined {
    this.assertLive();
    if (!this.#hasDates) return undefined;
    return this.#dates.value.map((parts) => ({
      year: defined(parts[0]),
      month: defined(parts[1]),
      day: defined(parts[2]),
    }));
  }

  /** Refuses a comparison or publication after disposal, including after an awaited restore. */
  assertLive(): void {
    this.#mnemonic.assertLive();
  }

  /** Overwrites reference buffers as far as the runtime permits; repeat calls are harmless. */
  wipe(): void {
    this.#mnemonic.wipe();
    this.#dates.wipe();
  }

  /** Ends the containing check's reference-material lifetime. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
