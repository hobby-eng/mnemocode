// The retained codes of a card plan. Settings and public share references stay with the plan;
// decoded code views belong to the caller and cannot be recalled after they have been returned.
import { SecretValue } from "../core/secret-value.js";
import { Redacted } from "../core/redacted.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import type { ColorCardContent } from "./card-content.js";

const ERRORS = new ErrorCatalog("export.card-values", {
  shape: { kind: "type", text: () => "Card values need arrays of colors and optional labels." },
});

/** The code-bearing fields of a card, independently of its design and public settings. */
export type CardValueView = Pick<ColorCardContent, "colors" | "labels" | "payload">;

/** Byte-owned card codes, labels and QR payload, with lossless UTF-16 views and an ending scope. */
export class CardValues extends Redacted implements Disposable {
  readonly #texts: SecretValue<readonly string[]>;
  readonly #colors: number;
  readonly #labels: number | undefined;

  constructor(values: CardValueView) {
    super("CardValues");
    if (values === null || typeof values !== "object" || Array.isArray(values))
      throw ERRORS.create("shape", []);
    const { colors, labels, payload } = values;
    if (!Array.isArray(colors) || (labels !== undefined && !Array.isArray(labels)))
      throw ERRORS.create("shape", []);
    const colorCopy = Array.from<string>(colors);
    const labelCopy = labels === undefined ? undefined : Array.from<string>(labels);
    this.#colors = colorCopy.length;
    this.#labels = labelCopy?.length;
    this.#texts = SecretValue.utf16Texts([...colorCopy, ...(labelCopy ?? []), payload]);
  }

  /** Fresh independent views; refuses with core.secret-value.wiped after disposal. */
  get view(): CardValueView {
    const texts = this.#texts.value;
    const colors = Object.freeze(texts.slice(0, this.#colors));
    const labels =
      this.#labels === undefined
        ? undefined
        : Object.freeze(texts.slice(this.#colors, this.#colors + this.#labels));
    return Object.freeze({
      colors,
      ...(labels === undefined ? {} : { labels }),
      payload: defined(texts.at(-1)),
    });
  }

  /** Independent byte storage; ending either owner leaves the other live. */
  copy(): CardValues {
    return new CardValues(this.view);
  }

  /** Refuses new work or late publication after the containing plan was disposed. */
  assertLive(): void {
    this.#texts.assertLive();
  }

  /** Transfers fresh rendered bytes only while live; a late owned result is wiped and refused. */
  checkedBytes(bytes: Uint8Array): Uint8Array {
    try {
      this.assertLive();
      return bytes;
    } catch (error) {
      bytes.fill(0);
      throw error;
    }
  }

  /** Overwrites retained code units as far as the runtime permits; repeat calls are harmless. */
  wipe(): void {
    this.#texts.wipe();
  }

  /** Ends this card value owner's lifetime after its awaited uses have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The codes of a card as its content carries them: without labels where it has none. */
type ContentCodes = Omit<CardValueView, "labels"> & { readonly labels?: readonly string[] };

/**
 * Card content whose codes are owned (CardValues): its settings as they are, and its colours,
 * labels and payload in owned text, put back together on request. The one place that takes a
 * card's content apart and builds it again, for the cards of a backup and of each share
 * (AUD-037-ARC002).
 */
export class OwnedCardContent<Content extends CardValueView> implements Disposable {
  /** The owned codes, which a renderer checks its late results against. */
  readonly values: CardValues;
  readonly #settings: Omit<Content, keyof CardValueView>;

  constructor(content: Content) {
    const { colors, labels, payload, ...settings } = content;
    this.#settings = settings;
    this.values = new CardValues({ colors, labels, payload });
  }

  /** The settings of the content, its public part, which hold no code. */
  get settings(): Omit<Content, keyof CardValueView> {
    return this.#settings;
  }

  /** The content again, with fresh views of its codes; refused once its codes are wiped. */
  get content(): Omit<Content, keyof CardValueView> & ContentCodes {
    const { colors, labels, payload } = this.values.view;
    return { ...this.#settings, colors, payload, ...(labels === undefined ? {} : { labels }) };
  }

  /** Wipes the owned codes; the settings hold nothing secret. */
  wipe(): void {
    this.values.wipe();
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}
