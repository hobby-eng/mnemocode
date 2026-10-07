// The menu that MnemoCode shows when it starts without arguments at a terminal, as from a
// double-click; the same idea as the menu of `mhfe` (src/bin/mhfe/menu.rs). An entry asks its
// questions as lists chosen with the arrow keys, builds the command line that does the same, shows
// it in grey and runs it exactly as if it had been typed after `mnemocode`, so that the person can
// type it later. A secret is never part of that command line: the command asks for it on its private
// screen (--ask-secrets, private-screen.ts), and what is typed before that screen shows is not
// echoed on the main one (withEchoOff).
//
// The menu checks each of its own answers at once, none of which is a secret: a file name, a
// fingerprint, an address, a key or a lookup that the command would refuse is explained in one
// line and asked again, with the earlier answers kept (askLine). Nothing is read from the files,
// and the menu writes nothing (dropForMenu); the command checks everything again, since a file
// may change in between.

import { spawnSync } from "node:child_process";
import { constants as fileAccess, type Stats } from "node:fs";
import { access, stat } from "node:fs/promises";
import { constants as systemConstants } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_ADDRESS_COUNT,
  parseBitcoinAddress,
  parseCoinAddress,
  parseMasterFingerprint,
} from "../bitcoin-evidence.js";
import { allMappingRows, formatEncoded, representMnemonic, type OutputFormat } from "../core.js";
import {
  ALWAYS_MASKED_NOTE,
  alwaysMasked,
  capabilities,
  shareFormatOf,
  ShareSetChoice,
  UNMASKED_NOTE,
} from "../core/backup-options.js";
import { parseRecipient } from "../core/candidate-encryption.js";
import {
  designTexts,
  resolveCardPresentation,
  type CardCopyOverrides,
} from "../export/card-copy.js";
import { profileFields, validateProfile } from "../export/card-settings.js";
import { assertImageRenderer, type ImageFormat } from "../export/image-export.js";
import { cardTemplates } from "../export/templates.js";
import type { ShareFormat } from "../sskr/transport.js";
import { droppedPath, OTHER_COINS, OTHER_COINS_NOTE, parseAddressCount } from "./ask.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { PRIVATE_SCREEN_COMMANDS } from "./command-line.js";
import { preflightFileDestination } from "./output-paths.js";
import { CANCELLED_EXIT_CODE, privateScreenAvailable } from "./private-screen.js";
import { assertProtected, dropForMenu, runInOwnProcess } from "./protection.js";
import { assertCoreSelfTest } from "./self-test.js";
import {
  answerMark,
  askLine,
  choose as chooseNow,
  notesRoom,
  eraseAnswersSince,
  startRecord,
  waitForEnter,
  type Choice,
  type ChooseOptions,
  type Explanation,
} from "./terminal-choice.js";
import { dropTypedAhead, InputCancelled, terminalAvailable } from "./terminal-input.js";
import {
  readmeLink,
  STYLE,
  terminalFailure,
  terminalMore,
  terminalNotice,
  terminalPaint,
} from "./terminal.js";
import { printUsage } from "./usage.js";

/** The menu reads keys from a terminal and draws on one; anything else gets the help instead. */
export function menuAvailable(): boolean {
  return terminalAvailable();
}

/**
 * Asks as terminal-choice's choose does, once what was typed or pasted before the question showed
 * is dropped and wiped (dropTypedAhead): the rest of a paste would otherwise choose entries, its q
 * would go back, and its bytes would stay in the menu's memory.
 */
async function choose<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: ChooseOptions,
): Promise<T | undefined> {
  await dropTypedAhead();
  return chooseNow(question, choices, options);
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

/**
 * The room of each of the two samples beside "Type or paste it": the list's room beside its
 * longest label, "In a QR code image", 53 characters, halved, less the " · " between them.
 */
const SOURCE_SAMPLE_ROOM = 25;

/** A form written out for the example phrase, in groups that read well. */
function example(form: EncodedForm): string {
  const written = formatEncoded(representMnemonic(EXAMPLE_PHRASE), form);
  // Unicode codes have four digits and colours as text eight; both are written joined.
  if (form === "unicode") return written.match(/.{4}/gu)!.join(" ");
  if (form === "colors-unicode") return written.match(/.{8}/gu)!.join(" ");
  return written;
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

/** The forms in the order of the question, the first three being the usual ones. */
function formChoices(): Choice<EncodedForm>[] {
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
  return choose("Which Seedshift?", SEEDSHIFT_VARIANTS, {
    label: "Variant",
    explanation: options.required === true ? ALWAYS_MASKED_EXPLANATION : VARIANT_EXPLANATION,
  });
}

/**
 * The files that the answers of the entry being asked name for saving, as absolute paths, so that
 * a second file of the same entry cannot take the place of a first (assertUnclaimed). Every entry
 * starts with none (askedAfresh).
 */
const entryOutputs: string[] = [];

/** `action` with no file of an earlier entry claimed. */
function askedAfresh(action: () => Promise<Action>): () => Promise<Action> {
  return () => {
    entryOutputs.length = 0;
    return action();
  };
}

/** Whether `child` is `parent` or lies inside it, as output-paths.ts compares outputs. */
function contains(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === "" || (relation.split(/[\\/]/u)[0] !== ".." && !isAbsolute(relation));
}

/**
 * Refuses `path` for an output of this entry when it is the place of an earlier one, lies in it or
 * holds it: the command would refuse the pair (validateOutputPaths), and a name taken by both
 * would be numbered to the same free name. Checked first, as it says the most; an answer that
 * passes every check is then claimed (entryOutputs).
 */
function assertUnclaimed(path: string): void {
  const absolute = resolve(path);
  if (entryOutputs.some((earlier) => contains(earlier, absolute) || contains(absolute, earlier)))
    throw new Error("Another file of this task has this name or this folder; choose another one.");
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
  if (path.trim() === "")
    throw new Error("That name is blank; type a name, or press Enter alone for the one shown.");
  if (path === "-") throw new Error("- is no file name here; type the name of a file.");
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
  assertUnclaimed(path);
  try {
    await preflightFileDestination(path, true);
  } catch (error) {
    // Its own checks say why in words; an error of the file system, such as ENOTDIR for a name
    // under a file, would name the path and the system call instead.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === undefined) throw error;
    throw new Error(
      code === "ENOTDIR"
        ? "The folder containing the output file is not a directory."
        : "The folder containing the output file must already exist and be writable.",
    );
  }
  entryOutputs.push(resolve(path));
  return path;
}

/** Why a new folder cannot be made where it is to go. */
const FOLDER_UNWRITABLE =
  "MnemoCode may not make a folder there; choose a folder you can write to.";

/**
 * A new folder to save into, such as one for the cards. The command makes the folders of its path
 * that do not exist yet and numbers a name that is taken, so the nearest folder of the path that
 * exists must be one that may be written to.
 */
async function newFolder(answer: string): Promise<string> {
  const path = typedPath(answer);
  assertUnclaimed(path);
  let ancestor = dirname(resolve(path));
  for (;;) {
    let info: Stats;
    try {
      info = await stat(ancestor);
    } catch (error) {
      const parent = dirname(ancestor);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === ancestor)
        throw new Error(FOLDER_UNWRITABLE);
      ancestor = parent;
      continue;
    }
    if (!info.isDirectory())
      throw new Error("A file stands where a folder of this name should be; choose another name.");
    try {
      await access(ancestor, fileAccess.W_OK);
    } catch {
      throw new Error(FOLDER_UNWRITABLE);
    }
    entryOutputs.push(resolve(path));
    return path;
  }
}

/** The largest record file that the command reads, MAX_TEXT_INPUT_BYTES of input.ts: 1 MiB. */
const RECORD_FILE_LIMIT = 1024 * 1024;
/** The largest QR code image that the command reads, MAX_PNG_BYTES of qr-input.ts: 16 MiB. */
const QR_FILE_LIMIT = 16 * 1024 * 1024;

/**
 * A file to read, checked without reading it: it exists, is a file and may be read, and it is no
 * larger than the command reads (`limit`, named `size` in the message). What is in it only the
 * command can tell, after it has read the file.
 */
async function inputFile(answer: string, limit: number, size: string): Promise<string> {
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
  if (info.size > limit) throw new Error(`That file is larger than ${size}; it cannot be the one.`);
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

/** The kind of file that printable cards are saved in: a PDF, or an image, which needs pdftocairo. */
type CardFileKind = "pdf" | ImageFormat;

/** How the cards are laid out: on sheets of one size, or as separate business cards. */
type CardLayout = "a6" | "a4" | "separate";

const CARD_LAYOUTS: readonly Choice<CardLayout>[] = [
  { label: "A6 sheets", note: "148 x 105 mm, the usual choice", value: "a6" },
  { label: "A4 sheets", note: "210 x 297 mm", value: "a4" },
  { label: "Separate business cards", note: "90 x 50 mm, one file each", value: "separate" },
];

/** The options of the chosen way of saving, and whether it gives sheets, which may get a QR code. */
interface CardFiles {
  readonly options: readonly string[];
  readonly sheets: boolean;
}

/** Why PNG and JPEG are refused at once where pdftocairo cannot be run; undefined where it can. */
async function missingImageRenderer(): Promise<string | undefined> {
  try {
    await assertImageRenderer();
    return undefined;
  } catch {
    return "Images need Poppler's pdftocairo, which is not installed here; choose a PDF.";
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
  // A6 is the page size that the commands take when none is given.
  const size = layout === "a4" ? ["--page-size", "a4"] : [];
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
  if (kind === "pdf") {
    const path = await askOutputFile("PDF file name", `${base}.pdf`);
    return path === undefined ? undefined : { sheets: true, options: ["--pdf", path, ...size] };
  }
  const folder = await askNewFolder(`${base}-images`);
  if (folder === undefined) return undefined;
  return { sheets: true, options: ["--images-dir", folder, ...image, ...size] };
}

/** The kind of file of the cards: a PDF, or an image, which needs pdftocairo. */
async function askCardFileKind(): Promise<CardFileKind | undefined> {
  let warning: string | undefined;
  for (;;) {
    const kind = await choose(
      "Which kind of file?",
      [
        { label: "PDF", note: "prints at its exact size", value: "pdf" },
        { label: "PNG", note: "images, sharp text and QR codes; needs pdftocairo", value: "png" },
        { label: "JPEG", note: "smaller images; needs pdftocairo", value: "jpg" },
      ] as const,
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

/** The question and the label of each detail of the person on the cards (--card-<field>). */
const PERSON_QUESTIONS: Readonly<
  Record<(typeof profileFields)[number], { readonly question: string; readonly label: string }>
> = {
  name: { question: "Name, in Latin letters", label: "Name" },
  role: { question: "Role", label: "Role" },
  company: { question: "Company", label: "Company" },
  email: { question: "Email", label: "Email" },
  phone: { question: "Phone", label: "Phone" },
  website: { question: "Website", label: "Website" },
  location: { question: "Location", label: "Location" },
};

/** The details of the person, which every design may print, checked as the command checks them. */
const PERSON_DETAILS: readonly CardDetail[] = profileFields.map((field) => ({
  option: `card-${field}`,
  ...PERSON_QUESTIONS[field],
  check: (answer) => {
    refuseOptionLike(answer);
    return validateProfile({ [field]: answer })[field]!;
  },
}));

/** Text printed around the cards, which "-" leaves off, checked as resolveCardPresentation does. */
function textDetail(
  key: keyof CardCopyOverrides,
  option: string,
  question: string,
  label: string,
): CardDetail {
  return {
    option,
    question,
    label,
    check: (answer) => {
      if (answer === "-") return answer;
      refuseOptionLike(answer);
      // The fixed choice stands for the random pick of the other texts, which are not used here.
      resolveCardPresentation({}, { [key]: answer }, () => 0);
      return answer;
    },
  };
}

/** The question of each text around the cards, in the order that designTexts names them. */
const TEXT_DETAILS: Readonly<Record<keyof CardCopyOverrides, CardDetail>> = {
  studioName: textDetail("studioName", "studio-name", "Studio name", "Studio"),
  slogan: textDetail("slogan", "card-slogan", "Slogan", "Slogan"),
  subtitle: textDetail("subtitle", "card-subtitle", "Subtitle", "Subtitle"),
  footer: textDetail("footer", "card-footer", "Footer", "Footer"),
  referenceLabel: textDetail(
    "referenceLabel",
    "card-reference-label",
    "Label before each code",
    "Reference",
  ),
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
      note: "a PDF or images in a card design",
      value: "cards",
    });
  const destination = await choose("Where should the result go?", choices, { label: "Output" });
  if (destination === undefined) return undefined;
  if (destination === "screen") return [];
  if (destination === "cards") return askCards("mnemocode-cards", false);
  const path =
    destination === "record"
      ? await askOutputFile("Record file name", "mnemocode-record.txt")
      : await askOutputFile("QR code file name", "mnemocode-qr.png");
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
  set: ShareSetChoice,
  form: EncodedForm,
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
    ...(copy ? ["--format", FORMAT_NUMBER[form]] : []),
  ];
}

/**
 * The optional sheet that tells heirs how to restore the backup (README, Instructions for heirs),
 * where a backup made in `mode` can have one.
 */
async function askHeirSheet(mode: Mode): Promise<string[] | undefined> {
  if (!capabilities(mode).heirSheet) return [];
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
  const path = await askOutputFile("PDF file name", "mnemocode-heirs.pdf");
  return path === undefined ? undefined : ["--heir-sheet", path, "--heir-sheet-size", size];
}

/** Where an encoded seed phrase is read from: typed on the private screen, or a file encode saved. */
async function askSource(): Promise<{ readonly options: string[] } | undefined> {
  const source = await choose(
    "Where is the encoded seed phrase?",
    [
      {
        label: "Type or paste it",
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
  if (source === "typed") return { options: [] };
  const path =
    source === "record"
      ? await askLine("Record file name", "File", {
          fallback: "mnemocode-record.txt",
          check: (answer) => inputFile(answer, RECORD_FILE_LIMIT, "1 MiB"),
        })
      : await askLine("QR code file name", "File", {
          fallback: "mnemocode-qr.png",
          check: (answer) => inputFile(answer, QR_FILE_LIMIT, "16 MiB"),
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
    const mode = await choose(
      "Was Seedshift used when it was encoded?",
      [
        { label: "No", note: "the codes stand for the words themselves", value: "direct" },
        ...SEEDSHIFT_VARIANTS.map((variant) => ({ ...variant, note: "the dates are asked next" })),
      ],
      { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
    );
    if (mode === undefined) return undefined;
    run.push("--mode", mode);
  }
  return { run };
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
 * A typed number from `min` to `max`, written as the command line takes it (no leading zeros);
 * otherwise `refusal` is the warning.
 */
function numberFrom(answer: string, min: number, max: number, refusal: string): string {
  const number = /^\d+$/u.test(answer) ? Number(answer) : Number.NaN;
  if (!(number >= min && number <= max)) throw new Error(refusal);
  return String(number);
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
 * Where the shares go, written in `shareFormat` (--share-format). Shares in colors can be printed
 * as cards that disguise them; the others as QR codes.
 */
async function askShares(
  set: ShareSetChoice,
  shareFormat: ShareFormat,
): Promise<string[] | undefined> {
  const options = ["--threshold", String(set.threshold), "--shares", String(set.count)];
  options.push("--share-format", shareFormat);
  // Cards print each share in its form: its colors, or its codes beside colors that only decorate.
  const printed: Choice<"cards"> = {
    label: "Also as printable cards",
    note:
      shareFormat === "colors" || shareFormat === "colors-unicode"
        ? "disguised, one sheet per share"
        : "its codes on cards, one sheet per share",
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
      { label: "A word of the seed phrase", note: "or several, or a missing one", value: "word" },
      {
        label: "A digit of a date",
        note: "for a seed phrase masked with Seedshift",
        value: "date",
      },
      {
        label: "A code of a Shamir share",
        note: "the share with ? for each code not read",
        value: "share",
      },
    ] as const,
    { label: "Forgotten" },
  );
  if (forgotten === undefined) return undefined;
  if (forgotten === "word") return wordRecoveryAction();
  // The shares come back whole, in their own form, without the seed phrase being shown.
  if (forgotten === "share") return shareRepairAction();
  const source = await askSource();
  if (source === undefined) return undefined;
  // A record file names its mode; otherwise the person says which Seedshift was used.
  const mode =
    source.options[0] === "--input-file"
      ? undefined
      : await choose("Which Seedshift was used?", SEEDSHIFT_VARIANTS, {
          label: "Seedshift",
          explanation: VARIANT_EXPLANATION,
        });
  if (mode === undefined && source.options[0] !== "--input-file") return undefined;
  // Every date gives MnemoCode Seedshift a valid phrase, so only the wallet can tell the right one;
  // the original Seedshift's checksum sorts out most dates by itself. A record file names its own
  // mode, and recover-date asks for the wallet after reading it only when that mode needs one.
  const wallet = await askWallet(mode !== undefined && mode !== "seedshift-legacy");
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

/** Why the wallet is asked for, shown with the question. */
const WALLET_EXPLANATION: Explanation = {
  lines: ["Each guessed date gives a valid phrase; the wallet tells which is yours."],
  more: [readmeLink("date-recovery-helper")],
};

/** Why the wallet is asked for before shares are repaired. */
const SHARE_WALLET_EXPLANATION: Explanation = {
  lines: ["Shares with many ? may fit in several ways; the wallet tells the right one."],
  more: [readmeLink("damaged-shares")],
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
  const mode = await askSeedshift("Was the phrase masked with Seedshift before splitting?", {
    shares: true,
  });
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
  explanation: Explanation = WALLET_EXPLANATION,
): Promise<string[] | undefined> {
  const kind = await choose(
    "How can MnemoCode recognise the wallet?",
    [
      {
        label: "Fingerprint",
        // The phrase of the wallet: with Seedshift the one before the shift, which Encode calls Original.
        note: "Encode's Original, not the Encoded",
        value: "fingerprint",
      },
      {
        label: "Bitcoin address",
        note: "one of its first receiving addresses",
        example: "1..., 3..., bc1q... or bc1p...",
        value: "address",
      },
      { label: "Address of another coin", note: OTHER_COINS_NOTE, value: "coin" },
      ...(required
        ? []
        : [{ label: "It cannot", note: "list every candidate instead", value: "none" }]),
    ] as const,
    { label: "Wallet", explanation },
  );
  if (kind === undefined) return undefined;
  if (kind === "none") return [];
  if (kind === "fingerprint") {
    const fingerprint = await askLine(
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)",
      "Fingerprint",
      { what: "the eight characters of the fingerprint", check: parseMasterFingerprint },
    );
    return fingerprint === undefined ? undefined : ["--master-fingerprint", fingerprint];
  }
  const address = kind === "coin" ? await askCoinAddress() : await askBitcoinAddress();
  if (address === undefined) return undefined;
  const count = await askLine("Compare with how many addresses from the first", "Addresses", {
    fallback: String(DEFAULT_ADDRESS_COUNT),
    check: (text) => String(parseAddressCount(text)),
  });
  return count === undefined ? undefined : [...address, "--scan-gap", count];
}

/** A Bitcoin address of the wallet, as the options that give it. */
async function askBitcoinAddress(): Promise<string[] | undefined> {
  const address = await askLine("Bitcoin address (one of the first receiving ones)", "Address", {
    what: "a receiving address of the wallet",
    check: (text) => parseBitcoinAddress(text, "mainnet"),
  });
  return address === undefined ? undefined : ["--bitcoin-address", address];
}

/** Which coin, then an address of the wallet in it, as the options that give them. */
async function askCoinAddress(): Promise<string[] | undefined> {
  const coin = await choose(
    "Which coin?",
    OTHER_COINS.map((each) => ({ label: each.name, note: each.addressForms, value: each })),
    { label: "Coin" },
  );
  if (coin === undefined) return undefined;
  const address = await askLine(
    `Address (${coin.name}, one of the first receiving ones)`,
    "Address",
    {
      what: `the wallet's address of ${coin.name}`,
      check: (text) => parseCoinAddress(coin.id, text),
    },
  );
  return address === undefined ? undefined : ["--coin", coin.id, "--coin-address", address];
}

/** Entry 6: card designs drawn with the public test phrase. */
async function previewAction(): Promise<Action> {
  const design = await askDesign(true);
  if (design === undefined) return undefined;
  const path = await askOutputFile("PDF file name", "mnemocode-preview.pdf");
  if (path === undefined) return undefined;
  return {
    run: ["preview", ...(design === "" ? ["--all"] : ["--template", design]), "--pdf", path],
  };
}

/** The words of the BIP39 list (table --index). */
const WORD_COUNT = 2048;

/** A lookup of the word table: its question, and its answer checked as the table looks it up. */
interface Lookup {
  readonly question: string;
  /** Its line in the record of answers, which must fit ANSWER_LABEL_WIDTH. */
  readonly label: string;
  readonly what: string;
  readonly check: (answer: string) => string;
}

const LOOKUPS: Readonly<Record<"word" | "index" | "unicode", Lookup>> = {
  word: {
    question: "Word",
    label: "Word",
    what: "a word of the English BIP39 list",
    check: (answer) => {
      // The table compares words as the list writes them, in lower case.
      const word = answer.toLowerCase();
      if (!allMappingRows().some((row) => row.english === word))
        throw new Error("That word is not in the English BIP39 list.");
      return word;
    },
  },
  index: {
    question: "Word number",
    label: "Number",
    what: `a number from 1 to ${WORD_COUNT}`,
    check: (answer) =>
      numberFrom(answer, 1, WORD_COUNT, `Type a whole number from 1 to ${WORD_COUNT}.`),
  },
  unicode: {
    question: "Unicode code",
    label: "Code",
    what: "four hexadecimal digits, such as 5BF6",
    check: (answer) => {
      const code = answer.toUpperCase();
      if (!allMappingRows().some((row) => row.unicodeHex === code))
        throw new Error("No BIP39 word has that code; type four hexadecimal digits, such as 5BF6.");
      return code;
    },
  },
};

/** Entry 7: one row of the word table, or all of it. */
async function tableAction(): Promise<Action> {
  const lookup = await choose(
    "What do you want to look up?",
    [
      { label: "A word", note: "such as abandon", value: "word" },
      { label: "A word number", note: `1 to ${WORD_COUNT}`, value: "index" },
      { label: "A Unicode code", note: "four hexadecimal digits, such as 5BF6", value: "unicode" },
      { label: "The whole table", note: "all 2,048 rows", value: "all" },
    ] as const,
    { label: "Look up" },
  );
  if (lookup === undefined) return undefined;
  if (lookup === "all") return { run: ["table", "--all"] };
  const { question, label, what, check } = LOOKUPS[lookup];
  const answer = await askLine(question, label, { what, check });
  if (answer === undefined) return undefined;
  return { run: ["table", `--${lookup}`, answer] };
}

interface Entry {
  readonly label: string;
  readonly digit: number;
  readonly action: () => Promise<Action>;
  /** The command asks for a seed phrase or a share, which needs a protected, self-tested process. */
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

/**
 * Characters that sh, bash, zsh, cmd.exe and PowerShell all take as they are, so that an argument
 * of only these is shown without quotes. % (cmd.exe variables) and , (PowerShell arrays) are not
 * among them.
 */
const PLAIN_ARGUMENT = /^[\w./:@+=-]+$/u;

/** A first character that a shell still reads: zsh expands =name to the path of a program, and
 * PowerShell reads @name as splatting. */
const SPECIAL_FIRST = /^[=@]/u;

/**
 * An argument that PowerShell may read as a number and pass on as it writes that number: 4E00 as
 * 4, 0x10 as 16, 1kb as 1024, 007 as 7, also after a sign or a point. Only a plain decimal
 * without a leading zero is passed on as it was typed.
 */
const NUMBER_START = /^[+-]?\.?\d/u;
const PLAIN_DECIMAL = /^(?:0|[1-9]\d*)$/u;

/**
 * What cmd.exe or PowerShell still reads inside double quotes: " and its typographic forms
 * U+201C, U+201D and U+201E, which PowerShell takes as quotes too, $ and ` (PowerShell), % ! and ^
 * (cmd.exe), a line break, and a backslash at the end, which the program's own reading of its
 * command line takes as an escape of the closing quote.
 */
const SPECIAL_IN_DOUBLE_QUOTES = /["\u201C\u201D\u201E$`%!^\r\n]|\\$/u;

/** The characters that end a PowerShell single-quoted string: ' and its typographic forms U+2018,
 * U+2019, U+201A and U+201B. */
const POWERSHELL_SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/gu;

/** Whether `argument` reads the same in every shell of `platform` without quotes. */
function isPlain(argument: string, platform: NodeJS.Platform): boolean {
  if (!PLAIN_ARGUMENT.test(argument) || SPECIAL_FIRST.test(argument)) return false;
  return platform !== "win32" || !NUMBER_START.test(argument) || PLAIN_DECIMAL.test(argument);
}

/** An argument in single quotes, where a POSIX shell expands nothing; a ' inside ends them. */
function posixQuoted(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/**
 * An argument quoted for both shells of Windows. cmd.exe knows only double quotes, and they read
 * the same in PowerShell while the argument holds none of SPECIAL_IN_DOUBLE_QUOTES, which leaves
 * paths with spaces and backslashes in them. Anything else gets PowerShell's single quotes, inside
 * which each of its five single quote characters is doubled; cmd.exe has no quotes for it.
 */
function windowsQuoted(argument: string): string {
  if (!SPECIAL_IN_DOUBLE_QUOTES.test(argument)) return `"${argument}"`;
  return `'${argument.replace(POWERSHELL_SINGLE_QUOTES, "$&$&")}'`;
}

/**
 * The command line as it would be typed in the shell of the system: an argument with anything a
 * shell reads, such as a space, $, ` or \, and on Windows one that PowerShell may read as a
 * number, is quoted so that no shell changes it (AUD-008-UI002).
 */
export function typedCommand(
  run: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const quote = platform === "win32" ? windowsQuoted : posixQuoted;
  const quoted = run.map((argument) => (isPlain(argument, platform) ? argument : quote(argument)));
  return ["mnemocode", ...quoted].join(" ");
}

const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);

/** Indent of the typed command under "The same as:". */
const COMMAND_INDENT = "  ";

/** Prose wrapping changes quoted arguments; let the terminal soft-wrap the literal command. */
export function commandDisplay(run: readonly string[]): string {
  return `${COMMAND_INDENT}${typedCommand(run)}`;
}

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
    return error instanceof Error ? error.message : String(error);
  }
}

/** Said once when the entries that ask for a secret are no longer offered. */
const SECRET_ENTRIES_LEFT_OUT =
  "The entries that ask for a seed phrase or a share are not offered.";

/** What a shell reports for a process that a signal stopped: 128 plus the signal's number. */
const SIGNAL_EXIT_BASE = 128;

/** The name of the signal that ended a process with `code` (SIGNAL_EXIT_BASE plus its number). */
function signalOf(code: number): string {
  const number = code - SIGNAL_EXIT_BASE;
  const name = Object.entries(systemConstants.signals).find(([, value]) => value === number)?.[0];
  return name ?? `signal ${number}`;
}

/**
 * Clears the private screen and returns to the main screen, as private-screen.ts leaves it, for a
 * command that was stopped while it may have shown it. The clear comes first, so that the words
 * also vanish where there is no alternate screen.
 */
const LEAVE_ALTERNATE_SCREEN = "\x1b[2J\x1b[H\x1b[?1049l";

/**
 * Wipes what was typed while a command ran but not read by it, such as the rest of a paste after
 * it had failed, so that it answers no question of the menu. A Ctrl+C among it was meant for the
 * command, which has ended.
 */
async function dropAfterCommand(): Promise<void> {
  try {
    await dropTypedAhead();
  } catch (error) {
    if (!(error instanceof InputCancelled)) throw error;
  }
}

/** stty, run by its own path, as Linux and macOS have it, rather than looked up. */
const STTY = "/bin/stty";

/** Runs stty for the terminal on standard input; what it printed, or undefined when it failed. */
function stty(args: readonly string[]): string | undefined {
  const result = spawnSync(STTY, args, { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * Runs `body`, a command and what the menu reads right after it, with the terminal's echo off, and
 * gives the terminal back exactly as it was (stty -g), also after a command that a signal stopped
 * while it read keys in raw mode. A command takes the terminal at its first question, after its
 * self-test; until then the terminal would show the keys typed for it, the start of a secret too,
 * on the main screen, whose scrollback keeps them. Raw mode would hide them as well, but a command
 * started in it takes it as its normal mode, since Node.js gives back the mode that it found, and
 * Ctrl+C would then not stop the command between its questions. A Windows console shows no key
 * before a program reads it; there, and without stty, nothing is changed.
 */
async function withEchoOff<T>(body: () => Promise<T>): Promise<T> {
  const saved = process.platform === "win32" || !terminalAvailable() ? undefined : stty(["-g"]);
  if (saved === undefined || stty(["-echo"]) === undefined) return body();
  try {
    return await body();
  } finally {
    stty([saved]);
  }
}

/**
 * Runs `run` in a process of its own and returns its exit code, or undefined when the person went
 * back to the menu instead. A command that could not be started, or that a signal stopped, such as
 * the out-of-memory killer, is said so in one line and offered again with the same answers.
 */
async function runCommand(run: readonly string[]): Promise<number | undefined> {
  for (;;) {
    let failure: string;
    try {
      const code = await withEchoOff(async () => {
        // What was typed or pasted with the last answer goes to no process: a command reads only
        // the keys pressed for its own questions.
        await dropTypedAhead();
        const exit = await runInOwnProcess(run);
        await dropAfterCommand();
        return exit;
      });
      if (code <= SIGNAL_EXIT_BASE || code === CANCELLED_EXIT_CODE) return code;
      if (PRIVATE_SCREEN_COMMANDS.has(run[0]!) && privateScreenAvailable())
        process.stderr.write(LEAVE_ALTERNATE_SCREEN);
      failure = `The command stopped unexpectedly (${signalOf(code)}).`;
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
      failure = `The command could not be started (${reason}).`;
    }
    const again = await choose(
      "What now?",
      [
        { label: "Start it again", note: "with the same answers", value: true },
        { label: "Back to the menu", value: false },
      ],
      { label: "Next", warning: failure },
    );
    if (again !== true) return undefined;
  }
}

/** The menu's heading; `refusal` says why no entry that asks for a secret is offered. */
function writeHeading(refusal: string | undefined): void {
  console.error(
    `\n${paint(STYLE.heading, "MnemoCode")} ${paint(STYLE.muted, "·")} ${paint(STYLE.strong, "Offline seed phrase encoding")}\n`,
  );
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
