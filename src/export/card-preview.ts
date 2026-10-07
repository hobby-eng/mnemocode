// Sample cards: every card design drawn with a public test phrase, so that a person can see the
// designs before writing a real backup. The phrase is the public "abandon … about" for 12 words and
// the phrase of all-zero entropy for the other lengths, masked with four fixed public dates.
//
// From the host it needs the render platform that the card renderers read (export/platform.ts,
// configureRenderPlatform) and, optionally, the labels that dated Unicode cards print beside the
// four dates (the command line passes the events of those dates; the default labels name no event).
// It returns PDF bytes and writes no file.
//
// Host-neutral: it imports only other export and core modules, @scure/bip39 and pdf-lib through the
// renderers.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { indexesToColors } from "../core/colors.js";
import { parseDate } from "../core/dates.js";
import { formatEncoded } from "../core/representations.js";
import { encodeMnemonic } from "../core/seedshift.js";
import type { CardSettings } from "./card-settings.js";
import { renderCards, type CardJob } from "./render.js";
import { cardTemplates, selectTemplate, type CardContent, type CardTemplate } from "./templates.js";

/** The lengths of a sample phrase, as BIP39 has them. */
export const SAMPLE_WORD_COUNTS = [12, 15, 18, 21, 24] as const;
export type SampleWordCount = (typeof SAMPLE_WORD_COUNTS)[number];

const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** BIP39 writes every 4 bytes of entropy as 3 words. */
const ENTROPY_BYTES_PER_THREE_WORDS = 4;
/** The fixed public dates that the sample phrase is masked with. */
const SAMPLE_DATES = ["31-10-2008", "03-01-2009", "12-01-2009", "22-05-2010"].map(parseDate);
/** What dated Unicode cards print beside the dates when the host gives no labels of its own. */
const DEFAULT_LABELS = ["First date", "Second date", "Third date", "Fourth date"];

/** What a set of sample cards is drawn with. */
export interface CardPreviewOptions {
  /** The words of the sample phrase; 12 by default. */
  readonly words?: number;
  /** One label for each of the four dates of dated Unicode cards. */
  readonly labels?: readonly string[];
  /** The page, the profile and the texts of the cards, as for a real export. */
  readonly settings?: CardSettings;
  /** The title of the sheet, where a design shows one. */
  readonly title?: string | undefined;
}

/** The sample phrase of `words` words. */
function samplePhrase(words: SampleWordCount): string {
  if (words === 12) return PUBLIC_MNEMONIC;
  return entropyToMnemonic(new Uint8Array((words / 3) * ENTROPY_BYTES_PER_THREE_WORDS), wordlist);
}

/**
 * Sample cards of the installed designs. A class because the masked sample phrase and the card
 * contents are worked out once and then drawn for one design or for all of them. It holds public
 * test data only.
 */
export class CardPreview {
  readonly #colors: CardContent;
  readonly #unicode: CardContent;

  constructor(options: CardPreviewOptions = {}) {
    const words = options.words ?? 12;
    if (!SAMPLE_WORD_COUNTS.includes(words as SampleWordCount))
      throw new Error("The preview mnemonic must contain 12, 15, 18, 21, or 24 words.");
    const labels = options.labels ?? DEFAULT_LABELS;
    if (labels.length !== SAMPLE_DATES.length || labels.some((label) => typeof label !== "string"))
      throw new Error(`Give one label for each of the ${SAMPLE_DATES.length} sample dates.`);
    const result = encodeMnemonic(samplePhrase(words as SampleWordCount), SAMPLE_DATES);
    const colors = indexesToColors(result.shiftedIndexes);
    const title = options.title === undefined ? {} : { title: options.title };
    this.#colors = Object.freeze({
      ...options.settings,
      kind: "colors",
      colors: Object.freeze(colors),
      payload: colors.join(" "),
      ...title,
    });
    this.#unicode = Object.freeze({
      kind: "unicode",
      dates: result.dates,
      eventLabels: Object.freeze([...labels]),
      payload: formatEncoded(result, "unicode"),
      ...title,
    });
  }

  /** The designs installed, which the sample cards can be drawn in. */
  static get templates(): readonly CardTemplate[] {
    return cardTemplates;
  }

  /** What one design draws: the masked sample phrase as colours, or as dated Unicode codes. */
  content(template: CardTemplate): CardContent {
    return template.kind === "colors" ? this.#colors : this.#unicode;
  }

  /** The design and its content, for a renderer that takes jobs (individual cards, images). */
  job(templateId?: string): CardJob {
    const template = selectTemplate(templateId);
    return { template, content: this.content(template) };
  }

  /** One design, by its name or number, or the first one; as one PDF. */
  render(templateId?: string): Promise<Uint8Array> {
    return renderCards([this.job(templateId)]);
  }

  /** Every installed design in one PDF, one design after the other. */
  renderAll(): Promise<Uint8Array> {
    if (cardTemplates.length === 0) selectTemplate();
    return renderCards(
      cardTemplates.map((template) => ({ template, content: this.content(template) })),
    );
  }
}
