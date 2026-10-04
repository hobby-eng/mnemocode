#!/usr/bin/env node
import { runCommandLine } from "./cli/command-line.js";
import { menuAvailable, runMenu } from "./cli/menu.js";
import { hardenProcess, relaunchProtected, underProtection } from "./cli/protection.js";
import { CANCELLED_EXIT_CODE } from "./cli/private-screen.js";
import { InputCancelled } from "./cli/terminal-input.js";
import { terminalFailure, terminalHint } from "./cli/terminal.js";

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
  return runCommandLine(argv);
}

void main().catch((error: unknown) => {
  if (error instanceof InputCancelled) {
    terminalHint("Cancelled.");
    process.exitCode = CANCELLED_EXIT_CODE;
    return;
  }
  terminalFailure(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
