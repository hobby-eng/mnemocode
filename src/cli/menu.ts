// The menu that MnemoCode shows when it starts without arguments at a terminal, as from a
// double-click; the same idea as the menu of `mhfe` (src/bin/mhfe/menu.rs). An entry asks its
// questions as lists chosen with the arrow keys, builds the command line that does the same, shows
// it in grey and runs it exactly as if it had been typed after `mnemocode`, so that the person can
// type it later. A secret is never part of that command line: the command asks for it on its
// private screen (--ask-secrets, private-screen.ts), and what is typed before that screen shows is
// not echoed on the main one (withEchoOff).
//
// The menu checks each of its own answers at once, none of which is a secret: a file name, a
// fingerprint, an address, a key or a lookup that the command would refuse is explained in one
// line and asked again, with the earlier answers kept (askLine). Nothing is read from the files,
// and the menu writes nothing (dropForMenu); the command checks everything again, since a file
// may change in between.

import type { SplitMode } from "../core/masking.js";
import { constants as fileAccess, type Stats } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathsOverlap } from "./path-within.js";
import { formatEncoded, representMnemonic, type EncodedFormat } from "../core.js";
import { UNICODE_CODE_HINT, wordTableRow } from "../core/words.js";
import {
  ALWAYS_MASKED_NOTE,
  alwaysMasked,
  capabilities,
  cardKindOf,
  shareFormatOf,
  ShareSetChoice,
  UNMASKED_NOTE,
} from "../core/backup-options.js";
import { parseRecipient } from "../core/candidate-encryption.js";
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
} from "../export/card-settings.js";
import { assertImageRenderer } from "../export/image-export.js";
import {
  DOCUMENT_FORMAT_FACTS,
  DOCUMENT_FORMATS,
  type DocumentFormat,
} from "../export/document-formats.js";
import { cardTemplates } from "../export/templates.js";
import type { ShareFormat } from "../sskr/transport.js";
import { droppedPath, askWalletEvidence, type WalletValueAsker } from "./ask.js";
import { limitName, MAX_TEXT_INPUT_BYTES } from "./bounded-read.js";
import { formatNumber } from "./input.js";
import { MAX_PNG_BYTES } from "./qr-limits.js";
import { BIP39_WORD_COUNTS, WORD_NUMBERS, type Bip39WordCount } from "../core/bip39-sizes.js";
import {
  SEEDSHIFT_CHOICES,
  ENCODED_SEEDSHIFT_QUESTION,
  SHARE_SEEDSHIFT_CHOICES,
  SHARE_SEEDSHIFT_QUESTION,
  WHICH_SEEDSHIFT_QUESTION,
  type OfferedSeedshift,
  ENCODED_SEEDSHIFT_CHOICES,
} from "./seedshift-choices.js";
import {
  MENU_ENTRY_NAMES,
  PHRASE_WORDS_QUESTION,
  phraseWordsAnswer,
  TYPED_SOURCE,
} from "./menu-entries.js";
import { PRIVATE_SCREEN_COMMANDS } from "./command-line.js";
import {
  isUnusableOutputPath,
  preflightFileDestination,
  preflightFolderDestination,
} from "./output-paths.js";
import { CANCELLED_EXIT_CODE, privateScreenAvailable } from "./private-screen.js";
import { assertProtected, dropForMenu } from "./protection.js";
import { assertCoreSelfTest } from "./self-test.js";
import {
  answerMark,
  askLine,
  choose,
  notesRoom,
  eraseAnswersSince,
  startRecord,
  waitForEnter,
  type Choice,
  type Explanation,
} from "./terminal-choice.js";
import { terminalAvailable, refusal } from "./terminal-input.js";
import {
  readmeLink,
  STYLE,
  terminalFailure,
  terminalMore,
  terminalNotice,
  terminalPaint,
} from "./terminal.js";
import { printUsage } from "./usage.js";
import { isColorShareFormat, shareFormatHasCards } from "../sskr/transport.js";
import { REPAIR_ANCHOR } from "../sskr/repair-report.js";
import { walletNeeded } from "../core/date-search.js";
import { walletExplanation } from "./date-search.js";
import { EncodedForm } from "../core/encoded-form.js";
import { WordList, type WordHints } from "../core/word-hints.js";
import { commandDisplay, typedCommand } from "./shell-command.js";
import { runCommand } from "./menu-runner.js";
import { COLOR_COUNTS_TEXT } from "../core/colors.js";
import { walletEvidenceArguments } from "./bitcoin-options.js";
import { headingLine } from "./terminal-style.js";
import {
  HEIR_SHEET_FILE,
  heirSheetSizeLabel,
  HEIR_SHEET_SIZES,
  type HeirSheetSize,
} from "../export/heir-sheet.js";
import { COPY_OPTIONS, profileOption } from "./business-options.js";
import { describeError } from "../core/refusal.js";
import { SAMPLE_FILE_BASE } from "../export/card-preview.js";

/** The menu reads keys from a terminal and draws on one; anything else gets the help instead. */
export function menuAvailable(): boolean {
  return terminalAvailable();
}

/**
 * What an entry does once its questions are answered; undefined means that the person went back.
 */
type Action = { readonly run: readonly string[] } | "help" | "quit" | undefined;

/**
 * The phrase of the examples: a public BIP39 test vector (entropy 0x80 repeated). The usual test
 * phrase, abandon ... about, would show the same number and code eleven times.
 */
const EXAMPLE_PHRASE =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";

/**
 * The room of each of the two samples beside "Type or paste it": the list's room beside its
 * longest label, "In a QR code image", 53 characters, halved, less the " · " between them.
 */
const SOURCE_SAMPLE_ROOM = 25;

/** A form written out for the example phrase, in groups that read well. */
function example(form: EncodedFormat): string {
  const written = formatEncoded(representMnemonic(EXAMPLE_PHRASE), form);
  // Forms written joined, as Unicode codes are, are spaced apart code by code.
  return EncodedForm.of(form).apartCodes(written)?.join(" ") ?? written;
}

/**
 * `text`, a sample of codes separated by spaces, cut after the last whole code that fits `room`
 * with " …", so that a list never cuts a code in half.
 */
function sampleOf(text: string, room: number): string {
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

/** The modes that the menu offers: no Seedshift, or one of the Seedshifts it offers. */
type Mode = "direct" | OfferedSeedshift;

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
async function askSeedshift(
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

/** `action` with no file of an earlier entry claimed. */
function askedAfresh(action: () => Promise<Action>): () => Promise<Action> {
  return () => {
    entryOutputs.reset();
    return action();
  };
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
async function inputFile(answer: string, limit: number): Promise<string> {
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
function askOutputFile(question: string, fallback: string): Promise<string | undefined> {
  return askLine(question, "File", { fallback, check: outputFile });
}

/** Asks for the name of a new folder to save into, `fallback` by default. */
function askNewFolder(fallback: string): Promise<string | undefined> {
  return askLine("Name of the new folder", "Folder", { fallback, check: newFolder });
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

/** How sheets are turned: wider or taller, or the way their cards are largest. */
type SheetTurn = CardOrientation | "larger";

const SHEET_TURNS: readonly Choice<SheetTurn>[] = [
  { label: "Landscape", note: "wider than tall", value: "landscape" },
  { label: "Portrait", note: "taller than wide", value: "portrait" },
  // Without --orientation the commands turn each sheet the way its cards are largest.
  { label: "Whichever gives larger cards", note: "chosen for each sheet", value: "larger" },
];

/** The options of how the sheets are turned (--orientation); none where their size decides. */
async function askSheetTurn(): Promise<string[] | undefined> {
  const turn = await choose("How should the sheets be turned?", SHEET_TURNS, {
    label: "Orientation",
  });
  if (turn === undefined) return undefined;
  return turn === "larger" ? [] : ["--orientation", turn];
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
async function askCardDetails(design: string, sheets: boolean): Promise<string[] | undefined> {
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
  const texts = designTexts(design, sheets).map((key) => TEXT_DETAILS[key]);
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
  const design = await askDesign(false);
  if (design === undefined) return undefined;
  const qr = files.sheets
    ? await choose(
        "Add a QR code with all the codes of the sheet?",
        [
          {
            label: "Yes",
            note: "only the codes of the sheet; also saved beside it as a PNG",
            value: true,
          },
          { label: "No", note: "the cards alone", value: false },
        ],
        { label: "QR code" },
      )
    : false;
  if (qr === undefined) return undefined;
  const details = await askCardDetails(design, files.sheets);
  if (details === undefined) return undefined;
  return ["--template", design, ...files.options, ...(qr ? ["--card-qr"] : []), ...details];
}

/**
 * Where an encoded result goes besides the screen. Cards print colors or Unicode codes, so they
 * are offered only for a result written in a form with cards (cardKindOf).
 */
async function askResultDestination(form: EncodedFormat): Promise<string[] | undefined> {
  const choices: Choice<"screen" | "record" | "qr" | "cards">[] = [
    { label: "Only on this screen", value: "screen" },
    { label: "Also in a record file", note: "text that Decode reads back", value: "record" },
    { label: "Also as a QR code image", note: "a PNG file that Decode reads back", value: "qr" },
  ];
  if (cardKindOf(form) !== undefined)
    choices.push({
      label: "Also as printable cards",
      note: "a PDF or images in a card design",
      value: "cards",
    });
  const destination = await choose("Where should the result go?", choices, { label: "Output" });
  if (destination === undefined) return undefined;
  if (destination === "screen") return [];
  if (destination === "cards") return askCards("mnemocode-cards", false);
  const path =
    destination === "record"
      ? await askOutputFile("Record file name", RECORD_FILE)
      : await askOutputFile("QR code file name", QR_FILE);
  if (path === undefined) return undefined;
  return [destination === "record" ? "--output" : "--qr", path];
}

/** The file that Encode saves a record in by default, and that Decode reads by default. */
const RECORD_FILE = "mnemocode-record.txt";
/** The QR code image that Encode saves by default, and that Decode reads by default. */
const QR_FILE = "mnemocode-qr.png";

/**
 * Entry 1: the seed phrase in another form, masked with Seedshift and split into Shamir shares if
 * wanted. The shares are written in the same form, so that whatever is chosen looks alike.
 */
async function encodeAction(): Promise<Action> {
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
  return heirs === undefined ? undefined : { run: [...run, ...heirs] };
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
async function askHeirSheet(mode: Mode): Promise<string[] | undefined> {
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
 * How many words the seed phrase has, for codes typed from printed cards, which end with codes
 * that belong to nothing (--words): null where all the codes typed are read, undefined for back.
 */
function askPhraseWords(): Promise<Bip39WordCount | null | undefined> {
  return choose<Bip39WordCount | null>(
    PHRASE_WORDS_QUESTION,
    [
      { label: "All the codes I type", note: "from paper or a record", value: null },
      ...BIP39_WORD_COUNTS.map((words) => ({
        label: phraseWordsAnswer(words),
        note: "from printed cards",
        value: words,
      })),
    ],
    { label: "Words" },
  );
}

/**
 * Where an encoded seed phrase is read from: typed on the private screen, with how many words the
 * phrase has, or a file encode saved.
 */
async function askSource(): Promise<{ readonly options: string[] } | undefined> {
  const source = await choose(
    "Where is the encoded seed phrase?",
    [
      {
        label: TYPED_SOURCE,
        note: "numbers, codes, colors or a record",
        // Half the room for each sample, less the " · " between them.
        example: `${sampleOf(example("indexes"), SOURCE_SAMPLE_ROOM)} · ${sampleOf(example("colors"), SOURCE_SAMPLE_ROOM)}`,
        value: "typed",
      },
      { label: "In a record file", note: "the text file that Encode saved", value: "record" },
      { label: "In a QR code image", note: "the PNG file that Encode saved", value: "qr" },
    ] as const,
    { label: "Source" },
  );
  if (source === undefined) return undefined;
  if (source === "typed") {
    const words = await askPhraseWords();
    if (words === undefined) return undefined;
    return { options: words === null ? [] : ["--words", String(words)] };
  }
  const path =
    source === "record"
      ? await askLine("Record file name", "File", {
          fallback: RECORD_FILE,
          check: (answer) => inputFile(answer, MAX_TEXT_INPUT_BYTES),
        })
      : await askLine("QR code file name", "File", {
          fallback: QR_FILE,
          check: (answer) => inputFile(answer, MAX_PNG_BYTES),
        });
  if (path === undefined) return undefined;
  return { options: [source === "record" ? "--input-file" : "--qr-file", path] };
}

/** Entry 2: an encoded seed phrase turned back into the words. */
async function decodeAction(): Promise<Action> {
  const source = await askSource();
  if (source === undefined) return undefined;
  const run = ["decode", "--ask-secrets", ...source.options];
  // A record file names its mode; a QR code or typed codes do not, unless a whole record is typed.
  // Every answer gives --mode, No too: decode asks itself for codes that name no mode, and a typed
  // record that names another mode is questioned there, before any date is asked.
  if (source.options[0] !== "--input-file") {
    const mode = await askEncodedMode();
    if (mode === undefined) return undefined;
    run.push("--mode", mode);
  }
  return { run };
}

/**
 * Which Seedshift masked the codes, for decode, which reads typed codes. The menu says what
 * follows rather than what each variant does: the variants are told apart where the codes are
 * read (decode), and the explanation here says what Seedshift is.
 */
function askEncodedMode(): Promise<Mode | undefined> {
  return choose(
    ENCODED_SEEDSHIFT_QUESTION,
    ENCODED_SEEDSHIFT_CHOICES.map((choice) =>
      choice.value === "direct" ? choice : { ...choice, note: "the dates are asked next" },
    ),
    { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
  );
}

/**
 * Entry 5, codes of an encoded seed phrase that cannot be read: typed with ? at their places, as
 * Decode reads them, which searches the codes the marks leave open (owner, 2026-10-13).
 */
async function markedCodesAction(): Promise<Action> {
  const words = await askPhraseWords();
  if (words === undefined) return undefined;
  const mode = await askEncodedMode();
  if (mode === undefined) return undefined;
  return {
    run: [
      "decode",
      "--ask-secrets",
      ...(words === null ? [] : ["--words", String(words)]),
      "--mode",
      mode,
    ],
  };
}

/**
 * How many Shamir shares, and how many of them restore the seed phrase: one of the usual sets, or
 * Other, which takes any that SSKR allows; null for No, which Encode offers first (`withNo`),
 * undefined for back.
 */
async function askShareSet(
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
async function askShares(
  set: ShareSetChoice,
  shareFormat: ShareFormat,
): Promise<string[] | undefined> {
  const options = ["--threshold", String(set.threshold), "--shares", String(set.count)];
  options.push("--share-format", shareFormat);
  const destinations: Choice<"screen" | "file" | "cards">[] = [
    { label: "Only on this screen", value: "screen" },
    { label: "Also in a text file", note: "one share per line", value: "file" },
  ];
  // Cards print each share in its form: its colors, or its codes beside colors that only decorate.
  if (shareFormatHasCards(shareFormat))
    destinations.push({
      label: "Also as printable cards",
      note: isColorShareFormat(shareFormat)
        ? "disguised, one sheet per share"
        : "its codes on cards, one sheet per share",
      value: "cards",
    });
  const destination = await choose("Where should the shares go?", destinations, {
    label: "Output",
  });
  if (destination === undefined) return undefined;
  if (destination === "screen") return options;
  if (destination === "cards") {
    const cards = await askCards("mnemocode-share-cards", true);
    return cards === undefined ? undefined : [...options, ...cards];
  }
  const path = await askOutputFile("Text file name", "mnemocode-shares.txt");
  return path === undefined ? undefined : [...options, "--output", path];
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
  const heirs = await askHeirSheet(mode);
  if (heirs === undefined) return undefined;
  return { run: ["encode", "--sskr", "--ask-secrets", "--mode", mode, ...shares, ...heirs] };
}

/**
 * Whether the phrase of shares was masked before it was split, as the sheet for heirs and the
 * commands of shares ask it; undefined means back. Entries 4 and 5 ask it so.
 */
function askSharesMasked(): Promise<SplitMode | undefined> {
  return choose(SHARE_SEEDSHIFT_QUESTION, SHARE_SEEDSHIFT_CHOICES, {
    label: "Seedshift",
    explanation: SEEDSHIFT_EXPLANATION,
  });
}

/** Entry 4: the seed phrase rebuilt from typed Shamir shares. */
async function restoreAction(): Promise<Action> {
  const mode = await askSharesMasked();
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
      { label: "A word of the seed phrase", note: "or several, or a missing one", value: "word" },
      {
        label: "A code of the encoded seed phrase",
        note: "typed with ? for each unread code",
        value: "code",
      },
      {
        label: "A digit of a date",
        note: "for a phrase masked with Seedshift",
        value: "date",
      },
      {
        label: "A code of a Shamir share",
        note: "the share with ? for each unread code",
        value: "share",
      },
    ] as const,
    { label: "Forgotten" },
  );
  if (forgotten === undefined) return undefined;
  if (forgotten === "word") return wordRecoveryAction();
  if (forgotten === "code") return markedCodesAction();
  // The shares come back whole, in their own form, without the seed phrase being shown.
  if (forgotten === "share") return shareRepairAction();
  const source = await askSource();
  if (source === undefined) return undefined;
  // A record file names its mode; otherwise the person says which Seedshift was used.
  const mode =
    source.options[0] === "--input-file"
      ? undefined
      : await choose(WHICH_SEEDSHIFT_QUESTION, SEEDSHIFT_CHOICES, {
          label: "Seedshift",
          explanation: VARIANT_EXPLANATION,
        });
  if (mode === undefined && source.options[0] !== "--input-file") return undefined;
  // Every date gives MnemoCode Seedshift a valid phrase, so only the wallet can tell the right one;
  // the original Seedshift's checksum sorts out most dates by itself. A record file names its own
  // mode, and recover-date asks for the wallet after reading it only when that mode needs one.
  const wallet = await askWallet(mode !== undefined && walletNeeded(mode), walletExplanation(mode));
  if (wallet === undefined) return undefined;
  return {
    run: [
      "recover-date",
      "--ask-secrets",
      ...source.options,
      ...(mode === undefined ? [] : ["--mode", mode]),
      ...wallet,
    ],
  };
}

/** Why the wallet is asked for before shares are repaired. */
const SHARE_WALLET_EXPLANATION: Explanation = {
  lines: ["Shares with many ? may fit in several ways; the wallet tells the right one."],
  more: [readmeLink(REPAIR_ANCHOR)],
};

/**
 * Entry 5, forgotten words: at their places with ?, or one missing word whose place is not known;
 * on request every candidate also goes to a list for the Discovery Scanner.
 */
async function wordRecoveryAction(): Promise<Action> {
  const where = await choose(
    "Do you know where the forgotten words were?",
    [
      { label: "Yes", note: "type ? at each place, or ab* if it began with ab", value: "places" },
      { label: "No", note: "one word is missing; type the words you have", value: "missing" },
    ] as const,
    { label: "Places" },
  );
  if (where === undefined) return undefined;
  const search = [
    "recover-word",
    "--ask-secrets",
    ...(where === "missing" ? ["--missing-word"] : []),
  ];
  const save = await choose(
    "Save the candidates for the Discovery Scanner?",
    [
      { label: "No", value: false },
      { label: "Yes", note: "an encrypted list that the Scanner checks online", value: true },
    ],
    { label: "List", explanation: CANDIDATES_EXPLANATION },
  );
  if (save === undefined) return undefined;
  if (!save) return { run: search };
  const path = await askOutputFile("File name", "candidates.age");
  if (path === undefined) return undefined;
  const protection = await choose(
    "How should the list be encrypted?",
    [
      { label: "The Scanner's key", note: "paste the age1 key the Scanner shows", value: "key" },
      {
        label: "A passphrase",
        note: "asked next; for a list made in advance",
        value: "passphrase",
      },
    ] as const,
    { label: "Protect" },
  );
  if (protection === undefined) return undefined;
  const key =
    protection === "key"
      ? await askLine("Scanner key", "Key", {
          what: "the age1 key that the Scanner shows",
          check: parseRecipient,
        })
      : "";
  if (key === undefined) return undefined;
  return {
    run: [...search, "--candidates-file", path, ...(key === "" ? [] : ["--candidates-key", key])],
  };
}

/** Why candidates are saved, shown with the question. */
const CANDIDATES_EXPLANATION: Explanation = {
  lines: ["Without the wallet's fingerprint, only a search for funds tells them apart."],
  more: [readmeLink("forgotten-word-recovery")],
};

/**
 * Entry 5, a code of a share: the wallet, if it can be told, picks among sets of shares that fit.
 * For a phrase masked before splitting, the wallet is checked after the dates.
 */
async function shareRepairAction(): Promise<Action> {
  const wallet = await askWallet(false, SHARE_WALLET_EXPLANATION);
  if (wallet === undefined) return undefined;
  if (wallet.length === 0) return { run: ["sskr-export", "--ask-secrets"] };
  const mode = await askSharesMasked();
  if (mode === undefined) return undefined;
  return {
    run: [
      "sskr-export",
      "--ask-secrets",
      ...(mode === "direct" ? [] : ["--mode", mode]),
      ...wallet,
    ],
  };
}

/**
 * What tells the right phrase among the candidates: the BIP32 master fingerprint, the same for
 * every coin of the wallet and shown by Encode, or one of the first receiving addresses of the
 * wallet, of Bitcoin or another coin, followed by among how many of them it is (Enter: 20). Each
 * is checked at once, as core/wallet-evidence.ts checks it, and becomes the command's options.
 * Without it (`required` false) every candidate is listed.
 */
async function askWallet(
  required: boolean,
  explanation: Explanation,
): Promise<string[] | undefined> {
  const answer = await askWalletEvidence({ optional: !required, explanation }, MENU_ASKER);
  if (answer.kind === "back") return undefined;
  if (answer.kind === "none") return [];
  return walletEvidenceArguments(answer.evidence);
}

/**
 * The menu's way of asking the values of the wallet question (askWalletEvidence): each on a line
 * of its own, recorded as typed, and going back leaves the entry.
 */
const MENU_ASKER: WalletValueAsker = {
  async ask(value, parse) {
    let parsed: ReturnType<typeof parse> | undefined;
    const answer = await askLine(value.prompt, value.label, {
      what: value.what,
      ...(value.fallback === undefined ? {} : { fallback: value.fallback }),
      check: (text) => {
        parsed = parse(text);
        return text;
      },
    });
    return answer === undefined ? undefined : parsed;
  },
  backLeaves: true,
};

/** Entry 6: card designs drawn with the public test phrase. */
async function previewAction(): Promise<Action> {
  const design = await askDesign(true);
  if (design === undefined) return undefined;
  const path = await askOutputFile("PDF file name", `${SAMPLE_FILE_BASE}.pdf`);
  if (path === undefined) return undefined;
  return {
    run: ["preview", ...(design === "" ? ["--all"] : ["--template", design]), "--pdf", path],
  };
}

/** A lookup of the word table: its question, and its answer checked as the table looks it up. */
interface Lookup {
  readonly question: string;
  /** Its line in the record of answers, which must fit ANSWER_LABEL_WIDTH. */
  readonly label: string;
  readonly what: string;
  readonly check: (answer: string) => string;
  /** The hints below the answer being typed, for a word. */
  readonly hints?: WordHints;
}

const LOOKUPS: Readonly<Record<"word" | "index" | "unicode", Lookup>> = {
  word: {
    question: "Word",
    label: "Word",
    what: "a word of the English BIP39 list",
    // Given as the table writes it, in lower case.
    check: (answer) => wordTableRow("word", answer).english,
    hints: WordList.BIP39,
  },
  index: {
    question: "Word number",
    label: "Number",
    what: `a number from ${WORD_NUMBERS}`,
    // Written as the command line takes it, without leading zeros.
    check: (answer) => String(wordTableRow("index", answer).index),
  },
  unicode: {
    question: "Unicode code",
    label: "Code",
    what: UNICODE_CODE_HINT,
    check: (answer) => wordTableRow("unicode", answer).unicodeHex,
  },
};

/** Entry 7: one row of the word table, or all of it. */
async function tableAction(): Promise<Action> {
  const lookup = await choose(
    "What do you want to look up?",
    [
      { label: "A word", note: "such as abandon", value: "word" },
      {
        label: "A word number",
        note: WORD_NUMBERS,
        value: "index",
      },
      { label: "A Unicode code", note: UNICODE_CODE_HINT, value: "unicode" },
      { label: "The whole table", note: "all 2,048 rows", value: "all" },
    ] as const,
    { label: "Look up" },
  );
  if (lookup === undefined) return undefined;
  if (lookup === "all") return { run: ["table", "--all"] };
  const { question, label, what, check, hints } = LOOKUPS[lookup];
  const answer = await askLine(question, label, {
    what,
    check,
    ...(hints === undefined ? {} : { hints }),
  });
  if (answer === undefined) return undefined;
  return { run: ["table", `--${lookup}`, answer] };
}

interface Entry {
  readonly label: string;
  readonly digit: number;
  readonly action: () => Promise<Action>;
  /**
   * The command asks for a seed phrase or a share, which needs a protected, self-tested process.
   */
  readonly asksSecrets?: boolean;
}

export const MENU_ENTRIES: readonly Entry[] = [
  { ...MENU_ENTRY_NAMES.encode, action: askedAfresh(encodeAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.decode, action: askedAfresh(decodeAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.split, action: askedAfresh(splitAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.restore, action: askedAfresh(restoreAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.recover, action: askedAfresh(recoverAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.preview, action: askedAfresh(previewAction) },
  { ...MENU_ENTRY_NAMES.table, action: tableAction },
  { ...MENU_ENTRY_NAMES.selfTest, action: async () => ({ run: ["self-test"] }) },
  { ...MENU_ENTRY_NAMES.help, action: async () => "help" },
  { ...MENU_ENTRY_NAMES.quit, action: async () => "quit" },
];

const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);

// The command lines as typed are shown by shell-command.ts; here too for the tests that take them
// with the menu.
export { commandDisplay, typedCommand };

/**
 * Why no command may ask for a secret here, or undefined: this process could not switch off core
 * dumps, or the core self-test failed (assertProtected, assertCoreSelfTest). Each command that
 * takes a secret checks both again before it asks anything and would stop at once, so the menu
 * checks them before its first question and does not offer such commands then.
 */
function secretsRefusal(): string | undefined {
  try {
    assertProtected();
    assertCoreSelfTest();
    return undefined;
  } catch (error) {
    return describeError(error);
  }
}

/** Said once when the entries that ask for a secret are no longer offered. */
const SECRET_ENTRIES_LEFT_OUT =
  "The entries that ask for a seed phrase or a share are not offered.";

/** The menu's heading; `refusal` says why no entry that asks for a secret is offered. */
function writeHeading(refusal: string | undefined): void {
  console.error(`\n${headingLine(process.stderr, "Offline seed phrase encoding")}\n`);
  console.error("Encodes a BIP39 seed phrase as numbers, codes or colors, all offline.");
  terminalMore("menu");
  console.error(paint(STYLE.muted, "Work on a trusted computer without a network connection."));
  if (refusal !== undefined) {
    terminalFailure(refusal);
    terminalNotice(SECRET_ENTRIES_LEFT_OUT, "warning");
  }
  // The record of answers starts after a blank line; each question adds its own above it.
  console.error("");
}

export async function runMenu(): Promise<void> {
  // Each command runs in a process of its own, which gives up what it does not need; the menu
  // itself saves nothing.
  dropForMenu();
  let refusal = secretsRefusal();
  writeHeading(refusal);
  // Drawn again, as it is then, where going back draws the whole screen anew.
  startRecord(() => writeHeading(refusal));
  let selected: Entry = MENU_ENTRIES[0]!;
  for (;;) {
    const entries =
      refusal === undefined ? MENU_ENTRIES : MENU_ENTRIES.filter((item) => !item.asksSecrets);
    const before = answerMark();
    const entry = await choose(
      "What do you want to do?",
      entries.map((item) => ({ label: item.label, digit: item.digit, value: item })),
      { label: "Task", initial: Math.max(0, entries.indexOf(selected)), quit: "quits" },
    );
    if (entry === undefined) return;
    selected = entry;
    const action = await entry.action();
    if (action === "quit") return;
    if (action === undefined) {
      // Back: the task and the answers given for it leave the record before the list returns.
      eraseAnswersSince(before);
      continue;
    }
    // What follows is written below the record, which starts again under it for the next task.
    startRecord();
    if (action === "help") {
      printUsage();
    } else {
      // Shown before the command asks anything: the same answers typed after mnemocode.
      console.error(`\n${paint(STYLE.muted, "The same as:")}`);
      console.error(paint(STYLE.accent, commandDisplay(action.run)));
      // The command reports its own result, error or cancellation (Ctrl+C), then the menu goes on.
      const code = await runCommand(action.run);
      if (code === undefined || code === CANCELLED_EXIT_CODE) continue;
      // A copy that fails its own check is not trusted with a secret either.
      if (action.run[0] === "self-test" && code !== 0 && refusal === undefined) {
        refusal = "The self-test failed.";
        terminalNotice(`${refusal} ${SECRET_ENTRIES_LEFT_OUT}`, "warning");
      }
      // After the private screen the person has already read the result and pressed Enter.
      if (code === 0 && PRIVATE_SCREEN_COMMANDS.has(action.run[0]!) && privateScreenAvailable()) {
        console.error(paint(STYLE.muted, "The screen with the result was cleared."));
        continue;
      }
    }
    console.error("");
    // Only Escape quits here, not q or the rest of a paste meant for the command.
    const back = await waitForEnter("Press Enter to return to the menu (Esc quits).", {
      onlyEscapeLeaves: true,
    });
    if (!back) return;
  }
}
