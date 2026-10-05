// The menu that MnemoCode shows when it starts without arguments at a terminal, as from a
// double-click; the same idea as the menu of `mhfe` (src/bin/mhfe/menu.rs). An entry asks its
// questions as lists chosen with the arrow keys, builds the command line that does the same, shows
// it in grey and runs it exactly as if it had been typed after `mnemocode`, so that the person can
// type it later. A secret is never part of that command line: the command asks for it on its private
// screen (--ask-secrets, private-screen.ts).

import { formatEncoded, representMnemonic, type OutputFormat } from "../core.js";
import { cardTemplates } from "../export/templates.js";
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
import { readmeLink, STYLE, terminalMore, terminalPaint, wrapText } from "./terminal.js";
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
      note: "its place in the BIP39 word list, 1 to 2048",
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
  lines: ["Any chosen number of shares restores it; fewer reveal nothing."],
  more: [readmeLink("splitting-a-mnemonic-into-shares")],
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
 * Whether Seedshift is used and which; undefined means back. Shamir shares need the MnemoCode
 * variant (`withOriginal` false). English words are always masked (`required`): unmasked they would
 * be the seed phrase itself.
 */
async function askSeedshift(
  question: string,
  options: { readonly withOriginal: boolean; readonly required?: boolean },
): Promise<Mode | undefined> {
  if (options.required !== true) {
    const used = await choose(
      question,
      [
        { label: "Yes", note: "the same dates are needed to get it back", value: true },
        { label: "No", note: "anyone with MnemoCode can get it back", value: false },
      ],
      { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
    );
    if (used === undefined) return undefined;
    if (!used) return "direct";
  }
  if (!options.withOriginal) return "seedshift";
  // English words are always masked, so the general explanation comes first there.
  const explanation: Explanation =
    options.required === true
      ? {
          ...VARIANT_EXPLANATION,
          lines: [
            "English words are always masked: unmasked, they would be the seed phrase.",
            "",
            ...VARIANT_EXPLANATION.lines,
          ],
        }
      : VARIANT_EXPLANATION;
  return choose("Which Seedshift?", SEEDSHIFT_VARIANTS, { label: "Variant", explanation });
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

/** Entry 1: the seed phrase in another form, masked with Seedshift and split if wanted. */
async function encodeAction(): Promise<Action> {
  const form = await choose("Which form should the seed phrase take?", formChoices(), {
    label: "Form",
  });
  if (form === undefined) return undefined;
  const mode = await askSeedshift("Use Seedshift?", {
    withOriginal: true,
    required: form === "english",
  });
  if (mode === undefined) return undefined;
  const run = ["encode", "--ask-secrets", "--format", FORMAT_NUMBER[form], "--mode", mode];
  // The original Seedshift cannot be split into shares (mnemocode encode --help).
  const set =
    mode === "seedshift-legacy" ? null : await askShareSet("Split it into Shamir shares?");
  if (set === undefined) return undefined;
  const rest =
    set === null ? await askResultDestination(form) : await askShares(set, "--share-format");
  if (rest === undefined) return undefined;
  return { run: set === null ? [...run, ...rest] : ["encode", "--sskr", ...run.slice(1), ...rest] };
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

/** Thresholds offered for Shamir shares; any other is typed (mnemocode encode --help). */
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
 * How many shares and how many of them restore the seed phrase; null for No, which Encode offers
 * first, and undefined for back.
 */
async function askShareSet(question: string): Promise<ShareSet | null | undefined> {
  const sets: Choice<ShareSet | null>[] = SHARE_SETS.map(([threshold, count]) => ({
    label: `${threshold} of ${count}`,
    note: `${count} shares, any ${threshold} restore it`,
    value: [threshold, count],
  }));
  if (question.startsWith("Split it"))
    sets.unshift({ label: "No", note: "one result, not split", value: null });
  return choose(question, sets, { label: "Shares", explanation: SHARES_EXPLANATION });
}

/**
 * How each share is written and where the shares go. Text shares can be saved as QR codes, color
 * shares as printable cards, which print colors. `formatOption` names the share form: --share-format
 * after encode, --format after sskr-split.
 */
async function askShares(
  [threshold, count]: ShareSet,
  formatOption: "--share-format" | "--format",
): Promise<string[] | undefined> {
  const shareFormat = await choose(
    "How should each share be written?",
    [
      { label: "As text", note: "ur:sskr/..., the standard short form", value: "ur" },
      { label: "As color codes", note: "in order; not the colors of Encode", value: "colors" },
    ] as const,
    { label: "Shares as" },
  );
  if (shareFormat === undefined) return undefined;
  const options = ["--threshold", String(threshold), "--shares", String(count)];
  options.push(formatOption, shareFormat);
  const printed: Choice<"qr" | "cards"> =
    shareFormat === "ur"
      ? { label: "Also as QR codes", note: "a PDF with one QR code per share", value: "qr" }
      : {
          label: "Also as printable cards",
          note: "a PDF with one sheet per share",
          value: "cards",
        };
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

/** Entry 3: Shamir shares of the seed phrase, masked with Seedshift first if wanted. */
async function splitAction(): Promise<Action> {
  const mode = await askSeedshift("Use Seedshift before splitting?", { withOriginal: false });
  if (mode === undefined) return undefined;
  const set = await askShareSet("How many shares, and how many of them restore the seed phrase?");
  if (set === undefined || set === null) return undefined;
  const shares = await askShares(set, "--format");
  if (shares === undefined) return undefined;
  return { run: ["sskr-split", "--ask-secrets", "--mode", mode, ...shares] };
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

/** Entry 5: a forgotten word, or a forgotten digit of a date. */
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
    ] as const,
    { label: "Forgotten" },
  );
  if (forgotten === undefined) return undefined;
  if (forgotten === "word") return { run: ["recover-word", "--ask-secrets"] };
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
  {
    label: "Split a seed phrase into Shamir shares, as text or colors",
    digit: 3,
    action: splitAction,
  },
  { label: "Restore a seed phrase from Shamir shares", digit: 4, action: restoreAction },
  {
    label: "Find a forgotten word of a seed phrase or a date digit",
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
