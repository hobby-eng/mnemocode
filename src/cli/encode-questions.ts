// The questions of a new backup, as Encode asks them: its form, Seedshift, Shamir shares, where
// it goes, its cards and the sheet for heirs, each answer checked at once and recorded as the
// command line takes it. The start menu asks them for Encode and for its other entries that write
// a backup; re-encode asks them on its private screen once the phrase of the old backup is
// confirmed (owner, 2026-10-13). None of them is a secret. The questions of the cards are
// card-questions.ts, and the files and folders that the answers name output-questions.ts.

import { formatEncoded, representMnemonic, type EncodedFormat } from "../core.js";
import { listInWords } from "../core/places.js";
import {
  ALWAYS_MASKED_NOTE,
  shareFormatOf,
  ShareSetChoice,
  UNMASKED_NOTE,
} from "../core/backup-options.js";
import type { ShareFormat } from "../sskr/transport.js";
import { formatNumber } from "./input.js";
import { SEEDSHIFT_CHOICES, type OfferedSeedshift } from "./seedshift-choices.js";
import { askLine, choose, notesRoom, type Choice, type Explanation } from "./terminal-choice.js";
import { readmeLink } from "./terminal.js";
import { isColorShareFormat, shareFormatHasCards } from "../sskr/transport.js";
import { EncodedForm } from "../core/encoded-form.js";
import { Masking } from "../core/masking.js";
import { COLOR_COUNTS_TEXT } from "../core/colors.js";
import {
  HEIR_SHEET_FILE,
  heirSheetSizeLabel,
  HEIR_SHEET_SIZES,
  type HeirSheetSize,
} from "../export/heir-sheet.js";
import { askOutputFile } from "./output-questions.js";
import { askCards } from "./card-questions.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ORIGINAL_COPY_FORMS, type OriginalCopyForm } from "./encode-report.js";

/**
 * The phrase of the examples: a public BIP39 test vector (entropy 0x80 repeated). The usual test
 * phrase, abandon ... about, would show the same number and code eleven times.
 */
const EXAMPLE_PHRASE =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";

/** A form written out for the example phrase, in groups that read well. */
export function example(form: EncodedFormat): string {
  const written = formatEncoded(representMnemonic(EXAMPLE_PHRASE), form);
  // Forms written joined, as Unicode codes are, are spaced apart code by code.
  return EncodedForm.of(form).apartCodes(written)?.join(" ") ?? written;
}

/**
 * `text`, a sample of codes separated by spaces, cut after the last whole code that fits `room`
 * with " …", so that a list never cuts a code in half.
 */
export function sampleOf(text: string, room: number): string {
  if (Array.from(text).length <= room) return text;
  let sample = "";
  for (const code of text.split(" ")) {
    const longer = sample === "" ? code : `${sample} ${code}`;
    // Two characters for " …".
    if (Array.from(longer).length + 2 > room) break;
    sample = longer;
  }
  return `${sample} …`;
}

/** `choices` with each example cut to a sample that fits beside the labels (sampleOf). */
function withSamples<T>(choices: readonly Choice<T>[]): Choice<T>[] {
  const room = notesRoom(choices);
  return choices.map((choice) =>
    choice.example === undefined ? choice : { ...choice, example: sampleOf(choice.example, room) },
  );
}

/**
 * The forms in the order of the question, the first three being the usual ones, each answered by
 * its place in the list; the command shown names the form by its --format number.
 */
function formChoices(): Choice<EncodedFormat>[] {
  return withSamples([
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
      note: `color codes, ${COLOR_COUNTS_TEXT} for the whole seed phrase`,
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
  ]);
}

/** What Seedshift is, shown with the first question about it; the README explains it. */
export const SEEDSHIFT_EXPLANATION: Explanation = {
  lines: ["Masks the seed phrase with dates you remember; only they turn it back."],
  more: [readmeLink("transformation-modes")],
};

/** How the two Seedshift transformations differ, shown with the question that chooses one. */
export const VARIANT_EXPLANATION: Explanation = {
  lines: ["MnemoCode's result keeps a valid checksum; the original's usually fails it."],
  more: [readmeLink("how-checksum-valid-seedshift-works")],
};

/** What Shamir shares are, shown with the question how many to make. */
const SHARES_EXPLANATION: Explanation = {
  lines: [
    "Shares in this form; restoring gives it back.",
    "Fewer cannot restore it, but still show its length.",
  ],
  more: [readmeLink("splitting-a-mnemonic-into-shares")],
};

/** What a whole copy beside the shares means, shown with the question whether to show one. */
const COPY_EXPLANATION: Explanation = {
  lines: ["Before Seedshift; no shares or dates needed. Keep it apart from the shares."],
};

/** The labels of the original-copy forms, in the same order as their command-line values. */
const ORIGINAL_COPY_LABELS: Readonly<Record<OriginalCopyForm, string>> = {
  words: "Words only",
  codes: "Selected codes only",
  both: "Words and selected codes",
};

/** What the sheet for heirs is, shown with the question whether to make it. */
const HEIRS_EXPLANATION: Explanation = {
  lines: ["A printed page on how to restore the backup; it holds no secret."],
  more: [readmeLink("instructions-for-heirs")],
};

/** The modes that the menu offers: no Seedshift, or one of the Seedshifts it offers. */
export type Mode = "direct" | OfferedSeedshift;

/**
 * Why there is no question whether to mask a form that is always masked (alwaysMasked), shown with
 * the question which Seedshift.
 */
const ALWAYS_MASKED_EXPLANATION: Explanation = {
  lines: [ALWAYS_MASKED_NOTE, ...VARIANT_EXPLANATION.lines],
  more: VARIANT_EXPLANATION.more,
};

/**
 * Whether Seedshift is used and which; undefined means back. A form that is always masked
 * (alwaysMasked) is asked only which (`required`). Standard shares take only MnemoCode Seedshift
 * (`shares`), so there is nothing to choose between, and without it the shares themselves still
 * protect the phrase.
 */
export async function askSeedshift(
  question: string,
  options: { readonly required?: boolean; readonly shares?: boolean } = {},
): Promise<Mode | undefined | Cancelled> {
  if (options.required !== true) {
    const unmasked = options.shares === true ? "the shares alone restore it" : UNMASKED_NOTE;
    const used = await choose(
      question,
      [
        { label: "Yes", note: "the same dates are needed to get it back", value: true },
        { label: "No", note: unmasked, value: false },
      ],
      { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
    );
    if (used === undefined || used === CANCELLED) return used;
    if (!used) return "direct";
  }
  if (options.shares === true) return "seedshift";
  return choose("Which Seedshift?", SEEDSHIFT_CHOICES, {
    label: "Variant",
    explanation: options.required === true ? ALWAYS_MASKED_EXPLANATION : VARIANT_EXPLANATION,
  });
}

/**
 * The answer of a question where a result goes that takes every place it offers, `places`, as
 * well as the screen (owner, 2026-10-13): the result is shown there in any case.
 */
function everyPlace(places: readonly string[]): Choice<"all"> {
  return { label: "All of these", note: listInWords(["the screen", ...places]), value: "all" };
}

/**
 * The options of each answer in turn, asked one after another, or undefined when the person goes
 * back from one of them.
 */
async function eachAsked(
  asks: readonly (() => Promise<string[] | undefined | Cancelled>)[],
): Promise<string[] | undefined | Cancelled> {
  const options: string[] = [];
  for (const ask of asks) {
    const asked = await ask();
    if (asked === undefined || asked === CANCELLED) return asked;
    options.push(...asked);
  }
  return options;
}

/** The record file of a result: --output and its name. */
async function askRecordFile(): Promise<string[] | undefined | Cancelled> {
  const path = await askOutputFile("Record file name", RECORD_FILE);
  if (path === undefined || path === CANCELLED) return path;
  return ["--output", path];
}

/** The QR code image of a result: --qr and its name. */
async function askQrFile(): Promise<string[] | undefined | Cancelled> {
  const path = await askOutputFile("QR code file name", QR_FILE);
  if (path === undefined || path === CANCELLED) return path;
  return ["--qr", path];
}

/**
 * Where an encoded result goes besides the screen: one place, or all of them. Cards print colors
 * or Unicode codes, so they are offered only for a result written in a form with cards
 * (cardKindOf).
 */
async function askResultDestination(
  form: EncodedFormat,
): Promise<string[] | undefined | Cancelled> {
  const withCards = EncodedForm.of(form).cardKind !== undefined;
  const choices: Choice<"screen" | "record" | "qr" | "cards" | "all">[] = [
    { label: "Only on this screen", value: "screen" },
    { label: "Also in a record file", note: "text that Decode reads back", value: "record" },
    { label: "Also as a QR code image", note: "a PNG file that Decode reads back", value: "qr" },
  ];
  if (withCards)
    choices.push({
      label: "Also as printable cards",
      note: "a PDF or images in a card design",
      value: "cards",
    });
  choices.push(everyPlace(["a record file", "a QR code", ...(withCards ? ["cards"] : [])]));
  const destination = await choose("Where should the result go?", choices, { label: "Output" });
  if (destination === undefined || destination === CANCELLED) return destination;
  const cards = () => askCards("mnemocode-cards", false);
  // The questions of each answer: none for the screen, all of them for All of these.
  const asks = {
    screen: [],
    record: [askRecordFile],
    qr: [askQrFile],
    cards: [cards],
    all: [askRecordFile, askQrFile, ...(withCards ? [cards] : [])],
  }[destination];
  return eachAsked(asks);
}

/** The file that Encode saves a record in by default, and that Decode reads by default. */
export const RECORD_FILE = "mnemocode-record.txt";

/** The QR code image that Encode saves by default, and that Decode reads by default. */
export const QR_FILE = "mnemocode-qr.png";

/**
 * The questions of a new backup, as Encode asks them: its form, Seedshift, Shamir shares, where
 * it goes and the sheet for heirs; Encode's command line, or undefined for back. The shares are
 * written in the same form, so that whatever is chosen looks alike.
 */
export async function askEncoding(): Promise<string[] | undefined | Cancelled> {
  const form = await choose("Which form should the seed phrase take?", formChoices(), {
    label: "Form",
  });
  if (form === undefined || form === CANCELLED) return form;
  const mode = await askSeedshift("Use Seedshift?", {
    required: EncodedForm.of(form).alwaysMasked,
  });
  if (mode === undefined || mode === CANCELLED) return mode;
  // The Original Seedshift cannot be split into shares (mnemocode encode --help).
  const set = Masking.of(mode).capabilities.split
    ? await askShareSet("Split it into Shamir shares?", SHARES_EXPLANATION, true)
    : null;
  if (set === undefined || set === CANCELLED) return set;
  const run =
    set === null ? await askCopyDestination(form, mode) : await askSharesRun(set, form, mode);
  if (run === undefined || run === CANCELLED) return run;
  if (mode !== "direct" && (set !== null || form !== "english")) {
    const showWords = await choose(
      "Also show the Seedshift phrase as English words?",
      [
        { label: "No", note: "keep only the codes or shares", value: false },
        { label: "Yes", note: "the masked phrase; the dates are still needed", value: true },
      ],
      { label: "Decoy words" },
    );
    if (showWords === undefined || showWords === CANCELLED) return showWords;
    if (showWords) run.push("--show-masked-words");
  }
  const heirs = await askHeirSheet(mode);
  if (heirs === undefined || heirs === CANCELLED) return heirs;
  return [...run, ...heirs];
}

/** One copy in the chosen form, and where it goes. */
async function askCopyDestination(
  form: EncodedFormat,
  mode: Mode,
): Promise<string[] | undefined | Cancelled> {
  const destination = await askResultDestination(form);
  if (destination === undefined || destination === CANCELLED) return destination;
  return [
    "encode",
    "--ask-secrets",
    "--format",
    String(formatNumber(form)),
    "--mode",
    mode,
    ...destination,
  ];
}

/**
 * Shares in the chosen form, where they go, and which forms of the original wallet phrase to
 * show beside them (--show-original), if any.
 */
async function askSharesRun(
  set: ShareSetChoice,
  form: EncodedFormat,
  mode: Mode,
): Promise<string[] | undefined | Cancelled> {
  const shares = await askShares(set, shareFormatOf(form));
  if (shares === undefined || shares === CANCELLED) return shares;
  const copy = await choose<OriginalCopyForm | null>(
    "Also show the original seed phrase, before Seedshift?",
    [
      { label: "No", note: "only the shares", value: null },
      ...ORIGINAL_COPY_FORMS.map((value) => ({ label: ORIGINAL_COPY_LABELS[value], value })),
    ],
    { label: "Copy", explanation: COPY_EXPLANATION },
  );
  if (copy === undefined || copy === CANCELLED) return copy;
  return [
    "encode",
    "--sskr",
    "--ask-secrets",
    "--mode",
    mode,
    ...shares,
    ...(copy === null
      ? []
      : [
          "--show-original",
          copy,
          ...(copy === "words" ? [] : ["--format", String(formatNumber(form))]),
        ]),
  ];
}

/** What each size of the sheet for heirs is like, as the menu offers it. */
const HEIR_SHEET_NOTES: Readonly<Record<HeirSheetSize, string>> = {
  a5: `notebook size, ${heirSheetSizeLabel("a5")}, larger print`,
  a6: `postcard size, ${heirSheetSizeLabel("a6")}, small print`,
};

/**
 * The optional sheet that tells heirs how to restore the backup (README, Instructions for heirs),
 * where a backup made in `mode` can have one.
 */
export async function askHeirSheet(mode: Mode): Promise<string[] | undefined | Cancelled> {
  if (!Masking.of(mode).capabilities.heirSheet) return [];
  const size = await choose(
    "Instructions for your heirs?",
    [
      { label: "No", value: "" as const },
      ...HEIR_SHEET_SIZES.map((size) => ({
        label: `Yes, ${size.toUpperCase()}`,
        note: HEIR_SHEET_NOTES[size],
        value: size,
      })),
    ],
    { label: "Heirs", explanation: HEIRS_EXPLANATION },
  );
  if (size === undefined || size === CANCELLED) return size;
  if (size === "") return [];
  const path = await askOutputFile("PDF file name", HEIR_SHEET_FILE);
  if (path === undefined || path === CANCELLED) return path;
  return ["--heir-sheet", path, "--heir-sheet-size", size];
}

/**
 * How many Shamir shares, and how many of them restore the seed phrase: one of the usual sets, or
 * Other, which takes any that SSKR allows; null for No, which Encode offers first (`withNo`),
 * undefined for back.
 */
export async function askShareSet(
  question: string,
  explanation: Explanation,
  withNo: boolean,
): Promise<ShareSetChoice | null | undefined | Cancelled> {
  const set = await choose<ShareSetChoice | "other" | null>(
    question,
    [
      ...(withNo ? [{ label: "No", note: "one encoded copy, not split", value: null }] : []),
      ...ShareSetChoice.PRESETS.map((preset) => ({
        label: preset.label,
        note: preset.note,
        value: preset,
      })),
      { label: "Other", note: ShareSetChoice.OTHER_NOTE, value: "other" },
    ],
    { label: "Shares", explanation },
  );
  return set === "other" ? askOtherShareSet() : set;
}

/**
 * A threshold of the person's own: the number of shares, then how many of them restore the
 * phrase, each checked as SSKR checks it (ShareSetChoice) and asked again alone when it cannot be
 * used, so that a good first number stays. Each is recorded as the command line takes it, without
 * leading zeros.
 */
async function askOtherShareSet(): Promise<ShareSetChoice | undefined | Cancelled> {
  const { MIN_SHARES, MAX_SHARES } = ShareSetChoice;
  const count = await askLine(
    `How many shares in all? (${MIN_SHARES} to ${MAX_SHARES})`,
    "In all",
    {
      what: `a number from ${MIN_SHARES} to ${MAX_SHARES}`,
      check: (answer) => String(ShareSetChoice.typedCount(answer)),
    },
  );
  if (count === undefined || count === CANCELLED) return count;
  const threshold = await askLine("How many of them restore the seed phrase?", "Restore", {
    what: `a number from ${MIN_SHARES} to ${count}`,
    check: (answer) => String(ShareSetChoice.typedThreshold(answer, Number(count))),
  });
  if (threshold === undefined || threshold === CANCELLED) return threshold;
  return ShareSetChoice.of(Number(threshold), Number(count));
}

/**
 * Where the shares go, written in `shareFormat` (--share-format). Shares in colors or Unicode codes
 * can be printed as cards (shareFormatHasCards); the others only as text.
 */
export async function askShares(
  set: ShareSetChoice,
  shareFormat: ShareFormat,
): Promise<string[] | undefined | Cancelled> {
  const options = ["--threshold", String(set.threshold), "--shares", String(set.count)];
  options.push("--share-format", shareFormat);
  const destinations: Choice<"screen" | "file" | "cards" | "all">[] = [
    { label: "Only on this screen", value: "screen" },
    { label: "Also in a text file", note: "one share per line", value: "file" },
  ];
  // Cards print each share in its form: its colors, or its codes beside colors that only decorate.
  const withCards = shareFormatHasCards(shareFormat);
  if (withCards)
    destinations.push(
      {
        label: "Also as printable cards",
        note: isColorShareFormat(shareFormat)
          ? "disguised, one sheet per share"
          : "its codes on cards, one sheet per share",
        value: "cards",
      },
      // Without cards a text file is the one place besides the screen: nothing more to take.
      everyPlace(["a text file", "cards"]),
    );
  const destination = await choose("Where should the shares go?", destinations, {
    label: "Output",
  });
  if (destination === undefined || destination === CANCELLED) return destination;
  const file = async (): Promise<string[] | undefined | Cancelled> => {
    const path = await askOutputFile("Text file name", "mnemocode-shares.txt");
    if (path === undefined || path === CANCELLED) return path;
    return ["--output", path];
  };
  const cards = () => askCards("mnemocode-share-cards", true);
  // The questions of each answer: none for the screen, all of them for All of these.
  const asks = { screen: [], file: [file], cards: [cards], all: [file, cards] }[destination];
  const outputs = await eachAsked(asks);
  if (outputs === undefined || outputs === CANCELLED) return outputs;
  return [...options, ...outputs];
}
