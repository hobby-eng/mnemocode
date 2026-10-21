// A command that asks for a secret or shows one runs on the terminal's alternate screen, as `less`
// shows a file and as `mhfe` shows a phrase (src/bin/mhfe/terminal.rs): neither what is typed
// there nor the result reaches the main screen or its scrollback, and after Enter the alternate
// screen is cleared and the terminal returns to where it was. Only the summary of the command is
// then printed on the main screen (CORE-39, printSummary): what was saved and where, and the
// warnings that still hold, never a secret. On this private screen the secrets are shown as they
// are typed, so that the person can check them (ask.ts, askSecretUntil). A script or a pipe on
// standard input gets none of this, and output sent to a file or a pipe is written there as before.

import { ANSWER_LABEL_WIDTH, rowsOf, waitForEnter } from "./terminal-choice.js";
import { terminalAvailable } from "./terminal-input.js";
import {
  CLEAR_SCREEN,
  ENTER_ALTERNATE_SCREEN,
  flushed,
  LEAVE_ALTERNATE_SCREEN,
  moreLine,
  noticeLines,
  terminalHint,
} from "./terminal.js";
import { PrivatePage } from "./private-page.js";
import { PrivateSteps } from "./private-steps.js";
import { PrivateSummary, type SummaryLine } from "./private-summary.js";
import { factLine, headingLine } from "./terminal-style.js";
import { ProcessProtection } from "./protection.js";
import { CANCELLED_EXIT_CODE } from "./exit-codes.js";
import { Interruption } from "./interruption.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";

/** What the private screen asks before it is cleared, after a blank line. */
const CLEAR_PROMPT = "Press Enter to clear this screen.";

/**
 * The rows that close the private screen under a result: the blank line and CLEAR_PROMPT, which
 * a check of the room on the screen counts with the result.
 */
export function closingRows(): number {
  return rowsOf(["", CLEAR_PROMPT]);
}

// The exit code of a tool stopped by Ctrl+C, here too for the modules that take it from here.
export { CANCELLED_EXIT_CODE };

/**
 * Whether a person at a terminal answers and reads: standard input and standard error are a
 * terminal. Standard output may go to a file; the questions and messages still use the screen.
 */
export function privateScreenAvailable(): boolean {
  return terminalAvailable();
}

/** Whether the private screen is shown now, so that a secret typed there may be shown too. */
export function onPrivateScreen(): boolean {
  return PrivateSteps.active;
}

/**
 * Shows on the private screen what protects this process now (ProcessProtection.summary): first
 * when the screen opens, and again once a command has given up rights after its questions.
 */
export function showProtection(): void {
  if (!PrivateSteps.active) return;
  // Kept on the screen of the first question that follows, which would otherwise clear it.
  PrivateSteps.keep(() =>
    console.error(
      `${factLine(process.stderr, "Protection", ProcessProtection.summary(), ANSWER_LABEL_WIDTH)}\n`,
    ),
  );
}

/**
 * Clears the private screen before a result, so that it stands alone, without the questions and
 * the search above it, as each step of `mhfe` gets a screen of its own. Whether it was cleared:
 * outside the private screen nothing is.
 */
export function clearPrivateScreen(): boolean {
  if (!PrivateSteps.active) return false;
  PrivateSteps.newPage();
  process.stderr.write(CLEAR_SCREEN);
  return true;
}

/** The last line of the summary of a command whose result was read and cleared with Enter. */
const CLEARED = "The screen with the result was cleared.";

/**
 * Prints on the main screen, just left, the summary of the command `title` (CORE-39): its heading,
 * then what was saved and the warnings that still hold (`lines`, PrivateSummary), as their notices
 * showed them, and CLEARED where the result was read and cleared. A command that was cancelled or
 * failed gets its one line after this, "Cancelled." or the error, and nothing here when it has
 * nothing to tell.
 */
function printSummary(title: string, lines: readonly SummaryLine[], cleared: boolean): void {
  if (lines.length === 0 && !cleared) return;
  console.error(`\n${headingLine(process.stderr, title)}`);
  for (const { kind, text, more } of lines) {
    for (const line of noticeLines(text, kind)) console.error(line);
    if (more !== undefined) console.error(moreLine(more));
  }
  if (cleared) terminalHint(CLEARED);
}

/**
 * Runs `body` on the alternate screen when privateScreenAvailable(), waits for Enter after it
 * succeeds and then leaves the screen, leaving the summary of the command on the main screen
 * (printSummary). When `body` fails, the screen is left at once, so that the error is shown on the
 * main screen. Ctrl+C also leaves it first: at a question and during a long search it is read as a
 * key (CtrlCWatch), and `body` gives CANCELLED, as the question after the result does at
 * Ctrl+C; SIGINT, from Ctrl+C while `body` computes something else or sent by other means, leaves
 * the screen before the command ends as cancelled (interruption.ts).
 */
export async function withPrivateScreen<T>(
  body: () => Promise<T | Cancelled>,
  title = "Private operation",
): Promise<T | Cancelled> {
  if (!privateScreenAvailable()) return body();
  // Written raw: NO_COLOR removes colours, not the screen switch.
  process.stderr.write(ENTER_ALTERNATE_SCREEN);
  PrivateSummary.open();
  PrivatePage.open();
  PrivateSteps.open(
    () => {
      process.stderr.write(CLEAR_SCREEN);
      console.error(`${headingLine(process.stderr, title)}\n`);
    },
    (warning) => {
      for (const line of noticeLines(warning, "warning")) console.error(line);
    },
  );
  let left = false;
  // Once, by whichever comes first: the end of `body`, or a SIGINT, after which the command ends.
  const leave = (cleared: boolean): void => {
    if (left) return;
    left = true;
    process.stderr.write(LEAVE_ALTERNATE_SCREEN);
    printSummary(title, PrivateSummary.close(), cleared);
  };
  // A SIGINT at any time until the screen is left, also at the prompt after the result, leaves the
  // private screen before the command ends.
  return Interruption.run(
    async () => {
      let cleared = false;
      try {
        const result = await body();
        if (result === CANCELLED) return CANCELLED;
        await flushed(process.stdout);
        process.stderr.write("\n");
        if ((await waitForEnter(CLEAR_PROMPT)) === CANCELLED) return CANCELLED;
        cleared = true;
        return result;
      } finally {
        PrivateSteps.close();
        PrivatePage.close();
        // A Windows console takes standard output asynchronously; the screen is left after it.
        await flushed(process.stdout);
        leave(cleared);
      }
    },
    () => leave(false),
  );
}
