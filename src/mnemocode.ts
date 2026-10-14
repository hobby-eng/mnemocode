#!/usr/bin/env node
import { runCommandLine } from "./cli/command-line.js";
import { menuAvailable, runMenu } from "./cli/menu.js";
import { hardenProcess, relaunchProtected, underProtection } from "./cli/protection.js";
import { CANCELLED_EXIT_CODE, CANCELLED_MESSAGE } from "./cli/exit-codes.js";
import { dumbTerminalReason, terminalTooDumb } from "./cli/terminal-input.js";
import { CANCELLED, type Cancelled } from "./cli/terminal-keys.js";
import { terminalFailure, terminalHint } from "./cli/terminal.js";
import { describeError } from "./core/refusal.js";

/** Runs the menu or one command line; CANCELLED when the person cancelled it with Ctrl+C. */
async function main(): Promise<Cancelled | undefined> {
  const argv = process.argv.slice(2);
  // Every run is protected (protection.ts): a plain `node` start runs the program again so.
  if (!underProtection()) {
    process.exitCode = await relaunchProtected(argv);
    return undefined;
  }
  await hardenProcess();
  // Started without arguments at a terminal, as by a double-click, MnemoCode shows its menu; a
  // script or a pipe gets the help, as before.
  if (argv.length === 0 && menuAvailable()) return runMenu();
  // A terminal that says TERM=dumb cannot draw the menu: the help comes, with the reason.
  if (argv.length === 0 && terminalTooDumb()) terminalHint(dumbTerminalReason("The menu"));
  return runCommandLine(argv);
}

// A cancelled run says so in one line and ends as a process that Ctrl+C stopped (exit-codes.ts).
void main().then(
  (end) => {
    if (end !== CANCELLED) return;
    terminalHint(CANCELLED_MESSAGE);
    process.exitCode = CANCELLED_EXIT_CODE;
  },
  (error: unknown) => {
    terminalFailure(describeError(error));
    process.exitCode = 1;
  },
);
