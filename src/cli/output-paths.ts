import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { value, values, type ParsedArguments } from "./arguments.js";
import { optionLabel } from "./option-copy.js";
import { terminalNotice } from "./terminal.js";
import { FILE_OUTPUTS, FOLDER_OUTPUTS, SAVED_OPTIONS } from "./output-options.js";

/** Options that name a file the command reads. */
const INPUT_OPTIONS = [
  "mnemonic-file",
  "input-file",
  "share-file",
  "share-qr",
  "candidates-key-file",
  "candidates-passphrase-file",
  "bip39-passphrase-file",
  "wif-file",
  "qr-file",
] as const;
/** More numbered copies of one name than this are surely a mistake. */
const MAX_COPY_NUMBER = 999;

/** Results saved under another name: the name used, and the name given. */
const renamedOutputs = new Map<string, string>();

/** What is at `path`: nothing, a folder, or something else. */
async function entryAt(path: string): Promise<"none" | "folder" | "other"> {
  try {
    return (await lstat(path)).isDirectory() ? "folder" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "none";
    throw error;
  }
}

/**
 * "name-1.pdf", or "name-1" for a folder: without the space and the brackets of a file manager's
 * "name (1).pdf", which a shell reads as two words and a syntax error, so that a numbered name, and
 * the QR code images named after it, can be typed in a command without quotes.
 */
function numberedName(path: string, number: number, folder: boolean): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
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
  for (let number = 1; number <= MAX_COPY_NUMBER; number += 1) {
    const free = numberedName(path, number, false);
    if ((await entryAt(free)) === "none") return free;
  }
  throw new Error(`${path} has too many numbered copies already. Choose another name.`);
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
  for (const key of INPUT_OPTIONS)
    for (const source of values(args, key))
      if (source !== "-") inputs.add(await realpath(resolve(source)).catch(() => resolve(source)));
  for (const [keys, folder] of [
    [FILE_OUTPUTS, false],
    [FOLDER_OUTPUTS, true],
  ] as const) {
    for (const key of keys) {
      const path = value(args, key);
      if (path === undefined || !path.trim() || path === "-") continue;
      const taken = await entryAt(path);
      if (taken === "none" || (taken === "folder" && !folder)) continue;
      // A dangling or looping link is a taken name like any other.
      if (inputs.has(await realpath(resolve(path)).catch(() => resolve(path)))) continue;
      let number = 1;
      while ((await entryAt(numberedName(path, number, folder))) !== "none") {
        number += 1;
        if (number > MAX_COPY_NUMBER)
          throw new Error(`${path} has too many numbered copies already. Choose another name.`);
      }
      const free = numberedName(path, number, folder);
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
    terminalNotice(`${given} already exists: saved as ${used} instead.`, "warning");
  renamedOutputs.clear();
}

function contains(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (relation.split(/[\\/]/u)[0] !== ".." && !isAbsolute(relation));
}

async function effectiveOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  let ancestor = dirname(absolute);
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...missing.reverse(), basename(absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("The output path could not be resolved safely.");
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error("The output path could not be resolved safely.");
      missing.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

async function effectiveSourcePath(path: string, key: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch {
    throw new Error(
      `The ${optionLabel(key)} could not be read. Check that the file exists and is readable.`,
    );
  }
}

/** Files and folders must not shadow one another or overwrite an input. */
export async function validateOutputPaths(args: ParsedArguments): Promise<void> {
  const outputs = SAVED_OPTIONS.flatMap((key) => {
    const path = value(args, key);
    return path === undefined ? [] : [{ key, path }];
  });
  const effectiveOutputs = await Promise.all(
    outputs.map(async (output) => ({ ...output, path: await effectiveOutputPath(output.path) })),
  );
  for (const [index, left] of effectiveOutputs.entries()) {
    for (const right of effectiveOutputs.slice(index + 1)) {
      if (contains(left.path, right.path) || contains(right.path, left.path))
        throw new Error(
          `The ${optionLabel(left.key)} and ${optionLabel(right.key)} must use separate, non-overlapping paths.`,
        );
    }
    for (const key of INPUT_OPTIONS) {
      for (const source of values(args, key)) {
        if (source === "-") continue;
        const effectiveSource = await effectiveSourcePath(source, key);
        if (contains(left.path, effectiveSource) || contains(effectiveSource, left.path))
          throw new Error(`The ${optionLabel(left.key)} must not overlap the ${optionLabel(key)}.`);
      }
    }
  }
}

/** This is a preflight; the writer still enforces exclusive or atomic publication. */
export async function preflightFileDestination(
  path: string,
  allowOverwrite: boolean,
): Promise<void> {
  if (!path.trim() || path === "-")
    throw new Error(
      "File export requires a file path; - and empty paths are not accepted. Results always appear in the terminal.",
    );
  try {
    const existing = await lstat(path);
    if (!allowOverwrite) throw new Error("The output file already exists. Choose a new path.");
    if (existing.isDirectory()) throw new Error("The output path must be a file, not a directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(resolve(path));
  try {
    if (!(await stat(parent)).isDirectory())
      throw new Error("The folder containing the output file is not a directory.");
    await access(parent, constants.W_OK);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The folder containing the output file is not a directory."
    ) {
      throw error;
    }
    throw new Error("The folder containing the output file must already exist and be writable.");
  }
}
