import { imageFormat, validateImageOptions } from "./image-options.js";
import { allTemplateStyles } from "../export/templates.js";
import { resolveSskrLayout } from "../export/sskr-content.js";
import {
  terminalColor,
  terminalHint,
  terminalNotice,
  terminalResultHeader,
  terminalStatus,
} from "./terminal.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { preflightFileDestination, reportRenamedOutputs } from "./output-paths.js";
import { integerOption, value, values, type ParsedArguments } from "./arguments.js";
import {
  askSecret,
  datesPrompt,
  encodeFormat,
  encodedOutputLabel,
  dates,
  promptedEncodeInputs,
  readBoundedTextFile,
  textInput,
  transformMode,
  type EncodedFormat,
} from "./input.js";
import { businessOptions, businessOptionNames } from "./business-options.js";
import { decodeInput, encodeMnemonic, formatEncoded, representMnemonic } from "../core.js";
import { masterFingerprint } from "../bitcoin-evidence.js";
import {
  planShareRepair,
  restoreShareSet,
  splitSskrMnemonic,
  validateThreshold,
} from "../sskr/shares.js";
import {
  readRepairableShare,
  ShareVariantsError,
  type ReadRepairableShare,
} from "../sskr/repair.js";
import {
  assertShareCount,
  readShare,
  shareInfo,
  urToTransport,
  validateShareSet,
  writeShare,
  type ShareFormat,
} from "../sskr/transport.js";
import type { JointPlan, RepairedSet } from "../sskr/joint-repair.js";
import type { DateShiftDate } from "../core.js";
import { bip39Passphrase, bitcoinEvidence } from "./bitcoin-options.js";
import {
  assessShareRepair,
  backupFingerprint,
  matchingSets,
  reportRepairs,
  searchLimit,
  searchShareRepair,
} from "./share-repair.js";
import {
  exportSskrCards,
  exportSskrPdf,
  exportSskrImages,
  type SskrExportOptions,
} from "../export/sskr-cards.js";
import { requireNewCardDirectory } from "../export/individual-cards.js";
import { decodeQrPngFile } from "./qr-input.js";
import { optionLabel } from "./option-copy.js";
import { offerShareCheck } from "./backup-check.js";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { candidatesTarget, prepareCandidates, saveCandidates } from "./candidates-file.js";
import { saveHeirSheet, validateHeirSheetOptions } from "./heir-sheet.js";

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

/** The share forms as the terminal names them (ShareFormat, src/sskr/transport.ts). */
const SHARE_FORMAT_NAMES: Readonly<Record<ShareFormat, string>> = {
  ur: "Compact UR",
  words: "Bytewords",
  indexes: "BIP39 word numbers (1-2048)",
  unicode: "Unicode codes",
  colors: "RGB hexadecimal codes (ordered)",
  "colors-unicode": "Colors as Unicode codes",
};

/**
 * The form of an encoded seed phrase that matches a share's form, in which the restored backup is
 * shown; shares in Bytewords or as a UR give it back as words.
 */
const RESTORED_FORM: Readonly<Record<ShareFormat, EncodedFormat>> = {
  ur: "english",
  words: "english",
  indexes: "indexes",
  unicode: "unicode",
  colors: "colors",
  "colors-unicode": "colors-unicode",
};

function shareFormat(args: ParsedArguments): ShareFormat {
  const format = value(args, "format") ?? "ur";
  if (!Object.hasOwn(SHARE_FORMAT_NAMES, format))
    throw new Error(
      "The SSKR share format must be ur, words, indexes, unicode, colors or colors-unicode. These are share formats, not BIP39 representations.",
    );
  return format as ShareFormat;
}

/** A share, the form it is shown in, and its place among the shares made or typed. */
interface ShownShare {
  readonly ur: string;
  readonly format: ShareFormat;
  readonly number: number;
}

/** Shares in the same form, in their order, as a split makes them. */
function inForm(shares: readonly string[], format: ShareFormat): ShownShare[] {
  return shares.map((ur, index) => ({ ur, format, number: index + 1 }));
}

/** Prints shares as "SSKR share N of M", by their places among the `total` made or typed. */
function printShares(shares: readonly ShownShare[], total: number = shares.length): void {
  for (const share of shares) {
    const form = SHARE_FORMAT_NAMES[share.format];
    if (!terminalResultHeader(`SSKR share ${share.number} of ${total}`, [["Format", form]]))
      console.error(`SSKR share ${share.number} — ${form}:`);
    console.log(writeShare(share.ur, share.format));
  }
}

async function saveShares(
  shown: readonly ShownShare[],
  args: ParsedArguments,
  options?: SskrExportOptions,
): Promise<void> {
  const shares = shown.map((share) => share.ur);
  if (options?.directory) {
    const count = await exportSskrCards(shares, options);
    terminalNotice(
      `Saved ${count} ${(options.imageFormat ?? "pdf").toUpperCase()} files to: ${options.directory}`,
      "success",
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
  const pdf = value(args, "pdf");
  if (pdf && options) {
    await exportSskrPdf(shares, options, pdf);
    terminalNotice(`Saved SSKR collection PDF: ${pdf} (contains all supplied shares).`, "success");
  }
  const images = value(args, "images-dir");
  if (images && options) {
    const count = await exportSskrImages(shares, options, images, imageFormat(args));
    terminalNotice(
      `Saved ${count} ${imageFormat(args).toUpperCase()} SSKR pages to: ${images} (contains all supplied shares).`,
      "success",
    );
  }
  const output = value(args, "output");
  if (output) {
    // Each share in its form, as the terminal shows it.
    const lines = shown.map((share) => writeShare(share.ur, share.format));
    await publishNewPrivateFile(output, new TextEncoder().encode(lines.join("\n") + "\n"));
    terminalNotice(
      `Saved SSKR records: ${output} (one complete share per line; this file contains all supplied shares).`,
      "success",
    );
  }
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
  const prompted = await promptedEncodeInputs(args, mode);
  const dateValues = prompted?.dates ?? dates(args);
  if (mode === "direct" && dateValues.length) throw new Error("Direct mode does not accept dates.");
  if (mode === "seedshift" && !dateValues.length)
    throw new Error("Seedshift requires at least one date.");
  const mnemonic = prompted?.mnemonic ?? textInput(args, "mnemonic");
  const result =
    mode === "direct" ? representMnemonic(mnemonic) : encodeMnemonic(mnemonic, dateValues);
  const shares = await splitSskrMnemonic(result.shiftedEnglish.join(" "), threshold, count);
  await saveShares(inForm(shares, format), args, options);
  await saveHeirSheet(args, {
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
  printShares(inForm(shares, format));
  if (terminalColor("stderr")) {
    console.error("");
    terminalStatus("Original fingerprint", masterFingerprint(result.sourceMnemonic));
    terminalStatus("Encoded fingerprint", masterFingerprint(result.shiftedEnglish.join(" ")));
    terminalHint("BIP32 fingerprints above use an empty BIP39 passphrase.");
  } else {
    console.error(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.sourceMnemonic)}`,
    );
    console.error(
      `Encoded BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.shiftedEnglish.join(" "))}`,
    );
  }
  await offerShareCheck(result.sourceMnemonic, mode, threshold, () =>
    printShares(inForm(shares, format)),
  );
}

/** The shares as typed or saved, each in the form it was written in. */
async function readShareTexts(args: ParsedArguments): Promise<string[]> {
  if (args["ask-secrets"] === true) {
    if (["share", "share-file", "share-qr"].some((key) => args[key] !== undefined))
      throw new Error("--ask-secrets cannot be combined with another share-input source.");
    return (
      await askSecret("Shamir shares (separate shares with ;, ? for each unreadable code):")
    ).split(";");
  }
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

/**
 * The phrase sets that the typed shares give: the one of complete shares, or, where elements are
 * marked with ?, every one that a repair finds, after its assessment (share-repair.ts). `beforeSearch`
 * runs between the assessment and the search, with the secret's length when it is known.
 */
async function restoredSets(
  texts: readonly string[],
  limit: number | undefined,
  beforeSearch: (secretBytes: number | undefined) => Promise<void>,
  plan?: JointPlan,
): Promise<RepairedSet[]> {
  if (!texts.some((text) => text.includes("?"))) {
    // Every share is read before the dates are asked, so that a mistyped one stops at once.
    const read = texts.map(readShare);
    await beforeSearch(shareInfo(urToTransport(read[0]!.ur)).secretLength);
    return [await restoreShareSet(texts)];
  }
  const repair = assessShareRepair(plan ?? (await planShareRepair(texts)));
  await beforeSearch(repair.plan.assessment.secretBytes);
  return searchShareRepair(repair, limit);
}

/** BIP39 writes every 4 bytes of entropy as 3 words: a 16-byte secret is a 12-word phrase. */
function wordCountOf(secretBytes: number | undefined): number | undefined {
  return secretBytes === undefined ? undefined : (secretBytes * 3) / 4;
}

/** The dates given, or asked on the private screen for a Seedshift phrase of `secretBytes`. */
async function seedshiftDates(
  args: ParsedArguments,
  dateValues: DateShiftDate[],
  secretBytes: number | undefined,
): Promise<void> {
  if (!dateValues.length && args["ask-secrets"] === true)
    dateValues.push(
      ...(await askSecret(datesPrompt(wordCountOf(secretBytes))))
        .split(/\s+/u)
        .flatMap((date) => dates({ date })),
    );
  if (!dateValues.length) throw new Error("Seedshift recovery requires its original dates.");
}

/** Direct mode or checksum-valid Seedshift, the two modes in which shares are made. */
function shareMode(args: ParsedArguments): "direct" | "seedshift" {
  const mode = transformMode(args);
  if (mode !== "direct" && mode !== "seedshift")
    throw new Error("SSKR share recovery supports direct mode or checksum-valid Seedshift.");
  return mode;
}

export async function runSskrCombine(args: ParsedArguments): Promise<void> {
  singleOptions(args, ["share", "share-file", "share-qr", "date"]);
  const mode = shareMode(args);
  const dateValues = dates(args);
  if (mode === "direct" && dateValues.length) throw new Error("Direct mode does not accept dates.");
  if (mode === "seedshift" && !dateValues.length && args["ask-secrets"] !== true)
    throw new Error("Seedshift recovery requires its original dates.");
  const evidence = bitcoinEvidence(args);
  const passphrase = bip39Passphrase(args);
  const limit = searchLimit(args);
  const candidates = await candidatesTarget(args);
  const texts = await readShareTexts(args);
  assertShareCount(texts.length);
  await prepareCandidates(candidates, passphrase);
  const sets = await restoredSets(texts, limit, async (secretBytes) => {
    if (mode === "seedshift") await seedshiftDates(args, dateValues, secretBytes);
  });
  const walletOf = (set: RepairedSet) =>
    mode === "direct"
      ? set.mnemonic
      : decodeInput(set.mnemonic, "english", dateValues).recoveredMnemonic;
  const matching = matchingSets(sets, evidence, walletOf, passphrase);
  if (matching.length > 1)
    terminalNotice(
      `${matching.length} phrases fit these shares. Each is listed with its fingerprint: the wallet tells which is yours.`,
      "warning",
    );
  matching.forEach((set, index) =>
    showRestored(set, walletOf(set), mode, {
      index,
      of: matching.length,
      ...(evidence === undefined ? {} : { evidence: optionLabel(evidence.kind) }),
    }),
  );
  if (candidates !== undefined)
    await saveCandidates(
      candidates,
      matching.map((set) => mnemonicToEntropy(walletOf(set), wordlist)),
      passphrase,
    );
}

/** Prints one restored phrase: what a repair filled in, the backup in its form, and the phrase. */
function showRestored(
  set: RepairedSet,
  mnemonic: string,
  mode: "direct" | "seedshift",
  place: { readonly index: number; readonly of: number; readonly evidence?: string },
): void {
  const numbered = place.of > 1 ? ` ${place.index + 1} of ${place.of}` : "";
  reportRepairs(set);
  // The backup that was split comes back in the form its shares were written in; the dates then
  // turn it into the seed phrase below. It is left out where it would be the same words again.
  const backupForm = RESTORED_FORM[set.shares[0]!.format];
  const backup = formatEncoded(representMnemonic(set.mnemonic), backupForm);
  if (backup !== mnemonic) {
    const label = encodedOutputLabel(backupForm, mode);
    if (
      !terminalResultHeader(`Restored backup${numbered}`, [
        ["Form", backupForm],
        ["Content", label],
      ])
    )
      console.log(`${label}${numbered}:`);
    console.log(backup);
  }
  if (
    !terminalResultHeader(`Recovered result${numbered}`, [
      ["Mode", mode],
      ["Source", "SSKR shares"],
      ["Content", "English BIP39 mnemonic"],
      ...(place.evidence === undefined
        ? []
        : ([["Wallet", `matches the ${place.evidence}`]] as [string, string][])),
    ])
  )
    console.log(`Recovered English BIP39 mnemonic${numbered}:`);
  console.log(mnemonic);
  if (terminalColor("stderr")) {
    terminalStatus("Recovered fingerprint", masterFingerprint(mnemonic));
    terminalNotice("Fingerprint uses an empty BIP39 passphrase.");
  } else
    console.error(
      `BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(mnemonic)}`,
    );
}

/**
 * Shows a set of shares, repaired or not, each in its own form or the one of --format, and saves
 * it where the options say. A share with elements that nothing settles, such as one that could not
 * be read at all, is left out: written down, it would be a guess passed off as the share. Copies
 * of one share are shown as typed and saved once.
 */
async function exportSet(
  set: Pick<RepairedSet, "shares" | "unsettled">,
  args: ParsedArguments,
  given: ShareFormat | undefined,
  checked: SskrExportOptions | undefined,
): Promise<void> {
  reportRepairs(set);
  const unsettled = new Set(set.unsettled.map((element) => element.share));
  for (const share of unsettled)
    terminalNotice(
      `Share ${share} cannot be settled and is left out: read more of it, or use another copy.`,
      "warning",
    );
  const shown = set.shares.flatMap((share, index) =>
    unsettled.has(index + 1)
      ? []
      : [{ ur: share.ur, format: given ?? share.format, number: index + 1 }],
  );
  if (shown.length === 0) throw new Error("No share could be settled.");
  const saved = shown.filter(
    (share, index) => shown.findIndex((other) => other.ur === share.ur) === index,
  );
  validateShareSet(
    saved.map((share) => share.ur),
    false,
  );
  if (checked !== undefined && new Set(saved.map((share) => share.format)).size > 1)
    throw new Error(
      "The shares are written in different forms: choose one with --format for cards.",
    );
  const options = checked === undefined ? undefined : { ...checked, shareFormat: saved[0]!.format };
  await saveShares(saved, args, options);
  if (saved.length < shown.length) terminalNotice("Copies of one share are saved once.");
  printShares(shown, set.shares.length);
}

/**
 * Each typed share repaired from its own checks alone, as for fewer shares than the threshold;
 * undefined after showing every variant of a share that fits more than one way, of which none is
 * saved.
 */
function repairEach(
  texts: readonly string[],
  given: ShareFormat | undefined,
): ReadRepairableShare[] | undefined {
  const shares: ReadRepairableShare[] = [];
  for (const [index, text] of texts.entries()) {
    try {
      shares.push(readRepairableShare(text));
    } catch (error) {
      if (!(error instanceof ShareVariantsError)) throw error;
      terminalNotice(
        `Share ${index + 1} fits ${error.variants.length} ways, so nothing is saved: use another copy of it, or more shares.`,
        "warning",
      );
      for (const [place, variant] of error.variants.entries()) {
        const title = `Share ${index + 1}, variant ${place + 1} of ${error.variants.length}`;
        const form = SHARE_FORMAT_NAMES[given ?? variant.format];
        if (!terminalResultHeader(title, [["Format", form]])) console.error(`${title} — ${form}:`);
        console.log(writeShare(variant.ur, given ?? variant.format));
      }
      return undefined;
    }
  }
  return shares;
}

export async function runSskrExport(args: ParsedArguments): Promise<void> {
  singleOptions(args, ["share", "share-file", "share-qr", "date"]);
  // Without --format each share keeps the form it is written in, so that a share repaired from
  // its marked elements comes back as it was written, whole.
  const given = value(args, "format") === undefined ? undefined : shareFormat(args);
  const checked = exportOptions(args, given ?? "colors");
  await destinations(args, checked);
  const limit = searchLimit(args);
  // A wallet tells sets of repaired shares apart; for a Seedshift phrase it needs the dates.
  const mode = shareMode(args);
  const dateValues = dates(args);
  if (mode === "direct" && dateValues.length) throw new Error("Direct mode does not accept dates.");
  const evidence = bitcoinEvidence(args);
  const passphrase = bip39Passphrase(args);
  if (mode === "seedshift" && evidence === undefined)
    throw new Error("Seedshift mode here serves only the wallet check: give the wallet too.");
  const texts = await readShareTexts(args);
  assertShareCount(texts.length);
  const marked = texts.some((text) => text.includes("?"));
  if (!marked && evidence === undefined) {
    const shares = texts.map((text) => ({ ...readShare(text), repaired: false, filled: [] }));
    await exportSet({ shares, unsettled: [] }, args, given, checked);
    return;
  }
  const plan = marked ? await planShareRepair(texts) : undefined;
  if (plan?.assessment.verdict === "not-enough") {
    if (evidence !== undefined)
      throw new Error("The wallet can be checked only with as many shares as the threshold.");
    // Fewer shares than the threshold restore no phrase; each is then repaired on its own.
    const shares = repairEach(texts, given);
    if (shares !== undefined) await exportSet({ shares, unsettled: [] }, args, given, checked);
    return;
  }
  const sets = await restoredSets(
    texts,
    limit,
    async (secretBytes) => {
      if (mode === "seedshift") await seedshiftDates(args, dateValues, secretBytes);
    },
    plan,
  );
  const walletOf = (set: RepairedSet) =>
    mode === "direct"
      ? set.mnemonic
      : decodeInput(set.mnemonic, "english", dateValues).recoveredMnemonic;
  const matching = matchingSets(sets, evidence, walletOf, passphrase);
  if (matching.length === 1) {
    await exportSet(matching[0]!, args, given, checked);
    return;
  }
  // Every set is shown, with the fingerprint of the phrase it holds; none is chosen or saved.
  terminalNotice(
    `${matching.length} sets of shares fit. The fingerprint of each tells the right one; give it, or an address, to save that set.`,
    "warning",
  );
  for (const [index, set] of matching.entries()) {
    const title = `Variant ${index + 1} of ${matching.length}`;
    if (!terminalResultHeader(title, [["Fingerprint", backupFingerprint(set)]]))
      console.log(`${title}, fingerprint ${backupFingerprint(set)}:`);
    reportRepairs(set);
    printShares(
      set.shares.map((share, place) => ({
        ur: share.ur,
        format: given ?? share.format,
        number: place + 1,
      })),
    );
  }
  terminalHint("Each fingerprint is that of the phrase the shares hold, with an empty passphrase.");
}
