// sskr-split: a seed phrase split into Shamir shares (SSKR), written in the form asked for and
// saved where the options say (sskr-output.ts).

import { terminalNotice, terminalResultHeader } from "./terminal.js";
import { reportRenamedOutputs } from "./output-paths.js";
import { assertSingleValues, integerOption, value, type ParsedArguments } from "./arguments.js";
import { encodeFormat, phraseAndDates, transformMode } from "./input.js";
import { DATE_COUNT_WORDS, Masking } from "../core/masking.js";
import { masterFingerprint } from "../bitcoin-evidence.js";
import { splitSskrBackup } from "../sskr/shares.js";
import { ShareSetChoice } from "../core/backup-options.js";
import { EncodedBackup } from "../core/encoded-backup.js";
import { assertSskrSelfTest } from "../sskr/self-test.js";
import { DEFAULT_SHARE_FORMAT } from "../sskr/transport.js";
import { optionLabel } from "./option-copy.js";
import { backupCheckAnswer, offerShareCheck } from "./backup-check.js";
import { printEncodedBackup, printFingerprints } from "./encode-report.js";
import { preflightOutputs, saveHeirSheetOutput } from "./output-saving.js";
import { exportOptions, inForm, printShares, saveShares, shareFormat } from "./sskr-output.js";
import { ENCODE_PLAIN_ONLY_OPTIONS } from "./encode-option-groups.js";

export async function runSskrSplit(args: ParsedArguments, integrated = false): Promise<void> {
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
        throw new Error(
          `The ${optionLabel(key)} setting is not available in SSKR mode. Export shares to a PDF file or an individual-card output folder instead.`,
        );
  }
  // With --format the whole seed phrase is shown beside the shares, in that form; without it, only
  // the shares, which is what splitting is for.
  const representation =
    integrated && value(args, "format") !== undefined
      ? encodeFormat(value(args, "format"))
      : undefined;
  const format = integrated
    ? shareFormat({ format: value(args, "share-format") ?? DEFAULT_SHARE_FORMAT })
    : shareFormat(args);
  const options = exportOptions(args, format);
  await preflightOutputs(args);
  const mode = transformMode(args);
  Masking.assertSplitMode(mode);
  // Before the first question: a failure here is no answer's fault, and nothing typed is lost.
  await assertSskrSelfTest();
  const { mnemonic, dates: dateValues } = await phraseAndDates(args, mode, DATE_COUNT_WORDS.split);
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
  await saveShares(inForm(shares, format), args, options, Masking.of(mode).masked);
  await saveHeirSheetOutput(args, {
    backup: { kind: "shares", format, threshold, count },
    mode,
    dates: dateValues.length,
  });
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
  if (representation !== undefined) {
    printEncodedBackup(EncodedBackup.encode(mnemonic, dateValues, representation, mode).backup);
    // Shown for a person who keeps the whole phrase too, with the shares as a reserve.
    terminalNotice(
      Masking.of(mode).masked
        ? "This is the complete backup: no share is needed, but the original dates are still required."
        : "This is the whole seed phrase: it restores the wallet without any share.",
      "warning",
    );
  }
  printShares(inForm(shares, format), undefined, Masking.of(mode).holds);
  printFingerprints(mode, masterFingerprint(original), masterFingerprint(held));
  await offerShareCheck(
    original,
    mode,
    threshold,
    () => printShares(inForm(shares, format), undefined, Masking.of(mode).holds),
    checkAnswer,
    dateValues,
  );
}
