// The questions of a new backup, as Encode asks them: its form, Seedshift, Shamir shares, where
// it goes, its cards and the sheet for heirs, each answer checked at once and recorded as the
// command line takes it. The start menu asks them for Encode and for its other entries that write
// a backup; re-encode asks them on its private screen once the phrase of the old backup is
// confirmed (owner, 2026-10-13). None of them is a secret.

import { constants as fileAccess, type Stats } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathsOverlap } from "./path-within.js";
import { formatEncoded, representMnemonic, type EncodedFormat } from "../core.js";
import { listInWords } from "../core/places.js";
import {
  ALWAYS_MASKED_NOTE,
  alwaysMasked,
  capabilities,
  cardKindOf,
  shareFormatOf,
  ShareSetChoice,
  UNMASKED_NOTE,
} from "../core/backup-options.js";
import { designTexts, resolveCardPresentation } from "../export/card-copy.js";
import {
  profileFieldLabel,
  profileFields,
  validateProfile,
  pageSizeLabel,
  SEPARATE_CARD_SIZE,
  SHEET_PAGE_SIZE,
  SHEET_PAGE_SIZES,
  type SheetPageSize,
  type CardOrientation,
  type CopyField,
  type ProfileField,
  SHEET_QR_HOLDS,
} from "../export/card-settings.js";
import { SHEET_PLAN_TEXT } from "../export/collection-sheet.js";
import { assertImageRenderer } from "../export/image-export.js";
import {
  DOCUMENT_FORMAT_FACTS,
  DOCUMENT_FORMATS,
  type DocumentFormat,
} from "../export/document-formats.js";
import { cardTemplates } from "../export/templates.js";
import type { ShareFormat } from "../sskr/transport.js";
import { droppedPath } from "./ask.js";
import { limitName } from "../core/byte-units.js";
import { formatNumber } from "./input.js";
import { SEEDSHIFT_CHOICES, type OfferedSeedshift } from "./seedshift-choices.js";
import {
  isUnusableOutputPath,
  preflightFileDestination,
  preflightFolderDestination,
} from "./output-paths.js";
import { askLine, choose, notesRoom, type Choice, type Explanation } from "./terminal-choice.js";
import { refusal } from "./terminal-input.js";
import { readmeLink } from "./terminal.js";
import { isColorShareFormat, shareFormatHasCards } from "../sskr/transport.js";
import { EncodedForm } from "../core/encoded-form.js";
import { COLOR_COUNTS_TEXT } from "../core/colors.js";
import {
  HEIR_SHEET_FILE,
  heirSheetSizeLabel,
  HEIR_SHEET_SIZES,
  type HeirSheetSize,
} from "../export/heir-sheet.js";
import { COPY_OPTIONS, profileOption } from "./business-options.js";

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
  if ([...text].length <= room) return text;
  let sample = "";
  for (const code of text.split(" ")) {
    const longer = sample === "" ? code : `${sample} ${code}`;
    // Two characters for " …".
    if ([...longer].length + 2 > room) break;
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
  lines: ["Shares in this form; restoring gives it back. Fewer reveal nothing."],
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
): Promise<Mode | undefined> {
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
    if (used === undefined) return undefined;
    if (!used) return "direct";
  }
  if (options.shares === true) return "seedshift";
  return choose("Which Seedshift?", SEEDSHIFT_CHOICES, {
    label: "Variant",
    explanation: options.required === true ? ALWAYS_MASKED_EXPLANATION : VARIANT_EXPLANATION,
  });
}

/**
 * The files and folders that the answers of the entry being asked name for saving, as absolute
 * paths, so that a second output of the same entry cannot take the place of a first. Every entry
 * starts with none (askedAfresh).
 */
class ClaimedOutputs {
  readonly #paths: string[] = [];

  /** Forgets the outputs of an earlier entry. */
  reset(): void {
    this.#paths.length = 0;
  }

  /**
   * Refuses `path` when it is the place of an earlier output, lies in it or holds it: the command
   * would refuse the pair (validateOutputPaths), and a name taken by both would be numbered to the
   * same free name. Checked first, as it says the most; an answer that passes every check is then
   * claimed.
   */
  assertFree(path: string): void {
    const absolute = resolve(path);
    if (this.#paths.some((earlier) => pathsOverlap(earlier, absolute)))
      throw new Error(
        "Another file of this task has this name or this folder; choose another one.",
      );
  }

  claim(path: string): void {
    this.#paths.push(resolve(path));
  }
}

const entryOutputs = new ClaimedOutputs();

/** Forgets the files that an earlier entry, or an earlier backup, claimed. */
export function forgetClaimedOutputs(): void {
  entryOutputs.reset();
}

/**
 * A typed file or folder name as the file system knows it: without the quotes or backslashes that
 * a terminal adds to a dropped file, and with a leading ~ as the home folder (droppedPath). A name
 * that the command line would read as something else is refused: - stands for standard input or
 * output there, and a name that starts with - for an option, -h or --help even for the help. So is
 * a blank one, such as '' or " ", which is all that is left of a quoted name of spaces: the command
 * refuses it, and as a path it would be the current folder. Every such question has a fallback.
 */
function typedPath(answer: string): string {
  const path = droppedPath(answer);
  // The command's rule for a name that is no path (isUnusableOutputPath), in the menu's words.
  if (isUnusableOutputPath(path))
    throw new Error(
      path === "-"
        ? "- is no file name here; type the name of a file."
        : "That name is blank; type a name, or press Enter alone for the one shown.",
    );
  if (path.startsWith("-"))
    throw new Error("A name that starts with - would be read as an option; type ./ before it.");
  return path;
}

/**
 * A file to save, checked as the command checks it before it asks anything
 * (preflightFileDestination, which only looks): its folder exists and may be written, and the name
 * is no folder. A file of that name may exist: the command saves under the next numbered name.
 */
async function outputFile(answer: string): Promise<string> {
  const path = typedPath(answer);
  entryOutputs.assertFree(path);
  await preflightFileDestination(path, true);
  entryOutputs.claim(path);
  return path;
}

/**
 * A new folder to save into, such as one for the cards, checked as the command checks it
 * (preflightFolderDestination): the command makes the folders of its path that do not exist yet
 * and numbers a name that is taken.
 */
async function newFolder(answer: string): Promise<string> {
  const path = typedPath(answer);
  entryOutputs.assertFree(path);
  await preflightFolderDestination(path);
  entryOutputs.claim(path);
  return path;
}

/**
 * A file to read, checked without reading it: it exists, is a file and may be read, and it is no
 * larger than the command reads (`limit`). What is in it only the command can tell, after it has
 * read the file.
 */
export async function inputFile(answer: string, limit: number): Promise<string> {
  const path = typedPath(answer);
  let info: Stats;
  try {
    info = await stat(path);
  } catch {
    throw new Error("There is no such file; check its name and its folder.");
  }
  if (info.isDirectory()) throw new Error("That is a folder; type the name of a file in it.");
  if (!info.isFile()) throw new Error("That is no ordinary file; type the name of the file.");
  try {
    await access(path, fileAccess.R_OK);
  } catch {
    throw new Error("MnemoCode may not read that file.");
  }
  if (info.size > limit)
    throw new Error(`That file is larger than ${limitName(limit)}; it cannot be the one.`);
  return path;
}

/** Asks for the name of a file to save, `fallback` by default. */
export function askOutputFile(question: string, fallback: string): Promise<string | undefined> {
  return askLine(question, "File", { fallback, check: outputFile });
}

/** Asks for the name of a new folder to save into, `fallback` by default. */
function askNewFolder(fallback: string): Promise<string | undefined> {
  return askLine("Name of the new folder", "Folder", { fallback, check: newFolder });
}

/**
 * Which design, with Every design first where `withEveryDesign`; for separate cards
 * (`separateCards`) only the designs that draw them, the business cards (drawsSeparateCards).
 */
export async function askDesign(
  withEveryDesign: boolean,
  separateCards = false,
): Promise<string | undefined> {
  const designs: Choice<string>[] = cardTemplates
    .filter((template) => !separateCards || template.renderIndividual !== undefined)
    .map((template) => ({ label: template.name, note: template.id, value: template.id }));
  if (withEveryDesign)
    designs.unshift({ label: "Every design", note: "all in one PDF", value: "" });
  return choose("Which card design?", designs, { label: "Design" });
}

/** How the cards are laid out: on sheets of one size, or as separate business cards. */
type CardLayout = SheetPageSize | "separate";

const CARD_LAYOUTS: readonly Choice<CardLayout>[] = [
  ...SHEET_PAGE_SIZES.map((size) => ({
    label: `${size.toUpperCase()} sheets`,
    // The commands take this size when none is given.
    note:
      size === SHEET_PAGE_SIZE ? `${pageSizeLabel(size)}, the usual choice` : pageSizeLabel(size),
    value: size,
  })),
  {
    label: "Separate business cards",
    note: `${pageSizeLabel(SEPARATE_CARD_SIZE)}, one file each`,
    value: "separate",
  },
];

/** How sheets are turned: wider or taller, or the way that fills each sheet best. */
type SheetTurn = CardOrientation | "best";

const SHEET_TURNS: readonly Choice<SheetTurn>[] = [
  { label: "Landscape", note: "wider than tall", value: "landscape" },
  { label: "Portrait", note: "taller than wide", value: "portrait" },
  // Without --orientation the commands turn each sheet as planCollectionSheet chooses.
  { label: "Whichever fills the sheet best", note: SHEET_PLAN_TEXT, value: "best" },
];

/** The options of how the sheets are turned (--orientation); none where their size decides. */
async function askSheetTurn(): Promise<string[] | undefined> {
  const turn = await choose("How should the sheets be turned?", SHEET_TURNS, {
    label: "Orientation",
  });
  if (turn === undefined) return undefined;
  return turn === "best" ? [] : ["--orientation", turn];
}

/**
 * The options of the chosen way of saving, and whether it gives sheets, which may get a QR code.
 */
interface CardFiles {
  readonly options: readonly string[];
  readonly sheets: boolean;
}

/** Why PNG and JPEG are refused at once where pdftocairo cannot be run; undefined where it can. */
async function missingImageRenderer(): Promise<string | undefined> {
  try {
    await assertImageRenderer();
    return undefined;
  } catch (error) {
    // The renderer's own refusal, as the command says it.
    return refusal(error);
  }
}

/**
 * How the cards are saved, in files named after `base`: first the kind of file, then the layout,
 * each a question of its own. Sheets in a PDF go into one file; separate business cards (for
 * shares --card-layout individual, as the page size alone does not make them) and images go into a
 * new folder (--cards-dir, --images-dir). Images need pdftocairo, which is checked as soon as one
 * is chosen.
 */
async function askCardFiles(base: string, shares: boolean): Promise<CardFiles | undefined> {
  const kind = await askCardFileKind();
  if (kind === undefined) return undefined;
  const layout = await choose("How should the cards be laid out?", CARD_LAYOUTS, {
    label: "Layout",
  });
  if (layout === undefined) return undefined;
  // The page size that the commands take when none is given is left out of the command.
  const pageSize =
    layout === "separate" || layout === SHEET_PAGE_SIZE ? [] : ["--page-size", layout];
  const image = kind === "pdf" ? [] : ["--image-format", kind];
  if (layout === "separate") {
    const folder = await askNewFolder(base);
    if (folder === undefined) return undefined;
    return {
      sheets: false,
      options: [
        "--cards-dir",
        folder,
        ...(shares ? ["--card-layout", "individual"] : []),
        ...image,
      ],
    };
  }
  // Sheets only: a separate card has the shape of a business card.
  const turn = await askSheetTurn();
  if (turn === undefined) return undefined;
  const size = [...pageSize, ...turn];
  if (kind === "pdf") {
    const path = await askOutputFile("PDF file name", `${base}.pdf`);
    return path === undefined ? undefined : { sheets: true, options: ["--pdf", path, ...size] };
  }
  const folder = await askNewFolder(`${base}-images`);
  if (folder === undefined) return undefined;
  return { sheets: true, options: ["--images-dir", folder, ...image, ...size] };
}

/**
 * The kind of file that printable cards are saved in: a PDF, or an image, which needs pdftocairo.
 */
async function askCardFileKind(): Promise<DocumentFormat | undefined> {
  let warning: string | undefined;
  for (;;) {
    const kind = await choose(
      "Which kind of file?",
      [
        ...DOCUMENT_FORMATS.map((format) => {
          const { name, note } = DOCUMENT_FORMAT_FACTS[format];
          // Images are drawn from the PDF with pdftocairo, which the menu checks for below.
          return {
            label: name,
            note: format === "pdf" ? note : `${note}; needs pdftocairo`,
            value: format,
          };
        }),
      ],
      { label: "Files", warning },
    );
    if (kind === undefined || kind === "pdf") return kind;
    warning = await missingImageRenderer();
    if (warning === undefined) return kind;
  }
}

/** What the details on the cards are, shown with the question whether to type them. */
const DETAILS_EXPLANATION: Explanation = {
  lines: ["A decoy that makes the cards look ordinary; no secret, shown in the command."],
  more: [readmeLink("cards-and-qr-codes")],
};

/** A detail printed on the cards, its option and how its answer is checked. */
interface CardDetail {
  readonly option: string;
  readonly question: string;
  readonly label: string;
  readonly check: (answer: string) => string;
}

/** A detail's answer that the command line would read as an option: -h, --help or --name. */
function refuseOptionLike(answer: string): void {
  if (answer.startsWith("-"))
    throw new Error("A detail that starts with - would be read as an option; leave out the -.");
}

/** The question for each detail of the person on the cards (--card-<field>). */
const PERSON_QUESTIONS: Readonly<Record<ProfileField, string>> = {
  name: "Name, in Latin letters",
  role: "Role",
  company: "Company",
  email: "Email",
  phone: "Phone",
  website: "Website",
  location: "Location",
};

/** The details of the person, which every design may print, checked as the command checks them. */
const PERSON_DETAILS: readonly CardDetail[] = profileFields.map((field) => ({
  option: profileOption(field),
  question: PERSON_QUESTIONS[field],
  label: profileFieldLabel(field),
  check: (answer) => {
    refuseOptionLike(answer);
    return validateProfile({ [field]: answer })[field]!;
  },
}));

/** Text printed around the cards, which "-" leaves off, checked as resolveCardPresentation does. */
function textDetail(key: CopyField, question: string, label: string): CardDetail {
  return {
    option: COPY_OPTIONS[key],
    question,
    label,
    check: (answer) => {
      if (answer === "-") return answer;
      refuseOptionLike(answer);
      // The fixed choice stands for the random pick of the other texts, which are not used here.
      resolveCardPresentation(() => 0, { [key]: answer });
      return answer;
    },
  };
}

/** The question of each text around the cards, in the order that designTexts names them. */
const TEXT_DETAILS: Readonly<Record<CopyField, CardDetail>> = {
  studioName: textDetail("studioName", "Studio name", "Studio"),
  slogan: textDetail("slogan", "Slogan", "Slogan"),
  subtitle: textDetail("subtitle", "Subtitle", "Subtitle"),
  footer: textDetail("footer", "Footer", "Footer"),
  referenceLabel: textDetail("referenceLabel", "Label before each code", "Reference"),
};

/**
 * The details on the cards: random, as the commands invent them, or typed one by one, where Enter
 * keeps a detail random. They are a decoy, no secret, and go on the command line.
 */
async function askCardDetails(sheets: boolean): Promise<string[] | undefined> {
  const own = await choose(
    "Type your own details for the cards?",
    [
      { label: "No, random", note: "invented names and contacts", value: false },
      { label: "Yes", note: "Enter on a detail keeps it random", value: true },
    ],
    { label: "Details", explanation: DETAILS_EXPLANATION },
  );
  if (own === undefined) return undefined;
  if (!own) return [];
  const options: string[] = [];
  const texts = designTexts(sheets).map((key) => TEXT_DETAILS[key]);
  for (const detail of [...PERSON_DETAILS, ...texts]) {
    const answer = await askLine(detail.question, detail.label, {
      optional: "random",
      check: detail.check,
    });
    if (answer === undefined) return undefined;
    if (answer !== "") options.push(`--${detail.option}`, answer);
  }
  return options;
}

/**
 * Printable cards, after "Also as printable cards": how the cards are saved in files named after
 * `base` (the kind of file, then the layout), the design, a QR code on each sheet, and the details
 * on them. Separate business cards
 * never carry a QR code. `shares`: the cards of Shamir shares, one set per share.
 */
async function askCards(base: string, shares: boolean): Promise<string[] | undefined> {
  // How the cards are saved comes first, then their design.
  const files = await askCardFiles(base, shares);
  if (files === undefined) return undefined;
  const design = await askDesign(false, !files.sheets);
  if (design === undefined) return undefined;
  const qr = files.sheets
    ? await choose(
        `Add a QR code with ${SHEET_QR_HOLDS}?`,
        [
          {
            label: "Yes",
            note: "also saved as a PNG image",
            value: true,
          },
          { label: "No", note: "the cards alone", value: false },
        ],
        { label: "QR code" },
      )
    : false;
  if (qr === undefined) return undefined;
  const details = await askCardDetails(files.sheets);
  if (details === undefined) return undefined;
  return ["--template", design, ...files.options, ...(qr ? ["--card-qr"] : []), ...details];
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
  asks: readonly (() => Promise<string[] | undefined>)[],
): Promise<string[] | undefined> {
  const options: string[] = [];
  for (const ask of asks) {
    const asked = await ask();
    if (asked === undefined) return undefined;
    options.push(...asked);
  }
  return options;
}

/** The record file of a result: --output and its name. */
async function askRecordFile(): Promise<string[] | undefined> {
  const path = await askOutputFile("Record file name", RECORD_FILE);
  return path === undefined ? undefined : ["--output", path];
}

/** The QR code image of a result: --qr and its name. */
async function askQrFile(): Promise<string[] | undefined> {
  const path = await askOutputFile("QR code file name", QR_FILE);
  return path === undefined ? undefined : ["--qr", path];
}

/**
 * Where an encoded result goes besides the screen: one place, or all of them. Cards print colors
 * or Unicode codes, so they are offered only for a result written in a form with cards
 * (cardKindOf).
 */
async function askResultDestination(form: EncodedFormat): Promise<string[] | undefined> {
  const withCards = cardKindOf(form) !== undefined;
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
  if (destination === undefined) return undefined;
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
export async function askEncoding(): Promise<string[] | undefined> {
  const form = await choose("Which form should the seed phrase take?", formChoices(), {
    label: "Form",
  });
  if (form === undefined) return undefined;
  const mode = await askSeedshift("Use Seedshift?", { required: alwaysMasked(form) });
  if (mode === undefined) return undefined;
  // The Original Seedshift cannot be split into shares (mnemocode encode --help).
  const set = capabilities(mode).split
    ? await askShareSet("Split it into Shamir shares?", SHARES_EXPLANATION, true)
    : null;
  if (set === undefined) return undefined;
  const run =
    set === null ? await askCopyDestination(form, mode) : await askSharesRun(set, form, mode);
  if (run === undefined) return undefined;
  const heirs = await askHeirSheet(mode);
  return heirs === undefined ? undefined : [...run, ...heirs];
}

/** One copy in the chosen form, and where it goes. */
async function askCopyDestination(form: EncodedFormat, mode: Mode): Promise<string[] | undefined> {
  const destination = await askResultDestination(form);
  if (destination === undefined) return undefined;
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
 * Shares in the chosen form, where they go, and whether the whole seed phrase is shown beside
 * them (--format), for a person who keeps it and holds the shares in reserve.
 */
async function askSharesRun(
  set: ShareSetChoice,
  form: EncodedFormat,
  mode: Mode,
): Promise<string[] | undefined> {
  const shares = await askShares(set, shareFormatOf(form));
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
    ...(copy ? ["--format", String(formatNumber(form))] : []),
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
export async function askHeirSheet(mode: Mode): Promise<string[] | undefined> {
  if (!capabilities(mode).heirSheet) return [];
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
  if (size === undefined) return undefined;
  if (size === "") return [];
  const path = await askOutputFile("PDF file name", HEIR_SHEET_FILE);
  return path === undefined ? undefined : ["--heir-sheet", path, "--heir-sheet-size", size];
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
): Promise<ShareSetChoice | null | undefined> {
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
async function askOtherShareSet(): Promise<ShareSetChoice | undefined> {
  const { MIN_SHARES, MAX_SHARES } = ShareSetChoice;
  const count = await askLine(
    `How many shares in all? (${MIN_SHARES} to ${MAX_SHARES})`,
    "In all",
    {
      what: `a number from ${MIN_SHARES} to ${MAX_SHARES}`,
      check: (answer) => String(ShareSetChoice.typedCount(answer)),
    },
  );
  if (count === undefined) return undefined;
  const threshold = await askLine("How many of them restore the seed phrase?", "Restore", {
    what: `a number from ${MIN_SHARES} to ${count}`,
    check: (answer) => String(ShareSetChoice.typedThreshold(answer, Number(count))),
  });
  if (threshold === undefined) return undefined;
  return ShareSetChoice.of(Number(threshold), Number(count));
}

/**
 * Where the shares go, written in `shareFormat` (--share-format). Shares in colors or Unicode codes
 * can be printed as cards (shareFormatHasCards); the others only as text.
 */
export async function askShares(
  set: ShareSetChoice,
  shareFormat: ShareFormat,
): Promise<string[] | undefined> {
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
  if (destination === undefined) return undefined;
  const file = async (): Promise<string[] | undefined> => {
    const path = await askOutputFile("Text file name", "mnemocode-shares.txt");
    return path === undefined ? undefined : ["--output", path];
  };
  const cards = () => askCards("mnemocode-share-cards", true);
  // The questions of each answer: none for the screen, all of them for All of these.
  const asks = { screen: [], file: [file], cards: [cards], all: [file, cards] }[destination];
  const outputs = await eachAsked(asks);
  return outputs === undefined ? undefined : [...options, ...outputs];
}
