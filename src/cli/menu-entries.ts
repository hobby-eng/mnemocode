// The entries of the start menu as it shows them, each a digit and a label. The menu lists them
// (menu.ts), and the messages and the sheet for heirs that send a person to an entry name it from
// here (heir-sheet.ts, share-repair.ts, date-search.ts, backup-check.ts), so that every text names
// an entry as the menu shows it.

/** One entry of the start menu: the digit that chooses it, or null for none, and its label. */
export interface MenuEntryName {
  readonly digit: number | null;
  readonly label: string;
}

export const MENU_ENTRY_NAMES = {
  encode: { digit: 1, label: "Encode a seed phrase as numbers, codes or colors" },
  // Its own entry after Encode (owner, 2026-10-13).
  reEncode: { digit: 2, label: "Re-encode a backup with other dates or in another form" },
  decode: { digit: 3, label: "Decode numbers, codes or colors back into a seed phrase" },
  split: { digit: 4, label: "Split a seed phrase into standard Shamir shares" },
  restore: { digit: 5, label: "Restore a seed phrase from Shamir shares" },
  recover: { digit: 6, label: "Find a forgotten word, code, date digit or share code" },
  preview: { digit: 7, label: "Print sample cards with a test seed phrase" },
  table: { digit: 8, label: "Look up a seed word, its number or its Unicode code" },
  // As the self-test is named in mhfe too, so that the tools read alike (owner, 2026-10-13).
  selfTest: { digit: 9, label: "Run the self-test" },
  help: { digit: 0, label: "Show every command and option" },
  // As in mhfe: the last entry, without a digit; Escape quits as well (owner, 2026-10-13).
  quit: { digit: null, label: "Quit" },
} as const satisfies Readonly<Record<string, MenuEntryName>>;

/** The answer of the menu that types an encoded seed phrase in, which the sheet for heirs names. */
export const TYPED_SOURCE = "Type or paste it";

/** The question of how many words the typed codes stand for, and its answer for `words` words. */
export const PHRASE_WORDS_QUESTION = "How many words does the seed phrase have?";
export function phraseWordsAnswer(words: number): string {
  return `${words} words`;
}

/** An entry as the menu shows it, its digit before its label: "3 Decode numbers, …". */
export function shownEntry(entry: MenuEntryName): string {
  return entry.digit === null ? entry.label : `${entry.digit} ${entry.label}`;
}
