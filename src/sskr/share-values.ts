// Retained repaired shares: their UR and filled-in text are secret; form, positions and repair
// flags describe their layout. Decoded views are independent temporary copies for a caller.
import { SecretValue } from "../core/secret-value.js";
import { Redacted } from "../core/redacted.js";
import { defined } from "../core/defined.js";
import type { ReadRepairableShare } from "./repair-types.js";
import { assertShareFormat, type ShareFormat } from "./transport.js";
import { inWholeRange, wholeNumbersFrom } from "../core/typed-number.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("sskr.share-values", {
  shape: {
    kind: "type",
    text: () => "Repaired shares need a form, a repair flag and valid element positions.",
  },
});

interface ShareLayout {
  readonly format: ShareFormat;
  readonly repaired: boolean;
  readonly positions: readonly number[];
}

/**
 * An independent byte snapshot of already-read shares, including the values a repair filled in.
 * It does not read or repair transports. Its caller supplies shares checked by those readers,
 * disposes the owner when done, and owns any earlier immutable views it requested.
 */
export class ShareValues extends Redacted implements Disposable {
  readonly #layout: readonly ShareLayout[];
  readonly #texts: SecretValue<readonly string[]>;

  /**
   * Copies the texts of `shares`, which stay the caller's. Throws sskr.transport.share-format-one
   * for an unknown form and sskr.share-values.shape (a TypeError) for any other wrong shape, such
   * as a position that is not a whole number from 1.
   */
  constructor(shares: readonly ReadRepairableShare[]) {
    super("ShareValues");
    if (!Array.isArray(shares)) throw ERRORS.create("shape", []);
    const admitted: readonly unknown[] = shares;
    const texts: string[] = [];
    this.#layout = Object.freeze(
      Array.from(admitted, (share) => {
        if (typeof share !== "object" || share === null) throw ERRORS.create("shape", []);
        const ur: unknown = Reflect.get(share, "ur");
        const format: unknown = Reflect.get(share, "format");
        const repaired: unknown = Reflect.get(share, "repaired");
        const filled: unknown = Reflect.get(share, "filled");
        assertShareFormat(format);
        if (typeof ur !== "string" || typeof repaired !== "boolean" || !Array.isArray(filled))
          throw ERRORS.create("shape", []);
        texts.push(ur);
        const elements: readonly unknown[] = filled;
        const positions = Array.from(elements, (element) => {
          if (typeof element !== "object" || element === null) throw ERRORS.create("shape", []);
          const position: unknown = Reflect.get(element, "position");
          const value: unknown = Reflect.get(element, "value");
          if (!inWholeRange(position, wholeNumbersFrom(1)) || typeof value !== "string")
            throw ERRORS.create("shape", []);
          texts.push(value);
          return position;
        });
        return Object.freeze({ format, repaired, positions: Object.freeze(positions) });
      }),
    );
    // Preserve caller-supplied code units as well as ordinary transport text; no normalization.
    this.#texts = SecretValue.utf16Texts(texts);
  }

  /** Fresh frozen views; a later disposal cannot recall strings already given to a caller. */
  get shares(): readonly ReadRepairableShare[] {
    const texts = this.#texts.value;
    let next = 0;
    return Object.freeze(
      this.#layout.map(({ format, repaired, positions }) => {
        const ur = defined(texts[next++]);
        const filled = positions.map((position) =>
          Object.freeze({ position, value: defined(texts[next++]) }),
        );
        return Object.freeze({ ur, format, repaired, filled: Object.freeze(filled) });
      }),
    );
  }

  /** Overwrites retained text buffers as far as the JavaScript runtime permits; idempotent. */
  wipe(): void {
    this.#texts.wipe();
  }

  /** Ends the containing owner's scope after its uses have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
