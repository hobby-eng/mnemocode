// After Encode shows its result on the private screen, the person may check the backup they have
// written down: they type it again, with the dates, and MnemoCode says whether it restores the
// same seed phrase. Most losses come from a backup written wrongly, not from theft. The check is
// offered, never required, and shows nothing of the seed phrase. The screen is cleared before it,
// so that the backup is typed from the paper rather than copied from the screen.

import {
  decodeInput,
  decodeInputDirect,
  decodeInputLegacy,
  parseDate,
  type DateShiftDate,
} from "../core.js";
import { parseRecord } from "../record.js";
import { combineSskrShares } from "../sskr/shares.js";
import {
  askSecret,
  datesPrompt,
  wordCountOf,
  type EncodedFormat,
  type TransformMode,
} from "./input.js";
import { onPrivateScreen } from "./private-screen.js";
import { choose } from "./terminal-choice.js";
import { terminalNotice } from "./terminal.js";

/** Clears the private screen and moves to its top left (VT100). */
const CLEAR_SCREEN = "\x1b[2J\x1b[H";

/** What a backup typed again turned out to be. */
export type CheckResult = "restores" | "differs" | "unreadable";

function datesOf(line: string): DateShiftDate[] {
  return line.split(/\s+/u).filter(Boolean).map(parseDate);
}

/**
 * Whether `typed`, the encoded seed phrase or a record as written down, restores `original` with
 * the dates typed again. A record names its own form and mode.
 */
export function checkEncodedBackup(
  original: string,
  typed: string,
  format: EncodedFormat,
  mode: TransformMode,
  dateLine: string,
): CheckResult {
  try {
    const record = parseRecord(typed);
    const recordMode = record?.mode ?? mode;
    const recordFormat = record?.format ?? format;
    const payload = record?.payload ?? typed;
    const dates = recordMode === "direct" ? [] : datesOf(dateLine);
    const decoded =
      recordMode === "direct"
        ? decodeInputDirect(payload, recordFormat)
        : recordMode === "seedshift-legacy"
          ? decodeInputLegacy(payload, recordFormat, dates)
          : decodeInput(payload, recordFormat, dates);
    return decoded.recoveredMnemonic === original ? "restores" : "differs";
  } catch {
    return "unreadable";
  }
}

/** Whether the shares typed again, separated by semicolons, restore `original` with the dates. */
export async function checkShareBackup(
  original: string,
  typed: string,
  mode: "direct" | "seedshift",
  dateLine: string,
): Promise<CheckResult> {
  let masked: string;
  try {
    masked = await combineSskrShares(typed.split(";"));
  } catch {
    return "unreadable";
  }
  try {
    const restored =
      mode === "direct"
        ? masked
        : decodeInput(masked, "english", datesOf(dateLine)).recoveredMnemonic;
    return restored === original ? "restores" : "differs";
  } catch {
    return "unreadable";
  }
}

/**
 * Offers the check on the private screen and repeats it as long as the person wants. `ask` types
 * the backup in again and returns its result; `show` puts the result on the screen once more.
 */
async function offerCheck(
  what: string,
  ask: () => Promise<CheckResult>,
  show: () => void,
): Promise<void> {
  if (!onPrivateScreen()) return;
  console.error("");
  const wanted = await choose(
    "Check the backup now?",
    [
      { label: "Yes", note: `type ${what} from what you wrote down, and the dates`, value: true },
      { label: "No", value: false },
    ],
    { label: "Check" },
  );
  if (wanted !== true) return;
  for (;;) {
    process.stderr.write(CLEAR_SCREEN);
    const result = await ask();
    if (result === "restores") {
      terminalNotice("The backup restores this seed phrase.", "success");
      return;
    }
    terminalNotice(
      result === "unreadable"
        ? "The backup cannot be read: check every code or word."
        : "The backup gives another seed phrase: check the codes and the dates.",
      "warning",
    );
    console.error("");
    const next = await choose(
      "What now?",
      [
        { label: "Try again", value: "again" },
        { label: "Show the result again", value: "show" },
        { label: "Stop checking", value: "stop" },
      ] as const,
      { label: "Next" },
    );
    if (next === "show") {
      process.stderr.write(CLEAR_SCREEN);
      show();
      return offerCheck(what, ask, show);
    }
    if (next !== "again") return;
  }
}

/** The check after an encoded seed phrase; not for a legacy record with a replaced last word. */
export async function offerEncodedCheck(
  original: string,
  format: EncodedFormat,
  mode: TransformMode,
  show: () => void,
): Promise<void> {
  if (mode === "seedshift-legacy-valid") return;
  return offerCheck(
    "the codes",
    async () => {
      const typed = await askSecret("Your backup, as written down:");
      const dateLine = mode === "direct" ? "" : await askSecret(datesPrompt(wordCountOf(original)));
      return checkEncodedBackup(original, typed, format, mode, dateLine);
    },
    show,
  );
}

/** The check after Shamir shares: enough of them typed again, with the dates. */
export async function offerShareCheck(
  original: string,
  mode: "direct" | "seedshift",
  threshold: number,
  show: () => void,
): Promise<void> {
  return offerCheck(
    `${threshold} shares`,
    async () => {
      const typed = await askSecret(
        `${threshold} shares as written down (separate with ;, ? for each unreadable code):`,
      );
      const dateLine = mode === "direct" ? "" : await askSecret(datesPrompt(wordCountOf(original)));
      return checkShareBackup(original, typed, mode, dateLine);
    },
    show,
  );
}
