import { constants, type Stats } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { entryAt } from "../export/private-file.js";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { pathsOverlap } from "./path-within.js";
import { value, values, type ParsedArguments } from "./arguments.js";
import { optionLabel } from "./option-copy.js";
import { printableText, terminalNotice } from "./terminal.js";
import { FILE_INPUTS, FILE_OUTPUTS, FOLDER_OUTPUTS, SAVED_OPTIONS } from "./output-options.js";
import { DOCUMENT_EXTENSIONS } from "../export/document-formats.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.output-paths", {
  "path-empty-paths-not-accepted-results-always-appear": (value0: string) =>
    `The ${value0} needs a path; - and empty paths are not accepted. Results always appear in the terminal.`,
  "too-many-numbered-copies-already-choose-another-name": (value0: string) =>
    `${value0} has too many numbered copies already. Choose another name.`,
  "output-path-could-not-resolved-safely": () => "The output path could not be resolved safely.",
  "new-folder-name-without-which-ending-file-choose": (value0: string) =>
    `A new folder needs a name without .${value0}, which is the ending of a file; choose another name.`,
  "folder-unwritable": () => FOLDER_UNWRITABLE,
  "file-stands-where-folder-name-should-choose-another": () =>
    "A file stands where a folder of this name should be; choose another name.",
  "could-not-read-check-file-exists-readable": (value0: string) =>
    `The ${value0} could not be read. Check that the file exists and is readable.`,
  "use-separate-non-overlapping-paths": (value0: string, value1: string) =>
    `The ${value0} and ${value1} must use separate, non-overlapping paths.`,
  "not-overlap": (value0: string, value1: string) =>
    `The ${value0} must not overlap the ${value1}.`,
  "file-export-requires-file-path-empty-paths-not": () =>
    "File export requires a file path; - and empty paths are not accepted. Results always appear in the terminal.",
  "folder-file": () => FOLDER_IS_A_FILE,
  "folder-unwritable-file": () => FOLDER_UNWRITABLE_FOR_FILE,
  "output-file-already-exists-choose-new-path": () =>
    "The output file already exists. Choose a new path.",
  "folder-name-give-file-another-name-name-inside": () =>
    "A folder has this name; give the file another name, or a name inside that folder.",
});

/** More numbered copies of one name than this are surely a mistake. */
const MAX_COPY_NUMBER = 999;

/** Results saved under another name: the name used, and the name given. */
const renamedOutputs = new Map<string, string>();

/**
 * Whether `path`, given for an output, names none: a blank one, which as a path would be the
 * current folder, or "-", which the command line reads as standard input or output.
 */
export function isUnusableOutputPath(path: string): boolean {
  return path.trim() === "" || path === "-";
}

/** Refuses the output `key` given as no path (isUnusableOutputPath). */
export function assertUsableOutputPath(key: string, path: string): void {
  if (isUnusableOutputPath(path))
    throw ERRORS.create("path-empty-paths-not-accepted-results-always-appear", [
      `${optionLabel(key)}`,
    ]);
}

/**
 * The separators at the end of a path, as a folder may be given: on Windows a backslash and "/",
 * elsewhere "/" alone, since a backslash is a character of a name there (path-within.ts), and a
 * name that ends with one keeps it in its numbered copy (AUD-014-API011).
 */
const TRAILING_SEPARATORS = sep === "\\" ? /[\\/]+$/u : /\/+$/u;

/**
 * "name-1.pdf", or "name-1" for a folder: without the space and the brackets of a file manager's
 * "name (1).pdf", which a shell reads as two words and a syntax error, so that a numbered name, and
 * the QR code images named after it, can be typed in a command without quotes.
 */
function numberedName(path: string, number: number, folder: boolean): string {
  const trimmed = path.replace(TRAILING_SEPARATORS, "");
  const extension = folder ? "" : extname(trimmed);
  return `${trimmed.slice(0, trimmed.length - extension.length)}-${number}${extension}`;
}

/**
 * `path` when nothing is there, or its first free numbered name, "name-1.png": for a file that
 * the command names itself, such as the QR code image beside a PDF, which is never saved over
 * another.
 */
export async function firstFreeName(path: string): Promise<string> {
  if ((await entryAt(path)) === "none") return path;
  return firstFreeNumberedName(path, false);
}

/**
 * The first numbered name of `path`, a file's or a `folder`'s, at which nothing is: "name-1.pdf",
 * then "name-2.pdf", up to MAX_COPY_NUMBER, past which the person chooses another name.
 */
async function firstFreeNumberedName(path: string, folder: boolean): Promise<string> {
  for (let number = 1; number <= MAX_COPY_NUMBER; number += 1) {
    const free = numberedName(path, number, folder);
    if ((await entryAt(free)) === "none") return free;
  }
  throw ERRORS.create("too-many-numbered-copies-already-choose-another-name", [
    printableText(path),
  ]);
}

/**
 * Nothing is ever saved over a file or a folder: when the name given for a result is taken, the
 * result gets the first free numbered name, and reportRenamedOutputs says so after saving. This
 * runs before any secret is asked, so that a taken name never stops a command halfway. A folder
 * given for a file, and an input of the command itself, are left alone for the checks that refuse
 * them (preflightFileDestination, validateOutputPaths): a result named like its own input is a
 * mistake, not a copy.
 */
export async function settleOutputPaths(args: ParsedArguments): Promise<void> {
  const inputs = new Set<string>();
  for (const key of FILE_INPUTS)
    for (const source of values(args, key))
      if (source !== "-") inputs.add(await realpath(resolve(source)).catch(() => resolve(source)));
  for (const [keys, folder] of [
    [FILE_OUTPUTS, false],
    [FOLDER_OUTPUTS, true],
  ] as const) {
    for (const key of keys) {
      const path = value(args, key);
      if (path === undefined || isUnusableOutputPath(path)) continue;
      const taken = await entryAt(path);
      if (taken === "none" || (taken === "folder" && !folder)) continue;
      // A dangling or looping link is a taken name like any other.
      if (inputs.has(await realpath(resolve(path)).catch(() => resolve(path)))) continue;
      const free = await firstFreeNumberedName(path, folder);
      renamedOutputs.set(free, path);
      args[key] = free;
    }
  }
}

/** For a result that was not saved after all: its numbered name is not reported. */
export function discardRenamedOutput(path: string): void {
  renamedOutputs.delete(path);
}

/** After saving: one warning for each result saved under a numbered name. */
export function reportRenamedOutputs(): void {
  for (const [used, given] of renamedOutputs)
    terminalNotice(
      `${printableText(given)} already exists: saved as ${printableText(used)} instead.`,
      "warning",
    );
  renamedOutputs.clear();
}

async function effectiveOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const found = await nearestExisting(dirname(absolute));
  if (found === undefined) throw ERRORS.create("output-path-could-not-resolved-safely", []);
  return resolve(found.real, ...found.missing, basename(absolute));
}

/**
 * The nearest of `folder` and the folders above it that exists, its links resolved, and the names
 * below it that do not exist yet, from the top; undefined when one cannot be looked at. The path
 * of an output is resolved so, and a new folder checked where it would be made.
 */
async function nearestExisting(
  folder: string,
): Promise<{ readonly real: string; readonly missing: readonly string[] } | undefined> {
  const missing: string[] = [];
  for (let ancestor = folder; ;) {
    try {
      return { real: await realpath(ancestor), missing: [...missing].reverse() };
    } catch (error) {
      const parent = dirname(ancestor);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === ancestor)
        return undefined;
      missing.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Why a new folder cannot be made where it is to go. */
const FOLDER_UNWRITABLE =
  "MnemoCode may not make a folder there; choose a folder you can write to.";

/**
 * Refuses a name for a new folder that ends like a file an export writes, such as cards.pdf: the
 * folder would later be taken for that file, and a PDF of that name refused because a folder has
 * it, as a folder of images named so once did (2026-10-13).
 */
function assertFolderName(path: string): void {
  const ending = extname(path.replace(TRAILING_SEPARATORS, "")).slice(1).toLowerCase();
  if (DOCUMENT_EXTENSIONS.includes(ending))
    throw ERRORS.create("new-folder-name-without-which-ending-file-choose", [`${ending}`]);
}

/**
 * Refuses a new folder that could not be made: where a file stands on its way, or under a folder
 * that may not be written. The folders of its path that do not exist yet are made with it, so the
 * nearest that exists is checked. A preflight, as for a file: the export checks again that nothing
 * is there when it publishes the folder (absentPath).
 */
export async function preflightFolderDestination(path: string): Promise<void> {
  assertFolderName(path);
  const found = await nearestExisting(dirname(resolve(path)));
  if (found === undefined) throw ERRORS.create("folder-unwritable", []);
  if (!(await stat(found.real)).isDirectory())
    throw ERRORS.create("file-stands-where-folder-name-should-choose-another", []);
  try {
    await access(found.real, constants.W_OK);
  } catch (error) {
    throw ERRORS.create("folder-unwritable", [], { cause: error });
  }
}

async function effectiveSourcePath(path: string, key: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch {
    throw ERRORS.create("could-not-read-check-file-exists-readable", [`${optionLabel(key)}`]);
  }
}

/** Files and folders must not shadow one another or overwrite an input. */
export async function validateOutputPaths(args: ParsedArguments): Promise<void> {
  const outputs = SAVED_OPTIONS.flatMap((key) => {
    const path = value(args, key);
    return path === undefined ? [] : [{ key, path }];
  });
  for (const { key, path } of outputs) assertUsableOutputPath(key, path);
  const effectiveOutputs = await Promise.all(
    outputs.map(async (output) => ({ ...output, path: await effectiveOutputPath(output.path) })),
  );
  for (const [index, left] of effectiveOutputs.entries()) {
    for (const right of effectiveOutputs.slice(index + 1)) {
      if (pathsOverlap(left.path, right.path))
        throw ERRORS.create("use-separate-non-overlapping-paths", [
          `${optionLabel(left.key)}`,
          `${optionLabel(right.key)}`,
        ]);
    }
    for (const key of FILE_INPUTS) {
      for (const source of values(args, key)) {
        if (source === "-") continue;
        const effectiveSource = await effectiveSourcePath(source, key);
        if (pathsOverlap(left.path, effectiveSource))
          throw ERRORS.create("not-overlap", [`${optionLabel(left.key)}`, `${optionLabel(key)}`]);
      }
    }
  }
}

/** Why a file cannot be saved where it is to go: its folder is a file. */
const FOLDER_IS_A_FILE = "The folder containing the output file is not a directory.";
/** Why a file cannot be saved where it is to go: its folder is missing or may not be written. */
const FOLDER_UNWRITABLE_FOR_FILE =
  "The folder containing the output file must already exist and be writable.";

/**
 * This is a preflight; the writer still enforces exclusive or atomic publication. Every refusal is
 * in words: an error of the file system would name the path and the system call instead.
 */
export async function preflightFileDestination(
  path: string,
  allowOverwrite: boolean,
): Promise<void> {
  if (isUnusableOutputPath(path))
    throw ERRORS.create("file-export-requires-file-path-empty-paths-not", []);
  let existing: Stats | undefined;
  try {
    existing = await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A name under a file, or a folder that cannot be looked into.
    if (code === "ENOTDIR") throw ERRORS.create("folder-file", [], { cause: error });
    if (code !== "ENOENT") throw ERRORS.create("folder-unwritable-file", [], { cause: error });
  }
  if (existing !== undefined) {
    if (!allowOverwrite) throw ERRORS.create("output-file-already-exists-choose-new-path", []);
    if (existing.isDirectory())
      throw ERRORS.create("folder-name-give-file-another-name-name-inside", []);
  }
  const parent = dirname(resolve(path));
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(parent)).isDirectory();
    if (isDirectory) await access(parent, constants.W_OK);
  } catch (error) {
    throw ERRORS.create("folder-unwritable-file", [], { cause: error });
  }
  if (!isDirectory) throw ERRORS.create("folder-file", []);
}
