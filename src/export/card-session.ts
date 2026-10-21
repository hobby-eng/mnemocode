import { resolveCardPresentation, type CardCopyOverrides } from "./card-copy.js";
import { ExportDetails } from "./export-details.js";
import { createCardIdentity, sectorForStyle, type CompanySector } from "./card-identities.js";
import { findTemplate } from "./template-catalog.js";
import {
  validateProfile,
  type CardPresentation,
  type CardProfile,
  type CardSettings,
  COPY_FIELDS,
  type CopyField,
} from "./card-settings.js";
import type { UniformChoice } from "./platform.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.card-session", {
  "card-session-no-name": () => "The card session has no name.",
});

interface Employment {
  readonly company: string;
  readonly role: string;
}

/**
 * The texts given, each over the one remembered. A loop, not a spread: a host may pass a text as
 * undefined, which must not hide the remembered one.
 */
function ownCopy(copy: CardCopyOverrides, remembered: CardPresentation): CardCopyOverrides {
  const merged: Partial<Record<CopyField, string>> = {};
  for (const field of COPY_FIELDS) merged[field] = copy[field] ?? remembered[field];
  return merged;
}

/**
 * Remembers the random choices of one working session.
 *
 * Without a session every export picks a new person, company and studio. A host that
 * lets the user export the same phrase several times, for example first as separate
 * cards and then as an A4 sheet, keeps one session so that every export shows the same
 * details. A new session gives new details, chosen with the host's uniform choice, such as the
 * randomInt of its CardRenderer. Nothing here depends on the mnemonic. Unlike the
 * details of one export (ExportDetails), which keep one employer for all its designs, a session
 * keeps one employer for each sector, so that each design gets one that suits it. A class, so that
 * the name chosen with the first employment and the employer of each sector hold for every export
 * of the session.
 */
export class CardSession {
  readonly #choose: UniformChoice;
  #name: string | undefined;
  #presentation: CardPresentation | undefined;
  // The employer suits the design, so it is remembered for each sector separately.
  readonly #employments = new Map<CompanySector | "any", Employment>();

  /**
   * A session that keeps the invented details of the cards for its exports, chosen with `choose`,
   * so that the outputs of one command show the same person; details given always replace them.
   * It chooses nothing yet: settingsFor refuses what a choice of `choose` refuses.
   */
  constructor(choose: UniformChoice) {
    this.#choose = choose;
  }

  /**
   * Details for one export with the design `template`. Values supplied by the user always replace
   * the remembered ones. Refuses a detail of `supplied` or a text of `copy` that is not text on one
   * line (export.card-settings.card-non-empty-text-on-one-line) or is longer than
   * MAX_CARD_TEXT_LENGTH (export.card-settings.card-too-long-maximum-characters), a name not in
   * Latin letters (export.card-settings.card-name-use-latin-letters-only-spaces-apostrophes), and a
   * choice of the session's uniform choice that is no whole number below its limit
   * (export.platform.checked-choice-refused). A session without a name after its first choices
   * (export.card-session.card-session-no-name) would be a fault of this module.
   */
  settingsFor(
    template: string,
    supplied: CardProfile = {},
    copy: CardCopyOverrides = {},
  ): Required<Pick<CardSettings, "profile" | "presentation">> {
    // A design not installed suits any employer, as a style without a sector does.
    const style = findTemplate(template)?.style;
    const sector = sectorForStyle(style);
    const key = sector ?? "any";
    let employment = this.#employments.get(key);
    if (employment === undefined) {
      const chosen = createCardIdentity(this.#choose, {}, sector);
      this.#name ??= chosen.name;
      employment = { company: chosen.company, role: chosen.role };
      this.#employments.set(key, employment);
    }
    this.#presentation ??= resolveCardPresentation(this.#choose);
    const own = validateProfile(supplied);
    // The name was chosen together with the first employment.
    if (this.#name === undefined) throw ERRORS.create("card-session-no-name", []);
    // Email and website follow the company that is finally printed.
    const details = ExportDetails.drawn(
      this.#choose,
      { name: this.#name, ...employment, ...own },
      ownCopy(copy, this.#presentation),
      style,
    );
    return { profile: details.profile, presentation: details.presentation };
  }
}
