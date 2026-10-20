// The invented details of one export: the person on its cards (card-identities.ts) and the texts of
// its design (card-copy.ts), each given or chosen at random. They are settled once, where an export
// starts (renderCards, renderIndividualCards, ShareCardSet, exportColorPalette and the command
// line's card options), and every page, output format and share of the export prints them; a
// design asked to draw them settles them again from what it is given, which changes none.
//
// Needs from the host: a uniform random choice, passed as `choose`, such as the randomInt of its
// render platform (export/platform.ts, a CardRenderer's).
// Does not: draw cards, or remember details from one export to the next (card-session.ts does,
// for a host that asks for that). The details are independent of every seed phrase and share.

import {
  checkedCardPresentation,
  resolveCardPresentation,
  type CardCopyOverrides,
} from "./card-copy.js";
import { createCardIdentity, sectorForStyle } from "./card-identities.js";
import type { UniformChoice } from "./platform.js";
import type { CardPresentation, CardProfile, CardSettings } from "./card-settings.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.export-details", {
  "snapshot-keys": { kind: "type", text: () => "Card export settings must be objects." },
});

/**
 * The person and the texts that the cards of one export print. A class, so that both are settled
 * once and kept as they were: frozen copies, the same object for the same settings.
 *
 * The person is settled again from the profile that the settings carry, also when it is complete
 * (createCardIdentity): that checks it, and makes the random choices it always made, so that a
 * platform with a fixed seed gives the same cards as before (scan finding S111).
 */
export class ExportDetails {
  /** The details settled for an object of settings or of options, which an export lives with. */
  static readonly #settled = new WeakMap<object, ExportDetails>();

  /** Frozen complete card identity shared by every page and output of this export. */
  readonly profile: Required<CardProfile>;
  /** Frozen presentation texts shared by every page and output of this export. */
  readonly presentation: CardPresentation;

  private constructor(profile: Required<CardProfile>, presentation: CardPresentation) {
    // Copies, so that no caller changes what the pages that follow print.
    this.profile = Object.freeze({ ...profile });
    this.presentation = Object.freeze({ ...presentation });
    Object.freeze(this);
  }

  /**
   * Reuses already settled public details for an options snapshot of the same export. Chooses
   * nothing when the original has no details yet, and keeps an already settled snapshot. The
   * original key is borrowed only during this call; invalid keys fail with
   * export.export-details.snapshot-keys. No phrase or share is retained here.
   */
  static reuseForSnapshot(original: object, snapshot: object): void {
    if (
      [original, snapshot].some(
        (key) => key === null || (typeof key !== "object" && typeof key !== "function"),
      )
    )
      throw ERRORS.create("snapshot-keys", []);
    if (ExportDetails.#settled.has(snapshot)) return;
    const details = ExportDetails.#settled.get(original);
    if (details !== undefined) ExportDetails.#settled.set(snapshot, details);
  }

  /**
   * The details of the export that `settings` describe: its texts and the person's details that it
   * gives, the rest chosen with `choose`, once for this object of settings. `style` is that of the
   * export's first design, whose employer suits it (sectorForStyle); without one the employer is of
   * any sector. Asked again for the same settings, whatever the style, it gives the same details:
   * one export prints one person. The texts are chosen before the person, as `drawn` does.
   * Refuses what `drawn` refuses, for the texts and the person's details of `settings`.
   */
  static of(choose: UniformChoice, settings: CardSettings, style?: string): ExportDetails {
    return ExportDetails.#settledFrom(choose, settings, style, false);
  }

  /**
   * As `of`, with the person chosen before the texts: the order in which the business designs
   * choose them when they are drawn directly, not through an export, kept so that a fixed
   * seed gives the same cards there too. Through an export they receive settled texts and choose
   * none, so the order matters only there; making it that of `of` is the owner's decision.
   */
  static ofPersonFirst(
    choose: UniformChoice,
    settings: CardSettings,
    style?: string,
  ): ExportDetails {
    return ExportDetails.#settledFrom(choose, settings, style, true);
  }

  /**
   * The details of `key`, an object that lives as long as one export, such as the options of one
   * command: drawn (as `drawn` does) once for it, so that every output of the command shows them.
   */
  static drawnFor(
    choose: UniformChoice,
    key: object,
    supplied: CardProfile,
    copy: CardCopyOverrides,
    style?: string,
  ): ExportDetails {
    return ExportDetails.#once(key, () => ExportDetails.drawn(choose, supplied, copy, style));
  }

  /**
   * New details: the person's details `supplied` and the texts `copy`, each given in place of the
   * one chosen at random (a "-" in `copy` hides its line), and the rest chosen with `choose`. The
   * employer suits `style` as in `of`. Refuses a text or a detail that is no text on one line
   * (export.card-settings.card-non-empty-text-on-one-line) or is longer than MAX_CARD_TEXT_LENGTH
   * (export.card-settings.card-too-long-maximum-characters), a name not in Latin letters
   * (export.card-settings.card-name-use-latin-letters-only-spaces-apostrophes), and a choice of
   * `choose` that is no whole number below its limit (export.platform.checked-choice-refused).
   */
  static drawn(
    choose: UniformChoice,
    supplied: CardProfile = {},
    copy: CardCopyOverrides = {},
    style?: string,
  ): ExportDetails {
    // The texts first, then the person: the order of the random choices, which every export keeps.
    const presentation = resolveCardPresentation(choose, copy);
    return new ExportDetails(ExportDetails.#person(choose, supplied, style), presentation);
  }

  /**
   * The details of `settings`, settled once for them (`#once`). `personFirst` gives the order of
   * the random choices: the person before the texts (`ofPersonFirst`) or after them (`of`).
   */
  static #settledFrom(
    choose: UniformChoice,
    settings: CardSettings,
    style: string | undefined,
    personFirst: boolean,
  ): ExportDetails {
    return ExportDetails.#once(settings, () => {
      // Both orders evaluate the same two rules; only which one runs first differs.
      const texts = (): CardPresentation =>
        checkedCardPresentation(settings.presentation) ?? resolveCardPresentation(choose);
      const person = (): Required<CardProfile> =>
        ExportDetails.#person(choose, settings.profile, style);
      if (personFirst) {
        const profile = person();
        return new ExportDetails(profile, texts());
      }
      const presentation = texts();
      return new ExportDetails(person(), presentation);
    });
  }

  /** The person: `supplied` completed with `choose`, with an employer that suits `style`. */
  static #person(
    choose: UniformChoice,
    supplied: CardProfile | undefined,
    style: string | undefined,
  ): Required<CardProfile> {
    return createCardIdentity(choose, supplied, sectorForStyle(style));
  }

  static #once(key: object, settle: () => ExportDetails): ExportDetails {
    let details = ExportDetails.#settled.get(key);
    if (details === undefined) {
      details = settle();
      ExportDetails.#settled.set(key, details);
    }
    return details;
  }
}
