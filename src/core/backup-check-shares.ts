// The share values used by a written-backup check. They own only the data needed for their
// comparisons, independently of borrowed input arrays, a ShareSet and one another.
import { ShareInput, type SetTrouble, type TypedShare } from "../sskr/share-input.js";
import type { ShareSet, PlacedShare } from "../sskr/share-set.js";
import { readShare } from "../sskr/transport.js";
import { isMarked } from "../sskr/repair-units.js";
import { defined } from "./defined.js";
import { EncodedBackup } from "./encoded-backup.js";
import type { MaskedMode } from "./masking.js";
import { Redacted } from "./redacted.js";
import { SecretValue } from "./secret-value.js";
import type { DateShiftDate } from "./types.js";

/** The shares of `typed` without ?, each read, with its place. */
function completeOf(typed: readonly TypedShare[]): PlacedShare[] {
  return typed
    .filter((share) => !isMarked(share.text))
    .map((share) => ({ place: share.place, ur: readShare(share.text).ur }));
}

/**
 * Independently owned shares typed again, each once, with their original places and copy notes.
 * Secret text views are temporary copies. Hosts wipe this owner after the awaited restore ends.
 */
export class KeptShares extends Redacted implements Disposable {
  readonly #texts: SecretValue<readonly string[]>;
  readonly #places: readonly number[];
  readonly #notes: readonly string[];

  private constructor(kept: readonly TypedShare[], notes: readonly string[]) {
    super("KeptShares");
    this.#places = Object.freeze(kept.map((share) => share.place));
    this.#notes = Object.freeze([...notes]);
    this.#texts = SecretValue.utf16Texts(kept.map((share) => share.text));
  }

  /**
   * Snapshots `texts` in their order, dropping exact copies by ShareInput's rule. Complete shares
   * must read; the host first obtains unreadable-share findings from ShareBackupCheck. A complete
   * share that does not read is refused as readShare refuses it.
   */
  static of(texts: readonly string[]): KeptShares {
    const typed: TypedShare[] = texts.map((text, index) => ({ place: index + 1, text }));
    const complete = completeOf(typed);
    const copies = ShareInput.copiesOf(complete);
    const copied = new Set(copies.map((copy) => copy.place));
    return new KeptShares(
      typed.filter((share) => !copied.has(share.place)),
      copies.map((copy) => copy.message),
    );
  }

  /** A fresh view of the shares kept, as typed; refused after this owner is wiped. */
  get texts(): readonly string[] {
    return this.#texts.value;
  }

  /** The places of the shares kept, among those typed. */
  get places(): readonly number[] {
    return this.#places;
  }

  /** One line for each copy left out. */
  get notes(): readonly string[] {
    return this.#notes;
  }

  /**
   * Why complete shares do not belong together, or are too few where no marked share can complete
   * them, with the code of its condition (SetTrouble); undefined when neither. Refused after
   * disposal; every comparison uses fresh views of this owner's shares.
   */
  get setProblem(): SetTrouble | undefined {
    const typed = this.texts.map((text, index) => ({ place: defined(this.#places[index]), text }));
    const complete = completeOf(typed);
    return ShareInput.completeSetProblem(complete, complete.length < typed.length);
  }

  /** Overwrites retained share buffers; earlier text views remain the caller's responsibility. */
  wipe(): void {
    this.#texts.wipe();
  }

  /** Ends the owning scope after all uses of these shares have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * The phrase restored from shares and the places left unchecked. This owner snapshots only the
 * phrase and placement metadata, keeping neither the borrowed ShareSet nor its share graph.
 */
export class RestoredShares extends Redacted implements Disposable {
  readonly #mnemonic: SecretValue<string>;
  readonly #unchecked: readonly number[];

  private constructor(mnemonic: string, unchecked: readonly number[]) {
    super("RestoredShares");
    this.#unchecked = Object.freeze([...unchecked]);
    this.#mnemonic = SecretValue.text(mnemonic);
  }

  /**
   * Snapshots the phrase of borrowed `set` and maps unchecked shares through borrowed `kept`.
   * Neither input is consumed or disposed; the result has an independent lifetime.
   */
  static of(set: ShareSet, kept: KeptShares): RestoredShares {
    const places = kept.places;
    const shares = [...set.unchecked, ...set.unsettled.map((element) => element.share)];
    const unchecked = [...new Set(shares.map((share) => defined(places[share - 1])))];
    unchecked.sort((a, b) => a - b);
    return new RestoredShares(set.mnemonic, unchecked);
  }

  /** Whether the shares hold `phrase`; refused after this owner is wiped. */
  holds(phrase: string): boolean {
    return this.#mnemonic.value === phrase;
  }

  /**
   * Whether undoing `mode` with `dates` gives `mnemonic`; refused after disposal
   * (core.secret-value.wiped). Refuses what EncodedBackup.decode refuses of the mode and the dates
   * (core.encoded-backup.original-seedshift-valid-last-word-gives-several-phrases; what
   * Masking.undo refuses of the dates).
   */
  unmasksTo(mnemonic: string, mode: MaskedMode, dates: readonly DateShiftDate[]): boolean {
    using masked = EncodedBackup.read(this.#mnemonic.value, "english", mode);
    return masked.decode(dates).recoveredMnemonic === mnemonic;
  }

  /** Places of the shares that took no part, or that hold elements nothing settles. */
  get unchecked(): readonly number[] {
    return this.#unchecked;
  }

  /** Overwrites this owner's phrase buffer, leaving borrowed inputs and sibling owners alone. */
  wipe(): void {
    this.#mnemonic.wipe();
  }

  /** Ends the owning scope once comparisons have finished. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
