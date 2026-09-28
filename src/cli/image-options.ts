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
    throw new Error('The image format must be png or jpg; jpeg is accepted as an alias.');
  return raw === 'jpeg' ? 'jpg' : raw;
}
/** Resolve errors before asking for a mnemonic or reading secret input. */
export async function validateImageOptions(args: ParsedArguments): Promise<void> {
  const directory = value(args, 'images-dir');
  const cards = value(args, 'cards-dir');
  await validateOutputPaths(args);
  if (args['image-format'] !== undefined && directory === undefined && cards === undefined)
    throw new Error(
      'An image format can be selected only when an image output folder or individual-card output folder is provided.',
    );
  if (directory === undefined && args['image-format'] === undefined) return;
  imageFormat(args);
  if (directory !== undefined) await requireNewImageDirectory(directory);
  await assertImageRenderer();
}
