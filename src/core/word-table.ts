// The public BIP39 dictionary mapping and its numbered exports, importable without recovery,
// cards, shares or a Node.js host. The table owns its indexes; callers receive rows by value.
import { wordlist as chinese } from "@scure/bip39/wordlists/traditional-chinese.js";
import { englishTokens, englishWordlist } from "./english-words.js";
import { hexCodePoint } from "./code-text.js";
import { WORD_NUMBER_RANGE, WORD_NUMBERS_THROUGH } from "./bip39-sizes.js";
import { DECIMAL_DIGITS, inWholeRange, wholeNumberOf } from "./typed-number.js";
import type { MappingRow } from "./types.js";
import { defined } from "./defined.js";
import { ErrorCatalog, suppliedMessage } from "./error-catalog.js";

// Keep the existing refusal codes while moving their one implementation out of words.ts.
const ERRORS = new ErrorCatalog("core.words", {
  "selected-mapped-bip39-character-not-one-unicode-scalar": () =>
    "The selected mapped BIP39 character is not one Unicode scalar value.",
  "wordlist-index-from": (range: string) => `A wordlist index must be from ${range}.`,
  "word-table-row-refused": suppliedMessage,
  "word-table-lookup": () => "Word table lookup must use a word, index or Unicode code.",
  "word-table-format": () => "Word list format must be english, chinese, unicode or mapping.",
});

/** What a lookup starts from: an English word, its number or its Unicode code. */
export type WordTableLookup = "word" | "index" | "unicode";
/** How a Unicode code of the table is written, for hints. */
export const UNICODE_CODE_HINT = "four hexadecimal digits, such as 5BF6";
/** Numbered dictionary exports; Chinese means the Traditional Chinese BIP39 list. */
export const WORD_TABLE_FORMATS = Object.freeze([
  "english",
  "chinese",
  "unicode",
  "mapping",
] as const);
/** The columns of a numbered BIP39 dictionary export. */
export type WordTableFormat = (typeof WORD_TABLE_FORMATS)[number];

const HEADER = ["index", "english", "unicode_hex"] as const;
const COLUMNS = {
  index: (row: MappingRow) => row.index,
  english: (row: MappingRow) => row.english,
  chinese: (row: MappingRow) => String.fromCodePoint(Number.parseInt(row.unicodeHex, 16)),
  unicode_hex: (row: MappingRow) => row.unicodeHex,
};
const LAYOUTS: Readonly<Record<WordTableFormat, readonly (keyof typeof COLUMNS)[]>> = {
  english: ["index", "english"],
  chinese: ["index", "chinese"],
  unicode: ["index", "chinese", "unicode_hex"],
  mapping: ["index", "english", "chinese", "unicode_hex"],
};
// UTF-16 surrogate code points are code units, never Unicode scalar values.
const SURROGATE_CODE_POINTS = { min: 0xd800, max: 0xdfff } as const;

/** The canonical dictionary: lookup, word numbers, Unicode mapping and numbered text exports. */
export class WordTable {
  static readonly #rows = Object.freeze(
    englishWordlist.map((english, index) =>
      Object.freeze({
        index: index + WORD_NUMBER_RANGE.min,
        english,
        unicodeHex: WordTable.unicodeHex(defined(chinese[index])),
      }),
    ),
  );
  static readonly #englishIndex = new Map(
    WordTable.#rows.map((row) => [row.english, row.index - 1]),
  );
  static readonly #unicodeIndex = new Map(
    WordTable.#rows.map((row) => [row.unicodeHex, row.index - 1]),
  );
  static readonly #codes = Object.freeze(WordTable.#rows.map((row) => row.unicodeHex));
  static readonly #lookups: Readonly<
    Record<
      WordTableLookup,
      {
        readonly find: (typed: string) => number | undefined;
        readonly refusal: string;
      }
    >
  > = {
    word: {
      find: (typed) => {
        const words = englishTokens(typed);
        return words.length === 1 ? WordTable.#englishIndex.get(defined(words[0])) : undefined;
      },
      refusal: "That word is not in the English BIP39 list.",
    },
    index: {
      find: (typed) => WordTable.indexOfNumber(typed),
      refusal: `A word number is a whole number from ${WORD_NUMBERS_THROUGH}.`,
    },
    unicode: {
      find: (typed) => WordTable.indexOfUnicode(typed.toUpperCase()),
      refusal: `No BIP39 word has that code; type ${UNICODE_CODE_HINT}.`,
    },
  };

  /**
   * A Unicode scalar value as four or more uppercase hexadecimal digits; refuses other text
   * (core.words.selected-mapped-bip39-character-not-one-unicode-scalar).
   */
  static unicodeHex(symbol: string): string {
    const point = typeof symbol === "string" ? symbol.codePointAt(0) : undefined;
    if (
      point === undefined ||
      inWholeRange(point, SURROGATE_CODE_POINTS) ||
      String.fromCodePoint(point) !== symbol
    )
      throw ERRORS.create("selected-mapped-bip39-character-not-one-unicode-scalar", []);
    return hexCodePoint(point);
  }

  /** Each word's Unicode code, by its zero-based BIP39 index; the array cannot be changed. */
  static get unicodeCodes(): readonly string[] {
    return WordTable.#codes;
  }

  /** The zero-based BIP39 index of an exact uppercase Unicode code; undefined if none. */
  static indexOfUnicode(code: string): number | undefined {
    return WordTable.#unicodeIndex.get(code);
  }

  /** A written word number as a zero-based BIP39 index; undefined for other text or numbers. */
  static indexOfNumber(token: string, syntax: RegExp = DECIMAL_DIGITS): number | undefined {
    const number = wholeNumberOf(token, syntax, WORD_NUMBER_RANGE);
    return number === undefined ? undefined : number - WORD_NUMBER_RANGE.min;
  }

  /**
   * A row by its word number, from 1 through 2,048; refuses a number outside that range
   * (core.words.wordlist-index-from).
   */
  static row(index: number): MappingRow {
    if (!inWholeRange(index, WORD_NUMBER_RANGE))
      throw ERRORS.create("wordlist-index-from", [WORD_NUMBERS_THROUGH]);
    return { ...defined(WordTable.#rows[index - WORD_NUMBER_RANGE.min]) };
  }

  /** Every row in word-number order, independent of the table's owned storage. */
  static rows(): MappingRow[] {
    return WordTable.#rows.map((row) => ({ ...row }));
  }

  /**
   * A row named by a typed word, number or Unicode code; refuses a selector that names no lookup
   * (core.words.word-table-lookup) and text that fits no row (word-table-row-refused).
   */
  static lookup(lookup: WordTableLookup, text: string): MappingRow {
    if (typeof lookup !== "string" || !Object.hasOwn(WordTable.#lookups, lookup))
      throw ERRORS.create("word-table-lookup", []);
    const { find, refusal } = WordTable.#lookups[lookup];
    const index = find(text.trim());
    if (index === undefined) throw ERRORS.create("word-table-row-refused", [refusal]);
    return WordTable.row(index + WORD_NUMBER_RANGE.min);
  }

  /**
   * Every word as numbered TSV with a header; the legacy mapping by default, unknown formats
   * refused (core.words.word-table-format).
   */
  static text(format?: WordTableFormat): string {
    if (format !== undefined && !WORD_TABLE_FORMATS.includes(format))
      throw ERRORS.create("word-table-format", []);
    const columns = format === undefined ? HEADER : LAYOUTS[format];
    const rows = WordTable.#rows.map((row) => columns.map((column) => COLUMNS[column](row)));
    return [columns, ...rows].map((cells) => cells.join("\t") + "\n").join("");
  }
}
