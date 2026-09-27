import { validateOutputPaths } from './output-paths.js';
import {
  assertImageRenderer,
  requireNewImageDirectory,
  type ImageFormat,
} from '../export/image-export.js';
import { value, type ParsedArguments } from './arguments.js';

export const imageOptionNames = ['images-dir', 'image-format'] as const;
export function imageFormat(args: ParsedArguments): ImageFormat {
  const raw = value(args, 'image-format') ?? 'png';
  if (raw !== 'png' && raw !== 'jpg' && raw !== 'jpeg')
    throw new Error('--image-format must be png or jpg (jpeg is an alias).');
  return raw === 'jpeg' ? 'jpg' : raw;
}
/** Resolve errors before asking for a mnemonic or reading secret input. */
export async function validateImageOptions(args: ParsedArguments): Promise<void> {
  const directory = value(args, 'images-dir');
  const cards = value(args, 'cards-dir');
  await validateOutputPaths(args);
  if (args['image-format'] !== undefined && directory === undefined && cards === undefined)
    throw new Error('--image-format requires --images-dir or --cards-dir.');
  if (directory === undefined && args['image-format'] === undefined) return;
  imageFormat(args);
  if (directory !== undefined) await requireNewImageDirectory(directory);
  await assertImageRenderer();
}
