import { type DateShiftDate } from "../core.js";
import { Masking } from "../core/masking.js";
import { type ParsedArguments, value } from "./arguments.js";
import { dates, encodeFormat, transformMode, phraseAndDates } from "./input.js";
import { validateCardOptions, cardOutputs } from "./card-options.js";
import { businessOptions, TYPED_CARD_TEXT_OPTIONS } from "./business-options.js";
import { type CardSettings, assertSheetQr } from "../export/card-settings.js";
import { reportRenamedOutputs } from "./output-paths.js";
import { prepareSskrSplit } from "./sskr-command.js";
import { printEncodeResult, maskedWordsRequested } from "./encode-report.js";
import { backupCheckAnswer, offerEncodedCheck } from "./backup-check.js";
import { EncodeCardExport, saveEncodeResult } from "./encode-export.js";
import { optionLabel } from "./option-copy.js";
import { saveQrBeside, saveQrInside } from "./qr-export.js";
import { terminalNotice, terminalWork } from "./terminal.js";
import { EncodedBackup, type Encoding } from "../core/encoded-backup.js";
import { COLOR_FORMAT_NUMBERS } from "./format-numbers.js";
import { preflightOutputs, saveHeirSheetOutput, saveOutput } from "./output-saving.js";
import { writtenInColors } from "../core/backup-options.js";
import { CardPreview, LONGEST_SAMPLE_WORDS } from "../export/card-preview.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { ENCODE_SSKR_ONLY_OPTIONS } from "./encode-option-groups.js";
import type { MaskingMode, EncodedFormat } from "../core/types.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.encode-command", {
  "setting-available-only-sskr-mode": (value0: string) =>
    `The ${value0} setting is available only in SSKR mode.`,
  "terminal-color-cards-available-only-rgb-color-formats": (value0: string) =>
    `Terminal color cards are available only for RGB color formats ${value0}.`,
});

/** What Encode made: the library's encoding, with the mode as asked and the dates as typed. */
export interface EncodeOutcome {
  /** The codes and the mode their record names, as EncodedBackup.encode made them. */
  readonly encoding: Encoding;
  /** The mode as asked, before any replacement of the last word (Encoding.replaced). */
  readonly mode: MaskingMode;
  readonly enteredDates: readonly DateShiftDate[];
}

async function validateEncodeOptions(
  args: ParsedArguments,
): Promise<{ mode: MaskingMode; format: EncodedFormat }> {
  for (const key of ENCODE_SSKR_ONLY_OPTIONS) {
    if (args[key] !== undefined)
      throw ERRORS.create("setting-available-only-sskr-mode", [`${optionLabel(key)}`]);
  }
  const mode = transformMode(args);
  maskedWordsRequested(args, mode);
  const format = encodeFormat(value(args, "format"));
  EncodedBackup.assertEncodable(mode, { validLastWord: args["legacy-valid-last-word"] === true });
  // Dates given as options fit the mode before any secret is read; asked ones are checked then.
  if (args["ask-secrets"] !== true) Masking.of(mode).assertDateCount(dates(args).length);
  // The sheet leads through the menu, whose Decode does not offer a replaced last word.
  const replacement = Masking.of(mode).withValidLastWord;
  if (
    args["legacy-valid-last-word"] === true &&
    replacement !== undefined &&
    args["heir-sheet"] !== undefined
  )
    Masking.assertHeirSheetMode(replacement.mode);
  if (args.cards === true && !writtenInColors(format))
    throw ERRORS.create("terminal-color-cards-available-only-rgb-color-formats", [
      `${COLOR_FORMAT_NUMBERS}`,
    ]);
  validateCardOptions(args, format);
  // Validate all destinations before prompting or reading a mnemonic.
  await preflightOutputs(args);
  return { mode, format };
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

/** The card options whose text the person writes: the details, the card copy and the heading. */
const TYPED_CARD_TEXTS = [...TYPED_CARD_TEXT_OPTIONS, "title"] as const;

/**
 * Whether the card options may keep the cards from being printed, after refusing at once a QR code
 * on separate cards (assertSheetQr, the renderers' own rule). Random card details come from lists
 * that fit every design (test/card-identities.test.ts); what can fail is a text the person typed.
 */
function cardsMayFail(saving: ParsedArguments, settings: CardSettings): boolean {
  assertSheetQr({ ...settings, kind: "colors" });
  return TYPED_CARD_TEXTS.some((key) => saving[key] !== undefined);
}

/**
 * Draws in memory the colour cards that the options ask for, with the longest public sample phrase
 * in `format` and the card details of `saving` (CardPreview.assertColorsPrint), where the options
 * may keep them from being printed (cardsMayFail): a detail too long for its card is so refused
 * before a secret is asked, not after the result is shown. A render takes seconds, so it is not
 * made where nothing can fail. Nothing is written.
 */
async function assertCardsPrintable(saving: ParsedArguments, format: EncodedFormat): Promise<void> {
  if (!writtenInColors(format)) return;
  const { sheets, cards } = cardOutputs(saving);
  const settings = businessOptions(saving);
  if ((!sheets && !cards) || !cardsMayFail(saving, settings)) return;
  const preview = new CardPreview(nodeCardRenderer, {
    words: LONGEST_SAMPLE_WORDS,
    settings,
    title: value(saving, "title"),
    colorForm: format,
  });
  terminalWork("Checking that the cards can be printed…");
  await preview.assertColorsPrint(value(saving, "template"), { sheets, cards });
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
  const cards = new EncodeCardExport(saving, outcome);
  for (const [key, what] of SAVED_RESULTS) {
    const path = await saveOutput(args, key, what, (path) =>
      saveEncodeResult(onlyResult(saving, key, path), outcome, cards),
    );
    if (path === CANCELLED) return CANCELLED;
    if (path !== undefined) saved.set(key, path);
    // The colour cards on the terminal come after the record, as saveEncodeResult shows them.
    if (key === "output" && args.cards === true)
      await saveEncodeResult(onlyResult(saving, "cards", true), outcome, cards);
  }
  return saveSheetQr(args, outcome, saved);
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
    terminalNotice(`Saved the QR code of the sheet as an image: ${path}`, "success");
}

/**
 * Encode once its options are checked: it asks for the phrase, or reads it, unless it is `known`,
 * which Re-encode decoded and confirmed, then its dates, and makes and saves the backup.
 * CANCELLED when the person cancelled it.
 */
export type PreparedEncode = (known?: string) => Promise<Cancelled | undefined>;

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
  const { mode, format } = await validateEncodeOptions(args);
  const checkAnswer = backupCheckAnswer(args);
  const saving: ParsedArguments = { ...args };
  if (args["ask-secrets"] === true) await assertCardsPrintable(saving, format);
  return (known) => encodeChecked(args, saving, { mode, format, checkAnswer }, known);
}

/** What prepareEncode checked: the mode, the form and the answer to the backup check. */
interface CheckedEncode {
  readonly mode: MaskingMode;
  readonly format: EncodedFormat;
  readonly checkAnswer: ReturnType<typeof backupCheckAnswer>;
}

/** Encodes the phrase, asked, read or `known`, and saves and shows what the options ask for. */
async function encodeChecked(
  args: ParsedArguments,
  saving: ParsedArguments,
  { mode, format, checkAnswer }: CheckedEncode,
  known: string | undefined,
): Promise<Cancelled | undefined> {
  const outcome = await createOutcome(args, mode, format, known);
  if (outcome === CANCELLED) return CANCELLED;
  const show = (): void => printEncodeResult(outcome, maskedWordsRequested(args, mode));
  show();
  if ((await saveResults(args, saving, outcome)) === CANCELLED) return CANCELLED;
  const { backup, result } = outcome.encoding;
  // A record with a replaced last word never gets a sheet (validateEncodeOptions).
  const sheet = Masking.isHeirSheetMode(backup.mode)
    ? await saveHeirSheetOutput(args, {
        backup: { kind: "encoded", format: backup.format, words: backup.words },
        mode: backup.mode,
        dates: outcome.enteredDates.length,
      })
    : undefined;
  if (sheet === CANCELLED) return CANCELLED;
  reportRenamedOutputs();
  return offerEncodedCheck(
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
