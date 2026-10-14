#!/usr/bin/env node
import { runCommandLine } from "./cli/command-line.js";
import { menuAvailable, runMenu } from "./cli/menu.js";
import { hardenProcess, relaunchProtected, underProtection } from "./cli/protection.js";
import { CANCELLED_EXIT_CODE } from "./cli/private-screen.js";
import { dumbTerminalReason, InputCancelledError, terminalTooDumb } from "./cli/terminal-input.js";
import { terminalFailure, terminalHint } from "./cli/terminal.js";
import { describeError } from "./core/refusal.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Every run is protected (protection.ts): a plain `node` start runs the program again so.
  if (!underProtection()) {
    process.exitCode = await relaunchProtected(argv);
    return;
  }
  await hardenProcess();
  // Started without arguments at a terminal, as by a double-click, MnemoCode shows its menu; a
  // script or a pipe gets the help, as before.
  if (argv.length === 0 && menuAvailable()) return runMenu();
  // A terminal that says TERM=dumb cannot draw the menu: the help comes, with the reason.
  if (argv.length === 0 && terminalTooDumb()) terminalHint(dumbTerminalReason("The menu"));
  return runCommandLine(argv);
}

void main().catch((error: unknown) => {
  if (error instanceof InputCancelledError) {
    terminalHint(error.message);
    process.exitCode = CANCELLED_EXIT_CODE;
    return;
  }
  terminalFailure(describeError(error));
  process.exitCode = 1;
});
