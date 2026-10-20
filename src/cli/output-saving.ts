// The outputs of a command checked before any secret is read, and each saved with a choice after a
// failure (save-retry.ts): one place for the rules of every file and folder that the options name
// (output-options.ts), so that Encode, SSKR, Preview and the candidate list check them alike.

import { assertImageRenderer, claimImageFolder } from "../export/image-export.js";
import { claimCardFolder } from "../export/individual-cards.js";
import { NewFolder } from "../export/private-file.js";
import { value, type ParsedArguments } from "./arguments.js";
import { saveHeirSheet, validateHeirSheetOptions, type HeirSheetFacts } from "./heir-sheet.js";
import { validateImageOptions } from "./image-options.js";
import { FILE_OUTPUTS, FOLDER_OUTPUTS } from "./output-options.js";
import {
  assertUsableOutputPath,
  preflightFileDestination,
  preflightFolderDestination,
  validateOutputPaths,
} from "./output-paths.js";
import { saveWithRetry, type ResultName } from "./save-retry.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { isOneOf } from "../core/one-of.js";

type FolderOutput = (typeof FOLDER_OUTPUTS)[number];
type SavedOutput = (typeof FILE_OUTPUTS)[number] | FolderOutput;

/**
 * How a new folder of each kind is claimed, and refused when something is there: a folder output
 * does not compile without its rule. The export claims it again when it writes.
 */
const FOLDER_RULES = {
  "cards-dir": claimCardFolder,
  "images-dir": claimImageFolder,
  "word-lists-dir": (path: string) =>
    NewFolder.claim(path, "Choose a new folder for the word-list set."),
} as const satisfies Readonly<Record<FolderOutput, (path: string) => Promise<NewFolder>>>;

/** Claims a new folder of `key`, refusing an occupied name or an unusable parent. */
export async function claimOutputFolder(key: FolderOutput, path: string): Promise<NewFolder> {
  const folder = await FOLDER_RULES[key](path);
  await preflightFolderDestination(path);
  return folder;
}

function isFolderOutput(key: SavedOutput): key is FolderOutput {
  return isOneOf(FOLDER_OUTPUTS, key);
}

/**
 * Refuses, before any secret is read, an output that cannot be saved: an image setting without
 * its folder, a folder that exists, a file whose folder cannot be written, a sheet setting without
 * its sheet. A file name taken already was numbered before this (RenamedOutputs.settle), so a file
 * that exists is only refused when it is a folder.
 */
export async function preflightOutputs(args: ParsedArguments): Promise<void> {
  const { needsRenderer } = await validateImageOptions(args);
  // Each new folder is claimed here once, by its rule; the renderer, which may start a program to
  // ask, is checked only for outputs that can be made.
  for (const key of FOLDER_OUTPUTS) {
    const path = value(args, key);
    if (path !== undefined) await claimOutputFolder(key, path);
  }
  if (needsRenderer) await assertImageRenderer();
  for (const key of FILE_OUTPUTS) {
    const path = value(args, key);
    if (path !== undefined) await preflightFileDestination(path, true);
  }
  validateHeirSheetOptions(args);
}

/**
 * Refuses another name for the output `key` unless it is a new file whose folder can be written,
 * or a new folder of its kind, and no other output of the command overlaps it.
 */
export async function checkOutputName(
  args: ParsedArguments,
  key: SavedOutput,
  path: string,
): Promise<void> {
  assertUsableOutputPath(key, path);
  if (isFolderOutput(key)) await claimOutputFolder(key, path);
  else await preflightFileDestination(path, false);
  await validateOutputPaths({ ...args, [key]: path });
}

/**
 * Saves the output that the option `key` names, which is on the screen already, with saveWithRetry:
 * a failure keeps it and offers to try again, another name or to skip it, which the messages say of
 * it by `name`. `write` saves it at a path. A name used instead of the one given is kept in `args`,
 * so that the next new name is checked against it. Undefined when the option is not given or the
 * output was skipped.
 */
export async function saveOutput(
  args: ParsedArguments,
  key: SavedOutput,
  name: ResultName,
  write: (path: string) => Promise<void>,
): Promise<string | undefined | Cancelled> {
  const path = value(args, key);
  if (path === undefined) return undefined;
  const saved = await saveWithRetry({
    ...name,
    kind: isFolderOutput(key) ? "folder" : "file",
    path,
    write,
    checkName: (other) => checkOutputName(args, key, other),
  });
  if (saved !== undefined && saved !== CANCELLED) args[key] = saved;
  return saved;
}

/** Saves the sheet for heirs when --heir-sheet names a file, as saveOutput saves; CANCELLED at Ctrl+C. */
export async function saveHeirSheetOutput(
  args: ParsedArguments,
  facts: HeirSheetFacts,
): Promise<Cancelled | undefined> {
  const saved = await saveOutput(args, "heir-sheet", { what: "The sheet for heirs" }, (path) =>
    saveHeirSheet({ ...args, "heir-sheet": path }, facts),
  );
  return saved === CANCELLED ? CANCELLED : undefined;
}
