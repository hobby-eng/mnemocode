import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { value, values, type ParsedArguments } from './arguments.js';
import { optionLabel } from './option-copy.js';

function contains(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return relation === '' || (relation.split(/[\\/]/u)[0] !== '..' && !isAbsolute(relation));
}

async function effectiveOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  let ancestor = dirname(absolute);
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...missing.reverse(), basename(absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('The output path could not be resolved safely.');
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error('The output path could not be resolved safely.');
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
  const outputs = ['images-dir', 'cards-dir', 'pdf', 'output', 'qr'].flatMap((key) => {
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
    for (const key of ['mnemonic-file', 'input-file', 'share-file', 'share-qr']) {
      for (const source of values(args, key)) {
        if (source === '-') continue;
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
  if (!path.trim() || path === '-')
    throw new Error(
      'File export requires a file path; - and empty paths are not accepted. Results always appear in the terminal.',
    );
  try {
    const existing = await lstat(path);
    if (!allowOverwrite) throw new Error('The output file already exists. Choose a new path.');
    if (existing.isDirectory()) throw new Error('The output path must be a file, not a directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const parent = dirname(resolve(path));
  try {
    if (!(await stat(parent)).isDirectory())
      throw new Error('The folder containing the output file is not a directory.');
    await access(parent, constants.W_OK);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'The folder containing the output file is not a directory.'
    ) {
      throw error;
    }
    throw new Error('The folder containing the output file must already exist and be writable.');
  }
}
