// Sample cards: every card design drawn with a sample phrase, so that a person can see the designs
// before writing a real backup. The phrase is new for each preview, its entropy drawn with the
// host's randomness, each byte checked as every random choice of the cards is (checkedChoice), so
// that its colours vary as a real backup's do, and it is masked with four fixed public dates. A
// host whose randomness always answers 0, as a test's may, gets the public phrase of all-zero
// entropy ("abandon … about" for 12 words).
//
// From the host it needs its CardRenderer (card-renderer.ts), which the cards are drawn with. It
// returns PDF bytes and writes no file. A host also draws the colour cards of a save in memory
// with the longest sample phrase, before it asks for a secret (assertColorsPrint).
//
// Host-neutral: it imports only other export and core modules, @scure/bip39 and pdf-lib through the
// renderers.

import {
  BIP39_WORD_COUNTS,
  type Bip39WordCount,
  isBip39WordCount,
  LONGEST_WORD_COUNT,
  WORD_COUNTS_TEXT,
} from "../core/bip39-sizes.js";
import { parseDate } from "../core/dates.js";
import { phraseOfRandomEntropy } from "../core/english-words.js";
import { EncodedForm } from "../core/encoded-form.js";
import { formatEncoded } from "../core/representations.js";
import { encodeMnemonic } from "../core/seedshift.js";
import type { EncodedFormat, EncodedResult } from "../core/types.js";
import { backupCardContent, type CardBackup, type CardContent } from "./backup-cards.js";
import type { CardSettings } from "./card-settings.js";
import { checkedChoice } from "./platform.js";
import { renderCards, renderIndividualCards, type CardJob, type CardOutputs } from "./render.js";
import {
  CARD_TEMPLATES,
  selectTemplate,
  type CardDrawing,
  type CardTemplate,
} from "./templates.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.card-preview", {
  "preview-mnemonic-contain-words": (value0: string) =>
    `The preview mnemonic must contain ${value0} words.`,
  "colour-cards-not-written-as": (value0: string) => `Colour cards are not written as ${value0}.`,
  "one-design-separate-cards": () => ONE_DESIGN_FOR_SEPARATE_CARDS,
});

/** The lengths of a sample phrase, as BIP39 has them. */
export const SAMPLE_WORD_COUNTS = BIP39_WORD_COUNTS;
/** The name of a file of sample cards, before what each front end adds: "-01", ".pdf" … */
export const SAMPLE_FILE_BASE = "mnemocode-preview";

/** The designs of a preview: every installed one, or the one named, or the first without a name. */
export type DesignSelection =
  | {
      /** Every installed design, in the order of the list. */
      readonly every: true;
    }
  | {
      /** One design: the one named, or the first. */
      readonly every?: false;
      /** The design by its id or its number in the list, from 1; the first when undefined. */
      readonly template?: string | undefined;
    };

/** Why separate sample cards of every design are refused: their folder shows one design. */
export const ONE_DESIGN_FOR_SEPARATE_CARDS =
  "Separate sample cards show one design: choose one design.";
/** The length of the sample phrase when none is chosen: the shortest. */
export const DEFAULT_SAMPLE_WORDS: SampleWordCount = BIP39_WORD_COUNTS[0];
/** The longest sample phrase, BIP39's longest: the most codes, and cards, that a backup prints. */
export const LONGEST_SAMPLE_WORDS: SampleWordCount = LONGEST_WORD_COUNT;
/** The length of a sample phrase, in words: one of BIP39's. */
export type SampleWordCount = Bip39WordCount;

/** The fixed public dates that the sample phrase is masked with. */
const SAMPLE_DATES = ["31-10-2008", "03-01-2009", "12-01-2009", "22-05-2010"].map(parseDate);
/** Why a byte of the sample phrase that the host's randomness gave is refused. */
const RANDOM_BYTE_REFUSAL = "The random source of the sample phrase gave a byte out of range.";

/** What a set of sample cards is drawn with. */
export interface CardPreviewOptions {
  /** The words of the sample phrase; 12 by default. */
  readonly words?: number;
  /** The page, the profile and the texts of the cards, as for a real export. */
  readonly settings?: CardSettings;
  /** The title of the sheet, where a design shows one. */
  readonly title?: string | undefined;
  /** The form of the codes of colour cards, which their QR code holds: colors by default. */
  readonly colorForm?: EncodedFormat;
}

/** The sample codes in `format`, as cards take a backup (CardBackup). */
function sampleBackup(result: EncodedResult, format: EncodedFormat): CardBackup {
  return { format, indexes: result.shiftedIndexes, text: () => formatEncoded(result, format) };
}

/**
 * Sample cards of the installed designs. A class because the masked sample phrase and the card
 * contents are worked out once and then drawn, with the host's `drawing`, for one design or for
 * all of them. It holds only a sample phrase made for it, masked with public dates.
 */
export class CardPreview {
  readonly #drawing: CardDrawing;
  readonly #colors: CardContent;

  /**
   * Draws a sample phrase of the length of `options` with the randomness of `drawing`, masks it
   * and builds its cards, drawn later with `drawing`. Throws
   * export.card-preview.preview-mnemonic-contain-words for a length that BIP39 lacks,
   * export.card-preview.colour-cards-not-written-as for a form that colour cards do not print,
   * core.encoded-form.unsupported-encoded-format for a colorForm that names no form, and
   * export.platform.checked-choice-refused for a byte of the phrase, drawn with the randomness of
   * `drawing`, that is no whole number from 0 to 255.
   */
  constructor(drawing: CardDrawing, options: CardPreviewOptions = {}) {
    this.#drawing = drawing;
    const words = options.words ?? DEFAULT_SAMPLE_WORDS;
    if (!isBip39WordCount(words))
      throw ERRORS.create("preview-mnemonic-contain-words", [`${WORD_COUNTS_TEXT}`]);
    const colorForm = options.colorForm ?? "colors";
    if (EncodedForm.of(colorForm).cardKind !== "colors")
      throw ERRORS.create("colour-cards-not-written-as", [`${colorForm}`]);
    // Each byte is checked as it is drawn: a Uint8Array would wrap 256 to 0 or cut 0.5 to 0, and
    // the cards would show a phrase that the host's randomness did not give.
    const randomByte = (limit: number): number =>
      checkedChoice(drawing.randomInt, limit, RANDOM_BYTE_REFUSAL);
    const result = encodeMnemonic(phraseOfRandomEntropy(words, randomByte), SAMPLE_DATES);
    const { settings, title } = options;
    // The cards of a backup, built as a save builds them (backupCardContent).
    this.#colors = backupCardContent(sampleBackup(result, colorForm), { settings, title });
  }

  /** The designs installed, which the sample cards can be drawn in. */
  static get templates(): readonly CardTemplate[] {
    return CARD_TEMPLATES;
  }

  /** What one design draws: the masked sample phrase as colours. */
  content(_template: CardTemplate): CardContent {
    return this.#colors;
  }

  /**
   * The design and its content, for a renderer that takes jobs (individual cards, images). Refuses
   * a `templateId` of no design as selectTemplate does
   * (export.template-catalog.card-template-unknown-incompatible-list-available-preview-templates),
   * and a catalog without designs (NoCardTemplateError, no-card-template).
   */
  job(templateId?: string): CardJob {
    const template = selectTemplate(templateId);
    return { template, content: this.content(template) };
  }

  /**
   * The designs of `selection` with their content, in the order of the installed list. Refuses
   * what job refuses: a design of no name, and a catalog without designs.
   */
  jobs(selection: DesignSelection): CardJob[] {
    if (!selection.every) return [this.job(selection.template)];
    if (CARD_TEMPLATES.length === 0) selectTemplate();
    return CARD_TEMPLATES.map((template) => ({ template, content: this.content(template) }));
  }

  /**
   * Refuses separate sample cards of every design (export.card-preview.one-design-separate-cards):
   * a folder of separate cards shows one. A host asks before it checks the folder, since the
   * sample cards need no secret.
   */
  static assertOneDesign(selection: DesignSelection): void {
    if (selection.every) throw ERRORS.create("one-design-separate-cards", []);
  }

  /**
   * The one design of separate sample cards with its content; refuses every design as
   * assertOneDesign does (export.card-preview.one-design-separate-cards).
   */
  separateCardsJob(selection: DesignSelection): CardJob {
    CardPreview.assertOneDesign(selection);
    return defined(this.jobs(selection)[0]);
  }

  /**
   * One design, by its name or number, or the first one; as one PDF. Refuses what job refuses, and
   * what renderCards refuses of the design and the settings, such as a page size or an orientation
   * of none (export.card-settings.page-size, export.card-settings.orientation).
   */
  render(templateId?: string): Promise<Uint8Array> {
    return renderCards(this.#drawing, [this.job(templateId)]);
  }

  /**
   * Draws in memory the colour cards of `templateId` as a save would, its sheets or its separate
   * cards or both, and throws why they cannot be drawn; nothing is written. A host checks so,
   * before it asks for a secret, that card settings the person typed print (Encode's dry run). The
   * refusals are those of selectTemplate for a design of no name or of another kind, and those of
   * renderCards and renderIndividualCards for the settings and the design.
   */
  async assertColorsPrint(templateId: string | undefined, what: CardOutputs): Promise<void> {
    const template = selectTemplate(templateId, "colors");
    if (what.sheets) await renderCards(this.#drawing, [{ template, content: this.#colors }]);
    if (what.cards) await renderIndividualCards(this.#drawing, template, this.#colors);
  }

  /**
   * Every installed design in one PDF, one design after the other. Refuses a catalog without
   * designs (NoCardTemplateError, no-card-template), and what renderCards refuses.
   */
  renderAll(): Promise<Uint8Array> {
    return renderCards(this.#drawing, this.jobs({ every: true }));
  }
}
