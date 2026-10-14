// The questions whether and which Seedshift was used, and their answers, the same in the menu, in
// the questions of decode and the share commands, and on the sheet for heirs, which leads through
// them (README, Transformation modes). The Original Seedshift with a valid last word is chosen
// with --mode only: it is never offered as a question.

import type { SplitMode } from "../core/masking.js";
import type { Choice } from "./terminal-choice.js";
import { defined } from "../core/defined.js";

/** The variants that a question offers. */
export type OfferedSeedshift = "seedshift" | "seedshift-legacy";

export const SEEDSHIFT_CHOICES: readonly Choice<OfferedSeedshift>[] = Object.freeze([
  {
    label: "MnemoCode Seedshift",
    note: "a valid BIP39 seed phrase again; recommended",
    value: "seedshift",
  },
  {
    label: "Original Seedshift",
    note: "as the original program; checksum usually fails",
    value: "seedshift-legacy",
  },
]);

/** The question which Seedshift masked codes or a phrase that were masked. */
export const WHICH_SEEDSHIFT_QUESTION = "Which Seedshift was used?";

/**
 * The question for codes that name no mode, which the menu asks before decode, and decode itself.
 */
export const ENCODED_SEEDSHIFT_QUESTION = "Was Seedshift used when it was encoded?";

/** The answer for codes that were not masked. */
const NO_SEEDSHIFT: Choice<"direct"> = Object.freeze({
  label: "No",
  note: "the codes stand for the words themselves",
  value: "direct",
});

/** The answers for codes that name no mode: not masked, or masked with one of the variants. */
export const ENCODED_SEEDSHIFT_CHOICES: readonly Choice<"direct" | OfferedSeedshift>[] =
  Object.freeze([NO_SEEDSHIFT, ...SEEDSHIFT_CHOICES]);

/** The question for shares, whose phrase may have been masked before it was split. */
export const SHARE_SEEDSHIFT_QUESTION = "Was Seedshift used before it was split?";

/** Its answers: shares take only MnemoCode Seedshift, so there is nothing more to choose. */
export const SHARE_SEEDSHIFT_CHOICES: readonly Choice<SplitMode>[] = Object.freeze([
  { label: "No", value: "direct" },
  { label: "Yes", note: "the dates are asked after the shares", value: "seedshift" },
]);

/** The label of the answer of `value` among `choices`, as the sheet for heirs names it. */
export function answerLabel<T>(choices: readonly Choice<T>[], value: T): string {
  return defined(choices.find((choice) => choice.value === value)).label;
}
