// Whether the cards that the options ask for can be printed with the details typed for them: the
// check that Encode and the commands of shares run before a secret is asked, and that the menu
// runs as soon as the details are typed (CORE-42), so that a detail too long for its card is typed
// again at once, with every other answer kept. Each check draws the cards in memory, writes
// nothing and shows nothing: a command says that it is checking, while the menu, whose record of
// answers counts every line it writes, says nothing.

import { parseArguments, type ParsedArguments, value } from "./arguments.js";
import { businessOptions, TYPED_CARD_TEXT_OPTIONS } from "./business-options.js";
import { cardOutputs } from "./card-options.js";
import { exportOptions } from "./sskr-output.js";
import { EncodedForm } from "../core/encoded-form.js";
import type { EncodedFormat } from "../core/types.js";
import { CardPreview, LONGEST_SAMPLE_WORDS } from "../export/card-preview.js";
import type { CardSettings } from "../export/card-settings.js";
import { assertSheetQr } from "../export/content-kinds.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { ShareCardSet } from "../export/sskr-render.js";
import type { ShareFormat } from "../sskr/transport.js";

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
 * The check that the colour cards that the options `saving` ask for can be printed in `format`,
 * with their card details: it draws them with a sample phrase of the longest length, drawn at
 * random as for every preview (CardPreview), and refuses a detail too long for its card
 * (CardPreview.assertColorsPrint). Undefined where nothing can fail (cardsMayFail): a render
 * takes seconds, so it is not made then.
 */
export function colorCardsFit(
  saving: ParsedArguments,
  format: EncodedFormat,
): (() => Promise<void>) | undefined {
  if (!EncodedForm.of(format).writtenInColors) return undefined;
  const { sheets, cards } = cardOutputs(saving);
  const settings = businessOptions(saving);
  if ((!sheets && !cards) || !cardsMayFail(saving, settings)) return undefined;
  const preview = new CardPreview(nodeCardRenderer, {
    words: LONGEST_SAMPLE_WORDS,
    settings,
    title: value(saving, "title"),
    colorForm: format,
  });
  return () => preview.assertColorsPrint(value(saving, "template"), { sheets, cards });
}

/**
 * Refuses the menu's card options `options` (such as --template, --pdf and the details) where
 * Encode could not print its colour cards in `form` with them (colorCardsFit), as Encode refuses
 * them before it asks a secret.
 */
export async function assertColorCardsFit(
  options: readonly string[],
  form: EncodedFormat,
): Promise<void> {
  await colorCardsFit(parseArguments(options), form)?.();
}

/**
 * Refuses the menu's card options `options` where the cards of shares written in `shareFormat`
 * could not be printed with them (ShareCardSet.assertPrintable), as the commands of shares
 * refuse them before they ask a secret.
 */
export async function assertShareCardsFit(
  options: readonly string[],
  shareFormat: ShareFormat,
): Promise<void> {
  const checked = exportOptions(parseArguments(options), shareFormat);
  if (checked !== undefined) await ShareCardSet.assertPrintable(nodeCardRenderer, checked);
}
