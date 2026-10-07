// The words of the optional sheet for heirs (README "Instructions for heirs"): what the backup is,
// what is needed to restore it, the steps, and the basics for someone who has never used a wallet,
// with room for a hint written by hand. It never names anything that would help whoever finds it:
// no codes, no dates, no fingerprint (it would let a finder test guessed dates) and no places where
// shares are kept (listing them all on one sheet would undo the point of splitting the backup). It
// prints at most one address, the route's, whose page leads to the guide for heirs (docs/HEIRS.md).
// Nothing else is linked: the sheet may be kept for decades, and a page elsewhere can change,
// vanish, or pass to someone who abuses its address.
//
// Needs from the host: a HeirRoute, the way through its own program to the seed phrase, with the
// line that names that program under the title: the command line leads through its start menu
// (src/cli/heir-sheet.ts), a page through its tabs.
// Does not: lay out the sheet (export/heir-sheet.ts renders these words in A5 or A6) or save it.

import type { RecordFormat } from "../record.js";
import type { ShareFormat } from "../sskr/transport.js";
import type { HeirSheetSection, HeirSheetText } from "./heir-sheet.js";

/** How the seed phrase was masked; a sheet is never made with a replaced last word. */
export type HeirMode = "direct" | "seedshift" | "seedshift-legacy";

/** How shares may have been masked before the split: the Original Seedshift cannot be split. */
export type HeirShareMode = Exclude<HeirMode, "seedshift-legacy">;

/** What was made: the seed phrase in one encoded form, or Shamir shares of it. */
export type HeirBackup =
  | { readonly kind: "encoded"; readonly format: RecordFormat }
  | {
      readonly kind: "shares";
      readonly format: ShareFormat;
      readonly threshold: number;
      readonly count: number;
    };

export interface HeirSheetFacts {
  readonly backup: HeirBackup;
  readonly mode: HeirMode;
  /** How many dates mask the seed phrase; none in direct mode. */
  readonly dates: number;
}

/**
 * The way through one program from a computer one trusts to the seed phrase on its screen. The
 * sheet adds what every program shares: what is needed, the last step into a wallet program, the
 * advice when a step fails, and the basics.
 */
export interface HeirRoute {
  /** The line under the title: which program made the sheet, such as its name and version. */
  readonly subtitle: string;
  /** The one web address that the sheet prints, once, in the `start` steps (if it has steps). */
  readonly address: string;
  /** The steps that get the program and start it offline. */
  readonly start: readonly string[];
  /**
   * The steps that open the restore of an encoded backup made in `mode` and type it, then
   * `dates` (such as "the secret date as day-month-year (23-09-2026)") unless it was not masked.
   */
  decode(mode: HeirMode, dates: string | undefined): readonly string[];
  /** The steps that open the restore from shares and type `threshold` of them, then `dates`. */
  restore(mode: HeirShareMode, threshold: number, dates: string | undefined): readonly string[];
  /** What to do when a digit of a date cannot be read, or undefined where nothing searches it. */
  readonly dateDigitHelp: string | undefined;
}

/** How each encoded form looks, so that an heir recognises the backup. */
const ENCODED_LOOKS: Readonly<Record<RecordFormat, string>> = {
  english: "English words that look like a seed phrase but are masked",
  indexes: "numbers from 1 to 2048, one per word",
  unicode: "codes of four digits and letters A to F, one per word",
  colors: "color codes such as #1EAB91, on paper or on printed cards",
  "colors-unicode": "codes of digits and letters A to F that stand for colors",
};

/** How each share format looks. */
const SHARE_LOOKS: Readonly<Record<ShareFormat, string>> = {
  words: "words such as tuna next keep gyro",
  ur: "codes that start with ur:sskr/",
  indexes: "numbers from 1 to 2048",
  unicode: "codes of four digits and letters A to F",
  colors: "color codes such as #1EAB91, on paper or on printed cards",
  "colors-unicode": "codes of digits and letters A to F that stand for colors",
};

/** The last step, whatever the program. */
const OPEN_WALLET = "Open the wallet with this seed phrase in a wallet program (see below).";

/** Web addresses, to find any that a route would print besides its own. */
const WEB_ADDRESS = /https?:\/\/[^\s,"]+/gu;

function needs({ backup, mode, dates }: HeirSheetFacts): string[] {
  const lines =
    backup.kind === "shares"
      ? [
          `Any ${backup.threshold} of the ${backup.count} Shamir shares, written as ${SHARE_LOOKS[backup.format]}.`,
        ]
      : mode === "direct" && backup.format === "english"
        ? ["The seed phrase itself: English words, not masked."]
        : [`The backup: ${ENCODED_LOOKS[backup.format]}.`];
  lines.push(
    mode === "direct"
      ? "No secret dates are needed."
      : dates === 1
        ? "The owner's secret date (see the back). It is written nowhere; the hint may lead to it."
        : `The owner's ${dates} secret dates (see the back). They are written nowhere; the hint may lead to them.`,
  );
  return lines;
}

function hintNote({ mode, dates }: HeirSheetFacts): string {
  if (mode === "direct")
    return "Write by hand what only your heirs will understand, such as a clue to a BIP39 passphrase if you used one.";
  const what = dates === 1 ? "the date" : "the dates";
  const example = dates === 1 ? '"the day we met"' : '"the day we met and our son\'s birthday"';
  const never = dates === 1 ? "Never the date itself." : "Never the dates themselves.";
  return `Write by hand a clue to ${what} that only your heirs will understand, such as ${example}. ${never}`;
}

/** The back: what someone who has never used a wallet needs to know first. */
function basics({ mode }: HeirSheetFacts): HeirSheetSection[] {
  const sections: HeirSheetSection[] = [
    {
      heading: "Seed phrase",
      paragraphs: [
        "Cryptocurrency is recorded on a public ledger, not at a bank. Whoever knows the seed phrase of a wallet, 12 to 24 English words from the BIP39 list, can spend what it holds; any BIP39 wallet program opens it.",
      ],
    },
  ];
  if (mode !== "direct")
    sections.push({
      heading: "Secret dates",
      paragraphs: [
        // The example is the one of the README (How checksum-valid Seedshift works).
        'The owner masked the words with dates of their choosing, such as birthdays: the year, month and day of each date move the words along the BIP39 list of 2048 words, like a simple cipher (with 23-09-2026, "abandon" becomes "wool"). Only the same dates move them back; a wrong date gives no error, just another seed phrase with an empty wallet. The dates have nothing to do with today\'s date.',
      ],
    });
  sections.push(
    {
      heading: "Opening the wallet",
      paragraphs: [
        'Install a well-known wallet program from its own website, choose "Restore" (not "Create") and type the seed phrase. Wallet empty? Check the dates, try the program the owner used, or look for a BIP39 passphrase, an extra word that MnemoCode does not keep. Then move everything to a new wallet of your own.',
      ],
    },
    {
      heading: "Scams",
      paragraphs: [
        "Nobody honest asks for a seed phrase; whoever has it can take everything for good. For help, ask someone you trust to sit beside you, and keep the words in your own hands.",
      ],
    },
  );
  return sections;
}

/** Refuses facts that would print a wrong sheet: a count of dates that does not fit the mode. */
function assertFacts({ backup, mode, dates }: HeirSheetFacts): void {
  if (backup.kind === "shares" && mode === "seedshift-legacy")
    throw new Error("Shares cannot use the original Seedshift.");
  const fits = mode === "direct" ? dates === 0 : Number.isSafeInteger(dates) && dates >= 1;
  if (!fits)
    throw new Error("A sheet for heirs needs no dates in direct mode and at least one otherwise.");
}

/** Every line of `text`, in the order it is printed. */
function linesOf(text: HeirSheetText): string[] {
  return [
    text.title,
    text.subtitle,
    text.newcomer,
    ...text.needs,
    text.hintNote,
    ...text.steps,
    text.trouble,
    text.warning,
    text.footer,
    text.basicsTitle,
    ...text.basics.flatMap((section) => [section.heading, ...section.paragraphs]),
  ];
}

/**
 * The words of the sheet for heirs, for the program that `route` leads through. A class, so that a
 * host binds its route once and every sheet keeps the promise of the header: the route's address
 * is printed at most once, and no other.
 */
export class HeirInstructions {
  readonly #route: HeirRoute;

  constructor(route: HeirRoute) {
    this.#route = route;
  }

  /** The words of the sheet for `facts`, ready for renderHeirSheet (export/heir-sheet.ts). */
  text(facts: HeirSheetFacts): HeirSheetText {
    assertFacts(facts);
    const text: HeirSheetText = {
      title: "How to restore this wallet backup",
      subtitle: this.#route.subtitle,
      newcomer: 'The steps are on the back. New to wallets? Read "The basics" there first.',
      needs: needs(facts),
      hintNote: hintNote(facts),
      steps: this.#steps(facts),
      trouble: this.#trouble(facts),
      warning: `Never type the backup${facts.mode === "direct" ? "" : ", the dates"} or the seed phrase into a website or send them to anyone.`,
      footer: "This sheet holds no secret. Keep it apart from the backup.",
      basicsTitle: "The basics",
      basics: basics(facts),
    };
    // The seed phrase itself in English words needs no program, and so no address.
    const printed = linesOf(text).join("\n").match(WEB_ADDRESS) ?? [];
    if (printed.length > 1 || printed.some((address) => address !== this.#route.address))
      throw new Error("The sheet for heirs may print the route's address once and no other.");
    return text;
  }

  #steps({ backup, mode, dates }: HeirSheetFacts): string[] {
    // The seed phrase itself needs no program at all.
    if (backup.kind === "encoded" && backup.format === "english" && mode === "direct")
      return [OPEN_WALLET];
    // As the programs ask for them: day-month-year, as datesPrompt and the share prompt do.
    const typedDates =
      mode === "direct"
        ? undefined
        : `the secret ${dates === 1 ? "date" : "dates"} as day-month-year (23-09-2026)`;
    const route = this.#route;
    // assertFacts refused shares of the Original Seedshift.
    const open =
      backup.kind === "shares"
        ? route.restore(mode as HeirShareMode, backup.threshold, typedDates)
        : route.decode(mode, typedDates);
    return [...route.start, ...open, OPEN_WALLET];
  }

  #trouble({ backup, mode }: HeirSheetFacts): string {
    const advice = [
      "An error usually means a mistyped code or word: check each one against the paper.",
    ];
    // Unreadable elements of a share are filled in from its checksum (src/sskr/repair.ts).
    if (backup.kind === "shares") advice.push("Type ? for each code you cannot read.");
    const help = this.#route.dateDigitHelp;
    if (mode !== "direct" && help !== undefined) advice.push(help);
    return advice.join(" ");
  }
}
