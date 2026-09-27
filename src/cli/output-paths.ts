import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { value, values, type ParsedArguments } from './arguments.js';

function contains(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return relation === '' || (relation.split(/[\\/]/u)[0] !== '..' && !isAbsolute(relation));
}

async function effectiveOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  return resolve(await realpath(dirname(absolute)), basename(absolute));
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
          `--${left.key} and --${right.key} must use separate, non-overlapping paths.`,
        );
    }
    for (const key of ['mnemonic-file', 'input-file', 'share-file', 'share-qr']) {
      for (const source of values(args, key)) {
        if (source === '-') continue;
        const effectiveSource = await realpath(resolve(source));
        if (contains(left.path, effectiveSource) || contains(effectiveSource, left.path))
          throw new Error(`--${left.key} must not overlap --${key}.`);
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
    throw new Error('File export requires a new file path. Terminal output is always enabled.');
  try {
    const existing = await lstat(path);
    if (!allowOverwrite) throw new Error('The output file already exists. Choose a new path.');
    if (existing.isDirectory()) throw new Error('The output path must be a file, not a directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const parent = dirname(resolve(path));
  if (!(await stat(parent)).isDirectory())
    throw new Error('The output parent must be a directory.');
  await access(parent, constants.W_OK);
}
