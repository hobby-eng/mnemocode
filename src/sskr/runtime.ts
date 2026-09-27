import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type * as Engine from '../../vendor/sskr/generated/recovery_sskr_wasm.js';

let pending: Promise<typeof Engine> | undefined;

/** Node-only loader. The public share transport and export modules do not load WASM. */
export function sskrEngine(): Promise<typeof Engine> {
  return (pending ??= (async () => {
    const base = new URL('../../vendor/sskr/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('integrity.json', base), 'utf8')) as Record<
      string,
      string
    >;
    const bridgePath = 'generated/recovery_sskr_wasm.js';
    const binaryPath = 'generated/recovery_sskr_wasm_bg.wasm';
    const bridge = await readFile(new URL(bridgePath, base));
    const binary = await readFile(new URL(binaryPath, base));
    for (const [path, bytes] of [
      [bridgePath, bridge],
      [binaryPath, binary],
    ] as const) {
      if (createHash('sha256').update(bytes).digest('hex') !== manifest[path]) {
        throw new Error('SSKR dependency integrity check failed. No secret was processed.');
      }
    }
    const engine = await import('../../vendor/sskr/generated/recovery_sskr_wasm.js');
    // Initialise from the exact WASM bytes verified above, not a second filesystem read.
    engine.initSync({ module: binary });
    return engine;
  })().catch((error) => {
    pending = undefined;
    throw error;
  }));
}

export function secureSeed(): Uint8Array {
  return randomBytes(32);
}
