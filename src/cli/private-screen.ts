// A command that asks for a secret or shows one runs on the terminal's alternate screen, as `less`
// shows a file and as `mhfe` shows a phrase (src/bin/mhfe/terminal.rs): nothing of it reaches the
// main screen or its scrollback, and after Enter the alternate screen is cleared and the terminal
// returns to where it was. On this private screen the secrets are shown as they are typed, so that
// the person can check them (input.ts, askSecretUntil). A script or a pipe on standard input gets
// none of this, and output sent to a file or a pipe is written there as before.

import { ANSWER_LABEL_WIDTH, rowsOf, waitForEnter } from "./terminal-choice.js";
import { terminalAvailable } from "./terminal-input.js";
import {
  CLEAR_SCREEN,
  ENTER_ALTERNATE_SCREEN,
  LEAVE_ALTERNATE_SCREEN,
  noticeLines,
} from "./terminal.js";
import { PrivatePage } from "./private-page.js";
import { PrivateSteps } from "./private-steps.js";
import { factLine, headingLine } from "./terminal-style.js";
import { protectionSummary } from "./protection.js";
import { CANCELLED_EXIT_CODE } from "./exit-codes.js";
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
 * Shows on the private screen what protects this process now (protectionSummary): first when the
 * screen opens, and again once a command has given up rights after its questions.
 */
export function showProtection(): void {
  if (!PrivateSteps.active) return;
  // Kept on the screen of the first question that follows, which would otherwise clear it.
  PrivateSteps.keep(() =>
    console.error(
      `${factLine(process.stderr, "Protection", protectionSummary(), ANSWER_LABEL_WIDTH)}\n`,
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

/**
 * Runs `body` on the alternate screen when privateScreenAvailable(), waits for Enter after it
 * succeeds and then leaves the screen. When `body` fails, the screen is left at once, so that the
 * error is shown on the main screen. Ctrl+C also leaves it first: at a question and during a long
 * search it is read as a key (watchForCtrlC), and `body` gives CANCELLED, as the question after
 * the result does at Ctrl+C; SIGINT, from Ctrl+C while `body` computes something else or sent by
 * other means, is handled here.
 */
export async function withPrivateScreen<T>(
  body: () => Promise<T | Cancelled>,
  title = "Private operation",
): Promise<T | Cancelled> {
  if (!privateScreenAvailable()) return body();
  // Written raw: NO_COLOR removes colours, not the screen switch.
  process.stderr.write(ENTER_ALTERNATE_SCREEN);
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
  const interrupted = (): void => {
    process.stderr.write(LEAVE_ALTERNATE_SCREEN);
    process.exit(CANCELLED_EXIT_CODE);
  };
  process.once("SIGINT", interrupted);
  try {
    const result = await body();
    if (result === CANCELLED) return CANCELLED;
    await flushed(process.stdout);
    process.stderr.write("\n");
    return (await waitForEnter(CLEAR_PROMPT)) === CANCELLED ? CANCELLED : result;
  } finally {
    PrivateSteps.close();
    PrivatePage.close();
    process.off("SIGINT", interrupted);
    // A Windows console takes standard output asynchronously; the screen is left after it.
    await flushed(process.stdout);
    process.stderr.write(LEAVE_ALTERNATE_SCREEN);
  }
}

function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}
