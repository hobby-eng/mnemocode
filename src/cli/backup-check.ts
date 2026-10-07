// After Encode shows its result on the private screen, the person may check the backup they have
// written down: they type it again, with the dates, and MnemoCode says whether it restores the
// same seed phrase. Most losses come from a backup written wrongly, not from theft. The check is
// offered, never required, and shows nothing of the seed phrase. The screen is cleared before it,
// so that the backup is typed from the paper rather than copied from the screen.
//
// The rules and their lines are the library's (core/backup-check.ts); this module asks and shows.
// Each part is checked as soon as it is typed. An answer that cannot be read is asked again at
// once (ask.ts), and a share that cannot be read is typed again alone. A part that can be read
// but is not the one of the result is named, the codes by their places, a share or a date by its
// place, and the person chooses to type only that part again, to see the result again, or to
// stop; the other parts are kept. --backup-check yes or no answers whether to check at all.

import {
  EncodedBackupCheck,
  KeptShares,
  RESTORES_MESSAGE,
  ShareBackupCheck,
  type BackupFinding,
  type BackupPart,
  type BackupVerdict,
  type EncodedOriginal,
  type RestoredShares,
  type WrittenCodes,
} from "../core/backup-check.js";
import type { DateShiftDate } from "../core.js";
import { nodeSharePlatform } from "../sskr/share-platform-node.js";
import { assertSskrSelfTest } from "../sskr/self-test.js";
import { value, type ParsedArguments } from "./arguments.js";
import { askAfterFailure, askSecretUntil } from "./ask.js";
import { askDates } from "./date-search.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { onPrivateScreen } from "./private-screen.js";
import { choose } from "./terminal-choice.js";
import { dropTypedAhead } from "./terminal-input.js";
import { terminalNotice } from "./terminal.js";

/** Clears the private screen and moves to its top left (VT100). */
const CLEAR_SCREEN = "\x1b[2J\x1b[H";

/** A seed phrase typed in place of the shares is sent to the menu's entry that decodes it. */
const SHARE_CHECK_TEXTS = { decodeEntry: MENU_ENTRY_NAMES.decode.label };

/**
 * What a backup typed again turned out to be, as checkShareBackup tells it without asking
 * anything: the verdict of the library's whole check, which the AUD-008 reproduction and
 * regression tests pin.
 */
export type CheckResult = BackupVerdict;

/**
 * Whether the shares typed again, separated by semicolons, restore `original` with the dates. Any
 * refusal on the way counts as unreadable. The shares are not counted against a threshold here:
 * the restore asks for the quorum that they record.
 */
export async function checkShareBackup(
  original: string,
  typed: string,
  mode: "direct" | "seedshift",
  dateLine: string,
): Promise<CheckResult> {
  try {
    await assertSskrSelfTest();
    const check = new ShareBackupCheck(
      { mnemonic: original, mode, threshold: 1 },
      nodeSharePlatform,
      SHARE_CHECK_TEXTS,
    );
    return (await check.check({ backup: typed, dates: dateLine })).verdict;
  } catch {
    return "unreadable";
  }
}

/** The answer that types a part of the backup again. */
const AGAIN: Readonly<Record<BackupPart, string>> = {
  codes: "Type the codes again",
  dates: "Type the dates again",
  shares: "Type the shares again",
};

/** What the person chose after a part that does not fit. */
type AfterMismatch = "again" | "show" | "stop";

/** Says what does not fit, in one line, and asks what to do. */
async function afterMismatch(found: BackupFinding): Promise<AfterMismatch> {
  terminalNotice(found.message, "warning");
  return askAfterFailure("What now?", [
    { label: AGAIN[found.part], value: "again" },
    { label: "Show the result again", value: "show" },
    { label: "Stop checking", value: "stop" },
  ] as const);
}

/** How a check ended: done (it restores, or the person stopped), or the result is to be shown. */
type CheckEnd = "done" | "show";

/** The success line of a check. */
function restores(): CheckEnd {
  terminalNotice(RESTORES_MESSAGE, "success");
  return "done";
}

/** The dates of the backup, typed again whole: no ? for a forgotten digit. */
async function askBackupDates(wordCount: number): Promise<readonly DateShiftDate[]> {
  return (await askDates({ wordCount, patterns: false })).known;
}

/** One check of an encoded backup: the codes, then the dates, each typed again until they fit. */
async function checkCodes(check: EncodedBackupCheck): Promise<CheckEnd> {
  let codes: WrittenCodes | undefined;
  let dates: readonly DateShiftDate[] | undefined;
  for (;;) {
    codes ??= await askSecretUntil(
      "Your backup, as written down:",
      (typed) => check.readCodes(typed),
      { what: "the codes you wrote down" },
    );
    let found = check.compareCodes(codes);
    if (found === undefined && check.dated) {
      dates ??= await askBackupDates(check.wordCount);
      found = check.compareDates(dates);
    }
    found ??= check.compareRestored(codes, dates ?? []);
    if (found === undefined) return restores();
    const next = await afterMismatch(found);
    if (next !== "again") return next === "show" ? "show" : "done";
    if (found.part === "dates") dates = undefined;
    else codes = undefined;
  }
}

/** What a check asks for, in the note of the question that offers it. */
interface CheckedParts {
  /** The codes or the shares: "the codes", "2 shares". */
  readonly what: string;
  /** Whether the backup has dates, which are typed again too: not without Seedshift. */
  readonly dated: boolean;
}

/** The answer of --backup-check to "Check the backup now?"; undefined asks it. */
export type BackupCheckAnswer = "yes" | "no" | undefined;

/**
 * --backup-check, checked before any secret is asked: it answers a question of the private screen,
 * and a record with a replaced last word has no check to answer.
 */
export function backupCheckAnswer(args: ParsedArguments): BackupCheckAnswer {
  const given = value(args, "backup-check");
  if (given === undefined) return undefined;
  if (given !== "yes" && given !== "no") throw new Error("--backup-check must be yes or no.");
  if (args["ask-secrets"] !== true)
    throw new Error("--backup-check answers a question of --ask-secrets, after the result.");
  if (args["legacy-valid-last-word"] === true)
    throw new Error(
      "--backup-check has nothing to check: a record with a replaced last word cannot be checked.",
    );
  return given;
}

/**
 * Offers the check on the private screen, which the caller has made sure of, and repeats it as
 * long as the person wants. `check` runs one check; `show` puts the result on the screen again.
 * `answer` answers the first question, as --backup-check gave it.
 */
async function offerCheck(
  parts: CheckedParts,
  check: () => Promise<CheckEnd>,
  show: () => void,
  answer: BackupCheckAnswer,
): Promise<void> {
  for (let given = answer; ; given = undefined) {
    const wanted = given === undefined ? await askToCheck(parts) : given === "yes";
    if (!wanted) return;
    process.stderr.write(CLEAR_SCREEN);
    if ((await check()) === "done") return;
    process.stderr.write(CLEAR_SCREEN);
    show();
  }
}

/** The check after an encoded seed phrase; not for a legacy record with a replaced last word. */
export async function offerEncodedCheck(
  original: EncodedOriginal,
  show: () => void,
  answer: BackupCheckAnswer,
): Promise<void> {
  if (!onPrivateScreen() || !EncodedBackupCheck.supports(original.mode)) return;
  const check = new EncodedBackupCheck(original);
  return offerCheck(
    { what: "the codes", dated: check.dated },
    () => checkCodes(check),
    show,
    answer,
  );
}

/** Asks whether to check the backup now; Escape answers No. */
async function askToCheck(parts: CheckedParts): Promise<boolean> {
  console.error("");
  // Only a key pressed for this question answers it, not an Enter typed during a long save.
  await dropTypedAhead();
  const wanted = await choose(
    "Check the backup now?",
    [
      {
        label: "Yes",
        note: `type ${parts.what} from what you wrote down${parts.dated ? ", and the dates" : ""}`,
        value: true,
      },
      { label: "No", value: false },
    ],
    // Escape answers No: there is no earlier question to go back to.
    { label: "Check", quit: "skips the check" },
  );
  return wanted === true;
}

// Shamir shares.

/**
 * Asks for the shares until each can be read: a share that cannot be read is named and typed
 * again alone, and the others are kept. `problem`, shown first, is why the last ones did not do.
 */
async function askShares(check: ShareBackupCheck, problem: string | undefined): Promise<string[]> {
  if (problem !== undefined) terminalNotice(problem, "warning");
  const shares = await askSecretUntil(
    `${check.threshold} shares as written down (separate with ;, ? for each unreadable code or digit):`,
    (answer) => check.sharesOf(answer),
    { what: "the shares", pastedLineBreak: ";" },
  );
  for (;;) {
    const place = shares.findIndex(
      (share, index) => check.shareProblem(index + 1, share) !== undefined,
    );
    if (place < 0) return shares;
    terminalNotice(check.shareProblem(place + 1, shares[place]!)!, "warning");
    shares[place] = await askSecretUntil(
      `Share ${place + 1} as written down:`,
      (answer) => {
        const reason = check.shareProblem(place + 1, answer);
        if (reason !== undefined) throw new Error(reason);
        return answer;
      },
      { what: `share ${place + 1}` },
    );
  }
}

/**
 * The shares typed again and restored: exact copies are left out once, with a note each, as
 * sskr-combine does. Shares that cannot be restored are typed again, after `problem`.
 */
async function askRestoredShares(check: ShareBackupCheck): Promise<RestoredShares> {
  for (let problem: string | undefined; ;) {
    const kept = KeptShares.of(await askShares(check, problem));
    for (const note of kept.notes) terminalNotice(note);
    try {
      return await check.restore(kept);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      problem = error.message;
    }
  }
}

/** One check of shares: the shares, then the dates, each typed again until they fit. */
async function checkShares(check: ShareBackupCheck): Promise<CheckEnd> {
  // The split ran it before the shares were shown; a check on its own runs it too.
  await assertSskrSelfTest();
  let restored: RestoredShares | undefined;
  let dates: readonly DateShiftDate[] | undefined;
  for (;;) {
    restored ??= await askRestoredShares(check);
    let found = check.compareShares(restored);
    if (found === undefined && check.dated) {
      dates ??= await askBackupDates(check.wordCount);
      found = check.compareDates(restored, dates);
    }
    found ??= check.compareChecked(restored);
    if (found === undefined) return restores();
    const next = await afterMismatch(found);
    if (next !== "again") return next === "show" ? "show" : "done";
    if (found.part === "dates") dates = undefined;
    else restored = undefined;
  }
}

/**
 * The check after Shamir shares: enough of them typed again, with the dates. With the `dates` of
 * the result, a wrong date is named by its place before anything is restored with it.
 */
export async function offerShareCheck(
  original: string,
  mode: "direct" | "seedshift",
  threshold: number,
  show: () => void,
  answer: BackupCheckAnswer,
  dates?: readonly DateShiftDate[],
): Promise<void> {
  if (!onPrivateScreen()) return;
  const check = new ShareBackupCheck(
    { mnemonic: original, mode, threshold, dates },
    nodeSharePlatform,
    SHARE_CHECK_TEXTS,
  );
  return offerCheck(
    { what: `${threshold} shares`, dated: check.dated },
    () => checkShares(check),
    show,
    answer,
  );
}
