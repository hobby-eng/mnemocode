// sskr-split, sskr-combine and sskr-export: a seed phrase split into Shamir shares (SSKR), and
// shares typed or read back to restore the phrase or to write the shares again. From the command
// line every input is given, and one that cannot be used ends the command. With --ask-secrets, on
// the private screen, each answer is checked as soon as it is given: a share that cannot be used
// is named and typed again, or left out, a date is asked again, and a result that cannot be used
// offers what to change; every other answer is kept (share-repair.ts, ask.ts, date-search.ts). A
// file that cannot be saved is offered again, under another name, or skipped (save-retry.ts), and
// what was made is still shown. What the shares are, and the phrases they give with the dates, the
// library decides (sskr/share-input.ts, share-set.ts, share-unmasking.ts).

import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { imageFormat, validateImageOptions } from "./image-options.js";
import { allTemplateStyles } from "../export/templates.js";
import { clearPrivateScreen } from "./private-screen.js";
import { resolveSskrLayout } from "../export/sskr-content.js";
import {
  capitalized,
  FINGERPRINT_NOTE,
  readmeLink,
  terminalColor,
  terminalFingerprint,
  terminalHint,
  terminalNotice,
  terminalPart,
  terminalPhrase,
  terminalResultHeader,
  terminalStatus,
  wrapText,
} from "./terminal.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { preflightFileDestination, reportRenamedOutputs } from "./output-paths.js";
import { integerOption, value, values, type ParsedArguments } from "./arguments.js";
import {
  encodeFormat,
  encodedOutputLabel,
  dates,
  promptedEncodeInputs,
  readBoundedTextFile,
  textInput,
  transformMode,
} from "./input.js";
import { businessOptions, businessOptionNames } from "./business-options.js";
import { formatEncoded, representMnemonic } from "../core.js";
import { DatesAnswer, MAX_SHOWN_MATCHES } from "../core/date-search.js";
import { Masking, PHRASE_WORDS } from "../core/masking.js";
import {
  assertWalletEvidence,
  masterFingerprint,
  walletCheckOf,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { planShareRepair, splitSskrMnemonic, validateThreshold } from "../sskr/shares.js";
import { assertSskrSelfTest } from "../sskr/self-test.js";
import type { ReadRepairableShare } from "../sskr/repair.js";
import { readShare, writeShare, type ShareFormat } from "../sskr/transport.js";
import type { JointPlan, RepairedSet } from "../sskr/joint-repair.js";
import { NO_PHRASE_FITS, RepairReport, type DateWork } from "../sskr/repair-report.js";
import { ShareInput } from "../sskr/share-input.js";
import { SHARE_FORMAT_NAMES, ShareExport, ShareSet, type WrittenShare } from "../sskr/share-set.js";
import { ShareUnmasking, type UnmaskedPhrase } from "../sskr/share-unmasking.js";
import { bip39Passphrase, walletEvidence } from "./bitcoin-options.js";
import {
  assessShares,
  askShareFix,
  mendShares,
  reportRepairs,
  searchLimit,
  searchShareRepair,
  TypedShares,
  type FirstShare,
  type ShareRepair,
} from "./share-repair.js";
import {
  exportSskrCards,
  exportSskrPdf,
  exportSskrImages,
  type SskrExportOptions,
  type SskrRenderOptions,
} from "../export/sskr-cards.js";
import { ShareCardSet, type ShareQrCode } from "../export/sskr-render.js";
import { saveQrBeside, saveQrInside } from "./qr-export.js";
import { requireNewCardDirectory } from "../export/individual-cards.js";
import { decodeQrPngFile } from "./qr-input.js";
import { evidenceLabel, optionLabel } from "./option-copy.js";
import { backupCheckAnswer, offerShareCheck } from "./backup-check.js";
import {
  assertListable,
  candidatesTarget,
  prepareCandidates,
  saveCandidates,
  type CandidatesTarget,
} from "./candidates-file.js";
import { saveHeirSheet, validateHeirSheetOptions, type HeirSheetFacts } from "./heir-sheet.js";
import { dropTypedAhead, InputCancelled, withCtrlCWatch } from "./terminal-input.js";
import {
  askAfterFailure,
  askWalletEvidence,
  assertWalletPlaceUsed,
  walletPlaceOf,
  type WalletPlace,
} from "./ask.js";
import {
  askDates,
  dateSearchRun,
  withDateProgress,
  KEPT_FOR_LIST,
  maxCandidatesOf,
  PROGRESS_EVERY,
  showEncodedFingerprint,
} from "./date-search.js";
import { saveWithRetry } from "./save-retry.js";
import { choose, waitForEnter, type Explanation } from "./terminal-choice.js";

export const sskrExportOptions = [
  "cards-dir",
  "card-layout",
  "template",
  ...businessOptionNames,
] as const;
export const sskrInputOptions = ["share", "share-file", "share-qr", "ask-secrets"] as const;

function singleOptions(args: ParsedArguments, repeatable: readonly string[] = []): void {
  for (const [key, val] of Object.entries(args)) {
    if (!repeatable.includes(key) && Array.isArray(val))
      throw new Error(`Provide only one value for the ${optionLabel(key)} setting.`);
  }
}

function exportOptions(
  args: ParsedArguments,
  shareFormat: ShareFormat,
): SskrExportOptions | undefined {
  const directory = value(args, "cards-dir");
  const pdf = value(args, "pdf");
  const images = value(args, "images-dir");
  if (!directory && !pdf && !images) {
    if (sskrExportOptions.some((key) => args[key] !== undefined))
      throw new Error(
        "SSKR card settings require an individual-card output folder, a PDF file, or an image output folder.",
      );
    return undefined;
  }
  if (directory !== undefined && !directory.trim())
    throw new Error("The individual-card output folder path must not be empty.");
  const template = value(args, "template") ?? "business-it";
  const entries = Object.entries(allTemplateStyles);
  const style =
    entries.find(([id]) => id === template)?.[1] ??
    (/^[1-9][0-9]*$/u.test(template) ? entries[Number(template) - 1]?.[1] : undefined);
  if (!style)
    throw new Error(
      "The selected business-card template is not available. View the template list to choose a supported design.",
    );
  const requested = value(args, "card-layout");
  if (
    requested !== undefined &&
    requested !== "qr" &&
    requested !== "collection" &&
    requested !== "individual"
  )
    throw new Error("The card layout must be qr, collection, or individual.");
  const settings = businessOptions(args, template);
  return {
    ...settings,
    style,
    // Resolved here so that the messages below describe what is actually written.
    layout: resolveSskrLayout(requested, settings.pageSize),
    directory: directory ?? "",
    imageFormat: args["image-format"] === undefined ? undefined : imageFormat(args),
    shareFormat,
  };
}

function shareFormat(args: ParsedArguments): ShareFormat {
  const format = value(args, "format") ?? "ur";
  if (!Object.hasOwn(SHARE_FORMAT_NAMES, format))
    throw new Error(
      "The SSKR share format must be ur, words, indexes, unicode, colors or colors-unicode. These are share formats, not BIP39 representations.",
    );
  return format as ShareFormat;
}

/** Shares in the same form, in their order, as a split makes them. */
function inForm(shares: readonly string[], format: ShareFormat): WrittenShare[] {
  return shares.map((ur, index) => ({ ur, format, number: index + 1 }));
}

/**
 * Prints shares as "SSKR share N of M", by their places among the `total` made or typed, with what
 * they hold where that is known (PHRASE_WORDS), so that a masked phrase is not taken for the
 * wallet's.
 */
function printShares(
  shares: readonly WrittenShare[],
  total: number = shares.length,
  holds?: string,
): void {
  for (const share of shares) {
    const form = SHARE_FORMAT_NAMES[share.format];
    const facts: [string, string][] = [["Format", form]];
    if (holds !== undefined) facts.push(["Holds", holds]);
    if (!terminalResultHeader(`SSKR share ${share.number} of ${total}`, facts))
      console.error(
        `SSKR share ${share.number} — ${form}${holds === undefined ? "" : `, holds ${holds}`}:`,
      );
    console.log(writeShare(share.ur, share.format));
  }
}

// Saving, with a choice after a failure (save-retry.ts).

/** How another name for a file or a folder of share outputs is checked before it is used. */
function checkedName(kind: "file" | "folder"): (path: string) => Promise<void> {
  return async (path) => {
    if (kind === "file") await preflightFileDestination(path, false);
    else await requireNewCardDirectory(path);
  };
}

/** Saves the shares where the options say, each output with saveWithRetry. */
async function saveShares(
  shown: readonly WrittenShare[],
  args: ParsedArguments,
  options?: SskrExportOptions,
): Promise<void> {
  const shares = shown.map((share) => share.ur);
  if (options?.directory) {
    let count = 0;
    const directory = await saveWithRetry({
      what: "The folder of share cards",
      kind: "folder",
      checkName: checkedName("folder"),
      path: options.directory,
      write: async (directory) => {
        count = await exportSskrCards(shares, { ...options, directory });
      },
    });
    if (directory !== undefined) {
      terminalNotice(
        `Saved ${count} ${(options.imageFormat ?? "pdf").toUpperCase()} files to: ${directory}`,
        "success",
      );
      await saveShareQrs(shares, options, (code) =>
        saveQrInside(code.payload, directory, `collection-${code.reference}`),
      );
      if (options.layout === "individual")
        terminalNotice("Each folder is one share; keep all its cards together.");
      else
        terminalNotice(
          options.imageFormat
            ? "Each member collection contains ONE SSKR share. Keep its numbered pages together; store different shares separately."
            : "Each PDF contains ONE SSKR share. Store different shares separately.",
        );
    }
  }
  const pdf = value(args, "pdf");
  if (pdf && options) {
    const saved = await saveWithRetry({
      what: "The PDF of the shares",
      kind: "file",
      checkName: checkedName("file"),
      path: pdf,
      write: (path) => exportSskrPdf(shares, options, path),
    });
    if (saved !== undefined) {
      terminalNotice(
        `Saved SSKR collection PDF: ${saved} (contains all supplied shares).`,
        "success",
      );
      await saveShareQrs(shares, options, (code) =>
        saveQrBeside(code.payload, saved, `-${code.reference}`),
      );
    }
  }
  const images = value(args, "images-dir");
  if (images && options) {
    let count = 0;
    const saved = await saveWithRetry({
      what: "The folder of share images",
      kind: "folder",
      checkName: checkedName("folder"),
      path: images,
      write: async (directory) => {
        count = await exportSskrImages(shares, options, directory, imageFormat(args));
      },
    });
    if (saved !== undefined) {
      terminalNotice(
        `Saved ${count} ${imageFormat(args).toUpperCase()} SSKR pages to: ${saved} (contains all supplied shares).`,
        "success",
      );
      await saveShareQrs(shares, options, (code) =>
        saveQrInside(code.payload, saved, `collection-${code.reference}`),
      );
    }
  }
  const output = value(args, "output");
  if (output) {
    // Each share in its form, as the terminal shows it.
    const lines = shown.map((share) => writeShare(share.ur, share.format));
    const saved = await saveWithRetry({
      what: "The file of the shares",
      kind: "file",
      checkName: checkedName("file"),
      path: output,
      write: (path) =>
        publishNewPrivateFile(path, new TextEncoder().encode(lines.join("\n") + "\n")),
    });
    if (saved !== undefined)
      terminalNotice(
        `Saved SSKR records: ${saved} (one complete share per line; this file contains all supplied shares).`,
        "success",
      );
  }
}

/** Saves the sheet for heirs when --heir-sheet names a file, with saveWithRetry. */
async function saveHeirSheetWithRetry(args: ParsedArguments, facts: HeirSheetFacts): Promise<void> {
  const path = value(args, "heir-sheet");
  if (path === undefined) return;
  await saveWithRetry({
    what: "The sheet for heirs",
    kind: "file",
    checkName: checkedName("file"),
    path,
    write: (path) => saveHeirSheet({ ...args, "heir-sheet": path }, facts),
  });
}

async function destinations(args: ParsedArguments, options?: SskrExportOptions): Promise<void> {
  await validateImageOptions(args);
  validateHeirSheetOptions(args);
  if (options?.directory) await requireNewCardDirectory(options.directory);
  const paths = [value(args, "output"), value(args, "pdf"), value(args, "heir-sheet")].filter(
    (p): p is string => p !== undefined,
  );
  for (const path of paths) await preflightFileDestination(path, false);
}

export async function runSskrSplit(args: ParsedArguments, integrated = false): Promise<void> {
  singleOptions(args, ["date"]);
  const checkAnswer = backupCheckAnswer(args);
  const threshold = integerOption(args, "threshold", {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const count = integerOption(args, "shares", {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  validateThreshold(threshold, count);
  if (integrated) {
    for (const key of ["cards", "qr", "event", "legacy-valid-last-word", "title"])
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
    ? shareFormat({ format: value(args, "share-format") ?? "ur" })
    : shareFormat(args);
  const options = exportOptions(args, format);
  await destinations(args, options);
  const mode = transformMode(args);
  if (mode !== "direct" && mode !== "seedshift")
    throw new Error(
      "SSKR share creation supports direct mode and checksum-valid Seedshift, but not legacy modes.",
    );
  // Before the first question: a failure here is no answer's fault, and nothing typed is lost.
  await assertSskrSelfTest();
  const prompted = await promptedEncodeInputs(args, mode);
  const dateValues = prompted?.dates ?? dates(args);
  if (mode === "direct" && dateValues.length) throw new Error("Direct mode does not accept dates.");
  if (mode === "seedshift" && !dateValues.length)
    throw new Error("Seedshift requires at least one date.");
  const mnemonic = prompted?.mnemonic ?? textInput(args, "mnemonic");
  const result = Masking.of(mode).encode(mnemonic, dateValues);
  const shares = await splitSskrMnemonic(result.shiftedEnglish.join(" "), threshold, count);
  // A save that fails is offered again or skipped (saveWithRetry): the shares are shown below
  // either way, and only once every save is settled, so that none is lost to a failure.
  await saveShares(inForm(shares, format), args, options);
  await saveHeirSheetWithRetry(args, {
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
  if (mode === "seedshift")
    terminalNotice("The shares do not store the dates or the mode; keep them yourself.");
  if (representation !== undefined) {
    if (
      !terminalResultHeader("Encoded result", [
        ["Mode", mode],
        ["Format", representation],
        ["Content", encodedOutputLabel(representation, mode)],
      ])
    )
      console.log(`${encodedOutputLabel(representation, mode)}:`);
    console.log(formatEncoded(result, representation));
    // Shown for a person who keeps the whole phrase too, with the shares as a reserve.
    terminalNotice(
      mode === "seedshift"
        ? "This is the complete backup: no share is needed, but the original dates are still required."
        : "This is the whole seed phrase: it restores the wallet without any share.",
      "warning",
    );
  }
  printShares(inForm(shares, format), undefined, Masking.of(mode).holds);
  if (terminalColor("stderr")) {
    console.error("");
    terminalStatus("Original fingerprint", masterFingerprint(result.sourceMnemonic));
    terminalStatus(
      Masking.of(mode).encodedFingerprintLabel,
      masterFingerprint(result.shiftedEnglish.join(" ")),
    );
    terminalHint("BIP32 fingerprints above use an empty BIP39 passphrase.");
    if (mode !== "direct") terminalHint(PHRASE_WORDS.fingerprintRoles);
  } else {
    console.error(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.sourceMnemonic)}`,
    );
    console.error(
      `Encoded BIP32 master fingerprint${mode === "seedshift" ? " of the masked phrase" : ""} (empty BIP39 passphrase): ${masterFingerprint(result.shiftedEnglish.join(" "))}`,
    );
  }
  await offerShareCheck(
    result.sourceMnemonic,
    mode,
    threshold,
    () => printShares(inForm(shares, format), undefined, Masking.of(mode).holds),
    checkAnswer,
    dateValues,
  );
}

/**
 * The shares given with the options, each in the form it was written in: --share, every non-empty
 * line of a --share-file, and the share of each --share-qr image. --ask-secrets asks for them on
 * the private screen instead (TypedShares).
 */
export async function readShareTexts(args: ParsedArguments): Promise<string[]> {
  const shares = [...values(args, "share")];
  if (values(args, "share-file").filter((path) => path === "-").length > 1)
    throw new Error("Standard input can only be read once.");
  for (const path of values(args, "share-file")) {
    // Every non-empty line holds one complete share, optionally with one explicit missing code.
    const text =
      path === "-"
        ? textInput({ "input-file": "-" }, "input")
        : readBoundedTextFile(path, "The share file");
    shares.push(
      ...text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  for (const path of values(args, "share-qr")) shares.push(await decodeQrPngFile(path));
  if (!shares.length)
    throw new Error(
      "Provide at least one complete share as text, in a text file, in a QR image, or through --ask-secrets. Additional share sources may be repeated.",
    );
  return shares;
}

/** The shares: asked on the private screen with --ask-secrets, or read from the options. */
async function typedShares(args: ParsedArguments): Promise<TypedShares> {
  if (args["ask-secrets"] !== true) return TypedShares.of(await readShareTexts(args));
  if (["share", "share-file", "share-qr"].some((key) => args[key] !== undefined))
    throw new Error("--ask-secrets cannot be combined with another share-input source.");
  const shares = new TypedShares();
  await shares.askAll();
  return shares;
}

/**
 * The assessment of shares marked with ? (planShareRepair), during which Ctrl+C is read as a key:
 * with many marks it takes a while, and a Windows pseudo-console need not send SIGINT for the key.
 * It asks nothing, and the watch ends with it, so that a question after it reads its own keys.
 */
function assessMarkedShares(texts: readonly string[]): Promise<JointPlan> {
  return withCtrlCWatch(async (signal) => {
    const plan = await planShareRepair(texts, { signal });
    // The assessment checks the signal only before each turn: a Ctrl+C read at its last turn
    // stops it here.
    signal.throwIfAborted();
    return plan;
  });
}

// Restoring the phrase from the shares, with the dates and the wallet.

/** Direct mode or checksum-valid Seedshift, the two modes in which shares are made. */
function shareMode(args: ParsedArguments): "direct" | "seedshift" {
  const mode = transformMode(args);
  if (mode !== "direct" && mode !== "seedshift")
    throw new Error("SSKR share recovery supports direct mode or checksum-valid Seedshift.");
  return mode;
}

/** What a restore of shares works with: read and checked before the first question, then answered. */
interface Recovery {
  /** Whether the shares are asked on the private screen, so that a problem is asked about. */
  readonly interactive: boolean;
  /** Changed on the private screen when the person says that Seedshift was, or was not, used. */
  mode: "direct" | "seedshift";
  /** The share combinations that --max-tries allows without a question. */
  readonly limit: number | undefined;
  /** The date combinations that --max-candidates allows without a question, for every phrase. */
  readonly dateLimit: number | undefined;
  /** The wallet's BIP39 passphrase, "" for none. */
  readonly passphrase: string;
  /** Where a wallet asked on the private screen is looked for (walletPlaceOf). */
  readonly place: WalletPlace;
  /** The candidate list to save (sskr-combine), for which every date match is kept. */
  readonly target?: CandidatesTarget | undefined;
  readonly shares: TypedShares;
  /** The wallet: given with the options, or asked on the private screen. */
  evidence: WalletEvidence | undefined;
  /** The dates of a Seedshift phrase: given with the options, or asked once the shares are read. */
  dates: DatesAnswer | undefined;
}

/**
 * Reads and checks the options that a restore uses, before any question: the mode, the dates, the
 * wallet and where it is looked for, the BIP39 passphrase and --max-tries; then runs the SSKR
 * self-test, so that it cannot fail after the shares were typed.
 */
async function recoverySettings(
  args: ParsedArguments,
): Promise<Omit<Recovery, "shares" | "target">> {
  const mode = shareMode(args);
  const given = dates(args);
  if (mode === "direct" && given.length) throw new Error("Direct mode does not accept dates.");
  if (mode === "seedshift" && !given.length && args["ask-secrets"] !== true)
    throw new Error("Seedshift recovery requires its original dates.");
  const evidence = walletEvidence(args);
  if (evidence !== undefined) assertWalletEvidence(evidence);
  const interactive = args["ask-secrets"] === true;
  // A wallet asked on the screen is looked for where the one given says, or at the default; without
  // one, nothing would use the options that place it.
  assertWalletPlaceUsed(args, evidence);
  const settings = {
    interactive,
    mode,
    limit: searchLimit(args),
    dateLimit: maxCandidatesOf(args),
    passphrase: bip39Passphrase(args),
    place: walletPlaceOf(evidence, args),
    evidence,
    dates: given.length === 0 ? undefined : DatesAnswer.of(given),
  };
  await assertSskrSelfTest();
  return settings;
}

/** A phrase that the shares restore, with the places of the set's shares among those typed. */
interface Restored extends UnmaskedPhrase {
  /** The places of the set's shares among those typed, by their index in the set. */
  readonly places: readonly number[];
}

/** What restorePhrases gives. */
type Restoring =
  | {
      readonly kind: "restored";
      readonly phrases: readonly Restored[];
      /** Every phrase found, for a candidate list, also those beyond the ones shown. */
      readonly listed: readonly string[];
    }
  /** Too few shares, which the caller deals with (RestoreRules.few). */
  | { readonly kind: "few" };

/** How restorePhrases deals with what differs between restoring and exporting shares. */
interface RestoreRules {
  /**
   * After too few shares, explained by `message`: "again" when more shares were added, "few" to
   * stop restoring and give the shares back to the caller.
   */
  readonly few: (message: string) => Promise<"again" | "few">;
  /** Whether several phrases, without a wallet, ask for one to tell the right set (sskr-export). */
  readonly one: boolean;
}

/** Why the wallet is asked for on the private screen before a date search. */
const WALLET_EXPLANATION: Explanation = {
  lines: ["Each guessed date gives a valid phrase; the wallet tells which is yours."],
  more: [readmeLink("date-recovery-helper")],
};

/** The words of a phrase of `secretBytes`, or undefined when an assessment does not tell. */
function wordCountOf(secretBytes: number | undefined): number | undefined {
  return secretBytes === undefined ? undefined : ShareSet.wordCountOf(secretBytes);
}

/**
 * Asks for the dates of a Seedshift phrase of `words` words, ? standing for a forgotten digit,
 * until they can be used. Without a private screen the dates must have been given.
 */
async function askShareDates(r: Recovery, words: number | undefined): Promise<DatesAnswer> {
  if (!r.interactive) {
    if (r.dates === undefined) throw new Error("Seedshift recovery requires its original dates.");
    throw new Error(r.dates.tooManyFor(words));
  }
  return askDates({ wordCount: words, patterns: true });
}

/**
 * Whether the date search of the phrases of complete shares is made: at once up to twelve hours
 * on this computer, or up to `limit` date combinations (--max-candidates), otherwise when the
 * person chooses it (RepairReport.dateSearchNeedsQuestion); false types the dates again. Dates
 * with ? are typed on the private screen only.
 */
async function askDateSearch(
  work: DateWork,
  phrases: number,
  limit: number | undefined,
): Promise<boolean> {
  if (!RepairReport.dateSearchNeedsQuestion(work, phrases, limit)) {
    terminalNotice(RepairReport.dateSearchNotice(work, phrases));
    return true;
  }
  await dropTypedAhead();
  const start = await choose(
    RepairReport.dateSearchQuestion(work, phrases),
    [
      { label: "Yes", note: "Ctrl+C stops it", value: true },
      { label: "No", note: "type the dates again", value: false },
    ],
    { label: "Search", quit: "types the dates again" },
  );
  return start === true;
}

/**
 * How the sets of this restore become seed phrases (ShareUnmasking): with its mode, its dates and
 * the wallet, keeping every date match for a candidate list.
 */
function unmaskingOf(r: Recovery): ShareUnmasking {
  return new ShareUnmasking({
    mode: r.mode,
    dates: r.dates,
    walletCheck: walletCheckOf(r.evidence, r.passphrase),
    maxShown: MAX_SHOWN_MATCHES,
    keep: r.target === undefined ? 0 : KEPT_FOR_LIST,
  });
}

/**
 * The date search that each phrase of the shares needs, for its time (ShareUnmasking.dateWork):
 * undefined without dates with ? or without a wallet.
 */
function dateWork(r: Recovery): Promise<DateWork | undefined> {
  return unmaskingOf(r).dateWork();
}

/**
 * The phrases of `sets` whose wallet matches the one given, if any: the set's own phrase, or the
 * phrase that the dates unmask, searched where a date holds ? while Ctrl+C is read as a key. A
 * string says why the dates do not fit a set's phrase.
 */
async function unmasked(
  r: Recovery,
  sets: readonly RepairedSet[],
  places: readonly number[],
): Promise<{ phrases: Restored[]; listed: readonly string[] } | string> {
  const unmasking = unmaskingOf(r);
  const result = unmasking.searches
    ? await withDateProgress((progress) =>
        withCtrlCWatch((signal) =>
          unmasking.unmask(sets, dateSearchRun(signal, PROGRESS_EVERY, progress)),
        ),
      )
    : await unmasking.unmask(sets);
  if (result.kind === "dates") return result.message;
  return {
    phrases: result.phrases.map((phrase) => ({ ...phrase, places })),
    listed: result.listed,
  };
}

/** The sets of `phrases`, each once, in their order. */
function setsOf(phrases: readonly Restored[]): RepairedSet[] {
  return [...new Set(phrases.map((phrase) => phrase.set))];
}

/** What is asked next while restoring. */
type Step = "shares" | "dates" | "wallet" | "search";

/**
 * Shows the fingerprint of the masked phrase that complete shares restore, before any date is
 * typed: the split showed it as the encoded fingerprint, so a share typed wrong shows here as
 * another fingerprint, before the dates, as decode shows it for typed codes. It is shown when the
 * phrase is a valid BIP39 phrase (ShareSet.fingerprint).
 */
function showSetFingerprint(set: RepairedSet): void {
  showEncodedFingerprint(ShareSet.of(set).fingerprint(masterFingerprint));
}

/**
 * Restores the phrases that the shares hold, asked in this order on the private screen, each
 * answer checked at once: the shares (each read, then the set; see share-repair.ts), the dates of
 * a Seedshift phrase, with ? for forgotten digits, the wallet when a date search needs it, then the
 * search of marked shares and of the dates, and the wallet check. A result that cannot be used
 * offers what to change; the other answers, and the phrases already found, are kept. Without a
 * private screen the first problem ends the command.
 */
async function restorePhrases(r: Recovery, rules: RestoreRules): Promise<Restoring> {
  let repair: ShareRepair | undefined;
  let sets: RepairedSet[] | undefined;
  let places: number[] = [];
  let words: number | undefined;
  // Whether the encoded fingerprint of the set restored was shown (showSetFingerprint).
  let encodedShown = false;
  /**
   * Shows it once for complete shares of a Seedshift phrase, before its dates, on the private
   * screen only, as decode does: from the command line the dates are given, and nothing is asked.
   */
  const showEncoded = (): void => {
    if (!r.interactive || r.mode !== "seedshift" || encodedShown) return;
    // Marked shares restore their phrases only in the search, after the dates.
    if (repair !== undefined || sets === undefined) return;
    showSetFingerprint(sets[0]!);
    encodedShown = true;
  };
  for (let step: Step = "shares"; ;) {
    if (step === "shares") {
      const outcome = await assessShares(r.shares, assessMarkedShares);
      if (outcome.kind === "trouble") {
        if (outcome.trouble.kind !== "few")
          await mendShares(r.shares, outcome.trouble, r.interactive);
        else if ((await rules.few(outcome.trouble.message)) === "few") return { kind: "few" };
        continue;
      }
      places = r.shares.places();
      encodedShown = false;
      if (outcome.kind === "complete") {
        repair = undefined;
        sets = [outcome.set];
        const unchecked = ShareSet.of(outcome.set).uncheckedNote(places);
        if (unchecked !== undefined) terminalNotice(unchecked, "warning");
        showEncoded();
        words = wordCountOf(outcome.secretBytes);
      } else {
        repair = outcome.repair;
        sets = undefined;
        words = wordCountOf(outcome.repair.plan.assessment.secretBytes);
      }
      // Dates typed or given before the word count was known may be more than the phrase takes.
      const tooMany = r.dates?.tooManyFor(words);
      if (tooMany !== undefined && r.interactive) terminalNotice(tooMany, "warning");
      step =
        r.mode === "seedshift" && (r.dates === undefined || tooMany !== undefined)
          ? "dates"
          : "wallet";
    } else if (step === "dates") {
      // Also after "It was masked with Seedshift" (otherMode), which comes here.
      showEncoded();
      r.dates = await askShareDates(r, words);
      step = "wallet";
    } else if (step === "wallet") {
      step = "search";
      if (r.dates?.hasForgottenDigits === true && r.evidence === undefined) {
        const answer = await askWalletEvidence({
          optional: false,
          explanation: WALLET_EXPLANATION,
          place: r.place,
        });
        if (answer.kind === "back") step = "dates";
        else if (answer.kind === "wallet") r.evidence = answer.evidence;
      }
    } else {
      if (sets === undefined) {
        const found = await searchShareRepair(
          repair!,
          { shares: r.limit, dates: r.dateLimit },
          await dateWork(r),
        );
        if (found === undefined || found.length === 0) {
          // Shares given with the options cannot be typed again here.
          const problem = found === undefined ? "The search was not started." : NO_PHRASE_FITS;
          if (!r.interactive) throw new Error(problem);
          if (found !== undefined) terminalNotice(problem, "warning");
          // Escape here is Stop (askAfterFailure): a search that found nothing has no question to
          // go back to, and the search question, whose own Escape leads here, would be asked
          // without end once the input has ended.
          await askShareFix(r.shares, { question: "Which shares to change?" });
          step = "shares";
          continue;
        }
        sets = found;
      } else {
        const work = await dateWork(r);
        if (work !== undefined && !(await askDateSearch(work, sets.length, r.dateLimit))) {
          step = "dates";
          continue;
        }
      }
      const result = await unmasked(r, sets, places);
      if (typeof result === "string") {
        if (!r.interactive) throw new Error(result);
        terminalNotice(result, "warning");
        step = "dates";
        continue;
      }
      if (result.phrases.length > 0) {
        const several = setsOf(result.phrases).length > 1;
        if (!(rules.one && several && r.evidence === undefined && r.interactive))
          return { kind: "restored", ...result };
        // Several sets fit, and nothing tells the right one: the wallet does, without a new search.
        const answer = await askWalletEvidence({
          optional: true,
          explanation: {
            lines: [`${setsOf(result.phrases).length} sets of shares fit; the wallet tells yours.`],
          },
          place: r.place,
        });
        if (answer.kind !== "wallet") return { kind: "restored", ...result };
        r.evidence = answer.evidence;
        continue;
      }
      step = await afterMismatch(r, sets.length);
    }
  }
}

/**
 * Takes the other of the two modes in which shares are made, after the person said that the phrase
 * was, or was not, masked with Seedshift before splitting: the menu asks that before the shares,
 * and a wrong answer there shows only as a wallet that nothing matches. The phrases found are
 * kept; a masked one needs its dates.
 */
function otherMode(r: Recovery): Step {
  if (r.mode === "direct") {
    r.mode = "seedshift";
    return "dates";
  }
  r.mode = "direct";
  r.dates = undefined;
  return "search";
}

/**
 * After phrases of which none matches the wallet given: says so and asks what to change, the
 * dates, the wallet, the shares or whether Seedshift was used; Stop cancels. Escape at the wallet
 * or share question that follows comes back here. Without a private screen the mismatch ends the
 * command.
 */
async function afterMismatch(r: Recovery, sets: number): Promise<Step> {
  const searched = r.dates?.hasForgottenDigits === true;
  const message = ShareSet.walletMismatch(sets, searched ? r.dates!.combinations : undefined);
  if (!r.interactive) throw new Error(message);
  terminalNotice(message, "warning");
  for (;;) {
    const next = await askAfterFailure("What now?", [
      ...(r.mode === "seedshift" ? [{ label: "Change the dates", value: "dates" as const }] : []),
      {
        label: "Change the wallet",
        note: "the fingerprint or the address",
        value: "wallet" as const,
      },
      { label: "Change a share", note: "or add more", value: "shares" as const },
      r.mode === "direct"
        ? { label: "It was masked with Seedshift", note: "type its dates", value: "mode" as const }
        : { label: "It was not masked with Seedshift", note: "no dates", value: "mode" as const },
      { label: "Stop", value: "stop" as const },
    ]);
    if (next === "stop") throw new InputCancelled();
    if (next === "dates") return "dates";
    if (next === "mode") return otherMode(r);
    if (next === "shares") {
      if (await askShareFix(r.shares, { question: "Which shares to change?", back: true }))
        return "shares";
      continue;
    }
    const answer = await askWalletEvidence({ optional: false, place: r.place });
    if (answer.kind === "wallet") {
      r.evidence = answer.evidence;
      return "search";
    }
  }
}

/**
 * The restore from Shamir shares on the private screen, after a share was typed where Decode asked
 * for the codes: that share is kept as the first, and the others are asked for. Shares are made
 * with Seedshift or without; Decode's mode tells which where it is one of the two, or it is asked
 * as the menu's entry asks it. `handed` are Decode's options that a restore takes too, such as
 * the mode, the wallet and the search limits.
 */
export async function restoreFromShare(
  handed: ParsedArguments,
  share: FirstShare,
): Promise<"done" | "back"> {
  const given = value(handed, "mode");
  const mode = given === "direct" || given === "seedshift" ? given : await askShareSeedshift();
  if (mode === undefined) return "back";
  const options: ParsedArguments = { ...handed, "ask-secrets": true };
  delete options.mode;
  if (mode === "seedshift") options.mode = mode;
  await runSskrCombine(options, share);
  return "done";
}

/** Whether Seedshift was used before the shares were made; undefined goes back (Escape). */
async function askShareSeedshift(): Promise<"direct" | "seedshift" | undefined> {
  await dropTypedAhead();
  return choose(
    "Was Seedshift used before it was split?",
    [
      { label: "No", value: "direct" },
      { label: "Yes", note: "the dates are asked after the shares", value: "seedshift" },
    ] as const,
    { label: "Seedshift", quit: "goes back" },
  );
}

/**
 * Restores the phrase from the shares given, or typed on the private screen, after `firstShare`
 * when another command's question took it (restoreFromShare).
 */
export async function runSskrCombine(
  args: ParsedArguments,
  firstShare?: FirstShare,
): Promise<void> {
  singleOptions(args, ["share", "share-file", "share-qr", "date"]);
  const settings = await recoverySettings(args);
  const target = await candidatesTarget(args);
  assertListable(target, settings.passphrase);
  const shares =
    firstShare === undefined ? await typedShares(args) : await TypedShares.startingWith(firstShare);
  const r: Recovery = { ...settings, target, shares };
  await prepareCandidates(target, r.passphrase);
  const restored = await restorePhrases(r, {
    few: async (message) => {
      await mendShares(r.shares, { kind: "few", message }, r.interactive);
      return "again";
    },
    one: false,
  });
  if (restored.kind === "few") throw new Error("Too few shares to restore the phrase.");
  const { phrases } = restored;
  // The result is a step of its own: the questions and the search are cleared away.
  const cleared = clearPrivateScreen();
  if (phrases.length > 1)
    terminalNotice(
      `${phrases.length} phrases fit these shares. Each is listed with its fingerprint: the wallet tells which is yours.`,
      "warning",
    );
  const reported = new Set<RepairedSet>();
  for (const [index, phrase] of phrases.entries()) {
    // The private screen keeps no scrollback: there each phrase has a screen of its own, the next
    // shown on Enter, so that none scrolls out of reach.
    if (index > 0 && cleared) {
      if (
        !(await waitForEnter(`Press Enter for phrase ${index + 1} of ${phrases.length}; Esc ends.`))
      )
        break;
      clearPrivateScreen();
    }
    showRestored(phrase, r.mode, {
      index,
      of: phrases.length,
      // What is said of a set comes once, with its first phrase, and again on a screen of its own.
      set: cleared ? "cleared" : reported.has(phrase.set) ? "said" : "new",
      ...(r.evidence === undefined ? {} : { evidence: evidenceLabel(r.evidence) }),
    });
    reported.add(phrase.set);
  }
  if (target !== undefined)
    await saveCandidates(
      target,
      restored.listed.map((mnemonic) => mnemonicToEntropy(mnemonic, wordlist)),
      r.passphrase,
    );
}

/** Where a restored phrase stands among those shown, and what was already said of its set. */
interface RestoredPlace {
  readonly index: number;
  readonly of: number;
  /** The wallet given, in the words of its option, which the phrase matched. */
  readonly evidence?: string;
  /**
   * "said" when an earlier phrase of the same set told its repairs; "cleared" when the screen was
   * cleared after the notes of the shares, which are then said again; "new" otherwise.
   */
  readonly set: "said" | "cleared" | "new";
}

/**
 * Prints one restored phrase: what the repair of its set filled in, the backup in the form of its
 * shares, and the phrase with its dates and fingerprint. On a terminal each part stands apart
 * under its own label, the phrase numbered for writing down; elsewhere the plain lines.
 */
function showRestored(phrase: Restored, mode: "direct" | "seedshift", place: RestoredPlace): void {
  if (terminalColor("stdout")) showRestoredParts(phrase, mode, place);
  else showRestoredPlain(phrase, mode, place);
}

/**
 * What is said of a set before its first phrase: a share that took no part, and the repairs; with
 * `spaced`, after a blank line when there is something to say.
 */
function reportSet(phrase: Restored, place: RestoredPlace, spaced: boolean): void {
  if (place.set === "said") return;
  // Said before the dates too (restorePhrases), on the screen cleared since.
  const unchecked =
    place.set === "cleared" ? ShareSet.of(phrase.set).uncheckedNote(phrase.places) : undefined;
  const repaired = RepairReport.repairs(phrase.set, phrase.places).length > 0;
  if (spaced && (unchecked !== undefined || repaired)) console.error("");
  if (unchecked !== undefined) terminalNotice(unchecked, "warning");
  reportRepairs(phrase.set, phrase.places);
}

/**
 * The backup that was split, in the form its shares were written in, which the dates turn into
 * the seed phrase; undefined where it would be the same words again.
 */
function restoredBackup(
  phrase: Restored,
  mode: "direct" | "seedshift",
): { readonly label: string; readonly text: string } | undefined {
  const backupForm = ShareSet.of(phrase.set).backupForm;
  const text = formatEncoded(representMnemonic(phrase.set.mnemonic), backupForm);
  return text === phrase.mnemonic
    ? undefined
    : { label: encodedOutputLabel(backupForm, mode), text };
}

/**
 * ", phrase 2 of 3" after a heading when several phrases are shown: the place of the phrase among
 * those found, not of a share.
 */
function numberedOf(place: RestoredPlace): string {
  return place.of > 1 ? `, phrase ${place.index + 1} of ${place.of}` : "";
}

/** The path of the master key, where a fingerprint matches: it says nothing that the fact does not. */
const MASTER_KEY_PATH = "m";

/** "matches the address at m/84'/0'/0'/0/3", for the wallet fact. */
function walletFact(phrase: Restored, place: RestoredPlace): string | undefined {
  if (place.evidence === undefined) return undefined;
  const { matchedAt } = phrase;
  const at = matchedAt === undefined || matchedAt === MASTER_KEY_PATH ? "" : ` at ${matchedAt}`;
  return `matches the ${place.evidence}${at}`;
}

/**
 * A restored phrase on a terminal: the heading with the mode, the dates and the wallet; the
 * repairs; the masked phrase (decoy) with its encoded fingerprint, grey; then, in bold, the
 * original seed phrase numbered for writing down, and its fingerprint.
 */
function showRestoredParts(
  phrase: Restored,
  mode: "direct" | "seedshift",
  place: RestoredPlace,
): void {
  const wallet = walletFact(phrase, place);
  terminalResultHeader(`Restored from shares${numberedOf(place)}`, [
    ["Mode", mode],
    ...(phrase.dates === undefined ? [] : ([["Dates", phrase.dates]] as [string, string][])),
    ...(wallet === undefined ? [] : ([["Wallet", wallet]] as [string, string][])),
  ]);
  reportSet(phrase, place, true);
  const backup = restoredBackup(phrase, mode);
  if (backup !== undefined) {
    terminalPart(backup.label);
    // Wrapped at its spaces: the terminal would break a long line inside a word.
    for (const line of wrapText(backup.text)) console.log(line);
    // Only a masked phrase has a fingerprint of its own; another form is the phrase below.
    const encoded =
      mode === "seedshift" ? ShareSet.of(phrase.set).fingerprint(masterFingerprint) : undefined;
    if (encoded !== undefined)
      terminalFingerprint(Masking.of(mode).encodedFingerprintLabel, encoded, FINGERPRINT_NOTE);
  }
  terminalPart(capitalized(PHRASE_WORDS.original), true);
  terminalPhrase(phrase.mnemonic);
  console.log("");
  terminalFingerprint(
    PHRASE_WORDS.originalFingerprint,
    masterFingerprint(phrase.mnemonic),
    FINGERPRINT_NOTE,
  );
}

/** A restored phrase as plain lines, for a file, a pipe or a terminal without colour. */
function showRestoredPlain(
  phrase: Restored,
  mode: "direct" | "seedshift",
  place: RestoredPlace,
): void {
  reportSet(phrase, place, false);
  const { mnemonic } = phrase;
  const ordinal = place.of > 1 ? `phrase ${place.index + 1} of ${place.of}` : undefined;
  const backup = restoredBackup(phrase, mode);
  if (backup !== undefined) {
    console.log(`${backup.label}${ordinal === undefined ? "" : ` (${ordinal})`}:`);
    console.log(backup.text);
  }
  const notes = [ordinal, phrase.dates === undefined ? undefined : `dates ${phrase.dates}`].filter(
    (note) => note !== undefined,
  );
  console.log(
    `Original seed phrase, the wallet's${notes.length === 0 ? "" : ` (${notes.join(", ")})`}:`,
  );
  console.log(mnemonic);
  if (terminalColor("stderr")) {
    terminalStatus(PHRASE_WORDS.originalFingerprint, masterFingerprint(mnemonic));
    terminalNotice("Fingerprint uses an empty BIP39 passphrase.");
  } else
    console.error(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(mnemonic)}`,
    );
}

// Exporting the shares again.

/**
 * The QR code of each share's sheets, also saved as an image where the cards went (`save`), which
 * Restore reads back (--share-qr): one for each share, none when the sheets print no QR code.
 */
async function saveShareQrs(
  shares: readonly string[],
  options: SskrRenderOptions,
  save: (code: ShareQrCode) => Promise<string>,
): Promise<void> {
  const codes = new ShareCardSet(shares, options).qrCodes;
  for (const code of codes) await save(code);
  if (codes.length > 0)
    terminalNotice(
      `Saved the QR code of each share's sheets as an image beside them: ${codes.length} PNG ${codes.length === 1 ? "file" : "files"}.`,
      "success",
    );
}

/**
 * Asks in which form cards show shares written in different forms; Stop cancels. Without a
 * private screen the mix ends the command.
 */
async function cardForm(forms: readonly ShareFormat[], interactive: boolean): Promise<ShareFormat> {
  const message = "The shares are written in different forms: choose one with --format for cards.";
  if (!interactive) throw new Error(message);
  const form = await askAfterFailure(
    "The shares are written in different forms. Which form should the cards show?",
    [
      ...forms.map((format) => ({ label: SHARE_FORMAT_NAMES[format], value: format })),
      { label: "Stop", value: "stop" as const },
    ],
    { label: "Cards" },
  );
  if (form === "stop") throw new InputCancelled();
  return form;
}

/**
 * Shows a set of shares, repaired or not, each in its own form or the one of --format, and saves
 * it where the options say, by the rules of an export (ShareExport): a share with elements that
 * nothing settles is left out, and copies of one share are shown as typed and saved once. False
 * when no share could be settled and those shares were typed again on the private screen, to be
 * restored anew.
 */
async function exportSet(
  r: Recovery,
  set: Pick<RepairedSet, "shares" | "unsettled">,
  places: readonly number[],
  given: ShareFormat | undefined,
  checked: SskrExportOptions | undefined,
  args: ParsedArguments,
): Promise<boolean> {
  reportRepairs(set, places);
  let written = ShareExport.of(set, places, given);
  for (const message of written.leftOutMessages()) terminalNotice(message, "warning");
  if (written.shown.length === 0) {
    if (!r.interactive) throw new Error("No share could be settled.");
    for (const place of written.leftOut) await r.shares.retype(place);
    return false;
  }
  // Shares repaired each on its own may be of several sets, or the same member twice.
  const trouble = ShareInput.looseSetTrouble(written.members);
  if (trouble !== undefined) {
    await mendShares(r.shares, trouble, r.interactive);
    return false;
  }
  if (checked !== undefined && written.forms.length > 1)
    written = written.inForm(await cardForm(written.forms, r.interactive));
  const saved = written.saved;
  const options = checked === undefined ? undefined : { ...checked, shareFormat: saved[0]!.format };
  await saveShares(saved, args, options);
  reportRenamedOutputs();
  if (written.copiesNote !== undefined) terminalNotice(written.copiesNote);
  // The shares come back as they were split: a page and this screen name what they hold, so
  // that a masked phrase is not taken for the wallet's.
  terminalNotice(
    r.mode === "seedshift" ? PHRASE_WORDS.repairedMasked : PHRASE_WORDS.repairedUnknown,
  );
  printShares(
    written.shown,
    written.total,
    r.mode === "seedshift" ? PHRASE_WORDS.masked : undefined,
  );
  return true;
}

/**
 * Each typed share repaired from its own checks alone, as for fewer shares than the threshold
 * (ShareInput.repairEach). A share that fits more than one way has its variants shown; on the
 * private screen it may then be typed again from another copy, or more shares added ("changed");
 * otherwise nothing is saved (undefined). A share that cannot be repaired is typed again
 * ("changed"), or ends the command.
 */
async function repairEach(
  r: Recovery,
  given: ShareFormat | undefined,
): Promise<readonly ReadRepairableShare[] | "changed" | undefined> {
  const each = r.shares.input.repairEach();
  if (each.kind === "repaired") return each.shares;
  const { place } = each;
  if (each.kind === "unreadable") {
    if (!r.interactive) throw new Error(each.message, { cause: each.cause });
    await r.shares.retype(place, each.message);
    return "changed";
  }
  terminalNotice(each.message, "warning");
  for (const [index, variant] of each.variants.entries()) {
    const title = `Share ${place}, variant ${index + 1} of ${each.variants.length}`;
    const form = SHARE_FORMAT_NAMES[given ?? variant.format];
    if (!terminalResultHeader(title, [["Format", form]])) console.error(`${title} — ${form}:`);
    console.log(writeShare(variant.ur, given ?? variant.format));
  }
  if (!r.interactive) return undefined;
  const next = await askAfterFailure("What now?", [
    { label: `Type share ${place} again`, note: "from another copy", value: "again" },
    { label: "Add more shares", value: "more" },
    { label: "Done", note: "nothing is saved", value: "done" },
  ] as const);
  if (next === "done") return undefined;
  if (next === "again") await r.shares.retype(place);
  else await r.shares.askMore();
  return "changed";
}

/** Shows every set that fits, with the fingerprint of the phrase it holds; none is saved. */
function showVariants(phrases: readonly Restored[], given: ShareFormat | undefined): void {
  const sets = setsOf(phrases);
  terminalNotice(
    `${sets.length} sets of shares fit. The original fingerprint of each, the wallet's own, tells the right one; give it, or an address, to save that set.`,
    "warning",
  );
  const places = phrases[0]!.places;
  for (const [index, set] of sets.entries()) {
    const title = `Variant ${index + 1} of ${sets.length}`;
    // The wallet's own fingerprint, of the phrase after the dates where Seedshift was used: the
    // one that a wallet check compares with, not the one of the masked phrase the shares hold.
    const fingerprint = masterFingerprint(
      phrases.find((phrase) => phrase.set === set)?.mnemonic ?? set.mnemonic,
    );
    if (!terminalResultHeader(title, [["Original fingerprint", fingerprint]]))
      console.log(`${title}, original fingerprint ${fingerprint}:`);
    reportRepairs(set, places);
    printShares(
      set.shares.map((share, place) => ({
        ur: share.ur,
        format: given ?? share.format,
        number: places[place]!,
      })),
      Math.max(...places),
    );
  }
  terminalHint("Each fingerprint is that of the phrase the shares hold, with an empty passphrase.");
}

/**
 * After too few shares to restore the phrase that the wallet given is checked against: on the
 * private screen more shares, the export without the wallet check, or Stop, which cancels;
 * otherwise an error. Escape and the end of the input are Stop (askAfterFailure), so that the
 * check asked for is dropped only when the person chooses so.
 */
async function fewForExport(r: Recovery): Promise<"again" | "few"> {
  if (r.evidence === undefined) return "few";
  const message = "The wallet can be checked only with as many shares as the threshold.";
  if (!r.interactive) throw new Error(message);
  terminalNotice(message, "warning");
  const next = await askAfterFailure("What now?", [
    { label: "Add more shares", value: "more" },
    { label: "Go on without the wallet check", note: "each share alone", value: "without" },
    { label: "Stop", value: "stop" },
  ] as const);
  if (next === "stop") throw new InputCancelled();
  if (next === "more") {
    await r.shares.askMore();
    return "again";
  }
  r.evidence = undefined;
  return "few";
}

export async function runSskrExport(args: ParsedArguments): Promise<void> {
  singleOptions(args, ["share", "share-file", "share-qr", "date"]);
  // Without --format each share keeps the form it is written in, so that a share repaired from
  // its marked elements comes back as it was written, whole.
  const given = value(args, "format") === undefined ? undefined : shareFormat(args);
  const checked = exportOptions(args, given ?? "colors");
  await destinations(args, checked);
  const settings = await recoverySettings(args);
  // A wallet tells sets of repaired shares apart; for a Seedshift phrase it needs the dates.
  if (settings.mode === "seedshift" && settings.evidence === undefined)
    throw new Error("Seedshift mode here serves only the wallet check: give the wallet too.");
  const r: Recovery = { ...settings, shares: await typedShares(args) };
  for (;;) {
    if (!r.shares.marked && r.evidence === undefined) {
      // Complete shares are only written again: no phrase is restored, and no quorum is needed.
      const trouble = r.shares.input.looseTrouble();
      if (trouble !== undefined) {
        await mendShares(r.shares, trouble, r.interactive);
        continue;
      }
      const shares = r.shares.texts().map((text) => ({
        ...readShare(text),
        repaired: false,
        filled: [],
      }));
      const set = { shares, unsettled: [] };
      if (await exportSet(r, set, r.shares.places(), given, checked, args)) return;
      continue;
    }
    const restored = await restorePhrases(r, { few: () => fewForExport(r), one: true });
    if (restored.kind === "few") {
      // Without the wallet check complete shares are written again as above.
      if (!r.shares.marked) continue;
      // Fewer shares than the threshold restore no phrase; each is then repaired on its own.
      const shares = await repairEach(r, given);
      if (shares === undefined) return;
      if (shares === "changed") continue;
      const set = { shares, unsettled: [] };
      if (await exportSet(r, set, r.shares.places(), given, checked, args)) return;
      continue;
    }
    const sets = setsOf(restored.phrases);
    if (sets.length > 1) return showVariants(restored.phrases, given);
    if (await exportSet(r, sets[0]!, restored.phrases[0]!.places, given, checked, args)) return;
  }
}
