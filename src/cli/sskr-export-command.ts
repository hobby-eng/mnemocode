// sskr-export: shares read back, repaired where marked, and written again in another form or as
// cards, as sskr-split writes them (sskr-output.ts).

import {
  NO_SHARE_SETTLED,
  ShareRestore,
  variantsMessage,
  WALLET_CHECK_NEEDS_THRESHOLD,
  type RestoredPhrase,
} from "../sskr/share-restore.js";
import { terminalHint, terminalNotice, terminalResultHeader } from "./terminal.js";
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
  restorePhrases,
  typedShares,
} from "./sskr-restore-command.js";
import type { RepairedSet, RepairedShares } from "../sskr/joint-repair.js";

/**
 * Asks in which form cards show shares written in different forms; Stop cancels. Without a
 * private screen the mix ends the command.
 */
async function cardForm(forms: readonly ShareFormat[], interactive: boolean): Promise<ShareFormat> {
  const message = "The shares are written in different forms: choose one with --format for cards.";
  if (!interactive) throw new Error(message);
  return askOrCancel(
    "The shares are written in different forms. Which form should the cards show?",
    forms.map((format) => ({ label: SHARE_FORMAT_NAMES[format], value: format })),
    { label: "Cards" },
  );
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
  set: RepairedShares,
  places: readonly number[],
  given: ShareFormat | undefined,
  checked: ShareCardOptions | undefined,
  args: ParsedArguments,
): Promise<boolean> {
  reportRepairs(set, places);
  const checkedExport = ShareInput.checkedExport(set, places, given);
  let { written } = checkedExport;
  for (const message of written.leftOutMessages()) terminalNotice(message, "warning");
  if (checkedExport.kind === "none") {
    if (!r.interactive) throw new Error(NO_SHARE_SETTLED);
    for (const place of written.leftOut) await r.shares.retype(place);
    return false;
  }
  if (checkedExport.kind === "trouble") {
    await mendShares(r.shares, checkedExport.trouble, r.interactive);
    return false;
  }
  if (checked !== undefined && written.forms.length > 1)
    written = written.inForm(await cardForm(written.forms, r.interactive));
  const saved = written.saved;
  const options = checked === undefined ? undefined : { ...checked, shareFormat: saved[0]!.format };
  await saveShares(saved, args, options, Masking.of(r.mode).masked);
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
  if (next === "done") return undefined;
  if (next === "again") await r.shares.retype(place);
  else await r.shares.askMore();
  return "changed";
}

/**
 * Shows every set that fits, `sets` of `phrases`, with the fingerprint of the phrase it holds,
 * its shares named by `places`; none is saved.
 */
function showVariants(
  phrases: readonly RestoredPhrase[],
  sets: readonly RepairedSet[],
  places: readonly number[],
  given: ShareFormat | undefined,
): void {
  // Each with the wallet's own fingerprint, of the phrase after the dates (ShareRestore.variants),
  // in the order of their sets, which say what a repair filled in.
  const variants = ShareRestore.variants(phrases, places, given, masterFingerprint);
  terminalNotice(variantsMessage(variants.length), "warning");
  for (const [index, variant] of variants.entries()) {
    const title = `Variant ${index + 1} of ${variants.length}`;
    const fingerprint = variant.fingerprint!;
    if (!terminalResultHeader(title, [[PHRASE_WORDS.originalFingerprint, fingerprint]]))
      console.log(`${title}, original fingerprint ${fingerprint}:`);
    reportRepairs(sets[index]!, places);
    printShares(
      variant.shares.map((share) => ({
        ur: share.record,
        format: share.format,
        number: share.number,
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
  const message = WALLET_CHECK_NEEDS_THRESHOLD;
  if (!r.interactive) throw new Error(message);
  terminalNotice(message, "warning");
  const next = await askOrCancel(WHAT_NOW, [
    addMoreShares("more" as const),
    {
      label: "Go on without the wallet check",
      note: "each share alone",
      value: "without" as const,
    },
  ]);
  if (next === "more") {
    await r.shares.askMore();
    return "again";
  }
  r.evidence = undefined;
  return "few";
}

export async function runSskrExport(args: ParsedArguments): Promise<void> {
  // Again for the menu, which runs the command without the command line's checks.
  assertSingleValues(args);
  // Without --format each share keeps the form it is written in, so that a share repaired from
  // its marked elements comes back as it was written, whole.
  const given = value(args, "format") === undefined ? undefined : shareFormat(args);
  const checked = exportOptions(args, given ?? "colors");
  await preflightOutputs(args);
  const settings = await recoverySettings(args);
  // Refused before the shares are asked.
  const refusal = ShareRestore.repairRefusal(settings.mode, settings.evidence !== undefined);
  if (refusal !== undefined) throw new Error(refusal);
  const r: Recovery = { ...settings, shares: await typedShares(args) };
  for (;;) {
    if (ShareRestore.rewritesOnly(r.shares.input, r.evidence !== undefined)) {
      const typed = r.shares.input.rewritten();
      if (typed.kind === "trouble") {
        await mendShares(r.shares, typed.trouble, r.interactive);
        continue;
      }
      if (await exportSet(r, typed.set, r.shares.places(), given, checked, args)) return;
      continue;
    }
    const restored = await restorePhrases(r, { few: () => fewForExport(r), one: true });
    if (restored.kind === "few") {
      // Without the wallet check complete shares are only written again (rewritesOnly), above.
      if (ShareRestore.rewritesOnly(r.shares.input, r.evidence !== undefined)) continue;
      // Fewer shares than the threshold restore no phrase; each is then repaired on its own.
      const shares = await repairEach(r, given);
      if (shares === undefined) return;
      if (shares === "changed") continue;
      const set = { shares, unsettled: [] };
      if (await exportSet(r, set, r.shares.places(), given, checked, args)) return;
      continue;
    }
    const { sets, places } = restored;
    if (sets.length > 1) return showVariants(restored.phrases, sets, places, given);
    if (await exportSet(r, sets[0]!, places, given, checked, args)) return;
  }
}
