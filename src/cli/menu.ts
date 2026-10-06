// The menu that MnemoCode shows when it starts without arguments at a terminal, as from a
// double-click; the same idea as the menu of `mhfe` (src/bin/mhfe/menu.rs). An entry asks its
// questions as lists chosen with the arrow keys, builds the command line that does the same, shows
// it in grey and runs it exactly as if it had been typed after `mnemocode`, so that the person can
// type it later. A secret is never part of that command line: the command asks for it on its private
// screen (--ask-secrets, private-screen.ts).

import { formatEncoded, representMnemonic, type OutputFormat } from "../core.js";
import { cardTemplates } from "../export/templates.js";
import { MAX_SHARES, validateThreshold } from "../sskr/shares.js";
import { PRIVATE_SCREEN_COMMANDS } from "./command-line.js";
import { CANCELLED_EXIT_CODE, privateScreenAvailable } from "./private-screen.js";
import { dropForMenu, runInOwnProcess } from "./protection.js";
import {
  askLine,
  choose,
  LINE_WIDTH,
  waitForEnter,
  type Choice,
  type Explanation,
} from "./terminal-choice.js";
import { terminalAvailable } from "./terminal-input.js";
import {
  readmeLink,
  STYLE,
  terminalMore,
  terminalNotice,
  terminalPaint,
  wrapText,
} from "./terminal.js";
import { printUsage } from "./usage.js";

/** The menu reads keys from a terminal and draws on one; anything else gets the help instead. */
export function menuAvailable(): boolean {
  return terminalAvailable();
}

/** What an entry does once its questions are answered; undefined means that the person went back. */
type Action = { readonly run: readonly string[] } | "help" | "quit" | undefined;

type EncodedForm = Exclude<OutputFormat, "json">;

/** The number that --format takes for each form (mnemocode help formats). */
const FORMAT_NUMBER: Readonly<Record<EncodedForm, string>> = {
  english: "1",
  indexes: "2",
  unicode: "3",
  "colors-unicode": "4",
  colors: "5",
};

/**
 * The phrase of the examples: a public BIP39 test vector (entropy 0x80 repeated). The usual test
 * phrase, abandon ... about, would show the same number and code eleven times.
 */
const EXAMPLE_PHRASE =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";

/** A form written out for the example phrase, in groups that read well. */
function example(form: EncodedForm): string {
  const written = formatEncoded(representMnemonic(EXAMPLE_PHRASE), form);
  // Unicode codes have four digits and colours as text eight; both are written joined.
  if (form === "unicode") return written.match(/.{4}/gu)!.join(" ");
  if (form === "colors-unicode") return written.match(/.{8}/gu)!.join(" ");
  return written;
}

/** The forms in the order of the question, the first three being the usual ones. */
function formChoices(): Choice<EncodedForm>[] {
  return [
    {
      label: "Word numbers",
      note: "its place in the BIP39 word list, masked with your dates",
      example: example("indexes"),
      value: "indexes",
    },
    {
      label: "Unicode codes",
      note: "four-digit hexadecimal codes of the Chinese BIP39 words",
      example: example("unicode"),
      value: "unicode",
    },
    {
      label: "Colors",
      note: "color codes, 8 to 16 for the whole seed phrase",
      example: example("colors"),
      value: "colors",
    },
    {
      label: "Colors as text",
      note: "the same colors written as Unicode codes, no font needed",
      example: example("colors-unicode"),
      value: "colors-unicode",
    },
    {
      label: "English words",
      note: "the seed phrase itself, masked with your dates",
      value: "english",
    },
  ];
}

/** What Seedshift is, shown with the first question about it; the README explains it. */
const SEEDSHIFT_EXPLANATION: Explanation = {
  lines: ["Masks the seed phrase with dates you remember; only they turn it back."],
  more: [readmeLink("transformation-modes")],
};

/** How the two Seedshift transformations differ, shown with the question that chooses one. */
const VARIANT_EXPLANATION: Explanation = {
  lines: ["MnemoCode's result keeps a valid checksum; the original's usually fails it."],
  more: [readmeLink("how-checksum-valid-seedshift-works")],
};

/** What Shamir shares are, shown with the question how many to make. */
const SHARES_EXPLANATION: Explanation = {
  lines: ["Shares in this form; restoring gives it back. Fewer reveal nothing."],
  more: [readmeLink("splitting-a-mnemonic-into-shares")],
};

/** What standard shares are, shown with the question how many to make in entry 3. */
const STANDARD_SHARES_EXPLANATION: Explanation = {
  lines: ["Standard SSKR shares of the seed phrase itself, which other SSKR tools read."],
  more: [readmeLink("splitting-a-mnemonic-into-shares")],
};

/** What a whole copy beside the shares means, shown with the question whether to show one. */
const COPY_EXPLANATION: Explanation = {
  lines: ["It alone restores the wallet: keep it apart from the shares, or choose No."],
};

/** What the sheet for heirs is, shown with the question whether to make it. */
const HEIRS_EXPLANATION: Explanation = {
  lines: ["A printed page on how to restore the backup; it holds no secret."],
  more: [readmeLink("instructions-for-heirs")],
};

type Mode = "direct" | "seedshift" | "seedshift-legacy";

/** The two Seedshift transformations (README, Transformation modes). */
const SEEDSHIFT_VARIANTS: readonly Choice<Mode>[] = [
  {
    label: "MnemoCode Seedshift",
    note: "a valid BIP39 seed phrase again; recommended",
    value: "seedshift",
  },
  {
    label: "Original Seedshift",
    note: "as the original program; checksum usually fails",
    value: "seedshift-legacy",
  },
];

/**
 * Forms that only write the words differently: English words are the seed phrase itself, and
 * anyone with the BIP39 list reads word numbers. Unmasked they would protect nothing while seeming
 * to, so the menu always masks them.
 */
const ALWAYS_MASKED: ReadonlySet<EncodedForm> = new Set(["english", "indexes"]);

/** Why there is no question whether to mask, shown with the question which Seedshift. */
const ALWAYS_MASKED_EXPLANATION: Explanation = {
  lines: [
    "Always masked: unmasked, this form shows the seed phrase itself.",
    ...VARIANT_EXPLANATION.lines,
  ],
  more: VARIANT_EXPLANATION.more,
};

/**
 * Whether Seedshift is used and which; undefined means back. A form in ALWAYS_MASKED is always
 * masked (`required`). Standard shares take only MnemoCode Seedshift (`shares`), so there is
 * nothing to choose between, and without it the shares themselves still protect the phrase.
 */
async function askSeedshift(
  question: string,
  options: { readonly required?: boolean; readonly shares?: boolean } = {},
): Promise<Mode | undefined> {
  if (options.required !== true) {
    const unmasked =
      options.shares === true
        ? "the shares alone restore it"
        : "weak: only disguised, anyone with MnemoCode reads it";
    const used = await choose(
      question,
      [
        { label: "Yes", note: "the same dates are needed to get it back", value: true },
        { label: "No", note: unmasked, value: false },
      ],
      { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
    );
    if (used === undefined) return undefined;
    if (!used) return "direct";
  }
  if (options.shares === true) return "seedshift";
  return choose("Which Seedshift?", SEEDSHIFT_VARIANTS, {
    label: "Variant",
    explanation: options.required === true ? ALWAYS_MASKED_EXPLANATION : VARIANT_EXPLANATION,
  });
}

/** A design for printable cards and the PDF file; the page is A6, the command's default. */
async function askCards(fileName: string): Promise<string[] | undefined> {
  const design = await askDesign(false);
  if (design === undefined) return undefined;
  const path = await askLine("PDF file name", "File", fileName);
  if (path === undefined) return undefined;
  return ["--template", design, "--pdf", path];
}

async function askDesign(withEveryDesign: boolean): Promise<string | undefined> {
  const designs: Choice<string>[] = cardTemplates.map((template) => ({
    label: template.name,
    note: template.id,
    value: template.id,
  }));
  if (withEveryDesign)
    designs.unshift({ label: "Every design", note: "all in one PDF", value: "" });
  return choose("Which card design?", designs, { label: "Design" });
}

/**
 * Where an encoded result goes besides the screen. Cards print color codes, so they are offered
 * only for a result written in colors.
 */
async function askResultDestination(form: EncodedForm): Promise<string[] | undefined> {
  const choices: Choice<"screen" | "record" | "qr" | "cards">[] = [
    { label: "Only on this screen", value: "screen" },
    { label: "Also in a record file", note: "text that Decode reads back", value: "record" },
    { label: "Also as a QR code image", note: "a PNG file that Decode reads back", value: "qr" },
  ];
  if (form === "colors" || form === "colors-unicode")
    choices.push({
      label: "Also as printable cards",
      note: "a PDF in a card design",
      value: "cards",
    });
  const destination = await choose("Where should the result go?", choices, { label: "Output" });
  if (destination === undefined) return undefined;
  if (destination === "screen") return [];
  if (destination === "cards") return askCards("mnemocode-cards.pdf");
  const path =
    destination === "record"
      ? await askLine("Record file name", "File", "mnemocode-record.txt")
      : await askLine("QR code file name", "File", "mnemocode-qr.png");
  if (path === undefined) return undefined;
  return [destination === "record" ? "--output" : "--qr", path];
}

/**
 * Entry 1: the seed phrase in another form, masked with Seedshift and split into Shamir shares if
 * wanted. The shares are written in the same form, so that whatever is chosen looks alike.
 */
async function encodeAction(): Promise<Action> {
  const form = await choose("Which form should the seed phrase take?", formChoices(), {
    label: "Form",
  });
  if (form === undefined) return undefined;
  const mode = await askSeedshift("Use Seedshift?", { required: ALWAYS_MASKED.has(form) });
  if (mode === undefined) return undefined;
  // The original Seedshift cannot be split into shares (mnemocode encode --help).
  const set =
    mode === "seedshift-legacy"
      ? null
      : await askShareSet("Split it into Shamir shares?", SHARES_EXPLANATION, true);
  if (set === undefined) return undefined;
  const run =
    set === null ? await askCopyDestination(form, mode) : await askSharesRun(set, form, mode);
  if (run === undefined) return undefined;
  const heirs = await askHeirSheet();
  return heirs === undefined ? undefined : { run: [...run, ...heirs] };
}

/** One copy in the chosen form, and where it goes. */
async function askCopyDestination(form: EncodedForm, mode: Mode): Promise<string[] | undefined> {
  const destination = await askResultDestination(form);
  if (destination === undefined) return undefined;
  return [
    "encode",
    "--ask-secrets",
    "--format",
    FORMAT_NUMBER[form],
    "--mode",
    mode,
    ...destination,
  ];
}

/**
 * Shares in the chosen form, where they go, and whether the whole seed phrase is shown beside
 * them (--format), for a person who keeps it and holds the shares in reserve.
 */
async function askSharesRun(
  set: ShareSet,
  form: EncodedForm,
  mode: Mode,
): Promise<string[] | undefined> {
  const shares = await askShares(set, SHARE_FORMAT[form]);
  if (shares === undefined) return undefined;
  const copy = await choose(
    "Also show the whole seed phrase?",
    [
      { label: "No", note: "only the shares", value: false },
      { label: "Yes", note: "in the same form, beside the shares", value: true },
    ],
    { label: "Copy", explanation: COPY_EXPLANATION },
  );
  if (copy === undefined) return undefined;
  return [
    "encode",
    "--sskr",
    "--ask-secrets",
    "--mode",
    mode,
    ...shares,
    ...(copy ? ["--format", FORMAT_NUMBER[form]] : []),
  ];
}

/** The optional sheet that tells heirs how to restore the backup (README, Instructions for heirs). */
async function askHeirSheet(): Promise<string[] | undefined> {
  const size = await choose(
    "Instructions for your heirs?",
    [
      { label: "No", value: "" },
      { label: "Yes, A5", note: "notebook size, 148 x 210 mm, larger print", value: "a5" },
      { label: "Yes, A6", note: "postcard size, 105 x 148 mm, small print", value: "a6" },
    ],
    { label: "Heirs", explanation: HEIRS_EXPLANATION },
  );
  if (size === undefined) return undefined;
  if (size === "") return [];
  const path = await askLine("PDF file name", "File", "mnemocode-heirs.pdf");
  return path === undefined ? undefined : ["--heir-sheet", path, "--heir-sheet-size", size];
}

/** Where an encoded seed phrase is read from: typed on the private screen, or a file encode saved. */
async function askSource(): Promise<
  { readonly options: string[]; readonly typed: boolean } | undefined
> {
  const source = await choose(
    "Where is the encoded seed phrase?",
    [
      {
        label: "Type or paste it",
        note: "numbers, codes, colors or a record",
        example: `${example("indexes")} · ${example("colors")}`,
        value: "typed",
      },
      { label: "In a record file", note: "the text file that Encode saved", value: "record" },
      { label: "In a QR code image", note: "the PNG file that Encode saved", value: "qr" },
    ] as const,
    { label: "Source" },
  );
  if (source === undefined) return undefined;
  if (source === "typed") return { options: [], typed: true };
  const path =
    source === "record"
      ? await askLine("Record file name", "File", "mnemocode-record.txt")
      : await askLine("QR code file name", "File", "mnemocode-qr.png");
  if (path === undefined) return undefined;
  return { options: [source === "record" ? "--input-file" : "--qr-file", path], typed: false };
}

/** Entry 2: an encoded seed phrase turned back into the words. */
async function decodeAction(): Promise<Action> {
  const source = await askSource();
  if (source === undefined) return undefined;
  const run = ["decode", "--ask-secrets", ...source.options];
  // A record file names its mode; a QR code or typed codes do not, unless a whole record is typed.
  if (source.options[0] !== "--input-file") {
    const mode = await choose(
      "Was Seedshift used when it was encoded?",
      [
        { label: "No", value: "direct" },
        ...SEEDSHIFT_VARIANTS.map((variant) => ({ ...variant, note: "the dates are asked next" })),
        ...(source.typed
          ? [{ label: "It is a record", note: "it starts with MNC1 and names it", value: "" }]
          : []),
      ],
      { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
    );
    if (mode === undefined) return undefined;
    if (mode !== "") run.push("--mode", mode);
  }
  return { run };
}

/** The usual thresholds for Shamir shares; Other takes any that SSKR allows. */
const SHARE_SETS: readonly (readonly [number, number])[] = [
  [2, 3],
  [2, 4],
  [3, 4],
  [3, 5],
  [4, 6],
  [5, 7],
];

type ShareSet = readonly [threshold: number, count: number];

/**
 * How many Shamir shares, and how many of them restore the seed phrase: null for No, which Encode
 * offers first (`withNo`), undefined for back.
 */
async function askShareSet(
  question: string,
  explanation: Explanation,
  withNo: boolean,
): Promise<ShareSet | null | undefined> {
  const set = await choose<ShareSet | "other" | null>(
    question,
    [
      ...(withNo ? [{ label: "No", note: "one encoded copy, not split", value: null }] : []),
      ...SHARE_SETS.map(([threshold, count]) => ({
        label: `${threshold} of ${count}`,
        note: `${count} shares, any ${threshold} restore it`,
        value: [threshold, count] as const,
      })),
      { label: "Other", note: `type the numbers, up to ${MAX_SHARES} shares`, value: "other" },
    ],
    { label: "Shares", explanation },
  );
  return set === "other" ? askOtherShareSet() : set;
}

/** Questions for a threshold of the person's own; asked again until SSKR allows the answers. */
const SHARE_COUNT_QUESTION = `How many shares in all? (2 to ${MAX_SHARES})`;
const THRESHOLD_QUESTION = "How many of them restore the seed phrase?";

/** The typed numbers as a set of shares, or undefined when SSKR does not allow them. */
function typedShareSet(count: string, threshold: string): ShareSet | undefined {
  if (!/^\d+$/u.test(count) || !/^\d+$/u.test(threshold)) return undefined;
  const set = [Number(threshold), Number(count)] as const;
  try {
    validateThreshold(...set);
    return set;
  } catch {
    return undefined;
  }
}

async function askOtherShareSet(): Promise<ShareSet | undefined> {
  for (;;) {
    const count = await askLine(SHARE_COUNT_QUESTION, "In all");
    if (count === undefined) return undefined;
    const threshold = await askLine(THRESHOLD_QUESTION, "Restore");
    if (threshold === undefined) return undefined;
    const set = typedShareSet(count, threshold);
    if (set !== undefined) return set;
    terminalNotice(
      `Choose 2 to ${MAX_SHARES} shares, and 2 or more of them to restore it.`,
      "warning",
    );
  }
}

/**
 * The share form of each form of the seed phrase: English words give standard Bytewords, which
 * other SSKR tools read too; the other forms give MnemoCode's own shares that look alike.
 */
const SHARE_FORMAT: Readonly<Record<EncodedForm, string>> = {
  english: "words",
  indexes: "indexes",
  unicode: "unicode",
  colors: "colors",
  "colors-unicode": "colors-unicode",
};

/**
 * Where the shares go, written in `shareFormat` (--share-format). Shares in colors can be printed
 * as cards that disguise them; the others as QR codes.
 */
async function askShares(
  [threshold, count]: ShareSet,
  shareFormat: string,
): Promise<string[] | undefined> {
  const options = ["--threshold", String(threshold), "--shares", String(count)];
  options.push("--share-format", shareFormat);
  const printed: Choice<"qr" | "cards"> =
    shareFormat === "colors" || shareFormat === "colors-unicode"
      ? { label: "Also as printable cards", note: "disguised, one sheet per share", value: "cards" }
      : { label: "Also as QR codes", note: "a PDF with one QR code per share", value: "qr" };
  const destination = await choose(
    "Where should the shares go?",
    [
      { label: "Only on this screen", value: "screen" as const },
      { label: "Also in a text file", note: "one share per line", value: "file" as const },
      printed,
    ],
    { label: "Output" },
  );
  if (destination === undefined) return undefined;
  if (destination === "screen") return options;
  if (destination === "cards") {
    const cards = await askCards("mnemocode-share-cards.pdf");
    return cards === undefined ? undefined : [...options, ...cards];
  }
  const path =
    destination === "file"
      ? await askLine("Text file name", "File", "mnemocode-shares.txt")
      : await askLine("PDF file name", "File", "mnemocode-shares.pdf");
  if (path === undefined) return undefined;
  return destination === "file"
    ? [...options, "--output", path]
    : [...options, "--card-layout", "qr", "--pdf", path];
}

/**
 * Entry 3: standard Shamir shares of the seed phrase itself, in Bytewords or as a short code, as
 * other SSKR tools write and read them; restoring them gives the seed phrase in words.
 */
async function splitAction(): Promise<Action> {
  const mode = await askSeedshift("Use Seedshift before splitting?", { shares: true });
  if (mode === undefined) return undefined;
  const set = await askShareSet(
    "How many shares, and how many of them restore the seed phrase?",
    STANDARD_SHARES_EXPLANATION,
    false,
  );
  if (set === undefined || set === null) return undefined;
  const shareFormat = await choose(
    "How should each share be written?",
    [
      { label: "Words", note: "Bytewords, such as tuna next keep gyro ...", value: "words" },
      { label: "Short code", note: "ur:sskr/..., the standard short form", value: "ur" },
    ] as const,
    { label: "Shares as" },
  );
  if (shareFormat === undefined) return undefined;
  const shares = await askShares(set, shareFormat);
  if (shares === undefined) return undefined;
  const heirs = await askHeirSheet();
  if (heirs === undefined) return undefined;
  return { run: ["encode", "--sskr", "--ask-secrets", "--mode", mode, ...shares, ...heirs] };
}

/** Entry 4: the seed phrase rebuilt from typed Shamir shares. */
async function restoreAction(): Promise<Action> {
  const mode = await choose(
    "Was Seedshift used before it was split?",
    [
      { label: "No", value: "direct" },
      { label: "Yes", note: "the dates are asked after the shares", value: "seedshift" },
    ] as const,
    { label: "Seedshift" },
  );
  if (mode === undefined) return undefined;
  return {
    run: ["sskr-combine", "--ask-secrets", ...(mode === "seedshift" ? ["--mode", mode] : [])],
  };
}

/** Entry 5: a forgotten word, a forgotten digit of a date, or an unreadable code of a share. */
async function recoverAction(): Promise<Action> {
  const forgotten = await choose(
    "What is forgotten?",
    [
      { label: "A word of the seed phrase", note: "type the phrase with ? for it", value: "word" },
      {
        label: "A digit of a date",
        note: "for a seed phrase masked with Seedshift",
        value: "date",
      },
      {
        label: "A code of a Shamir share",
        note: "type the share with ? for each unreadable code",
        value: "share",
      },
    ] as const,
    { label: "Forgotten" },
  );
  if (forgotten === undefined) return undefined;
  if (forgotten === "word") return { run: ["recover-word", "--ask-secrets"] };
  // The shares come back whole, in their own form, without the seed phrase being shown.
  if (forgotten === "share") return { run: ["sskr-export", "--ask-secrets"] };
  const source = await askSource();
  if (source === undefined) return undefined;
  // A record file names its mode; otherwise the person says which Seedshift was used.
  if (source.options[0] === "--input-file")
    return { run: ["recover-date", "--ask-secrets", ...source.options] };
  const mode = await choose("Which Seedshift was used?", SEEDSHIFT_VARIANTS, {
    label: "Seedshift",
    explanation: VARIANT_EXPLANATION,
  });
  if (mode === undefined) return undefined;
  return { run: ["recover-date", "--ask-secrets", ...source.options, "--mode", mode] };
}

/** Entry 6: card designs drawn with the public test phrase. */
async function previewAction(): Promise<Action> {
  const design = await askDesign(true);
  if (design === undefined) return undefined;
  const path = await askLine("PDF file name", "File", "mnemocode-preview.pdf");
  if (path === undefined) return undefined;
  return {
    run: ["preview", ...(design === "" ? ["--all"] : ["--template", design]), "--pdf", path],
  };
}

/** Entry 7: one row of the word table, or all of it. */
async function tableAction(): Promise<Action> {
  const lookup = await choose(
    "What do you want to look up?",
    [
      { label: "A word", note: "such as abandon", value: "word" },
      { label: "A word number", note: "1 to 2048", value: "index" },
      { label: "A Unicode code", note: "four hexadecimal digits, such as 5BF6", value: "unicode" },
      { label: "The whole table", note: "all 2,048 rows", value: "all" },
    ] as const,
    { label: "Look up" },
  );
  if (lookup === undefined) return undefined;
  if (lookup === "all") return { run: ["table", "--all"] };
  const question = { word: "Word", index: "Word number", unicode: "Unicode code" }[lookup];
  const answer = await askLine(question, question);
  if (answer === undefined || answer === "") return undefined;
  return { run: ["table", `--${lookup}`, answer] };
}

interface Entry {
  readonly label: string;
  readonly digit: number;
  readonly action: () => Promise<Action>;
}

export const MENU_ENTRIES: readonly Entry[] = [
  { label: "Encode a seed phrase as numbers, codes or colors", digit: 1, action: encodeAction },
  {
    label: "Decode numbers, codes or colors back into a seed phrase",
    digit: 2,
    action: decodeAction,
  },
  { label: "Split a seed phrase into standard Shamir shares", digit: 3, action: splitAction },
  { label: "Restore a seed phrase from Shamir shares", digit: 4, action: restoreAction },
  {
    label: "Find a forgotten word, a date digit or a share code",
    digit: 5,
    action: recoverAction,
  },
  { label: "Print sample cards with a test seed phrase", digit: 6, action: previewAction },
  { label: "Look up a seed word, its number or its Unicode code", digit: 7, action: tableAction },
  {
    label: "Check that this copy of MnemoCode works",
    digit: 8,
    action: async () => ({ run: ["self-test"] }),
  },
  { label: "Show every command and option", digit: 9, action: async () => "help" },
  { label: "Quit", digit: 0, action: async () => "quit" },
];

/** The command line as it would be typed; an argument with a space or a quote is quoted. */
export function typedCommand(run: readonly string[]): string {
  const quoted = run.map((argument) =>
    /^[\w./:@%+=,-]+$/u.test(argument) ? argument : `"${argument.replaceAll('"', '\\"')}"`,
  );
  return ["mnemocode", ...quoted].join(" ");
}

const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);

/** Indent of the typed command under "The same as:". */
const COMMAND_INDENT = "  ";

export async function runMenu(): Promise<void> {
  // Each command runs in a process of its own, which gives up what it does not need; the menu
  // itself saves nothing.
  dropForMenu();
  console.error(
    `\n${paint(STYLE.heading, "MnemoCode")} ${paint(STYLE.muted, "·")} ${paint(STYLE.strong, "Offline seed phrase encoding")}\n`,
  );
  console.error("Encodes a BIP39 seed phrase as numbers, codes or colors, all offline.");
  terminalMore("menu");
  console.error(paint(STYLE.muted, "Work on a trusted computer without a network connection."));
  // The record of answers starts after a blank line; each question adds its own above it.
  console.error("");
  let selected = 0;
  for (;;) {
    const entry = await choose(
      "What do you want to do?",
      MENU_ENTRIES.map((item) => ({ label: item.label, digit: item.digit, value: item })),
      { label: "Task", initial: selected, quit: "quits" },
    );
    if (entry === undefined) return;
    selected = MENU_ENTRIES.indexOf(entry);
    const action = await entry.action();
    if (action === "quit") return;
    if (action === undefined) continue;
    if (action === "help") {
      printUsage();
    } else {
      // Shown before the command asks anything: the same answers typed after mnemocode.
      console.error(`\n${paint(STYLE.muted, "The same as:")}`);
      for (const line of wrapText(typedCommand(action.run), LINE_WIDTH - COMMAND_INDENT.length))
        console.error(`${COMMAND_INDENT}${paint(STYLE.accent, line)}`);
      // The command reports its own result, error or cancellation (Ctrl+C), then the menu goes on.
      const code = await runInOwnProcess(action.run);
      if (code === CANCELLED_EXIT_CODE) continue;
      // After the private screen the person has already read the result and pressed Enter.
      if (code === 0 && PRIVATE_SCREEN_COMMANDS.has(action.run[0]!) && privateScreenAvailable()) {
        console.error(paint(STYLE.muted, "The screen with the result was cleared."));
        continue;
      }
    }
    console.error("");
    if (!(await waitForEnter("Press Enter to return to the menu (Esc quits)."))) return;
  }
}
