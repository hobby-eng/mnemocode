import { createHash, randomBytes } from "node:crypto";
import { readBundledFile } from "../bundled-files.js";
import type * as Engine from "../../sskr-wasm/generated/recovery_sskr_wasm.js";

let pending: Promise<typeof Engine> | undefined;

/** Node-only loader. The public share transport and export modules do not load WASM. */
export function sskrEngine(): Promise<typeof Engine> {
  return (pending ??= (async () => {
    const base = "sskr-wasm/";
    const manifest = JSON.parse(
      new TextDecoder().decode(await readBundledFile(`${base}integrity.json`)),
    ) as Record<string, string>;
    const bridgePath = "generated/recovery_sskr_wasm.js";
    const binaryPath = "generated/recovery_sskr_wasm_bg.wasm";
    // Inside the single executable the bridge runs from the bundle; its embedded copy, checked
    // here, is the same file, and the executable as a whole is checked against SHA256SUMS.
    const bridge = await readBundledFile(`${base}${bridgePath}`);
    const binary = await readBundledFile(`${base}${binaryPath}`);
    for (const [path, bytes] of [
      [bridgePath, bridge],
      [binaryPath, binary],
    ] as const) {
      if (createHash("sha256").update(bytes).digest("hex") !== manifest[path]) {
        throw new Error("SSKR dependency integrity check failed. No secret was processed.");
      }
    }
    const engine = await import("../../sskr-wasm/generated/recovery_sskr_wasm.js");
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
