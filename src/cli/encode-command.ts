import {
  formatEncoded,
  indexesToColors,
  legacyChecksumValidResult,
  representMnemonic,
  type EncodedResult,
  type DateShiftDate,
} from "../core.js";
import { Masking } from "../core/masking.js";
import { type ParsedArguments, value, values } from "./arguments.js";
import {
  dates,
  encodeFormat,
  promptedEncodeInputs,
  textInput,
  transformMode,
  type EncodedFormat,
  type TransformMode,
} from "./input.js";
import { validateCardOptions, completeEventLabels } from "./card-options.js";
import { businessOptions, cardCopyOptions } from "./business-options.js";
import { isCardPageSize, profileFields, type CardSettings } from "../export/card-settings.js";
import { renderCards, renderIndividualCards } from "../export/render.js";
import { selectTemplate } from "../export/templates.js";
import { validateImageOptions } from "./image-options.js";
import {
  preflightFileDestination,
  reportRenamedOutputs,
  validateOutputPaths,
} from "./output-paths.js";
import { requireNewCardDirectory } from "../export/individual-cards.js";
import { requireNewImageDirectory } from "../export/image-export.js";
import { runSskrSplit } from "./sskr-command.js";
import { printEncodeResult } from "./encode-report.js";
import { backupCheckAnswer, offerEncodedCheck } from "./backup-check.js";
import { saveEncodeResult } from "./encode-export.js";
import { saveHeirSheet, validateHeirSheetOptions } from "./heir-sheet.js";
import { optionLabel } from "./option-copy.js";
import { FOLDER_OUTPUTS } from "./output-options.js";
import { saveQrBeside, saveQrInside } from "./qr-export.js";
import { saveWithRetry } from "./save-retry.js";
import { terminalNotice } from "./terminal.js";

export interface EncodeOutcome {
  readonly mode: TransformMode;
  readonly recordMode: TransformMode;
  readonly format: EncodedFormat;
  readonly enteredDates: readonly DateShiftDate[];
  readonly baseResult: EncodedResult;
  readonly result: EncodedResult;
  readonly encoded: string;
  readonly legacyAlternative?: EncodedResult;
  readonly legacyChanged: boolean;
  readonly useLegacyValid: boolean;
}

async function validateEncodeOptions(
  args: ParsedArguments,
): Promise<{ mode: TransformMode; format: EncodedFormat }> {
  for (const key of ["threshold", "shares", "share-format", "card-layout"]) {
    if (args[key] !== undefined)
      throw new Error(`The ${optionLabel(key)} setting is available only in SSKR mode.`);
  }
  const mode = transformMode(args);
  const format = encodeFormat(value(args, "format"));
  if (mode === "seedshift-legacy-valid")
    throw new Error(
      "To create a legacy checksum-valid record, select legacy Seedshift and enable the checksum-word replacement.",
    );
  if (args["legacy-valid-last-word"] === true && mode !== "seedshift-legacy")
    throw new Error(
      "The legacy checksum-word replacement is available only in legacy Seedshift mode.",
    );
  // The sheet leads through the menu, whose Decode does not offer a replaced last word.
  if (args["legacy-valid-last-word"] === true && args["heir-sheet"] !== undefined)
    throw new Error(
      "Instructions for heirs are not available with the legacy checksum-word replacement.",
    );
  if (args.cards === true && format !== "colors" && format !== "colors-unicode")
    throw new Error("Terminal color cards are available only for RGB color formats 4 and 5.");
  validateCardOptions(args, format, mode);
  // Validate all destinations before prompting or reading a mnemonic.
  await validateImageOptions(args);
  const directory = value(args, "cards-dir");
  if (directory !== undefined) await requireNewCardDirectory(directory);
  validateHeirSheetOptions(args);
  for (const key of ["output", "pdf", "qr", "heir-sheet"]) {
    const path = value(args, key);
    if (path !== undefined) await preflightFileDestination(path, true);
  }
  return { mode, format };
}

async function createOutcome(
  args: ParsedArguments,
  mode: TransformMode,
  format: EncodedFormat,
): Promise<EncodeOutcome> {
  const prompted = await promptedEncodeInputs(args, mode);
  const enteredDates = prompted?.dates ?? dates(args);
  if (mode === "direct" && enteredDates.length > 0)
    throw new Error("Dates cannot be used in direct mode.");
  if (mode !== "direct" && enteredDates.length === 0)
    throw new Error(`${mode} requires at least one date.`);
  const mnemonic = prompted?.mnemonic ?? textInput(args, "mnemonic");
  const baseResult = Masking.of(mode).encode(mnemonic, enteredDates);
  const legacyAlternative =
    mode === "seedshift-legacy" ? legacyChecksumValidResult(baseResult) : undefined;
  const legacyChanged =
    legacyAlternative !== undefined &&
    legacyAlternative.shiftedIndexes.at(-1) !== baseResult.shiftedIndexes.at(-1);
  const useLegacyValid = args["legacy-valid-last-word"] === true;
  const result = useLegacyValid && legacyChanged ? legacyAlternative! : baseResult;
  const recordMode = useLegacyValid && legacyChanged ? "seedshift-legacy-valid" : mode;
  return {
    mode,
    recordMode,
    format,
    enteredDates,
    baseResult,
    result,
    encoded: formatEncoded(result, format),
    legacyAlternative,
    legacyChanged,
    useLegacyValid,
  };
}

/** Encode's results that go to a file or a new folder, in the order saveEncodeResult saves them. */
const SAVED_RESULTS = [
  ["output", "The record"],
  ["pdf", "The PDF"],
  ["images-dir", "The images"],
  ["cards-dir", "The card files"],
  ["qr", "The QR code"],
] as const;

/** The options of every result that saveEncodeResult saves, and of the colour cards it shows. */
const RESULT_OPTIONS = [...SAVED_RESULTS.map(([key]) => key), "cards"] as const;

/**
 * Sets `saving` to save only the result of `key`, at `path` (true for the colour cards shown on
 * the terminal), and returns it. `saving` is one object of options for a whole run, because the
 * random card details are drawn once for an object of options (businessOptions): the PDF, the
 * images and the card files of a run carry the same ones, as when one call saved them all.
 */
function onlyResult(saving: ParsedArguments, key: string, path: string | true): ParsedArguments {
  for (const other of RESULT_OPTIONS) delete saving[other];
  saving[key] = path;
  return saving;
}

/** A public test seed phrase of 24 words: the most codes, and the most cards, Encode prints. */
const LARGEST_DUMMY = `${"abandon ".repeat(23)}art`;

/** The card options whose text the person writes: the details, the card copy and the heading. */
const TYPED_CARD_TEXTS = [
  ...profileFields.map((field) => `card-${field}`),
  ...cardCopyOptions,
  "title",
] as const;

/**
 * Whether the card options may keep the cards from being printed. Random card details come from
 * lists that fit every design, and every colour design prints on each page size and orientation,
 * with or without a QR code on a sheet, as rendering them all with random details showed. What can
 * fail is a text that the person typed, or a QR code on a business-card page.
 */
function cardsMayFail(saving: ParsedArguments, settings: CardSettings): boolean {
  return (
    TYPED_CARD_TEXTS.some((key) => saving[key] !== undefined) ||
    (settings.cardQr === true && isCardPageSize(settings.pageSize))
  );
}

/**
 * Renders the colour cards that the options ask for in memory, with the codes of a public dummy
 * seed phrase and the card details of `saving`, where the options may keep them from being
 * printed (cardsMayFail). Such options, a detail too long for its card or a QR code on a
 * business-card page, are so refused before a secret is asked, not after the result is shown. A
 * render takes seconds, so it is not made where nothing can fail. Nothing is written.
 */
async function assertCardsPrintable(saving: ParsedArguments, format: EncodedFormat): Promise<void> {
  if (format !== "colors" && format !== "colors-unicode") return;
  const sheets = value(saving, "pdf") !== undefined || value(saving, "images-dir") !== undefined;
  const cards = value(saving, "cards-dir") !== undefined;
  const settings = businessOptions(saving);
  if ((!sheets && !cards) || !cardsMayFail(saving, settings)) return;
  const dummy = representMnemonic(LARGEST_DUMMY);
  const template = selectTemplate(value(saving, "template"), "colors");
  // The content that saveEncodeResult renders the sheets and the separate cards from.
  const content = {
    ...settings,
    kind: "colors" as const,
    colors: indexesToColors(dummy.shiftedIndexes),
    payload: formatEncoded(dummy, format),
    title: value(saving, "title"),
  };
  if (sheets) await renderCards([{ template, content }]);
  if (cards) await renderIndividualCards(template, content);
}

/**
 * Refuses another name for the result that the option `key` names, unless it is a new file whose
 * folder can be written, or a new folder, and no other file of the command overlaps it.
 */
async function checkOtherName(args: ParsedArguments, key: string, path: string): Promise<void> {
  if (key === "cards-dir") await requireNewCardDirectory(path);
  else if (key === "images-dir") await requireNewImageDirectory(path);
  else await preflightFileDestination(path, false);
  await validateOutputPaths({ ...args, [key]: path });
}

/**
 * Saves the result that the option `key` names, which is on the screen already, as saveWithRetry
 * does: a failure keeps it and offers to try again, to save it under another name, or to skip it.
 * `write` saves it at a path. A name used instead of the one given is kept in `args`, so that the
 * next new name is checked against it.
 */
async function saveOne(
  args: ParsedArguments,
  key: string,
  what: string,
  write: (path: string) => Promise<void>,
): Promise<string | undefined> {
  const saved = await saveWithRetry({
    what,
    kind: (FOLDER_OUTPUTS as readonly string[]).includes(key) ? "folder" : "file",
    path: value(args, key)!,
    write,
    checkName: (path) => checkOtherName(args, key, path),
  });
  if (saved !== undefined) args[key] = saved;
  return saved;
}

/**
 * Saves every result of Encode that the options name, each on its own (saveOne), with `saving`,
 * the run's one object of options for saveEncodeResult (onlyResult).
 */
async function saveResults(
  args: ParsedArguments,
  saving: ParsedArguments,
  outcome: EncodeOutcome,
  eventLabels: readonly string[],
): Promise<void> {
  const saved = new Map<string, string>();
  for (const [key, what] of SAVED_RESULTS) {
    const path =
      value(args, key) === undefined
        ? undefined
        : await saveOne(args, key, what, (path) =>
            saveEncodeResult(onlyResult(saving, key, path), outcome, eventLabels),
          );
    if (path !== undefined) saved.set(key, path);
    // The colour cards on the terminal come after the record, as saveEncodeResult shows them.
    if (key === "output" && args.cards === true)
      await saveEncodeResult(onlyResult(saving, "cards", true), outcome, eventLabels);
  }
  await saveSheetQr(args, outcome, saved);
}

/**
 * The QR code that the sheets print with --card-qr, also saved as an image where they were saved:
 * beside the PDF, or else in the folder of their images. Decode reads it back (--qr-file). Not
 * when --qr names an image of its own, which holds the same codes.
 */
async function saveSheetQr(
  args: ParsedArguments,
  outcome: EncodeOutcome,
  saved: ReadonlyMap<string, string>,
): Promise<void> {
  // Only the sheets of colours carry a QR code (exportColorPalette).
  if (args["card-qr"] !== true || value(args, "qr") !== undefined || outcome.format === "unicode")
    return;
  const pdf = saved.get("pdf");
  const images = saved.get("images-dir");
  if (pdf === undefined && images === undefined) return;
  const path =
    pdf === undefined
      ? await saveQrInside(outcome.encoded, images!)
      : await saveQrBeside(outcome.encoded, pdf);
  terminalNotice(`Saved the QR code of the sheet as an image: ${path}`, "success");
}

export async function runEncode(args: ParsedArguments): Promise<void> {
  if (args.sskr === true) return runSskrSplit(args, true);
  const { mode, format } = await validateEncodeOptions(args);
  const checkAnswer = backupCheckAnswer(args);
  const saving: ParsedArguments = { ...args };
  if (args["ask-secrets"] === true) await assertCardsPrintable(saving, format);
  const outcome = await createOutcome(args, mode, format);
  const hasCardExport = value(args, "pdf") !== undefined || value(args, "images-dir") !== undefined;
  const eventLabels =
    hasCardExport && format === "unicode"
      ? await completeEventLabels(outcome.enteredDates, values(args, "event"))
      : [];
  printEncodeResult(outcome);
  await saveResults(args, saving, outcome, eventLabels);
  const { recordMode } = outcome;
  // A record with a replaced last word never gets a sheet (validateEncodeOptions).
  if (recordMode !== "seedshift-legacy-valid" && value(args, "heir-sheet") !== undefined)
    await saveOne(args, "heir-sheet", "The instructions for heirs", (path) =>
      saveHeirSheet(
        { ...args, "heir-sheet": path },
        {
          backup: { kind: "encoded", format },
          mode: recordMode,
          dates: outcome.enteredDates.length,
        },
      ),
    );
  reportRenamedOutputs();
  await offerEncodedCheck(
    {
      mnemonic: outcome.result.sourceMnemonic,
      format,
      mode: recordMode,
      codes: outcome.result.shiftedIndexes,
      dates: outcome.enteredDates,
    },
    () => printEncodeResult(outcome),
    checkAnswer,
  );
}
