// sskr-export: shares read back, repaired where marked, and written again in another form or as
// cards, as sskr-split writes them (sskr-output.ts).

import {
  NO_SHARE_SETTLED,
  ShareRestore,
  variantsMessage,
  WALLET_CHECK_NEEDS_THRESHOLD,
  type RestoredPhrase,
} from "../sskr/share-restore.js";
import {
  FINGERPRINT_DISCLOSURE,
  terminalHint,
  terminalNotice,
  terminalResultHeader,
} from "./terminal.js";
import { reportRenamedOutputs } from "./output-paths.js";
import { assertSingleValues, value, type ParsedArguments } from "./arguments.js";
import { Masking, PHRASE_WORDS } from "../core/masking.js";
import { masterFingerprint } from "../bitcoin-evidence.js";
import type { ReadRepairableShare } from "../sskr/repair.js";
import { type ShareFormat } from "../sskr/transport.js";
import { ShareInput } from "../sskr/share-input.js";
import { SHARE_FORMAT_NAMES } from "../sskr/share-set.js";
import { mendShares, reportRepairs, addMoreShares } from "./share-repair.js";
import { askAfterFailure, askOrCancel, WHAT_NOW } from "./ask.js";
import { preflightOutputs } from "./output-saving.js";
import {
  assertShareCardsPrintable,
  exportOptions,
  printShareBlock,
  printShares,
  saveShares,
  shareFormat,
  type ShareCardOptions,
} from "./sskr-output.js";
import {
  type Recovery,
  recoverySettings,
  reportWalletWarnings,
  restorePhrases,
  typedShares,
} from "./sskr-restore-command.js";
import type { RepairedSet, RepairedShares } from "../sskr/joint-results.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.sskr-export-command", {
  "card-form-refused": suppliedMessage,
  "no-share-settled": () => NO_SHARE_SETTLED,
  "repair-each-refused": suppliedMessage,
  "few-export-refused": suppliedMessage,
  "run-sskr-export-refused": suppliedMessage,
});

/**
 * Asks in which form cards show shares written in different forms; Stop cancels (CANCELLED).
 * Without a private screen the mix ends the command.
 */
async function cardForm(
  forms: readonly ShareFormat[],
  interactive: boolean,
): Promise<ShareFormat | Cancelled> {
  const message = "The shares are written in different forms: choose one with --format for cards.";
  if (!interactive) throw ERRORS.create("card-form-refused", [message]);
  return askOrCancel(
    "The shares are written in different forms. Which form should the cards show?",
    forms.map((format) => ({ label: SHARE_FORMAT_NAMES[format], value: format })),
    { label: "Cards" },
  );
}

/**
 * Shows a set of shares, repaired or not, each in its own form or the one of --format, and saves
 * it where the options say, by the rules of an export (ShareExport): a share with elements that
 * nothing settles is left out, and copies of one share are shown as typed and saved once.
 * "changed" when no share could be settled and those shares were typed again on the private
 * screen, to be restored anew; CANCELLED when the person cancelled.
 */
async function exportSet(
  r: Recovery,
  set: RepairedShares,
  places: readonly number[],
  given: ShareFormat | undefined,
  checked: ShareCardOptions | undefined,
  args: ParsedArguments,
): Promise<"exported" | "changed" | Cancelled> {
  reportRepairs(set, places);
  const checkedExport = ShareInput.checkedExport(set, places, given);
  using initialExport = checkedExport.written;
  let written = initialExport;
  let reformatted: typeof written | undefined;
  try {
    for (const message of written.leftOutMessages()) terminalNotice(message, "warning");
    if (checkedExport.kind === "none") {
      if (!r.interactive) throw ERRORS.create("no-share-settled", []);
      for (const place of written.leftOut)
        if ((await r.shares.retype(place)) === CANCELLED) return CANCELLED;
      return "changed";
    }
    if (checkedExport.kind === "trouble")
      return (await mendShares(r.shares, checkedExport.trouble, r.interactive)) ?? "changed";
    if (checked !== undefined && written.forms.length > 1) {
      const form = await cardForm(written.forms, r.interactive);
      if (form === CANCELLED) return CANCELLED;
      reformatted = written.inForm(form);
      written = reformatted;
    }
    const saved = written.saved;
    const options =
      checked === undefined ? undefined : { ...checked, shareFormat: defined(saved[0]).format };
    if ((await saveShares(saved, args, options, Masking.of(r.mode).masked)) === CANCELLED)
      return CANCELLED;
    reportRenamedOutputs();
    if (written.copiesNote !== undefined) terminalNotice(written.copiesNote);
    // The shares come back as they were split: a page and this screen name what they hold, so
    // that a masked phrase is not taken for the wallet's.
    terminalNotice(
      Masking.of(r.mode).masked ? PHRASE_WORDS.repairedMasked : PHRASE_WORDS.repairedUnknown,
    );
    printShares(
      written.shown,
      written.total,
      Masking.of(r.mode).masked ? PHRASE_WORDS.masked : undefined,
    );
    return "exported";
  } finally {
    reformatted?.wipe();
  }
}

/**
 * Each typed share repaired from its own checks alone, as for fewer shares than the threshold
 * (ShareInput.repairEach). A share that fits more than one way has its variants shown; on the
 * private screen it may then be typed again from another copy, or more shares added ("changed");
 * otherwise nothing is saved (undefined). A share that cannot be repaired is typed again
 * ("changed"), or ends the command. CANCELLED when the person cancelled.
 */
async function repairEach(
  r: Recovery,
  given: ShareFormat | undefined,
): Promise<readonly ReadRepairableShare[] | "changed" | undefined | Cancelled> {
  const each = r.shares.input.repairEach();
  if (each.kind === "repaired") return each.shares;
  const { place } = each;
  if (each.kind === "unreadable") {
    if (!r.interactive)
      throw ERRORS.create("repair-each-refused", [each.message], { cause: each.cause });
    return (await r.shares.retype(place, each.message)) ?? "changed";
  }
  terminalNotice(each.message, "warning");
  for (const [index, variant] of each.variants.entries()) {
    printShareBlock(
      `Share ${place}, variant ${index + 1} of ${each.variants.length}`,
      variant.ur,
      given ?? variant.format,
    );
  }
  if (!r.interactive) return undefined;
  const next = await askAfterFailure(WHAT_NOW, [
    { label: `Type share ${place} again`, note: "from another copy", value: "again" },
    addMoreShares("more" as const),
    { label: "Done", note: "nothing is saved", value: "done" },
  ] as const);
  if (next === CANCELLED) return CANCELLED;
  if (next === "done") return undefined;
  const changed = next === "again" ? await r.shares.retype(place) : await r.shares.askMore();
  return changed ?? "changed";
}

/**
 * Shows every set that fits, `sets` of `phrases`, with the fingerprint of the phrase it holds,
 * its shares named by `places`; none is saved. `walletGiven` says that each matched the wallet
 * given, which then cannot tell them apart.
 */
function showVariants(
  phrases: readonly RestoredPhrase[],
  sets: readonly RepairedSet[],
  places: readonly number[],
  given: ShareFormat | undefined,
  walletGiven: boolean,
): void {
  // Each with the wallet's own fingerprint, of the phrase after the dates (ShareRestore.variants),
  // in the order of their sets, which say what a repair filled in.
  const variants = ShareRestore.variants(phrases, places, given, masterFingerprint);
  terminalNotice(variantsMessage(variants.length, walletGiven), "warning");
  terminalHint(
    `Each fingerprint is that of the phrase the shares hold, with an empty passphrase. ${FINGERPRINT_DISCLOSURE}`,
  );
  for (const [index, variant] of variants.entries()) {
    const title = `Variant ${index + 1} of ${variants.length}`;
    const fingerprint = defined(variant.fingerprint);
    if (!terminalResultHeader(title, [[PHRASE_WORDS.originalFingerprint, fingerprint]]))
      console.log(`${title}, original fingerprint ${fingerprint}:`);
    reportRepairs(defined(sets[index]), places);
    printShares(
      variant.shares.map((share) => ({
        ur: share.record,
        format: share.format,
        number: share.number,
      })),
      Math.max(...places),
    );
  }
}

/**
 * After too few shares to restore the phrase that the wallet given is checked against: on the
 * private screen more shares, the export without the wallet check, or Stop, which cancels;
 * otherwise "few" with the wallet kept, which the export decision refuses (exportOnce). Escape and
 * the end of the input are Stop (askAfterFailure), so that the check asked for is dropped only
 * when the person chooses so.
 */
async function fewForExport(r: Recovery): Promise<"again" | "few" | Cancelled> {
  if (r.evidence === undefined || !r.interactive) return "few";
  terminalNotice(WALLET_CHECK_NEEDS_THRESHOLD, "warning");
  const next = await askOrCancel(WHAT_NOW, [
    addMoreShares("more" as const),
    {
      label: "Go on without the wallet check",
      note: "each share alone",
      value: "without" as const,
    },
  ]);
  if (next === CANCELLED) return CANCELLED;
  if (next === "more") return (await r.shares.askMore()) ?? "again";
  r.evidence = undefined;
  return "few";
}

/**
 * Exports the shares given, or typed on the private screen, after repairing them where marked;
 * CANCELLED when the person cancelled.
 */
export async function runSskrExport(args: ParsedArguments): Promise<Cancelled | undefined> {
  // Again for the menu, which runs the command without the command line's checks.
  assertSingleValues(args);
  // Without --format each share keeps the form it is written in, so that a share repaired from
  // its marked elements comes back as it was written, whole.
  const given = value(args, "format") === undefined ? undefined : shareFormat(args);
  const checked = exportOptions(args, given ?? "colors");
  await preflightOutputs(args);
  // In colors where the shares keep their own form, which is known only once they are typed.
  await assertShareCardsPrintable(checked);
  const settings = await recoverySettings(args);
  using initialDates = settings.dates;
  // Refused before the shares are asked.
  const refusal = ShareRestore.repairRefusal(settings.mode, settings.evidence !== undefined);
  if (refusal !== undefined) throw ERRORS.create("run-sskr-export-refused", [refusal]);
  const shares = await typedShares(args);
  if (shares === CANCELLED) return CANCELLED;
  using ownedShares = shares;
  const r: Recovery = { ...settings, dates: initialDates, shares: ownedShares };
  try {
    for (;;) {
      const exported = await exportOnce(r, given, checked, args);
      if (exported !== "changed") return exported;
    }
  } finally {
    r.dates?.wipe();
  }
}

/**
 * One try of runSskrExport with the shares as they are now: "changed" when they were changed on
 * the private screen, to be tried again; undefined once the shares were exported, or shown as
 * variants, or nothing was to be saved.
 */
async function exportOnce(
  r: Recovery,
  given: ShareFormat | undefined,
  checked: ShareCardOptions | undefined,
  args: ParsedArguments,
): Promise<"changed" | undefined | Cancelled> {
  if (ShareRestore.rewritesOnly(r.shares.input, r.evidence !== undefined)) {
    const typed = r.shares.input.rewritten();
    if (typed.kind === "trouble")
      return (await mendShares(r.shares, typed.trouble, r.interactive)) ?? "changed";
    return settled(await exportSet(r, typed.set, r.shares.places(), given, checked, args));
  }
  const restored = await restorePhrases(r, { few: () => fewForExport(r), one: true });
  if (restored === CANCELLED) return CANCELLED;
  if (
    restored.kind === "few" &&
    ShareRestore.rewritesOnly(r.shares.input, r.evidence !== undefined)
  )
    return "changed";
  const decision = ShareRestore.exportDecision(restored, r.evidence !== undefined);
  // The one trouble left here: fewer shares than the threshold with the wallet kept, off the
  // private screen (fewForExport). Where no phrase fits, restorePhrases refused or asked again.
  if (decision.kind === "trouble") throw ERRORS.create("few-export-refused", [decision.message]);
  if (decision.kind === "each") {
    // Without the wallet check complete shares are only written again (rewritesOnly), above.
    // Fewer shares than the threshold restore no phrase; each is then repaired on its own.
    const shares = await repairEach(r, given);
    if (shares === undefined || shares === "changed" || shares === CANCELLED) return shares;
    const set = { shares, unsettled: [] };
    return settled(await exportSet(r, set, r.shares.places(), given, checked, args));
  }
  const { sets, places, phrases } = decision.found;
  if (decision.kind === "variants") {
    showVariants(phrases, sets, places, given, r.evidence !== undefined);
    reportWalletWarnings(phrases);
    return undefined;
  }
  const exported = settled(await exportSet(r, decision.set, places, given, checked, args));
  if (exported === undefined) reportWalletWarnings(phrases);
  return exported;
}

/** What exportSet gave, as exportOnce ends: undefined once the shares were exported. */
function settled(exported: "exported" | "changed" | Cancelled): "changed" | undefined | Cancelled {
  return exported === "exported" ? undefined : exported;
}
