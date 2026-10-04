// A command that asks for a secret or shows one runs on the terminal's alternate screen, as `less`
// shows a file and as `mhfe` shows a phrase (src/bin/mhfe/terminal.rs): nothing of it reaches the
// main screen or its scrollback, and after Enter the alternate screen is cleared and the terminal
// returns to where it was. On this private screen the secrets are shown as they are typed, so that
// the person can check them (input.ts, askSecret). A script or a pipe on standard input gets
// none of this, and output sent to a file or a pipe is written there as before.

import { waitForEnter } from "./terminal-choice.js";
import { terminalAvailable } from "./terminal-input.js";

/** Switches to the alternate screen, clears it and moves to its top left (xterm control
 * sequences, also understood by tmux and most terminals). */
const ENTER_ALTERNATE_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
/** Clears the alternate screen, then returns to the main screen with its earlier content. The
 * clear comes first, so that the words also vanish where there is no alternate screen. */
const LEAVE_ALTERNATE_SCREEN = "\x1b[2J\x1b[H\x1b[?1049l";

/** The exit code of a tool stopped by Ctrl+C: 128 plus SIGINT (2). */
export const CANCELLED_EXIT_CODE = 130;

/**
 * Whether a person at a terminal answers and reads: standard input and standard error are a
 * terminal. Standard output may go to a file; the questions and messages still use the screen.
 */
export function privateScreenAvailable(): boolean {
  return terminalAvailable();
}

/** Set while a command runs on the private screen. */
let active = false;

/** Whether the private screen is shown now, so that a secret typed there may be shown too. */
export function onPrivateScreen(): boolean {
  return active;
}

/**
 * Runs `body` on the alternate screen when privateScreenAvailable(), waits for Enter after it
 * succeeds and then leaves the screen. When `body` fails, the screen is left at once, so that the
 * error is shown on the main screen. Ctrl+C while `body` computes also leaves it first.
 */
export async function withPrivateScreen<T>(body: () => Promise<T>): Promise<T> {
  if (!privateScreenAvailable()) return body();
  // Written raw: NO_COLOR removes colours, not the screen switch.
  process.stderr.write(ENTER_ALTERNATE_SCREEN);
  active = true;
  const interrupted = (): void => {
    process.stderr.write(LEAVE_ALTERNATE_SCREEN);
    process.exit(CANCELLED_EXIT_CODE);
  };
  process.once("SIGINT", interrupted);
  try {
    const result = await body();
    await flushed(process.stdout);
    process.stderr.write("\n");
    await waitForEnter("Press Enter to clear this screen.");
    return result;
  } finally {
    active = false;
    process.off("SIGINT", interrupted);
    // A Windows console takes standard output asynchronously; the screen is left after it.
    await flushed(process.stdout);
    process.stderr.write(LEAVE_ALTERNATE_SCREEN);
  }
}

function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}
