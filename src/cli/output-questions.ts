// The files and folders that the questions of a new backup name (encode-questions.ts): a new file
// or folder to write, checked at once where it can be written, and a file to read, each claimed
// for one task of an entry so that a second task cannot take its place.

import { constants as fileAccess, type Stats } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathsOverlap } from "./path-within.js";
import { droppedPath } from "./ask.js";
import { limitName } from "../core/byte-units.js";
import {
  isUnusableOutputPath,
  preflightFileDestination,
  preflightFolderDestination,
} from "./output-paths.js";
import { askLine } from "./terminal-choice.js";
import type { Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { errorCode } from "../core/refusal.js";

const ERRORS = new ErrorCatalog("cli.output-questions", {
  "another-file-task-name-folder-choose-another-one": () =>
    "Another file of this task has this name or this folder; choose another one.",
  "dash-path-refused": () => "- is no file name here; type the name of a file.",
  "blank-path-refused": () =>
    "That name is blank; type a name, or press Enter alone for the one shown.",
  "name-starts-would-read-as-option-type-before": () =>
    "A name that starts with - would be read as an option; type ./ before it.",
  "there-no-such-file-check-name-folder": () =>
    "There is no such file; check its name and its folder.",
  "file-cannot-be-looked-at": () =>
    "MnemoCode cannot look at that file; check that it may read the file and its folders.",
  "folder-type-name-file": () => "That is a folder; type the name of a file in it.",
  "no-ordinary-file-type-name-file": () => "That is no ordinary file; type the name of the file.",
  "mnemo-code-may-not-read-file": () => "MnemoCode may not read that file.",
  "file-larger-than-cannot-one": (value0: string) =>
    `That file is larger than ${value0}; it cannot be the one.`,
});

/**
 * A typed file or folder name as the file system knows it: without the quotes or backslashes that
 * a terminal adds to a dropped file, and with a leading ~ as the home folder (droppedPath). A name
 * that the command line would read as something else is refused: - stands for standard input or
 * output there, and a name that starts with - for an option, -h or --help even for the help. So is
 * a blank one, such as '' or " ", which is all that is left of a quoted name of spaces: the command
 * refuses it, and as a path it would be the current folder. Every such question has a fallback.
 */
function typedPath(answer: string): string {
  const path = droppedPath(answer);
  // The command's rule for a name that is no path (isUnusableOutputPath), in the menu's words.
  if (isUnusableOutputPath(path))
    throw ERRORS.create(path === "-" ? "dash-path-refused" : "blank-path-refused", []);
  if (path.startsWith("-")) throw ERRORS.create("name-starts-would-read-as-option-type-before", []);
  return path;
}

/**
 * The failures of a look at a path that say nothing is there: no such name (ENOENT), or a name
 * under a file (ENOTDIR). Any other failure, such as a folder that may not be searched (EACCES),
 * leaves it unknown whether the file is there (CORE-22).
 */
const NOTHING_THERE = new Set(["ENOENT", "ENOTDIR"]);

/**
 * A file to read, checked without reading it: it exists, is a file and may be read, and it is no
 * larger than the command reads (`limit`). What is in it only the command can tell, after it has
 * read the file. A path that cannot be looked at is refused as such, with the file system's error
 * as its cause, never as a file that is not there.
 */
export async function inputFile(answer: string, limit: number): Promise<string> {
  const path = typedPath(answer);
  let info: Stats;
  try {
    info = await stat(path);
  } catch (error) {
    const code = errorCode(error);
    if (code !== undefined && NOTHING_THERE.has(code))
      throw ERRORS.create("there-no-such-file-check-name-folder", [], { cause: error });
    throw ERRORS.create("file-cannot-be-looked-at", [], { cause: error });
  }
  if (info.isDirectory()) throw ERRORS.create("folder-type-name-file", []);
  if (!info.isFile()) throw ERRORS.create("no-ordinary-file-type-name-file", []);
  try {
    await access(path, fileAccess.R_OK);
  } catch {
    throw ERRORS.create("mnemo-code-may-not-read-file", []);
  }
  if (info.size > limit)
    throw ERRORS.create("file-larger-than-cannot-one", [`${limitName(limit)}`]);
  return path;
}

/** The question for the name of each kind of file that a person names, to save or to read. */
export const FILE_NAME_QUESTIONS = Object.freeze({
  pdf: "PDF file name",
  text: "Text file name",
  record: "Record file name",
  qr: "QR code file name",
} as const);

/**
 * The files and folders that the answers of the entry being asked name for saving, as absolute
 * paths, so that a second output of the same entry cannot take the place of a first: each answer
 * to a question for a file or a folder to save is checked against them, then claimed. Every entry
 * of the menu, and every new backup that re-encode asks, starts with none (forget). One record for
 * the process, as RenamedOutputs is.
 */
export class ClaimedOutputs {
  static readonly #paths: string[] = [];

  /** Forgets the files and folders that an earlier entry, or an earlier backup, claimed. */
  static forget(): void {
    ClaimedOutputs.#paths.length = 0;
  }

  /**
   * Asks for the name of a file to save, `fallback` by default, until it can be used (outputFile);
   * undefined when the person goes back with Escape, CANCELLED at Ctrl+C.
   */
  static askOutputFile(
    question: string,
    fallback: string,
  ): Promise<string | undefined | Cancelled> {
    return askLine(question, "File", { fallback, check: ClaimedOutputs.#outputFile });
  }

  /**
   * Asks for the name of a new folder to save into, `fallback` by default, until it can be used
   * (newFolder); undefined when the person goes back with Escape, CANCELLED at Ctrl+C.
   */
  static askNewFolder(fallback: string): Promise<string | undefined | Cancelled> {
    return askLine("Name of the new folder", "Folder", {
      fallback,
      check: ClaimedOutputs.#newFolder,
    });
  }

  /**
   * A file to save, checked as the command checks it before it asks anything
   * (preflightFileDestination, which only looks): its folder exists and may be written, and the
   * name is no folder. A file of that name may exist: the command saves under the next numbered
   * name.
   */
  static async #outputFile(answer: string): Promise<string> {
    const path = typedPath(answer);
    ClaimedOutputs.#assertFree(path);
    await preflightFileDestination(path, true);
    ClaimedOutputs.#claim(path);
    return path;
  }

  /**
   * A new folder to save into, such as one for the cards, checked as the command checks it
   * (preflightFolderDestination): the command makes the folders of its path that do not exist yet
   * and numbers a name that is taken.
   */
  static async #newFolder(answer: string): Promise<string> {
    const path = typedPath(answer);
    ClaimedOutputs.#assertFree(path);
    await preflightFolderDestination(path);
    ClaimedOutputs.#claim(path);
    return path;
  }

  /**
   * Refuses `path` when it is the place of an earlier output, lies in it or holds it: the command
   * would refuse the pair (validateOutputPaths), and a name taken by both would be numbered to the
   * same free name. Checked first, as it says the most; an answer that passes every check is then
   * claimed.
   */
  static #assertFree(path: string): void {
    const absolute = resolve(path);
    if (ClaimedOutputs.#paths.some((earlier) => pathsOverlap(earlier, absolute)))
      throw ERRORS.create("another-file-task-name-folder-choose-another-one", []);
  }

  static #claim(path: string): void {
    ClaimedOutputs.#paths.push(resolve(path));
  }
}
