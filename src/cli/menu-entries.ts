// The entries of the start menu as it shows them, each a digit and a label. The menu lists them
// (menu.ts), and the messages and the sheet for heirs that send a person to an entry name it from
// here (heir-sheet.ts, share-repair.ts, date-search.ts, backup-check.ts), so that every text names
// an entry as the menu shows it.

/** One entry of the start menu: the digit that chooses it and its label. */
export interface MenuEntryName {
  readonly digit: number;
  readonly label: string;
}

export const MENU_ENTRY_NAMES = {
  encode: { digit: 1, label: "Encode a seed phrase as numbers, codes or colors" },
  decode: { digit: 2, label: "Decode numbers, codes or colors back into a seed phrase" },
  split: { digit: 3, label: "Split a seed phrase into standard Shamir shares" },
  restore: { digit: 4, label: "Restore a seed phrase from Shamir shares" },
  recover: { digit: 5, label: "Find a forgotten word, a date digit or a share code" },
  preview: { digit: 6, label: "Print sample cards with a test seed phrase" },
  table: { digit: 7, label: "Look up a seed word, its number or its Unicode code" },
  selfTest: { digit: 8, label: "Check that this copy of MnemoCode works" },
  help: { digit: 9, label: "Show every command and option" },
  quit: { digit: 0, label: "Quit" },
} as const satisfies Readonly<Record<string, MenuEntryName>>;

/** An entry as the menu shows it, its digit before its label: "2 Decode numbers, …". */
export function shownEntry(entry: MenuEntryName): string {
  return `${entry.digit} ${entry.label}`;
}
