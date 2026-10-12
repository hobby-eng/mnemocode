// The forms that the codes of an encoded seed phrase are written in, each with what it is: how its
// codes are read and written, what they are called, how text in it looks, how it prints on cards,
// and whether a seed phrase in it is always masked. A new form is one more variant here, and the
// compiler asks for each of its facts; every reader, writer and question asks the form.
//
// Host-neutral: it reaches only the core's words and colors.

import { wordNumberOf } from "./bip39-sizes.js";
import { UNICODE_CODE_DIGITS, codeTokens, elementsFit } from "./code-text.js";
import {
  COLOR_UNICODE_POINTS_PER_COLOR,
  colorsToIndexes,
  colorsToUnicode,
  indexesToColors,
  isColorUnicodeSymbol,
  parseColors,
  unicodeToColors,
} from "./colors.js";
import { indexesOfWords, wordsOfIndexes } from "./english-words.js";
import {
  ENCODED_FORMATS,
  isEncodedFormat,
  type CardKind,
  type EncodedFormat,
  type EncodedResult,
} from "./types.js";
import {
  canonicalEnglishWords,
  unicodeCodesOfIndexes,
  unicodeIndexesOf,
  wordIndexOfNumber,
} from "./words.js";

/** What one form is. */
interface Variant {
  /** The BIP39 indexes of codes written in this form; throws why they cannot be read. */
  readonly read: (text: string) => number[];
  /** Codes, by their BIP39 indexes, written in this form. */
  readonly write: (indexes: readonly number[]) => string;
  /** What its codes are called in a message about their count. */
  readonly unit: string;
  /** Whether typed text looks like this form, judged by its characters alone. */
  readonly looks: (text: string) => boolean;
  /** The digits of each code where the codes are written joined, which a sample spaces apart. */
  readonly joinedWidth?: number;
  /** How it prints on cards; none for a form without cards. */
  readonly cardKind: CardKind | undefined;
  /**
   * Whether a seed phrase in it is always masked: English words are the phrase itself, and anyone
   * with the BIP39 list reads word numbers, so unmasked they would protect nothing.
   */
  readonly alwaysMasked: boolean;
}

const VARIANTS = Object.freeze({
  english: {
    read: (text) => indexesOfWords(canonicalEnglishWords(text)),
    write: (indexes) => wordsOfIndexes(indexes).join(" "),
    unit: "words",
    // What looks like no other form is taken for words.
    looks: () => true,
    cardKind: undefined,
    alwaysMasked: true,
  },
  indexes: {
    read: (text) => codeTokens(text).map(wordIndexOfNumber),
    write: (indexes) => indexes.map((index) => String(wordNumberOf(index))).join(" "),
    unit: "word numbers",
    // The looks split the elements as the readers do (code-text.ts, elementsFit).
    looks: (text) => elementsFit(text, /^\d+$/u),
    cardKind: undefined,
    alwaysMasked: true,
  },
  unicode: {
    read: unicodeIndexesOf,
    write: (indexes) => unicodeCodesOfIndexes(indexes).join(""),
    unit: "codes",
    looks: (text) => elementsFit(text, /^[0-9A-F]+$/u),
    joinedWidth: UNICODE_CODE_DIGITS,
    cardKind: undefined,
    alwaysMasked: false,
  },
  "colors-unicode": {
    read: (text) => colorsToIndexes(unicodeToColors(text)),
    write: (indexes) => colorsToUnicode(indexesToColors(indexes)),
    unit: "codes",
    // MnemoCode's colour codes are characters of its part of the Private Use Area (colors.ts).
    looks: (text) => Array.from(text).some(isColorUnicodeSymbol),
    joinedWidth: COLOR_UNICODE_POINTS_PER_COLOR * UNICODE_CODE_DIGITS,
    cardKind: "colors",
    alwaysMasked: false,
  },
  colors: {
    read: (text) => colorsToIndexes(parseColors(text)),
    write: (indexes) => indexesToColors(indexes).join(" "),
    unit: "codes",
    looks: (text) => text.includes("#"),
    cardKind: "colors",
    alwaysMasked: false,
  },
} satisfies Readonly<Record<EncodedFormat, Variant>>);

/**
 * The order in which the forms are guessed from typed text: the most telling characters first,
 * English words last, which every other text is taken for.
 */
const LIKELY_ORDER = Object.freeze([
  "colors",
  "colors-unicode",
  "indexes",
  "unicode",
  "english",
] as const satisfies readonly EncodedFormat[]);

/**
 * One form of codes and its facts. A class, so that callers ask the form instead of switching
 * over its name: the values are made once, one for each form, and never change.
 */
export class EncodedForm {
  static readonly #values = Object.freeze(
    Object.fromEntries(
      ENCODED_FORMATS.map((format) => [format, new EncodedForm(format, VARIANTS[format])]),
    ) as Record<EncodedFormat, EncodedForm>,
  );

  readonly #format: EncodedFormat;
  readonly #variant: Variant;

  private constructor(format: EncodedFormat, variant: Variant) {
    this.#format = format;
    this.#variant = variant;
  }

  /**
   * The form named `format`; refuses a value that names none, as a record, an option or a host
   * may pass anything. The one refusal of such a value: every other module asks it.
   */
  static of(format: EncodedFormat): EncodedForm {
    if (!isEncodedFormat(format)) throw new Error(`Unsupported encoded format: ${String(format)}.`);
    return EncodedForm.#values[format];
  }

  /** The form that typed text most likely is, judged by its characters. */
  static likely(text: string): EncodedFormat {
    return LIKELY_ORDER.find((format) => VARIANTS[format].looks(text))!;
  }

  get format(): EncodedFormat {
    return this.#format;
  }

  /** The BIP39 indexes of `text`, codes in this form; throws why they cannot be read. */
  read(text: string): number[] {
    return this.#variant.read(text);
  }

  /** The codes of `result` written in this form. */
  write(result: EncodedResult): string {
    return this.codes(result.shiftedIndexes);
  }

  /**
   * Codes, by their BIP39 indexes, written in this form: every form is written from the indexes
   * alone, so that no two forms of one result can disagree.
   */
  codes(indexes: readonly number[]): string {
    return this.#variant.write(indexes);
  }

  /** What the codes are called in a message about their count: "words", "word numbers", "codes". */
  get unit(): string {
    return this.#variant.unit;
  }

  /** The digits of each code where the codes are written joined, or undefined. */
  get joinedWidth(): number | undefined {
    return this.#variant.joinedWidth;
  }

  get cardKind(): CardKind | undefined {
    return this.#variant.cardKind;
  }

  get alwaysMasked(): boolean {
    return this.#variant.alwaysMasked;
  }
}
