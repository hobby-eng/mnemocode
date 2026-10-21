// Ctrl+C while a command works and no question reads keys arrives as SIGINT, which ends the
// command at once: what it must undo on the terminal is undone first, such as leaving the private
// screen, the temporary folders of an export that it was making are removed
// (temporary-folders.ts) and any that cannot be is named, and the command ends as every cancelled
// one does, with one "Cancelled." line and exit code 130. A question reads Ctrl+C as a key instead,
// and its command ends through CANCELLED (mnemocode.ts), which says the same.

import { CANCELLED_EXIT_CODE, CANCELLED_MESSAGE } from "./exit-codes.js";
import { printableText, terminalHint, terminalNotice } from "./terminal.js";
import { TemporaryFolders } from "../export/temporary-folders.js";

/** Says that the command was cancelled and sets the exit code of a cancelled command. */
export function endCancelled(): void {
  terminalHint(CANCELLED_MESSAGE);
  process.exitCode = CANCELLED_EXIT_CODE;
}

/**
 * The record of what the process must undo on the terminal when Ctrl+C ends it while a command
 * works, with the one listener for SIGINT, which is on exactly while the record holds a step. One
 * record for the process: the command and its private screen, which nest their steps, share it. A
 * class, so that a step stays known from the moment its body starts until the body ends.
 */
export class Interruption {
  /** What must be undone on the terminal before the process ends, the innermost last. */
  static readonly #undoing: (() => void)[] = [];

  /**
   * Runs `body` with Ctrl+C handled as described at the top; `undo`, if given, is what it changed on
   * the terminal and must undo before the process ends. Calls nest: each adds what it must undo.
   * What `body` rejects with passes on.
   */
  static async run<T>(body: () => Promise<T>, undo?: () => void): Promise<T> {
    const undoing = Interruption.#undoing;
    const step = undo ?? (() => undefined);
    undoing.push(step);
    // One listener for every call; on, not once, so that a second Ctrl+C during the cleanup does
    // not end the process before it says what it could not remove.
    if (undoing.length === 1) process.on("SIGINT", Interruption.#interrupted);
    try {
      return await body();
    } finally {
      undoing.splice(undoing.lastIndexOf(step), 1);
      if (undoing.length === 0) process.off("SIGINT", Interruption.#interrupted);
    }
  }

  /** Undoes every step, innermost first, removes the temporary folders left and ends the process. */
  static #interrupted(this: void): void {
    for (const step of [...Interruption.#undoing].reverse()) step();
    const left = TemporaryFolders.removeLeft();
    endCancelled();
    for (const folder of left)
      terminalNotice(
        `A private temporary folder, which may hold a copy of the export, could not be removed: ${printableText(folder)}. Delete it.`,
        "warning",
      );
    process.exit();
  }
}
