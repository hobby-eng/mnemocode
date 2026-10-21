// A card renderer of the Node.js platform whose QR matrices are recorded: the payload of each
// matrix made, and how many of its modules a drawing read, so that a test can tell which codes a
// sheet drew, and that it drew each whole and once. The platform is what the renderer takes from
// its host (CardRenderer's parameter); every drawing runs as it is.

import { CardRenderer } from "../../src/export/card-renderer.js";
import { nodeRenderPlatform } from "../../src/export/platform-node.js";

/** A renderer, and the matrices its platform made for it. */
export interface RecordingQr {
  readonly renderer: CardRenderer;
  /** The payload of each matrix made, in the order made. */
  readonly payloads: readonly string[];
  /** How many modules of each matrix were read, in the same order: none for a code not drawn. */
  readonly reads: readonly number[];
  /** How many modules each matrix has, its side squared: a code drawn whole reads each once. */
  readonly modules: readonly number[];
}

/** A renderer whose platform records each QR matrix it makes and every module read of it. */
export function recordingQr(): RecordingQr {
  const payloads: string[] = [];
  const reads: number[] = [];
  const modules: number[] = [];
  const renderer = new CardRenderer({
    ...nodeRenderPlatform,
    qrModules: (text) => {
      const matrix = nodeRenderPlatform.qrModules(text);
      const made = payloads.push(text) - 1;
      reads.push(0);
      modules.push(matrix.size ** 2);
      return {
        size: matrix.size,
        get: (row, column) => {
          reads[made] = (reads[made] ?? 0) + 1;
          return matrix.get(row, column);
        },
      };
    },
  });
  return { renderer, payloads, reads, modules };
}
