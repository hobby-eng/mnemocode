// Ctrl+C while a command works and no question reads keys arrives as SIGINT, which ends the
// command at once: what it must undo on the terminal is undone first, such as leaving the private
// screen, the temporary folders of an export that it was making are removed
// (temporary-folders.ts) and any that cannot be is named, and the command ends as every cancelled
// one does, with one "Cancelled." line and exit code 130. A question reads Ctrl+C as a key instead,
// and its command ends through CANCELLED (mnemocode.ts), which says the same.

import { CANCELLED_EXIT_CODE, CANCELLED_MESSAGE } from "./exit-codes.js";
import { printableText, terminalHint, terminalNotice } from "./terminal.js";
import { TemporaryFolders } from "../export/temporary-folders.js";

/** What must be undone on the terminal before the process ends, the innermost last. */
const undoing: (() => void)[] = [];

/** Says that the command was cancelled and sets the exit code of a cancelled command. */
export function endCancelled(): void {
  terminalHint(CANCELLED_MESSAGE);
  process.exitCode = CANCELLED_EXIT_CODE;
}

/**
 * Runs `body` with Ctrl+C handled as described at the top; `undo`, if given, is what it changed on
 * the terminal and must undo before the process ends. Calls nest: each adds what it must undo.
 */
export async function interruptible<T>(body: () => Promise<T>, undo?: () => void): Promise<T> {
  const step = undo ?? (() => undefined);
  undoing.push(step);
  // One listener for every call; on, not once, so that a second Ctrl+C during the cleanup does not
  // end the process before it says what it could not remove.
  if (undoing.length === 1) process.on("SIGINT", interrupted);
  try {
    return await body();
  } finally {
    undoing.splice(undoing.lastIndexOf(step), 1);
    if (undoing.length === 0) process.off("SIGINT", interrupted);
  }
}

function interrupted(): void {
  for (const step of [...undoing].reverse()) step();
  const left = TemporaryFolders.removeLeft();
  endCancelled();
  for (const folder of left)
    terminalNotice(
      `A private temporary folder, which may hold a copy of the export, could not be removed: ${printableText(folder)}. Delete it.`,
      "warning",
    );
  process.exit();
}
