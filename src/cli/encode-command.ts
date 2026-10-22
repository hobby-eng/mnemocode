import { Masking } from "../core/masking.js";
import { type ParsedArguments, value } from "./arguments.js";
import { assertDateInputMode, encodeFormat, transformMode, phraseAndDates } from "./input.js";
import { validateCardOptions } from "./card-options.js";
import { colorCardsFit } from "./cards-fit.js";
import { RenamedOutputs } from "./output-paths.js";
import { prepareSskrSplit } from "./sskr-split-command.js";
import { printEncodeResult, maskedWordsRequested, originalCopyRequested } from "./encode-report.js";
import { backupCheckAnswer, offerEncodedCheck } from "./backup-check.js";
import { EncodeCardExport, saveEncodeResult } from "./encode-export.js";
import { optionLabel } from "./option-copy.js";
import { saveQrBeside, saveQrInside } from "./qr-export.js";
import { printableText, terminalSaved, terminalWork } from "./terminal.js";
import { clearPrivateScreen } from "./private-screen.js";
import { EncodedBackup } from "../core/encoded-backup.js";
import { COLOR_FORMAT_NUMBERS } from "./format-numbers.js";
import { preflightOutputs, saveHeirSheetOutput, saveOutput } from "./output-saving.js";
import { EncodedForm } from "../core/encoded-form.js";
import { ENCODE_SSKR_ONLY_OPTIONS } from "./encode-option-groups.js";
import type { MaskingMode, EncodedFormat } from "../core/types.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import type { EncodeOutcome, PreparedEncode } from "./encode-types.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.encode-command", {
  "setting-available-only-sskr-mode": (value0: string) =>
    `The ${value0} setting is available only in SSKR mode.`,
  "terminal-color-cards-available-only-rgb-color-formats": (value0: string) =>
    `Terminal color cards are available only for RGB color formats ${value0}.`,
});

async function validateEncodeOptions(args: ParsedArguments): Promise<{
  mode: MaskingMode;
  format: EncodedFormat;
  originalCopy: boolean;
}> {
  for (const key of ENCODE_SSKR_ONLY_OPTIONS) {
    if (args[key] !== undefined)
      throw ERRORS.create("setting-available-only-sskr-mode", [`${optionLabel(key)}`]);
  }
  const mode = transformMode(args);
  const originalCopy = originalCopyRequested(args);
  maskedWordsRequested(args, mode);
  const format = encodeFormat(value(args, "format"));
  EncodedBackup.assertEncodable(mode, { validLastWord: args["legacy-valid-last-word"] === true });
  assertDateInputMode(args, mode);
  // The sheet leads through the menu, whose Decode does not offer a replaced last word.
  const replacement = Masking.of(mode).withValidLastWord;
  if (
    args["legacy-valid-last-word"] === true &&
    replacement !== undefined &&
    args["heir-sheet"] !== undefined
  )
    Masking.assertHeirSheetMode(replacement.mode);
  if (args.cards === true && !EncodedForm.of(format).writtenInColors)
    throw ERRORS.create("terminal-color-cards-available-only-rgb-color-formats", [
      `${COLOR_FORMAT_NUMBERS}`,
    ]);
  validateCardOptions(args, format);
  // Validate all destinations before prompting or reading a mnemonic.
  await preflightOutputs(args);
  return { mode, format, originalCopy };
}

async function createOutcome(
  args: ParsedArguments,
  mode: MaskingMode,
  format: EncodedFormat,
  known: string | undefined,
): Promise<EncodeOutcome | Cancelled> {
  const asked = await phraseAndDates(args, mode, undefined, known);
  if (asked === CANCELLED) return CANCELLED;
  const { mnemonic, dates: enteredDates } = asked;
  const encoding = EncodedBackup.encode(mnemonic, enteredDates, format, mode, {
    validLastWord: args["legacy-valid-last-word"] === true,
  });
  return { encoding, mode, enteredDates };
}

/**
 * Encode's results that go to a file or a new folder, in the order saveEncodeResult saves them,
 * each with its name in a sentence (ResultName).
 */
const SAVED_RESULTS = [
  ["output", { what: "The record" }],
  ["pdf", { what: "The PDF" }],
  ["images-dir", { what: "The images", plural: true }],
  ["cards-dir", { what: "The card files", plural: true }],
  ["qr", { what: "The QR code" }],
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

/**
 * Saves every result of Encode that the options name, each on its own (saveOutput), with `saving`,
 * the run's one object of options (onlyResult), and one retained library card plan. CANCELLED when
 * the command was cancelled at the question after a failed save; what was saved before stays.
 */
async function saveResults(
  args: ParsedArguments,
  saving: ParsedArguments,
  outcome: EncodeOutcome,
): Promise<Cancelled | undefined> {
  const saved = new Map<string, string>();
  using cards = new EncodeCardExport(saving, outcome);
  for (const [key, name] of SAVED_RESULTS) {
    const path = await saveOutput(args, key, name, (path) =>
      saveEncodeResult(onlyResult(saving, key, path), outcome, cards),
    );
    if (path === CANCELLED) return CANCELLED;
    if (path !== undefined) saved.set(key, path);
    // The colour cards on the terminal come after the record, as saveEncodeResult shows them.
    if (key === "output" && args.cards === true)
      await saveEncodeResult(onlyResult(saving, "cards", true), outcome, cards);
  }
  return await saveSheetQr(args, outcome, saved);
}

/**
 * The QR code that the sheets print with --card-qr, in every form, also saved as an image where
 * they were saved: beside the PDF, or else in the folder of their images. Decode reads it back
 * (--qr-file). Not when --qr names an image of its own, which holds the same codes.
 */
async function saveSheetQr(
  args: ParsedArguments,
  outcome: EncodeOutcome,
  saved: ReadonlyMap<string, string>,
): Promise<Cancelled | undefined> {
  const { backup } = outcome.encoding;
  if (args["card-qr"] !== true || value(args, "qr") !== undefined) return;
  const pdf = saved.get("pdf");
  const images = saved.get("images-dir");
  if (pdf === undefined && images === undefined) return;
  const path =
    pdf === undefined
      ? await saveQrInside(backup.text(), defined(images))
      : await saveQrBeside(backup.text(), pdf);
  if (path === CANCELLED) return CANCELLED;
  if (path !== undefined)
    terminalSaved(`Saved the QR code of the sheet as an image: ${printableText(path)}`);
}

export async function runEncode(args: ParsedArguments): Promise<Cancelled | undefined> {
  const encode = await prepareEncode(args);
  return encode();
}

/**
 * Checks every option of Encode, the destinations and the cards included, before any secret is
 * asked or read, and gives what then encodes (PreparedEncode): a plain backup, or with --sskr its
 * shares (prepareSskrSplit).
 */
export async function prepareEncode(args: ParsedArguments): Promise<PreparedEncode> {
  if (args.sskr === true) return prepareSskrSplit(args, true);
  const { mode, format, originalCopy } = await validateEncodeOptions(args);
  const checkAnswer = backupCheckAnswer(args);
  const saving: ParsedArguments = { ...args };
  // A detail too long for its card is refused before a secret is asked, not after the result is
  // shown.
  const fit = args["ask-secrets"] === true ? colorCardsFit(saving, format) : undefined;
  if (fit !== undefined) {
    terminalWork("Checking that the cards can be printed…");
    await fit();
  }
  return (known) => encodeChecked(args, saving, { mode, format, checkAnswer, originalCopy }, known);
}

/** What prepareEncode checked: the mode, the form and the answer to the backup check. */
interface CheckedEncode {
  readonly mode: MaskingMode;
  readonly format: EncodedFormat;
  readonly originalCopy: boolean;
  readonly checkAnswer: ReturnType<typeof backupCheckAnswer>;
}

/** Encodes the phrase, asked, read or `known`, and saves and shows what the options ask for. */
async function encodeChecked(
  args: ParsedArguments,
  saving: ParsedArguments,
  { mode, format, checkAnswer, originalCopy }: CheckedEncode,
  known: string | undefined,
): Promise<Cancelled | undefined> {
  const outcome = await createOutcome(args, mode, format, known);
  if (outcome === CANCELLED) return CANCELLED;
  using backup = outcome.encoding.backup;
  const show = (): void =>
    printEncodeResult(outcome, maskedWordsRequested(args, mode), originalCopy);
  // The result is a step of its own: the questions are cleared away (CORE-39).
  clearPrivateScreen();
  show();
  if ((await saveResults(args, saving, outcome)) === CANCELLED) return CANCELLED;
  const { result } = outcome.encoding;
  // A record with a replaced last word never gets a sheet (validateEncodeOptions).
  const sheet = Masking.isHeirSheetMode(backup.mode)
    ? await saveHeirSheetOutput(args, {
        backup: { kind: "encoded", format: backup.format, words: backup.words },
        mode: backup.mode,
        dates: outcome.enteredDates.length,
      })
    : undefined;
  if (sheet === CANCELLED) return CANCELLED;
  RenamedOutputs.report();
  return await offerEncodedCheck(
    {
      mnemonic: result.sourceMnemonic,
      format: backup.format,
      mode: backup.mode,
      codes: backup.indexes,
      dates: outcome.enteredDates,
    },
    show,
    checkAnswer,
  );
}
