// sskr-split: a seed phrase split into Shamir shares (SSKR), written in the form asked for and
// saved where the options say (sskr-output.ts).

import { terminalNotice, terminalResultHeader } from "./terminal.js";
import { ownShareCards } from "../export/sskr-render.js";
import { reportRenamedOutputs } from "./output-paths.js";
import {
  assertSingleValues,
  integerOption,
  value,
  choiceOption,
  type ParsedArguments,
} from "./arguments.js";
import { assertDateInputMode, encodeFormat, phraseAndDates, transformMode } from "./input.js";
import { DATE_COUNT_WORDS, Masking, type SplitMode } from "../core/masking.js";
import { masterFingerprint } from "../bitcoin-evidence.js";
import { splitSskrBackup } from "../sskr/shares.js";
import { ShareSetChoice } from "../core/backup-options.js";
import { EncodedBackup } from "../core/encoded-backup.js";
import { assertSskrSelfTest } from "../sskr/self-test.js";
import { DEFAULT_SHARE_FORMAT, type ShareFormat } from "../sskr/transport.js";
import { optionLabel } from "./option-copy.js";
import { backupCheckAnswer, offerShareCheck } from "./backup-check.js";
import {
  printEncodedBackup,
  printFingerprints,
  printOriginalCopy,
  ORIGINAL_COPY_FORMS,
  type OriginalCopyForm,
  maskedWordsRequested,
  printMaskedWords,
} from "./encode-report.js";
import { preflightOutputs, saveHeirSheetOutput } from "./output-saving.js";
import {
  assertShareCardsPrintable,
  exportOptions,
  inForm,
  printShares,
  saveShares,
  shareFormat,
} from "./sskr-output.js";
import { ENCODE_PLAIN_ONLY_OPTIONS } from "./encode-option-groups.js";
import type { EncodedFormat } from "../core/types.js";
// The type alone: encode-command.ts runs this module for --sskr, and a value import would be a
// cycle.
import type { PreparedEncode } from "./encode-command.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.sskr-split-command", {
  "setting-not-available-sskr-mode-export-shares-pdf": (value0: string) =>
    `The ${value0} setting is not available in SSKR mode. Export shares to a PDF file or an individual-card output folder instead.`,
  "original-codes-need-format": () => "Choose --format to show the original seed phrase in codes.",
});

export async function runSskrSplit(
  args: ParsedArguments,
  integrated = false,
): Promise<Cancelled | undefined> {
  const split = await prepareSskrSplit(args, integrated);
  return split();
}

/**
 * Checks every option of the split, the destinations included, and the SSKR engine itself, before
 * any secret is asked or read, and gives what then splits the phrase: asked, read, or `known`, as
 * Re-encode decoded and confirmed it. Encode --sskr is `integrated`.
 */
export async function prepareSskrSplit(
  args: ParsedArguments,
  integrated = false,
): Promise<PreparedEncode> {
  assertSingleValues(args, ["date"]);
  const checkAnswer = backupCheckAnswer(args);
  // Each number within SSKR's bounds, then the two together, as the menu and a page check them.
  const { threshold, count } = ShareSetChoice.of(
    integerOption(args, "threshold", ShareSetChoice.RANGE),
    integerOption(args, "shares", ShareSetChoice.RANGE),
  );
  if (integrated) {
    for (const key of ENCODE_PLAIN_ONLY_OPTIONS)
      if (args[key] !== undefined)
        throw ERRORS.create("setting-not-available-sskr-mode-export-shares-pdf", [
          `${optionLabel(key)}`,
        ]);
  }
  // With --format the whole seed phrase is shown beside the shares, in that form; without it, only
  // the shares, which is what splitting is for.
  const representation =
    integrated && value(args, "format") !== undefined
      ? encodeFormat(value(args, "format"))
      : undefined;
  const originalCopy = integrated
    ? choiceOption(args, "show-original", ORIGINAL_COPY_FORMS)
    : undefined;
  if (originalCopy !== undefined && originalCopy !== "words" && representation === undefined)
    throw ERRORS.create("original-codes-need-format", []);
  const format = integrated
    ? shareFormat({ format: value(args, "share-format") ?? DEFAULT_SHARE_FORMAT })
    : shareFormat(args);
  const options = exportOptions(args, format);
  await preflightOutputs(args);
  await assertShareCardsPrintable(options);
  const mode = transformMode(args);
  const maskedWords = maskedWordsRequested(args, mode);
  Masking.assertSplitMode(mode);
  assertDateInputMode(args, mode, DATE_COUNT_WORDS.split);
  // Before the first question: a failure here is no answer's fault, and nothing typed is lost.
  await assertSskrSelfTest();
  return (known) =>
    splitChecked(
      args,
      {
        mode,
        threshold,
        count,
        format,
        options,
        representation,
        originalCopy,
        maskedWords,
        checkAnswer,
      },
      known,
    );
}

/** What prepareSskrSplit checked. */
interface CheckedSplit {
  readonly mode: SplitMode;
  readonly threshold: number;
  readonly count: number;
  readonly format: ShareFormat;
  readonly options: ReturnType<typeof exportOptions>;
  readonly representation: EncodedFormat | undefined;
  readonly originalCopy: OriginalCopyForm | undefined;
  readonly maskedWords: boolean;
  readonly checkAnswer: ReturnType<typeof backupCheckAnswer>;
}

/**
 * Splits the phrase, asked, read or `known`, and saves and shows the shares; CANCELLED when the
 * person cancelled.
 */
async function splitChecked(
  args: ParsedArguments,
  checked: CheckedSplit,
  known: string | undefined,
): Promise<Cancelled | undefined> {
  const {
    mode,
    threshold,
    count,
    format,
    options,
    representation,
    originalCopy,
    maskedWords,
    checkAnswer,
  } = checked;
  const asked = await phraseAndDates(args, mode, DATE_COUNT_WORDS.split, known);
  if (asked === CANCELLED) return CANCELLED;
  const { mnemonic, dates: dateValues } = asked;
  const {
    records: shares,
    original,
    held,
  } = await splitSskrBackup({
    mnemonic,
    mode,
    dates: dateValues,
    threshold,
    count,
  });
  // A save that fails is offered again or skipped (saveWithRetry): the shares are shown below
  // either way, and only once every save is settled, so that none is lost to a failure.
  if (
    (await saveShares(inForm(shares, format), args, options, Masking.of(mode).masked)) === CANCELLED
  )
    return CANCELLED;
  const codes = ownShareCards(defined(shares[0]), format);
  const sheet = await saveHeirSheetOutput(args, {
    backup: { kind: "shares", format, threshold, count, ...(codes === undefined ? {} : { codes }) },
    mode,
    dates: dateValues.length,
  });
  if (sheet === CANCELLED) return CANCELLED;
  reportRenamedOutputs();
  if (
    !terminalResultHeader("SSKR export", [
      ["Threshold", `${threshold} of ${count}`],
      ["Mode", mode],
      ["Layout", options?.layout ?? "text"],
    ])
  )
    terminalNotice(`SSKR: ${threshold} of ${count} shares required. Mode: ${mode}.`);
  terminalNotice(`The shares hold ${Masking.of(mode).holds}.`);
  if (Masking.of(mode).masked)
    terminalNotice("The shares do not store the dates or the mode; keep them yourself.");
  if (representation !== undefined && originalCopy === undefined) {
    using backup = EncodedBackup.encode(mnemonic, dateValues, representation, mode).backup;
    printEncodedBackup(backup);
    // Shown for a person who keeps the whole phrase too, with the shares as a reserve.
    terminalNotice(
      Masking.of(mode).masked
        ? "This is the complete backup: no share is needed, but the original dates are still required."
        : "This is the whole seed phrase: it restores the wallet without any share.",
      "warning",
    );
  }
  // The optional original copy comes last, so it remains in view after long share blocks.
  const show = async (): Promise<Cancelled | undefined> => {
    if (
      (await printShares(inForm(shares, format), undefined, Masking.of(mode).holds)) === CANCELLED
    )
      return CANCELLED;
    // An English complete backup was already shown by the older --format-only form.
    if (maskedWords && !(originalCopy === undefined && representation === "english"))
      printMaskedWords(held, mode);
    if (originalCopy !== undefined) printOriginalCopy(original, originalCopy, representation);
  };
  if ((await show()) === CANCELLED) return CANCELLED;
  printFingerprints(mode, masterFingerprint(original), masterFingerprint(held));
  return offerShareCheck(original, mode, threshold, show, checkAnswer, dateValues);
}
