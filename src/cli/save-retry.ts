// Saving a result that is on the screen already, such as Encode's record or PDF, the files and
// cards of shares, or a candidate list: every command saves through saveWithRetry. On the private
// screen a failure, a full disk or a folder taken meanwhile, keeps the result: one line says why,
// in plain words for the usual errors of a file system, and the person tries again, gives another
// name, which is checked first and warned of when a cloud service copies its folder, or skips that
// result and goes on with the others. Elsewhere the failure ends the command, as every failure
// there does.

import { askAfterFailure, askValueUntil, droppedPath } from "./ask.js";
import { cloudServiceOf } from "./cloud-folders.js";
import { discardRenamedOutput } from "./output-paths.js";
import { onPrivateScreen } from "./private-screen.js";
import { terminalMore, terminalNotice } from "./terminal.js";
import { InputCancelled } from "./terminal-input.js";

/** Plain words for the errors of a file system that a save may meet (errno names). */
const SAVE_FAILURES: Readonly<Record<string, string>> = {
  EEXIST: "a file or folder of that name appeared meanwhile",
  ENOSPC: "the disk is full",
  EDQUOT: "the disk quota is used up",
  EACCES: "there is no permission to write there",
  EPERM: "there is no permission to write there",
  EROFS: "the disk can only be read",
  ENOENT: "the folder is gone",
  ENOTDIR: "the folder is gone",
  EIO: "the disk reported an error",
};

/** A result to be saved, and how. */
export interface Saving {
  /** What it is, at the start of a sentence: "The record", "The PDF", "The card files". */
  readonly what: string;
  /** Whether it is saved as one file or as a new folder of files. */
  readonly kind: "file" | "folder";
  /** Where the options say it goes. */
  readonly path: string;
  /** Writes it at `path`, never over anything that exists there. */
  readonly write: (path: string) => Promise<void>;
  /** Refuses another name that cannot be used, saying why, before anything is written there. */
  readonly checkName: (path: string) => Promise<void>;
}

/** `text` with its first letter made small, unless it begins an abbreviation such as PDF. */
function lowerFirst(text: string): string {
  return /^[A-Z]{2}/u.test(text) ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** Why a save failed, in one line that names the file but nothing it holds. */
function saveFailure(what: string, path: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const reason =
    (code === undefined ? undefined : SAVE_FAILURES[code]) ??
    (error instanceof Error ? lowerFirst(error.message.replace(/\.$/u, "")) : String(error));
  return `${what} could not be saved as ${path}: ${reason}.`;
}

/**
 * Another name for a result that could not be saved, checked before it is used; undefined when
 * the person goes back with Escape. A name in a folder that a cloud service copies is warned of,
 * as the names given with the options are (command-line.ts).
 */
async function askOtherName(saving: Saving): Promise<string | undefined> {
  const path = await askValueUntil(
    `New name for ${lowerFirst(saving.what)}:`,
    async (answer) => {
      const typed = droppedPath(answer);
      await saving.checkName(typed);
      return typed;
    },
    { what: saving.kind === "file" ? "the name of a new file" : "the name of a new folder" },
  );
  const service = path === undefined ? undefined : cloudServiceOf(path);
  if (service !== undefined) {
    terminalNotice(`${service} keeps a copy of ${path}`, "warning");
    terminalMore("cloud-folders");
  }
  return path;
}

/**
 * Saves a result as described at the top. Resolves with the path it was saved at, or undefined
 * when the person skipped it. Escape at "What now?" skips; Escape at the new name brings the
 * choice back without saving.
 */
export async function saveWithRetry(saving: Saving): Promise<string | undefined> {
  let path = saving.path;
  for (let write = true; ;) {
    if (write)
      try {
        await saving.write(path);
        // A name chosen after a failure is not the numbered one that the options were given.
        if (path !== saving.path) discardRenamedOutput(saving.path);
        return path;
      } catch (error) {
        if (!onPrivateScreen() || error instanceof InputCancelled) throw error;
        terminalNotice(saveFailure(saving.what, path, error), "warning");
      }
    const next = await askAfterFailure(
      "What now?",
      [
        { label: "Try again", value: "again" },
        { label: `Another ${saving.kind} name`, value: "other" },
        { label: "Skip", note: "it is not saved", value: "skip" },
      ] as const,
      { escape: "skips it" },
    );
    if (next === "skip") {
      discardRenamedOutput(saving.path);
      terminalNotice(`${saving.what} was not saved.`, "warning");
      return undefined;
    }
    write = true;
    if (next === "other") {
      const other = await askOtherName(saving);
      if (other === undefined) write = false;
      else path = other;
    }
  }
}
