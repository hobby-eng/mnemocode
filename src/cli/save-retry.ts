// Saving a result that is on the screen already, such as Encode's record or PDF, the files and
// cards of shares, or a candidate list: every command saves through saveWithRetry. On the private
// screen a failure, a full disk or a folder taken meanwhile, keeps the result: one line says why,
// in plain words for the usual errors of a file system, and the person tries again, gives another
// name, which is checked first and, once the result is saved there, warned of when a cloud service
// copies its folder, or skips that result and goes on with the others. Elsewhere the failure ends
// the command, as every failure there does.

import { askAfterFailure, askValueUntil, droppedPath, WHAT_NOW } from "./ask.js";
import { warnOfCloudCopy } from "./cloud-folders.js";
import { discardRenamedOutput } from "./output-paths.js";
import { onPrivateScreen } from "./private-screen.js";
import { printableText, terminalNotice } from "./terminal.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { lowerFirst } from "../core/prose.js";
import { describeError, errorCode } from "../core/refusal.js";
import { LeftStagingCopyError } from "../export/private-file.js";

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

/** Why a save failed, in one line that names the file but nothing it holds. */
function saveFailure(what: string, path: string, error: unknown): string {
  const code = errorCode(error);
  const known =
    code !== undefined && Object.hasOwn(SAVE_FAILURES, code) ? SAVE_FAILURES[code] : undefined;
  return `${what} could not be saved as ${printableText(path)}: ${known ?? otherFailure(error)}.`;
}

/**
 * Any other failure in the words of describeError: an Error's message is a sentence of its own,
 * which inside this one starts in lower case and loses its full stop.
 */
function otherFailure(error: unknown): string {
  const described = printableText(describeError(error));
  return error instanceof Error ? lowerFirst(described.replace(/\.$/u, "")) : described;
}

/**
 * Another name for a result that could not be saved, checked before it is used; undefined when
 * the person goes back with Escape, CANCELLED at Ctrl+C.
 */
async function askOtherName(saving: Saving): Promise<string | undefined | Cancelled> {
  const path = await askValueUntil(
    `New name for ${lowerFirst(saving.what)}:`,
    async (answer) => {
      const typed = droppedPath(answer);
      await saving.checkName(typed);
      return typed;
    },
    { what: saving.kind === "file" ? "the name of a new file" : "the name of a new folder" },
  );
  return path;
}

/**
 * Runs `write`, the save of one result. A file saved in full whose private staging copy could not
 * be removed (LeftStagingCopyError) is saved: the person is told so and to delete the copy, and the
 * save is not tried again. Every save of the command line goes through it.
 */
export async function writeSaved(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (!(error instanceof LeftStagingCopyError)) throw error;
    terminalNotice(printableText(error.message), "warning");
  }
}

/**
 * Saves a result as described at the top. Resolves with the path it was saved at, undefined when
 * the person skipped it, or CANCELLED at Ctrl+C. Escape at "What now?" skips; Escape at the new
 * name brings the choice back without saving.
 */
export async function saveWithRetry(saving: Saving): Promise<string | undefined | Cancelled> {
  let path = saving.path;
  for (let write = true; ;) {
    if (write)
      try {
        await writeSaved(() => saving.write(path));
        // A name chosen after a failure is not the numbered one that the options were given. Once
        // saved there, it is warned of when a cloud service copies its folder, as the names given
        // with the options are (command-line.ts).
        if (path !== saving.path) {
          discardRenamedOutput(saving.path);
          warnOfCloudCopy(path);
        }
        return path;
      } catch (error) {
        if (!onPrivateScreen()) throw error;
        terminalNotice(saveFailure(saving.what, path, error), "warning");
      }
    const next = await askAfterFailure(
      WHAT_NOW,
      [
        { label: "Try again", value: "again" },
        { label: `Another ${saving.kind} name`, value: "other" },
        { label: "Skip", note: "it is not saved", value: "skip" },
      ] as const,
      { escape: "skips it" },
    );
    if (next === CANCELLED) return CANCELLED;
    if (next === "skip") {
      discardRenamedOutput(saving.path);
      terminalNotice(`${saving.what} was not saved.`, "warning");
      return undefined;
    }
    write = true;
    if (next === "other") {
      const other = await askOtherName(saving);
      if (other === CANCELLED) return CANCELLED;
      if (other === undefined) write = false;
      else path = other;
    }
  }
}
