// The questions of the printable cards of a backup (encode-questions.ts): the design, the layout
// and the turn of the sheets, the kind of file and where it goes, and the details printed on them.
// None of them is a secret.

import { designTexts, resolveCardPresentation } from "../export/card-copy.js";
import {
  profileFieldLabel,
  PROFILE_FIELDS,
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
import { SHEET_PLAN_TEXT } from "../export/collection-layout.js";
import { ImageRenderer } from "../export/image-export.js";
import {
  DOCUMENT_FORMAT_FACTS,
  DOCUMENT_FORMATS,
  isImageFormat,
  type DocumentFormat,
} from "../export/document-formats.js";
import { CARD_TEMPLATES } from "../export/templates.js";
import { askLine, choose, type Choice, type Explanation } from "./terminal-choice.js";
import { refusal } from "./terminal-input.js";
import { readmeLink } from "./terminal.js";
import { COPY_OPTIONS, profileOption } from "./business-options.js";
import { defined } from "../core/defined.js";
import { ClaimedOutputs, FILE_NAME_QUESTIONS } from "./output-questions.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.card-questions", {
  "detail-starts-would-read-as-option-leave-out": () =>
    "A detail that starts with - would be read as an option; leave out the -.",
});

/**
 * Which design, with Every design first where `withEveryDesign`; for separate cards
 * (`separateCards`) only the designs that draw them, the business cards (drawsSeparateCards).
 */
export async function askDesign(
  withEveryDesign: boolean,
  separateCards = false,
): Promise<string | undefined | Cancelled> {
  const designs: Choice<string>[] = CARD_TEMPLATES.filter(
    (template) => !separateCards || template.renderIndividual !== undefined,
  ).map((template) => ({ label: template.name, note: template.id, value: template.id }));
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
async function askSheetTurn(): Promise<string[] | undefined | Cancelled> {
  const turn = await choose("How should the sheets be turned?", SHEET_TURNS, {
    label: "Orientation",
  });
  if (turn === undefined || turn === CANCELLED) return turn;
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
    await ImageRenderer.assert();
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
async function askCardFiles(
  base: string,
  shares: boolean,
): Promise<CardFiles | undefined | Cancelled> {
  const kind = await askCardFileKind();
  if (kind === undefined || kind === CANCELLED) return kind;
  const layout = await choose("How should the cards be laid out?", CARD_LAYOUTS, {
    label: "Layout",
  });
  if (layout === undefined || layout === CANCELLED) return layout;
  // The page size that the commands take when none is given is left out of the command.
  const pageSize =
    layout === "separate" || layout === SHEET_PAGE_SIZE ? [] : ["--page-size", layout];
  const image = isImageFormat(kind) ? ["--image-format", kind] : [];
  if (layout === "separate") {
    const folder = await ClaimedOutputs.askNewFolder(base);
    if (folder === undefined || folder === CANCELLED) return folder;
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
  if (turn === undefined || turn === CANCELLED) return turn;
  const size = [...pageSize, ...turn];
  if (kind === "pdf") {
    const path = await ClaimedOutputs.askOutputFile(FILE_NAME_QUESTIONS.pdf, `${base}.pdf`);
    if (path === undefined || path === CANCELLED) return path;
    return { sheets: true, options: ["--pdf", path, ...size] };
  }
  const folder = await ClaimedOutputs.askNewFolder(`${base}-images`);
  if (folder === undefined || folder === CANCELLED) return folder;
  return { sheets: true, options: ["--images-dir", folder, ...image, ...size] };
}

/**
 * The kind of file that printable cards are saved in: a PDF, or an image, which needs pdftocairo.
 */
async function askCardFileKind(): Promise<DocumentFormat | undefined | Cancelled> {
  let warning: string | undefined;
  for (;;) {
    const kind = await choose(
      "Which kind of file?",
      DOCUMENT_FORMATS.map((format) => {
        const { name, note } = DOCUMENT_FORMAT_FACTS[format];
        // Images are drawn from the PDF with pdftocairo, which the menu checks for below.
        return {
          label: name,
          note: isImageFormat(format) ? `${note}; needs pdftocairo` : note,
          value: format,
        };
      }),
      { label: "Files", warning },
    );
    if (kind === undefined || kind === CANCELLED || !isImageFormat(kind)) return kind;
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
    throw ERRORS.create("detail-starts-would-read-as-option-leave-out", []);
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

/**
 * The details of the person, which every design may print, each checked as the command checks it.
 * Whether they fit on the cards is checked once they are all typed (askCardDetails).
 */
const PERSON_DETAILS: readonly CardDetail[] = PROFILE_FIELDS.map((field) => ({
  option: profileOption(field),
  question: PERSON_QUESTIONS[field],
  label: profileFieldLabel(field),
  check: (answer) => {
    refuseOptionLike(answer);
    return defined(validateProfile({ [field]: answer })[field]);
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
 * Refuses, as the command does before it asks a secret, cards that the card options of the
 * command line could not print, such as with a detail too long for its card: `options` are
 * --template, how the cards are saved and the details (cards-fit.ts). It shows nothing.
 */
export type CardsFit = (options: readonly string[]) => Promise<void>;

/**
 * The details on the cards: random, as the commands invent them, or typed one by one, where Enter
 * keeps a detail random. They are a decoy, no secret, and go on the command line. Typed details
 * that the cards with the options `chosen` cannot print (`fit`) are explained in one warning line
 * and asked for again, from the question whether to type them, with every other answer kept
 * (CORE-42).
 */
async function askCardDetails(
  sheets: boolean,
  chosen: readonly string[],
  fit: CardsFit,
): Promise<string[] | undefined | Cancelled> {
  let warning: string | undefined;
  for (;;) {
    const details = await askDetailsOnce(sheets, warning);
    // Random details fit every design: only a typed one may not.
    if (details === undefined || details === CANCELLED || details.length === 0) return details;
    try {
      await fit([...chosen, ...details]);
      return details;
    } catch (error) {
      warning = refusal(error);
    }
  }
}

/** One asking of askCardDetails, with `warning` above its first question. */
async function askDetailsOnce(
  sheets: boolean,
  warning: string | undefined,
): Promise<string[] | undefined | Cancelled> {
  const own = await choose(
    "Type your own details for the cards?",
    [
      { label: "No, random", note: "invented names and contacts", value: false },
      { label: "Yes", note: "Enter on a detail keeps it random", value: true },
    ],
    { label: "Details", explanation: DETAILS_EXPLANATION, warning },
  );
  if (own === undefined || own === CANCELLED) return own;
  if (!own) return [];
  const options: string[] = [];
  const texts = designTexts(sheets).map((key) => TEXT_DETAILS[key]);
  for (const detail of [...PERSON_DETAILS, ...texts]) {
    const answer = await askLine(detail.question, detail.label, {
      optional: "random",
      check: detail.check,
    });
    if (answer === undefined || answer === CANCELLED) return answer;
    if (answer !== "") options.push(`--${detail.option}`, answer);
  }
  return options;
}

/**
 * Printable cards, after "Also as printable cards": how the cards are saved in files named after
 * `base` (the kind of file, then the layout), the design, a QR code on each sheet, and the details
 * on them, which `fit` checks as the command will (askCardDetails). Separate business cards never
 * carry a QR code. `shares`: the cards of Shamir shares, one set per share.
 */
export async function askCards(
  base: string,
  shares: boolean,
  fit: CardsFit,
): Promise<string[] | undefined | Cancelled> {
  // How the cards are saved comes first, then their design.
  const files = await askCardFiles(base, shares);
  if (files === undefined || files === CANCELLED) return files;
  const design = await askDesign(false, !files.sheets);
  if (design === undefined || design === CANCELLED) return design;
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
  if (qr === undefined || qr === CANCELLED) return qr;
  const chosen = ["--template", design, ...files.options, ...(qr ? ["--card-qr"] : [])];
  const details = await askCardDetails(files.sheets, chosen, fit);
  if (details === undefined || details === CANCELLED) return details;
  return [...chosen, ...details];
}
