// How the menu runs a command it built: in a process of its own, with the terminal's echo off until
// the command takes the terminal, and a command that failed to start or was stopped offered again.

import { spawnSync } from "node:child_process";
import { PRIVATE_SCREEN_COMMANDS } from "./command-line.js";
import { privateScreenAvailable } from "./private-screen.js";
import { CANCELLED_EXIT_CODE, signalNameOf, stoppedBySignal } from "./exit-codes.js";
import { runInOwnProcess } from "./protection.js";
import { choose } from "./terminal-choice.js";
import { dropTypedAhead, terminalAvailable } from "./terminal-input.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { LEAVE_ALTERNATE_SCREEN } from "./terminal.js";
import { WHAT_NOW } from "./ask.js";
import { defined } from "../core/defined.js";
import { describeError, errorCode } from "../core/refusal.js";

/** stty, run by its own path, as Linux and macOS have it, rather than looked up. */
const STTY = "/bin/stty";

/** Runs stty for the terminal on standard input; what it printed, or undefined when it failed. */
function stty(args: readonly string[]): string | undefined {
  const result = spawnSync(STTY, args, { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * Runs `body`, a command and what the menu reads right after it, with the terminal's echo off, and
 * gives the terminal back exactly as it was (stty -g), also after a command that a signal stopped
 * while it read keys in raw mode. A command takes the terminal at its first question, after its
 * self-test; until then the terminal would show the keys typed for it, the start of a secret too,
 * on the main screen, whose scrollback keeps them. Raw mode would hide them as well, but a command
 * started in it takes it as its normal mode, since Node.js gives back the mode that it found, and
 * Ctrl+C would then not stop the command between its questions. A Windows console shows no key
 * before a program reads it; there, and without stty, nothing is changed.
 */
async function withEchoOff<T>(body: () => Promise<T>): Promise<T> {
  const saved = process.platform === "win32" || !terminalAvailable() ? undefined : stty(["-g"]);
  if (saved === undefined || stty(["-echo"]) === undefined) return body();
  try {
    return await body();
  } finally {
    stty([saved]);
  }
}

/**
 * Runs `run` in a process of its own and returns its exit code, or undefined when the person went
 * back to the menu instead. A command that could not be started, or that a signal stopped, such as
 * the out-of-memory killer, is said so in one line and offered again with the same answers.
 * CANCELLED when Ctrl+C typed with the last answer, before the command started, cancels it, or
 * when the person cancels the question after a failure.
 */
export async function runCommand(run: readonly string[]): Promise<number | undefined | Cancelled> {
  for (;;) {
    let failure: string;
    try {
      const code = await withEchoOff(async () => {
        // What was typed or pasted with the last answer goes to no process: a command reads only
        // the keys pressed for its own questions.
        if ((await dropTypedAhead()) === CANCELLED) return CANCELLED;
        const exit = await runInOwnProcess(run);
        // What was typed while the command ran but not read by it, such as the rest of a paste
        // after it had failed, answers no question of the menu. A Ctrl+C among it was meant for
        // the command, which has ended: it cancels nothing here.
        await dropTypedAhead();
        return exit;
      });
      if (code === CANCELLED) return CANCELLED;
      if (!stoppedBySignal(code) || code === CANCELLED_EXIT_CODE) return code;
      if (PRIVATE_SCREEN_COMMANDS.has(defined(run[0])) && privateScreenAvailable())
        process.stderr.write(LEAVE_ALTERNATE_SCREEN);
      failure = `The command stopped unexpectedly (${signalNameOf(code)}).`;
    } catch (error) {
      const code = errorCode(error);
      // Native system failures such as EAGAIN keep their familiar code. A library refusal has
      // its own qualified code for hosts, but the person reads its existing default message.
      const reason =
        code !== undefined && /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : describeError(error);
      failure = `The command could not be started (${reason}).`;
    }
    const again = await choose(
      WHAT_NOW,
      [
        { label: "Start it again", note: "with the same answers", value: "again" },
        { label: "Back to the menu", value: "back" },
      ] as const,
      { label: "Next", warning: failure },
    );
    if (again === CANCELLED) return CANCELLED;
    if (again !== "again") return undefined;
  }
}
